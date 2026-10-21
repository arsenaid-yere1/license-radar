import { randomUUID, createHash } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { practice, account, invite, pool } from "../helpers/access-fixtures";
import { anonymous } from "../helpers/local-fixtures";
import { provisionEvidenceStorage } from "../../tools/evidence-storage.mjs";
type Actor = Awaited<ReturnType<typeof practice>>;
const proof = Buffer.from("%PDF-1.7\nbenign fixture\n%%EOF\n"),
  digest = createHash("sha256").update(proof).digest("hex");
afterAll(() => pool.end());
it("EV02 EV06 EV07 archived retention stale leases and atomic audit failures", async () => {
  const a = await practice(),
    c = await record(a),
    input = reservation(a, c);
  const id = (await a.client.rpc("reserve_renewal_evidence", input)).data
    .evidenceId;
  const claim = await privileged("claim_renewal_evidence_upload", [
    a.practice.id,
    a.user.id,
    id,
  ]);
  expect(
    await privileged("claim_renewal_evidence_upload", [
      a.practice.id,
      a.user.id,
      id,
    ]),
  ).toEqual({ status: "busy" });
  await pool.query(
    "update private.renewal_evidence_objects set claim_until='2000-01-01' where evidence_id=$1",
    [id],
  );
  expect(
    await privileged("finalize_renewal_evidence_upload", [
      a.practice.id,
      a.user.id,
      id,
      claim.token,
      proof.length,
      digest,
    ]),
  ).toEqual({ status: "busy" });
  const next = await privileged("claim_renewal_evidence_upload", [
    a.practice.id,
    a.user.id,
    id,
  ]);
  expect(next.path).toBe(claim.path);
  expect(next.token).not.toBe(claim.token);
  expect(
    await privileged("finalize_renewal_evidence_upload", [
      a.practice.id,
      a.user.id,
      id,
      claim.token,
      proof.length,
      digest,
    ]),
  ).toEqual({ status: "busy" });
  expect(
    await privileged("finalize_renewal_evidence_upload", [
      a.practice.id,
      a.user.id,
      id,
      next.token,
      proof.length,
      digest,
    ]),
  ).toMatchObject({ state: "available" });
  expect(await privileged("claim_renewal_evidence_cleanup", [id])).toEqual([]);
  const pending = (
    await a.client.rpc("reserve_renewal_evidence", reservation(a, c))
  ).data.evidenceId;
  const pendingClaim = await privileged("claim_renewal_evidence_upload", [
    a.practice.id,
    a.user.id,
    pending,
  ]);
  const archive = await a.client.rpc("archive_practice_credential", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_credential_id: c.id,
    p_expected_version: c.version,
    p_expected_cycle_id: c.current_cycle.id,
    p_expected_date_revision: 1,
  });
  expect(archive.data.status).toBe("success");
  expect(
    (await a.client.rpc("reserve_renewal_evidence", reservation(a, c))).data,
  ).toEqual({ status: "archived" });
  expect(
    await privileged("finalize_renewal_evidence_upload", [
      a.practice.id,
      a.user.id,
      pending,
      pendingClaim.token,
      proof.length,
      digest,
    ]),
  ).toEqual({ status: "archived" });
  const grant = [a.practice.id, a.user.id, c.id, c.current_cycle.id, id];
  expect(
    (await privileged("authorize_renewal_evidence_download", grant)).status,
  ).toBe("download");
  const before = (
    await pool.query(
      "select state,version from private.renewal_evidence where id=$1",
      [id],
    )
  ).rows;
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      a.user.id,
    ]);
    await db.query(
      "create or replace function private.evidence_event(p_record private.renewal_evidence,p_actor_id uuid,p_operation text) returns uuid language plpgsql volatile security invoker set search_path='' as $$begin raise exception 'fixture audit outage';end$$",
    );
    await expect(
      db.query("select public.remove_renewal_evidence($1,$2,$3,$4,$5,2,true)", [
        a.practice.id,
        c.id,
        c.current_cycle.id,
        id,
        randomUUID(),
      ]),
    ).rejects.toThrow("fixture audit outage");
  } finally {
    await db.query("rollback");
    db.release();
  }
  expect(
    (
      await pool.query(
        "select state,version from private.renewal_evidence where id=$1",
        [id],
      )
    ).rows,
  ).toEqual(before);
  const remove = {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_cycle_id: c.current_cycle.id,
    p_evidence_id: id,
    p_request_id: randomUUID(),
    p_expected_version: 1,
    p_confirmed: true,
  };
  expect((await a.client.rpc("remove_renewal_evidence", remove)).data).toEqual({
    status: "conflict",
  });
  expect(
    (
      await a.client.rpc("remove_renewal_evidence", {
        ...remove,
        p_expected_version: 2,
      })
    ).data.state,
  ).toBe("deleting");
  await pool.query(
    "update private.renewal_evidence_objects set claim_until='2000-01-01' where evidence_id=$1",
    [pending],
  );
  const cleanup = await privileged("claim_renewal_evidence_cleanup", [pending]);
  expect(cleanup).toHaveLength(1);
  expect(
    await privileged("record_renewal_evidence_cleanup", [
      cleanup[0].objectId,
      randomUUID(),
      true,
    ]),
  ).toBe(false);
  expect(
    await privileged("record_renewal_evidence_cleanup", [
      cleanup[0].objectId,
      cleanup[0].token,
      false,
    ]),
  ).toBe(true);
  expect(
    (
      await pool.query(
        "select state,charged from private.renewal_evidence where id=$1",
        [pending],
      )
    ).rows[0],
  ).toEqual({ state: "abandoned", charged: true });
});
it("EV05 EV07 EV10 real Storage APIs deny ordinary access and retain late cleanup", async () => {
  const service = await provisionEvidenceStorage(),
    a = await practice(),
    c = await record(a),
    input = reservation(a, c);
  const reserved = await a.client.rpc("reserve_renewal_evidence", input),
    id = reserved.data.evidenceId;
  const claim = await privileged("claim_renewal_evidence_upload", [
    a.practice.id,
    a.user.id,
    id,
  ]);
  expect(
    (
      await service.storage.from("renewal-evidence").upload(claim.path, proof, {
        contentType: "application/pdf",
        upsert: false,
      })
    ).error,
  ).toBeNull();
  const read = await service.storage
    .from("renewal-evidence")
    .download(claim.path);
  expect(read.error).toBeNull();
  expect(Buffer.from(await read.data!.arrayBuffer())).toEqual(proof);
  await privileged("finalize_renewal_evidence_upload", [
    a.practice.id,
    a.user.id,
    id,
    claim.token,
    proof.length,
    digest,
  ]);
  for (const client of [a.client, anonymous()]) {
    expect(
      (await client.storage.from("renewal-evidence").download(claim.path))
        .error,
    ).not.toBeNull();
    expect(
      (
        await client.storage
          .from("renewal-evidence")
          .createSignedUrl(claim.path, 60)
      ).error,
    ).not.toBeNull();
    expect((await client.storage.from("renewal-evidence").list()).data).toEqual(
      [],
    );
    expect(
      (
        await client.storage
          .from("renewal-evidence")
          .upload(claim.path + ".pdf", proof, {
            contentType: "application/pdf",
          })
      ).error,
    ).not.toBeNull();
  }
  await pool.query(
    "create policy evidence_fixture_permissive on storage.objects for all to anon, authenticated using (true) with check (true)",
  );
  try {
    for (const client of [a.client, anonymous()]) {
      expect(
        (await client.storage.from("renewal-evidence").download(claim.path))
          .error,
      ).not.toBeNull();
      expect(
        (
          await client.storage
            .from("renewal-evidence")
            .update(claim.path, proof, { contentType: "application/pdf" })
        ).error,
      ).not.toBeNull();
      expect(
        (
          await client.storage
            .from("renewal-evidence")
            .copy(claim.path, claim.path + ".copy")
        ).error,
      ).not.toBeNull();
      expect(
        (
          await client.storage
            .from("renewal-evidence")
            .move(claim.path, claim.path + ".move")
        ).error,
      ).not.toBeNull();
      await client.storage.from("renewal-evidence").remove([claim.path]);
      const retained = await service.storage
        .from("renewal-evidence")
        .download(claim.path);
      expect(retained.error).toBeNull();
      expect(Buffer.from(await retained.data!.arrayBuffer())).toEqual(proof);
    }
  } finally {
    await pool.query(
      "drop policy evidence_fixture_permissive on storage.objects",
    );
  }
  const grant = await privileged("authorize_renewal_evidence_download", [
    a.practice.id,
    a.user.id,
    c.id,
    c.current_cycle.id,
    id,
  ]);
  expect(grant.status).toBe("download");
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.renewal_evidence_audit_events where evidence_id=$1 and operation='download-authorized'",
        [id],
      )
    ).rows[0].n,
  ).toBe(1);
  const removed = await a.client.rpc("remove_renewal_evidence", {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_cycle_id: c.current_cycle.id,
    p_evidence_id: id,
    p_request_id: randomUUID(),
    p_expected_version: 2,
    p_confirmed: true,
  });
  expect(removed.data.state).toBe("deleting");
  let cleanup = await privileged("claim_renewal_evidence_cleanup", [id]);
  expect(cleanup).toHaveLength(1);
  expect(
    (await service.storage.from("renewal-evidence").remove([claim.path])).error,
  ).toBeNull();
  const missing = await service.storage
    .from("renewal-evidence")
    .info(claim.path);
  expect((missing.error as { code?: string } | null)?.code).toBe("NoSuchKey");
  expect(
    await privileged("record_renewal_evidence_cleanup", [
      cleanup[0].objectId,
      cleanup[0].token,
      true,
    ]),
  ).toBe(true);
  expect(
    (
      await service.storage.from("renewal-evidence").upload(claim.path, proof, {
        contentType: "application/pdf",
        upsert: false,
      })
    ).error,
  ).toBeNull();
  await pool.query(
    "update private.renewal_evidence_objects set next_check_at='2000-01-01' where evidence_id=$1",
    [id],
  );
  cleanup = await privileged("claim_renewal_evidence_cleanup", [id]);
  expect(cleanup).toHaveLength(1);
  expect(
    (await service.storage.from("renewal-evidence").remove([cleanup[0].path]))
      .error,
  ).toBeNull();
  expect(
    (
      (await service.storage.from("renewal-evidence").info(claim.path))
        .error as { code?: string } | null
    )?.code,
  ).toBe("NoSuchKey");
  expect(
    await privileged("record_renewal_evidence_cleanup", [
      cleanup[0].objectId,
      cleanup[0].token,
      true,
    ]),
  ).toBe(true);
});
async function record(a: Actor, patch: Record<string, unknown> = {}) {
  const r = await a.client.rpc("create_practice_credential_with_details", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_title: "Evidence policy",
    p_type: "malpractice_policy",
    p_owner_kind: "practice",
    p_owner_clinician_id: null,
    p_covered_clinician_ids: [],
    p_issuer: null,
    p_jurisdiction: "CA",
    p_end_date: "2090-03-02",
    p_action_deadline: null,
    ...patch,
  });
  expect(r.error).toBeNull();
  return r.data.credential;
}
function reservation(
  a: Actor,
  c: Awaited<ReturnType<typeof record>>,
  patch: Record<string, unknown> = {},
) {
  return {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_cycle_id: c.current_cycle.id,
    p_request_id: randomUUID(),
    p_filename: "proof.pdf",
    p_mime: "application/pdf",
    p_byte_count: proof.length,
    p_digest: digest,
    ...patch,
  };
}
async function privileged(name: string, args: unknown[]) {
  const db = await pool.connect();
  try {
    await db.query("begin;set local role service_role");
    const r = await db.query(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`,
      args,
    );
    await db.query("commit");
    return r.rows[0].result;
  } finally {
    await db.query("rollback");
    db.release();
  }
}
async function snapshot() {
  const rows: Record<string, unknown> = {};
  const tables = (
    await pool.query(
      "select n.nspname s,c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='private' or (n.nspname='public' and c.relname in ('practices','practice_memberships','clinicians','credentials','policy_coverage','credential_cycles'))) and c.relname not like 'renewal_evidence%' order by n.nspname,c.relname",
    )
  ).rows;
  for (const { s, t } of tables)
    rows[`${s}.${t}`] = (
      await pool.query(
        `select to_jsonb(r) row from ${s}.${t} r order by to_jsonb(r)::text`,
      )
    ).rows;
  return rows;
}
it("EV01 EV04 EV08 exact concurrent reserve finalize and removal preserve renewal state", async () => {
  const a = await practice(),
    c = await record(a),
    input = reservation(a, c),
    before = await snapshot();
  const replies = await Promise.all(
    Array.from({ length: 6 }, () =>
      a.client.rpc("reserve_renewal_evidence", input),
    ),
  );
  for (const r of replies) {
    expect(r.error).toBeNull();
    expect(r.data).toEqual(replies[0].data);
  }
  expect(replies[0].data).toMatchObject({
    status: "success",
    state: "pending",
  });
  const id = replies[0].data.evidenceId;
  expect(
    (
      await a.client.rpc("reserve_renewal_evidence", {
        ...input,
        p_digest: "a".repeat(64),
      })
    ).data,
  ).toEqual({ status: "request-conflict" });
  const claim = await privileged("claim_renewal_evidence_upload", [
    a.practice.id,
    a.user.id,
    id,
  ]);
  expect(claim.status).toBe("upload");
  expect(claim.path).not.toContain("proof.pdf");
  const final = await privileged("finalize_renewal_evidence_upload", [
    a.practice.id,
    a.user.id,
    id,
    claim.token,
    proof.length,
    digest,
  ]);
  expect(final).toEqual({
    status: "success",
    evidenceId: id,
    state: "available",
  });
  expect(
    await privileged("finalize_renewal_evidence_upload", [
      a.practice.id,
      a.user.id,
      id,
      claim.token,
      proof.length,
      digest,
    ]),
  ).toEqual(final);
  expect(
    (
      await pool.query(
        "select operation from private.renewal_evidence_audit_events where evidence_id=$1 order by occurred_at",
        [id],
      )
    ).rows.map((r) => r.operation),
  ).toEqual(["reserved", "uploaded"]);
  const remove = {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_cycle_id: c.current_cycle.id,
    p_evidence_id: id,
    p_request_id: randomUUID(),
    p_expected_version: 2,
    p_confirmed: true,
  };
  const removed = await a.client.rpc("remove_renewal_evidence", remove);
  expect(removed.error).toBeNull();
  expect(removed.data.state).toBe("deleting");
  expect((await a.client.rpc("remove_renewal_evidence", remove)).data).toEqual(
    removed.data,
  );
  expect(
    await privileged("authorize_renewal_evidence_download", [
      a.practice.id,
      a.user.id,
      c.id,
      c.current_cycle.id,
      id,
    ]),
  ).toEqual({ status: "not-found" });
  const cleanup = await privileged("claim_renewal_evidence_cleanup", [id]);
  expect(cleanup).toHaveLength(1);
  expect(
    await privileged("record_renewal_evidence_cleanup", [
      cleanup[0].objectId,
      cleanup[0].token,
      true,
    ]),
  ).toBe(true);
  expect(
    (
      await pool.query(
        "select filename,charged,state from private.renewal_evidence where id=$1",
        [id],
      )
    ).rows[0],
  ).toEqual({ filename: null, charged: false, state: "deleted" });
  expect(
    (await a.client.rpc("reserve_renewal_evidence", input)).data.state,
  ).toBe("deleted");
  expect(await snapshot()).toEqual(before);
});
it("EV01 EV02 EV04 shared policy ownership and actor keys remain independent", async () => {
  const a = await practice(),
    people: string[] = [];
  for (const name of ["Dr. Evidence One", "Dr. Evidence Two"]) {
    const created = await a.client.rpc("create_practice_clinician", {
      p_practice_id: a.practice.id,
      p_request_id: randomUUID(),
      p_name: name,
    });
    expect(created.error).toBeNull();
    people.push(created.data.clinician.id);
  }
  const shared = await record(a, { p_covered_clinician_ids: people }),
    manager = await account(),
    viewer = await account();
  for (const [member, role] of [
    [manager, "manager"],
    [viewer, "viewer"],
  ] as const) {
    const link = await invite(a, member.email, role);
    expect(
      (
        await member.client.rpc("accept_practice_invitation", {
          p_token_digest: link.digest,
        })
      ).error,
    ).toBeNull();
  }
  const input = reservation(a, shared);
  const first = (await a.client.rpc("reserve_renewal_evidence", input)).data,
    second = (await manager.client.rpc("reserve_renewal_evidence", input)).data;
  expect(first.status).toBe("success");
  expect(second.status).toBe("success");
  expect(first.evidenceId).not.toBe(second.evidenceId);
  const readArgs = {
    p_practice_id: a.practice.id,
    p_credential_id: shared.id,
    p_cycle_id: shared.current_cycle.id,
  };
  const own = (await a.client.rpc("get_renewal_evidence", readArgs)).data.files;
  expect(
    own.find((f: { id: string }) => f.id === first.evidenceId).requestId,
  ).toBe(input.p_request_id);
  expect(
    own.find((f: { id: string }) => f.id === second.evidenceId).requestId,
  ).toBeNull();
  const visible = (await viewer.client.rpc("get_renewal_evidence", readArgs))
    .data.files;
  expect(visible).toHaveLength(2);
  expect(
    visible.every((f: { requestId: string | null }) => f.requestId === null),
  ).toBe(true);
  const claim = await privileged("claim_renewal_evidence_upload", [
    a.practice.id,
    a.user.id,
    first.evidenceId,
  ]);
  await privileged("finalize_renewal_evidence_upload", [
    a.practice.id,
    a.user.id,
    first.evidenceId,
    claim.token,
    proof.length,
    digest,
  ]);
  expect(
    (
      await privileged("authorize_renewal_evidence_download", [
        a.practice.id,
        viewer.user.id,
        shared.id,
        shared.current_cycle.id,
        first.evidenceId,
      ])
    ).status,
  ).toBe("download");
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.renewal_evidence where credential_id=$1 and state='available'",
        [shared.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.policy_coverage where credential_id=$1",
        [shared.id],
      )
    ).rows[0].n,
  ).toBe(2);
  for (const type of ["state_license", "dea_registration"]) {
    const c = await record(a, {
      p_type: type,
      p_owner_kind: "clinician",
      p_owner_clinician_id: people[0],
      p_title: type,
    });
    expect(
      (await a.client.rpc("reserve_renewal_evidence", reservation(a, c))).data
        .status,
    ).toBe("success");
  }
});
it("EV02 foreign viewer anonymous and raw privileged calls fail closed", async () => {
  const a = await practice(),
    b = await practice(),
    c = await record(a),
    viewer = await account();
  const link = await invite(a, viewer.email, "viewer");
  expect(
    (
      await viewer.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).error,
  ).toBeNull();
  const input = reservation(a, c);
  for (const client of [b.client, viewer.client, anonymous()])
    expect(
      (await client.rpc("reserve_renewal_evidence", input)).error?.code,
    ).toBe("42501");
  for (const client of [a.client, viewer.client, b.client, anonymous()])
    expect(
      (
        await client.rpc("claim_renewal_evidence_upload", {
          p_practice_id: a.practice.id,
          p_actor_id: a.user.id,
          p_evidence_id: randomUUID(),
        })
      ).error?.code,
    ).toBe("42501");
  const read = await viewer.client.rpc("get_renewal_evidence", {
    p_practice_id: a.practice.id,
    p_credential_id: c.id,
    p_cycle_id: c.current_cycle.id,
  });
  expect(read.error).toBeNull();
  expect(read.data.files).toEqual([]);
  const foreign = await record(b);
  expect(
    (
      await a.client.rpc("reserve_renewal_evidence", {
        ...input,
        p_cycle_id: foreign.current_cycle.id,
      })
    ).data,
  ).toEqual({ status: "not-found" });
});
it("EV03 EV09 exact SQL bounds and concurrent cycle quota", async () => {
  const a = await practice(),
    c = await record(a);
  for (const patch of [
    { p_byte_count: 0 },
    { p_byte_count: 3145729 },
    { p_filename: "../proof.pdf" },
    { p_filename: "proof\\name.pdf" },
    { p_filename: "a\n.pdf" },
    { p_mime: "text/html" },
    { p_filename: "proof.png" },
    { p_digest: "A".repeat(64) },
    { p_request_id: null },
  ])
    expect(
      (await a.client.rpc("reserve_renewal_evidence", reservation(a, c, patch)))
        .data,
    ).toEqual({ status: "invalid" });
  const results = await Promise.all(
    Array.from({ length: 24 }, () =>
      a.client.rpc(
        "reserve_renewal_evidence",
        reservation(a, c, { p_byte_count: 3145728 }),
      ),
    ),
  );
  expect(results.filter((r) => r.data.status === "success")).toHaveLength(20);
  expect(results.filter((r) => r.data.status === "quota")).toHaveLength(4);
  expect(
    (
      await a.client.rpc("get_renewal_evidence", {
        p_practice_id: a.practice.id,
        p_credential_id: c.id,
        p_cycle_id: c.current_cycle.id,
      })
    ).data.files,
  ).toHaveLength(20);
  const second = await record(a);
  const more = await Promise.all(
    Array.from({ length: 15 }, () =>
      a.client.rpc(
        "reserve_renewal_evidence",
        reservation(a, second, { p_byte_count: 3145728 }),
      ),
    ),
  );
  expect(more.filter((r) => r.data.status === "success")).toHaveLength(13);
  expect(more.filter((r) => r.data.status === "quota")).toHaveLength(2);
});
it("EV02 EV07 post-lock demotion and revocation block finalize and replay but allow cleanup", async () => {
  const a = await practice();
  for (const revoke of [false, true]) {
    const manager = await account(),
      link = await invite(a, manager.email, "manager");
    expect(
      (
        await manager.client.rpc("accept_practice_invitation", {
          p_token_digest: link.digest,
        })
      ).error,
    ).toBeNull();
    const c = await record(a),
      input = { ...reservation(a, c), p_request_id: randomUUID() };
    const reserved = await manager.client.rpc(
        "reserve_renewal_evidence",
        input,
      ),
      id = reserved.data.evidenceId;
    const claim = await privileged("claim_renewal_evidence_upload", [
      a.practice.id,
      manager.user.id,
      id,
    ]);
    const member = (
        await pool.query(
          "select id,version from public.practice_memberships where practice_id=$1 and user_id=$2",
          [a.practice.id, manager.user.id],
        )
      ).rows[0],
      lock = await pool.connect();
    try {
      await lock.query("begin");
      await lock.query("select set_config('request.jwt.claim.sub',$1,true)", [
        a.user.id,
      ]);
      await lock.query("select private.mutate_member($1,$2,$3,$4)", [
        member.id,
        member.version,
        revoke ? null : "viewer",
        revoke,
      ]);
      const pending = privileged("finalize_renewal_evidence_upload", [
        a.practice.id,
        manager.user.id,
        id,
        claim.token,
        proof.length,
        digest,
      ]);
      let waiting = false;
      for (let n = 0; n < 200; n++) {
        if (
          (
            await pool.query(
              "select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%finalize_renewal_evidence_upload%'",
            )
          ).rowCount
        ) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(true);
      await lock.query("commit");
      await expect(pending).rejects.toMatchObject({ code: "42501" });
    } finally {
      await lock.query("rollback");
      lock.release();
    }
    expect(
      (await manager.client.rpc("reserve_renewal_evidence", input)).error?.code,
    ).toBe("42501");
    await pool.query(
      "update private.renewal_evidence_objects set claim_until='2000-01-01' where evidence_id=$1",
      [id],
    );
    const cleanup = await privileged("claim_renewal_evidence_cleanup", [id]);
    expect(cleanup).toHaveLength(1);
    expect(
      await privileged("record_renewal_evidence_cleanup", [
        cleanup[0].objectId,
        cleanup[0].token,
        false,
      ]),
    ).toBe(true);
    expect(
      (
        await pool.query(
          "select state,charged from private.renewal_evidence where id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ state: "abandoned", charged: true });
  }
});
