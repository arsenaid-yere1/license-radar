import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, pool } from "../helpers/private-browser";
import { setup } from "../helpers/browser";
import { fixtureWrite } from "../helpers/access-fixtures";
import { account } from "../helpers/local-fixtures";
import { emailFixture } from "../helpers/email-fixtures";
test.use({ trace: "off", screenshot: "off", video: "off" });

type Fixture = {
  id: string;
  email: string;
  user_id: string;
  membership_id: string;
  credentialId: string;
  dueDate: string;
};
async function recoveryFixture(page: Page): Promise<Fixture> {
  const name = `Recovery fixture ${crypto.randomUUID()}`;
  await setup(page, name);
  const own = (
    await pool.query(
      "select p.id,u.email,u.id user_id,m.id membership_id from public.practices p join auth.users u on u.id=p.owner_user_id join public.practice_memberships m on m.practice_id=p.id and m.user_id=u.id where p.name=$1",
      [name],
    )
  ).rows[0];
  const zone = Intl.supportedValuesOf("timeZone").find(
    (zone) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(new Date()) === "10",
  );
  expect(zone).toBeTruthy();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)!.value;
  const due = new Date(
    `${part("year")}-${part("month")}-${part("day")}T00:00:00Z`,
  );
  due.setUTCDate(due.getUTCDate() + 60);
  const dueDate = due.toISOString().slice(0, 10);
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
    "select private.create_practice_credential_with_details($1,$2,'Recovery license','state_license','practice',null,'{}',null,null,$3,null)",
    [own.id, crypto.randomUUID(), dueDate],
  );
  // Real wall-clock eligibility, with only guarded fixture persisted setup predating the target.
  await pool.query(
    "update public.credential_cycles set updated_at='2000-01-01' where practice_id=$1",
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
  await pool.query(
    "update private.reminder_reconcile_outbox set updated_at='2000-01-01' where practice_id=$1",
    [own.id],
  );
  const credentialId = (
    await pool.query("select id from public.credentials where practice_id=$1", [
      own.id,
    ])
  ).rows[0].id;
  return { ...own, credentialId, dueDate };
}
function run(page: Page) {
  return page.request.post("/api/reminders/run", {
    headers: {
      Authorization: "Bearer local-worker-fixture-only-e4-s2-authorization",
    },
    data: {},
  });
}
async function history(page: Page, own: Fixture) {
  await page.goto(`/practice/reminders/${own.credentialId}`);
  await expect(
    page.getByRole("heading", { name: "Recovery license", exact: true }),
  ).toBeVisible();
}
async function accessibleHistory(page: Page, name: string) {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.map(
        (violation) => violation.id,
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/${name}-${width}.png`,
      fullPage: true,
    });
  }
}

test("DR03 rejected rate submission retries the same payload once; a known-ID check records delivery without another POST", async ({
  page,
  context,
}) => {
  const own = await recoveryFixture(page);
  await emailFixture("mode", {
    to: own.email,
    mode: ["rate-limited", "accepted"],
  });
  expect((await run(page)).status()).toBe(200);
  let calls = await emailFixture("calls", { to: own.email });
  expect(calls.postCount).toBe(1);
  expect(calls.getCount).toBe(0);
  expect(await emailFixture("resources", { to: own.email })).toHaveLength(0);
  const attempt = (
    await pool.query(
      "select id,recovery_state,post_count,retry_due,started_at from private.reminder_message_attempts where practice_id=$1",
      [own.id],
    )
  ).rows[0];
  expect(attempt.recovery_state).toBe("retry-pending");
  expect(attempt.post_count).toBe(1);
  expect(
    attempt.retry_due.getTime() - attempt.started_at.getTime(),
  ).toBeGreaterThanOrEqual(60000);
  await history(page, own);
  await expect(page.getByText("retry-pending", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check delivery status" }),
  ).toHaveCount(0);
  // Test-only persisted due adjustment avoids a real minute wait; the worker still uses real time.
  await pool.query(
    "update private.reminder_message_attempts set retry_due=clock_timestamp()-interval '1 second' where id=$1",
    [attempt.id],
  );
  expect((await run(page)).status()).toBe(200);
  calls = await emailFixture("calls", { to: own.email });
  expect(calls.postCount).toBe(2);
  expect(calls.getCount).toBe(0);
  expect(calls.calls[0].payload).toEqual(calls.calls[1].payload);
  expect(calls.calls[0].key).toBe(calls.calls[1].key);
  expect(await emailFixture("resources", { to: own.email })).toHaveLength(1);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.reminder_message_attempts where practice_id=$1",
        [own.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.reminder_email_submissions where attempt_id=$1",
        [attempt.id],
      )
    ).rows[0].n,
  ).toBe(2);
  await emailFixture("mode", {
    to: own.email,
    mode: "accepted",
    lastEvent: "delivered",
  });
  await history(page, own);
  const button = page.getByRole("button", { name: "Check delivery status" });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Delivery check queued/)).toBeFocused();
  await expect
    .poll(
      async () => (await button.count()) === 0 || (await button.isDisabled()),
    )
    .toBe(true);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.reminder_email_check_requests where attempt_id=$1",
        [attempt.id],
      )
    ).rows[0].n,
  ).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Check delivery status" }),
  ).toHaveCount(0);
  expect((await run(page)).status()).toBe(200);
  calls = await emailFixture("calls", { to: own.email });
  expect(calls.postCount).toBe(2);
  expect(calls.getCount).toBe(1);
  await page.reload();
  await expect(
    page
      .getByText("Submission outcome", { exact: true })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("accepted");
  await expect(
    page
      .getByText("Delivery evidence", { exact: true })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("delivered");
  await page.getByRole("link", { name: "View attempt events" }).click();
  await expect(
    page.getByRole("heading", { name: "Attempt events" }),
  ).toBeVisible();
  await expect(page.getByText(/application recorded evidence/)).toBeVisible();
  expect(
    (
      await page.request.get(`/practice/reminders/${own.credentialId}`)
    ).headers()["cache-control"],
  ).toContain("no-store");
  const privateText = await page.locator("body").innerText();
  expect(privateText).not.toContain(own.email);
  expect(privateText).not.toContain(
    (await emailFixture("resources", { to: own.email }))[0].id,
  );
  await accessibleHistory(page, "recovery-known-delivery");
  const current = new Date(`${own.dueDate}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() + 1);
  const currentDue = current.toISOString().slice(0, 10);
  await page.goto("/practice/register");
  const record = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Recovery license", exact: true }),
  });
  await record.getByRole("button", { name: "Edit record" }).click();
  await page
    .getByRole("region", { name: "Edit Recovery license" })
    .getByLabel("Expiration date")
    .fill(currentDue);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  await record.getByRole("button", { name: "Archive record" }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(
    page.getByText("Record archived.", { exact: true }),
  ).toBeVisible();
  const staff = await account();
  const membership = (
    await pool.query(
      "insert into public.practice_memberships(practice_id,user_id,role,state) values($1,$2,'administrator','active') returning id",
      [own.id, staff.user.id],
    )
  ).rows[0];
  const version = (
    await pool.query(
      "select version from private.practice_reminder_settings where practice_id=$1",
      [own.id],
    )
  ).rows[0].version;
  await fixtureWrite(
    own.user_id,
    "select public.set_practice_reminder_recipient($1,$2,$3)",
    [own.id, membership.id, version],
  );
  await pool.query(
    "update public.practice_memberships set role='viewer',version=version+1 where id=$1",
    [own.membership_id],
  );
  await history(page, own);
  await expect(page.getByText(/Archived record/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Former recipient" }),
  ).toBeVisible();
  await expect(
    page.getByText(new RegExp(`Current due date: ${currentDue}`)),
  ).toBeVisible();
  await expect(
    page.locator("dd").filter({ hasText: own.dueDate }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open record" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Check delivery status" }),
  ).toHaveCount(0);
  await accessibleHistory(page, "recovery-archived-viewer");
  const foreign = await context.newPage();
  try {
    await foreign.goto(`/practice/reminders/${crypto.randomUUID()}`);
    await expect(
      foreign.getByRole("heading", { name: "Reminder history unavailable" }),
    ).toBeVisible();
  } finally {
    await foreign.close();
  }
});

