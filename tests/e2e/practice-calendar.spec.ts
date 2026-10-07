import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, pool } from "../helpers/private-browser";
import { setup } from "../helpers/browser";
import { practice } from "../helpers/access-fixtures";
test.use({ trace: "off", screenshot: "off", video: "off" });
async function fixture(page: Page) {
  await setup(page);
  return (
    await pool.query(
      "select * from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0];
}
async function asMember(
  member: { user_id: string },
  sql: string,
  values: unknown[],
) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      member.user_id,
    ]);
    const r = await db.query(sql, values);
    await db.query("commit");
    return r.rows[0].result;
  } finally {
    await db.query("rollback");
    db.release();
  }
}
async function add(
  member: { practice_id: string; user_id: string },
  title: string,
  type = "malpractice_policy",
  end: string | null = "2028-02-29",
  action: string | null = "2028-02-01",
  owner: string | null = null,
  covered: string[] = [],
) {
  const result = await asMember(
    member,
    "select public.create_practice_credential_with_details($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result",
    [
      member.practice_id,
      randomUUID(),
      title,
      type,
      owner ? "clinician" : "practice",
      owner,
      covered,
      "Board & Insurer",
      "CA & É",
      end,
      action,
    ],
  );
  expect(result.status).toBe("success");
  return result.credential;
}
async function snapshot(id: string) {
  const result: Record<string, unknown[]> = {};
  for (const table of [
    "public.credentials",
    "public.credential_cycles",
    "public.policy_coverage",
    "private.register_audit_events",
    "private.register_create_requests",
    "private.register_change_requests",
  ])
    result[table] = (
      await pool.query(
        `select * from ${table} where practice_id=$1 order by ${table.endsWith("coverage") ? "credential_id,clinician_id" : "id"}`,
        [id],
      )
    ).rows;
  return result;
}
const visibleEvents = (page: Page) => page.locator(".calendar-event:visible");
async function safeLayout(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("C01 C02 C03 C06 C10 C11 C13 real month/agenda filters and detail preserve dates and rows across responsive views", async ({
  page,
  context,
  browser,
}) => {
  const m = await fixture(page),
    person = await asMember(
      m,
      "select public.create_practice_clinician($1,$2,$3) result",
      [m.practice_id, randomUUID(), "Rivera & 陈"],
    ),
    id = person.clinician.id;
  await add(m, "State license", "state_license", undefined, undefined, id);
  await add(m, "DEA registration", "dea_registration");
  const shared = await add(
    m,
    "Shared policy",
    "malpractice_policy",
    undefined,
    undefined,
    null,
    [id],
  );
  await add(m, "Unknown dates", "malpractice_policy", null, null);
  await add(m, "Action only", "malpractice_policy", null, "2028-02-02");
  const long =
    "Unicode 陈 & <img src=x onerror=alert(1)> " + "Long title ".repeat(7);
  for (let n = 0; n < 8; n++)
    await add(
      m,
      n === 0 ? long : `Dense ${n}`,
      "state_license",
      "2028-02-29",
      null,
    );
  const before = await snapshot(m.practice_id);
  await page.getByRole("link", { name: "Renewal calendar" }).click();
  await page.goto("/practice/calendar?month=2028-02");
  await expect(
    page.getByRole("table", { name: "February 2028 renewal dates" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "February 2028 agenda" }),
  ).toBeHidden();
  await expect(visibleEvents(page)).toHaveCount(15);
  await expect(
    page.getByRole("region", { name: "Dates not entered" }),
  ).toContainText("Unknown dates");
  expect(await page.locator(".calendar-workspace img").count()).toBe(0);
  await safeLayout(page);
  await page.screenshot({
    path: "reports/calendar-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Clinician or practice").selectOption(id);
  await page.getByLabel("Credential type").selectOption("malpractice_policy");
  await page.getByLabel("Jurisdiction").selectOption("value:CA & É");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(visibleEvents(page)).toHaveCount(2);
  const filtered = page.url();
  expect(new URL(filtered).searchParams.get("jurisdiction")).toBe(
    "value:CA & É",
  );
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByText("No matching dates this month.")).toBeVisible();
  await page.goBack();
  await expect(visibleEvents(page)).toHaveCount(2);
  await page.goForward();
  await expect(page.getByLabel("Clinician or practice")).toHaveValue(id);
  await page.getByRole("link", { name: "Previous month" }).click();
  await page.reload();
  await expect(visibleEvents(page)).toHaveCount(2);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().isNavigationRequest() && r.url().includes(shared.id),
    ),
    visibleEvents(page).first().click(),
  ]);
  expect(response.headers()["cache-control"]).toContain("no-store");
  await expect(
    page.getByRole("heading", { name: "Shared policy", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".credential-detail")).toContainText(
    "Covers: Rivera & 陈",
  );
  await expect(page.locator('time[datetime="2028-02-29"]')).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit in register" }),
  ).toHaveAttribute("href", `/practice/register#record-${shared.id}`);
  await safeLayout(page);
  await page.screenshot({
    path: "reports/calendar-detail.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Back to calendar" }).click();
  expect(new URL(page.url()).searchParams.get("clinician")).toBe(id);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByRole("table")).toBeHidden();
  await expect(
    page.getByRole("region", { name: "February 2028 agenda" }),
  ).toBeVisible();
  await expect(visibleEvents(page)).toHaveCount(15);
  await safeLayout(page);
  await page.getByLabel("Clinician or practice").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Credential type")).toBeFocused();
  await page.screenshot({
    path: "reports/calendar-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Month view" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "February 2028 agenda" }),
  ).toBeHidden();
  await expect(visibleEvents(page)).toHaveCount(15);
  await safeLayout(page);
  await page.screenshot({
    path: "reports/calendar-mobile-month.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Agenda view" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("table")).toBeHidden();
  await expect(visibleEvents(page)).toHaveCount(15);
  for (const timezoneId of ["Pacific/Honolulu", "Asia/Tokyo"]) {
    const zoned = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      timezoneId,
      storageState: await context.storageState(),
    });
    try {
      const other = await zoned.newPage();
      await other.goto("/practice/calendar?month=2028-02&view=agenda");
      await expect(visibleEvents(other)).toHaveCount(15);
      await expect(
        other.getByRole("heading", { name: "Feb 29, 2028" }),
      ).toBeVisible();
    } finally {
      await zoned.close();
    }
  }
  expect(await snapshot(m.practice_id)).toEqual(before);
});
test("C07 C09 C10 stale event links recheck corrected/undated/archive state and foreign identifiers disclose nothing", async ({
  page,
  context,
}) => {
  const m = await fixture(page),
    record = await add(m, "Saved policy"),
    foreign = await practice(),
    foreignRecord = (
      await foreign.client.rpc("create_practice_credential", {
        p_practice_id: foreign.practice.id,
        p_request_id: randomUUID(),
        p_title: "Foreign secret",
        p_type: "state_license",
        p_owner_kind: "practice",
        p_owner_clinician_id: null,
        p_covered_clinician_ids: [],
      })
    ).data.credential;
  await page.goto("/practice/calendar?month=2028-02");
  const second = await context.newPage();
  try {
    await second.goto("/practice/register");
    await second.getByRole("button", { name: "Edit record" }).click();
    await second
      .getByRole("region", { name: "Edit Saved policy", exact: true })
      .getByLabel("Coverage end date")
      .fill("2028-03-01");
    await second
      .getByRole("region", { name: "Edit Saved policy", exact: true })
      .getByLabel("Earlier action deadline")
      .fill("");
    await second.getByRole("button", { name: "Save changes" }).click();
    await expect(
      second.getByText("Changes saved.", { exact: true }),
    ).toBeVisible();
    await visibleEvents(page).first().click();
    await expect(page.locator('time[datetime="2028-03-01"]')).toHaveCount(2);
    await page.getByRole("link", { name: "Back to calendar" }).click();
    await expect(visibleEvents(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Next month" }).click();
    await expect(visibleEvents(page)).toHaveCount(1);
    await second.getByRole("button", { name: "Edit record" }).click();
    await second
      .getByRole("region", { name: "Edit Saved policy", exact: true })
      .getByLabel("Coverage end date")
      .fill("");
    await second.getByRole("button", { name: "Save changes" }).click();
    await expect(
      second.getByText("Changes saved.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Refresh records" }).click();
    await expect(visibleEvents(page)).toHaveCount(0);
    const undated = page.getByRole("region", { name: "Dates not entered" });
    await expect(undated).toContainText("Saved policy");
    await second.getByRole("button", { name: "Archive record" }).click();
    await second.getByRole("button", { name: "Confirm archive" }).click();
    await expect(
      second.getByText("Record archived.", { exact: true }),
    ).toBeVisible();
    await undated.getByRole("link", { name: "Saved policy" }).click();
    await expect(
      page.getByRole("heading", { name: "Record unavailable." }),
    ).toBeVisible();
    for (const id of [record.id, foreignRecord.id, randomUUID(), "not-an-id"]) {
      await page.goto(`/practice/register/${id}`);
      await expect(
        page.getByRole("heading", { name: "Record unavailable." }),
      ).toBeVisible();
      await expect(page.getByText("Foreign secret")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Saved policy", exact: true }),
      ).toHaveCount(0);
    }
    const before = await snapshot(m.practice_id);
    await page.goto("/practice/calendar?month=2028-02");
    await expect(visibleEvents(page)).toHaveCount(0);
    await expect(undated.getByRole("link")).toHaveCount(0);
    expect(await snapshot(m.practice_id)).toEqual(before);
  } finally {
    await second.close();
  }
});
test("C04 C05 C08 C10 malformed filters, month boundaries and missing-cycle outage fail visibly then recover", async ({
  page,
}) => {
  const m = await fixture(page),
    record = await add(m, "Confirmed dates");
  await page.goto("/practice/calendar?month=0001-01");
  await expect(
    page.getByRole("heading", { name: "January 1", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous month" })).toHaveCount(
    0,
  );
  await page.goto("/practice/calendar?month=9999-12");
  await expect(page.getByRole("link", { name: "Next month" })).toHaveCount(0);
  await page.getByLabel("Month", { exact: true }).fill("2029-12");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "December 2029", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(
    page.getByRole("heading", { name: "January 2030", exact: true }),
  ).toBeVisible();
  await page.goto(
    "/practice/calendar?month=bad&view=bad&type=bad&type=state_license",
  );
  await expect(page.locator("p[role=alert]")).toContainText(
    "Choose valid filters",
  );
  await expect(visibleEvents(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Next month" })).toHaveCount(0);
  await expect(page.getByText(/Month selection was invalid/)).toBeVisible();
  await expect(page.getByText(/View selection was invalid/)).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.locator("p[role=alert]")).toHaveCount(0);
  await page.getByRole("link", { name: "This month" }).click();
  const today = await page
    .locator('[aria-current="date"]')
    .getAttribute("datetime");
  expect(new URL(page.url()).searchParams.get("month")).toBe(
    today!.slice(0, 7),
  );
  const cycle = (
    await pool.query("select * from public.credential_cycles where id=$1", [
      record.current_cycle.id,
    ])
  ).rows[0];
  await pool.query("delete from public.credential_cycles where id=$1", [
    cycle.id,
  ]);
  try {
    for (const path of [
      "/practice/calendar?month=2028-02",
      `/practice/register/${record.id}`,
    ]) {
      await page.goto(path);
      await expect(page.locator("p[role=alert]")).toHaveText(
        "We could not complete this request. Try again.",
      );
      await expect(
        page.getByRole("heading", { name: "Record unavailable." }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "Dates not entered" }),
      ).toHaveCount(0);
    }
  } finally {
    await pool.query(
      "insert into public.credential_cycles select * from jsonb_populate_record(null::public.credential_cycles,$1::jsonb)",
      [JSON.stringify(cycle)],
    );
  }
  await page.goto("/practice/calendar?month=2028-02");
  await expect(visibleEvents(page)).toHaveCount(2);
});
test("C07 C08 C10 viewer reads fresh pages; revoked and anonymous requests lose detail authority", async ({
  page,
  context,
}) => {
  const m = await fixture(page),
    record = await add(m, "Viewer dates"),
    db = await pool.connect();
  try {
    await db.query("begin");
    const extra = (
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'fixture-extra-'||gen_random_uuid()||'@example.test',now()) returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into public.practice_memberships(practice_id,user_id,role,state) values($1,$2,'administrator','active')",
      [m.practice_id, extra],
    );
    await db.query(
      "update public.practice_memberships set role='viewer',version=version+1 where id=$1",
      [m.id],
    );
    await db.query("commit");
  } finally {
    await db.query("rollback");
    db.release();
  }
  const response = await page.goto("/practice/calendar?month=2028-02");
  expect(response!.headers()["cache-control"]).toContain("no-store");
  await expect(visibleEvents(page)).toHaveCount(2);
  await visibleEvents(page).first().click();
  await expect(
    page.getByRole("link", { name: "View in register" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to calendar" }).click();
  const before = await snapshot(m.practice_id);
  await pool.query(
    "update public.practice_memberships set state='revoked',revoked_at=clock_timestamp(),version=version+1 where id=$1",
    [m.id],
  );
  await visibleEvents(page).first().click();
  await expect(page).toHaveURL(/onboarding\/practice/);
  await page.goto("/practice/calendar");
  await expect(page).toHaveURL(/onboarding\/practice/);
  expect(await snapshot(m.practice_id)).toEqual(before);
  await page.getByRole("button", { name: "Sign out" }).click();
  for (const path of [
    "/practice/calendar",
    `/practice/register/${record.id}`,
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: "Viewer dates", exact: true }),
    ).toHaveCount(0);
  }
  expect(
    (await context.request.get(`/practice/register/${record.id}`)).url(),
  ).toContain("/login");
});
