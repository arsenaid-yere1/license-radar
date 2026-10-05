import { createHash, randomBytes } from "node:crypto";
export function generateInvitation() {
  const token = randomBytes(32).toString("base64url");
  return { token, digest: createHash("sha256").update(token).digest("hex") };
}
export function hashInvitationToken(raw: unknown) {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  if (Buffer.from(raw, "base64url").toString("base64url") !== raw) return null;
  return createHash("sha256").update(raw).digest("hex");
}
