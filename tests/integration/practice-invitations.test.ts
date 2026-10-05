import { afterAll, expect, it } from "vitest";
import {
  account,
  capability,
  events,
  fixtureWrite,
  invite,
  membership,
  pool,
  practice,
} from "../helpers/access-fixtures";
afterAll(() => pool.end());
it("S07 S11 invalid timezone is rejected through authenticated create and update RPCs", async () => {
  const b = await account();
  expect(
    (
      await b.client.rpc("create_practice", {
        p_name: "Cedar",
        p_timezone: "Mars/Olympus",
      })
    ).error?.code,
  ).toBe("23514");
  expect((await b.client.from("practices").select("*")).data).toEqual([]);
  const a = await practice(),
    before = await events(a.practice.id);
  expect(
    (
      await a.client.rpc("update_practice", {
        p_practice_id: a.practice.id,
        p_name: "Attacked",
        p_timezone: "Mars/Olympus",
        p_expected_version: 1,
      })
    ).error?.code,
  ).toBe("23514");
  expect((await a.client.from("practices").select("*")).data).toEqual([
    a.practice,
  ]);
  expect(await events(a.practice.id)).toEqual(before);
});
it("S42 profile audit failure preserves profiles initial memberships and access events", async () => {
  const a = await practice(),
    b = await account();
  const snapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of [
      "public.practices",
      "public.practice_memberships",
      "private.practice_audit_events",
      "private.practice_access_events",
    ])
      result[table] = (
        await pool.query(`select * from ${table} order by id`)
      ).rows;
    return result;
  };
  const before = await snapshot();
  await pool.query(
    "create function private.fixture_profile_access_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture profile audit failure'; end $$;create trigger fixture_profile_access_failure before insert on private.practice_audit_events for each row execute function private.fixture_profile_access_failure()",
  );
  try {
    expect(
      (
        await b.client.rpc("create_practice", {
          p_name: "Must roll back",
          p_timezone: "UTC",
        })
      ).error?.code,
    ).toBe("P0001");
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await a.client.rpc("update_practice", {
          p_practice_id: a.practice.id,
          p_name: "Must roll back",
          p_timezone: "UTC",
          p_expected_version: 1,
        })
      ).error?.code,
    ).toBe("P0001");
    expect(await snapshot()).toEqual(before);
  } finally {
    await pool.query(
      "drop trigger fixture_profile_access_failure on private.practice_audit_events;drop function private.fixture_profile_access_failure()",
    );
  }
  expect(
    (
      await b.client.rpc("create_practice", {
        p_name: "Recovered",
        p_timezone: "UTC",
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await a.client.rpc("update_practice", {
        p_practice_id: a.practice.id,
        p_name: "Recovered",
        p_timezone: "UTC",
        p_expected_version: 1,
      })
    ).data.version,
  ).toBe(2);
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.practice_memberships where user_id=$1",
        [b.user.id],
      )
    ).rows[0].n,
  ).toBe(1);
});

