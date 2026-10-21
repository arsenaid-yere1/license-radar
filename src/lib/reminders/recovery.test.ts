import { expect, it } from "vitest";
import fc from "fast-check";
import { classifyRejection, parseDeliveryResource } from "./recovery";

const providerId = "c8a1bbaf-3d82-444e-bdae-f205f4d5039c";
const attemptId = "ad2304c4-fcb0-4624-95be-3beaf983c041";
const foreignId = "10000000-0000-4000-8000-000000000002";
const binding = {
  providerId,
  attemptId,
  from: "reminders@example.com",
  to: "recipient@example.test",
};
function rejection(name = "rate_limit_exceeded") {
  return { name, message: "Request rejected", statusCode: 429 };
}
function resource(last_event = "delivered") {
  return {
    id: providerId,
    from: binding.from,
    to: [binding.to],
    tags: [{ name: "reminder_attempt", value: attemptId }],
    last_event,
    subject: "Private subject",
    html: "Private message",
    created_at: "2030-01-01T10:00:00Z",
  };
}

it("DR04 only valid 429 rate_limit_exceeded authorizes rate recovery", () => {
  expect(classifyRejection(429, rejection(), "60")).toEqual({
    kind: "rate-limited",
    errorCode: "rate_limit_exceeded",
    retryAfterSeconds: 60,
  });
  expect(
    classifyRejection(
      429,
      { name: "rate_limit_exceeded", message: "Limited" },
      null,
    ),
  ).toEqual({
    kind: "rate-limited",
    errorCode: "rate_limit_exceeded",
    retryAfterSeconds: null,
  });
  for (const name of ["daily_quota_exceeded", "monthly_quota_exceeded"]) {
    expect(classifyRejection(429, rejection(name), "60")).toEqual({
      kind: "permanent",
      errorCode: name,
      retryAfterSeconds: null,
    });
  }
});

it("DR04 permanent client errors never become retryable, including malformed bodies", () => {
  fc.assert(
    fc.property(
      fc
        .integer({ min: 400, max: 499 })
        .filter((status) => ![408, 409, 429].includes(status)),
      fc.jsonValue(),
      (status, raw) => {
        expect(classifyRejection(status, raw, "1").kind).toBe("permanent");
      },
    ),
  );
  expect(
    classifyRejection(
      422,
      { name: "validation_error", message: "Invalid" },
      "1",
    ),
  ).toEqual({
    kind: "permanent",
    errorCode: "validation_error",
    retryAfterSeconds: null,
  });
});

it("DR04 uncertain status classes cannot borrow a retryable error name", () => {
  for (const status of [100, 399, 408, 409, 500, 599]) {
    expect(
      classifyRejection(status, { ...rejection(), statusCode: status }, "60"),
    ).toEqual({
      kind: "uncertain",
      errorCode: "rate_limit_exceeded",
      retryAfterSeconds: null,
    });
  }
  fc.assert(
    fc.property(
      fc.oneof(
        fc.integer({ min: 100, max: 399 }),
        fc.constantFrom(408, 409),
        fc.integer({ min: 500, max: 599 }),
      ),
      (status) => {
        expect(
          classifyRejection(
            status,
            { ...rejection(), statusCode: status },
            "60",
          ),
        ).toEqual({
          kind: "uncertain",
          errorCode: "rate_limit_exceeded",
          retryAfterSeconds: null,
        });
      },
    ),
  );
  for (const status of [NaN, Infinity, -1, 429.5, 600]) {
    expect(classifyRejection(status, rejection(), "60").kind).toBe("uncertain");
  }
});

it("DR04 malformed, unknown and overflowing 429 bodies remain uncertain", () => {
  for (const raw of [
    null,
    {},
    [],
    "rate_limit_exceeded",
    { name: "rate_limit_exceeded" },
    { ...rejection(), message: "" },
    { ...rejection(), message: "x".repeat(2001) },
    { ...rejection(), name: "x".repeat(65) },
    { ...rejection(), name: "RATE_LIMIT_EXCEEDED" },
    { ...rejection(), statusCode: 500 },
    { ...rejection(), statusCode: "429" },
    { ...rejection(), unexpected: "Ambiguous body" },
  ]) {
    expect(classifyRejection(429, raw, "60")).toEqual({
      kind: "uncertain",
      errorCode: null,
      retryAfterSeconds: null,
    });
  }
  fc.assert(
    fc.property(
      fc
        .stringMatching(/^[a-z_]{1,64}$/)
        .filter(
          (name) =>
            ![
              "rate_limit_exceeded",
              "daily_quota_exceeded",
              "monthly_quota_exceeded",
            ].includes(name),
        ),
      (name) => {
        expect(classifyRejection(429, rejection(name), "60")).toEqual({
          kind: "uncertain",
          errorCode: name,
          retryAfterSeconds: null,
        });
      },
    ),
  );
});

