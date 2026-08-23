// Package vaultkv is a deliberately small Vault KV v2 client.
//
// Vault has two jobs in this platform, and only the second one makes it worth a
// dependency:
//
//   - Source: it holds the platform's own Temporal Cloud API key, which the
//     reconciler reads so Terraform can authenticate.
//   - Sink: it receives the namespace API keys the platform mints, so a developer
//     can read a credential the platform created for them.
//
// Source alone would be "environment variables with extra steps". The sink is
// what turns terraform-in-a-workflow into a platform.
package vaultkv

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	// DefaultMount is the KV v2 mount the sandbox sets up.
	DefaultMount = "secret"
	// KubernetesJWTPath is where a pod finds its projected service account token.
	KubernetesJWTPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
)

type Client struct {
	addr  string
	token string
	mount string
	http  *http.Client
}

func New(addr, token, mount string) *Client {
	if mount == "" {
		mount = DefaultMount
	}
	return &Client{
		addr:  strings.TrimRight(addr, "/"),
		token: token,
		mount: mount,
		http:  &http.Client{Timeout: 15 * time.Second},
	}
}

// FromEnv builds a client from VAULT_ADDR / VAULT_TOKEN, falling back to
// Kubernetes auth when there is no token but there is a projected JWT.
//
// That fallback is the whole point of the k3s challenge: the root token that
// worked from a shell does not exist inside a pod, and the fix is a ServiceAccount
// plus a Vault role rather than copying a secret into a manifest.
func FromEnv(ctx context.Context) (*Client, error) {
	addr := os.Getenv("VAULT_ADDR")
	if addr == "" {
		return nil, fmt.Errorf("VAULT_ADDR is not set")
	}
	mount := os.Getenv("VAULT_KV_MOUNT")

	if tok := os.Getenv("VAULT_TOKEN"); tok != "" {
		return New(addr, tok, mount), nil
	}

	role := os.Getenv("VAULT_K8S_ROLE")
	if role == "" {
		return nil, fmt.Errorf("no VAULT_TOKEN and no VAULT_K8S_ROLE: nothing to authenticate with")
	}
	jwt, err := os.ReadFile(KubernetesJWTPath)
	if err != nil {
		return nil, fmt.Errorf("reading projected service account token: %w", err)
	}
	c := New(addr, "", mount)
	tok, err := c.loginKubernetes(ctx, role, strings.TrimSpace(string(jwt)))
	if err != nil {
		return nil, err
	}
	c.token = tok
	return c, nil
}

// Write stores data at the given KV v2 path.
func (c *Client) Write(ctx context.Context, path string, data map[string]any) error {
	body, err := json.Marshal(map[string]any{"data": data})
	if err != nil {
		return err
	}
	url := fmt.Sprintf("%s/v1/%s/data/%s", c.addr, c.mount, strings.TrimLeft(path, "/"))
	_, err = c.do(ctx, http.MethodPut, url, body)
	return err
}

// Read returns the data stored at a KV v2 path.
func (c *Client) Read(ctx context.Context, path string) (map[string]any, error) {
	url := fmt.Sprintf("%s/v1/%s/data/%s", c.addr, c.mount, strings.TrimLeft(path, "/"))
	raw, err := c.do(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Data struct {
			Data map[string]any `json:"data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("parsing vault response: %w", err)
	}
	return parsed.Data.Data, nil
}

// ReadString is the common case: one field out of one secret.
func (c *Client) ReadString(ctx context.Context, path, field string) (string, error) {
	data, err := c.Read(ctx, path)
	if err != nil {
		return "", err
	}
	v, ok := data[field]
	if !ok {
		return "", fmt.Errorf("vault path %s has no field %q", path, field)
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("vault path %s field %q is not a string", path, field)
	}
	return s, nil
}

func (c *Client) loginKubernetes(ctx context.Context, role, jwt string) (string, error) {
	body, err := json.Marshal(map[string]string{"role": role, "jwt": jwt})
	if err != nil {
		return "", err
	}
	raw, err := c.do(ctx, http.MethodPost, c.addr+"/v1/auth/kubernetes/login", body)
	if err != nil {
		return "", fmt.Errorf("vault kubernetes login as role %q: %w", role, err)
	}
	var parsed struct {
		Auth struct {
			ClientToken string `json:"client_token"`
		} `json:"auth"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	if parsed.Auth.ClientToken == "" {
		return "", fmt.Errorf("vault kubernetes login returned no token")
	}
	return parsed.Auth.ClientToken, nil
}

func (c *Client) do(ctx context.Context, method, url string, body []byte) ([]byte, error) {
	var rdr *bytes.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rdr)
	if err != nil {
		return nil, err
	}
	if c.token != "" {
		req.Header.Set("X-Vault-Token", c.token)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	out := new(bytes.Buffer)
	if _, err := out.ReadFrom(resp.Body); err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("vault %s %s: %s: %s", method, url, resp.Status, truncate(out.String(), 200))
	}
	return out.Bytes(), nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
