package activity

import (
	"context"
	"fmt"

	"go.temporal.io/sdk/temporal"

	"github.com/taonic/temporal-platform-workshop/internal/tfactivity"
	"github.com/taonic/temporal-platform-workshop/internal/tfworkspace"
	tfmodules "github.com/taonic/temporal-platform-workshop/terraform"
)

// TerraformActivities drive the execution engine: a subprocess, minutes long,
// heartbeating, resumable. See the package comment in config.go for why the receivers are
// split this way.
//
// Everything the module manages lives behind ONE apply and ONE state file -- the
// namespace, its service account, and its search attributes. That is why there is
// no per-resource activity here and never will be: three activities would mean
// three full applies of the same module, and a cold provider download is minutes.
type TerraformActivities struct{ cloudCreds }

// TerraformApplyResult is what the module produced. Note again: no credential.
type TerraformApplyResult struct {
	NamespaceID      string `json:"namespaceId"`
	ServiceAccountID string `json:"serviceAccountId"`
}

// TerraformApply provisions one namespace and its worker identity.
func (a *TerraformActivities) TerraformApply(ctx context.Context, in EnvInput) (TerraformApplyResult, error) {
	backend, err := a.cfg.Backend(in)
	if err != nil {
		// A misconfigured backend will still be misconfigured in thirty seconds.
		return TerraformApplyResult{}, temporal.NewNonRetryableApplicationError(
			err.Error(), "BadBackendConfig", err)
	}
	apiKey, err := a.cloudAPIKey(ctx)
	if err != nil {
		return TerraformApplyResult{}, err
	}

	name := in.PhysicalName()
	act := tfactivity.New(tfworkspace.Config{
		ModulePath: "namespace",
		FS:         tfmodules.FS,
		Backend:    backend,
	})

	out, err := act.Apply(ctx, tfworkspace.ApplyInput{
		// The credential reaches terraform through the environment and nowhere
		// else: not a variable, not a tfvars file, not the activity's arguments.
		Env: map[string]string{"TEMPORAL_CLOUD_API_KEY": apiKey},
		// No "tags" here. The module no longer declares that variable, and passing
		// one Terraform does not know about warns on every apply. Setting namespace
		// tags needs Account Owner or Global Admin (UpdateNamespaceTags is granted
		// to those two roles only); this reconciler runs as a Developer service
		// account on purpose, so it could not write them even if the resource were
		// still there. See DESIGN.md rule 3.
		Vars: map[string]any{
			"namespace_name": name,
			"region":         in.Spec.Region,
			"retention_days": in.Spec.RetentionDays,
		},
		// If a previous attempt created the namespace but failed before its state
		// was written, adopt it instead of trying to create it again. Namespace
		// names are unique per account, so "create again" fails permanently.
		AttemptImport: map[string]string{
			"temporalcloud_namespace.ns": name,
		},
	})
	if err != nil {
		return TerraformApplyResult{}, err
	}

	nsID, err := stringOutput(out.Output, "namespace_id")
	if err != nil {
		return TerraformApplyResult{}, err
	}
	saID, err := stringOutput(out.Output, "service_account_id")
	if err != nil {
		return TerraformApplyResult{}, err
	}
	return TerraformApplyResult{NamespaceID: nsID, ServiceAccountID: saID}, nil
}

// TerraformDestroy removes one environment.
func (a *TerraformActivities) TerraformDestroy(ctx context.Context, in EnvInput) error {
	backend, err := a.cfg.Backend(in)
	if err != nil {
		return temporal.NewNonRetryableApplicationError(err.Error(), "BadBackendConfig", err)
	}
	apiKey, err := a.cloudAPIKey(ctx)
	if err != nil {
		return err
	}
	act := tfactivity.New(tfworkspace.Config{
		ModulePath: "namespace",
		FS:         tfmodules.FS,
		Backend:    backend,
	})
	return act.Destroy(ctx, tfworkspace.DestroyInput{
		Env: map[string]string{"TEMPORAL_CLOUD_API_KEY": apiKey},
	})
}

// stringOutput reads one string out of the module's outputs, and says which one is
// missing rather than returning a zero value that fails later somewhere else.
func stringOutput(out map[string]any, key string) (string, error) {
	v, ok := out[key]
	if !ok {
		return "", fmt.Errorf("terraform output %q is missing", key)
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("terraform output %q is %T, expected string", key, v)
	}
	return s, nil
}
