import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import {
  getReminderHistory,
  getReminderTimeline,
  getReminderHistoryV2,
  getReminderTimelineV2,
  providerCapabilitySchema,
  requestReminderCheck,
  checkFormInput,
} from "./history";

const practiceId = "10000000-0000-4000-8000-000000000001";
const credentialId = "10000000-0000-4000-8000-000000000002";
const attemptId = "10000000-0000-4000-8000-000000000003";
const jobId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const cursorId = "10000000-0000-4000-8000-000000000006";
const input = { attemptId, requestId, expectedVersion: 1 };
const recovery = {
  disposition: "accepted",
  version: 1,
  postCount: 1,
  retryDue: null,
  retryExpires: "2030-01-02T09:00:00Z",
  checkCount: 0,
  checkDue: "2030-01-01T10:05:00Z",
  canCheck: true,
};
const row = {
  id: jobId,
  attemptId,
  recipient: "former",
  dueDate: "2030-03-01",
  timezone: "America/Los_Angeles",
  scheduleKind: "normal",
  nominalTarget: "2030-01-01T10:00:00Z",
  dispatchTarget: "2030-01-01T10:00:00Z",
  state: "accepted",
  delivery: "sent",
  reason: null,
  startedAt: "2030-01-01T10:00:00Z",
  recovery,
};
function history() {
  return {
    status: "success",
    credential: {
      id: credentialId,
      title: "Medical license",
      archived: true,
      currentDueDate: "2031-03-01",
      currentTimezone: "America/Los_Angeles",
    },
    rows: [row],
    nextCursor: cursorId,
  };
}
const timelineRow = {
  id: cursorId,
  source: "check" as const,
  observedAt: "2030-01-01T10:05:00Z",
  operation: "delivered",
  anomaly: false,
};
const cursor = {
  observedAt: timelineRow.observedAt,
  source: timelineRow.source,
  id: timelineRow.id,
};
function timeline() {
  return { status: "success", rows: [timelineRow], nextCursor: cursor };
}
function client(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

it("DR01 history preserves historical dates and opaque recipient labels through its scoped RPC", async () => {
  const mock = client(history());
  expect(
    await getReminderHistory(mock.client, practiceId, credentialId, cursorId),
  ).toEqual(history());
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith(
    "get_email_reminder_history",
    {
      p_practice_id: practiceId,
      p_credential_id: credentialId,
      p_after: cursorId,
    },
  );
});

it("DR01 history accepts empty, legacy and unconsumed pages with null cursors", async () => {
  for (const data of [
    { ...history(), rows: [], nextCursor: null },
    { ...history(), rows: [{ ...row, recovery: null }] },
    {
      ...history(),
      rows: [
        {
          ...row,
          attemptId: null,
          startedAt: null,
          recovery: null,
          state: "queued",
        },
      ],
    },
    {
      ...history(),
      credential: { ...history().credential, currentDueDate: null },
    },
    { status: "not-found" },
  ]) {
    const mock = client(data);
    expect(
      await getReminderHistory(mock.client, practiceId, credentialId),
    ).toEqual(data);
    expect(mock.rpc.mock.calls[0][1].p_after).toBeNull();
  }
});

it("DR01 history rejects private extras and malformed public identities at every nesting level", async () => {
  for (const data of [
    { ...history(), providerId: attemptId },
    {
      ...history(),
      credential: {
        ...history().credential,
        destination: "private@example.test",
      },
    },
    { ...history(), rows: [{ ...row, payload: { text: "Private" } }] },
    {
      ...history(),
      rows: [{ ...row, recovery: { ...recovery, token: attemptId } }],
    },
    { ...history(), rows: [{ ...row, id: "invalid" }] },
    { ...history(), rows: [{ ...row, attemptId: "invalid" }] },
    { ...history(), nextCursor: "invalid" },
    { ...history(), rows: [{ ...row, recipient: "private-user-id" }] },
    { ...history(), rows: [{ ...row, state: "delivered" }] },
    { ...history(), rows: [{ ...row, scheduleKind: "scheduled" }] },
    {
      ...history(),
      rows: [{ ...row, recovery: { ...recovery, disposition: "resend" } }],
    },
    { status: "not-found", rows: [] },
    null,
  ]) {
    expect(
      await getReminderHistory(client(data).client, practiceId, credentialId),
    ).toEqual({ status: "unavailable" });
  }
});

it("DR01 bounded history pages enforce reservation counters and positive SQL versions", async () => {
  for (const invalid of [
    { version: 0 },
    { version: 2147483648 },
    { version: 1.5 },
    { postCount: -1 },
    { postCount: 4 },
    { postCount: 1.5 },
    { checkCount: -1 },
    { checkCount: 7 },
    { checkCount: 1.5 },
    { canCheck: "true" },
  ]) {
    const data = {
      ...history(),
      rows: [{ ...row, recovery: { ...recovery, ...invalid } }],
    };
    expect(
      await getReminderHistory(client(data).client, practiceId, credentialId),
    ).toEqual({ status: "unavailable" });
  }
  expect(
    await getReminderHistory(
      client({ ...history(), rows: Array(51).fill(row) }).client,
      practiceId,
      credentialId,
    ),
  ).toEqual({ status: "unavailable" });
  const bound = {
    ...history(),
    rows: Array(50).fill({
      ...row,
      recovery: {
        ...recovery,
        version: 2147483647,
        postCount: 3,
        checkCount: 6,
      },
    }),
  };
  expect(
    await getReminderHistory(client(bound).client, practiceId, credentialId),
  ).toEqual(bound);
});

it("DR01 every specified legacy job state and recovery disposition is readable", async () => {
  for (const state of [
    "pending",
    "blocked",
    "queued",
    "claimed",
    "submitting",
    "accepted",
    "failed",
    "suppressed",
    "canceled",
    "uncertain",
  ]) {
    const data = { ...history(), rows: [{ ...row, state }] };
    expect(
      await getReminderHistory(client(data).client, practiceId, credentialId),
    ).toEqual(data);
  }
  for (const disposition of [
    "legacy",
    "submitting",
    "retry-pending",
    "accepted",
    "permanent",
    "uncertain",
    "review-needed",
    "canceled",
    "exhausted",
    "expired",
  ]) {
    const data = {
      ...history(),
      rows: [{ ...row, recovery: { ...recovery, disposition } }],
    };
    expect(
      await getReminderHistory(client(data).client, practiceId, credentialId),
    ).toEqual(data);
  }
});

it("DR01 timeline uses its attempt-scoped JSON cursor and retains application observation time", async () => {
  const mock = client(timeline());
  expect(
    await getReminderTimeline(mock.client, practiceId, attemptId, cursor),
  ).toEqual(timeline());
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith(
    "get_email_reminder_timeline",
    {
      p_practice_id: practiceId,
      p_attempt_id: attemptId,
      p_after: cursor,
    },
  );
  for (const source of ["job", "submission", "delivery", "check"]) {
    const data = {
      ...timeline(),
      rows: [{ ...timelineRow, source }],
      nextCursor: null,
    };
    expect(
      await getReminderTimeline(client(data).client, practiceId, attemptId),
    ).toEqual(data);
  }
  const scoped = client(timeline());
  expect(
    await getReminderTimeline(
      scoped.client,
      practiceId,
      attemptId,
      cursor,
      credentialId,
    ),
  ).toEqual(timeline());
  expect(scoped.rpc).toHaveBeenCalledExactlyOnceWith(
    "get_email_reminder_timeline",
    {
      p_practice_id: practiceId,
      p_attempt_id: attemptId,
      p_after: cursor,
      p_credential_id: credentialId,
    },
  );
});

it("DR01 timeline rejects private extras, invalid cursors and unbounded evidence", async () => {
  for (const data of [
    null,
    { ...timeline(), providerId: attemptId },
    { ...timeline(), rows: [{ ...timelineRow, providerEventId: "Private" }] },
    { ...timeline(), rows: [{ ...timelineRow, id: "invalid" }] },
    { ...timeline(), rows: [{ ...timelineRow, source: "raw-provider" }] },
    { ...timeline(), rows: [{ ...timelineRow, anomaly: "false" }] },
    { ...timeline(), nextCursor: { ...cursor, token: attemptId } },
    { ...timeline(), nextCursor: { ...cursor, id: "invalid" } },
    { ...timeline(), nextCursor: { ...cursor, source: "raw-provider" } },
    { ...timeline(), rows: Array(51).fill(timelineRow) },
    { status: "not-found", nextCursor: null },
  ]) {
    expect(
      await getReminderTimeline(client(data).client, practiceId, attemptId),
    ).toEqual({ status: "unavailable" });
  }
  for (const data of [
    { status: "not-found" },
    { ...timeline(), rows: [], nextCursor: null },
  ]) {
    expect(
      await getReminderTimeline(client(data).client, practiceId, attemptId),
    ).toEqual(data);
  }
});

it("DR13 check requests send only versioned opaque identifiers and preserve truthful outcomes", async () => {
  for (const status of [
    "queued",
    "not-found",
    "invalid",
    "conflict",
    "unknown-id",
    "exhausted",
    "complete",
    "cooldown",
    "request-conflict",
  ]) {
    const mock = client({ status });
    expect(await requestReminderCheck(mock.client, practiceId, input)).toEqual({
      status,
    });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith(
      "request_email_reminder_check",
      {
        p_practice_id: practiceId,
        p_attempt_id: attemptId,
        p_request_id: requestId,
        p_expected_version: 1,
      },
    );
  }
});

it("DR13 malformed check requests never invoke the RPC", async () => {
  for (const raw of [
    { ...input, requestId: "invalid" },
    { ...input, attemptId: "invalid" },
    { ...input, expectedVersion: 0 },
    { ...input, expectedVersion: 1.5 },
    { ...input, expectedVersion: 2147483648 },
    { ...input, providerId: attemptId },
  ]) {
    const mock = client({ status: "queued" });
    expect(await requestReminderCheck(mock.client, practiceId, raw)).toEqual({
      status: "invalid",
    });
    expect(mock.rpc).not.toHaveBeenCalled();
  }
});

it("DR13 malformed check responses are unavailable and never expose unknown fields", async () => {
  for (const data of [
    null,
    {},
    { status: "success" },
    { status: "queued", token: attemptId },
  ]) {
    expect(
      await requestReminderCheck(client(data).client, practiceId, input),
    ).toEqual({ status: "unavailable" });
  }
});

it("DR01 DR13 forbidden and failed RPCs map consistently without leaking provider errors", async () => {
  const operations = [
    (mock: SupabaseClient) =>
      getReminderHistoryV2(mock, practiceId, credentialId),
    (mock: SupabaseClient) =>
      getReminderTimelineV2(mock, practiceId, attemptId),
    (mock: SupabaseClient) =>
      getReminderHistory(mock, practiceId, credentialId),
    (mock: SupabaseClient) => getReminderTimeline(mock, practiceId, attemptId),
    (mock: SupabaseClient) => requestReminderCheck(mock, practiceId, input),
  ];
  for (const operation of operations) {
    expect(
      await operation(
        client(null, { code: "42501", message: "Private" }).client,
      ),
    ).toEqual({ status: "forbidden" });
    expect(
      await operation(
        client(history(), { code: "XX000", message: "Private" }).client,
      ),
    ).toEqual({ status: "unavailable" });
    const mock = client(null);
    mock.rpc.mockRejectedValue(new Error("Private"));
    expect(await operation(mock.client)).toEqual({ status: "unavailable" });
  }
});

it("GM07 capability-aware versioned history and timeline preserve scoped cursors without IDs or secrets", async () => {
  const provider = {
    kind: "gmail",
    maxPosts: 1,
    deliveryChecks: false,
    automaticResend: false,
  };
  const data = { ...history(), rows: [{ ...row, delivery: null, provider }] },
    mock = client(data);
  expect(
    await getReminderHistoryV2(mock.client, practiceId, credentialId, cursorId),
  ).toEqual(data);
  expect(mock.rpc).toHaveBeenCalledWith("get_email_reminder_history_v2", {
    p_practice_id: practiceId,
    p_credential_id: credentialId,
    p_after: cursorId,
  });
  const events = { ...timeline(), provider },
    t = client(events);
  expect(
    await getReminderTimelineV2(
      t.client,
      practiceId,
      attemptId,
      cursor,
      credentialId,
    ),
  ).toEqual(events);
  expect(t.rpc).toHaveBeenCalledWith("get_email_reminder_timeline_v2", {
    p_practice_id: practiceId,
    p_attempt_id: attemptId,
    p_after: cursor,
    p_credential_id: credentialId,
  });
  for (const invalid of [
    { ...provider, deliveryChecks: true },
    { ...provider, maxPosts: 3 },
    { ...provider, refreshToken: "private" },
    { ...provider, automaticResend: true },
  ]) {
    expect(
      await getReminderHistoryV2(
        client({ ...data, rows: [{ ...data.rows[0], provider: invalid }] })
          .client,
        practiceId,
        credentialId,
      ),
    ).toEqual({ status: "unavailable" });
    expect(
      await getReminderTimelineV2(
        client({ ...events, provider: invalid }).client,
        practiceId,
        attemptId,
      ),
    ).toEqual({ status: "unavailable" });
  }
  expect(
    await getReminderHistoryV2(
      client({ status: "not-found" }).client,
      practiceId,
      credentialId,
    ),
  ).toEqual({ status: "not-found" });
  expect(
    await getReminderTimelineV2(
      client({ status: "not-found" }).client,
      practiceId,
      attemptId,
    ),
  ).toEqual({ status: "not-found" });
});
it("GM07 provider capabilities accept both complete providers and reject missing or conflicting authority", () => {
  const gmail = {
    kind: "gmail",
    maxPosts: 1,
    deliveryChecks: false,
    automaticResend: false,
  };
  const resend = {
    kind: "resend",
    maxPosts: 3,
    deliveryChecks: true,
    automaticResend: true,
  };
  expect(providerCapabilitySchema.parse(gmail)).toEqual(gmail);
  expect(providerCapabilitySchema.parse(resend)).toEqual(resend);
  for (const raw of [
    {},
    { ...gmail, kind: "unknown" },
    { ...resend, maxPosts: 1 },
    { ...resend, deliveryChecks: false },
    { ...resend, automaticResend: false },
    { ...resend, token: "private" },
  ])
    expect(providerCapabilitySchema.safeParse(raw).success).toBe(false);
});

function form() {
  const value = new FormData();
  value.set("attemptId", attemptId);
  value.set("requestId", requestId);
  value.set("expectedVersion", "1");
  return value;
}
it("DR13 check form accepts exactly one opaque identifier and bounded positive version per field", () => {
  expect(checkFormInput(form())).toEqual(input);
  const value = form();
  value.set("expectedVersion", "2147483647");
  expect(checkFormInput(value)).toEqual({
    ...input,
    expectedVersion: 2147483647,
  });
});

it("DR13 duplicate, missing, malformed and overflowing check form fields fail closed", () => {
  for (const key of ["attemptId", "requestId", "expectedVersion"]) {
    const missing = form();
    missing.delete(key);
    expect(checkFormInput(missing)).toBeNull();
    const duplicate = form();
    duplicate.append(key, duplicate.get(key) as string);
    expect(checkFormInput(duplicate)).toBeNull();
    const file = form();
    file.set(key, new File(["Private"], "value.txt"));
    expect(checkFormInput(file)).toBeNull();
  }
  for (const invalid of [
    "",
    "0",
    "-1",
    "1.5",
    "1e3",
    "+1",
    "01",
    "1\n",
    " 1",
    "1 ",
    "2147483648",
    "9007199254740993",
  ]) {
    const value = form();
    value.set("expectedVersion", invalid);
    expect(checkFormInput(value)).toBeNull();
  }
  for (const key of ["attemptId", "requestId"]) {
    const value = form();
    value.set(key, "invalid");
    expect(checkFormInput(value)).toBeNull();
  }
});
