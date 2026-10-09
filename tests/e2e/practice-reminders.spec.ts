import AxeBuilder from "@axe-core/playwright";
import { test, expect, pool } from "../helpers/private-browser";
import { setup } from "../helpers/browser";
import { fixtureWrite } from "../helpers/access-fixtures";
import { emailFixture, signedEmailEvent } from "../helpers/email-fixtures";
test.use({ trace: "off", screenshot: "off", video: "off" });
async function normalFixture(page: import("@playwright/test").Page) {
  const name = `Reminder fixture ${crypto.randomUUID()}`;
  await setup(page, name);
  const own = (
    await pool.query(
      "select p.id,u.email,u.id user_id,m.id membership_id from public.practices p join auth.users u on u.id=p.owner_user_id join public.practice_memberships m on m.practice_id=p.id and m.user_id=u.id where p.name=$1",
      [name],
    )
  ).rows[0];
  // Choose a real IANA zone in the normal send window, independent of test wall clock.
  const zone = Intl.supportedValuesOf("timeZone").find(
    (zone) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date()) === "10",
  )!;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const due = new Date(
    `${part("year")}-${part("month")}-${part("day")}T00:00:00Z`,
  );
  due.setUTCDate(due.getUTCDate() + 60);
  await fixtureWrite(
    own.user_id,
    "select private.update_practice($1,$2,$3,1)",
    [own.id, name, zone],
  );
  await fixtureWrite(
    own.user_id,
    "select public.set_practice_reminder_recipient($1,$2,1)",
    [own.id, own.membership_id],
  );
  await fixtureWrite(
    own.user_id,
    "select private.create_practice_credential_with_details($1,$2,'Private record title','state_license','practice',null,'{}',null,null,$3,null)",
    [own.id, crypto.randomUUID(), due.toISOString().slice(0, 10)],
  );
  // Simulate an ordinary record eligible before its target; no live/public clock override exists.
  await pool.query(
    "update public.credential_cycles set updated_at='2000-01-01' where practice_id=$1;",
    [own.id],
  );
  await pool.query(
    "update private.practice_reminder_settings set updated_at='2000-01-01' where practice_id=$1",
    [own.id],
  );
  await pool.query(
    "update private.reminder_email_account_state set eligible_since='2000-01-01' where user_id=$1",
    [own.user_id],
  );
  await pool.query(
    "update private.reminder_email_preferences set eligible_since='2000-01-01' where practice_id=$1",
    [own.id],
  );
  await pool.query(
    "update private.practice_audit_events set occurred_at='2000-01-01' where practice_id=$1",
    [own.id],
  );
  for (let i = 0; i < 100; i++) {
    await pool.query("select private.drain_email_account_changes()");
    if (
      !(
        await pool.query(
          "select dirty from private.reminder_email_account_state where user_id=$1",
          [own.user_id],
        )
      ).rows[0].dirty
    )
      break;
  }
  // Keep the tested practice first without clearing any other durable work.
  await pool.query(
    "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
    [own.id],
  );
  return own;
}
async function run(page: import("@playwright/test").Page) {
  return page.request.post("/api/reminders/run", {
    headers: {
      Authorization: "Bearer local-worker-fixture-only-e4-s2-authorization",
    },
    data: {},
  });
}
test("Email alone submits once, signed delivery updates status, and personal withdrawal survives reload", async ({
  page,
  context,
}) => {
  const own = await normalFixture(page);
  expect(
    (await page.request.post("/api/reminders/run", { data: {} })).status(),
  ).toBe(401);
  expect((await run(page)).status()).toBe(200);
  const messages = await emailFixture("state", { to: own.email });
  expect(messages).toHaveLength(1);
  expect(messages[0].to).toEqual([own.email]);
  expect(messages[0].text).not.toContain("Private record title");
  expect(messages[0].html).not.toContain("Private record title");
  expect(messages[0].key).toBe(`reminder-email/${messages[0].tags[0].value}`);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.practice_sms_enrollments where practice_id=$1",
        [own.id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect((await run(page)).status()).toBe(200);
  expect(await emailFixture("state", { to: own.email })).toHaveLength(1);
  const event = signedEmailEvent({
    type: "email.delivered",
    data: {
      email_id: messages[0].id,
      from: messages[0].from,
      to: messages[0].to,
      tags: { reminder_attempt: messages[0].tags[0].value },
    },
  });
  expect(
    (
      await page.request.post("/api/reminders/email/webhook", {
        ...event,
        data: event.body,
      })
    ).status(),
  ).toBe(200);
  await page.goto("/practice/reminders");
  await expect(page.getByText("delivered", { exact: true })).toBeVisible();
  await expect(page.getByText(/Recipient email ready/)).toBeVisible();
  const pending = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/practice/reminders"),
  );
  await page
    .getByRole("button", { name: "Disable my reminder emails" })
    .click();
  const sent = await pending;
  await expect(
    page.getByText("Email reminder preference saved."),
  ).toBeFocused();
  const before = (
    await pool.query(
      "select * from private.reminder_email_preferences where practice_id=$1",
      [own.id],
    )
  ).rows;
  expect(
    (
      await context.request.post(sent.url(), {
        headers: { ...sent.headers(), origin: "https://attacker.invalid" },
        data: sent.postDataBuffer()!,
      })
    ).status(),
  ).toBe(500);
  expect(
    (
      await pool.query(
        "select * from private.reminder_email_preferences where practice_id=$1",
        [own.id],
      )
    ).rows,
  ).toEqual(before);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable my reminder emails" }),
  ).toBeVisible();
  expect(
    (await page.request.get("/practice/reminders")).headers()["cache-control"],
  ).toContain("no-store");
});
test("Lost provider response remains uncertain without replay; a signed complaint suppresses the endpoint", async ({
  page,
}) => {
  const own = await normalFixture(page);
  await emailFixture("mode", { to: own.email, mode: "lost" });
  expect((await run(page)).status()).toBe(200);
  expect((await run(page)).status()).toBe(200);
  const messages = await emailFixture("state", { to: own.email });
  expect(messages).toHaveLength(1);
  await page.goto("/practice/reminders");
  await expect(page.getByText("uncertain", { exact: true })).toBeVisible();
  const event = signedEmailEvent({
    type: "email.complained",
    data: {
      email_id: messages[0].id,
      from: messages[0].from,
      to: messages[0].to,
      tags: { reminder_attempt: messages[0].tags[0].value },
    },
  });
  expect(
    (
      await page.request.post("/api/reminders/email/webhook", {
        headers: event.headers,
        data: event.body,
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(
    page.getByText(/Email blocked after a delivery problem/).first(),
  ).toBeVisible();
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
      path: `reports/email-reminders-${width}.png`,
      fullPage: true,
    });
  }
});
test("CU16 late setup sends one catch-up email without SMS and remains consumed after preference reenabling", async ({
  page,
}) => {
  const own = await normalFixture(page);
  // Restore real persisted late eligibility; ordinary fixture setup is only shared account/zone scaffolding.
  await pool.query(
    "update public.credential_cycles set end_date=(clock_timestamp() at time zone (select timezone from public.practices where id=$1))::date,updated_at=clock_timestamp() where practice_id=$1",
    [own.id],
  );
  await pool.query(
    "select private.dirty_email_reminders($1,'late-browser-fixture')",
    [own.id],
  );
  await pool.query(
    "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
    [own.id],
  );
  expect((await run(page)).status()).toBe(200);
  const messages = await emailFixture("state", { to: own.email });
  expect(messages).toHaveLength(1);
  expect(messages[0].subject).toBe("Credential renewal catch-up reminder");
  expect(messages[0].text).toContain("This renewal is due today.");
  await page.goto("/practice/reminders");
  await expect(
    page.getByText("Catch-up reminder", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Catch-up target", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Original 60-day target", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Date changes do not send another email automatically/),
  ).toBeVisible();
  await expect(
    page.getByText("Next sending window", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Disable my reminder emails" })
    .click();
  await expect(
    page.getByRole("button", { name: "Enable my reminder emails" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Enable my reminder emails" }).click();
  await expect(
    page.getByRole("button", { name: "Disable my reminder emails" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Refresh status" }).click();
  expect((await run(page)).status()).toBe(200);
  expect(await emailFixture("state", { to: own.email })).toHaveLength(1);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.practice_sms_enrollments where practice_id=$1",
        [own.id],
      )
    ).rows[0].n,
  ).toBe(0);
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
      path: `reports/catch-up-reminders-${width}.png`,
      fullPage: true,
    });
  }
});
test("CU11 catch-up lost provider response stays uncertain across repeated workers and refresh", async ({
  page,
}) => {
  const own = await normalFixture(page);
  await pool.query(
    "update public.credential_cycles set end_date=(clock_timestamp() at time zone (select timezone from public.practices where id=$1))::date,updated_at=clock_timestamp() where practice_id=$1",
    [own.id],
  );
  await pool.query(
    "select private.dirty_email_reminders($1,'late-browser-uncertain')",
    [own.id],
  );
  await pool.query(
    "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
    [own.id],
  );
  await emailFixture("mode", { to: own.email, mode: "lost" });
  expect((await run(page)).status()).toBe(200);
  expect((await run(page)).status()).toBe(200);
  const messages = await emailFixture("state", { to: own.email });
  expect(messages).toHaveLength(1);
  expect(messages[0].subject).toBe("Credential renewal catch-up reminder");
  await page.goto("/practice/reminders");
  await expect(page.getByText("uncertain", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Next sending window", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Refresh status" }).click();
  expect((await run(page)).status()).toBe(200);
  expect(await emailFixture("state", { to: own.email })).toHaveLength(1);
});