it("DR05 positive SQL-safe integer Retry-After seconds survive unchanged", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2147483647 }), (seconds) => {
      expect(
        classifyRejection(429, rejection(), String(seconds)).retryAfterSeconds,
      ).toBe(seconds);
    }),
  );
  for (const header of ["1", "0001", "2147483647"]) {
    expect(classifyRejection(429, rejection(), header).retryAfterSeconds).toBe(
      Number(header),
    );
  }
});

it("DR05 malformed, zero, negative and overflow headers cannot shorten backoff", () => {
  for (const header of [
    null,
    "",
    "0",
    "-1",
    "1.5",
    "1e3",
    "+1",
    " 1",
    "1 ",
    "1\n",
    "Infinity",
    "Wed, 21 Oct 2030 07:28:00 GMT",
    "00000000001",
  ]) {
    expect(
      classifyRejection(429, rejection(), header).retryAfterSeconds,
    ).toBeNull();
  }
  fc.assert(
    fc.property(
      fc.integer({ min: 2147483648, max: Number.MAX_SAFE_INTEGER }),
      (seconds) => {
        expect(
          classifyRejection(429, rejection(), String(seconds))
            .retryAfterSeconds,
        ).toBeNull();
      },
    ),
  );
  fc.assert(
    fc.property(fc.integer({ min: -2147483647, max: 0 }), (seconds) => {
      expect(
        classifyRejection(429, rejection(), String(seconds)).retryAfterSeconds,
      ).toBeNull();
    }),
  );
});

it("DR10 bound provider events map to sanitized observations without private fields", () => {
  for (const [event, status, bounced] of [
    ["sent", "sent", false],
    ["delivered", "delivered", false],
    ["delivery_delayed", "delayed", false],
    ["failed", "failed", false],
    ["complained", "complained", false],
    ["suppressed", "suppressed", false],
    ["bounced", "failed", true],
  ] as const) {
    expect(parseDeliveryResource(resource(event), binding)).toEqual({
      status,
      bounced,
    });
  }
});

it("DR10 unknown provider events preserve binding without inventing delivery evidence", () => {
  fc.assert(
    fc.property(
      fc
        .string({ maxLength: 64 })
        .filter(
          (event) =>
            ![
              "sent",
              "delivered",
              "delivery_delayed",
              "failed",
              "complained",
              "suppressed",
              "bounced",
            ].includes(event),
        ),
      (event) => {
        expect(parseDeliveryResource(resource(event), binding)).toEqual({
          status: null,
          bounced: false,
        });
      },
    ),
  );
});

it("DR10 resources require exact valid provider, sender and sole destination binding", () => {
  for (const raw of [
    null,
    {},
    { ...resource(), id: foreignId },
    { ...resource(), id: "not-a-uuid" },
    { ...resource(), from: "other@example.com" },
    { ...resource(), from: null },
    { ...resource(), to: [] },
    { ...resource(), to: ["other@example.test"] },
    { ...resource(), to: [binding.to, "other@example.test"] },
    { ...resource(), to: binding.to },
    { ...resource(), last_event: undefined },
    { ...resource(), last_event: 1 },
    { ...resource(), last_event: "x".repeat(65) },
  ]) {
    expect(parseDeliveryResource(raw, binding)).toBeNull();
  }
  for (const invalid of [
    { ...binding, providerId: "not-a-uuid" },
    { ...binding, attemptId: "not-a-uuid" },
    { ...binding, from: "" },
    { ...binding, to: "not-an-address" },
  ]) {
    expect(parseDeliveryResource(resource(), invalid)).toBeNull();
  }
});

it("DR10 missing, duplicate, foreign and malformed attempt tags never bind", () => {
  for (const tags of [
    undefined,
    null,
    {},
    [],
    [{ name: "other", value: attemptId }],
    [{ name: "reminder_attempt", value: foreignId }],
    [{ name: "reminder_attempt", value: "not-a-uuid" }],
    [
      { name: "reminder_attempt", value: attemptId },
      { name: "reminder_attempt", value: attemptId },
    ],
    [
      { name: "reminder_attempt", value: attemptId },
      { name: "reminder_attempt", value: foreignId },
    ],
    [{ name: "reminder_attempt", value: attemptId }, { name: "broken" }],
    [{ name: "reminder_attempt", value: attemptId, extra: "Ambiguous tag" }],
    Array.from({ length: 101 }, (_, index) => ({
      name: index === 0 ? "reminder_attempt" : "other",
      value: attemptId,
    })),
  ]) {
    expect(parseDeliveryResource({ ...resource(), tags }, binding)).toBeNull();
  }
  fc.assert(
    fc.property(
      fc.uuid().filter((id) => id !== attemptId),
      (id) => {
        expect(
          parseDeliveryResource(
            { ...resource(), tags: [{ name: "reminder_attempt", value: id }] },
            binding,
          ),
        ).toBeNull();
      },
    ),
  );
});

it("DR10 unrelated valid tags coexist with exactly one reminder tag", () => {
  expect(
    parseDeliveryResource(
      {
        ...resource(),
        tags: [{ name: "campaign", value: "renewal" }, ...resource().tags],
      },
      binding,
    ),
  ).toEqual({ status: "delivered", bounced: false });
});
