package activity

import (
	"context"
	"fmt"

	"github.com/taonic/temporal-platform-workshop/internal/cloudops"
	"github.com/taonic/temporal-platform-workshop/internal/vaultkv"
)

// cloudCreds is the single dependency all three receivers share: the platform's
// own Cloud credential, read fresh from Vault on every use.
//
// Reading it fresh rather than caching it at worker start is what makes rotation a
// non-event: revoke the old key, write the new one, and the next activity attempt
// picks it up. A cached credential turns rotation into a deploy.
type cloudCreds struct {
	cfg   Config
	vault *vaultkv.Client
}

func (c cloudCreds) cloudAPIKey(ctx context.Context) (string, error) {
	key, err := c.vault.ReadString(ctx, c.cfg.VaultCloudKeyPath, c.cfg.VaultCloudKeyField)
	if err != nil {
		return "", fmt.Errorf("reading platform cloud api key from vault: %w", err)
	}
	return key, nil
}

// cloudClient dials the Ops API with a freshly read key. Three activities were
// each open-coding these six lines.
func (c cloudCreds) cloudClient(ctx context.Context) (*cloudops.Client, error) {
	key, err := c.cloudAPIKey(ctx)
	if err != nil {
		return nil, err
	}
	return cloudops.New(key)
}

// Activities is the set the worker registers. One constructor for main() to call,
// one value for Register to take apart.
type Activities struct {
	Terraform *TerraformActivities
	Key       *KeyActivities
	Inspect   *InspectActivities
}

// New builds every receiver over one shared credential source.
func New(cfg Config, vault *vaultkv.Client) *Activities {
	c := cloudCreds{cfg: cfg, vault: vault}
	return &Activities{
		Terraform: &TerraformActivities{c},
		Key:       &KeyActivities{c},
		Inspect:   &InspectActivities{c},
	}
}
