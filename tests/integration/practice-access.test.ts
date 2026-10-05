import { afterAll, expect, it } from "vitest";
import { account, pool } from "../helpers/local-fixtures";
import { anonymous } from "../helpers/local-fixtures";
import {
  capability,
  events,
  invite,
  membership,
  practice,
} from "../helpers/access-fixtures";
afterAll(() => pool.end());

it("S38 public creator revocation removes existing JWT authority and preserves provenance and another practice", async () => {
  const a = await practice(),
    q = await practice("Birch Clinic"),
    d = await account(),
    link = await invite(a, d.email, "administrator");
  expect(
    (
      await d.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).data.status,
  ).toBe("success");
  const creator = await membership(a.practice.id, a.user.id);
  expect(
    (
      await d.client.rpc("revoke_practice_member", {
        p_membership_id: creator.id,
        p_expected_version: 1,
      })
    ).data,
  ).toEqual({ status: "success" });
  expect(await membership(a.practice.id, a.user.id)).toMatchObject({
    id: creator.id,
    state: "revoked",
    version: 2,
  });
  const before = await events(a.practice.id);
  expect((await a.client.from("practices").select("*")).data).toEqual([]);
  expect(
    (await a.client.from("practice_memberships").select("*")).data,
  ).toEqual([]);
  expect(
    (await a.client.rpc("list_practice_team", { p_practice_id: a.practice.id }))
      .error?.code,
  ).toBe("42501");
  expect(
    (
      await a.client.rpc("update_practice", {
        p_practice_id: a.practice.id,
        p_name: "Attacked",
        p_timezone: "UTC",
        p_expected_version: 1,
      })
    ).error?.code,
  ).toBe("42501");
  expect(await events(a.practice.id)).toEqual(before);
  expect((await d.client.from("practices").select("*")).data).toEqual([
    a.practice,
  ]);
  expect((await q.client.from("practices").select("*")).data).toEqual([
    q.practice,
  ]);
  const next = await a.client.rpc("create_practice", {
    p_name: "New Practice",
    p_timezone: "UTC",
  });
  expect(next.error).toBeNull();
  expect(next.data.id).not.toBe(a.practice.id);
  expect(next.data.owner_user_id).toBe(a.user.id);
  expect((await d.client.from("practices").select("*")).data).toEqual([
    a.practice,
  ]);
});

async function create() {
  const actor = await account();
  const result = await actor.client.rpc("create_practice", {
    p_name: "Cedar Clinic",
    p_timezone: "UTC",
  });
  expect(result.error).toBeNull();
  expect(result.data).toMatchObject({ name: "Cedar Clinic", version: 1 });
  return { ...actor, practice: result.data };
}

it("S04 concurrent RPC creation produces one practice, membership and each audit", async () => {
  const a = await account();
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      a.client.rpc("create_practice", {
        p_name: "Cedar Clinic",
        p_timezone: "UTC",
      }),
    ),
  );
  expect(results.every((r) => !r.error)).toBe(true);
  expect(new Set(results.map((r) => r.data?.id)).size).toBe(1);
  const id = results[0].data.id;
  const counts = await pool.query(
    "select (select count(*)::int from public.practice_memberships where practice_id=$1) members, (select count(*)::int from private.practice_access_events where practice_id=$1) access_events, (select count(*)::int from private.practice_audit_events where practice_id=$1) profile_events",
    [id],
  );
  expect(counts.rows[0]).toEqual({
    members: 1,
    access_events: 1,
    profile_events: 1,
  });
  expect(
    (
      await a.client.rpc("create_practice", {
        p_name: "Different",
        p_timezone: "UTC",
      })
    ).data,
  ).toEqual(results[0].data);
});

