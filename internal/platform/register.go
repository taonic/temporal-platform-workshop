package platform

import "go.temporal.io/sdk/worker"

// Register wires every workflow and activity onto a worker.
//
// Keeping this in one function means the platform worker's main() has nothing in
// it to get wrong, and a student adding a workflow has exactly one place to add it.
func Register(w worker.Worker, a *Activities) {
	// Imperative driver -- challenge 1.
	w.RegisterWorkflow(ProvisionWorkflow)

	// Declarative driver -- challenge 3. Same children, same activities.
	w.RegisterWorkflow(NamespaceWorkflow)

	// One per resource. The workflow id is the lock.
	w.RegisterWorkflow(EnvironmentWorkflow)
	w.RegisterWorkflow(DestroyEnvironmentWorkflow)

	// Housekeeping that makes a self-paced cohort possible.

	w.RegisterActivity(a)
}
