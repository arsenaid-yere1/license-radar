import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, pool } from "../helpers/private-browser";
import { setup } from "../helpers/browser";
test.use({ trace: "off", screenshot: "off", video: "off" });
type Member = { practice_id: string; user_id: string };
async function as(m: Member, query: string, values: unknown[]) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      m.user_id,
    ]);
    const r = await db.query(query, values);
    await db.query("commit");
    return r.rows[0].result;
  } finally {
    await db.query("rollback");
    db.release();
  }
}
async function fixture(page: Page) {
  await setup(page);
  const m = (
    await pool.query(
      "select * from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0] as Member;
  const r = await as(
    m,
    "select public.create_practice_credential_with_details($1,$2,'Confirmed policy','malpractice_policy','practice',null,'{}','Insurer','CA','2000-03-02','2000-02-01') result",
    [m.practice_id, randomUUID()],
  );
  expect(r.status).toBe("success");
  await page.goto(`/practice/register/${r.credential.id}?from=dashboard`);
  return { m, id: r.credential.id };
}
async function current(m: Member, id: string) {
  const r = await as(
    m,
    "select public.list_practice_register_with_renewal($1,true) result",
    [m.practice_id],
  );
  return r.credentials.find((c: { id: string }) => c.id === id);
}
async function open(page: Page, end = "2090-03-02") {
  await page.getByRole("button", { name: "Record confirmed renewal" }).click();
  await page.getByLabel("New coverage end date", { exact: true }).fill(end);
  await page
    .getByLabel("I have confirmed this renewal and its new dates.")
    .check();
}
async function confirm(page: Page) {
  await page
    .getByRole("button", { name: "Confirm renewal and new dates" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Renewal confirmed. New dates saved.",
  );
  await expect(
    page.getByRole("button", { name: "Record confirmed renewal" }),
  ).toBeEnabled();
}
async function layout(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("RC02 RC04 RC07 RC08 real confirmation moves workload and retains archived history", async ({
  page,
}) => {
  const { m, id } = await fixture(page);
  await page.getByRole("button", { name: "Record confirmed renewal" }).click();
  await expect(page.getByLabel("New coverage end date")).toHaveValue("");
  await expect(page.getByLabel(/I have confirmed/)).not.toBeChecked();
  await page
    .getByRole("button", { name: "Confirm renewal and new dates" })
    .click();
  await expect(page.locator("p[role=alert]")).toBeFocused();
  await page.getByLabel("New coverage end date").fill("2090-03-02");
  await page
    .getByLabel("New earlier action deadline (optional)")
    .fill("2090-02-01");
  await page.getByLabel(/I have confirmed/).check();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await layout(page);
    await page.screenshot({
      path: `reports/completion-form-${width}.png`,
      fullPage: true,
    });
  }
  await confirm(page);
  expect((await current(m, id)).current_cycle.cycle_number).toBe(2);
  await expect(page.getByText("Not started", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('time[datetime="2090-02-01"]')).toHaveText([
    "Feb 1, 2090",
    "Feb 1, 2090",
  ]);
  await page
    .getByRole("link", { name: "Renewal history", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cycle 2 · Current cycle" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Cycle 1 · Confirmed renewal" }),
  ).toBeVisible();
  await expect(page.getByText("Mar 2, 2000")).toBeVisible();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await layout(page);
    await page.screenshot({
      path: `reports/completion-history-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/practice/dashboard");
  await expect(
    page.getByRole("region", { name: "Past due" }),
  ).not.toContainText("Confirmed policy");
  await page.goto("/practice/calendar?month=2090-03&view=agenda");
  await expect(
    page.getByRole("link", { name: /Confirmed policy/ }),
  ).toBeVisible();
  await page.goto("/practice/register");
  await page.getByRole("button", { name: "Archive record" }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await page
    .getByRole("link", { name: "Archived records", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Renewal history", exact: true })
    .click();
  await expect(page.getByText(/Archived record/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record confirmed renewal" }),
  ).toHaveCount(0);
});
test("RC03 RC08 lost committed response retries exact dates and newer successor wins", async ({
  page,
  context,
}) => {
  const { m, id } = await fixture(page),
    path = `**/practice/register/${id}*`,
    bodies: { body: string; type: string }[] = [];
  await open(page);
  await page.route(path, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push({
      body: route.request().postData()!,
      type: route.request().headers()["content-type"],
    });
    await route.fetch();
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Confirm renewal and new dates" })
    .click();
  await expect(page.locator("p[role=alert]")).toContainText("Retry this save");
  await expect(page.getByLabel("New coverage end date")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Back to dashboard" }),
  ).toHaveCount(0);
  const second = await context.newPage();
  try {
    await second.goto(`/practice/register/${id}`);
    await open(second, "2091-03-02");
    await confirm(second);
    const newer = await current(m, id);
    expect(newer.current_cycle.cycle_number).toBe(3);
    await page.unroute(path);
    await page.route(path, async (route) => {
      if (route.request().method() === "POST")
        bodies.push({
          body: route.request().postData()!,
          type: route.request().headers()["content-type"],
        });
      await route.continue();
    });
    await page.getByRole("button", { name: "Retry this save" }).click();
    await expect(
      page.getByRole("button", { name: "Record confirmed renewal" }),
    ).toBeEnabled();
    await expect(page.locator('time[datetime="2091-03-02"]')).toHaveText([
      "Mar 2, 2091",
      "Mar 2, 2091",
    ]);
    expect(await current(m, id)).toEqual(newer);
    const parse = async (v: { body: string; type: string }) =>
      Array.from(
        await new Response(v.body, {
          headers: { "content-type": v.type },
        }).formData(),
      ).filter(([k]) => k.startsWith("1_"));
    expect(bodies).toHaveLength(2);
    expect(await parse(bodies[0])).toEqual(await parse(bodies[1]));
    await open(page, "2092-03-02");
    await open(second, "2093-03-02");
    await confirm(second);
    await page
      .getByRole("button", { name: "Confirm renewal and new dates" })
      .click();
    await expect(page.getByText("Saved values for comparison")).toBeVisible();
    await expect(page.getByLabel("New coverage end date")).toBeDisabled();
    await page.getByRole("button", { name: "Reload saved values" }).click();
    await expect(page.getByLabel("New coverage end date")).toHaveValue("");
    await expect(page.getByLabel(/I have confirmed/)).not.toBeChecked();
  } finally {
    await second.close();
  }
});
