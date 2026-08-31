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
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"go.temporal.io/cloud-sdk/api/cloudservice/v1"
	identity "go.temporal.io/cloud-sdk/api/identity/v1"
	"go.temporal.io/cloud-sdk/cloudclient"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Client struct {
	c *cloudclient.Client
	// accountID qualifies bare namespace names. See qualify.
	accountID string
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
	// Ignoring the error: a key we cannot parse still authenticates fine for
	// everything that does not need to qualify a name, and qualify() reports the
	// problem where it actually matters.
	acct, _ := AccountIDFromKey(apiKey)
	return &Client{c: c, accountID: acct}, nil
}

// AccountIDFromKey reads the account_id claim out of a Cloud API key.
//
// Exported because tpctl needs it too: a namespace is only addressable as
// <name>.<account-id>, on the data plane exactly as on the Ops API, and a
// manifest that sets a bare TEMPORAL_NAMESPACE produces a worker that connects
// and is then told "Request unauthorized".
//
// The key is a JWT and the claim is right there, so this needs no extra round
// trip and no configuration. scripts/workshop does the same thing in Python for
// the same reason. Not verifying the signature on purpose: this is not an
// authorisation decision, it is reading the account the key already belongs to --
// the server checks the signature on every call we make with it.
func AccountIDFromKey(apiKey string) (string, error) {
	parts := strings.Split(apiKey, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("api key is not a JWT")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decoding api key claims: %w", err)
	}
	var claims struct {
		AccountID string `json:"account_id"`
	}
	if err := json.Unmarshal(raw, &claims); err != nil {
		return "", fmt.Errorf("parsing api key claims: %w", err)
	}
	if claims.AccountID == "" {
		return "", fmt.Errorf("api key has no account_id claim")
	}
	return claims.AccountID, nil
}

// qualify turns ws-me-orders-staging into ws-me-orders-staging.acct1.
//
// Every Cloud API call takes the fully qualified Namespace ID, and a bare name
// does not error -- it comes back NOT FOUND. That distinction is the whole reason
// this function exists. DescribeNamespace treats not-found as "the namespace does
// not exist", which is a legitimate answer to a legitimate question, so passing a
// bare name produced a confident, wrong "it is gone" on every call. In the
// reconciler that meant drift on every timer tick, and a child workflow started
// every two minutes to fix a namespace that was never broken.
func (c *Client) qualify(namespace string) (string, error) {
	if strings.Contains(namespace, ".") {
		return namespace, nil
	}
	if c.accountID == "" {
		return "", fmt.Errorf(
			"cannot qualify namespace %q: the account id could not be read from the API key, "+
				"and the Cloud API rejects a bare namespace name as not found", namespace)
	}
	return namespace + "." + c.accountID, nil
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

// CountNamespaces returns how many namespaces exist in the account.
//
// The workshop runs against a fixed quota with only a few spare, so an apply that
// would exceed it has to fail with the real cause. Without this the Cloud's own
// error arrives from inside a Terraform activity, where it reads as "my module is
// wrong" and sends a student debugging their own HCL.
func (c *Client) CountNamespaces(ctx context.Context) (int, error) {
	var total int
	var page string
	for {
		resp, err := c.c.CloudService().GetNamespaces(ctx, &cloudservice.GetNamespacesRequest{
			PageToken: page,
		})
		if err != nil {
			return 0, fmt.Errorf("listing namespaces: %w", err)
		}
		total += len(resp.GetNamespaces())
		page = resp.GetNextPageToken()
		if page == "" {
			return total, nil
		}
	}
}

func (c *Client) DescribeNamespace(ctx context.Context, namespace string) (NamespaceState, error) {
	qualified, err := c.qualify(namespace)
	if err != nil {
		return NamespaceState{}, err
	}
	resp, err := c.c.CloudService().GetNamespace(ctx, &cloudservice.GetNamespaceRequest{
		Namespace: qualified,
	})
	if err != nil {
		// A namespace that is not there is an answer, not a failure: it is the
		// drift case where somebody deleted it behind the platform's back.
		if isNotFound(err) {
			return NamespaceState{Exists: false, Name: qualified}, nil
		}
		return NamespaceState{}, fmt.Errorf("describing namespace %s: %w", qualified, err)
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
