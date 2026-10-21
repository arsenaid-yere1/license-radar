// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readEvidence,
  reserveEvidence,
  removeEvidence,
} from "@/lib/evidence/repository";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  other = "bbbbbbbb-0000-4000-8000-000000000002";
const page = {
  status: "success",
  credentialId: id,
  cycleId: id,
  title: "Policy",
  archivedAt: null,
  current: true,
  cycle: {
    id,
    cycleNumber: 1,
    dateRevision: 1,
    type: "malpractice_policy",
    endDate: "2030-03-02",
    actionDeadline: null,
    completedAt: null,
    successorId: null,
    progress: "not-started",
    acknowledgedAt: null,
  },
  files: [],
  notices: [],
};
it("EV01 EV02 exact authenticated RPC contract and binding rejects unrelated projections", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: page, error: null }),
    client = { rpc } as unknown as SupabaseClient;
  expect(await readEvidence(client, id, id, id)).toEqual(page);
  expect(rpc).toHaveBeenLastCalledWith("get_renewal_evidence", {
    p_practice_id: id,
    p_credential_id: id,
    p_cycle_id: id,
  });
  for (const data of [
    { ...page, credentialId: other },
    { ...page, cycleId: other, cycle: { ...page.cycle, id: other } },
    null,
    { status: "unexpected" },
    { status: "" },
  ]) {
    rpc.mockResolvedValue({ data, error: null });
    expect(await readEvidence(client, id, id, id)).toEqual({
      status: "unavailable",
    });
  }
  for (const status of ["invalid", "not-found", "forbidden", "unavailable"]) {
    rpc.mockResolvedValue({ data: { status }, error: null });
    expect(await readEvidence(client, id, id, id)).toEqual({ status });
  }
  for (const code of ["42501", "XX000"]) {
    rpc.mockResolvedValue({ data: null, error: { code } });
    expect(await readEvidence(client, id, id, id)).toEqual({
      status: code === "42501" ? "forbidden" : "unavailable",
    });
  }
  rpc.mockRejectedValue(new Error("network"));
  expect(await readEvidence(client, id, id, id)).toEqual({
    status: "unavailable",
  });
});
it("EV03 EV04 EV06 upload and removal send only the checked immutable input", async () => {
  const result = { status: "success", evidenceId: other, state: "pending" },
    rpc = vi.fn().mockResolvedValue({ data: result, error: null }),
    client = { rpc } as unknown as SupabaseClient;
  const file = {
    filename: "proof.pdf",
    mime: "application/pdf",
    byteCount: 8,
    digest: "a".repeat(64),
  };
  expect(await reserveEvidence(client, id, id, id, other, file)).toEqual(
    result,
  );
  expect(rpc).toHaveBeenLastCalledWith("reserve_renewal_evidence", {
    p_practice_id: id,
    p_credential_id: id,
    p_cycle_id: id,
    p_request_id: other,
    p_filename: file.filename,
    p_mime: file.mime,
    p_byte_count: 8,
    p_digest: file.digest,
  });
  const removal = {
    requestId: id,
    expectedVersion: 2,
    confirmed: true as const,
  };
  expect(await removeEvidence(client, id, id, id, other, removal)).toEqual(
    result,
  );
  expect(rpc).toHaveBeenLastCalledWith("remove_renewal_evidence", {
    p_practice_id: id,
    p_credential_id: id,
    p_cycle_id: id,
    p_evidence_id: other,
    p_request_id: id,
    p_expected_version: 2,
    p_confirmed: true,
  });
  rpc.mockResolvedValue({ data: { status: "unknown" }, error: null });
  expect(await reserveEvidence(client, id, id, id, other, file)).toEqual({
    status: "unavailable",
  });
  expect(await removeEvidence(client, id, id, id, other, removal)).toEqual({
    status: "unavailable",
  });
  for (const code of ["42501", "XX000"]) {
    rpc.mockResolvedValue({ data: null, error: { code } });
    const expected = { status: code === "42501" ? "forbidden" : "unavailable" };
    expect(await reserveEvidence(client, id, id, id, other, file)).toEqual(
      expected,
    );
    expect(await removeEvidence(client, id, id, id, other, removal)).toEqual(
      expected,
    );
  }
});
