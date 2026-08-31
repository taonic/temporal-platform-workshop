package workflow

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"

	"github.com/taonic/temporal-platform-workshop/internal/spec"
)

func testInput() ReconcileInput {
	return ReconcileInput{
		Spec: spec.Spec{
			Name: "orders", Owner: "payments-team", Tier: spec.TierStandard,
			RetentionDays: 7, Region: "aws-us-east-1",
			Environments: []string{spec.EnvStaging, spec.EnvProd},
			StateBackend: spec.BackendLocal,
		},
		Username:             "tester",
		Cohort:               "test-cohort",
		RunID:                "run-test",
		DriftIntervalSeconds: 60,
	}
}

// mockHappyPath makes terraform and the Cloud Ops API succeed without touching
// either. The activities are the only place that talks to the world, so mocking
// them is enough to exercise every line of orchestration.
func mockHappyPath(env *testsuite.TestWorkflowEnvironment) {
	env.OnActivity(actv.TerraformApply, mock.Anything, mock.Anything).Return(
		func(_ context.Context, in EnvInput) (TerraformApplyResult, error) {
			return TerraformApplyResult{
				NamespaceID:      in.PhysicalName() + ".acct1",
				ServiceAccountID: "sa-" + in.Env,
			}, nil
		})
	env.OnActivity(actv.MintNamespaceKey, mock.Anything, mock.Anything).Return(
		func(_ context.Context, in MintKeyInput) (MintKeyResult, error) {
			return MintKeyResult{
				VaultPath: "namespaces/p-test/orders/" + in.Env,
				KeyID:     "key-" + in.Env,
			}, nil
		})
}

func newEnv(s *testsuite.WorkflowTestSuite) *testsuite.TestWorkflowEnvironment {
	env := s.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(EnvironmentWorkflow)
	env.RegisterWorkflow(DestroyEnvironmentWorkflow)
	// The reconciler registers itself with its participant's reaper on start. In a
	// real deployment a missing reaper is tolerated; in the test env an unmocked
	// external signal panics, so mock it explicitly.
	env.OnSignalExternalWorkflow(mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(nil).Maybe()
	return env
}

// The imperative driver from challenge 1.
func TestProvisionWorkflowFansOutPerEnvironment(t *testing.T) {
	var s testsuite.WorkflowTestSuite
	env := newEnv(&s)
	mockHappyPath(env)

	env.ExecuteWorkflow(ProvisionWorkflow, testInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var statuses []EnvStatus
	require.NoError(t, env.GetWorkflowResult(&statuses))
	require.Len(t, statuses, 2)

	for _, st := range statuses {
		require.True(t, st.OK, "environment %s failed: %s", st.Env, st.Error)
		require.Contains(t, st.NamespaceID, "ws-7-orders-"+st.Env)
		// The credential is a path, never a token. This assertion is the one that
		// would fail if somebody "helpfully" returned the key from the activity.
		require.Equal(t, "namespaces/p-test/orders/"+st.Env, st.VaultPath)
	}
}

// Partial failure is a first-class outcome: prod succeeds, staging does not, and
// the caller sees both rather than one opaque error.
func TestProvisionWorkflowReportsPartialFailure(t *testing.T) {
	var s testsuite.WorkflowTestSuite
	env := newEnv(&s)

	env.OnActivity(actv.TerraformApply, mock.Anything, mock.Anything).Return(
		func(_ context.Context, in EnvInput) (TerraformApplyResult, error) {
			if in.Env == spec.EnvStaging {
				return TerraformApplyResult{}, errNonRetryable("namespace name already taken")
			}
			return TerraformApplyResult{
				NamespaceID:      in.PhysicalName() + ".acct1",
				ServiceAccountID: "sa-" + in.Env,
			}, nil
		})
	env.OnActivity(actv.MintNamespaceKey, mock.Anything, mock.Anything).Return(
		MintKeyResult{VaultPath: "namespaces/p-test/orders/prod", KeyID: "key-prod"}, nil)

	env.ExecuteWorkflow(ProvisionWorkflow, testInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError(), "one failed environment must not fail the whole provision")

	var statuses []EnvStatus
	require.NoError(t, env.GetWorkflowResult(&statuses))

	byEnv := map[string]EnvStatus{}
	for _, st := range statuses {
		byEnv[st.Env] = st
	}
	require.False(t, byEnv[spec.EnvStaging].OK)
	require.True(t, byEnv[spec.EnvProd].OK)
}

// The declarative driver from challenge 3: reality arrives by timer.
func TestReconcilerDetectsAndCorrectsDrift(t *testing.T) {
	var s testsuite.WorkflowTestSuite
	env := newEnv(&s)
	mockHappyPath(env)

	// First drift check reports somebody changed retention behind the platform's
	// back; later checks are clean.
	calls := 0
	env.OnActivity(actv.DetectDrift, mock.Anything, mock.Anything).Return(
		func(_ context.Context, in EnvInput) (DriftReport, error) {
			calls++
			if calls <= 2 && in.Env == spec.EnvStaging {
				return DriftReport{
					Env:      in.Env,
					Drifted:  true,
					Detail:   "retention is 30 days, spec asks for 7",
					Observed: 30,
				}, nil
			}
			return DriftReport{Env: in.Env, Observed: 7}, nil
		})

	// Once the loop has had time to tick, read the query and then shut it down.
	env.RegisterDelayedCallback(func() {
		enc, err := env.QueryWorkflow(QueryStatus)
		require.NoError(t, err)

		var st Status
		require.NoError(t, enc.Get(&st))
		require.GreaterOrEqual(t, st.DriftsDetected, 1, "the timer tick should have caught the drift")
		require.Contains(t, st.LastDrift, "retention is 30 days")
		require.GreaterOrEqual(t, st.Reconciles, 2, "detecting drift must trigger another reconcile")

		env.SignalWorkflow(SignalDestroy, nil)
	}, 3*time.Minute)

	env.ExecuteWorkflow(NamespaceWorkflow, testInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}

// Intent arrives by signal -- but an unchanged spec is not intent. Without the
// fingerprint check, the post-commit hook firing on an unrelated commit would
// re-apply every namespace in the repo.
func TestReconcilerIgnoresAnApplyThatChangesNothing(t *testing.T) {
	var s testsuite.WorkflowTestSuite
	env := newEnv(&s)
	mockHappyPath(env)
	env.OnActivity(actv.DetectDrift, mock.Anything, mock.Anything).Return(
		DriftReport{Env: spec.EnvStaging, Observed: 7}, nil)

	in := testInput()

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalApply, in) // identical spec
	}, 10*time.Second)

	env.RegisterDelayedCallback(func() {
		enc, err := env.QueryWorkflow(QueryStatus)
		require.NoError(t, err)
		var st Status
		require.NoError(t, enc.Get(&st))
		require.Equal(t, 1, st.Reconciles, "an unchanged spec must not trigger a reconcile")
		require.Equal(t, 1, st.Generation)
		env.SignalWorkflow(SignalDestroy, nil)
	}, 30*time.Second)

	env.ExecuteWorkflow(NamespaceWorkflow, in)
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}

