package platform

import (
	"go.temporal.io/sdk/worker"

	"github.com/taonic/temporal-platform-workshop/internal/platform/activity"
	"github.com/taonic/temporal-platform-workshop/internal/platform/workflow"
)

// Register wires every workflow and activity onto a worker.
//
// This is the one function that needs both halves of the control plane, and for
// two challenges it is the only file you edit. Everything it names is already
// written: the workflows in internal/platform/workflow, the activities in
// internal/platform/activity. None of it runs until it is registered, because a
// worker only knows what it has been told about.
//
// That is the lesson hiding in a boring file. Registration is not bookkeeping --
// it is the boundary between code that exists and code that can be scheduled. An
// unregistered workflow does not fail loudly at startup; it fails at the moment
// something tries to start it, with "unable to find workflowType", which is one of
// the two or three errors you will actually meet in production.
func Register(w worker.Worker, a *activity.Activities) {
	// Provided. It is the mirror image of EnvironmentWorkflow and there is no
	// second lesson in it.
	w.RegisterWorkflow(workflow.DestroyEnvironmentWorkflow)

	// ---- Challenge 2 -------------------------------------------------------
	// ProvisionWorkflow is the imperative driver: one apply, then exit.
	// EnvironmentWorkflow is its child, one per environment.
	// Terraform creates the namespace and its identity; Key mints the credential.
	w.RegisterWorkflow(workflow.ProvisionWorkflow)
	w.RegisterWorkflow(workflow.EnvironmentWorkflow)
	w.RegisterActivity(a.Terraform)
	w.RegisterActivity(a.Key)

	// ---- Challenge 3 -------------------------------------------------------
	// NamespaceWorkflow is the declarative driver -- the same children and the
	// same activities, driven by a loop instead of by a command. Inspect is what
	// lets it ask the Cloud what is actually true, which is the half of
	// reconciliation a signal can never tell you.
	w.RegisterWorkflow(workflow.NamespaceWorkflow)
	w.RegisterActivity(a.Inspect)

	// The activity NAMES are unchanged by the three-receiver split -- the SDK
	// registers each exported method under its own name, not its receiver's -- so
	// running workflows keep replaying and test mocks keep matching.
}
