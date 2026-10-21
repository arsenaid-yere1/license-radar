import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import cases from "../fixtures/credential-numbers.json";
import {
  practice,
  account,
  invite,
  membership,
  pool,
} from "../helpers/access-fixtures";
import { anonymous } from "../helpers/local-fixtures";
type Actor = Awaited<ReturnType<typeof practice>>;
afterAll(() => pool.end());
it("DIR04 DIR08 RN05 RN09 ordinary and catch-up payloads exclude numbers and consumed permission survives edits", async () => {
  for (const kind of ["normal", "catch-up"]) {
    const a = await practice(),
      c = await create(a, { p_record_number: "PRIVATE-NUMBER-0001" });
    const member = await membership(a.practice.id, a.user.id);
    expect(
      (
        await a.client.rpc("set_practice_reminder_recipient", {
          p_practice_id: a.practice.id,
          p_membership_id: member.id,
          p_expected_version: 1,
        })
      ).error,
    ).toBeNull();
    const now = "2090-01-02T10:00:00Z",
      namespace = `fixture-number-${randomUUID()}`;
    await pool.query(
      "update public.credential_cycles set updated_at=$2 where id=$1",
      [c.current_cycle.id, kind === "normal" ? "2080-01-01T10:00:00Z" : now],
    );
    for (let i = 0; i < 100; i++) {
      await pool.query(
        "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
        [a.practice.id],
      );
      await pool.query("select private.reconcile_email_reminders_at($1,$2)", [
        namespace,
        now,
      ]);
      if (
        !(
          await pool.query(
            "select 1 from private.reminder_reconcile_outbox where practice_id=$1",
            [a.practice.id],
          )
        ).rowCount
      )
        break;
    }
    const job = (
      await pool.query(
        "select * from private.reminder_jobs where credential_id=$1",
        [c.id],
      )
    ).rows[0];
    expect(job.schedule_kind).toBe(kind);
    expect(job.state).toBe("queued");
    const token = randomUUID();
    await pool.query(
      "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3 where id=$1",
      [job.id, token, "2090-01-02T10:00:30Z"],
    );
    const excluded = [
      "public.credentials",
      "private.register_change_requests",
      "private.register_audit_events",
    ];
    const claimed = await snapshot(a.practice.id, excluded);
    const saved = await save(a, await read(a, c), {
      p_record_number: "PRIVATE-NUMBER-0002",
    });
    expect(await snapshot(a.practice.id, excluded)).toEqual(claimed);
    const config = {
      namespace,
      from: "reminders@example.test",
      replyTo: "support@example.test",
      appUrl: "http://127.0.0.1:3000",
    };
    const permission = (
      await pool.query(
        "select private.begin_email_reminder_at($1,$2,$3,$4) value",
        [job.id, token, config, now],
      )
    ).rows[0].value;
    expect(permission.status).toBe("submit");
    expect(JSON.stringify(permission.payload)).not.toContain("PRIVATE-NUMBER");
    for (const value of ["DIR fixture", "Fixture issuer", "000Ab-12 / 陈"])
      expect(JSON.stringify(permission.payload)).not.toContain(value);
    const consumed = await snapshot(a.practice.id, excluded);
    await save(a, saved.credential, { p_record_number: "PRIVATE-NUMBER-0003" });
    expect(await snapshot(a.practice.id, excluded)).toEqual(consumed);
  }
});
function createArgs(a: Actor, patch: Record<string, unknown> = {}) {
  return {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_title: "DIR fixture",
    p_type: "insurance_payer_provider_directory",
    p_owner_kind: "practice",
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
    p_issuer: "Fixture issuer",
    p_jurisdiction: "CA",
    p_end_date: "2090-03-02",
    p_action_deadline: null,
    p_record_number: "000Ab-12 / 陈",
    ...patch,
  };
}
async function create(a: Actor, patch: Record<string, unknown> = {}) {
  const r = await a.client.rpc(
    "create_practice_credential_with_number",
    createArgs(a, patch),
  );
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  return r.data.credential;
}
type Row = Awaited<ReturnType<typeof create>>;
function updateArgs(a: Actor, c: Row, patch: Record<string, unknown> = {}) {
  return {
    ...createArgs(a),
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: c.current_cycle.date_revision,
    p_title: c.title,
    p_type: c.type,
    p_owner_kind: c.owner_kind,
    p_owner_clinician_id: c.owner_clinician_id,
    p_issuer: c.issuer,
    p_jurisdiction: c.jurisdiction,
    p_end_date: c.current_cycle.end_date,
    p_action_deadline: c.current_cycle.action_deadline,
    p_record_number: c.record_number,
    ...patch,
  };
}
async function read(a: Actor, c: Row) {
  const r = await a.client.rpc("list_practice_register_with_renewal", {
    p_practice_id: a.practice.id,
    p_include_archived: true,
  });
  expect(r.error).toBeNull();
  return r.data.credentials.find((r: { id: string }) => r.id === c.id);
}
async function save(a: Actor, c: Row, patch: Record<string, unknown> = {}) {
  const r = await a.client.rpc(
    "update_practice_credential_with_number",
    updateArgs(a, c, patch),
  );
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  return r.data;
}
async function staff(a: Actor, role = "manager") {
  const m = await account(),
    link = await invite(a, m.email, role);
  expect(
    (
      await m.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).error,
  ).toBeNull();
  return { ...m, member: await membership(a.practice.id, m.user.id) };
}
async function snapshot(practiceId: string, excluded: string[] = []) {
  const tables = (
    await pool.query(
      "select table_schema,table_name from information_schema.columns where column_name='practice_id' and table_schema in ('public','private') order by table_schema,table_name",
    )
  ).rows;
  const result: Record<string, unknown> = {};
  for (const t of tables) {
    const name = `${t.table_schema}.${t.table_name}`;
    if (excluded.includes(name)) continue;
    result[name] = (
      await pool.query(
        `select to_jsonb(t) row from ${name} t where practice_id=$1 order by to_jsonb(t)::text`,
        [practiceId],
      )
    ).rows;
  }
  return result;
}
it("DIR04 DIR08 RN01 RN02 SQL canonical numbers and direct storage constraints", async () => {
  const a = await practice();
  for (const type of [
    "state_license",
    "dea_registration",
    "malpractice_policy",
  ]) {
    const c = await create(a, { p_type: type });
    expect(c.record_number).toBe("000Ab-12 / 陈");
  }
  for (const item of [
    ...cases,
    { input: "🩺".repeat(120), valid: true, normalized: "🩺".repeat(120) },
    { input: "x".repeat(121), valid: false },
  ]) {
    const r = await a.client.rpc(
      "create_practice_credential_with_number",
      createArgs(a, { p_record_number: item.input }),
    );
    if (item.input?.includes("\0")) {
      expect(r.error).not.toBeNull();
      continue;
    }
    expect(r.error).toBeNull();
    expect(r.data.status).toBe(item.valid ? "success" : "invalid");
    if (item.valid)
      expect(r.data.credential.record_number).toBe(
        "normalized" in item ? item.normalized : undefined,
      );
    else
      expect(r.data.errors).toEqual({
        recordNumber: "Use up to 120 characters without control characters.",
      });
  }
  const c = await create(a);
  for (const invalid of ["", " A ", "x".repeat(121), "A\nB", "\u0085"])
    await expect(
      pool.query("update public.credentials set record_number=$2 where id=$1", [
        c.id,
        invalid,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
});
it("DIR04 DIR08 RN05 RN08 number-only edits, no-op and explicit clear preserve all nonregister state", async () => {
  const a = await practice(),
    c = await create(a);
  const before = await snapshot(a.practice.id, [
    "public.credentials",
    "private.register_change_requests",
    "private.register_audit_events",
  ]);
  const r = await save(a, c, { p_record_number: "000B" });
  expect(r.changed).toBe(true);
  expect(r.credential.version).toBe(c.version + 1);
  expect(r.credential.current_cycle).toEqual(c.current_cycle);
  expect(
    await snapshot(a.practice.id, [
      "public.credentials",
      "private.register_change_requests",
      "private.register_audit_events",
    ]),
  ).toEqual(before);
  const same = await save(a, r.credential, { p_record_number: " 000B " });
  expect(same.changed).toBe(false);
  expect(same.credential).toEqual(r.credential);
  const cleared = await save(a, same.credential, { p_record_number: "" });
  expect(cleared.credential.record_number).toBeNull();
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.register_audit_events where credential_id=$1 and operation='credential-updated'",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(2);
});
it("DIR04 DIR08 RN07 RN10 legacy omissions preserve values, type changes clear, duplicates remain allowed", async () => {
  const a = await practice(),
    c = await create(a);
  await create(a); // Same number is not unique.
  const { p_record_number, ...args } = updateArgs(a, c);
  expect(p_record_number).toBe(c.record_number);
  const noop = await a.client.rpc("update_practice_credential", args);
  expect(noop.error).toBeNull();
  expect(noop.data.changed).toBe(false);
  expect(noop.data.credential.record_number).toBe(c.record_number);
  const changed = await a.client.rpc("update_practice_credential", {
    ...args,
    p_request_id: randomUUID(),
    p_type: "malpractice_policy",
  });
  expect(changed.error).toBeNull();
  expect(changed.data.credential.record_number).toBeNull();
  const replacement = await save(a, changed.data.credential, {
    p_type: "dea_registration",
    p_record_number: "NEW-01",
  });
  expect(replacement.credential.record_number).toBe("NEW-01");
  const { p_record_number: absent, ...legacyCreate } = createArgs(a);
  expect(absent).toBe(c.record_number);
  const old = await a.client.rpc(
    "create_practice_credential_with_details",
    legacyCreate,
  );
  expect(old.error).toBeNull();
  expect(old.data.credential.record_number).toBeNull();
});
it("DIR04 DIR08 RN08 concurrent exact create/edit replay and stale requests cannot duplicate or overwrite", async () => {
  const a = await practice(),
    args = createArgs(a);
  const replies = await Promise.all(
    Array.from({ length: 4 }, () =>
      a.client.rpc("create_practice_credential_with_number", args),
    ),
  );
  for (const r of replies) {
    expect(r.error).toBeNull();
    expect(r.data).toEqual(replies[0].data);
  }
  const c = replies[0].data.credential;
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.credentials where practice_id=$1",
        [a.practice.id],
      )
    ).rows[0].n,
  ).toBe(1);
  const change = updateArgs(a, c, { p_record_number: "000B" });
  const r = await a.client.rpc(
    "update_practice_credential_with_number",
    change,
  );
  expect(r.error).toBeNull();
  expect(r.data.status).toBe("success");
  const later = await save(a, r.data.credential, { p_record_number: "000C" });
  const before = await snapshot(a.practice.id);
  expect(
    (await a.client.rpc("update_practice_credential_with_number", change)).data,
  ).toEqual(r.data);
  expect(
    (
      await a.client.rpc("update_practice_credential_with_number", {
        ...change,
        p_record_number: "000D",
      })
    ).data,
  ).toEqual({ status: "request-conflict" });
  const { p_record_number, ...oldArgs } = change;
  expect(p_record_number).toBe("000B");
  expect(
    (await a.client.rpc("update_practice_credential", oldArgs)).data,
  ).toEqual({ status: "request-conflict" });
  const stale = await a.client.rpc(
    "update_practice_credential_with_number",
    updateArgs(a, c, { p_record_number: "stale" }),
  );
  expect(stale.data).toMatchObject({
    status: "conflict",
    credential: { record_number: "000C" },
  });
  expect(await snapshot(a.practice.id)).toEqual(before);
  const racing = await Promise.all(
    ["X", "Y"].map((n) =>
      a.client.rpc(
        "update_practice_credential_with_number",
        updateArgs(a, later.credential, { p_record_number: n }),
      ),
    ),
  );
  expect(racing.map((r) => r.data.status).sort()).toEqual([
    "conflict",
    "success",
  ]);
});
it("DIR04 DIR08 RN04 direct API and checked entries enforce current tenants and roles", async () => {
  const a = await practice(),
    c = await create(a),
    b = await practice(),
    viewer = await staff(a, "viewer"),
    manager = await staff(a);
  const list = await viewer.client
    .from("credentials")
    .select("record_number")
    .eq("id", c.id);
  expect(list.error).toBeNull();
  expect(list.data).toEqual([{ record_number: c.record_number }]);
  for (const who of [b, viewer, { client: anonymous() }]) {
    expect(
      (
        await who.client.rpc(
          "create_practice_credential_with_number",
          createArgs(a),
        )
      ).error?.code,
    ).toBe("42501");
    expect(
      (
        await who.client.rpc(
          "update_practice_credential_with_number",
          updateArgs(a, c),
        )
      ).error?.code,
    ).toBe("42501");
  }
  expect(
    (await b.client.from("credentials").select("record_number").eq("id", c.id))
      .data,
  ).toEqual([]);
  expect(
    (
      await a.client
        .from("credentials")
        .update({ record_number: "forged" })
        .eq("id", c.id)
    ).error?.code,
  ).toBe("42501");
  const foreign = await create(b);
  for (const id of [randomUUID(), foreign.id])
    expect(
      (
        await a.client.rpc(
          "update_practice_credential_with_number",
          updateArgs(a, c, { p_credential_id: id }),
        )
      ).data,
    ).toEqual({ status: "not-found" });
  const args = updateArgs(a, c, { p_record_number: "manager" });
  expect(
    (await manager.client.rpc("update_practice_credential_with_number", args))
      .data.status,
  ).toBe("success");
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: manager.member.id,
        p_expected_version: 1,
      })
    ).error,
  ).toBeNull();
  expect(
    (await manager.client.rpc("update_practice_credential_with_number", args))
      .error?.code,
  ).toBe("42501");
  expect(
    (
      await manager.client
        .from("credentials")
        .select("record_number")
        .eq("id", c.id)
    ).data,
  ).toEqual([]);
});
it("DIR04 DIR08 RN04 waiting mutation and replay recheck demotion or revocation", async () => {
  const a = await practice();
  for (const revoke of [false, true]) {
    const m = await staff(a),
      c = await create(a),
      args = updateArgs(a, c, { p_record_number: "manager" });
    const original = await m.client.rpc(
      "update_practice_credential_with_number",
      args,
    );
    expect(original.data.status).toBe("success");
    const db = await pool.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        a.user.id,
      ]);
      await db.query("select private.mutate_member($1,1,$2,$3)", [
        m.member.id,
        revoke ? null : "viewer",
        revoke,
      ]);
      const pending = Promise.resolve(
        m.client.rpc(
          "update_practice_credential_with_number",
          updateArgs(a, original.data.credential, { p_record_number: "late" }),
        ),
      );
      let waiting = false;
      for (let i = 0; i < 200; i++) {
        if (
          (
            await pool.query(
              "select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%update_practice_credential_with_number%'",
            )
          ).rowCount
        ) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(true);
      await db.query("commit");
      expect((await pending).error?.code).toBe("42501");
      expect(
        (await m.client.rpc("update_practice_credential_with_number", args))
          .error?.code,
      ).toBe("42501");
    } finally {
      await db.query("rollback");
      db.release();
    }
  }
});
it("DIR04 DIR08 RN06 successors and archives retain numbers and old replay cannot rewind them", async () => {
  const a = await practice(),
    c = await create(a),
    current = await read(a, c);
  const done = await a.client.rpc("complete_credential_renewal", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: 1,
    p_expected_renewal_version: current.renewal.workflow.version,
    p_end_date: "2091-03-02",
    p_action_deadline: null,
    p_confirmed: true,
  });
  expect(done.error).toBeNull();
  expect(done.data.status).toBe("success");
  expect(done.data.credential.record_number).toBe(c.record_number);
  const changed = await save(a, done.data.credential, {
    p_record_number: "SUCCESSOR-0001",
  });
  expect(changed.credential.current_cycle.cycle_number).toBe(2);
  const archived = await a.client.rpc("archive_practice_credential", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: changed.credential.version,
    p_expected_cycle_id: changed.credential.current_cycle.id,
    p_expected_date_revision: 1,
  });
  expect(archived.error).toBeNull();
  expect(archived.data.credential.record_number).toBe("SUCCESSOR-0001");
  expect((await read(a, c)).record_number).toBe("SUCCESSOR-0001");
  expect(
    (
      await a.client.rpc(
        "update_practice_credential_with_number",
        updateArgs(a, changed.credential),
      )
    ).data,
  ).toEqual({ status: "archived" });
});
it("DIR04 DIR08 RN08 atomic creation/update audit and receipt faults roll back and retry safely", async () => {
  const a = await practice(),
    c = await create(a);
  for (const table of [
    "register_audit_events",
    "register_create_requests",
    "register_change_requests",
  ]) {
    const creating = table === "register_create_requests",
      args = creating
        ? createArgs(a)
        : updateArgs(a, c, { p_record_number: "fault" });
    const name = creating
      ? "create_practice_credential_with_number"
      : "update_practice_credential_with_number";
    const before = await snapshot(a.practice.id);
    await pool.query(
      `create function private.number_fixture_fault() returns trigger language plpgsql as $$begin raise exception 'number fixture fault';end$$;create trigger number_fixture_fault before insert on private.${table} for each row execute function private.number_fixture_fault()`,
    );
    try {
      expect((await a.client.rpc(name, args)).error?.code).toBe("P0001");
      expect(await snapshot(a.practice.id)).toEqual(before);
    } finally {
      await pool.query(
        `drop trigger number_fixture_fault on private.${table};drop function private.number_fixture_fault()`,
      );
    }
    const result = await a.client.rpc(name, args);
    expect(result.error).toBeNull();
    expect(result.data.status).toBe("success");
    if (!creating) Object.assign(c, result.data.credential);
  }
});
it("DIR04 DIR08 RN05 max-version no-op works and required increment conflicts", async () => {
  const a = await practice(),
    c = await create(a);
  await pool.query(
    "update public.credentials set version=2147483647 where id=$1",
    [c.id],
  );
  const current = await read(a, c);
  expect((await save(a, current)).changed).toBe(false);
  expect(
    (
      await a.client.rpc(
        "update_practice_credential_with_number",
        updateArgs(a, current, { p_record_number: "changed" }),
      )
    ).data.status,
  ).toBe("conflict");
});
it("DIR02 all API generations accept both owners and reject incoherent or foreign ownership", async () => {
  const a = await practice(),
    b = await practice();
  async function person(who: Actor) {
    const r = await who.client.rpc("create_practice_clinician", {
      p_practice_id: who.practice.id,
      p_request_id: randomUUID(),
      p_name: "Rivera",
    });
    expect(r.error).toBeNull();
    return r.data.clinician.id;
  }
  const personId = await person(a),
    foreignId = await person(b);
  for (const name of [
    "create_practice_credential",
    "create_practice_credential_with_details",
    "create_practice_credential_with_number",
  ]) {
    const args: Record<string, unknown> = { ...createArgs(a) };
    if (name !== "create_practice_credential_with_number")
      delete args.p_record_number;
    if (name === "create_practice_credential")
      for (const k of [
        "p_issuer",
        "p_jurisdiction",
        "p_end_date",
        "p_action_deadline",
      ])
        delete args[k];
    for (const owner of ["practice", "clinician"]) {
      const r = await a.client.rpc(name, {
        ...args,
        p_request_id: randomUUID(),
        p_owner_kind: owner,
        p_owner_clinician_id: owner === "clinician" ? personId : null,
      });
      expect(r.error).toBeNull();
      expect(r.data.status).toBe("success");
      expect(r.data.credential.owner_kind).toBe(owner);
    }
    for (const patch of [
      { p_owner_kind: "clinician", p_owner_clinician_id: null },
      { p_owner_kind: "practice", p_owner_clinician_id: personId },
      { p_covered_clinician_ids: [personId] },
      { p_type: "directory_other" },
    ]) {
      const r = await a.client.rpc(name, {
        ...args,
        p_request_id: randomUUID(),
        ...patch,
      });
      expect(r.error).toBeNull();
      expect(r.data.status).toBe("invalid");
    }
    const r = await a.client.rpc(name, {
      ...args,
      p_request_id: randomUUID(),
      p_owner_kind: "clinician",
      p_owner_clinician_id: foreignId,
    });
    expect(r.error).toBeNull();
    expect(r.data.status).toBe("invalid-reference");
  }
  let c = await create(a);
  for (const name of [
    "update_practice_credential",
    "update_practice_credential_with_number",
  ]) {
    for (const owner of ["clinician", "practice"]) {
      const args: Record<string, unknown> = updateArgs(a, c, {
        p_owner_kind: owner,
        p_owner_clinician_id: owner === "clinician" ? personId : null,
      });
      if (name === "update_practice_credential") delete args.p_record_number;
      const r = await a.client.rpc(name, args);
      expect(r.error).toBeNull();
      expect(r.data.status).toBe("success");
      c = r.data.credential;
      expect(c.owner_kind).toBe(owner);
    }
  }
  for (const name of [
    "update_practice_credential",
    "update_practice_credential_with_number",
  ]) {
    for (const [patch, status] of [
      [{ p_owner_kind: "clinician", p_owner_clinician_id: null }, "invalid"],
      [{ p_owner_kind: "practice", p_owner_clinician_id: personId }, "invalid"],
      [
        { p_owner_kind: "clinician", p_owner_clinician_id: foreignId },
        "invalid-reference",
      ],
      [{ p_covered_clinician_ids: [personId] }, "invalid"],
      [{ p_type: "directory_other" }, "invalid"],
    ] as const) {
      const args: Record<string, unknown> = updateArgs(a, c, patch);
      if (name === "update_practice_credential") delete args.p_record_number;
      const r = await a.client.rpc(name, args);
      expect(r.error).toBeNull();
      expect(r.data.status).toBe(status);
    }
  }
  const probe = await pool.connect();
  try {
    await probe.query("begin");
    await expect(
      probe.query(
        "update public.credentials set type='directory_other' where id=$1",
        [c.id],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "credentials_type_check",
    });
  } finally {
    await probe.query("rollback");
    probe.release();
  }
});
it("DIR06 DIR07 concurrent renewal retains historical evidence and current-cycle identity", async () => {
  const a = await practice(),
    c = await create(a),
    current = await read(a, c);
  const reservation = await a.client.rpc("reserve_renewal_evidence", {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_cycle_id: c.current_cycle.id,
    p_request_id: randomUUID(),
    p_filename: "directory.pdf",
    p_mime: "application/pdf",
    p_byte_count: 32,
    p_digest: "a".repeat(64),
  });
  expect(reservation.error).toBeNull();
  expect(reservation.data.status).toBe("success");
  const args = {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: 1,
    p_expected_renewal_version: current.renewal.workflow.version,
    p_end_date: "2091-03-02",
    p_action_deadline: null,
    p_confirmed: true,
  };
  const results = await Promise.all([
    a.client.rpc("complete_credential_renewal", args),
    a.client.rpc("complete_credential_renewal", args),
  ]);
  expect(results[0].error).toBeNull();
  expect(results[1].data).toEqual(results[0].data);
  expect(results[0].data.status).toBe("success");
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.credential_cycles where credential_id=$1",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(2);
  const history = await a.client.rpc("get_credential_renewal_history", {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_before_cycle_number: null,
  });
  expect(
    history.data.cycles.map((x: { type: string; cycleNumber: number }) => [
      x.type,
      x.cycleNumber,
    ]),
  ).toEqual([
    ["insurance_payer_provider_directory", 2],
    ["insurance_payer_provider_directory", 1],
  ]);
  const evidence = await a.client.rpc("get_renewal_evidence", {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_cycle_id: c.current_cycle.id,
  });
  expect(evidence.data.cycle.type).toBe("insurance_payer_provider_directory");
  expect(evidence.data.current).toBe(false);
  expect(evidence.data.files[0].id).toBe(reservation.data.evidenceId);
  const next = await read(a, c);
  expect(next.current_cycle.cycle_number).toBe(2);
  expect(next.record_number).toBe(c.record_number);
  await save(a, next, { p_issuer: "New assessor" });
});
async function reconcileDirectory(a: Actor, namespace: string) {
  for (let i = 0; i < 100; i++) {
    await pool.query(
      "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
      [a.practice.id],
    );
    await pool.query(
      "select private.reconcile_email_reminders_at($1,'2090-01-02T10:00:00Z')",
      [namespace],
    );
    if (
      !(
        await pool.query(
          "select 1 from private.reminder_reconcile_outbox where practice_id=$1",
          [a.practice.id],
        )
      ).rowCount
    )
      return;
  }
  throw new Error("DIR fixture reconciliation did not finish");
}
it("DIR08 undated and action deadlines, date revision archive and successor reconciliation", async () => {
  const a = await practice(),
    member = await membership(a.practice.id, a.user.id),
    namespace = `fixture-directory-${randomUUID()}`;
  await a.client.rpc("set_practice_reminder_recipient", {
    p_practice_id: a.practice.id,
    p_membership_id: member.id,
    p_expected_version: 1,
  });
  const undated = await create(a, { p_end_date: null }),
    c = await create(a, { p_action_deadline: "2090-02-01" });
  await reconcileDirectory(a, namespace);
  expect(
    (
      await pool.query(
        "select state,reason,due_date,next_send_at from private.reminder_jobs where credential_id=$1",
        [undated.id],
      )
    ).rows,
  ).toEqual([
    {
      state: "blocked",
      reason: "missing-date",
      due_date: null,
      next_send_at: null,
    },
  ]);
  const first = (
    await pool.query(
      "select *,due_date::text due_text from private.reminder_jobs where credential_id=$1 and state='queued'",
      [c.id],
    )
  ).rows[0];
  expect(first).toBeTruthy();
  expect(first.due_text).toBe("2090-02-01");
  const revised = await save(a, await read(a, c), {
    p_end_date: "2090-04-02",
    p_action_deadline: null,
  });
  expect(
    (
      await pool.query("select state from private.reminder_jobs where id=$1", [
        first.id,
      ])
    ).rows[0].state,
  ).toBe("canceled");
  await reconcileDirectory(a, namespace);
  const done = await a.client.rpc("complete_credential_renewal", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: revised.credential.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: revised.credential.current_cycle.date_revision,
    p_expected_renewal_version: (await read(a, c)).renewal.workflow.version,
    p_end_date: "2091-04-02",
    p_action_deadline: null,
    p_confirmed: true,
  });
  expect(done.data.status).toBe("success");
  await reconcileDirectory(a, namespace);
  const next = done.data.credential;
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.reminder_jobs where cycle_id=$1 and state='queued'",
        [next.current_cycle.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await a.client.rpc("archive_practice_credential", {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
        p_credential_id: c.id,
        p_expected_version: next.version,
        p_expected_cycle_id: next.current_cycle.id,
        p_expected_date_revision: next.current_cycle.date_revision,
      })
    ).data.status,
  ).toBe("success");
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.reminder_jobs where credential_id=$1 and state in ('queued','claimed')",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(0);
});

