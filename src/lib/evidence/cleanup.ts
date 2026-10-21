import "server-only";
import * as storage from "./storage";
export async function cleanEvidence(
  evidenceId: string | null = null,
  gateway: Pick<
    typeof storage,
    "claimCleanup" | "purgeObject" | "recordCleanup"
  > = storage,
) {
  const claims = await gateway.claimCleanup(evidenceId);
  if (claims === null) return { success: false, removed: 0, pending: 0 };
  let removed = 0,
    pending = 0;
  const started = Date.now();
  for (const claim of claims) {
    if (Date.now() - started > 35000) {
      pending++;
      continue;
    }
    const purged = await gateway.purgeObject(claim.path);
    const recorded = await gateway.recordCleanup(
      claim.objectId,
      claim.token,
      purged,
    );
    if (purged && recorded) removed++;
    else pending++;
  }
  return { success: pending === 0, removed, pending };
}
