// Package tfworkspace materialises an embedded terraform module into a scratch
// directory, runs it, and throws the directory away.
//
// Ported from temporal-terraform-demo. The reason a workspace is disposable is
// that the activity may run on any worker in the fleet, and the only durable
// thing is the state backend.
package tfworkspace

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"

	"github.com/taonic/temporal-platform-workshop/internal/tfexec"
)

type Config struct {
	// ModulePath is the directory inside FS to extract, e.g. "namespace".
	ModulePath string
	// FS holds the embedded modules.
	FS embed.FS
	// Backend is where state lives for this particular resource.
	Backend tfexec.Backend
	// OnOutput receives every terraform output line.
	OnOutput func(string)
}

type ApplyInput struct {
	// Env is added to terraform's environment. The Cloud API key travels here and
	// nowhere else -- not a variable, not a file, not the workflow's arguments.
	Env map[string]string
	// Vars becomes terraform.tfvars.json.
	Vars map[string]any
	// AttemptImport maps resource address -> real resource id, tried before apply
	// and ignoring errors.
	//
	// This is the demo's best trick and it matters more here than it did there. A
	// successful apply whose state write then fails leaves real resources that
	// state has never heard of; the next attempt would try to create them again
	// and fail on a name conflict. Importing first re-adopts them. The workshop's
	// state service is a single machine, which makes that window wider than the
	// original S3 design's, so this is not theoretical.
	AttemptImport map[string]string
}

type ApplyOutput struct {
	Output map[string]any
}

type DestroyInput struct {
	Env map[string]string
}

type Workspace struct {
	cfg Config
}

func New(cfg Config) *Workspace { return &Workspace{cfg: cfg} }

func (w *Workspace) Apply(ctx context.Context, in ApplyInput) (ApplyOutput, error) {
	workDir, err := os.MkdirTemp("", "tf-apply-")
	if err != nil {
		return ApplyOutput{}, fmt.Errorf("creating workspace: %w", err)
	}
	defer os.RemoveAll(workDir)

	if err := extractModule(w.cfg.FS, w.cfg.ModulePath, workDir); err != nil {
		return ApplyOutput{}, err
	}
	if err := writeBackend(workDir, w.cfg.Backend); err != nil {
		return ApplyOutput{}, err
	}

	tf, err := w.init(ctx, workDir)
	if err != nil {
		return ApplyOutput{}, err
	}

	if err := writeVars(tf.VarsFile(), in.Vars); err != nil {
		return ApplyOutput{}, err
	}

	// Errors are intentionally ignored: an import that fails usually means there
	// was nothing to adopt, which is the normal case.
	for address, id := range in.AttemptImport {
		_ = tf.Import(ctx, tfexec.ImportParams{Env: in.Env, Address: address, ID: id})
		if ctx.Err() != nil {
			return ApplyOutput{}, ctx.Err()
		}
	}

	if err := tf.Apply(ctx, tfexec.ApplyParams{Env: in.Env}); err != nil {
		return ApplyOutput{}, err
	}

	out, err := tf.Output(ctx, in.Env)
	if err != nil {
		return ApplyOutput{}, err
	}
	return ApplyOutput{Output: out}, nil
}

// Destroy extracts only versions.tf, leaving an empty configuration, so terraform
// plans the removal of everything in state. Every module must therefore keep its
// required_providers block in versions.tf.
func (w *Workspace) Destroy(ctx context.Context, in DestroyInput) error {
	workDir, err := os.MkdirTemp("", "tf-destroy-")
	if err != nil {
		return fmt.Errorf("creating workspace: %w", err)
	}
	defer os.RemoveAll(workDir)

	versions, err := w.cfg.FS.ReadFile(path.Join(w.cfg.ModulePath, "versions.tf"))
	if err != nil {
		return fmt.Errorf("module %s has no versions.tf, which destroy needs for provider versions: %w",
			w.cfg.ModulePath, err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "versions.tf"), versions, 0o644); err != nil {
		return err
	}
	if err := writeBackend(workDir, w.cfg.Backend); err != nil {
		return err
	}

	tf, err := w.init(ctx, workDir)
	if err != nil {
		return err
	}
	// No variables: with an empty configuration, none are declared, and terraform
	// rejects values for undeclared variables.
	return tf.Destroy(ctx, in.Env)
}

func (w *Workspace) init(ctx context.Context, workDir string) (*tfexec.Terraform, error) {
	var opts []tfexec.Option
	if w.cfg.OnOutput != nil {
		opts = append(opts, tfexec.WithOutput(w.cfg.OnOutput))
	}
	tf, err := tfexec.New(workDir, opts...)
	if err != nil {
		return nil, err
	}
	if err := tf.Init(ctx, w.cfg.Backend); err != nil {
		return nil, err
	}
	return tf, nil
}

func extractModule(efs embed.FS, modulePath, dest string) error {
	entries, err := fs.ReadDir(efs, modulePath)
	if err != nil {
		return fmt.Errorf("reading embedded module %s: %w", modulePath, err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := efs.ReadFile(path.Join(modulePath, e.Name()))
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dest, e.Name()), data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func writeBackend(dest string, b tfexec.Backend) error {
	return os.WriteFile(filepath.Join(dest, "backend.tf"), []byte(tfexec.BackendHCL(b)), 0o644)
}

func writeVars(path string, vars map[string]any) error {
	if len(vars) == 0 {
		return nil
	}
	data, err := json.MarshalIndent(vars, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}
