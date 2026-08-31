package tfexec

import "fmt"

// Backend is a terraform state backend.
//
// Note what is missing from every implementation: lock endpoints. Terraform's
// http backend treats locking as optional, and the platform does not want it --
// the reconciler's workflow id IS the resource identity, so Temporal's
// workflow-id uniqueness constraint already guarantees a single writer per
// resource. There is no lock table, no lease, and no `terraform force-unlock`
// runbook, because a second concurrent writer cannot exist. See DESIGN.md rule 1.
type Backend interface {
	// BlockName is the terraform backend type, as it appears in `backend "x" {}`.
	BlockName() string
	// ConfigArgs are the -backend-config=key=value arguments for `terraform init`.
	ConfigArgs() []string
}

// LocalBackend keeps state in a file, and is what the workshop uses. Not a
// production choice -- but it is the only backend a student can debug with `cat`,
// it needs no service to be up and no credential to be handed out, and sandbox
// egress failures were the single most common workshop complaint.
type LocalBackend struct {
	Path string
}

func (b LocalBackend) BlockName() string { return "local" }
func (b LocalBackend) ConfigArgs() []string {
	return []string{"-backend-config=path=" + b.Path}
}

// S3Backend exists to prove the interface is real rather than a single
// implementation wearing a costume. It is what temporal-terraform-demo used.
type S3Backend struct {
	Bucket string
	Key    string
	Region string
}

func (b S3Backend) BlockName() string { return "s3" }
func (b S3Backend) ConfigArgs() []string {
	return []string{
		"-backend-config=bucket=" + b.Bucket,
		"-backend-config=key=" + b.Key,
		"-backend-config=region=" + b.Region,
	}
}

// BackendHCL renders the backend block that has to exist in the configuration
// before `terraform init` will accept -backend-config arguments.
func BackendHCL(b Backend) string {
	return fmt.Sprintf("terraform {\n  backend %q {}\n}\n", b.BlockName())
}
