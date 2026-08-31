// Package workflow is the control loop: the entity workflow that keeps one logical
// namespace matching its spec, and the children that provision each environment.
//
// Everything here is pure orchestration. The side effects live in the sibling
// activity package, and that is a package boundary rather than a convention --
// nothing in here can reach a subprocess, a Vault client or the Cloud Ops API
// except by scheduling an activity.
//
// A note on the name, because it reads oddly at first: this package is called
// workflow and so is go.temporal.io/sdk/workflow, which every file here imports.
// A package never refers to itself by name, so `workflow.Context` below always
// means the SDK's. The two never collide in practice, but it is worth knowing
// before you wonder.
package workflow

import (
	"time"

	"github.com/taonic/temporal-platform-workshop/internal/platform/activity"
	"github.com/taonic/temporal-platform-workshop/internal/spec"
)

// The activity contract, named here so that workflow code reads in its own
// vocabulary rather than reaching across the boundary for every type.
//
// Aliases, not wrappers: `=` means these ARE the activity package's types, so a
// value crosses the boundary with no conversion and a test mock matches by either
// name.
type (
	Config               = activity.Config
	ReconcileInput       = activity.ReconcileInput
	EnvInput             = activity.EnvInput
	TerraformApplyResult = activity.TerraformApplyResult
	MintKeyInput         = activity.MintKeyInput
	MintKeyResult        = activity.MintKeyResult
	DriftReport          = activity.DriftReport
)

// DefaultDriftInterval is used when the caller does not specify one.
const DefaultDriftInterval = activity.DefaultDriftInterval

// EnvResult is what an environment reconcile produced.
//
// Note what is not here: the API key. The mint activity writes the token to Vault
// and returns VaultPath. A token in this struct would be a token in the workflow's
// event history, readable by anyone who can see the workflow -- permanently, for
// the whole retention period. See DESIGN.md rule 2.
type EnvResult struct {
	Env              string `json:"env"`
	NamespaceID      string `json:"namespaceId"`
	ServiceAccountID string `json:"serviceAccountId"`
	VaultPath        string `json:"vaultPath"`
	KeyID            string `json:"keyId"`
}

// EnvStatus is the per-environment outcome the query handler exposes. Partial
// failure is a first-class outcome: prod can succeed while staging fails, and the
// student should be able to see exactly that.
type EnvStatus struct {
	Env         string     `json:"env"`
	NamespaceID string     `json:"namespaceId,omitempty"`
	VaultPath   string     `json:"vaultPath,omitempty"`
	OK          bool       `json:"ok"`
	Error       string     `json:"error,omitempty"`
	LastApplied *time.Time `json:"lastApplied,omitempty"`
}

// Status is the reconciler's query payload.
//
// Grading reads this. Cloud-side state can be checked through the Ops API, but
// platform *behaviour* -- did the loop notice the drift, did it correct it -- is
// only visible from workflow state. That is why the reconciler is a workflow and
// not a cron job.
type Status struct {
	Spec           spec.Spec   `json:"spec"`
	Username       string      `json:"username"`
	Generation     int         `json:"generation"`
	Environments   []EnvStatus `json:"environments"`
	Reconciles     int         `json:"reconciles"`
	DriftsDetected int         `json:"driftsDetected"`
	LastDrift      string      `json:"lastDrift,omitempty"`
	Destroying     bool        `json:"destroying"`
}

// Signal and query names. Intent arrives by signal; reality arrives by timer.
const (
	SignalApply   = "apply"
	SignalDestroy = "destroy"
	QueryStatus   = "status"
)

// actv exists only so workflow code can name activities type-safely
// (workflow.ExecuteActivity(ctx, actv.TerraformApply, ...)). It is never called
// through, so the nil receivers are fine -- the SDK only reflects on the method to
// read its name.
//
// Embedding is why every call site reads actv.TerraformApply rather than naming
// which of the three receivers it lives on. It has a second use: if two receivers
// ever declare the same method name, the promotion becomes ambiguous and this
// stops compiling -- which is exactly the globally-unique-activity-name rule
// Temporal already imposes, now enforced by the compiler instead of at runtime.
var actv struct {
	*activity.TerraformActivities
	*activity.KeyActivities
	*activity.InspectActivities
}
