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
async function safeLayout(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const ids = await page
    .locator("[id]")
    .evaluateAll((nodes) => nodes.map((n) => n.id));
  expect(new Set(ids).size).toBe(ids.length);
}
function offset(day: string, n: number) {
  const d = new Date(0),
    [y, m, date] = day.split("-").map(Number);
  d.setUTCFullYear(y, m - 1, date + n);
  return d.toISOString().slice(0, 10);
}
async function currentDay(page: Page) {
  return (await page.locator(".dashboard-asof time").getAttribute("datetime"))!;
}
async function counts(page: Page, past: number, due: number, missing: number) {
  for (const [title, n] of [
    ["Past due", past],
    ["Due within 60 days", due],
    ["Missing expiration / coverage end", missing],
  ] as const) {
    await expect(
      page
        .getByRole("navigation", { name: "Renewal priorities" })
        .getByRole("link", { name: `${n} ${title}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: title }).getByRole("listitem"),
    ).toHaveCount(n);
  }
}
async function changeDates(
  m: { practice_id: string; user_id: string },
  c: Awaited<ReturnType<typeof add>>,
  end: string | null,
  action: string | null,
) {
  const result = await asMember(
    m,
    "select public.update_practice_credential($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) result",
    [
      m.practice_id,
      randomUUID(),
      c.id,
      c.version,
      c.current_cycle.id,
      c.current_cycle.date_revision,
      c.title,
      c.type,
      c.owner_kind,
      c.owner_clinician_id,
      c.covered_clinicians.map((p: { id: string }) => p.id),
      c.issuer,
      c.jurisdiction,
      end,
      action,
    ],
  );
  expect(result.status).toBe("success");
  return result.credential;
}
test("Q01 Q02 Q03 Q06 Q11 Q12 Q14 exact dashboard lists, shared coverage, date purposes and mobile access", async ({
  page,
  context,
  browser,
}) => {
  const m = await fixture(page);
  await page.getByRole("link", { name: "Renewal dashboard" }).click();
  await expect(page.getByText("No active renewal records yet.")).toBeVisible();
  let day = await currentDay(page);
  const people = [];
  for (const name of ["Rivera & 陈", "Chen"]) {
    const person = await asMember(
      m,
      "select public.create_practice_clinician($1,$2,$3) result",
      [m.practice_id, randomUUID(), name],
    );
    people.push(person.clinician.id);
  }
  const descriptors: [string, string, number | null, number | null][] = [
    ["Past action", "malpractice_policy", 90, -1],
    ["Today", "state_license", 0, null],
    ["Day60", "dea_registration", 60, null],
    ["Day61", "state_license", 61, null],
    ["Unknown dates", "malpractice_policy", null, null],
    ["Action only", "dea_registration", null, 0],
    ...Array.from(
      { length: 6 },
      (_, i): [string, string, number | null, number | null] => [
        i === 0
          ? "Unicode 陈 & <img src=x onerror=alert(1)> " +
            "Long title ".repeat(7)
          : `Dense ${i}`,
        "state_license",
        1,
        null,
      ],
    ),
  ];
  const saved: Awaited<ReturnType<typeof add>>[] = [];
  for (const [title, type, end, action] of descriptors)
    saved.push(
      await add(
        m,
        title,
        type,
        end === null ? null : offset(day, end),
        action === null ? null : offset(day, action),
        null,
        title === "Past action" ? people : [],
      ),
    );
  await page.reload();
  const rendered = await currentDay(page);
  if (rendered !== day) {
    day = rendered;
    for (let i = 0; i < saved.length; i++) {
      const [, , end, action] = descriptors[i];
      saved[i] = await changeDates(
        m,
        saved[i],
        end === null ? null : offset(day, end),
        action === null ? null : offset(day, action),
      );
    }
    await page.reload();
  }
  expect(
    await currentDay(page),
    "Fixture clock changed twice across midnight",
  ).toBe(day);
  const before = await snapshot(m.practice_id);
  await counts(page, 1, 9, 2);
  await expect(page.getByRole("region", { name: "Past due" })).toContainText(
    "Covers: Rivera & 陈, Chen",
  );
  await expect(page.getByRole("region", { name: "Past due" })).toContainText(
    "earlier action deadline",
  );
  await expect(
    page.getByRole("region", { name: "Due within 60 days" }),
  ).toContainText("Due in 60 days");
  await expect(
    page.getByRole("region", { name: "Missing expiration / coverage end" }),
  ).toContainText("Dates not entered");
  await expect(
    page.getByRole("region", { name: "Missing expiration / coverage end" }),
  ).toContainText("Expiration date unknown");
  await expect(
    page.getByText("1 record with a tracking date more than 60 days away."),
  ).toBeVisible();
  await expect(page.locator(".dashboard-workspace img")).toHaveCount(0);
  await safeLayout(page);
  await page.screenshot({
    path: "reports/dashboard-desktop.png",
    fullPage: true,
  });
  const card = page
    .getByRole("navigation", { name: "Renewal priorities" })
    .getByRole("link")
    .first();
  await card.focus();
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("navigation", { name: "Renewal priorities" })
      .getByRole("link")
      .nth(1),
  ).toBeFocused();
  const response = await page.goto(
    "/practice/dashboard?practiceId=foreign&today=9999-12-31&horizon=0",
  );
  expect(response!.headers()["cache-control"]).toContain("no-store");
  await counts(page, 1, 9, 2);
  await page
    .getByRole("region", { name: "Past due" })
    .getByRole("link", { name: "Past action", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Back to dashboard" }),
  ).toHaveAttribute("href", "/practice/dashboard");
  await expect(page.locator(".credential-detail")).toContainText(
    "Coverage end date:",
  );
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  await counts(page, 1, 9, 2);
  await page.setViewportSize({ width: 375, height: 900 });
  await counts(page, 1, 9, 2);
  await safeLayout(page);
  await page.screenshot({
    path: "reports/dashboard-mobile.png",
    fullPage: true,
  });
  for (const timezoneId of ["Pacific/Honolulu", "Asia/Tokyo"]) {
    const zoned = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      timezoneId,
      storageState: await context.storageState(),
    });
    try {
      const other = await zoned.newPage();
      await other.goto("/practice/dashboard");
      await counts(other, 1, 9, 2);
      await expect(
        other
          .getByRole("region", { name: "Due within 60 days" })
          .locator(`time[datetime="${offset(day, 60)}"]`),
      ).toHaveCount(2);
    } finally {
      await zoned.close();
    }
  }
  await page
    .getByRole("link", { name: "Renewal calendar", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Renewal dashboard", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Renewal register", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Renewal dashboard", exact: true })
    .click();
  await counts(page, 1, 9, 2);
  expect(await snapshot(m.practice_id)).toEqual(before);
});
test("Q09 Q10 stale dashboard links and another session corrections/clearing/archive remain authorized", async ({
  page,
  context,
}) => {
  const m = await fixture(page),
    c = await add(m, "Saved policy", "malpractice_policy", "2000-01-01", null),
    foreign = await practice();
  const f = (
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
  await page.goto("/practice/dashboard");
  await counts(page, 1, 0, 0);
  const day = await currentDay(page),
    second = await context.newPage();
  try {
    await second.goto("/practice/register");
    await second.getByRole("button", { name: "Edit record" }).click();
    await second
      .getByRole("region", { name: "Edit Saved policy", exact: true })
      .getByLabel("Coverage end date")
      .fill(offset(day, 90));
    await second.getByRole("button", { name: "Save changes" }).click();
    await expect(
      second.getByText("Changes saved.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Saved policy", exact: true }).click();
    await expect(
      page.locator(`time[datetime="${offset(day, 90)}"]`),
    ).toHaveCount(2);
    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await counts(page, 0, 0, 0);
    await expect(
      page.getByText("1 record with a tracking date more than 60 days away."),
    ).toBeVisible();
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
    await counts(page, 0, 0, 1);
    await second.getByRole("button", { name: "Archive record" }).click();
    await second.getByRole("button", { name: "Confirm archive" }).click();
    await expect(
      second.getByText("Record archived.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Saved policy", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Record unavailable." }),
    ).toBeVisible();
    for (const id of [c.id, f.id, randomUUID(), "bad"]) {
      await page.goto(`/practice/register/${id}?from=dashboard`);
      await expect(
        page.getByRole("heading", { name: "Record unavailable." }),
      ).toBeVisible();
      await expect(page.getByText("Foreign secret")).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Return to dashboard" }).click();
    await counts(page, 0, 0, 0);
    await expect(
      page.getByText("No active renewal records yet."),
    ).toBeVisible();
  } finally {
    await second.close();
  }
});
test("Q08 missing cycle fails visibly and recovers without fabricated zero counts", async ({
  page,
}) => {
  const m = await fixture(page),
    c = await add(m, "Confirmed dates");
  const cycle = (
    await pool.query("select * from public.credential_cycles where id=$1", [
      c.current_cycle.id,
    ])
  ).rows[0];
  await pool.query("delete from public.credential_cycles where id=$1", [
    cycle.id,
  ]);
  try {
    await page.goto("/practice/dashboard");
    await expect(page.locator("p[role=alert]")).toHaveText(
      "We could not complete this request. Try again.",
    );
    await expect(
      page.getByRole("navigation", { name: "Renewal priorities" }),
    ).toHaveCount(0);
  } finally {
    await pool.query(
      "insert into public.credential_cycles select * from jsonb_populate_record(null::public.credential_cycles,$1::jsonb)",
      [JSON.stringify(cycle)],
    );
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your renewal dashboard." }),
  ).toBeVisible();
});
test("Q07 Q08 viewer reads fresh pages; revoked and anonymous requests lose detail authority", async ({
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
  const response = await page.goto("/practice/dashboard");
  expect(response!.headers()["cache-control"]).toContain("no-store");
  await counts(page, 0, 0, 0);
  await page.goto(`/practice/register/${record.id}?from=dashboard`);
  await expect(
    page.getByRole("link", { name: "View in register" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to dashboard" }).click();
  const before = await snapshot(m.practice_id);
  await pool.query(
    "update public.practice_memberships set state='revoked',revoked_at=clock_timestamp(),version=version+1 where id=$1",
    [m.id],
  );
  await page.goto(`/practice/register/${record.id}?from=dashboard`);
  await expect(page).toHaveURL(/onboarding\/practice/);
  await page.goto("/practice/dashboard");
  await expect(page).toHaveURL(/onboarding\/practice/);
  expect(await snapshot(m.practice_id)).toEqual(before);
  await page.getByRole("button", { name: "Sign out" }).click();
  for (const path of [
    "/practice/dashboard",
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
