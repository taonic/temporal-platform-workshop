package platform

import (
	"fmt"
	"sort"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/workflow"
)

// ProvisionWorkflow is the imperative driver: one apply, then exit.
//
// This exists for challenge 1, and it is not scaffolding to be thrown away. A
// student's first twenty minutes need a visible win, and "commit a file and wait
// for a control loop" has four candidate failure points when nothing happens --
// the CLI, the hook, the workflow, or terraform. Run it directly first, watch it
// work, and you have a baseline to debug the loop against later.
//
// Challenge 3 then inverts this into NamespaceWorkflow. Same activities, same
// children, different driver.
func ProvisionWorkflow(ctx workflow.Context, in ReconcileInput) ([]EnvStatus, error) {
	log := workflow.GetLogger(ctx)
	log.Info("provisioning", "spec", in.Spec.Name, "slot", in.Slot, "environments", in.Spec.Environments)

	statuses := reconcileEnvironments(ctx, in, nil)

	failed := 0
	firstError := ""
	for _, s := range statuses {
		if !s.OK {
			failed++
			if firstError == "" {
				firstError = s.Env + ": " + s.Error
			}
		}
	}
	// Partial failure is a real outcome and the caller should see it per
	// environment, so only a total failure fails the workflow. Staging can be
	// broken while prod is fine, and hiding that behind one error would be a lie.
	if failed == len(statuses) && failed > 0 {
		// Naming the first reason matters more than counting. "all 2 environments
		// failed" sends someone digging through child workflows; the reason does not.
		return statuses, fmt.Errorf("all %d environments failed to provision. First: %s", failed, firstError)
	}
	return statuses, nil
}

// reconcileEnvironments runs one child per environment, concurrently, and returns
// a status for each.
//
// prior lets the caller carry forward results for environments that did not need
// re-applying; pass nil to reconcile everything.
func reconcileEnvironments(ctx workflow.Context, in ReconcileInput, prior map[string]EnvStatus) []EnvStatus {
	// Sorted, because iterating a map in a workflow makes the history
	// non-deterministic and a replay would start children in a different order.
	envs := append([]string(nil), in.Spec.Environments...)
	sort.Strings(envs)

	type pending struct {
		env    string
		future workflow.Future
	}
	var running []pending

	for _, e := range envs {
		envIn := EnvInput{ReconcileInput: in, Env: e}
		childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
			WorkflowID: EnvironmentWorkflowID(envIn),
			// The child owns one resource and finishes. If the parent goes away
			// mid-apply we want the apply to finish rather than leave terraform
			// half-done, so the child is not terminated with the parent.
			ParentClosePolicy:  enumspb.PARENT_CLOSE_POLICY_ABANDON,
			WorkflowRunTimeout: time.Hour,
		})
		running = append(running, pending{
			env:    e,
			future: workflow.ExecuteChildWorkflow(childCtx, EnvironmentWorkflow, envIn),
		})
	}

	out := make([]EnvStatus, 0, len(running))
	for _, p := range running {
		var res EnvResult
		st := EnvStatus{Env: p.env}
		if err := p.future.Get(ctx, &res); err != nil {
			st.OK = false
			st.Error = err.Error()
			// Keep whatever we knew before, so a failed re-apply does not erase the
			// namespace id a student is looking at.
			if old, ok := prior[p.env]; ok {
				st.NamespaceID = old.NamespaceID
				st.VaultPath = old.VaultPath
				st.LastApplied = old.LastApplied
			}
		} else {
			now := workflow.Now(ctx)
			st.OK = true
			st.NamespaceID = res.NamespaceID
			st.VaultPath = res.VaultPath
			st.LastApplied = &now
		}
		out = append(out, st)
	}
	return out
}
