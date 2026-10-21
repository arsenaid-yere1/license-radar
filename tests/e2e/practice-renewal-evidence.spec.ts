import { randomUUID, createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, pool } from "../helpers/private-browser";
import { setup } from "../helpers/browser";
test.use({ trace: "off", screenshot: "off", video: "off" });
const proof = Buffer.from("%PDF-1.7\nbenign renewal fixture\n%%EOF\n");
async function as(actor: string, query: string, args: unknown[]) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      actor,
    ]);
    const r = await db.query(query, args);
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
      "select practice_id,user_id from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0];
  const r = await as(
    m.user_id,
    "select public.create_practice_credential_with_details($1,$2,'Evidence policy','malpractice_policy','practice',null,'{}',null,'CA','2090-03-02',null) result",
    [m.practice_id, randomUUID()],
  );
  expect(r.status).toBe("success");
  const c = r.credential,
    href = `/practice/register/${c.id}/evidence/${c.current_cycle.id}`;
  await page.goto(href);
  return {
    m,
    c,
    href,
    endpoint: `/api/renewal-evidence/${c.id}/${c.current_cycle.id}`,
  };
}
async function upload(page: Page) {
  await page.getByLabel("Evidence file").setInputFiles({
    name: "proof.pdf",
    mimeType: "application/pdf",
    buffer: proof,
  });
  await page
    .getByRole("button", { name: "Upload evidence", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download proof.pdf" }),
  ).toBeVisible();
}
async function layout(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("EV01 EV05 EV06 EV08 EV10 real private upload download removal and retained cycle", async ({
  page,
}) => {
  const { m, c, href, endpoint } = await fixture(page);
  await upload(page);
  await page.reload();
  const link = page.getByRole("link", { name: "Download proof.pdf" }),
    download = await page.request.get((await link.getAttribute("href"))!);
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(proof);
  expect(download.headers()["cache-control"]).toContain("no-store");
  expect(
    (await page.request.head((await link.getAttribute("href"))!)).status(),
  ).toBe(405);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await layout(page);
    await page.screenshot({
      path: `reports/evidence-${width}.png`,
      fullPage: true,
    });
  }
  for (const year of [2091, 2092]) {
    await page.goto(`/practice/register/${c.id}`);
    await page
      .getByRole("button", { name: "Record confirmed renewal" })
      .click();
    await page
      .getByLabel("New coverage end date", { exact: true })
      .fill(`${year}-03-02`);
    await page
      .getByLabel("I have confirmed this renewal and its new dates.")
      .check();
    await page
      .getByRole("button", { name: "Confirm renewal and new dates" })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Renewal confirmed. New dates saved.",
    );
    await expect(
      page.getByRole("button", { name: "Record confirmed renewal" }),
    ).toBeEnabled();
    await page
      .getByRole("link", { name: "Renewal evidence", exact: true })
      .click();
    await expect(
      page.getByText("No evidence attached to this cycle."),
    ).toBeVisible();
  }
  await page.goto(`/practice/register/${c.id}/history`);
  await page
    .getByRole("link", { name: "Evidence for cycle 1", exact: true })
    .click();
  await expect(page).toHaveURL(`http://127.0.0.1:3000${href}`);
  await expect(
    page.getByRole("link", { name: "Download proof.pdf" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove proof.pdf", exact: true })
    .click();
  await page.getByLabel("I confirm removal of this evidence.").check();
  await page
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download proof.pdf" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No evidence attached to this cycle."),
  ).toBeVisible();
  const row = (
    await pool.query(
      "select id,state,filename,charged from private.renewal_evidence where credential_id=$1",
      [c.id],
    )
  ).rows[0];
  expect(row).toMatchObject({
    state: "deleted",
    filename: null,
    charged: false,
  });
  expect((await page.request.get(`${endpoint}/${row.id}`)).status()).toBe(404);
  const cycles = (
    await pool.query(
      "select cycle_number,end_date::text from public.credential_cycles where credential_id=$1 order by cycle_number",
      [c.id],
    )
  ).rows;
  expect(cycles).toEqual([
    { cycle_number: 1, end_date: "2090-03-02" },
    { cycle_number: 2, end_date: "2091-03-02" },
    { cycle_number: 3, end_date: "2092-03-02" },
  ]);
  expect(m.practice_id).toBeTruthy();
});
test("EV06 EV07 real committed removal retry retains one receipt and cleanup audit", async ({
  page,
}) => {
  const { c, endpoint } = await fixture(page);
  await upload(page);
  const row = (
    await pool.query(
      "select id from private.renewal_evidence where credential_id=$1",
      [c.id],
    )
  ).rows[0];
  const target = `${endpoint}/${row.id}`,
    bodies: string[] = [];
  await page.route(`**${target}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    bodies.push(route.request().postData()!);
    await route.fetch();
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Remove proof.pdf", exact: true })
    .click();
  await page.getByLabel("I confirm removal of this evidence.").check();
  await page
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "Retry this removal",
  );
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  expect((await page.request.get(target)).status()).toBe(404);
  await page.unroute(`**${target}`);
  await page.route(`**${target}`, async (route) => {
    if (route.request().method() === "DELETE")
      bodies.push(route.request().postData()!);
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Retry this removal", exact: true })
    .click();
  await expect(
    page.getByText("No evidence attached to this cycle."),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(
    (
      await pool.query(
        "select operation,count(*)::int n from private.renewal_evidence_audit_events where evidence_id=$1 and operation in ('delete-requested','purge-completed') group by operation order by operation",
        [row.id],
      )
    ).rows,
  ).toEqual([
    { operation: "delete-requested", n: 1 },
    { operation: "purge-completed", n: 1 },
  ]);
  expect(
    (await page.request.post("/api/renewal-evidence/cleanup")).status(),
  ).toBe(401);
  const cleanup = await page.request.post("/api/renewal-evidence/cleanup", {
    headers: {
      authorization: "Bearer local-fixture-only-renewal-evidence-cleanup",
    },
  });
  expect(cleanup.status()).toBe(200);
  expect((await cleanup.json()).success).toBe(true);
});
test("EV04 EV07 real lost response retries identical file without duplicate attachment", async ({
  page,
}) => {
  const { c, endpoint } = await fixture(page),
    bodies: Buffer[] = [];
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataBuffer()!);
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByLabel("Evidence file").setInputFiles({
    name: "proof.pdf",
    mimeType: "application/pdf",
    buffer: proof,
  });
  await page
    .getByRole("button", { name: "Upload evidence", exact: true })
    .click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "Retry the same file",
  );
  await expect(page.getByLabel("Evidence file")).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Renewal history", exact: true }),
  ).toHaveCount(0);
  await page.unroute(`**${endpoint}`);
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() === "POST")
      bodies.push(route.request().postDataBuffer()!);
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Retry this upload", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download proof.pdf" }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  const keys = bodies.map(
    (b) => /name="requestId"\r\n\r\n([^\r]+)/.exec(b.toString())?.[1],
  );
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  for (const body of bodies) expect(body.includes(proof)).toBe(true);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.renewal_evidence where credential_id=$1",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(1);
  const rows = (
    await pool.query(
      "select e.digest,(select count(*)::int from private.renewal_evidence_audit_events a where a.evidence_id=e.id and a.operation='uploaded') n from private.renewal_evidence e where credential_id=$1",
      [c.id],
    )
  ).rows;
  expect(rows).toEqual([
    { digest: createHash("sha256").update(proof).digest("hex"), n: 1 },
  ]);
});
