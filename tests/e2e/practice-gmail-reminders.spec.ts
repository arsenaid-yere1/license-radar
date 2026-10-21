import AxeBuilder from "@axe-core/playwright";
import { test, expect, pool } from "../helpers/private-browser";
import { setup } from "../helpers/browser";
import { fixtureWrite } from "../helpers/access-fixtures";
test.use({ trace: "off", screenshot: "off", video: "off" });
test("GM07 stored Gmail capability survives the current Resend selection and exposes no check/resend", async ({
  page,
}) => {
  const name = `Gmail browser fixture ${crypto.randomUUID()}`;
  await setup(page, name);
  const own = (
    await pool.query(
      "select p.id,u.email,u.id user_id,m.id membership_id from public.practices p join auth.users u on u.id=p.owner_user_id join public.practice_memberships m on m.practice_id=p.id and m.user_id=u.id where p.name=$1",
      [name],
    )
  ).rows[0];
  await fixtureWrite(
    own.user_id,
    "select private.update_practice($1,$2,'UTC',1)",
    [own.id, name],
  );
  await fixtureWrite(
    own.user_id,
    "select public.set_practice_reminder_recipient($1,$2,1)",
    [own.id, own.membership_id],
  );
  await fixtureWrite(
    own.user_id,
    "select private.create_practice_credential_with_details($1,$2,'Gmail pilot fixture license','state_license','practice',null,'{}',null,null,'2030-03-02',null)",
    [own.id, crypto.randomUUID()],
  );
  const credential = (
    await pool.query("select id from public.credentials where practice_id=$1", [
      own.id,
    ])
  ).rows[0];
  const instant = "2030-01-01T10:00:00Z",
    namespace = `gmail-browser-${crypto.randomUUID()}`,
    config = {
      namespace,
      from: own.email,
      replyTo: own.email,
      appUrl: "http://127.0.0.1:3000",
    };
  await pool.query(
    "update public.credential_cycles set updated_at=$2 where credential_id=$1",
    [credential.id, instant],
  );
  await pool.query(
    "update private.gmail_reminder_authority set enabled=false where enabled",
  );
  // Synthetic provider acceptance seeds the real ledger; this is UI evidence, not a live-send claim.
  for (let page = 0; page < 20; page++) {
    await pool.query(
      "select private.expire_email_submissions_at('2100-01-01')",
    );
    if (
      !(
        await pool.query(
          "select 1 from private.reminder_message_attempts where provider_kind='resend' and outcome='submitting' limit 1",
        )
      ).rows.length
    )
      break;
  }
  await pool.query(
    "insert into private.gmail_reminder_authority(namespace,sender,subject,allowed_recipient,app_origin,enabled) values($1,$2,'browser-subject',$2,$3,true)",
    [namespace, own.email, config.appUrl],
  );
  let permission;
  try {
    for (let i = 0; i < 100; i++) {
      await pool.query(
        "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
        [own.id],
      );
      await pool.query("select private.reconcile_email_reminders_at($1,$2)", [
        namespace,
        instant,
      ]);
      if (
        !(
          await pool.query(
            "select 1 from private.reminder_reconcile_outbox where practice_id=$1",
            [own.id],
          )
        ).rows.length
      )
        break;
    }
    const job = (
        await pool.query(
          "select id from private.reminder_jobs where credential_id=$1",
          [credential.id],
        )
      ).rows[0],
      token = crypto.randomUUID();
    await pool.query(
      "update private.reminder_jobs set state='claimed',claim_token=$2,claim_until=$3::timestamptz+interval '30 seconds' where id=$1",
      [job.id, token, instant],
    );
    permission = (
      await pool.query(
        "select private.begin_gmail_reminder_at($1,$2,$3,'browser-subject',1,$4) value",
        [job.id, token, config, instant],
      )
    ).rows[0].value;
    expect(permission.status).toBe("submit");
    expect(
      (
        await pool.query(
          "select private.record_gmail_reminder_at($1,$2,'accepted','fixture-gmail-browser-id',null,$3) value",
          [permission.attemptId, permission.token, instant],
        )
      ).rows[0].value,
    ).toEqual({ status: "recorded" });
  } finally {
    await pool.query(
      "update private.gmail_reminder_authority set enabled=false where namespace=$1",
      [namespace],
    );
  }
  await page.goto(`/practice/reminders/${credential.id}`);
  await expect(
    page.getByText("Accepted by Gmail; delivery is not confirmed", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Automatic resend and delivery checks are unavailable.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("1 of 1", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /check delivery|send again|resend/i }),
  ).toHaveCount(0);
  await expect(page.getByText(/predates recovery tracking/)).toHaveCount(0);
  const body = await page.locator("body").innerText();
  expect(body).not.toContain(own.email);
  expect(body).not.toContain("fixture-gmail-browser-id");
  await page.getByRole("link", { name: "View attempt events" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Attempt events" }),
  ).toBeVisible();
  await expect(page.getByText(/Gmail accepted the reminder/)).toBeVisible();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/gmail-history-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/practice/reminders");
  await expect(
    page.getByText("Accepted by Gmail; delivery is not confirmed", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  expect(
    (
      await pool.query(
        "select post_count,provider_kind,provider_id,check_count from private.reminder_message_attempts where id=$1",
        [permission.attemptId],
      )
    ).rows,
  ).toEqual([
    {
      post_count: 1,
      provider_kind: "gmail",
      provider_id: null,
      check_count: 0,
    },
  ]);
});
