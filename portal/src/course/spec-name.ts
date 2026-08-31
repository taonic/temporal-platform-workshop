import { parsePhysicalName } from '@/course/naming';

/**
 * The spec name the labs prescribe.
 *
 * Lab 2 says `tpctl new --name orders`, so every lab after it can name the file,
 * the namespace and the reconciler instead of printing a placeholder — and
 * grading can ask a specific reconciler instead of guessing which one.
 *
 * A student who picks a different name is doing the challenge and will grade as
 * incomplete. That is the trade: a wrong-but-predictable check beats a heuristic
 * that silently grades whichever spec happened to sort first.
 */
export const DEFAULT_SPEC = 'orders';

/**
 * The workflow challenge 4 prescribes.
 *
 * Named once so the command the lab prints and the checkpoint that grades it
 * cannot drift apart -- the student types what this says, and the grader looks
 * for what this says. The worker config the student generates names it too, from
 * the decorator in their own code.
 */
export const GREETING_WORKFLOW = 'GreetingWorkflow';
import { listNamespaces } from '@/platform/cloud';

/**
 * The student's spec name, read from their namespace tags.
 *
 * Never throws. A lab page must render without a Cloud credential -- the whole
 * reason the credential is required at point of use rather than at startup -- so a
 * failure here degrades to the `<spec>` placeholder and the page carries on.
 */
export async function resolveSpecName(username: string): Promise<string | undefined> {
  try {
    const namespaces = await listNamespaces();
    const mine = namespaces.filter((ns) => {
      if (ns.tags['username'] === username) return true;
      return parsePhysicalName(ns.spec.name ?? '', username) !== undefined;
    });

    // Prefer the tag the reconciler wrote; fall back to parsing the name.
    for (const ns of mine) {
      const tagged = ns.tags['spec'];
      if (tagged) return tagged;
      const parsed = parsePhysicalName(ns.spec.name ?? '', username);
      if (parsed) return parsed.spec;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
