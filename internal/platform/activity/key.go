package activity

import (
	"context"
	"fmt"
	"time"

	// Aliased: this package is itself called activity, and two
	// different `activity.` prefixes in one file is a trap.
	sdkactivity "go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"

	"github.com/taonic/temporal-platform-workshop/internal/cloudops"
	"github.com/taonic/temporal-platform-workshop/internal/spec"
)

// KeyActivities are the rule 2 boundary. Everything here creates or destroys a
// live credential, so every failure path has to answer one question the other two
// receivers never face: did that leak?
//
// Rotation lands here when it lands -- RotateNamespaceKey and RevokeNamespaceKey
// are the same posture, and the ordering rule (mint, write, THEN revoke) is the
// same rule MintNamespaceKey already follows in miniature below.
type KeyActivities struct{ cloudCreds }

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
func (a *KeyActivities) MintNamespaceKey(ctx context.Context, in MintKeyInput) (MintKeyResult, error) {
	log := sdkactivity.GetLogger(ctx)

	client, err := a.cloudClient(ctx)
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
		"address":      spec.NamespaceEndpoint(in.NamespaceID),
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
