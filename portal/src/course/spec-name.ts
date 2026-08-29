import { parsePhysicalName } from '@/course/naming';
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
