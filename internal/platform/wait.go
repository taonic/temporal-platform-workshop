package platform

import (
	"time"

	"go.temporal.io/sdk/workflow"
)

// reconcilerEvent is what woke the reconciler up.
type reconcilerEvent int

const (
	// eventApply: somebody delivered intent. A spec was committed.
	eventApply reconcilerEvent = iota
	// eventDestroy: tear this namespace down.
	eventDestroy
	// eventTick: nothing happened, which is exactly when to go and check whether
	// reality still matches the spec.
	eventTick
)

func (e reconcilerEvent) String() string {
	switch e {
	case eventApply:
		return "apply"
	case eventDestroy:
		return "destroy"
	default:
		return "tick"
	}
}

// ============================================================================
// Lab 3 — Invert to declarative
//
// Goal: turn the imperative provisioner into a control loop, by writing the one
//       function that decides what the loop reacts to.
//
// NamespaceWorkflow above already has the loop, the reconcile, the drift check and
// the query handler. It calls this function to wait, and switches on what you
// return. Nothing else needs changing — which is the point of the challenge:
// inverting an imperative script into a control loop is a change of driver, not a
// rewrite. The activities and the child workflows are the ones you already have.
//
// Write the body below. Block until ONE of three things happens and say which:
//
//   · a value arrives on applyCh    -> receive it into a ReconcileInput and
//                                      return (eventApply, thatInput)
//   · a value arrives on destroyCh  -> return (eventDestroy, ...)
//   · `after` elapses               -> return (eventTick, ...)
//
// Use workflow.NewTimer for the deadline and workflow.NewSelector to wait on all
// three at once. AddReceive for the channels, AddFuture for the timer, then
// Select. Do not use a Go `select` statement or time.After — neither is
// deterministic, and a replay would diverge from the recorded history.
//
// The distinction you are implementing is the whole lesson:
//
//   Intent arrives by SIGNAL. The post-commit hook signals this workflow, so you
//   get feedback the moment you commit a spec.
//
//   Reality arrives by TIMER. Nobody signals you when somebody edits retention in
//   the Cloud UI. The loop has to go and look.
//
// A control plane with only signals converges on what people said. A control plane
// with a timer converges on what is true. You need both, and they are four lines
// apart.
//
// Your feedback loop:
//
//   go test ./internal/platform/...
//
// TestReconcilerDetectsAndCorrectsDrift proves the timer half.
// TestReconcilerIgnoresAnApplyThatChangesNothing proves the signal half.
// ============================================================================
func waitForNext(
	ctx workflow.Context,
	applyCh workflow.ReceiveChannel,
	destroyCh workflow.ReceiveChannel,
	after time.Duration,
) (reconcilerEvent, ReconcileInput) {
	// Delete this and write the body.
	panic("lab 3 is not implemented: write waitForNext (see the comment above it), " +
		"then run `go test ./internal/platform/...`")
}
