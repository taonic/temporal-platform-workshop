// GENERATED from the reference solution. Do not hand-edit the code below --
// `pnpm snippets:emit` writes it back to internal/platform/wait.go and `make verify` compiles it
// there, so a drifted copy fails CI rather than a student's paste.
export const WAIT_GO = `package platform

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

// waitForNext blocks until one of three things happens, and says which.
//
// This is the heart of the control loop, and the distinction it draws is the whole
// lesson of challenge 3:
//
//   - Intent arrives by SIGNAL. The post-commit hook signals this workflow, so a
//     student gets feedback the moment they commit.
//   - Reality arrives by TIMER. Nobody signals you when someone edits retention in
//     the Cloud UI, so the loop has to go and look.
//
// A control plane with only signals converges on what people said. A control plane
// with a timer converges on what is true. You need both.
func waitForNext(
	ctx workflow.Context,
	applyCh workflow.ReceiveChannel,
	destroyCh workflow.ReceiveChannel,
	after time.Duration,
) (reconcilerEvent, ReconcileInput) {
	timer := workflow.NewTimer(ctx, after)
	sel := workflow.NewSelector(ctx)

	var (
		incoming ReconcileInput
		event    = eventTick
	)

	sel.AddReceive(applyCh, func(c workflow.ReceiveChannel, _ bool) {
		c.Receive(ctx, &incoming)
		event = eventApply
	})
	sel.AddReceive(destroyCh, func(c workflow.ReceiveChannel, _ bool) {
		c.Receive(ctx, nil)
		event = eventDestroy
	})
	sel.AddFuture(timer, func(workflow.Future) {
		event = eventTick
	})

	sel.Select(ctx)
	return event, incoming
}
`;
