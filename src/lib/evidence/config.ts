import "server-only";
export function evidenceEnabled() {
  return process.env.RENEWAL_EVIDENCE_ENABLED === "true";
}
export function evidenceConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
  );
}
export function cleanupSecret() {
  return process.env.EVIDENCE_CLEANUP_SECRET;
}
