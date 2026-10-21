import { expect, it, vi } from "vitest";
import fc from "fast-check";
import cases from "../../../tests/fixtures/credential-numbers.json";
import {
  registerInputSchema,
  maintenanceInputSchema,
  credentialSchema,
} from "./schema";
import { createRecord, changeRecord } from "./repository";
import { recordNumberLabels, recordNumberSchema } from "./numbers";
import type { SupabaseClient } from "@supabase/supabase-js";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const base = {
  intent: "credential",
  requestId: id,
  title: "License",
  type: "state_license",
  ownerKind: "practice",
};
const record = {
  id,
  title: "License",
  type: "state_license",
  owner_kind: "practice",
  owner_clinician_id: null,
  owner_name: "Practice",
  version: 1,
  covered_clinicians: [],
  issuer: null,
  jurisdiction: null,
  current_cycle: {
    id,
    cycle_number: 1,
    date_revision: 1,
    end_date: null,
    action_deadline: null,
  },
};
const update = {
  ...base,
  intent: "update",
  id,
  expectedVersion: 1,
  expectedCycleId: id,
  expectedDateRevision: 1,
};
it("RN01 RN09 number labels and validation errors are truthful and safe", async () => {
  expect(recordNumberLabels).toEqual({
    state_license: "License number",
    dea_registration: "DEA registration number",
    malpractice_policy: "Policy number",
    pci_compliance_certificate: "Certificate number",
    insurance_payer_provider_directory: "Directory / provider reference",
  });
  const parsed = recordNumberSchema.safeParse("unsafe\nvalue");
  expect(parsed.success).toBe(false);
  if (!parsed.success)
    expect(parsed.error.issues[0].message).toBe(
      "Use up to 120 characters without control characters.",
    );
  const errors = {
    recordNumber: "Use up to 120 characters without control characters.",
  };
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { status: "invalid", errors }, error: null });
  const client = { rpc } as unknown as SupabaseClient;
  expect(
    await createRecord(
      client,
      id,
      registerInputSchema.parse({ ...base, recordNumber: "000X" }),
    ),
  ).toEqual({ status: "invalid", errors });
  expect(
    await changeRecord(
      client,
      id,
      maintenanceInputSchema.parse({ ...update, recordNumber: "000X" }),
    ),
  ).toEqual({ status: "invalid", errors });
});
it("RN01 RN02 optional numbers canonicalize strings without losing author formatting", () => {
  for (const item of [
    ...cases,
    { input: "\ud800", valid: false },
    { input: "🩺".repeat(120), valid: true, normalized: "🩺".repeat(120) },
    { input: "x".repeat(121), valid: false },
  ]) {
    for (const input of [base, update]) {
      const parsed = (
        input.intent === "update" ? maintenanceInputSchema : registerInputSchema
      ).safeParse({ ...input, recordNumber: item.input });
      expect(parsed.success, JSON.stringify(item.input)).toBe(item.valid);
      if (parsed.success)
        expect(parsed.data).toHaveProperty(
          "recordNumber",
          "normalized" in item ? item.normalized : undefined,
        );
    }
  }
  expect(registerInputSchema.parse(base)).not.toHaveProperty("recordNumber");
  expect(maintenanceInputSchema.parse(update)).not.toHaveProperty(
    "recordNumber",
  );
});
it("RN02 property: exactly valid normalized code points survive with identical content", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 0x10ffff }), { maxLength: 125 }),
      (values) => {
        const raw = values.map((x) => String.fromCodePoint(x)).join("");
        const normalized = raw.trim();
        const points = Array.from(normalized, (x) => x.codePointAt(0)!);
        const valid =
          points.length <= 120 &&
          points.every(
            (x) =>
              x > 31 &&
              !(x >= 127 && x <= 159) &&
              !(x >= 0xd800 && x <= 0xdfff),
          );
        const parsed = registerInputSchema.safeParse({
          ...base,
          recordNumber: raw,
        });
        expect(parsed.success).toBe(valid);
        if (parsed.success)
          expect(parsed.data).toHaveProperty(
            "recordNumber",
            normalized || null,
          );
      },
    ),
    { seed: 20261016, numRuns: 1000 },
  );
});
it("RN08 RN09 legacy responses may omit number but present malformed numbers are rejected", () => {
  expect(credentialSchema.parse(record)).toEqual(record);
  for (const value of [null, "000Ab-12 / 陈"])
    expect(
      credentialSchema.parse({ ...record, record_number: value }),
    ).toHaveProperty("record_number", value);
  for (const value of ["", " A ", "a\nb", 123, "x".repeat(121)])
    expect(
      credentialSchema.safeParse({ ...record, record_number: value }).success,
    ).toBe(false);
});
it("RN08 RN09 number-aware RPC selection, safe errors and explicit reply fields", async () => {
  for (const raw of [
    base,
    { ...base, recordNumber: null },
    { ...base, recordNumber: "000X" },
  ]) {
    const input = registerInputSchema.parse(raw);
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "success",
        credential: { ...record, record_number: "000X" },
      },
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;
    expect((await createRecord(client, id, input)).status).toBe("success");
    expect(rpc.mock.calls[0][0]).toBe(
      "recordNumber" in raw
        ? "create_practice_credential_with_number"
        : "create_practice_credential_with_details",
    );
    if ("recordNumber" in raw) {
      expect(rpc.mock.calls[0][1]).toHaveProperty(
        "p_record_number",
        raw.recordNumber,
      );
      rpc.mockResolvedValue({
        data: { status: "success", credential: record },
        error: null,
      });
      expect(await createRecord(client, id, input)).toEqual({
        status: "unavailable",
      });
    }
  }
  for (const raw of [update, { ...update, recordNumber: "" }]) {
    const input = maintenanceInputSchema.parse(raw);
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "conflict",
        credential: {
          ...record,
          archived_at: null,
          record_number: "winning",
        },
      },
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;
    expect((await changeRecord(client, id, input)).status).toBe("conflict");
    expect(rpc.mock.calls[0][0]).toBe(
      "recordNumber" in raw
        ? "update_practice_credential_with_number"
        : "update_practice_credential",
    );
    if ("recordNumber" in raw) {
      expect(rpc.mock.calls[0][1]).toHaveProperty("p_record_number", null);
      rpc.mockResolvedValue({
        data: {
          status: "conflict",
          credential: { ...record, archived_at: null },
        },
        error: null,
      });
      expect(await changeRecord(client, id, input)).toEqual({
        status: "unavailable",
      });
      rpc.mockResolvedValue({
        data: { status: "invalid", errors: { recordNumber: "private number" } },
        error: null,
      });
      expect(await changeRecord(client, id, input)).toEqual({
        status: "unavailable",
      });
    }
  }
});