test("DR08 lost-before-acceptance stays visibly uncertain and consumed across refresh and repeated workers", async ({
  page,
}) => {
  const own = await recoveryFixture(page);
  await emailFixture("mode", { to: own.email, mode: "lost-before-acceptance" });
  expect((await run(page)).status()).toBe(200);
  expect((await run(page)).status()).toBe(200);
  const calls = await emailFixture("calls", { to: own.email });
  expect(calls.postCount).toBe(1);
  expect(calls.getCount).toBe(0);
  expect(await emailFixture("resources", { to: own.email })).toHaveLength(0);
  await history(page, own);
  await expect(page.getByText("uncertain", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Acceptance could not be confirmed/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check delivery status" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /send again|resend/i }),
  ).toHaveCount(0);
  await page.reload();
  expect((await run(page)).status()).toBe(200);
  expect((await emailFixture("calls", { to: own.email })).postCount).toBe(1);
  expect(
    (
      await pool.query(
        "select post_count,check_count,recovery_state from private.reminder_message_attempts where practice_id=$1",
        [own.id],
      )
    ).rows,
  ).toEqual([{ post_count: 1, check_count: 0, recovery_state: "uncertain" }]);
  await accessibleHistory(page, "recovery-unknown-message");
});

test("DR13 a live role demotion denies a stale known-ID delivery check without reserving GET work", async ({
  page,
}) => {
  const own = await recoveryFixture(page);
  expect((await run(page)).status()).toBe(200);
  await history(page, own);
  const button = page.getByRole("button", { name: "Check delivery status" });
  await expect(button).toBeEnabled();
  const staff = await account();
  await pool.query(
    "insert into public.practice_memberships(practice_id,user_id,role,state) values($1,$2,'administrator','active')",
    [own.id, staff.user.id],
  );
  await pool.query(
    "update public.practice_memberships set role='viewer',version=version+1 where id=$1",
    [own.membership_id],
  );
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(
      "Only a current practice manager or administrator can request a delivery check.",
      { exact: true },
    ),
  ).toBeFocused();
  await expect(button).toBeDisabled();
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.reminder_email_check_requests where practice_id=$1",
        [own.id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await pool.query(
        "select check_count from private.reminder_message_attempts where practice_id=$1",
        [own.id],
      )
    ).rows[0].check_count,
  ).toBe(0);
  const calls = await emailFixture("calls", { to: own.email });
  expect(calls.postCount).toBe(1);
  expect(calls.getCount).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Check delivery status" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Selected recipient" }),
  ).toBeVisible();
});