it("S08 S10 S17 creates canonical digest-only invitation with exactly seven elapsed days", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, `  ${b.email.toUpperCase()}  `);
  const row = (
    await pool.query("select * from private.practice_invitations where id=$1", [
      link.invitation.id,
    ])
  ).rows[0];
  expect(row.email).toBe(b.email);
  expect(row.token_digest).toBe(link.digest);
  expect(row.expires_at.getTime() - row.issued_at.getTime()).toBe(7 * 86400000);
  expect(Object.keys(row).some((k) => /raw|^token$/.test(k))).toBe(false);
  const team = await a.client.rpc("list_practice_team", {
    p_practice_id: a.practice.id,
  });
  expect(team.error).toBeNull();
  expect(team.data.invitations[0]).toMatchObject({
    email: b.email,
    role: "manager",
  });
  expect(Object.keys(team.data.invitations[0]).sort()).toEqual([
    "email",
    "expires_at",
    "id",
    "role",
    "state",
    "version",
  ]);
  expect(
    (await b.client.rpc("list_practice_team", { p_practice_id: a.practice.id }))
      .error?.code,
  ).toBe("42501");
});
it("S09 malformed invitation inputs cannot write", async () => {
  const a = await practice(),
    link = capability(),
    before = await events(a.practice.id);
  for (const bad of [
    { p_email: "bad" },
    { p_email: "\tvalid@example.test" },
    { p_email: "valid@example.test\n" },
    { p_email: "é@example.test" },
    { p_email: "a".repeat(255) + "@example.test" },
    { p_role: "owner" },
    { p_token_digest: "bad" },
    { p_token_digest: null },
  ]) {
    expect(
      (
        await a.client.rpc("create_practice_invitation", {
          p_practice_id: a.practice.id,
          p_email: "valid@example.test",
          p_role: "manager",
          p_token_digest: link.digest,
          ...bad,
        })
      ).error?.code,
    ).toBe("23514");
  }
  expect(await events(a.practice.id)).toEqual(before);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.practice_invitations where practice_id=$1",
        [a.practice.id],
      )
    ).rows[0].n,
  ).toBe(0);
});
it("S09 S14 database mutation input checks reject invalid versions roles and nonfresh digests without writes", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email),
    before = await events(a.practice.id);
  for (const version of [null, 0, -1])
    for (const rpc of [
      "cancel_practice_invitation",
      "reissue_practice_invitation",
    ])
      expect(
        (
          await a.client.rpc(rpc, {
            p_invitation_id: link.invitation.id,
            p_expected_version: version,
            ...(rpc === "reissue_practice_invitation"
              ? { p_token_digest: capability().digest }
              : {}),
          })
        ).error?.code,
      ).toBe("23514");
  for (const digest of [null, "bad", link.digest])
    expect(
      (
        await a.client.rpc("reissue_practice_invitation", {
          p_invitation_id: link.invitation.id,
          p_expected_version: 1,
          p_token_digest: digest,
        })
      ).error?.code,
    ).toBe("23514");
  expect(await events(a.practice.id)).toEqual(before);
  expect(
    (
      await pool.query(
        "select state,version,token_digest from private.practice_invitations where id=$1",
        [link.invitation.id],
      )
    ).rows,
  ).toEqual([{ state: "pending", version: 1, token_digest: link.digest }]);
  await b.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
  const member = await membership(a.practice.id, b.user.id),
    memberBefore = await events(a.practice.id);
  for (const role of [null, "owner"])
    expect(
      (
        await a.client.rpc("change_practice_member_role", {
          p_membership_id: member.id,
          p_expected_version: 1,
          p_role: role,
        })
      ).error?.code,
    ).toBe("23514");
  for (const version of [null, 0, -1])
    expect(
      (
        await a.client.rpc("revoke_practice_member", {
          p_membership_id: member.id,
          p_expected_version: version,
        })
      ).error?.code,
    ).toBe("23514");
  expect(await membership(a.practice.id, b.user.id)).toEqual(member);
  expect(await events(a.practice.id)).toEqual(memberBefore);
});
it("S11 concurrent duplicate invitation preserves first role and audits once", async () => {
  const a = await practice(),
    b = await account();
  const results = await Promise.all(
    ["manager", "viewer"].map((role) =>
      a.client.rpc("create_practice_invitation", {
        p_practice_id: a.practice.id,
        p_email: b.email,
        p_role: role,
        p_token_digest: capability().digest,
      }),
    ),
  );
  expect(results.map((r) => r.data?.status).sort()).toEqual([
    "invite-exists",
    "success",
  ]);
  expect(
    (await events(a.practice.id)).filter(
      (e) => e.operation === "invitation_created",
    ),
  ).toHaveLength(1);
});
it("S12 cancel retry is no-op and old capability unavailable", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email);
  for (let retry = 0; retry < 2; retry++)
    expect(
      (
        await a.client.rpc("cancel_practice_invitation", {
          p_invitation_id: link.invitation.id,
          p_expected_version: 1,
        })
      ).data,
    ).toMatchObject({ status: "success" });
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).data,
  ).toEqual({ status: "invalid-invitation" });
  expect(
    (await events(a.practice.id)).filter(
      (e) => e.operation === "invitation_canceled",
    ),
  ).toHaveLength(1);
});
it("S13 S14 S15 reissue recovers lost response, rotates token and rejects stale change", async () => {
  const a = await practice(),
    b = await account(),
    old = await invite(a, b.email),
    next = capability();
  const r = await a.client.rpc("reissue_practice_invitation", {
    p_invitation_id: old.invitation.id,
    p_expected_version: 1,
    p_token_digest: next.digest,
  });
  expect(r.data).toMatchObject({
    status: "success",
    invitation: { version: 2, email: b.email, role: "manager" },
  });
  expect(
    (
      await b.client.rpc("preview_practice_invitation", {
        p_token_digest: old.digest,
      })
    ).data,
  ).toEqual({ status: "invalid-invitation" });
  expect(
    (
      await b.client.rpc("preview_practice_invitation", {
        p_token_digest: next.digest,
      })
    ).data,
  ).toMatchObject({ status: "success", name: "Cedar Clinic", role: "manager" });
  expect(
    (
      await a.client.rpc("cancel_practice_invitation", {
        p_invitation_id: old.invitation.id,
        p_expected_version: 1,
      })
    ).data,
  ).toEqual({ status: "conflict" });
});
it("S13 expired pending invitation reissue preserves identity and starts a fresh seven-day period", async () => {
  const a = await practice(),
    b = await account(),
    old = await invite(a, b.email),
    next = capability();
  await fixtureWrite(
    a.user.id,
    "update private.practice_invitations set issued_at=clock_timestamp()-interval '8 days', expires_at=clock_timestamp()-interval '1 day' where id=$1",
    [old.invitation.id],
  );
  const before = (
    await pool.query("select * from private.practice_invitations where id=$1", [
      old.invitation.id,
    ])
  ).rows[0];
  expect(
    (
      await b.client.rpc("preview_practice_invitation", {
        p_token_digest: old.digest,
      })
    ).data,
  ).toEqual({ status: "invalid-invitation" });
  expect(
    (
      await a.client.rpc("reissue_practice_invitation", {
        p_invitation_id: old.invitation.id,
        p_expected_version: 1,
        p_token_digest: next.digest,
      })
    ).data,
  ).toMatchObject({ status: "success" });
  const after = (
    await pool.query("select * from private.practice_invitations where id=$1", [
      old.invitation.id,
    ])
  ).rows[0];
  expect(after).toMatchObject({
    id: before.id,
    email: before.email,
    role: before.role,
    version: 2,
    state: "pending",
    token_digest: next.digest,
  });
  expect(after.issued_at.getTime()).toBeGreaterThan(
    before.expires_at.getTime(),
  );
  expect(after.expires_at.getTime() - after.issued_at.getTime()).toBe(
    7 * 86400000,
  );
  expect(
    (
      await b.client.rpc("preview_practice_invitation", {
        p_token_digest: old.digest,
      })
    ).data,
  ).toEqual({ status: "invalid-invitation" });
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: next.digest,
      })
    ).data.status,
  ).toBe("success");
});
it("S19 S20 S21 confirmed matching account alone receives preview and explicitly joins", async () => {
  const a = await practice(),
    b = await account(),
    c = await account(),
    link = await invite(a, b.email);
  for (const digest of [link.digest, capability().digest, "malformed"])
    expect(
      (
        await c.client.rpc("preview_practice_invitation", {
          p_token_digest: digest,
        })
      ).data,
    ).toEqual({ status: "invalid-invitation" });
  const preview = await b.client.rpc("preview_practice_invitation", {
    p_token_digest: link.digest,
  });
  expect(preview.data).toMatchObject({
    status: "success",
    name: "Cedar Clinic",
    role: "manager",
  });
  expect(await membership(a.practice.id, b.user.id)).toBeUndefined();
  const joined = await b.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
  expect(joined.data).toMatchObject({
    status: "success",
    role: "manager",
    practiceId: a.practice.id,
  });
  expect((await b.client.from("practices").select("*")).data).toEqual([
    a.practice,
  ]);
});
it("S22 expired capability denies without state changes", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email);
  await fixtureWrite(
    a.user.id,
    "update private.practice_invitations set expires_at=clock_timestamp() where id=$1",
    [link.invitation.id],
  );
  const before = await events(a.practice.id);
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).data,
  ).toEqual({ status: "invalid-invitation" });
  expect(await membership(a.practice.id, b.user.id)).toBeUndefined();
  expect(await events(a.practice.id)).toEqual(before);
});
it("S22 controlled database clock accepts immediately before expiry and denies equality and after", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email);
  const db = await pool.connect();
  try {
    await db.query("begin");
    const definition = (
      await db.query(
        "select pg_get_functiondef('private.invitation_for_actor(text)'::regprocedure) body",
      )
    ).rows[0].body;
    // Replace only the clock boundary, retaining the real eligibility and write paths.
    const changed = definition.replace(
      "pg_catalog.clock_timestamp()",
      "pg_catalog.current_setting('fixture.clock')::timestamptz",
    );
    expect(changed).not.toBe(definition);
    await db.query(changed);
    const expiry = (
      await db.query(
        "select expires_at::text value from private.practice_invitations where id=$1",
        [link.invitation.id],
      )
    ).rows[0].value;
    for (const [offset, status] of [
      [-1, "success"],
      [0, "invalid-invitation"],
      [1, "invalid-invitation"],
    ] as const) {
      await db.query("savepoint boundary");
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,true),set_config('fixture.clock',($2::timestamptz + $3::int * interval '1 millisecond')::text,true)",
        [b.user.id, expiry, offset],
      );
      await db.query("set local role authenticated");
      expect(
        (
          await db.query(
            "select public.preview_practice_invitation($1) result",
            [link.digest],
          )
        ).rows[0].result.status,
      ).toBe(status);
      expect(
        (
          await db.query(
            "select public.accept_practice_invitation($1) result",
            [link.digest],
          )
        ).rows[0].result.status,
      ).toBe(status);
      await db.query("reset role");
      expect(
        (
          await db.query(
            "select count(*)::int n from public.practice_memberships where user_id=$1",
            [b.user.id],
          )
        ).rows[0].n,
      ).toBe(offset === -1 ? 1 : 0);
      await db.query("rollback to boundary");
    }
  } finally {
    await db.query("rollback");
    db.release();
  }
  expect(await membership(a.practice.id, b.user.id)).toBeUndefined();
});

