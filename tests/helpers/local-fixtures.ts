import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { deliveredCode } from "./local-mail";
const config = JSON.parse(readFileSync(".env.test.json", "utf8"));
for (const [value, port, protocol] of [
  [config.API_URL, 55321, "http:"],
  [config.DB_URL, 55322, "postgresql:"],
  [config.MAILPIT_URL, 55324, "http:"],
] as const) {
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== String(port) ||
    u.protocol !== protocol
  )
    throw new Error("Fixture requires dedicated local endpoints");
}
export const pool = new Pool({ connectionString: config.DB_URL });
export const apiURL = config.API_URL;
export const publishableKey = config.PUBLISHABLE_KEY;
export function anonymous() {
  return createClient(apiURL, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function fixtureEmail() {
  return `fixture-${randomUUID()}@example.test`;
}
export async function account() {
  const client = anonymous();
  const email = fixtureEmail();
  const request = await client.auth.signInWithOtp({ email });
  if (request.error) throw request.error;
  const token = await deliveredCode(email);
  const verify = await client.auth.verifyOtp({ email, token, type: "email" });
  if (verify.error) throw verify.error;
  return {
    client,
    email,
    token,
    user: verify.data.user!,
    session: verify.data.session!,
  };
}
export async function auditCount(id: string) {
  const r = await pool.query(
    "select count(*)::int n from private.practice_audit_events where practice_id=$1",
    [id],
  );
  return r.rows[0].n as number;
}