it("A01 S33 all roles and guessed foreign IDs deny unauthorized team writes and private data", async () => {
  const a = await practice(),
    foreign = await practice("Birch Clinic"),
    member = await membership(a.practice.id, a.user.id),
    link = await invite(a, (await account()).email);
  const actors = [foreign.client, anonymous()];
  for (const role of ["manager", "viewer"]) {
    const b = await account(),
      invitation = await invite(a, b.email, role);
    expect(
      (
        await b.client.rpc("accept_practice_invitation", {
          p_token_digest: invitation.digest,
        })
      ).data.status,
    ).toBe("success");
    expect((await b.client.from("practices").select("*")).data).toEqual([
      a.practice,
    ]);
    expect(
      (await b.client.from("practice_memberships").select("*")).data,
    ).toHaveLength(1);
    actors.push(b.client);
  }
  const revoked = await account(),
    revokedLink = await invite(a, revoked.email, "administrator");
  await revoked.client.rpc("accept_practice_invitation", {
    p_token_digest: revokedLink.digest,
  });
  const revokedMember = await membership(a.practice.id, revoked.user.id);
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: revokedMember.id,
        p_expected_version: 1,
      })
    ).data.status,
  ).toBe("success");
  expect((await revoked.client.from("practices").select("*")).data).toEqual([]);
  actors.push(revoked.client);
  const before = await events(a.practice.id);
  for (const client of actors) {
    for (const [rpc, args] of [
      ["list_practice_team", { p_practice_id: a.practice.id }],
      [
        "create_practice_invitation",
        {
          p_practice_id: a.practice.id,
          p_email: "forged@example.test",
          p_role: "administrator",
          p_token_digest: capability().digest,
        },
      ],
      [
        "cancel_practice_invitation",
        { p_invitation_id: link.invitation.id, p_expected_version: 1 },
      ],
      [
        "reissue_practice_invitation",
        {
          p_invitation_id: link.invitation.id,
          p_expected_version: 1,
          p_token_digest: capability().digest,
        },
      ],
      [
        "change_practice_member_role",
        { p_membership_id: member.id, p_expected_version: 1, p_role: "viewer" },
      ],
      [
        "revoke_practice_member",
        { p_membership_id: member.id, p_expected_version: 1 },
      ],
      [
        "update_practice",
        {
          p_practice_id: a.practice.id,
          p_name: "Attacked",
          p_timezone: "UTC",
          p_expected_version: 1,
        },
      ],
    ] as const) {
      const result = await client.rpc(rpc, args);
      expect(result.error?.code).toBe("42501");
      expect(result.data).toBeNull();
    }
    for (const table of [
      "practice_invitations",
      "practice_access_events",
      "practice_audit_events",
    ]) {
      const result = await client.schema("private").from(table).select("*");
      expect(result.error).not.toBeNull();
      expect(result.data).toBeNull();
    }
    expect(
      (
        await client.from("practice_memberships").insert({
          practice_id: a.practice.id,
          user_id: foreign.user.id,
          role: "administrator",
        })
      ).error,
    ).not.toBeNull();
    expect(
      (await client.from("practice_memberships").delete().eq("id", member.id))
        .error,
    ).not.toBeNull();
  }
  expect(await events(a.practice.id)).toEqual(before);
  expect((await membership(a.practice.id, a.user.id)).role).toBe(
    "administrator",
  );
  expect(
    (await a.client.rpc("list_practice_team", { p_practice_id: a.practice.id }))
      .error,
  ).toBeNull();
  expect(
    (
      await a.client.rpc("list_practice_team", {
        p_practice_id: foreign.practice.id,
      })
    ).error?.code,
  ).toBe("42501");
});

it("A02 forged metadata and RPC actor fields never elevate verified staff", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email, "viewer");
  await b.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
  expect(
    (
      await b.client.auth.updateUser({
        data: {
          role: "administrator",
          practice_id: a.practice.id,
          owner_user_id: a.user.id,
        },
      })
    ).error,
  ).toBeNull();
  const before = await events(a.practice.id);
  expect(
    (await b.client.rpc("list_practice_team", { p_practice_id: a.practice.id }))
      .error?.code,
  ).toBe("42501");
  for (const extra of [
    { p_actor_user_id: a.user.id },
    { p_owner_user_id: a.user.id },
    { p_role: "administrator" },
  ]) {
    const r = await b.client.rpc("update_practice", {
      p_practice_id: a.practice.id,
      p_name: "Attacked",
      p_timezone: "UTC",
      p_expected_version: 1,
      ...extra,
    });
    expect(r.error).not.toBeNull();
    expect(r.data).toBeNull();
  }
  const member = await membership(a.practice.id, b.user.id);
  for (const version of [null, 0, -1])
    expect(
      (
        await a.client.rpc("change_practice_member_role", {
          p_membership_id: member.id,
          p_expected_version: version,
          p_role: "administrator",
        })
      ).error?.code,
    ).toBe("23514");
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: "A".repeat(64),
      })
    ).data,
  ).toEqual({ status: "invalid-invitation" });
  expect(await events(a.practice.id)).toEqual(before);
  expect((await membership(a.practice.id, b.user.id)).role).toBe("viewer");
});