it("DIR07 invalid next dates make no writes and completion retains directory snapshot after type correction", async () => {
  const a = await practice(),
    c = await read(a, await create(a, { p_action_deadline: "2090-02-01" }));
  const today = (
    await pool.query(
      "select to_char(clock_timestamp() at time zone timezone,'YYYY-MM-DD') today from public.practices where id=$1",
      [a.practice.id],
    )
  ).rows[0].today;
  const args = {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: c.current_cycle.date_revision,
    p_expected_renewal_version: c.renewal.workflow.version,
    p_end_date: "2091-03-02",
    p_action_deadline: null,
    p_confirmed: true,
  };
  const before = await snapshot(a.practice.id);
  for (const patch of [
    { p_end_date: null },
    { p_end_date: "" },
    { p_end_date: "bad" },
    { p_end_date: today },
    { p_end_date: "2000-01-01" },
    { p_action_deadline: today },
    { p_action_deadline: "2000-01-01" },
    { p_action_deadline: "2091-03-02" },
    { p_action_deadline: "2091-03-03" },
    { p_confirmed: false },
  ]) {
    const r = await a.client.rpc("complete_credential_renewal", {
      ...args,
      p_request_id: randomUUID(),
      ...patch,
    });
    expect(r.error).toBeNull();
    expect(r.data.status).toBe("invalid");
  }
  expect(await snapshot(a.practice.id)).toEqual(before);
  const done = await a.client.rpc("complete_credential_renewal", args);
  expect(done.error).toBeNull();
  expect(done.data.status).toBe("success");
  expect(done.data.credential.current_cycle.action_deadline).toBeNull();
  const changed = await save(a, done.data.credential, {
    p_type: "state_license",
    p_issuer: "Board",
    p_record_number: "NEW",
  });
  const history = await a.client.rpc("get_credential_renewal_history", {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_before_cycle_number: null,
  });
  expect(history.data.cycles.map((v: { type: string }) => v.type)).toEqual([
    "state_license",
    "insurance_payer_provider_directory",
  ]);
  const evidence = await a.client.rpc("get_renewal_evidence", {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_cycle_id: c.current_cycle.id,
  });
  expect(evidence.data.cycle.type).toBe("insurance_payer_provider_directory");
  expect(
    (await a.client.rpc("complete_credential_renewal", args)).data,
  ).toEqual(done.data);
  expect((await read(a, c)).current_cycle.id).toBe(
    changed.credential.current_cycle.id,
  );
});

