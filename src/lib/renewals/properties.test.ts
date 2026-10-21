import { expect, it } from "vitest";
import fc from "fast-check";
import cases from "../../../tests/fixtures/renewal-urls.json";
import { parseRenewalUrl, renewalStateSchema, progressLabels } from "./state";
import {
  renewalCredentialSchema,
  renewalInputSchema,
  renewalRegisterSchema,
  renewalResultSchema,
} from "./schema";
import { credentialSchema } from "@/lib/register/schema";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  cycle = "bbbbbbbb-0000-4000-8000-000000000002";
const tokens = {
  requestId: id,
  id,
  expectedVersion: 1,
  expectedCycleId: cycle,
  expectedDateRevision: 1,
  expectedRenewalVersion: 1,
};
const renewal = {
  link: { url: null, version: 1 },
  workflow: {
    cycleId: cycle,
    status: "not-started",
    version: 1,
    acknowledgedAt: null,
  },
};
const record = {
  id,
  title: "Policy",
  type: "malpractice_policy",
  owner_kind: "practice",
  owner_clinician_id: null,
  owner_name: "Practice",
  version: 1,
  covered_clinicians: [],
  issuer: null,
  jurisdiction: null,
  current_cycle: {
    id: cycle,
    cycle_number: 1,
    date_revision: 1,
    end_date: "2028-02-29",
    action_deadline: "2028-02-01",
  },
  archived_at: null,
  renewal,
};
it("RW09 exact URL grammar corpus and every length boundary", () => {
  for (const c of cases) {
    const r = parseRenewalUrl(c.input);
    expect(r.valid, JSON.stringify(c.input)).toBe(c.valid);
    if (c.valid) expect(r).toEqual({ valid: true, value: c.normalized });
  }
  const prefix = "https://board.example.test/";
  for (const suffix of ["\nc", "<script>"])
    expect(
      parseRenewalUrl(
        "https://" + "a".repeat(5000) + "/" + "b".repeat(5000) + suffix,
      ),
    ).toEqual({ valid: false });
  expect(parseRenewalUrl(prefix + "a".repeat(2048 - prefix.length))).toEqual({
    valid: true,
    value: prefix + "a".repeat(2048 - prefix.length),
  });
  expect(parseRenewalUrl(prefix + "a".repeat(2049 - prefix.length))).toEqual({
    valid: false,
  });
  for (const n of [1, 2, 62, 63])
    expect(parseRenewalUrl(`https://${"a".repeat(n)}.test`).valid).toBe(true);
  expect(parseRenewalUrl(`https://${"a".repeat(64)}.test`).valid).toBe(false);
  for (const n of [60, 61, 62])
    expect(
      parseRenewalUrl(
        `https://${[63, 63, 63, n].map((x) => "a".repeat(x)).join(".")}`,
      ).valid,
    ).toBe(n <= 61);
});
it("RW09 generated valid URLs normalize idempotently and invalid suffixes always reject", () => {
  const suffix = fc
    .array(
      fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyz0123456789-._~!$&()*+,;=:@/?",
      ),
      { maxLength: 80 },
    )
    .map((v) => v.join(""));
  fc.assert(
    fc.property(
      suffix,
      fc.constantFrom("https", "HTTPS", "HtTpS"),
      (path, scheme) => {
        const url = `${scheme}://Board.example.test/${path}%20#step`,
          expected = `https://Board.example.test/${path}%20#step`;
        expect(parseRenewalUrl(` \t${url}\n`)).toEqual({
          valid: true,
          value: expected,
        });
        expect(parseRenewalUrl(expected)).toEqual({
          valid: true,
          value: expected,
        });
      },
    ),
    { seed: 20261012, numRuns: 150 },
  );
  fc.assert(
    fc.property(
      suffix,
      fc.constantFrom(
        "\0",
        "\n",
        " ",
        "\\",
        "'",
        '"',
        "<",
        ">",
        "[",
        "]",
        "{",
        "}",
        "`",
        "é",
        "%G0",
        "%1",
        "#a#",
      ),
      (path, bad) => {
        expect(
          parseRenewalUrl(`https://board.example.test/a${bad}!${path}b`),
        ).toEqual({ valid: false });
      },
    ),
    { seed: 20261012, numRuns: 150 },
  );
});
it("RW02 RW06 strict intents and canonical tokens reject invented dates authority and completion", () => {
  for (const intent of ["link", "progress", "review"] as const) {
    const raw = {
      ...tokens,
      intent,
      ...(intent === "link"
        ? { url: " HTTPS://Board.example.test " }
        : intent === "progress"
          ? { progress: "in-progress" }
          : {}),
    };
    expect(renewalInputSchema.parse(raw)).toEqual({
      ...raw,
      ...(intent === "link" ? { url: "https://Board.example.test" } : {}),
    });
    for (const field of ["requestId", "id", "expectedCycleId"])
      expect(
        renewalInputSchema.safeParse({ ...raw, [field]: "bad" }).success,
      ).toBe(false);
    for (const field of [
      "expectedVersion",
      "expectedDateRevision",
      "expectedRenewalVersion",
    ]) {
      expect(
        renewalInputSchema.parse({ ...raw, [field]: "2147483647" }),
      ).toMatchObject({ [field]: 2147483647 });
      for (const v of [
        0,
        -1,
        1.5,
        2147483648,
        null,
        undefined,
        "",
        "01",
        "+1",
        " 1",
        "1 ",
        "1.0",
        "1e2",
      ])
        expect(
          renewalInputSchema.safeParse({ ...raw, [field]: v }).success,
        ).toBe(false);
    }
    for (const field of [
      "practiceId",
      "actor",
      "acknowledgedAt",
      "endDate",
      "completed_at",
    ])
      expect(
        renewalInputSchema.safeParse({ ...raw, [field]: id }).success,
      ).toBe(false);
  }
  for (const progress of ["not-started", "in-progress", "awaiting-approval"])
    expect(
      renewalInputSchema.parse({ ...tokens, intent: "progress", progress }),
    ).toMatchObject({ progress });
  for (const patch of [
    { intent: "progress", progress: "completed" },
    { intent: "progress", progress: null },
    { intent: "review", progress: "in-progress" },
    { intent: "review", url: null },
    { intent: "link", url: 17 },
  ])
    expect(renewalInputSchema.safeParse({ ...tokens, ...patch }).success).toBe(
      false,
    );
  expect(
    renewalInputSchema.parse({ ...tokens, intent: "link", url: " \t" }),
  ).toMatchObject({ url: null });
});
it("RW06 generated token boundaries retain both valid and invalid sides", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2147483647 }), (n) => {
      for (const field of [
        "expectedVersion",
        "expectedDateRevision",
        "expectedRenewalVersion",
      ])
        expect(
          renewalInputSchema.parse({
            ...tokens,
            intent: "review",
            [field]: String(n),
          }),
        ).toMatchObject({ [field]: n });
    }),
    { seed: 20261012, numRuns: 100 },
  );
  fc.assert(
    fc.property(fc.integer({ min: -2147483647, max: 0 }), (n) => {
      expect(
        renewalInputSchema.safeParse({
          ...tokens,
          intent: "review",
          expectedRenewalVersion: n,
        }).success,
      ).toBe(false);
    }),
    { seed: 20261012, numRuns: 100 },
  );
});
it("RW08 coherent required renewal replies preserve legacy receipts and strip private fields", () => {
  expect(
    renewalCredentialSchema.parse({
      ...record,
      private: "secret",
      renewal: { ...renewal, actor: id },
    }),
  ).toEqual(record);
  expect(
    renewalRegisterSchema.parse({
      clinicians: [],
      credentials: [{ ...record, suspected_duplicate_ids: [] }],
    }),
  ).toEqual({
    clinicians: [],
    credentials: [{ ...record, suspected_duplicate_ids: [] }],
  });
  const { renewal: unused, ...legacy } = record;
  expect(unused).toEqual(renewal);
  expect(credentialSchema.safeParse(legacy).success).toBe(true);
  expect(renewalCredentialSchema.safeParse(legacy).success).toBe(false);
  for (const value of [
    null,
    {},
    { ...renewal, workflow: { ...renewal.workflow, cycleId: id } },
    { ...renewal, workflow: { ...renewal.workflow, status: "completed" } },
    { ...renewal, workflow: { ...renewal.workflow, acknowledgedAt: "bad" } },
    { ...renewal, workflow: { ...renewal.workflow, version: 0 } },
    { ...renewal, link: { url: "HTTPS://board.example.test", version: 1 } },
    { ...renewal, link: { url: "", version: 1 } },
    { ...renewal, link: { url: "http://board.example.test", version: 1 } },
  ])
    expect(
      renewalCredentialSchema.safeParse({ ...record, renewal: value }).success,
    ).toBe(false);
  expect(
    renewalStateSchema.parse({
      ...renewal,
      workflow: {
        ...renewal.workflow,
        acknowledgedAt: "2026-10-12T20:00:00+00:00",
      },
    }),
  ).toMatchObject({
    workflow: { acknowledgedAt: "2026-10-12T20:00:00+00:00" },
  });
});
it("RW08 generated cycle bindings never leak a different cycle into a record", () => {
  fc.assert(
    fc.property(fc.uuid(), (value) => {
      const coherent = {
        ...record,
        current_cycle: { ...record.current_cycle, id: value },
        renewal: {
          ...renewal,
          workflow: { ...renewal.workflow, cycleId: value },
        },
      };
      expect(renewalCredentialSchema.safeParse(coherent).success).toBe(true);
      const other = value === id ? cycle : id;
      expect(
        renewalCredentialSchema.safeParse({
          ...coherent,
          renewal: {
            ...renewal,
            workflow: { ...renewal.workflow, cycleId: other },
          },
        }).success,
      ).toBe(false);
    }),
    { seed: 20261012, numRuns: 100 },
  );
});
it("RW08 canonical renewal state and reply contracts reject rewritten values and arbitrary errors", () => {
  expect(progressLabels).toEqual({
    "not-started": "Not started",
    "in-progress": "In progress",
    "awaiting-approval": "Awaiting approval",
  });
  const upper = cycle.toUpperCase();
  expect(
    renewalStateSchema.parse({
      ...renewal,
      workflow: { ...renewal.workflow, cycleId: upper },
    }).workflow.cycleId,
  ).toBe(cycle);
  for (const status of ["success", "conflict"]) {
    const raw = {
      status,
      credential: record,
      ...(status === "success" ? { changed: true } : {}),
    };
    expect(renewalResultSchema.parse({ ...raw, secret: "private" })).toEqual(
      raw,
    );
    expect(
      renewalResultSchema.safeParse({
        ...raw,
        credential: { ...record, renewal: undefined },
      }).success,
    ).toBe(false);
  }
  for (const status of [
    "invalid",
    "request-conflict",
    "archived",
    "completed",
    "not-found",
  ])
    expect(renewalResultSchema.parse({ status, secret: "private" })).toEqual({
      status,
    });
  for (const errors of [
    { url: "Enter a valid HTTPS renewal link (up to 2,048 characters)." },
    { progress: "Choose a renewal progress status." },
  ])
    expect(renewalResultSchema.parse({ status: "invalid", errors })).toEqual({
      status: "invalid",
      errors,
    });
  for (const raw of [
    {},
    { status: "success", changed: "true", credential: record },
    { status: "forbidden" },
    { status: "invalid", errors: { url: "private" } },
    { status: "invalid", errors: { secret: "private" } },
  ])
    expect(renewalResultSchema.safeParse(raw).success).toBe(false);
  expect(
    renewalInputSchema.parse({
      ...tokens,
      intent: "review",
      id: id.toUpperCase(),
      requestId: id.toUpperCase(),
      expectedCycleId: upper,
    }),
  ).toEqual({ ...tokens, intent: "review" });
  for (const url of [
    "https://board.example.test/a%00b",
    "https://board.example.test/%Af",
    "https://board.example.test/x?y=1#z",
  ])
    expect(
      renewalStateSchema.parse({ ...renewal, link: { url, version: 2 } }).link
        .url,
    ).toBe(url);
});
it("RW05 malformed intent and result discriminants identify the actual public field", () => {
  expect(() =>
    renewalInputSchema.safeParse({ ...tokens, intent: "invented" }),
  ).not.toThrow();
  expect(() =>
    renewalResultSchema.safeParse({ status: "invented" }),
  ).not.toThrow();
  const input = renewalInputSchema.safeParse({ ...tokens, intent: "invented" });
  expect(input.success).toBe(false);
  if (!input.success) expect(input.error.issues[0].path).toEqual(["intent"]);
  const result = renewalResultSchema.safeParse({ status: "invented" });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues[0].path).toEqual(["status"]);
});
