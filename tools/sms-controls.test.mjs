import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSmsCapabilities } from "./sms-capabilities.mjs";
const boundary = "src/lib/sms/privileged-repository.ts";
function sources(other = "") {
  return new Map([
    [boundary, 'import "server-only";\nexport async function claimSend() {}'],
    ["src/app/client.tsx", '"use client";\n' + other],
  ]);
}
test("SMS checker accepts the constrained server boundary", () =>
  assertSmsCapabilities(sources()));
test("SMS checker rejects leaked client secrets", () =>
  assert.throws(
    () => assertSmsCapabilities(sources("process.env.NEXT_PUBLIC_SMS_SECRET")),
    /SMS public secret\/authority/,
  ));
test("SMS checker rejects secret use outside the exact module", () =>
  assert.throws(
    () => assertSmsCapabilities(sources("process.env.SUPABASE_SECRET_KEY")),
    /outside privileged boundary/,
  ));
test("SMS checker rejects direct and indirect client imports", () => {
  assert.throws(
    () =>
      assertSmsCapabilities(
        sources('import {claimSend} from "@/lib/sms/privileged-repository"'),
      ),
    /client reaches server capability/,
  );
  const files = sources('import {bridge} from "@/lib/sms/bridge"');
  files.set(
    "src/lib/sms/bridge.ts",
    'export {claimSend as bridge} from "./privileged-repository"',
  );
  assert.throws(
    () => assertSmsCapabilities(files),
    /client reaches server capability/,
  );
});
test("SMS checker rejects raw/generic exports and missing markers", () => {
  for (const source of [
    "export function claimSend() {}",
    'import "server-only"; export const client = {};',
    'import "server-only"; export function rpc() {}',
    'import "server-only"; export { client };',
    'import "server-only"; export default {};',
  ]) {
    const files = sources();
    files.set(boundary, source);
    assert.throws(
      () => assertSmsCapabilities(files),
      /marker missing|raw\/generic privileged export/,
    );
  }
});
test("SMS checker fails closed for missing source", () => {
  assert.throws(() => assertSmsCapabilities(new Map()), /boundary missing/);
  assert.throws(
    () => assertSmsCapabilities(sources('import "./missing"')),
    /unresolved client import/,
  );
});
test("Email named operations cannot cross the client boundary", () => {
  const files = sources(
    'import {beginReminderSubmission} from "@/lib/sms/privileged-repository"',
  );
  files.set(
    boundary,
    'import "server-only"; export async function beginReminderSubmission() {}',
  );
  assert.throws(
    () => assertSmsCapabilities(files),
    /client reaches server capability/,
  );
  assert.throws(
    () =>
      assertSmsCapabilities(sources("process.env.NEXT_PUBLIC_RESEND_API_KEY")),
    /public secret\/authority/,
  );
});