it("A05 minimal roster and invitation errors expose no tokens or Auth metadata", async () => {
  const a = await practice(),
    b = await account(),
    stranger = await account(),
    link = await invite(a, b.email);
  const team = (
    await a.client.rpc("list_practice_team", { p_practice_id: a.practice.id })
  ).data;
  expect(Object.keys(team.members[0]).sort()).toEqual([
    "email",
    "id",
    "role",
    "state",
    "version",
  ]);
  expect(Object.keys(team.invitations[0]).sort()).toEqual([
    "email",
    "expires_at",
    "id",
    "role",
    "state",
    "version",
  ]);
  expect(JSON.stringify(team).includes(link.token)).toBe(false);
  expect(JSON.stringify(team).includes(link.digest)).toBe(false);
  for (const rpc of [
    "preview_practice_invitation",
    "accept_practice_invitation",
  ]) {
    const result = await stranger.client.rpc(rpc, {
      p_token_digest: link.digest,
    });
    expect(result.data).toEqual({ status: "invalid-invitation" });
    expect(result.error).toBeNull();
  }
  const columns = (
    await pool.query(
      "select column_name from information_schema.columns where table_schema='private' and table_name='practice_invitations'",
    )
  ).rows.map((r) => r.column_name);
  expect(columns).toContain("token_digest");
  expect(columns.some((name) => /raw|^token$/.test(name))).toBe(false);
});

it("S05 S33 N05 direct writes denied and manager reads shared profile only", async () => {
  const a = await create(),
    b = await account();
  await pool.query(
    "insert into public.practice_memberships(practice_id,user_id,role) values($1,$2,'manager')",
    [a.practice.id, b.user.id],
  );
  expect((await b.client.from("practices").select("*")).data).toEqual([
    a.practice,
  ]);
  expect(
    (await b.client.from("practice_memberships").select("*")).data,
  ).toHaveLength(1);
  expect(
    (
      await b.client.rpc("create_practice", {
        p_name: "Birch Clinic",
        p_timezone: "UTC",
      })
    ).data,
  ).toEqual(a.practice);
  for (const actor of [a, b]) {
    expect(
      (
        await actor.client
          .from("practices")
          .insert({ name: "Attacked", timezone: "UTC" })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await actor.client
          .from("practices")
          .update({ name: "Attacked" })
          .eq("id", a.practice.id)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await actor.client
          .from("practice_memberships")
          .update({ role: "administrator" })
          .eq("user_id", b.user.id)
      ).error,
    ).not.toBeNull();
  }
  expect(
    (
      await b.client.rpc("update_practice", {
        p_practice_id: a.practice.id,
        p_name: "Attacked",
        p_timezone: "UTC",
        p_expected_version: 1,
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await pool.query(
        "select name,version from public.practices where id=$1",
        [a.practice.id],
      )
    ).rows[0],
  ).toEqual({ name: "Cedar Clinic", version: 1 });
});

it("N02 active-user constraint rejects a second active practice at the storage boundary", async () => {
  const a = await practice(),
    q = await practice("Birch Clinic"),
    b = await account(),
    link = await invite(a, b.email);
  await b.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
  const db = await pool.connect();
  try {
    await db.query("begin");
    await expect(
      db.query(
        "insert into public.practice_memberships(practice_id,user_id,role) values($1,$2,'viewer')",
        [q.practice.id, b.user.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  } finally {
    await db.query("rollback");
    db.release();
  }
  expect((await b.client.from("practices").select("*")).data).toEqual([
    a.practice,
  ]);
});

it("S37 deferred invariant rejects last administrator loss and orphan creation", async () => {
  const a = await create();
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query(
      "update public.practice_memberships set role='viewer' where practice_id=$1",
      [a.practice.id],
    );
    await expect(
      db.query("set constraints all immediate"),
    ).rejects.toMatchObject({ code: "23514" });
    await db.query("rollback");
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      a.user.id,
    ]);
    await db.query(
      "insert into public.practices(name,timezone) values('Orphan','UTC')",
    );
    await expect(
      db.query("set constraints all immediate"),
    ).rejects.toMatchObject({ code: "23514" });
  } finally {
    await db.query("rollback");
    db.release();
  }
});

it("S06 S38 creator provenance never restores access with the existing JWT", async () => {
  const a = await create(),
    d = await account();
  await pool.query(
    "insert into public.practice_memberships(practice_id,user_id,role) values($1,$2,'administrator')",
    [a.practice.id, d.user.id],
  );
  await pool.query(
    "update public.practice_memberships set state='revoked',revoked_at=clock_timestamp(),version=version+1 where practice_id=$1 and user_id=$2",
    [a.practice.id, a.user.id],
  );
  expect((await a.client.from("practices").select("*")).data).toEqual([]);
  expect(
    (
      await a.client.rpc("update_practice", {
        p_practice_id: a.practice.id,
        p_name: "Attacked",
        p_timezone: "UTC",
        p_expected_version: 1,
      })
    ).error?.code,
  ).toBe("42501");
  const next = await a.client.rpc("create_practice", {
    p_name: "New Practice",
    p_timezone: "UTC",
  });
  expect(next.error).toBeNull();
  expect(next.data.id).not.toBe(a.practice.id);
  expect((await d.client.from("practices").select("*")).data).toEqual([
    a.practice,
  ]);
});
