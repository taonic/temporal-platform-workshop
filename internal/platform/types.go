// Package platform is the control plane: the workflows and activities that turn a
// committed spec into real Temporal Cloud resources.
package platform

import (
	"time"

	"github.com/taonic/temporal-platform-workshop/internal/spec"
)

// TaskQueue is where the platform worker polls. One queue: the control plane is
// not big enough to need partitioning, and pretending otherwise would teach the
// wrong lesson about when to split queues.
const TaskQueue = "platform-control-plane"

// ReconcileInput is everything the control plane needs to act on one spec.
//
// Spec is what the team asked for. Slot and Participant are platform-assigned and
// deliberately absent from the spec file: a team should not be able to pick its
// own slot, and the boundary between "what you asked for" and "what the platform
// decided" is the boundary the whole workshop is about.
type ReconcileInput struct {
	Spec        spec.Spec `json:"spec"`
	Slot        int       `json:"slot"`
	Participant string    `json:"participant"`
	RunID       string    `json:"runId"`

	// DriftIntervalSeconds is how often the reconciler asks the Cloud what is
	// actually true. It travels in the input rather than being read from worker
	// configuration so that a replay produces the same timers as the original
	// execution -- worker config can change between them, workflow input cannot.
	DriftIntervalSeconds int `json:"driftIntervalSeconds,omitempty"`
}

// DefaultDriftInterval is used when the caller does not specify one.
const DefaultDriftInterval = 2 * time.Minute

// DriftInterval is the timer period for this reconciler.
func (in ReconcileInput) DriftInterval() time.Duration {
	if in.DriftIntervalSeconds <= 0 {
		return DefaultDriftInterval
	}
	return time.Duration(in.DriftIntervalSeconds) * time.Second
}

// EnvInput provisions one environment of one spec.
type EnvInput struct {
	ReconcileInput
	Env string `json:"env"`
}

// PhysicalName is the namespace this environment will produce.
func (in EnvInput) PhysicalName() string {
	return in.Spec.PhysicalName(in.Slot, in.Env)
}

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
	Slot           int         `json:"slot"`
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
