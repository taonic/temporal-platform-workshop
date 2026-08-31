import { Client, Connection } from '@temporalio/client';

import { config } from '@/config';

/**
 * The reconciler's own view of itself, read from its Query handler.
 *
 * This mirrors `Status` in internal/platform/workflow/types.go. It is the one
 * place the portal can see platform BEHAVIOUR rather than Cloud state: that the
 * loop noticed a change nobody committed, and what it did about it. The Ops API
 * can show a namespace is correct; only this can show it was wrong and got fixed.
 */
export interface ReconcilerStatus {
  spec: { Name: string; RetentionDays: number; Environments: string[] };
  username: string;
  generation: number;
  reconciles: number;
  driftsDetected: number;
  lastDrift?: string;
  destroying: boolean;
  environments: {
    env: string;
    namespaceId?: string;
    vaultPath?: string;
    ok: boolean;
    error?: string;
  }[];
}

/**
 * The control plane runs in Temporal Cloud, so the portal can reach it.
 *
 * That was not always true. When the control plane was a dev server on the
 * student's own machine, nothing central could see it, and every behavioural
 * checkpoint had to be self-attested or graded from inside the sandbox. Then
 * challenge 1 started provisioning a namespace for the control plane to run in --
 * "the control plane's first customer is itself" -- and the reconcilers moved onto
 * Cloud with it. The old constraint outlived the architecture by a while.
 */
function controlNamespace(username: string): string {
  return `ws-${username}-control.${config().PORTAL_ACCOUNT_ID}`;
}

/**
 * Where a namespace answers, derived from its own id.
 *
 * Temporal Cloud publishes a per-namespace endpoint, and it is the better address
 * to hold because it is a pure function of the namespace: it cannot point
 * somewhere else. The regional form was used here first and was wrong for exactly
 * one case, which is the case that matters -- a student's namespace can be in a
 * different region from the control plane, and a namespace is only reachable on
 * its own region's endpoint. Dialling another answers "Request unauthorized",
 * which reads as a credential problem and is a routing one.
 *
 * Mirrors spec.NamespaceEndpoint in Go.
 */
function endpointFor(namespace: string): string {
  return `${namespace}.tmprl.cloud:7233`;
}

/**
 * Query one reconciler. Never throws.
 *
 * A lab page has to render for a student whose control plane is not up yet, whose
 * namespace does not exist, or who has simply not got there -- and "no reconciler"
 * is the normal state for most of the workshop, not an error. Every failure is the
 * same answer to the grader: undefined, meaning "cannot see one".
 */
export async function queryReconciler(
  username: string,
  spec: string,
): Promise<ReconcilerStatus | undefined> {
  const cfg = config();
  if (!cfg.TEMPORAL_CLOUD_API_KEY) return undefined;

  let connection: Connection | undefined;
  try {
    connection = await Connection.connect({
      address: endpointFor(controlNamespace(username)),
      tls: {},
      apiKey: cfg.TEMPORAL_CLOUD_API_KEY,
      connectTimeout: 5_000,
    });
    const client = new Client({ connection, namespace: controlNamespace(username) });
    const handle = client.workflow.getHandle(`ns-${spec}`);
    return (await handle.query('status')) as ReconcilerStatus;
  } catch {
    // Not found, not running, no credential, no namespace, unreachable: all the
    // same to a checkpoint, and none of them is a reason to fail a page render.
    return undefined;
  } finally {
    await connection?.close().catch(() => {});
  }
}

/**
 * How many workers are polling a task queue, right now.
 *
 * This is the one thing that proves a deployed worker actually WORKS. A ready pod
 * proves the process started; a namespace proves the platform provisioned; only a
 * poller on the queue proves the two met -- that the credential resolved, the
 * address was right, and Temporal is holding a long-poll open for it.
 *
 * Asked of the student's own namespace rather than the control plane's, because
 * that is where the managed worker polls.
 */
export async function pollerCount(
  namespace: string,
  taskQueue: string,
): Promise<number | undefined> {
  const cfg = config();
  if (!cfg.TEMPORAL_CLOUD_API_KEY) return undefined;

  let connection: Connection | undefined;
  try {
    connection = await Connection.connect({
      // The namespace being asked about, not the control plane's -- they can
      // be in different regions.
      address: endpointFor(namespace),
      tls: {},
      apiKey: cfg.TEMPORAL_CLOUD_API_KEY,
      connectTimeout: 5_000,
    });
    const client = new Client({ connection, namespace });
    const resp = await client.workflowService.describeTaskQueue({
      namespace,
      taskQueue: { name: taskQueue },
      // WORKFLOW. An activity-only poller would not run the workflow the lab
      // starts, so counting those would grade a worker that cannot do the job.
      taskQueueType: 1,
    });
    return resp.pollers?.length ?? 0;
  } catch {
    // No namespace, no credential, no such queue: all "cannot see one".
    return undefined;
  } finally {
    await connection?.close().catch(() => {});
  }
}

/**
 * Did the student ever run this workflow type to completion here?
 *
 * The last thing challenge 4 asks for, and the only one that proves the deployed
 * worker can do its job. A ready pod proves the process started; a poller proves
 * it reached Temporal; only a COMPLETED execution proves the input deserialised,
 * the activity was registered on the queue the decorator named, and the image in
 * the cluster is the one the student built.
 *
 * Looked for rather than started. A grader that runs its own workflow grades
 * itself: it would pass a student who deployed a worker and never called it,
 * which is the one thing this challenge is about. This mirrors what
 * instruqt/checks/check-paved-road does from inside the sandbox -- same query,
 * two vantage points.
 *
 * Any completed execution of the type counts, so a student who used their own
 * --workflow-id still passes.
 */
export async function completedRun(
  namespace: string,
  workflowType: string,
): Promise<boolean | undefined> {
  const cfg = config();
  if (!cfg.TEMPORAL_CLOUD_API_KEY) return undefined;

  let connection: Connection | undefined;
  try {
    connection = await Connection.connect({
      address: endpointFor(namespace),
      tls: {},
      apiKey: cfg.TEMPORAL_CLOUD_API_KEY,
      connectTimeout: 5_000,
    });
    const client = new Client({ connection, namespace });
    const resp = await client.workflowService.listWorkflowExecutions({
      namespace,
      query: `WorkflowType = '${workflowType}' AND ExecutionStatus = 'Completed'`,
      pageSize: 1,
    });
    return (resp.executions?.length ?? 0) > 0;
  } catch {
    // No namespace, no credential, visibility not caught up: "cannot see one".
    // Distinct from `false`, which means the namespace answered and had none.
    return undefined;
  } finally {
    await connection?.close().catch(() => {});
  }
}

/** The physical namespace the platform made for one environment of a spec. */
export function physicalNamespace(username: string, spec: string, environment: string): string {
  return `ws-${username}-${spec}-${environment}.${config().PORTAL_ACCOUNT_ID}`;
}
