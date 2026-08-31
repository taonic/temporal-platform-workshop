package workflow

import (
	"sort"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// NamespaceWorkflowID is the entity workflow id for one logical namespace. One
// spec, one workflow, forever.
func NamespaceWorkflowID(name string) string { return "ns-" + name }

// historyLimit is when to continue-as-new. A reconciler that runs for a week
// accumulates history from every timer tick; continue-as-new keeps it bounded
// without losing the entity's identity, because the workflow id does not change.
const historyLimit = 8000

// NamespaceWorkflow is the declarative driver: a long-lived entity workflow, one
// per logical namespace, that keeps the world matching the spec.
//
// This is the workshop's central claim made executable. OpenAI built this control
// loop as a Kubernetes operator; a Temporal entity workflow is a better operator
// for the same job -- durable by construction, retryable per resource, auditable
// after the fact from event history, and able to wait on a human without holding
// a process open.
//
// Two inputs, deliberately different in kind:
//
//   - Intent arrives by SIGNAL. The post-commit hook signals this workflow, so a
//     student gets feedback immediately after committing a spec.
//   - Reality arrives by TIMER. Every DriftInterval the loop asks the Cloud what
//     is actually true, which is the only way to catch a change nobody committed --
//     somebody editing retention in the Cloud UI, or deleting a namespace outright.
//
// Signals carry intent; the timer catches drift. Teaching both in one loop is what
// makes the distinction land.
func NamespaceWorkflow(ctx workflow.Context, in ReconcileInput) error {
	log := workflow.GetLogger(ctx)

	status := Status{Spec: in.Spec, Username: in.Username, Generation: 1}
	applied := map[string]EnvStatus{}

	if err := workflow.SetQueryHandler(ctx, QueryStatus, func() (Status, error) {
		// Rebuilt on every query so the slice is ordered and the map is not
		// exposed. Checkpoints read this: cloud state is visible through the Ops
		// API, but "did the loop notice" is only visible here.
		status.Environments = sortedStatuses(applied)
		return status, nil
	}); err != nil {
		return err
	}

	applyCh := workflow.GetSignalChannel(ctx, SignalApply)
	destroyCh := workflow.GetSignalChannel(ctx, SignalDestroy)

	desired := in
	reconcile := func() {
		status.Reconciles++
		for _, st := range reconcileEnvironments(ctx, desired, applied) {
			applied[st.Env] = st
		}
		// Environments that used to be in the spec and are not any more get torn
		// down. This is the half of reconciliation people forget: converging on
		// desired state means removing what is no longer desired, not only adding
		// what is.
		pruneRemovedEnvironments(ctx, desired, applied)
	}

	reconcile()

	for {
		if workflow.GetInfo(ctx).GetCurrentHistoryLength() > historyLimit {
			log.Info("continuing as new", "reconciles", status.Reconciles)
			return workflow.NewContinueAsNewError(ctx, NamespaceWorkflow, desired)
		}

		// Signals carry intent; the timer catches reality. See wait.go.
		event, incoming := waitForNext(ctx, applyCh, destroyCh, desired.DriftInterval())

		switch event {
		case eventDestroy:
			log.Info("destroy requested", "spec", desired.Spec.Name)
			status.Destroying = true
			destroyAll(ctx, desired, applied)
			status.Environments = sortedStatuses(applied)
			return nil

		case eventApply:
			// A spec that has not changed is not intent. Without this, the git hook
			// firing on an unrelated commit would re-apply every namespace in the
			// repo.
			if desired.Spec.Fingerprint() == incoming.Spec.Fingerprint() {
				log.Info("apply signal carried no change", "spec", desired.Spec.Name)
				continue
			}
			log.Info("spec changed", "spec", incoming.Spec.Name)
			desired = incoming
			status.Spec = incoming.Spec
			status.Generation++
			reconcile()

		case eventTick:
			drifted, detail := detectDrift(ctx, desired)
			if drifted {
				status.DriftsDetected++
				status.LastDrift = detail
				log.Info("drift detected", "detail", detail)
				// Stamped into the namespace tags by the apply that follows, so a
				// portal outside the sandbox can see that the loop corrected
				// something. workflow.Now, not time.Now: this value lands in the
				// history and has to be identical on replay.
				desired.DriftCorrectedAt = workflow.Now(ctx).UTC().Format(time.RFC3339)
				reconcile()
			}
		}
	}
}

// detectDrift asks every environment what the Cloud actually says.
func detectDrift(ctx workflow.Context, in ReconcileInput) (bool, string) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval: 2 * time.Second,
			MaximumInterval: 20 * time.Second,
			MaximumAttempts: 3,
		},
	})

	envs := append([]string(nil), in.Spec.Environments...)
	sort.Strings(envs)

	type pending struct {
		env    string
		future workflow.Future
	}
	var running []pending
	for _, e := range envs {
		running = append(running, pending{
			env:    e,
			future: workflow.ExecuteActivity(ctx, actv.DetectDrift, EnvInput{ReconcileInput: in, Env: e}),
		})
	}

	for _, p := range running {
		var rep DriftReport
		if err := p.future.Get(ctx, &rep); err != nil {
			// A drift check that cannot run is not drift. Say nothing and try
			// again on the next tick rather than triggering a pointless apply.
			workflow.GetLogger(ctx).Warn("drift check failed", "env", p.env, "error", err.Error())
			continue
		}
		if rep.Drifted {
			return true, p.env + ": " + rep.Detail
		}
	}
	return false, ""
}

// pruneRemovedEnvironments destroys environments the spec no longer lists.
func pruneRemovedEnvironments(ctx workflow.Context, in ReconcileInput, applied map[string]EnvStatus) {
	want := map[string]bool{}
	for _, e := range in.Spec.Environments {
		want[e] = true
	}

	var stale []string
	for env := range applied {
		if !want[env] {
			stale = append(stale, env)
		}
	}
	sort.Strings(stale) // determinism

	for _, env := range stale {
		envIn := EnvInput{ReconcileInput: in, Env: env}
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID:         EnvironmentWorkflowID(envIn) + "-destroy",
			WorkflowRunTimeout: time.Hour,
		})
		if err := workflow.ExecuteChildWorkflow(childCtx, DestroyEnvironmentWorkflow, envIn).Get(ctx, nil); err != nil {
			workflow.GetLogger(ctx).Error("destroying removed environment failed", "env", env, "error", err.Error())
			continue
		}
		delete(applied, env)
	}
}

func destroyAll(ctx workflow.Context, in ReconcileInput, applied map[string]EnvStatus) {
	empty := in
	empty.Spec.Environments = nil
	pruneRemovedEnvironments(ctx, empty, applied)
}

func sortedStatuses(applied map[string]EnvStatus) []EnvStatus {
	out := make([]EnvStatus, 0, len(applied))
	for _, v := range applied {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Env < out[j].Env })
	return out
}