it("DIR09 directory due dates and private metadata use the existing Gmail submission contract", async () => {
  await pool.query("select private.expire_email_submissions_at('2100-01-01')");
  await pool.query("select private.expire_gmail_reminders_at('2100-01-01')");
  const a = await practice(),
    c = await create(a),
    m = await membership(a.practice.id, a.user.id),
    namespace = `directory-${randomUUID()}`;
  await a.client.rpc("set_practice_reminder_recipient", {
    p_practice_id: a.practice.id,
    p_membership_id: m.id,
    p_expected_version: 1,
  });
  await pool.query(
    "update public.credential_cycles set updated_at='2080-01-01' where id=$1",
    [c.current_cycle.id],
  );
  await reconcileDirectory(a, namespace);
  const job = (
      await pool.query(
        "select * from private.reminder_jobs where credential_id=$1",
        [c.id],
      )
    ).rows[0],
    token = randomUUID(),
    now = "2090-01-02T10:00:00Z";
  expect(job.state).toBe("queued");
  await pool.query(
    "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until='2090-01-02T10:00:30Z' where id=$1",
    [job.id, token],
  );
  const config = {
    namespace,
    from: a.email,
    replyTo: a.email,
    appUrl: "http://127.0.0.1:3000",
  };
  await pool.query(
    "update private.gmail_reminder_authority set enabled=false where enabled",
  );
  await pool.query(
    "insert into private.gmail_reminder_authority(namespace,sender,subject,allowed_recipient,app_origin,enabled) values($1,$2,'directory-subject',$2,$3,true)",
    [namespace, a.email, config.appUrl],
  );
  try {
    const result = (
      await pool.query(
        "select private.begin_gmail_reminder_at($1,$2,$3,'directory-subject',1,$4) value",
        [job.id, token, config, now],
      )
    ).rows[0].value;
    expect(result.status).toBe("submit");
    for (const value of [c.title, c.issuer, c.record_number])
      expect(JSON.stringify(result.payload)).not.toContain(value);
    const recorded = (
      await pool.query(
        "select private.record_gmail_reminder_at($1,$2,'uncertain',null,null,$3) value",
        [result.attemptId, result.token, now],
      )
    ).rows[0].value;
    expect(recorded.status).toBe("recorded");
  } finally {
    await pool.query(
      "update private.gmail_reminder_authority set enabled=false where namespace=$1",
      [namespace],
    );
  }
});
