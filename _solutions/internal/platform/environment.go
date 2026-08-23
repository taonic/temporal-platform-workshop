package platform

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// EnvironmentWorkflowID is the child workflow id for one environment.
//
// This is the keystone of the whole design. The workflow id IS the resource
// identity, so Temporal's workflow-id uniqueness constraint gives a single writer
// per resource for free -- no lock table, no lease, no `terraform force-unlock`
// runbook, because a second concurrent writer cannot come into existence. A
// competing reconcile gets "workflow execution already started" instead of a
// corrupted state file.
//
// It is also why the state backend has no lock endpoints. See DESIGN.md rule 1.
func EnvironmentWorkflowID(in EnvInput) string {
	return "ns-" + in.Spec.Name + "-" + in.Env
}

// EnvironmentWorkflow provisions one environment: one namespace, one
// namespace-scoped identity, one credential in Vault.
//
// Both drivers use this. The imperative ProvisionWorkflow from challenge 1 and the
// declarative reconciler from challenge 3 run exactly the same child, which is the
// point: inverting an imperative script into a control loop is a change of driver,
// not a rewrite.
func EnvironmentWorkflow(ctx workflow.Context, in EnvInput) (EnvResult, error) {
	log := workflow.GetLogger(ctx)
	log.Info("reconciling environment", "namespace", in.PhysicalName())

	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		// A cold provider download plus a namespace create is minutes, not
		// seconds. The heartbeat timeout is what actually detects a dead worker.
		StartToCloseTimeout: 30 * time.Minute,
		HeartbeatTimeout:    time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 1.5,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    8,
		},
	})

	var applied TerraformApplyResult
	if err := workflow.ExecuteActivity(ctx, actv.TerraformApply, in).Get(ctx, &applied); err != nil {
		return EnvResult{Env: in.Env}, err
	}

	var minted MintKeyResult
	mintIn := MintKeyInput{
		EnvInput:         in,
		ServiceAccountID: applied.ServiceAccountID,
		NamespaceID:      applied.NamespaceID,
	}
	if err := workflow.ExecuteActivity(ctx, actv.MintNamespaceKey, mintIn).Get(ctx, &minted); err != nil {
		// The namespace exists and is usable; only the credential is missing. Fail
		// the environment so the reconciler retries, and let the next apply adopt
		// the namespace via AttemptImport rather than recreating it.
		return EnvResult{
			Env:              in.Env,
			NamespaceID:      applied.NamespaceID,
			ServiceAccountID: applied.ServiceAccountID,
		}, err
	}

	return EnvResult{
		Env:              in.Env,
		NamespaceID:      applied.NamespaceID,
		ServiceAccountID: applied.ServiceAccountID,
		VaultPath:        minted.VaultPath,
		KeyID:            minted.KeyID,
	}, nil
}

// DestroyEnvironmentWorkflow removes one environment. Same id convention, so the
// same lock covers create and destroy -- you cannot destroy an environment that
// is mid-apply.
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
