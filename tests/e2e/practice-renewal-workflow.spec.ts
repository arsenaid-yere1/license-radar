import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, pool } from "../helpers/private-browser";
import { setup } from "../helpers/browser";
test.use({ trace: "off", screenshot: "off", video: "off" });
type Member = { practice_id: string; user_id: string; id: string };
async function asMember(member: Member, sql: string, values: unknown[]) {
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
async function fixture(page: Page) {
  await setup(page);
  const m = (
    await pool.query(
      "select * from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0] as Member;
  const r = await asMember(
    m,
    "select public.create_practice_credential_with_details($1,$2,$3,'malpractice_policy','practice',null,'{}','Board','CA','2000-01-01',null) result",
    [m.practice_id, randomUUID(), "Renewal policy"],
  );
  expect(r.status).toBe("success");
  await page.goto(`/practice/register/${r.credential.id}?from=dashboard`);
  return { m, id: r.credential.id };
}
async function current(m: Member, id: string) {
  const r = await asMember(
    m,
    "select public.list_practice_register_with_renewal($1,true) result",
    [m.practice_id],
  );
  return r.credentials.find((c: { id: string }) => c.id === id);
}
async function oldRows(m: Member) {
  const tables = (
    await pool.query(
      "select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='private' or (n.nspname='public' and c.relname in ('practices','practice_memberships','clinicians','credentials','policy_coverage','credential_cycles'))) order by 1,2",
    )
  ).rows.filter(
    (t) =>
      ![
        "credential_renewal_links",
        "credential_renewal_workflows",
        "renewal_change_requests",
        "renewal_audit_events",
      ].includes(t.name),
  );
  const rows: Record<string, unknown> = {};
  for (const t of tables)
    rows[`${t.schema}.${t.name}`] = (
      await pool.query(
        `select to_jsonb(t) row from ${t.schema}.${t.name} t order by to_jsonb(t)::text`,
      )
    ).rows;
  expect(m.practice_id).toBeTruthy();
  return rows;
}
async function change(page: Page, status: string) {
  await page.getByRole("button", { name: "Change progress" }).click();
  await page
    .getByLabel("Renewal progress", { exact: true })
    .selectOption(status);
  await page.getByRole("button", { name: "Save progress" }).click();
  await expect(page.getByRole("status")).toHaveText("Renewal progress saved.");
  await expect(
    page.getByRole("button", { name: "Change progress" }),
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
test("RW01 RW02 RW03 RW04 RW08 RW09 real saved workflow remains independent from dates and link navigation", async ({
  page,
  context,
}) => {
  const { m, id } = await fixture(page),
    before = await oldRows(m);
  await expect(page.getByText("Not started", { exact: true })).toBeVisible();
  await expect(page.getByText("Review not yet acknowledged.")).toBeVisible();
  await page.getByRole("button", { name: "Edit renewal link" }).click();
  await page.getByLabel("Renewal link (optional)").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save renewal link" }).click();
  await expect(page.locator("p[role=alert]")).toBeFocused();
  await expect(page.getByLabel("Renewal link (optional)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page
    .getByLabel("Renewal link (optional)")
    .fill(" HTTPS://board.example.test/renew ");
  await page.getByRole("button", { name: "Save renewal link" }).click();
  await expect(
    page.getByRole("button", { name: "Edit renewal link" }),
  ).toBeEnabled();
  const external = page.getByRole("link", { name: /Open renewal site/ });
  await expect(external).toHaveAttribute(
    "href",
    "https://board.example.test/renew",
  );
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  await expect(external).toHaveAttribute("referrerpolicy", "no-referrer");
  let referer: string | undefined = "unobserved",
    posts = 0;
  const count = (r: import("@playwright/test").Request) => {
    if (r.method() === "POST") posts++;
  };
  context.on("request", count);
  await context.route("https://board.example.test/**", async (route) => {
    referer = route.request().headers().referer;
    await route.fulfill({ status: 200, body: "Fixture issuer" });
  });
  const popup = context.waitForEvent("page");
  await external.click();
  const opened = await popup;
  await expect(opened).toHaveURL("https://board.example.test/renew");
  await expect(opened.getByText("Fixture issuer")).toBeVisible();
  expect(referer).toBeUndefined();
  expect(posts).toBe(0);
  context.off("request", count);
  await opened.close();
  expect((await current(m, id)).renewal.workflow.acknowledgedAt).toBeNull();
  for (const status of [
    "in-progress",
    "awaiting-approval",
    "not-started",
    "awaiting-approval",
  ])
    await change(page, status);
  await page.getByRole("button", { name: "Acknowledge review" }).click();
  await page.getByRole("button", { name: "Confirm review" }).click();
  await expect(
    page.getByRole("button", { name: "Acknowledge review" }),
  ).toBeDisabled();
  await expect(page.getByText(/^Reviewed /)).toBeVisible();
  const saved = await current(m, id);
  expect(saved.renewal.workflow.status).toBe("awaiting-approval");
  expect(saved.renewal.workflow.acknowledgedAt).toBeTruthy();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await layout(page);
    await page.screenshot({
      path: `reports/renewal-detail-${width}.png`,
      fullPage: true,
    });
  }
  await page.reload();
  await expect(
    page.getByText("Awaiting approval", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await expect(page.getByRole("region", { name: "Past due" })).toContainText(
    "Awaiting approval",
  );
  await expect(
    page.getByRole("region", { name: "Past due" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.goto("/practice/register");
  await expect(page.getByRole("list", { name: "Saved records" })).toContainText(
    "Awaiting approval",
  );
  expect(await oldRows(m)).toEqual(before);
});
test("RW06 RW07 dropped real response retries exact payload and a newer saved read wins the old receipt", async ({
  page,
  context,
}) => {
  const { m, id } = await fixture(page),
    path = `**/practice/register/${id}*`,
    bodies: { body: string; type: string }[] = [];
  await page.getByRole("button", { name: "Change progress" }).click();
  await page
    .getByLabel("Renewal progress", { exact: true })
    .selectOption("in-progress");
  await page.route(path, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push({
      body: route.request().postData()!,
      type: route.request().headers()["content-type"],
    });
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Save progress" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Retry this save");
  await expect(
    page.getByLabel("Renewal progress", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit renewal link" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Back to dashboard" }),
  ).toHaveCount(0);
  const second = await context.newPage();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "License Renewal Radar home" }),
  ).toHaveCount(0);
  try {
    await second.goto(`/practice/register/${id}`);
    await change(second, "awaiting-approval");
    const newer = await current(m, id),
      count = (
        await pool.query(
          "select count(*)::integer n from private.renewal_change_requests where practice_id=$1",
          [m.practice_id],
        )
      ).rows[0].n;
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
      page.getByText("Awaiting approval", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Change progress" }),
    ).toBeEnabled();
    const payload = async (v: { body: string; type: string }) =>
      Array.from(
        await new Response(v.body, {
          headers: { "content-type": v.type },
        }).formData(),
      ).filter(([key]) => key.startsWith("1_"));
    expect(bodies).toHaveLength(2);
    expect(await payload(bodies[1])).toEqual(await payload(bodies[0]));
    expect(await current(m, id)).toEqual(newer);
    expect(
      (
        await pool.query(
          "select count(*)::integer n from private.renewal_change_requests where practice_id=$1",
          [m.practice_id],
        )
      ).rows[0].n,
    ).toBe(count);
    // A second stale tab requires explicit comparison and reload; no silent overwrite.
    await page.getByRole("button", { name: "Change progress" }).click();
    await page
      .getByLabel("Renewal progress", { exact: true })
      .selectOption("not-started");
    await change(second, "in-progress");
    await page.getByRole("button", { name: "Save progress" }).click();
    await expect(page.getByText("Saved values for comparison")).toBeVisible();
    await expect(
      page.getByLabel("Renewal progress", { exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Reload saved values" }).click();
    await expect(
      page.getByLabel("Renewal progress", { exact: true }),
    ).toHaveValue("in-progress");
    await page
      .getByLabel("Renewal progress", { exact: true })
      .selectOption("not-started");
    await page.getByRole("button", { name: "Save progress" }).click();
    await expect(
      page.getByRole("button", { name: "Change progress" }),
    ).toBeEnabled();
    await expect(page.getByText("Not started", { exact: true })).toBeVisible();
  } finally {
    await second.close();
  }
});
test("RW05 RW08 viewer archived history and revocation enforce the live read boundary", async ({
  page,
}) => {
  const { m, id } = await fixture(page);
  await change(page, "awaiting-approval");
  await page.goto("/practice/register");
  await page.getByRole("button", { name: "Archive record" }).click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await page.getByRole("link", { name: "Archived records" }).click();
  await expect(
    page.getByText("Awaiting approval", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Review renewal" })).toHaveCount(
    0,
  );
  await page.goto(`/practice/register/${id}`);
  await expect(
    page.getByRole("heading", { name: "Record unavailable." }),
  ).toBeVisible();
  const extra = (
    await pool.query(
      "insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'fixture-extra-'||gen_random_uuid()||'@example.test',now()) returning id",
    )
  ).rows[0].id;
  await pool.query(
    "insert into public.practice_memberships(practice_id,user_id,role,state) values($1,$2,'administrator','active')",
    [m.practice_id, extra],
  );
  await pool.query(
    "update public.practice_memberships set role='viewer',version=version+1 where id=$1",
    [m.id],
  );
  // Restore the fixture's active record solely to exercise the viewer read UI.
  await pool.query(
    "update public.credentials set archived_at=null where id=$1",
    [id],
  );
  await page.goto(`/practice/register/${id}`);
  await expect(
    page.getByText("Awaiting approval", { exact: true }),
  ).toBeVisible();
  for (const name of [
    "Change progress",
    "Edit renewal link",
    "Acknowledge review",
  ])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  await pool.query(
    "update public.practice_memberships set state='revoked',revoked_at=clock_timestamp(),version=version+1 where id=$1",
    [m.id],
  );
  await page.reload();
  await expect(page).toHaveURL(/onboarding\/practice/);
});
