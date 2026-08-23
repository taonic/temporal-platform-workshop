package platform

import (
	"context"
	"fmt"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"

	"github.com/taonic/temporal-platform-workshop/internal/cloudops"
	"github.com/taonic/temporal-platform-workshop/internal/tfactivity"
	"github.com/taonic/temporal-platform-workshop/internal/tfworkspace"
	"github.com/taonic/temporal-platform-workshop/internal/vaultkv"
	tfmodules "github.com/taonic/temporal-platform-workshop/terraform"
)

// Activities holds the control plane's side effects. Everything that touches the
// world lives here; the workflows above are pure orchestration.
type Activities struct {
	cfg   Config
	vault *vaultkv.Client
}

func NewActivities(cfg Config, vault *vaultkv.Client) *Activities {
	return &Activities{cfg: cfg, vault: vault}
}

// actv exists only so workflow code can name activities type-safely
// (workflow.ExecuteActivity(ctx, actv.TerraformApply, ...)). It is never called
// through, so the nil receiver is fine.
var actv *Activities

// cloudAPIKey reads the platform's own credential from Vault on every use.
//
// Reading it fresh rather than caching it at worker start is what makes rotation
// a non-event: revoke the old key, write the new one, and the next activity
// attempt picks it up. A cached credential turns rotation into a deploy.
func (a *Activities) cloudAPIKey(ctx context.Context) (string, error) {
	key, err := a.vault.ReadString(ctx, a.cfg.VaultCloudKeyPath, a.cfg.VaultCloudKeyField)
	if err != nil {
		return "", fmt.Errorf("reading platform cloud api key from vault: %w", err)
	}
	return key, nil
}

// TerraformApplyResult is what the module produced. Note again: no credential.
type TerraformApplyResult struct {
	NamespaceID      string `json:"namespaceId"`
	ServiceAccountID string `json:"serviceAccountId"`
}

// TerraformApply provisions one namespace and its worker identity.
func (a *Activities) TerraformApply(ctx context.Context, in EnvInput) (TerraformApplyResult, error) {
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
		Vars: map[string]any{
			"namespace_name": name,
			"region":         in.Spec.Region,
			"retention_days": in.Spec.RetentionDays,
			"tags":           in.Spec.Tags(in.Env, in.RunID),
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
func (a *Activities) TerraformDestroy(ctx context.Context, in EnvInput) error {
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

// MintKeyInput asks for a credential for a service account.
type MintKeyInput struct {
	EnvInput
	ServiceAccountID string `json:"serviceAccountId"`
	NamespaceID      string `json:"namespaceId"`
}

// MintKeyResult is the whole point of rule 2: a path and an id, never a token.
type MintKeyResult struct {
	VaultPath string `json:"vaultPath"`
	KeyID     string `json:"keyId"`
}

// MintNamespaceKey creates an API key for the namespace's worker identity and
// writes it to Vault.
//
// This activity is the reason the platform talks to the Cloud Ops API at all.
// Terraform could create this key -- and would put it in plaintext in remote
// state, and make rotation a state-surgery problem, and make `terraform destroy`
// revoke every worker's auth. So it does not.
func (a *Activities) MintNamespaceKey(ctx context.Context, in MintKeyInput) (MintKeyResult, error) {
	log := activity.GetLogger(ctx)

	apiKey, err := a.cloudAPIKey(ctx)
	if err != nil {
		return MintKeyResult{}, err
	}
	client, err := cloudops.New(apiKey)
	if err != nil {
		return MintKeyResult{}, err
	}
	defer client.Close()

	minted, err := client.MintServiceAccountKey(ctx, cloudops.MintInput{
		ServiceAccountID: in.ServiceAccountID,
		DisplayName:      fmt.Sprintf("%s-worker", in.PhysicalName()),
		Description:      fmt.Sprintf("Worker credential for %s. Minted by the platform reconciler; rotate by re-running it.", in.NamespaceID),
		TTL:              a.cfg.KeyTTL,
	})
	if err != nil {
		if cloudops.IsPermanent(err) {
			return MintKeyResult{}, temporal.NewNonRetryableApplicationError(
				err.Error(), "CloudOpsPermanent", err)
		}
		return MintKeyResult{}, err
	}

	path := a.cfg.SinkPath(in.EnvInput)
	if err := a.vault.Write(ctx, path, map[string]any{
		"api_key":      minted.Token,
		"key_id":       minted.KeyID,
		"namespace":    in.NamespaceID,
		"address":      "us-west-2.aws.api.temporal.io:7233",
		"owner":        in.Spec.Owner,
		"minted_at":    time.Now().UTC().Format(time.RFC3339),
		"minted_by":    "platform-reconciler",
		"expires_in_s": int(a.cfg.KeyTTL.Seconds()),
	}); err != nil {
		// The key exists in the Cloud but we could not store it. Revoke it rather
		// than leaking a credential nobody can use or find.
		if delErr := client.DeleteAPIKey(ctx, minted.KeyID); delErr != nil {
			log.Error("orphaned api key: could not write to vault and could not revoke",
				"keyId", minted.KeyID, "revokeError", delErr)
		}
		return MintKeyResult{}, fmt.Errorf("writing minted key to vault: %w", err)
	}

	log.Info("minted namespace credential", "namespace", in.NamespaceID, "vaultPath", path, "keyId", minted.KeyID)
	return MintKeyResult{VaultPath: path, KeyID: minted.KeyID}, nil
}

// DriftReport is what the Cloud says, as opposed to what we last told it.
type DriftReport struct {
	Env      string `json:"env"`
	Drifted  bool   `json:"drifted"`
	Detail   string `json:"detail,omitempty"`
	Missing  bool   `json:"missing"`
	Observed int    `json:"observedRetentionDays"`
}

// DetectDrift asks the Cloud Ops API what is actually true.
//
// Deliberately not `terraform plan`: a plan needs the state, and comparing
// against live truth catches the case a plan cannot -- somebody changed retention
// in the Cloud UI, or deleted the namespace outright.
func (a *Activities) DetectDrift(ctx context.Context, in EnvInput) (DriftReport, error) {
	apiKey, err := a.cloudAPIKey(ctx)
	if err != nil {
		return DriftReport{}, err
	}
	client, err := cloudops.New(apiKey)
	if err != nil {
		return DriftReport{}, err
	}
	defer client.Close()

	// The Ops API wants the fully qualified namespace id, which the module output
	// gave us; fall back to the bare physical name when we have not applied yet.
	state, err := client.DescribeNamespace(ctx, in.PhysicalName())
	if err != nil {
		return DriftReport{}, err
	}

	rep := DriftReport{Env: in.Env, Observed: state.RetentionDays}
	switch {
	case !state.Exists:
		rep.Drifted, rep.Missing = true, true
		rep.Detail = fmt.Sprintf("namespace %s does not exist", in.PhysicalName())
	case state.RetentionDays != in.Spec.RetentionDays:
		rep.Drifted = true
		rep.Detail = fmt.Sprintf("retention is %d days, spec asks for %d",
			state.RetentionDays, in.Spec.RetentionDays)
	}
	return rep, nil
}

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
