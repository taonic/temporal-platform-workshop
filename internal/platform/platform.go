// Package platform is the control plane's front door: the names a caller outside
// it uses, and the one function that needs both halves at once.
//
// The substance lives in two sibling packages, and the split is enforced by the
// compiler rather than by convention:
//
//	internal/platform/workflow   the control loop. Pure orchestration.
//	internal/platform/activity   the side effects, and the contract for them.
//
// Workflow code cannot reach a subprocess, a Vault client or the Cloud Ops API
// except by scheduling an activity. That used to be a comment; now it is an import
// graph.
//
// Everything below is a re-export. A CLI starting a reconciler writes
// platform.ReconcileInput and platform.NamespaceWorkflow -- which is the truth
// about what it is doing -- without having to know which half of the control plane
// defines them.
package platform

import (
	"github.com/taonic/temporal-platform-workshop/internal/platform/activity"
	"github.com/taonic/temporal-platform-workshop/internal/platform/workflow"
)

// TaskQueue is where the platform worker polls. One queue: the control plane is
// not big enough to need partitioning, and pretending otherwise would teach the
// wrong lesson about when to split queues.
//
// It lives here rather than in either half because both ends need it and neither
// owns it -- the worker registers against it, the CLI starts workflows on it.
const TaskQueue = "platform-control-plane"

// Types. Aliases, not wrappers, so a value crosses the boundary unconverted.
type (
	Config               = activity.Config
	Activities           = activity.Activities
	ReconcileInput       = activity.ReconcileInput
	EnvInput             = activity.EnvInput
	TerraformApplyResult = activity.TerraformApplyResult
	MintKeyInput         = activity.MintKeyInput
	MintKeyResult        = activity.MintKeyResult
	DriftReport          = activity.DriftReport

	EnvResult = workflow.EnvResult
	EnvStatus = workflow.EnvStatus
	Status    = workflow.Status
)

// Constructors and workflow entry points, at the addresses they have always had.
var (
	ConfigFromEnv = activity.ConfigFromEnv
	NewActivities = activity.New

	ProvisionWorkflow          = workflow.ProvisionWorkflow
	NamespaceWorkflow          = workflow.NamespaceWorkflow
	EnvironmentWorkflow        = workflow.EnvironmentWorkflow
	DestroyEnvironmentWorkflow = workflow.DestroyEnvironmentWorkflow

	NamespaceWorkflowID   = workflow.NamespaceWorkflowID
	EnvironmentWorkflowID = workflow.EnvironmentWorkflowID
)

// Signal and query names. Intent arrives by signal; reality arrives by timer.
const (
	SignalApply   = workflow.SignalApply
	SignalDestroy = workflow.SignalDestroy
	QueryStatus   = workflow.QueryStatus

	DefaultDriftInterval = activity.DefaultDriftInterval
)
