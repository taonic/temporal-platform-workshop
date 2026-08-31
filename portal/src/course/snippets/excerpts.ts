// Read-only excerpts. These are NOT the answer key and are never emitted -- they
// exist so a lab page can show the four or five lines where something interesting
// happens, instead of a whole file a student would scroll past.
//
// Each one is copied from the file named in its caption. They carry no `path`, so
// `snippets:emit` skips them and `verify` never compiles them; the files they are
// drawn from are ordinary committed source, compiled by `go build ./...` like
// everything else.

/** The spec, as a team writes it. specs/_example.yaml, minus the header. */
export const SPEC_EXAMPLE = `name: orders
owner: payments-team

# How long closed workflow histories stay queryable, 1 to 90 days. A cost
# decision and a compliance decision at the same time, which is why the team
# declares it here rather than inheriting a default nobody chose.
retentionDays: 7

region: aws-us-east-1
environments:
  - staging
  - prod`;

/** internal/platform/register.go -- the two lines challenge 2 turns on. */
export const REGISTER_CHALLENGE_2 = `// ---- Challenge 2 -------------------------------------------------------
w.RegisterWorkflow(workflow.ProvisionWorkflow)
w.RegisterWorkflow(workflow.EnvironmentWorkflow)
w.RegisterActivity(a.Terraform)
w.RegisterActivity(a.Key)`;

/** internal/platform/register.go -- what challenge 3 turns on. */
export const REGISTER_CHALLENGE_3 = `// ---- Challenge 3 -------------------------------------------------------
w.RegisterWorkflow(workflow.NamespaceWorkflow)
w.RegisterActivity(a.Inspect)`;

/**
 * internal/platform/workflow/environment.go -- the return, which is the whole
 * lesson of the child workflow.
 */
export const ENVIRONMENT_RETURN = `var minted MintKeyResult
mintIn := MintKeyInput{
	EnvInput:         in,
	ServiceAccountID: applied.ServiceAccountID,
	NamespaceID:      applied.NamespaceID,
}
if err := workflow.ExecuteActivity(ctx, actv.MintNamespaceKey, mintIn).Get(ctx, &minted); err != nil {
	// The namespace exists and is usable; only the credential is missing. Fail
	// the environment so the reconciler retries, and let the next apply adopt
	// the namespace via AttemptImport rather than recreating it.
	return EnvResult{
		Env:              in.Env,
		NamespaceID:      applied.NamespaceID,
		ServiceAccountID: applied.ServiceAccountID,
	}, err
}

return EnvResult{
	Env:              in.Env,
	NamespaceID:      applied.NamespaceID,
	ServiceAccountID: applied.ServiceAccountID,
	VaultPath:        minted.VaultPath,
	KeyID:            minted.KeyID,
}, nil`;

/**
 * internal/platform/workflow/environment.go -- the child, in full.
 *
 * The workflow id and the workflow itself, because a step that says "read the
 * child" should show the child rather than a helper next to it. Copied verbatim
 * from the file; the doc comments are left out only because the lab page repeats
 * them in its own words.
 */
