import { afterAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import {
  account,
  invite,
  membership,
  pool,
  practice,
} from "../helpers/access-fixtures";
import { anonymous } from "../helpers/local-fixtures";
import {
  disclosureVersion,
  otpDisclosure,
  reminderDisclosure,
} from "../../src/lib/sms/disclosures";

const accountSid = `AC${"1".repeat(32)}`;
const messagingSid = `MG${"2".repeat(32)}`;
const verifySid = `VA${"3".repeat(32)}`;
function phone() {
  return `+1202${Math.floor(1000000 + Math.random() * 8999999)}`;
}
type Owner = Awaited<ReturnType<typeof practice>>;
async function state(a: Owner) {
  const r = await a.client.rpc("get_my_practice_sms_enrollment", {
    p_practice_id: a.practice.id,
  });
  expect(r.error).toBeNull();
  return r.data;
}
async function prepare(
  a: Owner,
  number = phone(),
  version = 1,
  request = randomUUID(),
) {
  const r = await a.client.rpc("prepare_my_sms_verification", {
    p_practice_id: a.practice.id,
    p_request_id: request,
    p_phone: number,
    p_expected_version: version,
    p_change_confirmed: true,
    p_otp_permission: true,
    p_account_sid: accountSid,
    p_messaging_service_sid: messagingSid,
    p_verify_service_sid: verifySid,
  });
  expect(r.error).toBeNull();
  return { ...r.data, requestId: request };
}
async function service(name: string, args: unknown[]) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
  return (
    await pool.query(`select public.${name}(${placeholders}) result`, args)
  ).rows[0].result;
}
async function verify(a: Owner, prepared: Awaited<ReturnType<typeof prepare>>) {
  const sent = await service("claim_sms_verification_send", [
    a.practice.id,
    a.user.id,
    prepared.requestId,
  ]);
  expect(sent.status).toBe("claimed");
  const sid = `VE${randomUUID().replaceAll("-", "")}`;
  const provider = {
    accountSid,
    serviceSid: verifySid,
    sid,
    to: sent.phone,
    channel: "sms",
    status: "pending",
  };
  const pending = await service("record_sms_verification_send", [
    a.practice.id,
    a.user.id,
    prepared.requestId,
    sent.claimToken,
    provider,
  ]);
  expect(pending.status).toBe("success");
  const request = randomUUID();
  const checked = await service("claim_sms_verification_check", [
    a.practice.id,
    a.user.id,
    request,
    pending.enrollment.challengeId,
    pending.enrollment.version,
  ]);
  expect(checked.status).toBe("claimed");
  return service("record_sms_verification_check", [
    a.practice.id,
    a.user.id,
    request,
    checked.claimToken,
    { ...provider, status: "approved" },
  ]);
}
async function consent(a: Owner, version: number, request = randomUUID()) {
  return a.client.rpc("consent_my_practice_sms", {
    p_practice_id: a.practice.id,
    p_request_id: request,
    p_expected_version: version,
    p_consent: true,
  });
}
afterAll(async () => {
  await pool.end();
});