it.each(["cancel", "reissue"])(
  "A03 S14 acceptance racing %s has one serialized outcome and no stale capability",
  async (operation) => {
    const a = await practice(),
      b = await account(),
      link = await invite(a, b.email),
      next = capability();
    const [joined, changed] = await Promise.all([
      b.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      }),
      a.client.rpc(
        operation === "cancel"
          ? "cancel_practice_invitation"
          : "reissue_practice_invitation",
        {
          p_invitation_id: link.invitation.id,
          p_expected_version: 1,
          ...(operation === "reissue" ? { p_token_digest: next.digest } : {}),
        },
      ),
    ]);
    expect(joined.error).toBeNull();
    expect(changed.error).toBeNull();
    expect([joined.data.status, changed.data.status].sort()).toEqual(
      joined.data.status === "success"
        ? ["conflict", "success"]
        : ["invalid-invitation", "success"],
    );
    const row = (
      await pool.query(
        "select * from private.practice_invitations where id=$1",
        [link.invitation.id],
      )
    ).rows[0];
    expect(row.version).toBe(2);
    const history = (await events(a.practice.id)).filter(
      (e) => e.invitation_id === row.id,
    );
    expect(history).toHaveLength(2);
    expect(history[1].operation).toBe(
      joined.data.status === "success"
        ? "invitation_accepted"
        : operation === "cancel"
          ? "invitation_canceled"
          : "invitation_reissued",
    );
    if (joined.data.status !== "success") {
      expect(await membership(a.practice.id, b.user.id)).toBeUndefined();
      expect(
        (
          await b.client.rpc("accept_practice_invitation", {
            p_token_digest: link.digest,
          })
        ).data,
      ).toEqual({ status: "invalid-invitation" });
      if (operation === "reissue")
        expect(
          (
            await b.client.rpc("accept_practice_invitation", {
              p_token_digest: next.digest,
            })
          ).data.status,
        ).toBe("success");
    } else
      expect(
        (
          await b.client.rpc("accept_practice_invitation", {
            p_token_digest: link.digest,
          })
        ).data.status,
      ).toBe("already-member");
  },
);

