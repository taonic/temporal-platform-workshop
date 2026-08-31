package activity

import (
	"context"
	"fmt"

	"go.temporal.io/sdk/temporal"
)

// InspectActivities read the Cloud and change nothing.
//
// That is what makes their failure posture different from the other two: a read
// that does not come back is not drift, and must not be treated as one. It is
// "ask again next tick". An InspectActivity that fails loudly would turn every
// transient Ops API hiccup into a pointless apply.
//
// Search-attribute divergence lands here -- it is a read, and the answer it
// produces is a report, not a repair.
type InspectActivities struct{ cloudCreds }

// DriftReport is what the Cloud says, as opposed to what we last told it.
type DriftReport struct {
	Env      string `json:"env"`
	Drifted  bool   `json:"drifted"`
	Detail   string `json:"detail,omitempty"`
	Missing  bool   `json:"missing"`
	Observed int    `json:"observedRetentionDays"`
}

// CheckQuota refuses an apply that would take the account past its namespace
// quota, and says so in those words.
//
// The workshop runs 15 students against 50 namespaces with five spare, so this is
// a real boundary rather than a theoretical one. The failure it prevents is the
// nastiest in the workshop: the Cloud's own quota error surfacing inside
// TerraformApply, blamed on the module, and landing on whoever applies next rather
// than on whoever consumed the last namespace.
//
// It is advisory by design -- a namespace that already exists is not a new one, so
// a re-apply is never blocked.
func (a *InspectActivities) CheckQuota(ctx context.Context, in EnvInput) error {
	if a.cfg.NamespaceQuota <= 0 {
		return nil
	}
	client, err := a.cloudClient(ctx)
	if err != nil {
		return err
	}
	defer client.Close()

	state, err := client.DescribeNamespace(ctx, in.PhysicalName())
	if err == nil && state.Exists {
		return nil // already ours; applying it consumes nothing new
	}

	used, err := client.CountNamespaces(ctx)
	if err != nil {
		// A quota check that cannot read the account should not stop the workshop.
		return nil
	}
	if used >= a.cfg.NamespaceQuota {
		return temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("the account is at its namespace quota (%d of %d used), so %s cannot be created. "+
				"This is not your Terraform. Someone needs to free a namespace -- most likely a student "+
				"who has not completed challenge 3's environment removal.",
				used, a.cfg.NamespaceQuota, in.PhysicalName()),
			"NamespaceQuotaExhausted", nil)
	}
	return nil
}

// DetectDrift asks the Cloud Ops API what is actually true.
//
// Deliberately not `terraform plan`: a plan needs the state, and comparing
// against live truth catches the case a plan cannot -- somebody changed retention
// in the Cloud UI, or deleted the namespace outright.
func (a *InspectActivities) DetectDrift(ctx context.Context, in EnvInput) (DriftReport, error) {
	client, err := a.cloudClient(ctx)
	if err != nil {
		return DriftReport{}, err
	}
	defer client.Close()

	// The physical name, bare. cloudops qualifies it with the account id read from
	// the API key -- see Client.qualify, which exists because the Cloud API answers
	// a bare name with NOT FOUND rather than an error, and "not found" is a
	// legitimate answer here. Passing a bare name straight through reported every
	// namespace as missing, on every tick, forever.
	state, err := client.DescribeNamespace(ctx, in.PhysicalName())
	if err != nil {
		return DriftReport{}, err
	}

	rep := DriftReport{Env: in.Env, Observed: state.RetentionDays}
	switch {
	case !state.Exists:
		rep.Drifted, rep.Missing = true, true
		rep.Detail = fmt.Sprintf("namespace %s does not exist", in.PhysicalName())
	case state.RetentionDays != in.Spec.RetentionDays:
		rep.Drifted = true
		rep.Detail = fmt.Sprintf("retention is %d days, spec asks for %d",
			state.RetentionDays, in.Spec.RetentionDays)
	}
	return rep, nil
}
