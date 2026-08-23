package platform

import (
	"sort"
	"time"

	"go.temporal.io/sdk/workflow"
)

// ReaperWorkflowID is one reaper per participant.
func ReaperWorkflowID(participant string) string { return "reap-" + participant }

const (
	SignalRegister = "register"
	SignalExtend   = "extend"
	SignalRevoke   = "revoke"
	QueryReaper    = "reaper"
)

// ReaperInput starts a countdown on a participant's resources.
type ReaperInput struct {
	Participant string `json:"participant"`
	Slot        int    `json:"slot"`
	TTLSeconds  int    `json:"ttlSeconds"`
}

// ReaperRegistration tells the reaper about a namespace it will have to clean up.
type ReaperRegistration struct {
	SpecName string `json:"specName"`
}

// ExtendRequest buys more time. The training portal's invitation workflow has the
// same signal for the same reason: somebody always needs another hour.
type ExtendRequest struct {
	Seconds int `json:"seconds"`
}

type ReaperStatus struct {
	Participant string    `json:"participant"`
	Slot        int       `json:"slot"`
	Deadline    time.Time `json:"deadline"`
	Tracking    []string  `json:"tracking"`
	Reaped      bool      `json:"reaped"`
}

// DefaultReaperTTL is how long a sandbox holds its slot without being extended.
const DefaultReaperTTL = 8 * time.Hour

// ReaperWorkflow returns a participant's slot to the pool when they are done with
// it -- or when they walk away, which in a self-paced track is the common case.
//
// It is a workflow rather than a cron script for the reason everything else here
// is: it has to survive the eight hours between "sandbox started" and "nobody came
// back", and it has to be interruptible by a human in the middle.
func ReaperWorkflow(ctx workflow.Context, in ReaperInput) error {
	log := workflow.GetLogger(ctx)

	ttl := time.Duration(in.TTLSeconds) * time.Second
	if ttl <= 0 {
		ttl = DefaultReaperTTL
	}

	tracking := map[string]bool{}
	deadline := workflow.Now(ctx).Add(ttl)
	reaped := false

	if err := workflow.SetQueryHandler(ctx, QueryReaper, func() (ReaperStatus, error) {
		names := make([]string, 0, len(tracking))
		for n := range tracking {
			names = append(names, n)
		}
		sort.Strings(names)
		return ReaperStatus{
			Participant: in.Participant,
			Slot:        in.Slot,
			Deadline:    deadline,
			Tracking:    names,
			Reaped:      reaped,
		}, nil
	}); err != nil {
		return err
	}

	registerCh := workflow.GetSignalChannel(ctx, SignalRegister)
	extendCh := workflow.GetSignalChannel(ctx, SignalExtend)
	revokeCh := workflow.GetSignalChannel(ctx, SignalRevoke)

	for {
		remaining := deadline.Sub(workflow.Now(ctx))
		if remaining <= 0 {
			break
		}

		timer := workflow.NewTimer(ctx, remaining)
		sel := workflow.NewSelector(ctx)

		var (
			reg     ReaperRegistration
			ext     ExtendRequest
			gotReg  bool
			gotExt  bool
			revoked bool
			expired bool
		)

		sel.AddReceive(registerCh, func(c workflow.ReceiveChannel, _ bool) {
			c.Receive(ctx, &reg)
			gotReg = true
		})
		sel.AddReceive(extendCh, func(c workflow.ReceiveChannel, _ bool) {
			c.Receive(ctx, &ext)
			gotExt = true
		})
		sel.AddReceive(revokeCh, func(c workflow.ReceiveChannel, _ bool) {
			c.Receive(ctx, nil)
			revoked = true
		})
		sel.AddFuture(timer, func(workflow.Future) { expired = true })

		sel.Select(ctx)

		switch {
		case revoked:
			log.Info("reaping early on request", "participant", in.Participant)
			expired = true
		case gotReg && reg.SpecName != "":
			tracking[reg.SpecName] = true
			log.Info("tracking namespace for reaping", "spec", reg.SpecName)
			continue
		case gotExt && ext.Seconds > 0:
			deadline = deadline.Add(time.Duration(ext.Seconds) * time.Second)
			log.Info("extended", "newDeadline", deadline)
			continue
		}

		if expired {
			break
		}
	}

	log.Info("reaping", "participant", in.Participant, "slot", in.Slot, "namespaces", len(tracking))

	// Tell each namespace's reconciler to tear itself down. The reconciler owns
	// the state and the terraform, so the reaper does not touch either -- it only
	// says when.
	names := make([]string, 0, len(tracking))
	for n := range tracking {
		names = append(names, n)
	}
	sort.Strings(names)

	for _, name := range names {
		err := workflow.SignalExternalWorkflow(ctx, NamespaceWorkflowID(name), "", SignalDestroy, nil).Get(ctx, nil)
		if err != nil {
			// Already gone is the success case, not a failure.
			log.Warn("could not signal destroy", "spec", name, "error", err.Error())
		}
	}

	// Give the reconcilers room to finish destroying before the slot -- and
	// therefore the namespace names -- go back in the pool.
	if err := workflow.Sleep(ctx, 5*time.Minute); err != nil {
		return err
	}

	if err := workflow.SignalExternalWorkflow(ctx, SlotPoolWorkflowID, "", SignalRelease,
		LeaseRequest{Participant: in.Participant}).Get(ctx, nil); err != nil {
		log.Error("could not release slot", "slot", in.Slot, "error", err.Error())
	}

	reaped = true
	return nil
}

// notifyReaper registers a namespace with its participant's reaper.
//
// Best effort on purpose: a local dev run has no reaper, and failing to register
// should not stop a namespace being provisioned.
func notifyReaper(ctx workflow.Context, in ReconcileInput) {
	if in.Participant == "" {
		return
	}
	err := workflow.SignalExternalWorkflow(ctx,
		ReaperWorkflowID(in.Participant), "", SignalRegister,
		ReaperRegistration{SpecName: in.Spec.Name},
	).Get(ctx, nil)
	if err != nil {
		workflow.GetLogger(ctx).Info("no reaper to register with, continuing",
			"participant", in.Participant)
	}
}