it("A03 S31 invitation issued exactly at revocation is unavailable", async () => {
  const a = await practice(),
    b = await account(),
    first = await invite(a, b.email);
  await b.client.rpc("accept_practice_invitation", {
    p_token_digest: first.digest,
  });
  const pending = await invite(a, b.email),
    member = await membership(a.practice.id, b.user.id);
  await a.client.rpc("revoke_practice_member", {
    p_membership_id: member.id,
    p_expected_version: 1,
  });
  await fixtureWrite(
    a.user.id,
    "update private.practice_invitations set issued_at=(select revoked_at from public.practice_memberships where id=$1) where id=$2",
    [member.id, pending.invitation.id],
  );
  const before = await events(a.practice.id);
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: pending.digest,
      })
    ).data,
  ).toEqual({ status: "invalid-invitation" });
  expect(await events(a.practice.id)).toEqual(before);
  expect((await membership(a.practice.id, b.user.id)).state).toBe("revoked");
});
it("S20 unconfirmed matching email cannot preview or accept with issued JWT", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email);
  await pool.query(
    "update auth.users set email_confirmed_at=null where id=$1",
    [b.user.id],
  );
  try {
    for (const rpc of [
      "preview_practice_invitation",
      "accept_practice_invitation",
    ])
      expect(
        (await b.client.rpc(rpc, { p_token_digest: link.digest })).data,
      ).toEqual({ status: "invalid-invitation" });
    expect(await membership(a.practice.id, b.user.id)).toBeUndefined();
  } finally {
    await pool.query(
      "update auth.users set email_confirmed_at=clock_timestamp() where id=$1",
      [b.user.id],
    );
  }
});
it("S16 inviter later revocation does not cancel a valid invitation", async () => {
  const a = await practice(),
    d = await account(),
    b = await account(),
    admin = await invite(a, d.email, "administrator");
  await d.client.rpc("accept_practice_invitation", {
    p_token_digest: admin.digest,
  });
  const dPractice = { ...d, practice: a.practice };
  const link = await invite(dPractice, b.email),
    member = await membership(a.practice.id, d.user.id);
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: member.id,
        p_expected_version: 1,
      })
    ).data.status,
  ).toBe("success");
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).data.status,
  ).toBe("success");
  expect(
    (await events(a.practice.id)).find(
      (e) =>
        e.invitation_id === link.invitation.id &&
        e.operation === "invitation_created",
    )?.actor_user_id,
  ).toBe(d.user.id);
});
it("S36 simultaneous cross revocations retain an administrator and reject stale actor authority", async () => {
  const a = await practice(),
    d = await account(),
    link = await invite(a, d.email, "administrator");
  await d.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
  const am = await membership(a.practice.id, a.user.id),
    dm = await membership(a.practice.id, d.user.id);
  const results = await Promise.all(
    [
      [a, dm],
      [d, am],
    ].map(async ([actor, target]) => {
      return await actor.client.rpc("revoke_practice_member", {
        p_membership_id: target.id,
        p_expected_version: 1,
      });
    }),
  );
  expect(results.filter((r) => r.data?.status === "success")).toHaveLength(1);
  expect(results.filter((r) => r.error?.code === "42501")).toHaveLength(1);
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.practice_memberships where practice_id=$1 and role='administrator' and state='active'",
        [a.practice.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
async function waitForBlockedRpc(name: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await pool.query(
      "select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query like $1",
      [`%${name}%`],
    );
    if (waiting.rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect.fail("RPC did not reach the coordinated lock wait");
}
it("S23 invitation that expires while queued cannot join after lock release", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email);
  await fixtureWrite(
    a.user.id,
    "update private.practice_invitations set expires_at=clock_timestamp()+interval '2 seconds' where id=$1",
    [link.invitation.id],
  );
  const db = await pool.connect();
  let queued;
  try {
    await db.query("begin");
    await db.query("select 1 from public.practices where id=$1 for update", [
      a.practice.id,
    ]);
    queued = Promise.resolve(
      b.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      }),
    );
    await waitForBlockedRpc("accept_practice_invitation");
    const delay = (
      await db.query(
        "select greatest(0,extract(epoch from expires_at-clock_timestamp())*1000)::float8 ms from private.practice_invitations where id=$1",
        [link.invitation.id],
      )
    ).rows[0].ms;
    await new Promise((resolve) => setTimeout(resolve, delay + 50));
    await db.query("commit");
  } finally {
    await db.query("rollback");
    db.release();
  }
  expect((await queued)?.data).toEqual({ status: "invalid-invitation" });
  expect(await membership(a.practice.id, b.user.id)).toBeUndefined();
});
it("S39 queued profile update rechecks authority after a committed demotion", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email, "administrator");
  await b.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
  const member = await membership(a.practice.id, b.user.id),
    db = await pool.connect();
  let queued;
  const before = (
    await pool.query("select * from public.practices where id=$1", [
      a.practice.id,
    ])
  ).rows;
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      a.user.id,
    ]);
    await db.query(
      "select private.change_practice_member_role($1,1,'manager')",
      [member.id],
    );
    queued = Promise.resolve(
      b.client.rpc("update_practice", {
        p_practice_id: a.practice.id,
        p_name: "Must not save",
        p_timezone: "UTC",
        p_expected_version: 1,
      }),
    );
    await waitForBlockedRpc("update_practice");
    await db.query("commit");
  } finally {
    await db.query("rollback");
    db.release();
  }
  expect((await queued)?.error?.code).toBe("42501");
  expect(
    (
      await pool.query("select * from public.practices where id=$1", [
        a.practice.id,
      ])
    ).rows,
  ).toEqual(before);
});
it("S24 twenty accepts create one membership and one invitation acceptance event", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email);
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      b.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      }),
    ),
  );
  expect(
    results.every(
      (r) => !r.error && ["success", "already-member"].includes(r.data.status),
    ),
  ).toBe(true);
  expect(
    (await events(a.practice.id)).filter(
      (e) => e.operation === "invitation_accepted",
    ),
  ).toHaveLength(1);
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.practice_memberships where user_id=$1",
        [b.user.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("A03 S25 accepted retry cannot reset current role and S30 cannot reactivate", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email, "administrator");
  await b.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
  const member = await membership(a.practice.id, b.user.id);
  expect(
    (
      await a.client.rpc("change_practice_member_role", {
        p_membership_id: member.id,
        p_expected_version: member.version,
        p_role: "viewer",
      })
    ).data.status,
  ).toBe("success");
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).data,
  ).toMatchObject({ status: "already-member", role: "viewer" });
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: member.id,
        p_expected_version: 2,
      })
    ).data.status,
  ).toBe("success");
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).data,
  ).toEqual({ status: "invalid-invitation" });
  expect((await membership(a.practice.id, b.user.id)).state).toBe("revoked");
});
it("S26 pending invitation cannot overwrite active same-practice role", async () => {
  const a = await practice(),
    b = await account(),
    initial = await invite(a, b.email);
  await b.client.rpc("accept_practice_invitation", {
    p_token_digest: initial.digest,
  });
  const next = await invite(a, b.email, "administrator"),
    before = await events(a.practice.id);
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: next.digest,
      })
    ).data,
  ).toMatchObject({ status: "already-member", role: "manager" });
  expect(await events(a.practice.id)).toEqual(before);
  expect(
    (
      await pool.query(
        "select state from private.practice_invitations where id=$1",
        [next.invitation.id],
      )
    ).rows[0].state,
  ).toBe("pending");
});
it("S27 S28 two practice accept race has one winner and neutral unchanged loser", async () => {
  const a = await practice(),
    q = await practice("Birch Clinic"),
    b = await account();
  const left = await invite(a, b.email),
    right = await invite(q, b.email);
  const results = await Promise.all(
    [left, right].map((link) =>
      b.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      }),
    ),
  );
  expect(results.map((r) => r.data.status).sort()).toEqual([
    "other-practice",
    "success",
  ]);
  expect(results.find((r) => r.data.status === "other-practice")?.data).toEqual(
    { status: "other-practice" },
  );
  const losingIndex = results.findIndex(
      (r) => r.data.status === "other-practice",
    ),
    loser = [left, right][losingIndex],
    losingPractice = [a, q][losingIndex];
  expect(
    (
      await pool.query(
        "select state,version from private.practice_invitations where id=$1",
        [loser.invitation.id],
      )
    ).rows,
  ).toEqual([{ state: "pending", version: 1 }]);
  expect(await events(losingPractice.practice.id)).toHaveLength(2);
  expect(
    await membership(losingPractice.practice.id, b.user.id),
  ).toBeUndefined();
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.practice_memberships where user_id=$1 and state='active'",
        [b.user.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("S29 create versus accept race leaves only profiles with administrators", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email);
  const [created, accepted] = await Promise.all([
    b.client.rpc("create_practice", {
      p_name: "Birch Clinic",
      p_timezone: "UTC",
    }),
    b.client.rpc("accept_practice_invitation", { p_token_digest: link.digest }),
  ]);
  expect(created.error).toBeNull();
  expect(accepted.error).toBeNull();
  expect(["success", "other-practice"].includes(accepted.data.status)).toBe(
    true,
  );
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.practices p where not exists(select 1 from public.practice_memberships m where m.practice_id=p.id and m.role='administrator' and m.state='active')",
      )
    ).rows[0].n,
  ).toBe(0);
});
it("A03 S31 S32 S40 only explicit post-revocation reissue reactivates durable membership", async () => {
  const a = await practice(),
    b = await account(),
    first = await invite(a, b.email);
  await b.client.rpc("accept_practice_invitation", {
    p_token_digest: first.digest,
  });
  const oldPending = await invite(a, b.email),
    member = await membership(a.practice.id, b.user.id);
  const revokeArgs = { p_membership_id: member.id, p_expected_version: 1 };
  expect(
    (await a.client.rpc("revoke_practice_member", revokeArgs)).data.status,
  ).toBe("success");
  const before = await events(a.practice.id);
  expect(
    (await a.client.rpc("revoke_practice_member", revokeArgs)).data.status,
  ).toBe("success");
  expect(await events(a.practice.id)).toEqual(before);
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: oldPending.digest,
      })
    ).data,
  ).toEqual({ status: "invalid-invitation" });
  const fresh = capability();
  expect(
    (
      await a.client.rpc("reissue_practice_invitation", {
        p_invitation_id: oldPending.invitation.id,
        p_expected_version: 1,
        p_token_digest: fresh.digest,
      })
    ).data.status,
  ).toBe("success");
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: fresh.digest,
      })
    ).data.status,
  ).toBe("success");
  expect(await membership(a.practice.id, b.user.id)).toMatchObject({
    id: member.id,
    version: 3,
    state: "active",
  });
  expect(
    (await a.client.rpc("revoke_practice_member", revokeArgs)).data,
  ).toEqual({ status: "conflict" });
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        ...revokeArgs,
        p_expected_version: 3,
      })
    ).data.status,
  ).toBe("success");
  for (const digest of [first.digest, oldPending.digest, fresh.digest])
    expect(
      (
        await b.client.rpc("accept_practice_invitation", {
          p_token_digest: digest,
        })
      ).data,
    ).toEqual({ status: "invalid-invitation" });
});
it("S34 S35 role versioning and final administrator guard", async () => {
  const a = await practice(),
    member = await membership(a.practice.id, a.user.id);
  const pending = await account();
  await invite(a, pending.email, "administrator");
  for (const [rpc, args] of [
    ["change_practice_member_role", { p_role: "viewer" }],
    ["revoke_practice_member", {}],
  ] as const) {
    expect(
      (
        await a.client.rpc(rpc, {
          p_membership_id: member.id,
          p_expected_version: 1,
          ...args,
        })
      ).data,
    ).toEqual({ status: "last-administrator" });
  }
  expect((await membership(a.practice.id, a.user.id)).version).toBe(1);
});
it.each([
  "initial-membership",
  "create",
  "reissue",
  "cancel",
  "accept",
  "role",
  "revoke",
])(
  "S41 access audit failure rolls back %s and retry commits once",
  async (operation) => {
    const a = await practice(),
      b = await account();
    const link = ["initial-membership", "create"].includes(operation)
      ? null
      : await invite(a, b.email);
    if (["role", "revoke"].includes(operation))
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: link!.digest,
      });
    const member = await membership(a.practice.id, b.user.id),
      next = capability();
    const request = () => {
      switch (operation) {
        case "initial-membership":
          return b.client.rpc("create_practice", {
            p_name: "Rollback Clinic",
            p_timezone: "UTC",
          });
        case "create":
          return a.client.rpc("create_practice_invitation", {
            p_practice_id: a.practice.id,
            p_email: b.email,
            p_role: "manager",
            p_token_digest: next.digest,
          });
        case "reissue":
          return a.client.rpc("reissue_practice_invitation", {
            p_invitation_id: link!.invitation.id,
            p_expected_version: 1,
            p_token_digest: next.digest,
          });
        case "cancel":
          return a.client.rpc("cancel_practice_invitation", {
            p_invitation_id: link!.invitation.id,
            p_expected_version: 1,
          });
        case "accept":
          return b.client.rpc("accept_practice_invitation", {
            p_token_digest: link!.digest,
          });
        case "role":
          return a.client.rpc("change_practice_member_role", {
            p_membership_id: member.id,
            p_expected_version: 1,
            p_role: "viewer",
          });
        default:
          return a.client.rpc("revoke_practice_member", {
            p_membership_id: member.id,
            p_expected_version: 1,
          });
      }
    };
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of [
        "public.practice_memberships",
        "private.practice_invitations",
        "private.practice_access_events",
        "private.practice_audit_events",
      ])
        result[table] = (
          await pool.query(
            `select * from ${table} where practice_id=$1 order by id`,
            [a.practice.id],
          )
        ).rows;
      result.profiles = (
        await pool.query(
          "select * from public.practices where owner_user_id=$1 order by id",
          [b.user.id],
        )
      ).rows;
      return result;
    };
    const before = await snapshot();
    await pool.query(
      "create function private.fixture_access_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture access audit failure'; end $$; create trigger fixture_access_failure before insert on private.practice_access_events for each row execute function private.fixture_access_failure()",
    );
    try {
      expect((await request()).error?.code).toBe("P0001");
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query(
        "drop trigger fixture_access_failure on private.practice_access_events; drop function private.fixture_access_failure()",
      );
    }
    const retried = await request();
    expect(retried.error).toBeNull();
    const targetPractice =
      operation === "initial-membership" ? retried.data.id : a.practice.id;
    const committed = await events(targetPractice);
    expect(committed).toHaveLength(
      operation === "initial-membership"
        ? 1
        : (before["private.practice_access_events"] as unknown[]).length +
            (operation === "accept" ? 2 : 1),
    );
    await request();
    expect(await events(targetPractice)).toEqual(committed);
  },
);
it("S34 actual role update has actor and before/after audit, stale version cannot write", async () => {
  const a = await practice(),
    b = await account(),
    link = await invite(a, b.email);
  await b.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
  const member = await membership(a.practice.id, b.user.id);
  expect(
    (
      await a.client.rpc("change_practice_member_role", {
        p_membership_id: member.id,
        p_expected_version: 1,
        p_role: "viewer",
      })
    ).data,
  ).toEqual({ status: "success" });
  const before = await events(a.practice.id);
  expect(
    before.find((e) => e.operation === "membership_role_changed"),
  ).toMatchObject({
    actor_user_id: a.user.id,
    membership_id: member.id,
    before_role: "manager",
    after_role: "viewer",
    before_state: "active",
    after_state: "active",
  });
  expect(
    (
      await a.client.rpc("change_practice_member_role", {
        p_membership_id: member.id,
        p_expected_version: 1,
        p_role: "administrator",
      })
    ).data,
  ).toEqual({ status: "conflict" });
  expect(await events(a.practice.id)).toEqual(before);
  expect(await membership(a.practice.id, b.user.id)).toMatchObject({
    role: "viewer",
    version: 2,
  });
});