// Convergence means removing what is no longer wanted, not only adding what is.
func TestReconcilerDestroysAnEnvironmentRemovedFromTheSpec(t *testing.T) {
	var s testsuite.WorkflowTestSuite
	env := newEnv(&s)
	mockHappyPath(env)
	env.OnActivity(actv.DetectDrift, mock.Anything, mock.Anything).Return(
		DriftReport{Observed: 7}, nil)

	destroyed := make(chan string, 4)
	env.OnActivity(actv.TerraformDestroy, mock.Anything, mock.Anything).Return(
		func(_ context.Context, in EnvInput) error {
			destroyed <- in.Env
			return nil
		})

	// Start with both environments, then remove one. Starting with the shrunk
	// spec would prove nothing: there would be no staging to prune.
	shrunk := testInput()
	shrunk.Spec.Environments = []string{spec.EnvProd}

	env.RegisterDelayedCallback(func() {
		env.SignalWorkflow(SignalApply, shrunk)
	}, 10*time.Second)

	env.RegisterDelayedCallback(func() {
		enc, err := env.QueryWorkflow(QueryStatus)
		require.NoError(t, err)
		var st Status
		require.NoError(t, enc.Get(&st))
		require.Len(t, st.Environments, 1, "staging should have been pruned")
		require.Equal(t, spec.EnvProd, st.Environments[0].Env)
		env.SignalWorkflow(SignalDestroy, nil)
	}, 40*time.Second)

	env.ExecuteWorkflow(NamespaceWorkflow, testInput())
	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
	require.Equal(t, spec.EnvStaging, <-destroyed, "the environment removed from the spec is the one destroyed")
}

// Namespace names are recyclable, which is why they are derived from the
// username rather than leased: see PhysicalName in internal/spec.
type nonRetryable struct{ msg string }

func (e nonRetryable) Error() string { return e.msg }

func errNonRetryable(msg string) error { return nonRetryable{msg} }
