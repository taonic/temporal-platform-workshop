// Package tfexec is a thin wrapper around the terraform binary.
//
// Ported from temporal-terraform-demo, with two changes: the state backend is an
// interface rather than hardwired S3, and output is streamed so an activity can
// heartbeat progress.
package tfexec

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
)

type Terraform struct {
	workDir  string
	bin      string
	onOutput func(string)
}

// Option configures a Terraform runner.
type Option func(*Terraform)

// WithOutput streams every terraform output line to fn. The reconciler passes a
// function that records it as a heartbeat detail.
func WithOutput(fn func(string)) Option {
	return func(t *Terraform) { t.onOutput = fn }
}

// New locates the terraform binary and prepares a runner for workDir.
func New(workDir string, opts ...Option) (*Terraform, error) {
	bin, err := exec.LookPath("terraform")
	if err != nil {
		return nil, fmt.Errorf("terraform not found on PATH: %w", err)
	}
	t := &Terraform{workDir: workDir, bin: bin}
	for _, o := range opts {
		o(t)
	}
	return t, nil
}

type ApplyParams struct {
	Env map[string]string
}

type ImportParams struct {
	Env     map[string]string
	Address string
	ID      string
}

// Init runs terraform init against the given backend.
func (t *Terraform) Init(ctx context.Context, b Backend) error {
	args := append([]string{"init", "-no-color", "-input=false", "-reconfigure"}, b.ConfigArgs()...)
	_, err := t.run(ctx, nil, args...)
	return err
}

// Apply runs terraform apply. Variables come from terraform.tfvars.json, which
// the workspace writes -- passing a map through -var means quoting HCL on a shell
// command line, which is a bug waiting for a tag with a space in it.
func (t *Terraform) Apply(ctx context.Context, p ApplyParams) error {
	_, err := t.run(ctx, p.Env, "apply", "-no-color", "-input=false", "-auto-approve")
	return err
}

// Destroy runs terraform destroy.
//
// The workspace deliberately extracts only versions.tf before calling this, so
// the configuration is empty and destroy removes everything the state knows
// about. That also means no variables are declared, so none may be passed.
func (t *Terraform) Destroy(ctx context.Context, env map[string]string) error {
	_, err := t.run(ctx, env, "destroy", "-no-color", "-input=false", "-auto-approve")
	return err
}

// Import adopts an existing resource into state. This is what makes a retried
// apply safe: see tfworkspace.ApplyInput.AttemptImport.
func (t *Terraform) Import(ctx context.Context, p ImportParams) error {
	_, err := t.run(ctx, p.Env, "import", "-no-color", "-input=false", p.Address, p.ID)
	return err
}

// Output reads the module's outputs.
func (t *Terraform) Output(ctx context.Context, env map[string]string) (map[string]any, error) {
	raw, err := t.run(ctx, env, "output", "-no-color", "-json")
	if err != nil {
		return nil, err
	}
	var parsed map[string]struct {
		Value any `json:"value"`
	}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, fmt.Errorf("parsing terraform output: %w", err)
	}
	out := make(map[string]any, len(parsed))
	for k, v := range parsed {
		out[k] = v.Value
	}
	return out, nil
}

// WorkDir is exposed for tests and for writing tfvars alongside the module.
func (t *Terraform) WorkDir() string { return t.workDir }

// VarsFile is where the workspace writes variables.
func (t *Terraform) VarsFile() string { return filepath.Join(t.workDir, "terraform.tfvars.json") }
