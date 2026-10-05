import { expect, it, vi, beforeEach } from "vitest";
const boundary = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => boundary);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { joinAction } from "@/app/join/actions";
import { teamAction } from "@/app/practice/team/actions";
import { generateInvitation } from "@/lib/team/invitations";
const id = "10000000-0000-4000-8000-000000000001";
function form(values: Record<string, string | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value!);
  return data;
}
function client(data: unknown, error: unknown = null) {
  const single = vi
    .fn()
    .mockResolvedValueOnce({ data: { id }, error: null })
    .mockResolvedValueOnce({
      data: { practice_id: id, role: "administrator", version: 1 },
      error: null,
    });
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: single };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  const c = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "verified" } }, error: null }),
    },
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue({ data, error }),
  };
  boundary.createClient.mockResolvedValue(c);
  return c;
}
beforeEach(() => vi.resetAllMocks());
it("S18 preview and accept are separate explicit server actions", async () => {
  const link = generateInvitation(),
    c = client({
      status: "success",
      name: "Cedar Clinic",
      role: "manager",
      expires_at: "2026-10-12T00:00:00Z",
    });
  expect(
    await joinAction(
      { status: "idle" },
      form({ token: link.token, intent: "preview" }),
    ),
  ).toMatchObject({ status: "success", name: "Cedar Clinic" });
  expect(c.rpc).toHaveBeenCalledWith("preview_practice_invitation", {
    p_token_digest: link.digest,
  });
  client({ status: "success", practiceId: id, role: "manager" });
  expect(
    await joinAction(
      { status: "idle" },
      form({ token: link.token, intent: "accept" }),
    ),
  ).toMatchObject({ status: "success", practiceId: id });
});
it("S09 S42 team actions preserve every successful persisted projection and truthful message", async () => {
  const invitation = {
    id,
    email: "valid@example.test",
    role: "viewer",
    state: "pending",
    version: 13,
    expires_at: "2026-10-12T00:00:00Z",
  };
  for (const [intent, message] of [
    ["create", "Invitation link created."],
    ["reissue", "Invitation link created."],
    ["cancel", "Invitation canceled."],
    ["role", "Role updated."],
    ["revoke", "Access revoked."],
  ] as const) {
    const persisted = {
      ...invitation,
      state: intent === "cancel" ? "canceled" : "pending",
    };
    const c = client({ status: "success", invitation: persisted });
    const input =
      intent === "create"
        ? { email: invitation.email, role: "viewer" }
        : {
            id,
            expectedVersion: "12",
            ...(intent === "role" ? { role: "viewer" } : {}),
          };
    const result = await teamAction(
      { status: "idle" },
      form({ intent, ...input, $ACTION_v1: "framework" }),
    );
    expect(result).toMatchObject({ status: "success", message });
    expect(c.rpc).toHaveBeenCalledTimes(1);
    if (["create", "reissue", "cancel"].includes(intent))
      expect(result.invitation).toEqual(persisted);
    else expect(result.invitation).toBeUndefined();
  }
});
it("S09 invalid actions and scientific or decimal versions retain exact safe errors", async () => {
  const c = client({ status: "success" });
  for (const intent of [undefined, "", "unknown"])
    expect(
      await teamAction(
        { status: "idle" },
        form(intent === undefined ? {} : { intent }),
      ),
    ).toEqual({
      status: "invalid",
      message: "Check the highlighted fields.",
      errors: { form: "Choose a valid action." },
    });
  for (const expectedVersion of ["1e2", "1.5", "0", "-1", " 1 ", "2147483648"])
    expect(
      await teamAction(
        { status: "idle" },
        form({ intent: "revoke", id, expectedVersion }),
      ),
    ).toMatchObject({
      status: "invalid",
      message: "Check the highlighted fields.",
      errors: { expectedVersion: expect.any(String) },
    });
  expect(c.rpc).not.toHaveBeenCalled();
});
it("S42 join messages distinguish review granted and current membership", async () => {
  const token = generateInvitation().token;
  for (const [intent, data, message] of [
    [
      "preview",
      {
        status: "success",
        name: "Cedar",
        role: "viewer",
        expires_at: "2026-10-12T00:00:00Z",
      },
      "Review the practice and role, then accept.",
    ],
    [
      "accept",
      { status: "success", practiceId: id, role: "viewer" },
      "Practice access granted.",
    ],
    [
      "accept",
      { status: "already-member", practiceId: id, role: "viewer" },
      "You already belong to this practice.",
    ],
    [
      "accept",
      { status: "other-practice" },
      "You already belong to a practice. Your access was not changed.",
    ],
  ] as const) {
    client(data);
    expect(
      await joinAction(
        { status: "idle" },
        form({ intent, token, $ACTION_v1: "framework" }),
      ),
    ).toEqual({ ...data, message });
  }
});
it("S21 invalid join intent never authenticates or previews", async () => {
  for (const intent of [undefined, "", "unknown"])
    expect(
      await joinAction(
        { status: "idle" },
        form(intent === undefined ? {} : { intent }),
      ),
    ).toEqual({
      status: "invalid-invitation",
      message:
        "This invitation is unavailable. Ask an administrator for a new link.",
    });
  expect(boundary.createClient).not.toHaveBeenCalled();
});
it("S43 team setup failure and expired join/team authentication cannot claim success", async () => {
  boundary.createClient.mockRejectedValue(new Error("private"));
  expect(
    await teamAction(
      { status: "idle" },
      form({ intent: "revoke", id, expectedVersion: "1" }),
    ),
  ).toEqual({
    status: "unavailable",
    message: "We could not complete this request. Try again.",
  });
  const c = client({ status: "success" });
  c.auth.getUser.mockResolvedValue({
    data: { user: null },
    error: null,
  } as never);
  await expect(
    joinAction(
      { status: "idle" },
      form({ intent: "preview", token: generateInvitation().token }),
    ),
  ).rejects.toThrow(/^REDIRECT:\/join$/);
  const next = client({ status: "success" });
  next.auth.getUser.mockResolvedValue({
    data: { user: null },
    error: null,
  } as never);
  await expect(
    teamAction(
      { status: "idle" },
      form({ intent: "revoke", id, expectedVersion: "1" }),
    ),
  ).rejects.toThrow(/^REDIRECT:\/login$/);
});
it("S42 every typed team denial has its exact public message", async () => {
  for (const [status, message] of [
    ["forbidden", "You do not have permission to do that."],
    [
      "invite-exists",
      "A pending invitation already exists for this email. Cancel or reissue it.",
    ],
    ["unavailable", "We could not complete this request. Try again."],
  ]) {
    client({ status });
    expect(
      await teamAction(
        { status: "idle" },
        form({ intent: "create", email: "valid@example.test", role: "viewer" }),
      ),
    ).toEqual({ status, message });
  }
});
it("S21 all invalid invitation responses are neutral and contain no private details", async () => {
  const link = generateInvitation();
  client({ status: "invalid-invitation" });
  expect(
    await joinAction(
      { status: "idle" },
      form({ token: link.token, intent: "accept" }),
    ),
  ).toEqual({
    status: "invalid-invitation",
    message:
      "This invitation is unavailable. Ask an administrator for a new link.",
  });
  const c = client({ status: "success", practiceId: id, role: "manager" });
  expect(
    (
      await joinAction(
        { status: "idle" },
        form({ token: link.token, intent: "accept", actor: "forged" }),
      )
    ).status,
  ).toBe("invalid-invitation");
  expect(c.rpc).not.toHaveBeenCalled();
});
it("S43 join transport or client setup failures never disclose exception", async () => {
  boundary.createClient.mockRejectedValue(new Error("private failure"));
  expect(
    await joinAction(
      { status: "idle" },
      form({ token: "bad", intent: "preview" }),
    ),
  ).toEqual({
    status: "unavailable",
    message: "We could not complete this request. Try again.",
  });
});
it("S09 team form rejects unknown intent or malformed version before RPC", async () => {
  const c = client({ status: "success" });
  for (const input of [
    { intent: "forged" },
    { intent: "revoke", id, expectedVersion: "01" },
    { intent: "role", id, expectedVersion: "1", role: "owner" },
  ]) {
    expect((await teamAction({ status: "idle" }, form(input))).status).toBe(
      "invalid",
    );
  }
  expect(c.rpc).not.toHaveBeenCalled();
});
it("S14 S35 team conflicts and final administrator failures use precise messages", async () => {
  for (const [status, message] of [
    ["conflict", "This access record changed. Reload before trying again."],
    [
      "last-administrator",
      "Add another administrator before removing this access.",
    ],
  ]) {
    client({ status });
    expect(
      await teamAction(
        { status: "idle" },
        form({ intent: "revoke", id, expectedVersion: "1" }),
      ),
    ).toEqual({ status, message });
  }
});
