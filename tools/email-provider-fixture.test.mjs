import assert from "node:assert/strict";
import { test } from "node:test";
import { startEmailFixture } from "./email-provider-fixture.mjs";

const origin = "http://127.0.0.1:55326";
const authorization = "Bearer local-fixture-only-e4-s2";
const payloadFor = (to) => ({
  from: "License Radar <reminders@example.test>",
  to: [to],
  subject: "Renewal reminder",
  text: "A frozen reminder.",
  html: "<p>A frozen reminder.</p>",
  tags: [{ name: "attempt", value: "opaque-attempt" }],
});
function send(payload, key) {
  return fetch(`${origin}/emails`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(payload),
  });
}
async function control(path, input) {
  const response = await fetch(`${origin}/test/${path}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 200);
  return response.json();
}
function retrieve(id) {
  return fetch(`${origin}/emails/${id}`, {
    headers: { Authorization: authorization },
  });
}

test("email recovery fixture witnesses real calls and accepted resources", async (t) => {
  const fixture = await startEmailFixture();
  t.after(() => fixture.close());

  await t.test(
    "scripted rate rejection then acceptance dedupes exact payload",
    async () => {
      const to = "fixture-rate@example.test";
      const payload = payloadFor(to);
      await control("mode", { to, mode: ["rate-limited", "accepted"] });
      const rejected = await send(payload, "rate-key");
      assert.equal(rejected.status, 429);
      assert.equal((await rejected.json()).name, "rate_limit_exceeded");
      assert.equal(rejected.headers.get("Retry-After"), "60");
      assert.equal((await control("resources", { to })).length, 0);
      const accepted = await send(payload, "rate-key");
      const { id } = await accepted.json();
      assert.equal(accepted.status, 200);
      const repeated = await send(payload, "rate-key");
      assert.deepEqual(await repeated.json(), { id });
      const resources = await control("resources", { to });
      assert.equal(resources.length, 1);
      assert.equal(resources[0].id, id);
      assert.equal((await control("state", { to })).length, 3);
      const calls = await control("calls", { to });
      assert.equal(calls.postCount, 3);
      assert.equal(calls.getCount, 0);
      assert.deepEqual(
        calls.calls.map((call) => call.classification),
        ["rate-limited", "accepted", "deduplicated"],
      );
      for (const call of calls.calls) {
        assert.equal(call.key, "rate-key");
        assert.deepEqual(call.payload, payload);
      }
      const changed = await send(
        { ...payload, subject: "Changed" },
        "rate-key",
      );
      assert.equal(changed.status, 409);
      assert.equal((await changed.json()).name, "invalid_idempotent_request");
      assert.equal((await control("resources", { to })).length, 1);
      assert.equal((await control("calls", { to })).postCount, 4);
    },
  );

  await t.test(
    "quota and old rejected/error modes record calls without acceptance",
    async () => {
      for (const [mode, status] of [
        ["quota", 429],
        ["rejected", 422],
        ["error", 503],
      ]) {
        const to = `fixture-${mode}@example.test`;
        await control("mode", { to, mode });
        const response = await send(payloadFor(to), `${mode}-key`);
        assert.equal(response.status, status);
        if (mode === "quota") {
          assert.equal((await response.json()).name, "daily_quota_exceeded");
        } else await response.text();
        assert.equal((await control("state", { to })).length, 1);
        assert.equal((await control("resources", { to })).length, 0);
        const calls = await control("calls", { to });
        assert.equal(calls.postCount, 1);
        assert.equal(calls.calls[0].classification, mode);
      }
    },
  );

  await t.test(
    "lost response accepts once; loss before acceptance does not",
    async () => {
      for (const [mode, count] of [
        ["lost", 1],
        ["lost-before-acceptance", 0],
      ]) {
        const to = `fixture-${mode}@example.test`;
        await control("mode", { to, mode });
        await assert.rejects(send(payloadFor(to), `${mode}-key`));
        assert.equal((await control("state", { to })).length, 1);
        assert.equal((await control("resources", { to })).length, count);
        assert.equal((await control("calls", { to })).postCount, 1);
        if (mode === "lost") {
          await control("mode", { to, mode: "accepted" });
          const repeated = await send(payloadFor(to), `${mode}-key`);
          assert.equal(repeated.status, 200);
          await repeated.text();
          assert.equal((await control("resources", { to })).length, 1);
        }
      }
    },
  );

  await t.test(
    "GET records bounded identity/status fixtures separately",
    async () => {
      const to = "fixture-lookup@example.test";
      const payload = payloadFor(to);
      const { id } = await (await send(payload, "lookup-key")).json();
      const normal = await (await retrieve(id)).json();
      assert.equal(normal.last_event, "sent");
      assert.deepEqual(normal.tags, payload.tags);
      await control("mode", { to, mode: "accepted", lastEvent: "delivered" });
      assert.equal((await (await retrieve(id)).json()).last_event, "delivered");
      for (const lookup of ["missing-tags", "foreign-tags", "duplicate-tags"]) {
        await control("mode", { to, mode: "accepted", lookup });
        const resource = await (await retrieve(id)).json();
        if (lookup === "missing-tags") assert.equal(resource.tags, undefined);
        if (lookup === "foreign-tags")
          assert.notDeepEqual(resource.tags, payload.tags);
        if (lookup === "duplicate-tags")
          assert.deepEqual(resource.tags, [...payload.tags, ...payload.tags]);
      }
      await control("mode", { to, mode: "accepted", lookup: "missing" });
      const missing = await retrieve(id);
      assert.equal(missing.status, 404);
      await missing.text();
      await control("mode", { to, mode: "accepted", lookup: "error" });
      const error = await retrieve(id);
      assert.equal(error.status, 503);
      await error.text();
      const calls = await control("calls", { to });
      assert.equal(calls.postCount, 1);
      assert.equal(calls.getCount, 7);
      assert.equal((await control("resources", { to })).length, 1);
      assert.equal((await control("state", { to })).length, 1);
      assert.equal(
        (await control("calls", { to: "fixture-unrelated@example.test" })).calls
          .length,
        0,
      );
    },
  );

  await t.test(
    "authorization, fixture recipient and mode controls fail closed",
    async () => {
      const unauthorized = await fetch(`${origin}/test/resources`, {
        method: "POST",
      });
      assert.equal(unauthorized.status, 403);
      await unauthorized.text();
      const invalid = await send(
        payloadFor("person@example.com"),
        "invalid-key",
      );
      assert.equal(invalid.status, 400);
      await invalid.text();
      const badMode = await fetch(`${origin}/test/mode`, {
        method: "POST",
        headers: { Authorization: authorization },
        body: JSON.stringify({
          to: "fixture-guard@example.test",
          mode: "https://example.com",
        }),
      });
      assert.equal(badMode.status, 400);
      await badMode.text();
    },
  );
});
