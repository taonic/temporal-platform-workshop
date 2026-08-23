package platform

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// EnvironmentWorkflowID is the child workflow id for one environment.
//
// Read this function before you write anything else, because it is the keystone
// of the whole design and it is already done for you.
//
// The workflow id IS the resource identity. Temporal refuses to run two workflows
// with the same id, so you get a single writer per resource for free — no lock
// table, no lease, no `terraform force-unlock` runbook, because a second
// concurrent writer cannot come into existence. A competing reconcile gets
// "workflow execution already started" instead of a corrupted state file.
//
// It is also why the state service implements no lock endpoints. Go and ask it.
func EnvironmentWorkflowID(in EnvInput) string {
	return "ns-" + in.Spec.Name + "-" + in.Env
}

// ============================================================================
// Lab 2 — Fan-out and identity
//
// Goal: provision ONE environment. The parent already fans out one child per
//       environment and collects the results; this is the child.
//
// Write the body below:
//
//   1. Set activity options. A cold provider download plus a namespace create is
//      minutes, not seconds, so StartToCloseTimeout wants to be generous — 30
//      minutes — and HeartbeatTimeout around a minute. The heartbeat timeout is
//      what actually detects a dead worker; the start-to-close timeout only
//      detects a slow one. Give it a RetryPolicy with a modest backoff.
//
//   2. Execute actv.TerraformApply with `in`. It returns TerraformApplyResult,
//      carrying NamespaceID and ServiceAccountID from the module outputs you
//      wrote in lab 1.
//
//   3. Execute actv.MintNamespaceKey with a MintKeyInput built from `in` plus the
//      service account and namespace ids you just got back. It returns
//      MintKeyResult.
//
//   4. Return an EnvResult.
//
// Step 4 is the lesson. Look at MintKeyResult: it has VaultPath and KeyID, and no
// token. That is not an oversight — whatever this workflow returns is written to
// the event history, where it is readable by anyone who can see the workflow, for
// the whole retention period. A credential in a return value is a credential in
// an audit log you cannot redact.
//
// One more decision worth thinking about rather than copying. If the apply
// succeeds and the mint fails, what do you return? The namespace exists and is
// usable; only the credential is missing. Returning an error is right — the
// reconciler should retry — but consider populating NamespaceID and
// ServiceAccountID on the way out anyway, so the next attempt and the human
// reading the status both know the namespace is already there. The next apply
// will adopt it rather than recreating it, because the platform imports before it
// applies.
//
// Your feedback loop, before any grader runs:
//
//   go test ./internal/platform/...
//
// TestProvisionWorkflowFansOutPerEnvironment asserts the VaultPath comes back and
// TestProvisionWorkflowReportsPartialFailure asserts one broken environment does
// not fail the other. Make them pass.
// ============================================================================
func EnvironmentWorkflow(ctx workflow.Context, in EnvInput) (EnvResult, error) {
	// Delete this and write the body. A non-retryable error rather than a panic so
	// the message reaches you through the parent, the CLI and the Temporal UI --
	// a panic in a workflow retries forever and tells you nothing useful.
	return EnvResult{Env: in.Env}, temporal.NewNonRetryableApplicationError(
		"lab 2 is not implemented: write EnvironmentWorkflow (see the comment above it), "+
			"then run `go test ./internal/platform/...`",
		"NotImplemented", nil)
}

// DestroyEnvironmentWorkflow removes one environment. Provided, because it is the
// mirror image of what you just wrote and there is no second lesson in it.
//
// Note it uses the same id convention, so the same lock covers create and
// destroy: you cannot destroy an environment that is mid-apply.
func DestroyEnvironmentWorkflow(ctx workflow.Context, in EnvInput) error {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Minute,
		HeartbeatTimeout:    time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 1.5,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    5,
		},
	})
	return workflow.ExecuteActivity(ctx, actv.TerraformDestroy, in).Get(ctx, nil)
}
