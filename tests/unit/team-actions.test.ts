import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { manageTeam, joinPractice } from "@/lib/team/operations";
import {
  generateInvitation,
  hashInvitationToken,
} from "@/lib/team/invitations";
import { getTeam, rpcBoundary } from "@/lib/team/repository";
const id = "10000000-0000-4000-8000-000000000001";
const invitation = {
  id,
  email: "valid@example.test",
  role: "manager",
  state: "pending",
  version: 1,
  expires_at: "2026-10-12T00:00:00+00:00",
};
function client(
  role = "administrator",
  reply: unknown = { data: { status: "success", invitation }, error: null },
) {
  const single = vi
    .fn()
    .mockResolvedValueOnce({ data: { id }, error: null })
    .mockResolvedValueOnce({
      data: { practice_id: id, role, version: 1 },
      error: null,
    });
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: single };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "verified" } }, error: null }),
    },
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockResolvedValue(reply),
  } as unknown as SupabaseClient;
}
it("S08 server derives practice and exposes token only for persisted creation", async () => {
  const c = client(),
    result = await manageTeam(c, "create", {
      email: " Valid@Example.test ",
      role: "manager",
    });
  expect(result.status).toBe("success");
  expect(result.invitation).toEqual(invitation);
  expect(c.rpc).toHaveBeenCalledWith("create_practice_invitation", {
    p_practice_id: id,
    p_email: "valid@example.test",
    p_role: "manager",
    p_token_digest: hashInvitationToken(result.token),
  });
});
it("S43 team repository validates projections and distinguishes permission conflict and transport failures", async () => {
  const team = {
    members: [
      {
        id,
        email: "member@example.test",
        role: "viewer",
        state: "active",
        version: 2,
      },
    ],
    invitations: [invitation],
  };
  const c = client("administrator", {
    data: { ...team, token: "never expose" },
    error: null,
  });
  expect(await getTeam(c, id)).toEqual({ status: "success", team });
  expect(c.rpc).toHaveBeenCalledWith("list_practice_team", {
    p_practice_id: id,
  });
  for (const reply of [
    { data: null, error: null },
    {
      data: { members: [], invitations: [{ ...invitation, role: "owner" }] },
      error: null,
    },
    {
      data: { ...team, members: [{ ...team.members[0], version: 0 }] },
      error: null,
    },
  ])
    expect(await getTeam(client("administrator", reply), id)).toEqual({
      status: "unavailable",
    });
  for (const [code, status] of [
    ["42501", "forbidden"],
    ["PT409", "conflict"],
    ["network", "unavailable"],
  ])
    expect(
      await getTeam(
        client("administrator", { data: null, error: { code } }),
        id,
      ),
    ).toEqual({ status });
  for (const status of [
    "forbidden",
    "conflict",
    "unavailable",
    "auth-required",
    "last-administrator",
    "invite-exists",
    "other-practice",
    "invalid-invitation",
  ])
    expect(
      await rpcBoundary(
        client("administrator", {
          data: { status, private: "secret" },
          error: null,
        }),
        "command",
        {},
      ),
    ).toEqual({ status });
  const thrown = client();
  vi.mocked(thrown.rpc).mockRejectedValue(new Error("private"));
  expect(await getTeam(thrown, id)).toEqual({ status: "unavailable" });
});
it("S43 absent user membership or Auth transport never reaches team writes", async () => {
  for (const auth of [
    { data: { user: null }, error: null },
    new Error("private"),
  ]) {
    const c = client();
    if (auth instanceof Error)
      vi.mocked(c.auth.getUser).mockRejectedValue(auth);
    else vi.mocked(c.auth.getUser).mockResolvedValue(auth as never);
    expect(
      await manageTeam(c, "create", {
        email: "valid@example.test",
        role: "viewer",
      }),
    ).toEqual({
      status: auth instanceof Error ? "unavailable" : "auth-required",
    });
    expect(c.rpc).not.toHaveBeenCalled();
    expect(
      await joinPractice(c, { token: generateInvitation().token }, false),
    ).toEqual({
      status: auth instanceof Error ? "unavailable" : "auth-required",
    });
  }
  for (const reply of [
    { data: null, error: { code: "network" } },
    { data: null, error: null },
  ]) {
    const c = client(),
      chain = vi.mocked(c.from).mock.results[0]?.value;
    void chain;
    const query = c.from("practices").select("*");
    vi.mocked(query.maybeSingle)
      .mockReset()
      .mockResolvedValueOnce(reply as never);
    expect(
      await manageTeam(c, "create", {
        email: "valid@example.test",
        role: "viewer",
      }),
    ).toEqual({ status: reply.error ? "unavailable" : "forbidden" });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it("S09 invalid target versions cannot mutate and malformed mutation replies cannot claim success", async () => {
  for (const intent of ["reissue", "cancel", "role", "revoke"] as const) {
    const c = client();
    expect(
      await manageTeam(c, intent, {
        id,
        expectedVersion: 0,
        ...(intent === "role" ? { role: "viewer" } : {}),
      }),
    ).toMatchObject({
      status: "invalid",
      errors: { expectedVersion: expect.any(String) },
    });
    expect(c.rpc).not.toHaveBeenCalled();
    expect(
      await manageTeam(
        client("administrator", { data: { status: "unknown" }, error: null }),
        intent,
        {
          id,
          expectedVersion: 1,
          ...(intent === "role" ? { role: "viewer" } : {}),
        },
      ),
    ).toEqual({ status: "unavailable" });
  }
});
it("S13 mutation arguments bind the exact target and return raw link only for reissue", async () => {
  for (const intent of ["role", "revoke", "cancel", "reissue"] as const) {
    const c = client(),
      result = await manageTeam(c, intent, {
        id,
        expectedVersion: 2,
        ...(intent === "role" ? { role: "viewer" } : {}),
      });
    const args = vi.mocked(c.rpc).mock.calls[0][1];
    expect(args).toEqual({
      [intent === "role" || intent === "revoke"
        ? "p_membership_id"
        : "p_invitation_id"]: id,
      p_expected_version: 2,
      ...(intent === "role" ? { p_role: "viewer" } : {}),
      ...(intent === "reissue"
        ? { p_token_digest: hashInvitationToken(result.token) }
        : {}),
    });
    if (intent === "reissue")
      expect(hashInvitationToken(result.token)).not.toBeNull();
    else expect(result.token).toBeUndefined();
  }
});
it("S18 S25 accepted responses use current role and reject malformed or private reply fields", async () => {
  const token = generateInvitation().token;
  for (const status of ["success", "already-member"])
    expect(
      await joinPractice(
        client("viewer", {
          data: { status, practiceId: id, role: "viewer", token: "private" },
          error: null,
        }),
        { token },
        true,
      ),
    ).toEqual({ status, practiceId: id, role: "viewer" });
  for (const data of [
    { status: "success", practiceId: "bad", role: "viewer" },
    {
      status: "success",
      name: "Cedar",
      role: "owner",
      expires_at: invitation.expires_at,
    },
  ])
    expect(
      await joinPractice(
        client("viewer", { data, error: null }),
        { token },
        "name" in data ? false : true,
      ),
    ).toEqual({ status: "unavailable" });
  expect(
    await joinPractice(
      client("viewer", {
        data: { status: "other-practice", name: "private" },
        error: null,
      }),
      { token },
      true,
    ),
  ).toEqual({ status: "other-practice" });
});
it("S09 hostile actor/practice fields reject before writes", async () => {
  const c = client();
  expect(
    (
      await manageTeam(c, "create", {
        email: "valid@example.test",
        role: "manager",
        practiceId: "foreign",
      })
    ).status,
  ).toBe("invalid");
  expect(c.rpc).not.toHaveBeenCalled();
});
it.each(["manager", "viewer"])("S33 %s cannot manage team", async (role) => {
  const c = client(role);
  expect(
    (
      await manageTeam(c, "create", {
        email: "valid@example.test",
        role: "manager",
      })
    ).status,
  ).toBe("forbidden");
  expect(c.rpc).not.toHaveBeenCalled();
});
it("S14 stale and domain denials preserve outcomes and never expose token", async () => {
  for (const status of ["conflict", "invite-exists", "last-administrator"]) {
    const result = await manageTeam(
      client("administrator", { data: { status }, error: null }),
      "create",
      { email: "valid@example.test", role: "manager" },
    );
    expect(result).toEqual({ status });
  }
});
it("S43 RPC errors and missing creation metadata never claim success", async () => {
  for (const reply of [
    { data: null, error: { code: "network", message: "private" } },
    { data: { status: "success" }, error: null },
  ])
    expect(
      await manageTeam(client("administrator", reply), "create", {
        email: "valid@example.test",
        role: "manager",
      }),
    ).toEqual({ status: "unavailable" });
  expect(
    await manageTeam(
      client("administrator", { data: null, error: { code: "42501" } }),
      "create",
      { email: "valid@example.test", role: "manager" },
    ),
  ).toEqual({ status: "forbidden" });
});
it("S13 S34 valid versioned mutations use only target ID, version and role/digest", async () => {
  for (const intent of ["reissue", "cancel", "role", "revoke"] as const) {
    const c = client(),
      raw = {
        id,
        expectedVersion: 1,
        ...(intent === "role" ? { role: "viewer" } : {}),
      };
    expect((await manageTeam(c, intent, raw)).status).toBe("success");
    const [name, args] = vi.mocked(c.rpc).mock.calls[0];
    expect(name).toBe(
      {
        reissue: "reissue_practice_invitation",
        cancel: "cancel_practice_invitation",
        role: "change_practice_member_role",
        revoke: "revoke_practice_member",
      }[intent],
    );
    expect(args).toMatchObject({ p_expected_version: 1 });
    expect(
      Object.keys(args!).some((key) => /actor|user|practice/.test(key)),
    ).toBe(false);
  }
});
it("S43 auth outages and expiry fail safely before writes", async () => {
  for (const [error, status] of [
    [{ status: 401 }, "auth-required"],
    [{ status: 503 }, "unavailable"],
  ] as const) {
    const c = client();
    vi.mocked(c.auth.getUser).mockResolvedValue({
      data: { user: null },
      error,
    } as never);
    expect(
      await manageTeam(c, "create", {
        email: "valid@example.test",
        role: "manager",
      }),
    ).toEqual({ status });
    expect(c.rpc).not.toHaveBeenCalled();
  }
});
it("S20 S21 join hashes canonical tokens and denies malformed/extra identity uniformly", async () => {
  const link = generateInvitation(),
    c = client("viewer", {
      data: {
        status: "success",
        name: "Cedar Clinic",
        role: "manager",
        expires_at: invitation.expires_at,
      },
      error: null,
    });
  expect(await joinPractice(c, { token: link.token }, false)).toMatchObject({
    status: "success",
    name: "Cedar Clinic",
  });
  expect(c.rpc).toHaveBeenCalledWith("preview_practice_invitation", {
    p_token_digest: link.digest,
  });
  for (const raw of [{ token: "bad" }, { token: link.token, email: "forged" }])
    expect(await joinPractice(c, raw, true)).toEqual({
      status: "invalid-invitation",
    });
});
it("S17 minimal team projection preserves accepted canceled and revoked history", async () => {
  const team = {
    members: [
      {
        id,
        email: "member@example.test",
        role: "viewer",
        state: "revoked",
        version: 3,
      },
    ],
    invitations: [
      { ...invitation, state: "accepted" },
      { ...invitation, state: "canceled" },
    ],
  };
  expect(
    await getTeam(client("administrator", { data: team, error: null }), id),
  ).toEqual({ status: "success", team });
});
it("S12 cancellation preserves its persisted invitation metadata and never returns a token", async () => {
  const canceled = { ...invitation, state: "canceled", version: 2 };
  expect(
    await manageTeam(
      client("administrator", {
        data: { status: "success", invitation: canceled },
        error: null,
      }),
      "cancel",
      { id, expectedVersion: 1 },
    ),
  ).toEqual({ status: "success", invitation: canceled });
});
it("S18 explicit acceptance calls only the digest-bound accept RPC", async () => {
  const link = generateInvitation(),
    c = client("viewer", {
      data: { status: "success", practiceId: id, role: "viewer" },
      error: null,
    });
  expect(await joinPractice(c, { token: link.token }, true)).toEqual({
    status: "success",
    practiceId: id,
    role: "viewer",
  });
  expect(c.rpc).toHaveBeenCalledExactlyOnceWith("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
});
