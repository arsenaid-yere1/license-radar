import { test, expect, pool } from "../helpers/private-browser";
import { setup, signIn } from "../helpers/browser";
import { account } from "../helpers/local-fixtures";
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({
  trace: "off",
  screenshot: "off",
  video: "off",
  timezoneId: "Pacific/Kiritimati",
});
async function open(page: Page) {
  await setup(page);
  await page.getByRole("link", { name: "Renewal register" }).click();
  return (
    await pool.query(
      "select * from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0];
}
async function snapshot(practice: string) {
  const result: Record<string, unknown> = {};
  for (const table of [
    "public.clinicians",
    "public.credentials",
    "public.credential_cycles",
    "public.policy_coverage",
    "private.register_audit_events",
    "private.register_create_requests",
  ])
    result[table] = (
      await pool.query(
        `select * from ${table} where practice_id=$1 order by ${table.endsWith("coverage") ? "credential_id,clinician_id" : "id"}`,
        [practice],
      )
    ).rows;
  return result;
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Add record" }).click();
  await expect(page.getByText("Record saved.", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Record title")).toHaveValue("");
}
async function dates(
  page: Page,
  title: string,
  type: string,
  end: string,
  action: string,
) {
  await page.getByLabel("Record type").selectOption(type);
  await page.getByLabel("Record title").fill(title);
  await page
    .getByLabel(
      type === "malpractice_policy" ? "Coverage end date" : "Expiration date",
    )
    .fill(end);
  await page.getByLabel("Earlier action deadline").fill(action);
}
test("D16 all type-specific dates persist across reload sign-in timezone changes and mobile keyboard", async ({
  page,
  browser,
}) => {
  const member = await open(page);
  await dates(page, "State end", "state_license", "2028-02-29", "");
  await page.getByLabel("Licensing board (optional)").fill(" Board ");
  await page.getByLabel("State or territory (optional)").fill(" CA ");
  await save(page);
  await dates(page, "DEA action", "dea_registration", "", "2026-12-31");
  await page.getByLabel("Issuing authority (optional)").fill("Authority");
  await page.getByLabel("Registration jurisdiction (optional)").fill("US");
  await save(page);
  await dates(
    page,
    "Policy both",
    "malpractice_policy",
    "2028-02-29",
    "2028-02-01",
  );
  await page.getByLabel("Insurer (optional)").fill("Insurer");
  await page.getByLabel("Coverage jurisdiction (optional)").fill("CA");
  await save(page);
  await dates(page, "Unknown", "state_license", "", "");
  await save(page);
  await dates(page, "Early year", "state_license", "0001-01-01", "");
  await save(page);
  await dates(page, "Last year", "dea_registration", "9999-12-31", "");
  await save(page);
  await page.reload();
  const list = page.getByRole("list", { name: "Saved records" });
  await expect(list.locator("article")).toHaveCount(6);
  await expect(list).toContainText("Licensing board: Board");
  await expect(list).toContainText("Tracking date: Feb 29, 2028 (expiration)");
  await expect(list).toContainText(
    "Tracking date: Dec 31, 2026 (earlier action deadline)",
  );
  await expect(list).toContainText(
    "Tracking date: Feb 1, 2028 (earlier action deadline)",
  );
  await expect(list).toContainText("Expiration date unknown");
  await expect(list).toContainText("Dates not entered");
  await expect(list).toContainText("Jan 1, 1");
  await expect(list).toContainText("Dec 31, 9999");
  await expect(list.locator('time[datetime="2028-02-29"]')).toHaveCount(3);
  expect(
    (await snapshot(member.practice_id))["public.credential_cycles"],
  ).toHaveLength(6);
  await page.screenshot({
    path: "reports/credential-dates-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Licensing board (optional)").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("State or territory (optional)")).toBeFocused();
  await page.screenshot({
    path: "reports/credential-dates-mobile.png",
    fullPage: true,
  });
  const email = (
    await pool.query("select email from auth.users where id=$1", [
      member.user_id,
    ])
  ).rows[0].email;
  await page.getByRole("button", { name: "Sign out" }).click();
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds',recovery_sent_at=now()-interval '61 seconds' where email=$1",
    [email],
  );
  await signIn(page, email);
  await page.getByRole("link", { name: "Renewal register" }).click();
  await expect(
    page.getByRole("list", { name: "Saved records" }).locator("article"),
  ).toHaveCount(6);
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    timezoneId: "America/Los_Angeles",
  });
  try {
    const other = await context.newPage();
    await pool.query(
      "update auth.users set confirmation_sent_at=now()-interval '61 seconds',recovery_sent_at=now()-interval '61 seconds' where email=$1",
      [email],
    );
    await signIn(other, email);
    await other.getByRole("link", { name: "Renewal register" }).click();
    await expect(other.getByRole("list", { name: "Saved records" })).toHaveText(
      (await page.getByRole("list", { name: "Saved records" }).textContent()) ??
        "",
    );
  } finally {
    await context.close();
  }
});
test("D17 date validation retains draft, type reset, owner preservation, cycle failure retry and missing cycle outage", async ({
  page,
}) => {
  const member = await open(page);
  await dates(page, "Draft", "state_license", "2028-02-29", "2028-02-29");
  await page.getByLabel("Licensing board (optional)").fill("Board");
  const before = await snapshot(member.practice_id);
  for (const action of ["2028-02-29", "2028-03-01"]) {
    await page.getByLabel("Earlier action deadline").fill(action);
    await page.getByRole("button", { name: "Add record" }).click();
    await expect(page.locator("p[role=alert]")).toBeFocused();
    await expect(
      page.getByText("The action deadline must be earlier than the end date.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Earlier action deadline")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByLabel("Expiration date")).toHaveValue("2028-02-29");
    expect(await snapshot(member.practice_id)).toEqual(before);
  }
  await page.getByLabel("Record owner").selectOption("clinician");
  await expect(page.getByLabel("Expiration date")).toHaveValue("2028-02-29");
  await expect(page.getByLabel("Licensing board (optional)")).toHaveValue(
    "Board",
  );
  await page.getByLabel("Record owner").selectOption("practice");
  await page.getByLabel("Record type").selectOption("malpractice_policy");
  for (const label of [
    "Insurer (optional)",
    "Coverage jurisdiction (optional)",
    "Coverage end date",
    "Earlier action deadline",
  ])
    await expect(page.getByLabel(label)).toHaveValue("");
  await dates(
    page,
    "Retry cycle",
    "malpractice_policy",
    "2028-02-29",
    "2028-02-01",
  );
  await page.getByLabel("Insurer (optional)").fill("Insurer");
  await pool.query(
    "create function private.date_ui_fault() returns trigger language plpgsql as $$begin raise exception 'fixture outage';end$$;create trigger date_ui_fault before update on public.credential_cycles for each row execute function private.date_ui_fault()",
  );
  try {
    await page.getByRole("button", { name: "Add record" }).click();
    await expect(
      page.getByRole("button", { name: "Retry this save" }),
    ).toBeVisible();
    expect(await snapshot(member.practice_id)).toEqual(before);
    await expect(page.getByLabel("Coverage end date")).toBeDisabled();
    await expect(page.getByLabel("Insurer (optional)")).toHaveValue("Insurer");
  } finally {
    await pool.query(
      "drop trigger date_ui_fault on public.credential_cycles;drop function private.date_ui_fault()",
    );
  }
  await page.getByRole("button", { name: "Retry this save" }).click();
  await expect(page.getByText("Record saved.", { exact: true })).toBeFocused();
  await expect(page.getByRole("list", { name: "Saved records" })).toContainText(
    "Tracking date: Feb 1, 2028 (earlier action deadline)",
  );
  const cycle = (
    await pool.query(
      "select * from public.credential_cycles where practice_id=$1",
      [member.practice_id],
    )
  ).rows[0];
  await pool.query("delete from public.credential_cycles where id=$1", [
    cycle.id,
  ]);
  try {
    await page.reload();
    await expect(page.locator("p[role=alert]")).toHaveText(
      "We could not complete this request. Try again.",
    );
    await expect(
      page.getByText("Dates not entered", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("No renewal records added yet.", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await pool.query(
      "insert into public.credential_cycles select * from jsonb_populate_record(null::public.credential_cycles,$1::jsonb)",
      [JSON.stringify(cycle)],
    );
  }
  await page.reload();
  await expect(page.getByRole("list", { name: "Saved records" })).toContainText(
    "Feb 29, 2028",
  );
});
test("D18 viewer reads confirmed dates and stale manager detailed creates deny after demotion and revocation", async ({
  page,
  browser,
}) => {
  const member = await open(page);
  await dates(page, "Confirmed", "state_license", "2028-02-29", "");
  await save(page);
  const person = await account(),
    digest = randomBytes(32).toString("hex"),
    db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      member.user_id,
    ]);
    await db.query(
      "select private.create_practice_invitation($1,$2,'manager',$3)",
      [member.practice_id, person.email, digest],
    );
    await db.query("commit");
  } finally {
    await db.query("rollback");
    db.release();
  }
  expect(
    (
      await person.client.rpc("accept_practice_invitation", {
        p_token_digest: digest,
      })
    ).data.status,
  ).toBe("success");
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
  });
  try {
    const staff = await context.newPage();
    await pool.query(
      "update auth.users set confirmation_sent_at=now()-interval '61 seconds',recovery_sent_at=now()-interval '61 seconds' where email=$1",
      [person.email],
    );
    await signIn(staff, person.email);
    await staff.getByRole("link", { name: "Renewal register" }).click();
    for (const revoked of [false, true]) {
      await dates(staff, "Stale draft", "state_license", "2028-02-29", "");
      const before = await snapshot(member.practice_id);
      await pool.query(
        "update public.practice_memberships set role=$2,state=$3,revoked_at=case when $3='revoked' then clock_timestamp() else null end,version=version+1 where user_id=$1",
        [
          person.user.id,
          revoked ? "manager" : "viewer",
          revoked ? "revoked" : "active",
        ],
      );
      await staff.getByRole("button", { name: "Add record" }).click();
      await expect(staff.locator("p[role=alert]")).toHaveText(
        "You do not have permission to add register records.",
      );
      await expect(staff.getByLabel("Expiration date")).toHaveValue(
        "2028-02-29",
      );
      expect(await snapshot(member.practice_id)).toEqual(before);
      if (!revoked) {
        await staff.reload();
        await expect(staff.getByText(/read-only/)).toBeVisible();
        await expect(
          staff.getByRole("button", { name: "Add record" }),
        ).toHaveCount(0);
        await expect(
          staff.getByRole("list", { name: "Saved records" }),
        ).toContainText("Tracking date: Feb 29, 2028 (expiration)");
        await pool.query(
          "update public.practice_memberships set role='manager',version=version+1 where user_id=$1",
          [person.user.id],
        );
        await staff.reload();
      } else {
        await staff.reload();
        await expect(staff).toHaveURL(/onboarding\/practice/);
      }
    }
  } finally {
    await context.close();
  }
});

test("D19 real detailed POST rejects foreign Origin without writes while pending dates are frozen", async ({
  page,
  context,
}) => {
  const member = await open(page);
  await dates(
    page,
    "Pending dates",
    "state_license",
    "2028-02-29",
    "2028-02-01",
  );
  const before = await snapshot(member.practice_id),
    db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select id from public.practices where id=$1 for update", [
      member.practice_id,
    ]);
    const [request] = await Promise.all([
      page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith("/practice/register"),
      ),
      page.getByRole("button", { name: "Add record" }).click(),
    ]);
    await expect(page.getByLabel("Expiration date")).toBeDisabled();
    const attack = await context.request.post(request.url(), {
      headers: { ...request.headers(), origin: "https://attacker.invalid" },
      data: request.postDataBuffer()!,
    });
    expect(attack.status()).toBe(500);
    expect(await snapshot(member.practice_id)).toEqual(before);
    await db.query("commit");
    await expect(
      page.getByText("Record saved.", { exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("list", { name: "Saved records" }),
    ).toContainText("Tracking date: Feb 1, 2028 (earlier action deadline)");
  } finally {
    await db.query("rollback");
    db.release();
  }
});
