// Package cloudops is the Temporal Cloud Ops API client the platform uses for the
// things Terraform must not do.
//
// There is exactly one reason this package exists, and it is worth stating
// plainly. temporalcloud_apikey exposes .token as a readable attribute, and
// `sensitive = true` masks CLI output without encrypting state. Minting API keys
// in Terraform would write a live credential in plaintext into remote state --
// which, in this workshop, is a volume on a single Fly machine.
//
// So keys are minted here instead. The activity that calls this writes the token
// straight to Vault and returns a Vault path, never the secret. One rule, three
// problems solved: nothing sensitive in state, nothing sensitive in workflow event
// history, and rotation stops being state surgery. See DESIGN.md rule 2.
package cloudops

import (
	"context"
	"fmt"
	"time"

	"go.temporal.io/cloud-sdk/api/cloudservice/v1"
	identity "go.temporal.io/cloud-sdk/api/identity/v1"
	"go.temporal.io/cloud-sdk/cloudclient"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Client struct {
	c *cloudclient.Client
}

// New builds a client from an API key. The key belongs to the platform's own
// service account, which holds the Developer role -- provably sufficient for
// everything the reconciler does, because Developer receives Namespace Admin on
// namespaces it creates, and Namespace Admin is exactly what is needed to manage
// namespace-scoped service accounts and mint their keys. See DESIGN.md rule 3.
func New(apiKey string) (*Client, error) {
	c, err := cloudclient.New(cloudclient.Options{APIKey: apiKey})
	if err != nil {
		return nil, fmt.Errorf("cloud ops client: %w", err)
	}
	return &Client{c: c}, nil
}

func (c *Client) Close() error { return c.c.Close() }

type MintInput struct {
	ServiceAccountID string
	DisplayName      string
	Description      string
	TTL              time.Duration
}

// MintOutput carries a live credential. It must not be returned from an activity
// -- see the package comment. Write it to Vault and hand back the path.
type MintOutput struct {
	KeyID string
	Token string
}

// MintServiceAccountKey creates an API key owned by a service account.
//
// Only the service-account owner type is supported by CreateApiKey, which
// happens to be exactly what the platform wants: a worker's credential should
// never belong to a person, because a key owned by a person dies with the person.
func (c *Client) MintServiceAccountKey(ctx context.Context, in MintInput) (MintOutput, error) {
	if in.ServiceAccountID == "" {
		return MintOutput{}, fmt.Errorf("service account id is required")
	}
	ttl := in.TTL
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}

	resp, err := c.c.CloudService().CreateApiKey(ctx, &cloudservice.CreateApiKeyRequest{
		Spec: &identity.ApiKeySpec{
			OwnerId:     in.ServiceAccountID,
			OwnerType:   identity.OwnerType_OWNER_TYPE_SERVICE_ACCOUNT,
			DisplayName: in.DisplayName,
			Description: in.Description,
			ExpiryTime:  timestamppb.New(time.Now().Add(ttl)),
		},
	})
	if err != nil {
		return MintOutput{}, fmt.Errorf("creating api key for %s: %w", in.ServiceAccountID, err)
	}
	return MintOutput{KeyID: resp.GetKeyId(), Token: resp.GetToken()}, nil
}

// DeleteAPIKey revokes a key. The reaper uses this.
func (c *Client) DeleteAPIKey(ctx context.Context, keyID string) error {
	_, err := c.c.CloudService().DeleteApiKey(ctx, &cloudservice.DeleteApiKeyRequest{
		KeyId: keyID,
	})
	if err != nil {
		return fmt.Errorf("deleting api key %s: %w", keyID, err)
	}
	return nil
}

// NamespaceState is the subset of a namespace the reconciler compares against the
// spec. This is how drift is detected: not by diffing Terraform, which would
// require a plan and a state lock, but by asking the Cloud what is actually true.
type NamespaceState struct {
	Exists        bool
	Name          string
	RetentionDays int
	Regions       []string
	State         string
}

func (c *Client) DescribeNamespace(ctx context.Context, namespace string) (NamespaceState, error) {
	resp, err := c.c.CloudService().GetNamespace(ctx, &cloudservice.GetNamespaceRequest{
		Namespace: namespace,
	})
	if err != nil {
		// A namespace that is not there is an answer, not a failure: it is the
		// drift case where somebody deleted it behind the platform's back.
		if isNotFound(err) {
			return NamespaceState{Exists: false, Name: namespace}, nil
		}
		return NamespaceState{}, fmt.Errorf("describing namespace %s: %w", namespace, err)
	}
	ns := resp.GetNamespace()
	spec := ns.GetSpec()
	return NamespaceState{
		Exists:        true,
		Name:          spec.GetName(),
		RetentionDays: int(spec.GetRetentionDays()),
		Regions:       spec.GetRegions(),
		State:         ns.GetState().String(),
	}, nil
}
