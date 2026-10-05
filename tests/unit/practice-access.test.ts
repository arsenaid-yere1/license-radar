import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPracticeAccess } from "@/lib/practice/access";
function client(profile: unknown, member: unknown) {
  const single = vi
    .fn()
    .mockResolvedValueOnce(profile)
    .mockResolvedValueOnce(member);
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: single };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;
}
it.each(["administrator", "manager", "viewer"])(
  "S33 current access derives %s role and version from live membership",
  async (role) => {
    const c = client(
      { data: { id: "practice", name: "Cedar" }, error: null },
      { data: { practice_id: "practice", role, version: 2 }, error: null },
    );
    expect(await getPracticeAccess(c)).toEqual({
      status: "success",
      access: {
        practice: { id: "practice", name: "Cedar" },
        role,
        membershipVersion: 2,
      },
    });
    expect(c.from).toHaveBeenCalledWith("practice_memberships");
  },
);
it("S38 revoked membership never receives owner fallback", async () => {
  expect(
    await getPracticeAccess(client({ data: null, error: null }, null)),
  ).toEqual({ status: "success", access: null });
});
it("S43 inconsistent and unavailable reads fail closed", async () => {
  for (const member of [
    { data: null, error: null },
    {
      data: { practice_id: "foreign", role: "administrator", version: 1 },
      error: null,
    },
    {
      data: { practice_id: "practice", role: "owner", version: 1 },
      error: null,
    },
    { data: null, error: { code: "network" } },
  ]) {
    expect(
      await getPracticeAccess(
        client({ data: { id: "practice" }, error: null }, member),
      ),
    ).toEqual({ status: "unavailable" });
  }
});
it("S43 thrown access transport remains unavailable", async () => {
  expect(
    await getPracticeAccess({
      from: () => {
        throw new Error("private");
      },
    } as unknown as SupabaseClient),
  ).toEqual({ status: "unavailable" });
});