export const ENVIRONMENT_WORKFLOW = `func EnvironmentWorkflowID(in EnvInput) string {
	return "ns-" + in.Spec.Name + "-" + in.Env
}

func EnvironmentWorkflow(ctx workflow.Context, in EnvInput) (EnvResult, error) {
	log := workflow.GetLogger(ctx)
	log.Info("reconciling environment", "namespace", in.PhysicalName())

	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		// A cold provider download plus a namespace create is minutes, not
		// seconds, so start-to-close is generous. It is the HEARTBEAT timeout that
		// detects a dead worker, and it is short: the activity beats every 5s and
		// the worker sends at most every 10s, so 30s is three missed beats.
		//
		// Short only because the worker caps its heartbeat throttle -- see
		// cmd/platform-worker/main.go. Without that the SDK would send every 24s
		// and 30s would be a single dropped RPC away from killing a healthy apply.
		StartToCloseTimeout: 30 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 1.5,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    8,
		},
	})

	var applied TerraformApplyResult
	if err := workflow.ExecuteActivity(ctx, actv.TerraformApply, in).Get(ctx, &applied); err != nil {
		return EnvResult{Env: in.Env}, err
	}

	var minted MintKeyResult
	mintIn := MintKeyInput{
		EnvInput:         in,
		ServiceAccountID: applied.ServiceAccountID,
		NamespaceID:      applied.NamespaceID,
	}
	if err := workflow.ExecuteActivity(ctx, actv.MintNamespaceKey, mintIn).Get(ctx, &minted); err != nil {
		// The namespace exists and is usable; only the credential is missing. Fail
		// the environment so the reconciler retries, and let the next apply adopt
		// the namespace via AttemptImport rather than recreating it.
		return EnvResult{
			Env:              in.Env,
			NamespaceID:      applied.NamespaceID,
			ServiceAccountID: applied.ServiceAccountID,
		}, err
	}

	return EnvResult{
		Env:              in.Env,
		NamespaceID:      applied.NamespaceID,
		ServiceAccountID: applied.ServiceAccountID,
		VaultPath:        minted.VaultPath,
		KeyID:            minted.KeyID,
	}, nil
}`;

/** internal/platform/workflow/wait.go -- the four lines the control loop turns on. */
export const WAIT_SELECT = `timer := workflow.NewTimer(ctx, after)
sel := workflow.NewSelector(ctx)

sel.AddReceive(applyCh, func(c workflow.ReceiveChannel, _ bool) {
	c.Receive(ctx, &incoming)
	event = eventApply
})
sel.AddReceive(destroyCh, func(c workflow.ReceiveChannel, _ bool) {
	c.Receive(ctx, nil)
	event = eventDestroy
})
sel.AddFuture(timer, func(workflow.Future) {
	event = eventTick
})

sel.Select(ctx)`;

/** internal/platform/workflow/reconciler.go -- signals carry intent, the timer catches reality. */
export const RECONCILER_SWITCH = `event, incoming := waitForNext(ctx, applyCh, destroyCh, desired.DriftInterval())

switch event {
case eventApply:
	// A spec that has not changed is not intent. Without this, the git hook
	// firing on an unrelated commit would re-apply every namespace in the repo.
	if desired.Spec.Fingerprint() == incoming.Spec.Fingerprint() {
		continue
	}
	desired = incoming
	status.Generation++
	reconcile()

case eventTick:
	drifted, detail := detectDrift(ctx, desired)
	if drifted {
		status.DriftsDetected++
		reconcile()
	}
}`;

/**
 * What `tpctl new --name orders` prints. Terminal output, not a file.
 *
 * A function because the physical name it reports contains the student's own
 * username, and a page that shows `ws-<you>-orders-staging` where the terminal
 * will say `ws-tao-orders-staging` is asking the reader to do a substitution the
 * portal could have done for them.
 */
export const tpctlNewOutput = (username: string): string => `  A namespace, provisioned properly.
  3 question(s). Press enter to accept the value in brackets.

  Name            orders  (from --name)
  Owner           payments-team
  Tier            [standard]
  Retention days  [7]

Wrote specs/orders.yaml

  namespaces     ws-${username}-orders-staging
  fingerprint    c980e5c34342bd92

Next:
  tpctl apply -f specs/orders.yaml      # provision it now
  git add specs && git commit           # or let the reconciler do it`;

/** worker/ -- who owns which half. Illustrative; not emitted. */
export const WORKER_LAYOUT = `worker/
  workflows/
    greeting.py          <- you write this. Decorated workflows, and nothing else.

  platform_sdk/          <- the platform writes this. You never open it in anger.
    main.py                the Temporal Worker: Client.connect, TLS, run loop
    decorators.py          @workflow.defn, extended to declare a task queue
    registry.py            what the decorators collected at import time
    config.py              the generated config, typed
    validate.py            code vs config, checked before anything connects
    vault.py               the namespace credential, fetched as this pod
    genconfig.py           emits the config from the live registry`;
