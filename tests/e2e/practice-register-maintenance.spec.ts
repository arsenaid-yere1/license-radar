import { test, expect, pool } from "../helpers/private-browser";
import { setup, signIn } from "../helpers/browser";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
test.use({ trace: "off", screenshot: "off", video: "off" });
async function open(page: Page) {
  await setup(page);
  await page.getByRole("link", { name: "Renewal register" }).click();
  return (
    await pool.query(
      "select * from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0];
}
async function create(page: Page, title = "Policy", end = "2028-02-29") {
  await page.getByLabel("Record title").fill(title);
  await page.getByLabel("Record type").selectOption("malpractice_policy");
  await page.getByLabel("Insurer (optional)").fill("Insurer");
  await page.getByLabel("Coverage jurisdiction (optional)").fill("CA");
  await page.getByLabel("Coverage end date").fill(end);
  await page.getByLabel("Earlier action deadline").fill("2028-02-01");
  await page.getByRole("button", { name: "Add record" }).click();
  await expect(page.getByText("Record saved.", { exact: true })).toBeFocused();
}
const item = (page: Page, title = "Policy") =>
  page
    .getByRole("list", { name: "Saved records" })
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const editor = (page: Page, title = "Policy") =>
  page.getByRole("region", { name: `Edit ${title}`, exact: true });
async function snapshots(practice: string) {
  const all: Record<string, unknown> = {};
  for (const table of [
    "public.credentials",
    "public.credential_cycles",
    "public.policy_coverage",
    "private.register_audit_events",
    "private.register_create_requests",
    "private.register_change_requests",
  ]) {
    all[table] = (
      await pool.query(
        `select * from ${table} where practice_id=$1 order by ${table.endsWith("coverage") ? "credential_id,clinician_id" : "id"}`,
        [practice],
      )
    ).rows;
  }
  return all;
}
test("M12 M14 real edits retain validation drafts, no-op cycles, explicit type reset, owner and keyboard mobile", async ({
  page,
}) => {
  const member = await open(page);
  await page.getByLabel("Clinician name").fill("Rivera");
  await page.getByRole("button", { name: "Add clinician" }).click();
  await expect(
    page.getByText("Clinician saved.", { exact: true }),
  ).toBeFocused();
  await create(page);
  const before = await snapshots(member.practice_id);
  await item(page).getByRole("button", { name: "Edit record" }).click();
  const e = editor(page);
  await expect(e.getByLabel("Insurer (optional)")).toHaveValue("Insurer");
  await expect(e.getByLabel("Coverage end date")).toHaveValue("2028-02-29");
  await e.getByRole("button", { name: "Cancel" }).click();
  expect(await snapshots(member.practice_id)).toEqual(before);
  await expect(
    item(page).getByRole("button", { name: "Edit record" }),
  ).toBeFocused();
  await item(page).getByRole("button", { name: "Edit record" }).click();
  await e.getByLabel("Earlier action deadline").fill("2028-02-29");
  await e.getByRole("button", { name: "Save changes" }).click();
  await expect(e.getByRole("alert")).toBeFocused();
  await expect(e.getByLabel("Earlier action deadline")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(e.getByLabel("Earlier action deadline")).toHaveValue(
    "2028-02-29",
  );
  await e.getByLabel("Earlier action deadline").fill("2028-02-01");
  await e.getByLabel("Record title").fill(" Policy ");
  await e.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeFocused();
  const noOp = await snapshots(member.practice_id);
  for (const table of [
    "public.credentials",
    "public.credential_cycles",
    "private.register_audit_events",
  ])
    expect(noOp[table]).toEqual(before[table]);
  expect(noOp["private.register_change_requests"] as unknown[]).toHaveLength(1);
  await item(page).getByRole("button", { name: "Edit record" }).click();
  await e.getByLabel("Coverage end date").fill("2028-03-01");
  await e.getByRole("checkbox", { name: /Rivera/ }).check();
  await e.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  await expect(item(page)).toContainText("Coverage end date: Mar 1, 2028");
  await expect(item(page)).toContainText("Tracking date: Feb 1, 2028");
  await item(page).getByRole("button", { name: "Edit record" }).click();
  await e.getByLabel("Record owner").selectOption("clinician");
  await expect(e.getByLabel("Coverage end date")).toHaveValue("2028-03-01");
  await e.getByLabel("Owning clinician").selectOption({ index: 1 });
  await e.getByLabel("Record type").selectOption("state_license");
  await e.getByRole("button", { name: "Keep current type" }).click();
  await expect(e.getByLabel("Coverage end date")).toHaveValue("2028-03-01");
  await e.getByLabel("Record type").selectOption("state_license");
  await e.getByRole("button", { name: "Confirm type change" }).click();
  await expect(e.getByLabel("Expiration date")).toHaveValue("");
  await e.getByLabel("Licensing board (optional)").fill("Board");
  await e.getByLabel("Expiration date").fill("2029-12-01");
  await e.getByRole("button", { name: "Save changes" }).click();
  await expect(item(page)).toContainText("State license");
  await expect(item(page)).toContainText("Rivera (clinician)");
  await page.reload();
  await expect(item(page)).toContainText("Dec 1, 2029");
  const after = await snapshots(member.practice_id);
  expect(
    (
      after["public.credential_cycles"] as {
        id: string;
        date_revision: number;
      }[]
    )[0].id,
  ).toBe((before["public.credential_cycles"] as { id: string }[])[0].id);
  expect(
    (after["public.credential_cycles"] as { date_revision: number }[])[0]
      .date_revision,
  ).toBe(3);
  await item(page).getByRole("button", { name: "Edit record" }).click();
  await page.setViewportSize({ width: 375, height: 1100 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await e.getByRole("button", { name: "Save changes" }).focus();
  await page.keyboard.press("Tab");
  await expect(e.getByRole("button", { name: "Cancel" })).toBeFocused();
  await e.getByRole("button", { name: "Cancel" }).click();
});
test("M04 M12 two real sessions conflict with comparison and explicit discard reload; newer archive blocks stale edit", async ({
  page,
  context,
}) => {
  const member = await open(page);
  await create(page);
  const second = await context.newPage();
  await second.goto("/practice/register");
  await item(second).getByRole("button", { name: "Edit record" }).click();
  await editor(second).getByLabel("Record title").fill("Losing draft");
  await item(page).getByRole("button", { name: "Edit record" }).click();
  await editor(page).getByLabel("Record title").fill("Winning title");
  await editor(page).getByRole("button", { name: "Save changes" }).click();
  await expect(item(page, "Winning title")).toBeVisible();
  const winner = await snapshots(member.practice_id);
  await editor(second).getByRole("button", { name: "Save changes" }).click();
  await expect(second.getByText("Saved values for comparison")).toBeVisible();
  await expect(editor(second).getByLabel("Record title")).toHaveValue(
    "Losing draft",
  );
  await expect(editor(second).getByLabel("Record title")).toBeDisabled();
  expect(await snapshots(member.practice_id)).toEqual(winner);
  await second.getByRole("button", { name: "Reload saved values" }).click();
  await expect(editor(second).getByLabel("Record title")).toHaveValue(
    "Winning title",
  );
  await editor(second).getByLabel("Record title").fill("Reviewed title");
  await editor(second).getByRole("button", { name: "Save changes" }).click();
  await expect(item(second, "Reviewed title")).toBeVisible();
  await page.reload();
  await item(page, "Reviewed title")
    .getByRole("button", { name: "Edit record" })
    .click();
  await item(second, "Reviewed title")
    .getByRole("button", { name: "Archive record" })
    .click();
  await second.getByRole("button", { name: "Confirm archive" }).click();
  await expect(
    second.getByText("Record archived.", { exact: true }),
  ).toBeFocused();
  await editor(page, "Reviewed title")
    .getByLabel("Record title")
    .fill("Stale after archive");
  await editor(page, "Reviewed title")
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(editor(page, "Reviewed title").getByRole("alert")).toHaveText(
    "This record is archived. Reload the register to review its history.",
  );
  await expect(
    editor(page, "Reviewed title").getByLabel("Record title"),
  ).toBeDisabled();
  await second.close();
});
async function capturePayload(body: string, contentType: string) {
  return Array.from(
    await new Response(body, {
      headers: { "content-type": contentType },
    }).formData(),
  ).filter(([key]) => key.startsWith("1_"));
}
test("M13 M15 lost committed edit freezes exact retry and rejects foreign-Origin without writes", async ({
  page,
  context,
}) => {
  const member = await open(page);
  await create(page);
  await item(page).getByRole("button", { name: "Edit record" }).click();
  await editor(page).getByLabel("Record title").fill("Corrected");
  const requests: {
    body: string;
    contentType: string;
    url: string;
    headers: Record<string, string>;
  }[] = [];
  const capture = (request: import("@playwright/test").Request) =>
    requests.push({
      body: request.postData()!,
      contentType: request.headers()["content-type"],
      url: request.url(),
      headers: request.headers(),
    });
  await page.route("**/practice/register", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    capture(route.request());
    await route.fetch();
    await route.abort("failed");
  });
  await editor(page).getByRole("button", { name: "Save changes" }).click();
  await expect(editor(page).getByRole("alert")).toContainText(
    "Retry this save before leaving",
  );
  await expect(editor(page).getByLabel("Record title")).toBeDisabled();
  await expect(
    editor(page).getByRole("button", { name: "Cancel" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Archived records" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Renewal calendar" }),
  ).toHaveCount(0);
  const committed = await snapshots(member.practice_id);
  expect(
    committed["private.register_change_requests"] as unknown[],
  ).toHaveLength(1);
  await page.unroute("**/practice/register");
  await page.route("**/practice/register", async (route) => {
    if (route.request().method() === "POST") capture(route.request());
    await route.continue();
  });
  await editor(page).getByRole("button", { name: "Retry this save" }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeFocused();
  await expect(item(page, "Corrected")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Renewal calendar" }),
  ).toBeVisible();
  expect(await snapshots(member.practice_id)).toEqual(committed);
  expect(
    await capturePayload(requests[1].body, requests[1].contentType),
  ).toEqual(await capturePayload(requests[0].body, requests[0].contentType));
  const attack = await context.request.post(requests[1].url, {
    headers: { ...requests[1].headers, origin: "https://attacker.invalid" },
    data: requests[1].body,
  });
  expect(attack.status()).toBe(500);
  expect(await snapshots(member.practice_id)).toEqual(committed);
});
test("M13 archive precommit rollback pending lock and lost committed response preserve cycle history", async ({
  page,
}) => {
  const member = await open(page);
  await create(page);
  await item(page).getByRole("button", { name: "Archive record" }).click();
  await expect(page.getByText(/Archive “Policy”/)).toBeVisible();
  const before = await snapshots(member.practice_id);
  await pool.query(
    "create function private.maintenance_ui_fault() returns trigger language plpgsql as $$begin raise exception 'fixture outage';end$$;create trigger maintenance_ui_fault before insert on private.register_change_requests for each row execute function private.maintenance_ui_fault()",
  );
  try {
    await page.getByRole("button", { name: "Confirm archive" }).click();
    await expect(page.locator("p[role=alert]")).toContainText(
      "Retry this save",
    );
    expect(await snapshots(member.practice_id)).toEqual(before);
  } finally {
    await pool.query(
      "drop trigger maintenance_ui_fault on private.register_change_requests;drop function private.maintenance_ui_fault()",
    );
  }
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select 1 from public.practices where id=$1 for update", [
      member.practice_id,
    ]);
    await page.getByRole("button", { name: "Retry this save" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "Archived records" }),
    ).toHaveCount(0);
    await db.query("commit");
    await expect(
      page.getByText("Record archived.", { exact: true }),
    ).toBeFocused();
  } finally {
    await db.query("rollback");
    db.release();
  }
  const after = await snapshots(member.practice_id);
  expect(after["public.credential_cycles"]).toEqual(
    before["public.credential_cycles"],
  );
  expect(after["private.register_create_requests"]).toEqual(
    before["private.register_create_requests"],
  );
  expect(after["private.register_change_requests"] as unknown[]).toHaveLength(
    1,
  );
  await page.getByRole("link", { name: "Archived records" }).click();
  await expect(item(page)).toContainText("Archived on");
  await expect(
    item(page).getByRole("button", { name: "Edit record" }),
  ).toHaveCount(0);
  await expect(item(page)).toContainText("Feb 29, 2028");
  await page.getByRole("link", { name: "Active records" }).click();
  await create(page, "Lost archive");
  await item(page, "Lost archive")
    .getByRole("button", { name: "Archive record" })
    .click();
  await page.route("**/practice/register", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Retry this save");
  await expect(
    page.getByRole("link", { name: "Renewal calendar" }),
  ).toHaveCount(0);
  const archived = await snapshots(member.practice_id);
  await page.unroute("**/practice/register");
  await page.getByRole("button", { name: "Retry this save" }).click();
  await expect(
    page.getByText("Record archived.", { exact: true }),
  ).toBeFocused();
  expect(await snapshots(member.practice_id)).toEqual(archived);
  await expect(
    page.getByRole("heading", { name: "Lost archive", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("No renewal records added yet.")).toBeVisible();
});
for (const intent of ["update", "create"] as const)
  test(`M13 fresh active read retires a historical ${intent} reply after another session archives`, async ({
    page,
    context,
  }) => {
    const member = await open(page);
    if (intent === "update") {
      await create(page);
      await item(page).getByRole("button", { name: "Edit record" }).click();
      await editor(page).getByLabel("Record title").fill("Retained history");
    } else {
      await page.getByLabel("Record title").fill("Retained history");
    }
    await page.route("**/practice/register", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      await route.abort("failed");
    });
    await page
      .getByRole("button", {
        name: intent === "update" ? "Save changes" : "Add record",
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry this save" }),
    ).toBeVisible();
    const second = await context.newPage();
    try {
      await second.goto("/practice/register");
      await item(second, "Retained history")
        .getByRole("button", { name: "Archive record" })
        .click();
      await second.getByRole("button", { name: "Confirm archive" }).click();
      await expect(
        second.getByText("Record archived.", { exact: true }),
      ).toBeVisible();
      const archived = await snapshots(member.practice_id);
      await page.unroute("**/practice/register");
      await page.getByRole("button", { name: "Retry this save" }).click();
      await expect(
        page.getByText(
          intent === "update" ? "Changes saved." : "Record saved.",
          { exact: true },
        ),
      ).toBeFocused();
      await expect(
        page.getByRole("heading", { name: "Retained history", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("No renewal records added yet."),
      ).toBeVisible();
      expect(await snapshots(member.practice_id)).toEqual(archived);
      await page.getByRole("link", { name: "Archived records" }).click();
      await expect(item(page, "Retained history")).toContainText("Archived on");
    } finally {
      await second.close();
    }
  });
test("M10 M14 advisory duplicates resolve after edit/archive and viewer keeps active and archived inventory across sign-in", async ({
  page,
}) => {
  const member = await open(page);
  await create(page, "Policy");
  await create(page, " policy ", "2028-03-01");
  await expect(
    page.getByText("Possible duplicate — review these records", {
      exact: true,
    }),
  ).toHaveCount(2);
  await item(page, "policy")
    .getByRole("button", { name: "Edit record" })
    .click();
  await editor(page, "policy")
    .getByLabel("Record title")
    .fill("Different policy");
  await editor(page, "policy")
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(
    page.getByText("Possible duplicate — review these records", {
      exact: true,
    }),
  ).toHaveCount(0);
  await item(page, "Different policy")
    .getByRole("button", { name: "Edit record" })
    .click();
  await editor(page, "Different policy")
    .getByLabel("Record title")
    .fill("POLICY");
  await editor(page, "Different policy")
    .getByRole("button", { name: "Save changes" })
    .click();
  await expect(
    page.getByText("Possible duplicate — review these records", {
      exact: true,
    }),
  ).toHaveCount(2);
  await item(page, "POLICY")
    .getByRole("button", { name: "Archive record" })
    .click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(
    page.getByText("Possible duplicate — review these records", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(item(page)).toBeVisible();
  // Retain another active administrator while converting this account to viewer.
  const email = (
    await pool.query("select email from auth.users where id=$1", [
      member.user_id,
    ])
  ).rows[0].email;
  const db = await pool.connect();
  try {
    await db.query("begin");
    const admin = await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'fixture-extra-'||gen_random_uuid()||'@example.test',now()) returning id",
    );
    await db.query(
      "insert into public.practice_memberships(practice_id,user_id,role,state) values($1,$2,'administrator','active')",
      [member.practice_id, admin.rows[0].id],
    );
    await db.query(
      "update public.practice_memberships set role='viewer',version=version+1 where id=$1",
      [member.id],
    );
    await db.query("commit");
  } finally {
    await db.query("rollback");
    db.release();
  }
  await page.reload();
  await expect(page.getByText(/read-only/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit record" })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Archived records" }).click();
  await expect(item(page, "POLICY")).toContainText("Archived on");
  await expect(
    page.getByRole("button", { name: "Archive record" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds' where id=$1",
    [member.user_id],
  );
  await signIn(page, email);
  await page.getByRole("link", { name: "Renewal register" }).click();
  await expect(item(page)).toBeVisible();
  await page.getByRole("link", { name: "Archived records" }).click();
  await expect(item(page, "POLICY")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("M14 corrected action-only dates remain calendar days in contrasting browser zones", async ({
  page,
  context,
  browser,
}) => {
  await open(page);
  await create(page);
  await item(page).getByRole("button", { name: "Edit record" }).click();
  await editor(page).getByLabel("Coverage end date").fill("");
  await editor(page).getByLabel("Earlier action deadline").fill("9999-11-01");
  await editor(page).getByRole("button", { name: "Save changes" }).click();
  await expect(item(page)).toContainText("Coverage end date unknown");
  await expect(item(page)).toContainText("Tracking date: Nov 1, 9999");
  for (const timezoneId of ["Pacific/Honolulu", "Asia/Tokyo"]) {
    const zoned = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      timezoneId,
      storageState: await context.storageState(),
    });
    try {
      const q = await zoned.newPage();
      await q.goto("/practice/register");
      await expect(item(q)).toContainText("Nov 1, 9999");
      await item(q).getByRole("button", { name: "Edit record" }).click();
      await expect(editor(q).getByLabel("Earlier action deadline")).toHaveValue(
        "9999-11-01",
      );
      await expect(editor(q).getByLabel("Coverage end date")).toHaveValue("");
    } finally {
      await zoned.close();
    }
  }
  await item(page).getByRole("button", { name: "Edit record" }).click();
  await page.screenshot({
    path: "reports/register-maintenance-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 1100 });
  await page.screenshot({
    path: "reports/register-maintenance-mobile.png",
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