test("Empty enrollment is owner-safe", async () => {
  const a = await practice();
  expect(await state(a)).toEqual({
    version: 1,
    phoneRevision: 0,
    phoneSuffix: null,
    verified: false,
    consented: false,
    canEdit: true,
    reason: "not-started",
    challengeId: null,
    expiresAt: null,
    retryAfter: null,
    deliveryActive: false,
  });
});
test("OTP permission never grants reminder consent", async () => {
  const a = await practice();
  const p = await prepare(a);
  expect(p.status).toBe("success");
  expect(p.enrollment).toMatchObject({
    verified: false,
    consented: false,
    reason: "verification-pending",
    phoneRevision: 1,
    version: 2,
  });
  expect(
    (
      await pool.query(
        "select kind from private.sms_enrollment_events where practice_id=$1 order by occurred_at,id",
        [a.practice.id],
      )
    ).rows.map((r) => r.kind),
  ).toEqual(["phone-change", "otp-permission"]);
  expect(
    (
      await pool.query(
        "select disclosure_version,disclosure_text from private.sms_enrollment_events where practice_id=$1 and kind='otp-permission'",
        [a.practice.id],
      )
    ).rows,
  ).toEqual([
    { disclosure_version: disclosureVersion, disclosure_text: otpDisclosure },
  ]);
  expect(JSON.stringify(p)).not.toContain("+1202");
});
test("Verification needs separate reminder consent", async () => {
  const a = await practice();
  const p = await prepare(a);
  const verified = await verify(a, p);
  expect(verified.enrollment).toMatchObject({
    verified: true,
    consented: false,
    reason: "consent-required",
    deliveryActive: false,
  });
  const unchecked = await a.client.rpc("consent_my_practice_sms", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
    p_expected_version: verified.enrollment.version,
    p_consent: false,
  });
  expect(unchecked.error?.code).toBe("23514");
  const result = await consent(a, verified.enrollment.version);
  expect(result.error).toBeNull();
  expect(result.data.enrollment).toMatchObject({
    consented: true,
    reason: "enrolled",
    deliveryActive: false,
  });
  expect(
    (
      await pool.query(
        "select disclosure_version,disclosure_text from private.sms_enrollment_events where practice_id=$1 and kind='reminder-consent'",
        [a.practice.id],
      )
    ).rows,
  ).toEqual([
    {
      disclosure_version: disclosureVersion,
      disclosure_text: reminderDisclosure(a.practice.name),
    },
  ]);
});
test("Same-phone no-op preserves proof, consent and version after stale conflict", async () => {
  const a = await practice(),
    number = phone(),
    p = await prepare(a, number),
    v = await verify(a, p);
  const c = await consent(a, v.enrollment.version),
    before = await state(a);
  expect((await prepare(a, number, 1)).status).toBe("conflict");
  expect(
    (await prepare(a, number, c.data.enrollment.version)).enrollment,
  ).toEqual(before);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.sms_verification_requests where practice_id=$1 and intent='send'",
        [a.practice.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
test("Phone replacement invalidates prior proof", async () => {
  const a = await practice();
  const p = await prepare(a);
  const v = await verify(a, p);
  const c = await consent(a, v.enrollment.version);
  const stale = await prepare(a, phone(), 1);
  expect(stale.status).toBe("conflict");
  const replaced = await prepare(a, phone(), c.data.enrollment.version);
  expect(replaced.enrollment).toMatchObject({
    phoneRevision: 2,
    verified: false,
    consented: false,
    reason: "verification-pending",
  });
  expect(
    (
      await pool.query(
        "select state from private.sms_verification_challenges where id=$1",
        [p.enrollment.challengeId],
      )
    ).rows[0].state,
  ).toBe("invalidated");
});
test("Withdrawal is immediate and idempotent", async () => {
  const a = await practice();
  const p = await prepare(a);
  const v = await verify(a, p);
  const key = randomUUID();
  const c = await consent(a, v.enrollment.version, key);
  const request = randomUUID();
  const args = { p_practice_id: a.practice.id, p_request_id: request };
  const first = await a.client.rpc("withdraw_my_practice_sms", args);
  expect(first.error).toBeNull();
  expect(first.data.enrollment.reason).toBe("withdrawn");
  expect((await a.client.rpc("withdraw_my_practice_sms", args)).data).toEqual(
    first.data,
  );
  const replay = await consent(a, v.enrollment.version, key);
  expect(replay.data.enrollment).toMatchObject({
    consented: false,
    reason: "withdrawn",
    version: c.data.enrollment.version + 1,
  });
});
test("Only the active owner can prepare verification", async () => {
  const a = await practice();
  const foreign = await practice();
  expect(
    (
      await foreign.client.rpc("get_my_practice_sms_enrollment", {
        p_practice_id: a.practice.id,
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await anonymous().rpc("get_my_practice_sms_enrollment", {
        p_practice_id: a.practice.id,
      })
    ).error?.code,
  ).toBe("42501");
  for (const name of [
    "claim_sms_verification_send",
    "record_sms_verification_send",
    "claim_sms_verification_check",
    "record_sms_verification_check",
    "apply_sms_provider_opt_out",
  ]) {
    const result = await pool.query(
      "select has_function_privilege('authenticated',p.oid,'execute') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",
      [name],
    );
    expect(result.rows).toEqual([{ allowed: false }]);
  }
});
test("Access loss invalidates unselected enrollment", async () => {
  const a = await practice();
  const actor = await account();
  const link = await invite(a, actor.email);
  expect(
    (
      await actor.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).error,
  ).toBeNull();
  const staff = { ...actor, practice: a.practice };
  const p = await prepare(staff);
  const v = await verify(staff, p);
  await consent(staff, v.enrollment.version);
  const m = await membership(a.practice.id, actor.user.id);
  expect(
    (
      await a.client.rpc("change_practice_member_role", {
        p_membership_id: m.id,
        p_expected_version: m.version,
        p_role: "viewer",
      })
    ).data.status,
  ).toBe("success");
  expect(await state(staff)).toMatchObject({
    verified: false,
    consented: false,
    canEdit: false,
  });
  expect(
    (
      await actor.client.rpc("prepare_my_sms_verification", {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
        p_phone: phone(),
        p_expected_version: 1,
        p_change_confirmed: true,
        p_otp_permission: true,
        p_account_sid: accountSid,
        p_messaging_service_sid: messagingSid,
        p_verify_service_sid: verifySid,
      })
    ).error?.code,
  ).toBe("42501");
  expect(
    (
      await actor.client.rpc("withdraw_my_practice_sms", {
        p_practice_id: a.practice.id,
        p_request_id: randomUUID(),
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await a.client.rpc("change_practice_member_role", {
        p_membership_id: m.id,
        p_expected_version: m.version + 1,
        p_role: "manager",
      })
    ).data.status,
  ).toBe("success");
  expect(await state(staff)).toMatchObject({
    verified: false,
    consented: false,
  });
  const current = await membership(a.practice.id, actor.user.id);
  expect(
    (
      await a.client.rpc("revoke_practice_member", {
        p_membership_id: current.id,
        p_expected_version: current.version,
      })
    ).data.status,
  ).toBe("success");
  expect(
    (
      await actor.client.rpc("get_my_practice_sms_enrollment", {
        p_practice_id: a.practice.id,
      })
    ).error?.code,
  ).toBe("42501");
});
test("STOP is signed and globally terminal", async () => {
  const a = await practice();
  const p = await prepare(a);
  const v = await verify(a, p);
  await consent(a, v.enrollment.version);
  const endpoint = (
    await pool.query(
      "select e.* from private.sms_phone_endpoints e join private.practice_sms_enrollments s on s.endpoint_id=e.id where s.practice_id=$1",
      [a.practice.id],
    )
  ).rows[0];
  const message = `SM${randomUUID().replaceAll("-", "")}`;
  const args = [accountSid, messagingSid, endpoint.phone_e164, message, "STOP"];
  expect((await service("apply_sms_provider_opt_out", args)).status).toBe(
    "success",
  );
  expect(await state(a)).toMatchObject({
    reason: "provider-opted-out",
    consented: false,
  });
  await service("apply_sms_provider_opt_out", args);
  await service("apply_sms_provider_opt_out", [
    accountSid,
    messagingSid,
    endpoint.phone_e164,
    `SM${randomUUID().replaceAll("-", "")}`,
    "START",
  ]);
  expect(await state(a)).toMatchObject({
    reason: "provider-opted-out",
    consented: false,
  });
  expect(
    (
      await pool.query(
        "select suppression_epoch from private.sms_phone_endpoints where id=$1",
        [endpoint.id],
      )
    ).rows[0].suppression_epoch,
  ).toBe(1);
});

test("One live challenge exists per endpoint", async () => {
  const a = await practice(),
    b = await practice(),
    number = phone();
  const [first, second] = await Promise.all([
    prepare(a, number),
    prepare(b, number),
  ]);
  expect([first.status, second.status].sort()).toEqual(["busy", "success"]);
  const count = await pool.query(
    "select count(*)::int n from private.sms_verification_challenges c join private.sms_phone_endpoints e on e.id=c.endpoint_id where e.phone_e164=$1 and c.state in ('reserved','pending','uncertain')",
    [number],
  );
  expect(count.rows[0].n).toBe(1);
});
test("Requests are immutable and claimed once", async () => {
  const a = await practice(),
    p = await prepare(a);
  const [one, two] = await Promise.all([
    service("claim_sms_verification_send", [
      a.practice.id,
      a.user.id,
      p.requestId,
    ]),
    service("claim_sms_verification_send", [
      a.practice.id,
      a.user.id,
      p.requestId,
    ]),
  ]);
  expect([one.status, two.status].sort()).toEqual(["claimed", "uncertain"]);
  expect((await state(a)).reason).toBe("verification-pending");
  await pool.query(
    "update private.sms_verification_requests set lease_until=clock_timestamp()-interval '1 second' where request_id=$1",
    [p.requestId],
  );
  expect(
    (
      await service("claim_sms_verification_send", [
        a.practice.id,
        a.user.id,
        p.requestId,
      ])
    ).status,
  ).toBe("uncertain");
  expect(await state(a)).toMatchObject({
    reason: "verification-uncertain",
    verified: false,
  });
});
async function start(a: Owner, p: Awaited<ReturnType<typeof prepare>>) {
  const claimed = await service("claim_sms_verification_send", [
    a.practice.id,
    a.user.id,
    p.requestId,
  ]);
  const outcome = {
    accountSid,
    serviceSid: verifySid,
    sid: `VE${randomUUID().replaceAll("-", "")}`,
    to: claimed.phone,
    channel: "sms",
    status: "pending",
  };
  const result = await service("record_sms_verification_send", [
    a.practice.id,
    a.user.id,
    p.requestId,
    claimed.claimToken,
    outcome,
  ]);
  expect(result.status).toBe("success");
  return { claimed, outcome, result };
}
test("Code checks are bounded and serialized", async () => {
  const a = await practice(),
    p = await prepare(a),
    s = await start(a, p);
  const first = randomUUID();
  const claim = await service("claim_sms_verification_check", [
    a.practice.id,
    a.user.id,
    first,
    p.enrollment.challengeId,
    s.result.enrollment.version,
  ]);
  expect(
    (
      await service("claim_sms_verification_check", [
        a.practice.id,
        a.user.id,
        randomUUID(),
        p.enrollment.challengeId,
        s.result.enrollment.version,
      ])
    ).status,
  ).toBe("busy");
  expect(
    (
      await service("record_sms_verification_check", [
        a.practice.id,
        a.user.id,
        first,
        claim.claimToken,
        s.outcome,
      ])
    ).status,
  ).toBe("wrong-code");
  for (let i = 1; i < 5; i++) {
    const request = randomUUID(),
      check = await service("claim_sms_verification_check", [
        a.practice.id,
        a.user.id,
        request,
        p.enrollment.challengeId,
        s.result.enrollment.version,
      ]);
    expect(check.status).toBe("claimed");
    expect(
      (
        await service("record_sms_verification_check", [
          a.practice.id,
          a.user.id,
          request,
          check.claimToken,
          s.outcome,
        ])
      ).status,
    ).toBe("wrong-code");
  }
  expect(
    (
      await service("claim_sms_verification_check", [
        a.practice.id,
        a.user.id,
        randomUUID(),
        p.enrollment.challengeId,
        s.result.enrollment.version,
      ])
    ).status,
  ).toBe("verification-required");
  expect(
    (
      await pool.query(
        "select check_count from private.sms_verification_challenges where id=$1",
        [p.enrollment.challengeId],
      )
    ).rows[0].check_count,
  ).toBe(5);
  expect((await state(a)).verified).toBe(false);
});
test("Resend retains first expiry", async () => {
  const a = await practice(),
    number = phone(),
    p = await prepare(a, number),
    s = await start(a, p);
  await pool.query(
    "update private.sms_verification_requests set reserved_at=clock_timestamp()-interval '61 seconds' where request_id=$1",
    [p.requestId],
  );
  const resend = await prepare(a, number, s.result.enrollment.version);
  expect(resend.enrollment.challengeId).toBe(p.enrollment.challengeId);
  expect(resend.enrollment.expiresAt).toBe(p.enrollment.expiresAt);
  const claim = await service("claim_sms_verification_send", [
    a.practice.id,
    a.user.id,
    resend.requestId,
  ]);
  expect(claim.status).toBe("claimed");
  expect(claim.verificationSid).toBe(s.outcome.sid);
});
test("Send budgets count every reservation", async () => {
  const a = await practice(),
    number = phone(),
    p = await prepare(a, number),
    s = await start(a, p);
  const blocked = await prepare(a, number, s.result.enrollment.version);
  expect(
    (
      await service("claim_sms_verification_send", [
        a.practice.id,
        a.user.id,
        blocked.requestId,
      ])
    ).status,
  ).toBe("rate-limited");
  for (let i = 1; i < 5; i++) {
    await pool.query(
      "update private.sms_verification_requests set reserved_at=clock_timestamp()-interval '61 seconds' where actor_user_id=$1 and reserved_at is not null",
      [a.user.id],
    );
    const resend = await prepare(a, number, s.result.enrollment.version),
      claim = await service("claim_sms_verification_send", [
        a.practice.id,
        a.user.id,
        resend.requestId,
      ]);
    expect(claim.status).toBe("claimed");
    await service("record_sms_verification_send", [
      a.practice.id,
      a.user.id,
      resend.requestId,
      claim.claimToken,
      s.outcome,
    ]);
  }
  await pool.query(
    "update private.sms_verification_requests set reserved_at=clock_timestamp()-interval '61 seconds' where actor_user_id=$1 and reserved_at is not null",
    [a.user.id],
  );
  const sixth = await prepare(a, phone(), s.result.enrollment.version);
  expect(
    (
      await service("claim_sms_verification_send", [
        a.practice.id,
        a.user.id,
        sixth.requestId,
      ])
    ).status,
  ).toBe("rate-limited");
});
test("Stale approval loses to replacement or access loss", async () => {
  const a = await practice(),
    p = await prepare(a),
    s = await start(a, p),
    request = randomUUID();
  const claim = await service("claim_sms_verification_check", [
    a.practice.id,
    a.user.id,
    request,
    p.enrollment.challengeId,
    s.result.enrollment.version,
  ]);
  const changed = await prepare(a, phone(), s.result.enrollment.version);
  expect(
    (
      await service("record_sms_verification_check", [
        a.practice.id,
        a.user.id,
        request,
        claim.claimToken,
        { ...s.outcome, status: "approved" },
      ])
    ).status,
  ).toBe("verification-required");
  expect(await state(a)).toMatchObject({
    phoneRevision: changed.enrollment.phoneRevision,
    verified: false,
    consented: false,
  });
});
test("Selected readiness requires personal current enrollment", async () => {
  const a = await practice(),
    p = await prepare(a),
    v = await verify(a, p);
  await consent(a, v.enrollment.version);
  const owner = await membership(a.practice.id, a.user.id);
  await a.client.rpc("set_practice_reminder_recipient", {
    p_practice_id: a.practice.id,
    p_membership_id: owner.id,
    p_expected_version: 1,
  });
  const result = await a.client.rpc(
    "get_practice_reminder_recipient_with_enrollment",
    { p_practice_id: a.practice.id },
  );
  expect(result.error).toBeNull();
  expect(result.data.enrollment).toEqual({
    reason: "enrolled",
    enrollmentReady: true,
    deliveryActive: false,
  });
  expect(result.data.recipient.ready).toBe(false);
  expect(Object.keys(result.data.enrollment).sort()).toEqual([
    "deliveryActive",
    "enrollmentReady",
    "reason",
  ]);
  await a.client.rpc("withdraw_my_practice_sms", {
    p_practice_id: a.practice.id,
    p_request_id: randomUUID(),
  });
  expect(
    (
      await a.client.rpc("get_practice_reminder_recipient_with_enrollment", {
        p_practice_id: a.practice.id,
      })
    ).data.enrollment.enrollmentReady,
  ).toBe(false);
});

test("Audit and receipt faults roll back mutations", async () => {
  const a = await practice(),
    p = await prepare(a),
    s = await start(a, p),
    request = randomUUID();
  const claim = await service("claim_sms_verification_check", [
    a.practice.id,
    a.user.id,
    request,
    p.enrollment.challengeId,
    s.result.enrollment.version,
  ]);
  const before = await state(a);
  await pool.query(
    "create function private.sms_test_fault() returns trigger language plpgsql as $$begin raise exception 'deliberate SMS audit fault'; end;$$; create trigger sms_test_fault before insert on private.sms_enrollment_events for each row execute function private.sms_test_fault()",
  );
  try {
    await expect(
      service("record_sms_verification_check", [
        a.practice.id,
        a.user.id,
        request,
        claim.claimToken,
        { ...s.outcome, status: "approved" },
      ]),
    ).rejects.toThrow("deliberate SMS audit fault");
    expect(await state(a)).toEqual(before);
    expect(
      (
        await pool.query(
          "select state from private.sms_verification_requests where request_id=$1",
          [request],
        )
      ).rows[0].state,
    ).toBe("claimed");
  } finally {
    await pool.query(
      "drop trigger sms_test_fault on private.sms_enrollment_events; drop function private.sms_test_fault()",
    );
  }
  const proof = await service("record_sms_verification_check", [
    a.practice.id,
    a.user.id,
    request,
    claim.claimToken,
    { ...s.outcome, status: "approved" },
  ]);
  expect(proof.enrollment.verified).toBe(true);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.sms_enrollment_events where practice_id=$1 and kind='verified'",
        [a.practice.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await pool.query(
    "create function private.sms_test_fault() returns trigger language plpgsql as $$begin raise exception 'deliberate SMS receipt fault'; end;$$; create trigger sms_test_fault before insert on private.sms_action_receipts for each row execute function private.sms_test_fault()",
  );
  try {
    const failed = await consent(a, proof.enrollment.version);
    expect(failed.error?.message).toBe("deliberate SMS receipt fault");
    expect(await state(a)).toEqual(proof.enrollment);
    expect(
      (
        await pool.query(
          "select count(*)::int n from private.sms_enrollment_events where practice_id=$1 and kind='reminder-consent'",
          [a.practice.id],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await pool.query(
      "drop trigger sms_test_fault on private.sms_action_receipts; drop function private.sms_test_fault()",
    );
  }
});
async function waitForLock(pid: number) {
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "select wait_event_type from pg_stat_activity where pid=$1",
            [pid],
          )
        ).rows[0]?.wait_event_type,
      { timeout: 10000, interval: 20 },
    )
    .toBe("Lock");
}
test("STOP wins consent and approval races", async () => {
  for (const stopFirst of [true, false]) {
    const a = await practice(),
      p = await prepare(a),
      v = await verify(a, p);
    const endpoint = (
      await pool.query(
        "select * from private.sms_phone_endpoints where id=(select endpoint_id from private.practice_sms_enrollments where practice_id=$1)",
        [a.practice.id],
      )
    ).rows[0];
    const holder = await pool.connect(),
      contender = await pool.connect();
    try {
      const pid = (await contender.query("select pg_backend_pid() pid")).rows[0]
        .pid;
      await holder.query("begin");
      await holder.query(
        "select id from private.sms_phone_endpoints where id=$1 for update",
        [endpoint.id],
      );
      if (stopFirst) {
        await contender.query(
          "select set_config('request.jwt.claim.sub',$1,false)",
          [a.user.id],
        );
        const consentWaiting = contender.query(
          "select public.consent_my_practice_sms($1,$2,$3,true) result",
          [a.practice.id, randomUUID(), v.enrollment.version],
        );
        await waitForLock(pid);
        await holder.query(
          "select public.apply_sms_provider_opt_out($1,$2,$3,$4,'STOP')",
          [
            accountSid,
            messagingSid,
            endpoint.phone_e164,
            `SM${randomUUID().replaceAll("-", "")}`,
          ],
        );
        await holder.query("commit");
        expect((await consentWaiting).rows[0].result.status).toBe(
          "verification-required",
        );
      } else {
        const waiting = contender.query(
          "select public.apply_sms_provider_opt_out($1,$2,$3,$4,'STOP') result",
          [
            accountSid,
            messagingSid,
            endpoint.phone_e164,
            `SM${randomUUID().replaceAll("-", "")}`,
          ],
        );
        await waitForLock(pid);
        await holder.query(
          "select set_config('request.jwt.claim.sub',$1,true)",
          [a.user.id],
        );
        expect(
          (
            await holder.query(
              "select public.consent_my_practice_sms($1,$2,$3,true) result",
              [a.practice.id, randomUUID(), v.enrollment.version],
            )
          ).rows[0].result.status,
        ).toBe("success");
        await holder.query("commit");
        expect((await waiting).rows[0].result.status).toBe("success");
      }
      expect(await state(a)).toMatchObject({
        reason: "provider-opted-out",
        consented: false,
      });
    } finally {
      await holder.query("rollback");
      await contender.query(
        "select set_config('request.jwt.claim.sub','',false)",
      );
      holder.release();
      contender.release();
    }
  }
});

test("STOP serializes against trusted approval in both orders", async () => {
  for (const stopFirst of [true, false]) {
    const a = await practice(),
      p = await prepare(a),
      s = await start(a, p),
      request = randomUUID();
    const claim = await service("claim_sms_verification_check", [
      a.practice.id,
      a.user.id,
      request,
      p.enrollment.challengeId,
      s.result.enrollment.version,
    ]);
    const endpoint = (
      await pool.query(
        "select * from private.sms_phone_endpoints where id=(select endpoint_id from private.practice_sms_enrollments where practice_id=$1)",
        [a.practice.id],
      )
    ).rows[0];
    const holder = await pool.connect(),
      contender = await pool.connect();
    try {
      const pid = (await contender.query("select pg_backend_pid() pid")).rows[0]
        .pid;
      await holder.query("begin");
      if (!stopFirst)
        await holder.query(
          "select id from public.practices where id=$1 for update",
          [a.practice.id],
        );
      await holder.query(
        "select id from private.sms_phone_endpoints where id=$1 for update",
        [endpoint.id],
      );
      const approved = [
        a.practice.id,
        a.user.id,
        request,
        claim.claimToken,
        { ...s.outcome, status: "approved" },
      ];
      const stop = [
        accountSid,
        messagingSid,
        endpoint.phone_e164,
        `SM${randomUUID().replaceAll("-", "")}`,
      ];
      const waiting = stopFirst
        ? contender.query(
            "select public.record_sms_verification_check($1,$2,$3,$4,$5) result",
            approved,
          )
        : contender.query(
            "select public.apply_sms_provider_opt_out($1,$2,$3,$4,'STOP') result",
            stop,
          );
      await waitForLock(pid);
      if (stopFirst)
        await holder.query(
          "select public.apply_sms_provider_opt_out($1,$2,$3,$4,'STOP')",
          stop,
        );
      else
        expect(
          (
            await holder.query(
              "select public.record_sms_verification_check($1,$2,$3,$4,$5) result",
              approved,
            )
          ).rows[0].result.enrollment.verified,
        ).toBe(true);
      await holder.query("commit");
      expect((await waiting).rows[0].result.status).toBe(
        stopFirst ? "verification-required" : "success",
      );
      expect(await state(a)).toMatchObject({
        reason: "provider-opted-out",
        consented: false,
        verified: !stopFirst,
      });
    } finally {
      await holder.query("rollback");
      holder.release();
      contender.release();
    }
  }
});

test("Ordinary callers cannot execute proof entry points", async () => {
  const a = await practice(),
    p = await prepare(a);
  const calls = {
    claim_sms_verification_send: {
      p_practice_id: a.practice.id,
      p_actor_id: a.user.id,
      p_request_id: p.requestId,
    },
    record_sms_verification_send: {
      p_practice_id: a.practice.id,
      p_actor_id: a.user.id,
      p_request_id: p.requestId,
      p_claim_token: randomUUID(),
      p_outcome: { status: "approved" },
    },
    claim_sms_verification_check: {
      p_practice_id: a.practice.id,
      p_actor_id: a.user.id,
      p_request_id: randomUUID(),
      p_challenge_id: p.enrollment.challengeId,
      p_expected_version: p.enrollment.version,
    },
    record_sms_verification_check: {
      p_practice_id: a.practice.id,
      p_actor_id: a.user.id,
      p_request_id: randomUUID(),
      p_claim_token: randomUUID(),
      p_outcome: { status: "approved" },
    },
    apply_sms_provider_opt_out: {
      p_account_sid: accountSid,
      p_messaging_service_sid: messagingSid,
      p_phone: phone(),
      p_message_sid: `SM${randomUUID().replaceAll("-", "")}`,
      p_opt_out_type: "STOP",
    },
  };
  for (const client of [a.client, anonymous()])
    for (const [name, args] of Object.entries(calls))
      expect((await client.rpc(name, args)).error?.code).toBe("42501");
  expect(await state(a)).toMatchObject({ verified: false, consented: false });
});

test("Callback duplicates, shared suppression and unknown-phone tombstones are durable", async () => {
  const a = await practice(),
    b = await practice(),
    number = phone();
  const p = await prepare(a, number),
    v = await verify(a, p);
  await consent(a, v.enrollment.version);
  await pool.query(
    "update private.sms_verification_requests set reserved_at=clock_timestamp()-interval '61 seconds' where request_id=$1",
    [p.requestId],
  );
  const q = await prepare(b, number),
    w = await verify(b, q);
  await consent(b, w.enrollment.version);
  const message = `SM${randomUUID().replaceAll("-", "")}`;
  const args = [accountSid, messagingSid, number, message, "STOP"];
  expect(await service("apply_sms_provider_opt_out", args)).toEqual({
    status: "success",
  });
  expect(await service("apply_sms_provider_opt_out", args)).toEqual({
    status: "success",
  });
  expect(
    await service("apply_sms_provider_opt_out", [...args.slice(0, 4), "START"]),
  ).toEqual({ status: "conflict" });
  for (const owner of [a, b])
    expect(await state(owner)).toMatchObject({
      reason: "provider-opted-out",
      consented: false,
    });
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.sms_provider_events where message_sid=$1",
        [message],
      )
    ).rows[0].n,
  ).toBe(1);
  const unknown = phone();
  await service("apply_sms_provider_opt_out", [
    accountSid,
    messagingSid,
    unknown,
    `SM${randomUUID().replaceAll("-", "")}`,
    "STOP",
  ]);
  expect((await prepare(await practice(), unknown)).status).toBe("blocked");
  expect(
    (
      await pool.query(
        "select column_name from information_schema.columns where table_schema='private' and table_name='sms_provider_events'",
      )
    ).rows.map((row) => row.column_name),
  ).not.toContain("body");
});

test("Provider event faults roll back suppression and permit retry", async () => {
  const a = await practice(),
    p = await prepare(a),
    v = await verify(a, p);
  await consent(a, v.enrollment.version);
  const endpoint = (
    await pool.query(
      "select e.* from private.sms_phone_endpoints e join private.practice_sms_enrollments s on s.endpoint_id=e.id where s.practice_id=$1",
      [a.practice.id],
    )
  ).rows[0];
  const args = [
    accountSid,
    messagingSid,
    endpoint.phone_e164,
    `SM${randomUUID().replaceAll("-", "")}`,
    "STOP",
  ];
  await pool.query(
    "create function private.sms_test_fault() returns trigger language plpgsql as $$begin raise exception 'deliberate provider event fault'; end;$$; create trigger sms_test_fault before insert on private.sms_provider_events for each row execute function private.sms_test_fault()",
  );
  try {
    await expect(service("apply_sms_provider_opt_out", args)).rejects.toThrow(
      "deliberate provider event fault",
    );
    expect(await state(a)).toMatchObject({
      reason: "enrolled",
      consented: true,
    });
    expect(
      (
        await pool.query(
          "select suppression_epoch from private.sms_phone_endpoints where id=$1",
          [endpoint.id],
        )
      ).rows[0].suppression_epoch,
    ).toBe(0);
  } finally {
    await pool.query(
      "drop trigger sms_test_fault on private.sms_provider_events; drop function private.sms_test_fault()",
    );
  }
  expect(await service("apply_sms_provider_opt_out", args)).toEqual({
    status: "success",
  });
  expect(await state(a)).toMatchObject({
    reason: "provider-opted-out",
    consented: false,
  });
});

test("Expired challenges reject checks and retire before successors", async () => {
  const a = await practice(),
    number = phone(),
    p = await prepare(a, number),
    s = await start(a, p);
  await pool.query(
    "update private.sms_verification_challenges set created_at=transaction_timestamp()-interval '11 minutes',expires_at=transaction_timestamp()-interval '1 minute' where id=$1",
    [p.enrollment.challengeId],
  );
  expect(
    (
      await service("claim_sms_verification_check", [
        a.practice.id,
        a.user.id,
        randomUUID(),
        p.enrollment.challengeId,
        s.result.enrollment.version,
      ])
    ).status,
  ).toBe("verification-required");
  expect(await state(a)).toMatchObject({
    challengeId: null,
    expiresAt: null,
    verified: false,
  });
  const next = await prepare(a, number, s.result.enrollment.version);
  expect(next.status).toBe("success");
  expect(next.enrollment.challengeId).not.toBe(p.enrollment.challengeId);
  expect(
    (
      await pool.query(
        "select state from private.sms_verification_challenges where id=$1",
        [p.enrollment.challengeId],
      )
    ).rows[0].state,
  ).toBe("expired");
});

test("Changed receipt payloads and cross-intent IDs never replay mutations", async () => {
  const a = await practice(),
    number = phone(),
    p = await prepare(a, number);
  const before = await state(a);
  expect((await prepare(a, number, 1, p.requestId)).enrollment).toEqual(before);
  expect((await prepare(a, phone(), 1, p.requestId)).status).toBe("conflict");
  expect(
    (
      await a.client.rpc("withdraw_my_practice_sms", {
        p_practice_id: a.practice.id,
        p_request_id: p.requestId,
      })
    ).data.status,
  ).toBe("conflict");
  expect(await state(a)).toEqual(before);
});

test("Composite foreign keys reject another practice's consent proof", async () => {
  const a = await practice(),
    b = await practice();
  for (const owner of [a, b]) {
    const p = await prepare(owner),
      v = await verify(owner, p);
    await consent(owner, v.enrollment.version);
  }
  const other = (
    await pool.query(
      "select consent_event_id from private.practice_sms_enrollments where practice_id=$1",
      [b.practice.id],
    )
  ).rows[0];
  await expect(
    pool.query(
      "update private.practice_sms_enrollments set consent_event_id=$1 where practice_id=$2",
      [other.consent_event_id, a.practice.id],
    ),
  ).rejects.toMatchObject({ code: "23503" });
  expect(await state(a)).toMatchObject({ reason: "enrolled", consented: true });
});

async function staffFor(a: Owner) {
  const actor = await account(),
    link = await invite(a, actor.email);
  expect(
    (
      await actor.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).data.status,
  ).toBe("success");
  return { ...actor, practice: a.practice };
}

test("Replacement and access loss serialize against approval in both orders", async () => {
  for (const mutation of ["phone", "viewer", "revoked"])
    for (const mutationFirst of [true, false]) {
      const admin = await practice(),
        a = mutation === "phone" ? admin : await staffFor(admin);
      const p = await prepare(a),
        s = await start(a, p),
        request = randomUUID();
      const claim = await service("claim_sms_verification_check", [
        a.practice.id,
        a.user.id,
        request,
        p.enrollment.challengeId,
        s.result.enrollment.version,
      ]);
      const member = await membership(a.practice.id, a.user.id),
        holder = await pool.connect(),
        contender = await pool.connect();
      const replacement = phone();
      async function mutate(db: typeof holder) {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          admin.user.id,
        ]);
        if (mutation === "phone")
          return db.query(
            "select public.prepare_my_sms_verification($1,$2,$3,$4,true,true,$5,$6,$7) result",
            [
              a.practice.id,
              randomUUID(),
              replacement,
              s.result.enrollment.version + (mutationFirst ? 0 : 1),
              accountSid,
              messagingSid,
              verifySid,
            ],
          );
        return mutation === "viewer"
          ? db.query(
              "select public.change_practice_member_role($1,$2,'viewer') result",
              [member.id, member.version],
            )
          : db.query("select public.revoke_practice_member($1,$2) result", [
              member.id,
              member.version,
            ]);
      }
      const proof = [
        a.practice.id,
        a.user.id,
        request,
        claim.claimToken,
        { ...s.outcome, status: "approved" },
      ];
      try {
        const pid = (await contender.query("select pg_backend_pid() pid"))
          .rows[0].pid;
        await holder.query("begin");
        await holder.query(
          "select id from public.practices where id=$1 for update",
          [a.practice.id],
        );
        // Handle the expected revoked/demoted error immediately to prevent an unhandled rejection while waiting.
        const waiting = (
          mutationFirst
            ? contender.query(
                "select public.record_sms_verification_check($1,$2,$3,$4,$5) result",
                proof,
              )
            : mutate(contender)
        ).then(
          (result) => ({ result, error: null }),
          (error) => ({ result: null, error }),
        );
        await waitForLock(pid);
        if (mutationFirst)
          expect((await mutate(holder)).rows[0].result.status).toBe("success");
        else
          expect(
            (
              await holder.query(
                "select public.record_sms_verification_check($1,$2,$3,$4,$5) result",
                proof,
              )
            ).rows[0].result.enrollment.verified,
          ).toBe(true);
        await holder.query("commit");
        const finished = await waiting;
        if (mutationFirst && mutation !== "phone")
          expect(finished.error?.code).toBe("42501");
        else
          expect(finished.result!.rows[0].result.status).toBe(
            mutationFirst ? "verification-required" : "success",
          );
        const enrollment = (
          await pool.query(
            "select verified_revision,consent_event_id from private.practice_sms_enrollments where practice_id=$1 and membership_id=$2",
            [a.practice.id, member.id],
          )
        ).rows[0];
        expect(enrollment).toEqual({
          verified_revision: null,
          consent_event_id: null,
        });
      } finally {
        await holder.query("rollback");
        for (const db of [holder, contender]) {
          await db.query("select set_config('request.jwt.claim.sub','',false)");
          db.release();
        }
      }
    }
});

test("Approval checks the lease after waiting for the practice lock", async () => {
  const a = await practice(),
    p = await prepare(a),
    s = await start(a, p),
    request = randomUUID();
  const claim = await service("claim_sms_verification_check", [
    a.practice.id,
    a.user.id,
    request,
    p.enrollment.challengeId,
    s.result.enrollment.version,
  ]);
  const holder = await pool.connect(),
    contender = await pool.connect();
  try {
    await holder.query("begin");
    await holder.query(
      "select id from public.practices where id=$1 for update",
      [a.practice.id],
    );
    await holder.query(
      "update private.sms_verification_requests set lease_until=clock_timestamp()+interval '300 milliseconds' where request_id=$1",
      [request],
    );
    const pid = (await contender.query("select pg_backend_pid() pid")).rows[0]
      .pid;
    const waiting = contender.query(
      "select public.record_sms_verification_check($1,$2,$3,$4,$5) result",
      [
        a.practice.id,
        a.user.id,
        request,
        claim.claimToken,
        { ...s.outcome, status: "approved" },
      ],
    );
    await waitForLock(pid);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await holder.query("commit");
    expect((await waiting).rows[0].result.status).toBe("uncertain");
    expect(await state(a)).toMatchObject({
      verified: false,
      reason: "verification-uncertain",
    });
  } finally {
    await holder.query("rollback");
    holder.release();
    contender.release();
  }
});

async function seedSendHistory(
  a: Owner,
  request: string,
  count: number,
  age: string,
) {
  // Valid retained fixture receipts isolate each rolling-window boundary without sending texts.
  await pool.query(
    "insert into private.sms_verification_requests (actor_user_id,practice_id,membership_id,request_id,challenge_id,intent,state,payload,claim_token,reserved_at,lease_until,outcome) select actor_user_id,practice_id,membership_id,gen_random_uuid(),challenge_id,'send','complete',payload,gen_random_uuid(),clock_timestamp()-$3::interval,clock_timestamp()-$3::interval+interval '30 seconds','success' from private.sms_verification_requests cross join generate_series(1,$2::integer) where request_id=$1 and practice_id=$4",
    [request, count, age, a.practice.id],
  );
  await pool.query(
    "update private.sms_verification_requests set reserved_at=clock_timestamp()-interval '61 seconds' where request_id=$1",
    [request],
  );
}
test("Daily actor, rolling phone and daily tenant budgets include retained reservations", async () => {
  for (const scope of [
    "actor-day",
    "phone-half-hour",
    "phone-day",
    "tenant-day",
  ]) {
    const a = await practice(),
      number = phone(),
      p = await prepare(a, number),
      v = await verify(a, p);
    const n = scope === "phone-half-hour" ? 4 : scope === "tenant-day" ? 99 : 9;
    await seedSendHistory(
      a,
      p.requestId,
      n,
      scope === "phone-half-hour" ? "2 minutes" : "31 minutes",
    );
    const owner = scope === "actor-day" ? a : await staffFor(a);
    const current = await state(owner);
    const next = await prepare(
      owner,
      scope === "actor-day" || scope === "tenant-day" ? phone() : number,
      current.version,
    );
    expect(next.status).toBe("success");
    expect(
      (
        await service("claim_sms_verification_send", [
          owner.practice.id,
          owner.user.id,
          next.requestId,
        ])
      ).status,
    ).toBe("rate-limited");
    expect((await state(owner)).verified).toBe(false);
    expect(v.enrollment.verified).toBe(true);
  }
});
test("Actor reservations survive a practice transition and old claims lose to revocation", async () => {
  const first = await practice(),
    second = await practice(),
    staff = await staffFor(first);
  const p = await prepare(staff),
    v = await verify(staff, p);
  await seedSendHistory(staff, p.requestId, 4, "2 minutes");
  const old = await prepare(staff, phone(), v.enrollment.version),
    member = await membership(first.practice.id, staff.user.id);
  const holder = await pool.connect(),
    contender = await pool.connect();
  try {
    const pid = (await contender.query("select pg_backend_pid() pid")).rows[0]
      .pid;
    await holder.query("begin");
    await holder.query(
      "select id from public.practices where id=$1 for update",
      [first.practice.id],
    );
    const waiting = contender
      .query("select public.claim_sms_verification_send($1,$2,$3)", [
        first.practice.id,
        staff.user.id,
        old.requestId,
      ])
      .then(
        (result) => ({ result, error: null }),
        (error) => ({ result: null, error }),
      );
    await waitForLock(pid);
    await holder.query("select set_config('request.jwt.claim.sub',$1,true)", [
      first.user.id,
    ]);
    await holder.query("select public.revoke_practice_member($1,$2)", [
      member.id,
      member.version,
    ]);
    await holder.query("commit");
    expect((await waiting).error?.code).toBe("42501");
  } finally {
    await holder.query("rollback");
    holder.release();
    contender.release();
  }
  const link = await invite(second, staff.email);
  expect(
    (
      await staff.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).data.status,
  ).toBe("success");
  const moved = { ...staff, practice: second.practice },
    next = await prepare(moved);
  expect(
    (
      await service("claim_sms_verification_send", [
        second.practice.id,
        staff.user.id,
        next.requestId,
      ])
    ).status,
  ).toBe("rate-limited");
  expect(await state(moved)).toMatchObject({
    verified: false,
    consented: false,
  });
});
test("Foreign, anonymous and revoked preparation has no enrollment side effects", async () => {
  const admin = await practice(),
    foreign = await practice(),
    staff = await staffFor(admin),
    member = await membership(admin.practice.id, staff.user.id);
  expect(
    (
      await admin.client.rpc("revoke_practice_member", {
        p_membership_id: member.id,
        p_expected_version: member.version,
      })
    ).data.status,
  ).toBe("success");
  for (const client of [foreign.client, anonymous(), staff.client])
    expect(
      (
        await client.rpc("prepare_my_sms_verification", {
          p_practice_id: admin.practice.id,
          p_request_id: randomUUID(),
          p_phone: phone(),
          p_expected_version: 1,
          p_change_confirmed: true,
          p_otp_permission: true,
          p_account_sid: accountSid,
          p_messaging_service_sid: messagingSid,
          p_verify_service_sid: verifySid,
        })
      ).error?.code,
    ).toBe("42501");
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.practice_sms_enrollments where practice_id=$1",
        [admin.practice.id],
      )
    ).rows[0].n,
  ).toBe(0);
});
test("SQL proof commits reject mismatched trusted metadata and non-approved outcomes", async () => {
  for (const patch of [
    { accountSid: `AC${"9".repeat(32)}` },
    { serviceSid: `VA${"9".repeat(32)}` },
    { sid: `VE${"9".repeat(32)}` },
    { to: phone() },
    { channel: "call" },
    { status: "failed" },
    { status: "pending" },
  ]) {
    const a = await practice(),
      p = await prepare(a),
      s = await start(a, p),
      request = randomUUID();
    const claim = await service("claim_sms_verification_check", [
      a.practice.id,
      a.user.id,
      request,
      p.enrollment.challengeId,
      s.result.enrollment.version,
    ]);
    const result = await service("record_sms_verification_check", [
      a.practice.id,
      a.user.id,
      request,
      claim.claimToken,
      { ...s.outcome, status: "approved", ...patch },
    ]);
    expect(result.status).toBe(
      patch.status === "failed"
        ? "verification-required"
        : patch.status === "pending"
          ? "wrong-code"
          : "uncertain",
    );
    expect(await state(a)).toMatchObject({ verified: false, consented: false });
    expect(
      (
        await pool.query(
          "select count(*)::int n from private.sms_enrollment_events where practice_id=$1 and kind='verified'",
          [a.practice.id],
        )
      ).rows[0].n,
    ).toBe(0);
  }
});
test("Eligible role changes retain enrollment and corrupt disclosure fails unavailable", async () => {
  const admin = await practice(),
    staff = await staffFor(admin),
    p = await prepare(staff),
    v = await verify(staff, p);
  await consent(staff, v.enrollment.version);
  const before = await state(staff),
    member = await membership(admin.practice.id, staff.user.id);
  expect(
    (
      await admin.client.rpc("change_practice_member_role", {
        p_membership_id: member.id,
        p_expected_version: member.version,
        p_role: "administrator",
      })
    ).data.status,
  ).toBe("success");
  expect(await state(staff)).toEqual(before);
  const receipt = (
    await pool.query(
      "select consent_event_id from private.practice_sms_enrollments where practice_id=$1 and membership_id=$2",
      [admin.practice.id, member.id],
    )
  ).rows[0];
  try {
    await pool.query(
      "update private.sms_enrollment_events set disclosure_version='invalid' where id=$1",
      [receipt.consent_event_id],
    );
    expect(
      (
        await staff.client.rpc("get_my_practice_sms_enrollment", {
          p_practice_id: admin.practice.id,
        })
      ).error?.code,
    ).toBe("XX000");
  } finally {
    await pool.query(
      "update private.sms_enrollment_events set disclosure_version='e4-s1-v1' where id=$1",
      [receipt.consent_event_id],
    );
  }
});
