import { test, expect, pool } from "../helpers/private-browser";
import { setup, signIn } from "../helpers/browser";
import { account } from "../helpers/local-fixtures";
import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
test.use({ trace: "off", screenshot: "off", video: "off" });
async function open(page: import("@playwright/test").Page) {
  await setup(page);
  await page.getByRole("link", { name: "Renewal register" }).click();
  return (
    await pool.query(
      "select * from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0];
}
async function addPerson(page: import("@playwright/test").Page, name: string) {
  await page.getByLabel("Clinician name").fill(name);
  await page.getByRole("button", { name: "Add clinician" }).click();
  await expect(
    page.getByText("Clinician saved.", { exact: true }),
  ).toBeFocused();
}
async function counts(practice: string) {
  const out: Record<string, unknown> = {};
  for (const table of [
    "public.clinicians",
    "public.credentials",
    "public.credential_cycles",
    "public.policy_coverage",
    "private.register_audit_events",
    "private.register_create_requests",
  ])
    out[table] = (
      await pool.query(
        `select * from ${table} where practice_id=$1 order by ${table.endsWith("coverage") ? "credential_id,clinician_id" : "id"}`,
        [practice],
      )
    ).rows;
  return out;
}
test("G22 creates multiple records, shared policy once, reload sign-in and keyboard mobile access", async ({
  page,
}) => {
  const member = await open(page);
  await expect(page.getByText("No renewal records added yet.")).toBeVisible();
  await addPerson(page, "Rivera");
  await addPerson(page, "Chen");
  const clinicians = (
    await pool.query(
      "select * from public.clinicians where practice_id=$1 order by name",
      [member.practice_id],
    )
  ).rows;
  await page.getByLabel("Record title").fill("Shared policy");
  await page.getByLabel("Record type").selectOption("malpractice_policy");
  await page.getByRole("checkbox", { name: /Rivera/ }).check();
  await page.getByRole("checkbox", { name: /Chen/ }).check();
  await page.getByRole("button", { name: "Add record" }).click();
  await expect(
    page.getByText("Record saved.", {
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Shared policy", exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Saved records" })).toContainText(
    "Covers:",
  );
  for (const type of ["state_license", "dea_registration"]) {
    await page.getByLabel("Record title").fill(type);
    await page.getByLabel("Record type").selectOption(type);
    await page.getByLabel("Record owner").selectOption("clinician");
    await page.getByLabel("Owning clinician").selectOption(clinicians[0].id);
    await page.getByRole("button", { name: "Add record" }).click();
    await expect(page.getByLabel("Record title")).toHaveValue("");
  }
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Saved records" }).locator("article"),
  ).toHaveCount(3);
  await expect(
    page.getByText("Dates not entered", { exact: true }),
  ).toHaveCount(3);
  await page.setViewportSize({ width: 375, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Clinician name").focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Add clinician" }),
  ).toBeFocused();
  await page.screenshot({
    path: "reports/register-mobile.png",
    fullPage: true,
  });
  const email = (
    await pool.query("select email from auth.users where id=$1", [
      member.user_id,
    ])
  ).rows[0].email;
  await page.getByRole("button", { name: "Sign out" }).click();
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds' where email=$1",
    [email],
  );
  await signIn(page, email);
  await page.getByRole("link", { name: "Renewal register" }).click();
  await expect(
    page.getByRole("list", { name: "Saved records" }).locator("article"),
  ).toHaveCount(3);
  const response = await page.request.get("/practice/register");
  expect(response.headers()["cache-control"]).toContain("no-store");
});
test("G23 real validation, pre-commit fault, pending lock, foreign Origin and immutable retry", async ({
  page,
  context,
}) => {
  const member = await open(page);
  await page.getByLabel("Clinician name").fill(" ");
  await page.getByRole("button", { name: "Add clinician" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText(
    "Check the highlighted fields.",
  );
  await expect(page.getByLabel("Clinician name")).toHaveValue(" ");
  await expect(page.getByLabel("Clinician name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Clinician name").fill("Retry person");
  await pool.query(
    "create function private.register_ui_fault() returns trigger language plpgsql as $$begin raise exception 'fixture outage';end$$;create trigger register_ui_fault before insert on private.register_create_requests for each row execute function private.register_ui_fault()",
  );
  try {
    await page.getByRole("button", { name: "Add clinician" }).click();
    await expect(page.locator("p[role=alert]")).toHaveText(
      "We could not confirm this save. Retry this save before changing it.",
    );
    expect(
      (
        await pool.query(
          "select id from public.clinicians where practice_id=$1",
          [member.practice_id],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(page.getByLabel("Clinician name")).toBeDisabled();
  } finally {
    await pool.query(
      "drop trigger register_ui_fault on private.register_create_requests;drop function private.register_ui_fault()",
    );
  }
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select 1 from public.practices where id=$1 for update", [
      member.practice_id,
    ]);
    const sent = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/practice/register"),
    );
    await page.getByRole("button", { name: "Retry this save" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(page.getByLabel("Clinician name")).toBeDisabled();
    await db.query("commit");
    const request = await sent;
    await expect(
      page.getByText("Clinician saved.", { exact: true }),
    ).toBeFocused();
    const before = await counts(member.practice_id);
    const attack = await context.request.post(request.url(), {
      headers: { ...request.headers(), origin: "https://attacker.invalid" },
      data: request.postDataBuffer()!,
    });
    expect(attack.status()).toBe(500);
    expect(await counts(member.practice_id)).toEqual(before);
  } finally {
    await db.query("rollback");
    db.release();
  }
});
test("G24 response lost after commit retries exact policy without duplicating entity links audit or receipt", async ({
  page,
}) => {
  const member = await open(page);
  await addPerson(page, "Rivera");
  await addPerson(page, "Chen");
  await page.getByLabel("Record title").fill("Retry policy");
  await page.getByLabel("Record type").selectOption("malpractice_policy");
  await page.getByLabel("Insurer (optional)").fill(" Insurer ");
  await page.getByLabel("Coverage jurisdiction (optional)").fill(" CA ");
  await page.getByLabel("Coverage end date").fill("2028-02-29");
  await page.getByLabel("Earlier action deadline").fill("2028-02-01");
  await page.getByRole("checkbox", { name: /Rivera/ }).check();
  await page.getByRole("checkbox", { name: /Chen/ }).check();
  const requests: { body: string; contentType: string }[] = [];
  await page.route("**/practice/register", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({
      body: route.request().postData()!,
      contentType: route.request().headers()["content-type"],
    });
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Add record" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText(
    "We could not confirm this save. Retry this save before changing it.",
  );
  await expect(page.getByLabel("Record title")).toHaveValue("Retry policy");
  const before = await counts(member.practice_id);
  expect(before["public.credentials"] as unknown[]).toHaveLength(1);
  expect(before["public.credential_cycles"] as unknown[]).toHaveLength(1);
  expect((before["public.credentials"] as { issuer: string }[])[0].issuer).toBe(
    "Insurer",
  );
  expect(before["public.policy_coverage"] as unknown[]).toHaveLength(2);
  await page.unroute("**/practice/register");
  await page.route("**/practice/register", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push({
      body: route.request().postData()!,
      contentType: route.request().headers()["content-type"],
    });
    return route.continue();
  });
  await page.getByRole("button", { name: "Retry this save" }).click();
  await expect(
    page.getByText("Record saved.", {
      exact: true,
    }),
  ).toBeFocused();
  expect(await counts(member.practice_id)).toEqual(before);
  await expect(page.getByRole("list", { name: "Saved records" })).toContainText(
    "Tracking date: Feb 1, 2028 (earlier action deadline)",
  );
  const payload = async (request: { body: string; contentType: string }) => {
    const fields = await new Response(request.body, {
      headers: { "content-type": request.contentType },
    }).formData();
    return Array.from(fields).filter(([key]) => key.startsWith("1_"));
  };
  expect(await payload(requests[1])).toEqual(await payload(requests[0]));
  await expect(
    page.getByRole("heading", { name: "Retry policy", exact: true }),
  ).toHaveCount(1);
});
test("G25 manager creates, viewer reads, stale demotion denies and read outage is explicit", async ({
  page,
  browser,
}) => {
  const owner = await open(page),
    person = await account(),
    digest = randomBytes(32).toString("hex"),
    db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      owner.user_id,
    ]);
    await db.query(
      "select private.create_practice_invitation($1,$2,'manager',$3)",
      [owner.practice_id, person.email, digest],
    );
    await db.query("commit");
  } finally {
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
    }),
    staff = await context.newPage();
  try {
    await pool.query(
      "update auth.users set confirmation_sent_at=now()-interval '61 seconds' where email=$1",
      [person.email],
    );
    await signIn(staff, person.email);
    await expect(staff.getByRole("link", { name: "Manage team" })).toHaveCount(
      0,
    );
    await staff.getByRole("link", { name: "Renewal register" }).click();
    await addPerson(staff, "Manager clinician");
    await staff.getByLabel("Clinician name").fill("Stale draft");
    await page.goto("/practice/team");
    const row = page.locator("article").filter({
      has: page.getByRole("heading", { name: person.email, exact: true }),
    });
    await row.getByRole("combobox").selectOption("viewer");
    await row.getByRole("button", { name: "Save role" }).click();
    await expect(
      row.getByText("Viewer · active", { exact: true }),
    ).toBeVisible();
    await staff.getByRole("button", { name: "Add clinician" }).click();
    await expect(staff.locator("p[role=alert]")).toHaveText(
      "You do not have permission to add register records.",
    );
    await expect(staff.getByLabel("Clinician name")).toHaveValue("Stale draft");
    await staff.reload();
    await expect(staff.getByText(/read-only/)).toBeVisible();
    await expect(
      staff.getByRole("button", { name: "Add clinician" }),
    ).toHaveCount(0);
    await expect(
      staff.getByRole("list", { name: "Saved clinicians" }),
    ).toContainText("Manager clinician");
    await page.reload();
    await row.getByRole("combobox").selectOption("manager");
    await row.getByRole("button", { name: "Save role" }).click();
    await expect(
      row.getByText("Office manager · active", { exact: true }),
    ).toBeVisible();
    await staff.reload();
    await staff.getByLabel("Clinician name").fill("Revoked draft");
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Revoke access" }).click();
    await expect(
      row.getByText("Office manager · revoked", { exact: true }),
    ).toBeVisible();
    await staff.getByRole("button", { name: "Add clinician" }).click();
    await expect(staff.locator("p[role=alert]")).toHaveText(
      "You do not have permission to add register records.",
    );
    await expect(staff.getByLabel("Clinician name")).toHaveValue(
      "Revoked draft",
    );
    await staff.reload();
    await expect(staff).toHaveURL(/onboarding\/practice/);
    const replacement = randomBytes(32).toString("hex"),
      rejoin = await pool.connect();
    try {
      await rejoin.query("begin");
      await rejoin.query("select set_config('request.jwt.claim.sub',$1,true)", [
        owner.user_id,
      ]);
      await rejoin.query(
        "select private.create_practice_invitation($1,$2,'viewer',$3)",
        [owner.practice_id, person.email, replacement],
      );
      await rejoin.query("commit");
    } finally {
      await rejoin.query("rollback");
      rejoin.release();
    }
    expect(
      (
        await person.client.rpc("accept_practice_invitation", {
          p_token_digest: replacement,
        })
      ).data.status,
    ).toBe("success");
    await staff.goto("/practice/register");
    await expect(staff.getByText(/read-only/)).toBeVisible();
    const original = (
      await pool.query(
        "select pg_get_functiondef('private.list_practice_register_with_maintenance(uuid,boolean)'::regprocedure) body",
      )
    ).rows[0].body;
    await pool.query(
      "create or replace function private.list_practice_register_with_maintenance(p_practice_id uuid,p_include_archived boolean) returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'fixture outage';end$$",
    );
    try {
      await staff.reload();
      await expect(staff.locator("p[role=alert]")).toHaveText(
        "We could not complete this request. Try again.",
      );
      await expect(
        staff.getByText("No renewal records added yet."),
      ).toHaveCount(0);
    } finally {
      await pool.query(original);
    }
    await staff.reload();
    await expect(staff.getByText(/read-only/)).toBeVisible();
  } finally {
    await context.close();
  }
});
