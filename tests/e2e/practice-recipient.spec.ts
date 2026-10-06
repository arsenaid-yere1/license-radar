import { test, expect, pool } from "../helpers/private-browser";
import { setup, signIn } from "../helpers/browser";
import { account } from "../helpers/local-fixtures";
import { createHash, randomBytes } from "node:crypto";
function capability() {
  const token = randomBytes(32).toString("base64url");
  return { digest: createHash("sha256").update(token).digest("hex") };
}
import AxeBuilder from "@axe-core/playwright";
test.use({ trace: "off", screenshot: "off", video: "off" });
test("R21 recipient assignment replacement conflict clear persistence and accessibility", async ({
  page,
  context,
}) => {
  await setup(page);
  const id = (
    await pool.query(
      "select id,user_id,practice_id from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0];
  const email = (
    await pool.query("select email from auth.users where id=$1", [id.user_id])
  ).rows[0].email;
  const select = page.getByLabel("Proposed reminder recipient");
  await expect(select).toBeVisible();
  await select.selectOption(id.id);
  await page.getByRole("button", { name: "Save recipient" }).click();
  await expect(
    page.getByText("Reminder recipient saved. SMS setup is still pending.", {
      exact: true,
    }),
  ).toBeFocused();
  await page.reload();
  await expect(
    page.locator("p").filter({ hasText: "Current recipient:" }),
  ).toContainText(email);
  const stale = await context.newPage();
  await stale.goto("/practice");
  const person = await account(),
    link = capability();
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      id.user_id,
    ]);
    await db.query(
      "select private.create_practice_invitation($1,$2,'manager',$3)",
      [id.practice_id, person.email, link.digest],
    );
    await db.query("commit");
  } finally {
    db.release();
  }
  expect(
    (
      await person.client.rpc("accept_practice_invitation", {
        p_token_digest: link.digest,
      })
    ).data.status,
  ).toBe("success");
  const member = (
    await pool.query(
      "select id from public.practice_memberships where user_id=$1",
      [person.user.id],
    )
  ).rows[0];
  await page.reload();
  await select.selectOption(member.id);
  await page.getByRole("button", { name: "Save recipient" }).click();
  await expect(
    page.locator("p").filter({ hasText: "Current recipient:" }),
  ).toContainText(person.email);
  await stale.getByLabel("Proposed reminder recipient").selectOption(id.id);
  await stale.getByRole("button", { name: "Save recipient" }).click();
  await expect(stale.locator("p[role=alert]")).toContainText(
    "Reload before saving",
  );
  await expect(stale.getByLabel("Proposed reminder recipient")).toHaveValue(
    id.id,
  );
  await expect(
    stale.getByRole("button", { name: "Save recipient" }),
  ).toBeDisabled();
  await stale.close();
  await page.setViewportSize({ width: 375, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "reports/recipient-mobile.png",
    fullPage: true,
  });
  await select.selectOption("");
  await select.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Clear recipient" }),
  ).toBeFocused();
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Enter");
  await expect(
    page.locator("p").filter({ hasText: "Current recipient:" }),
  ).toContainText(person.email);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Clear recipient" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Reminder recipient cleared. No recipient is selected.", {
      exact: true,
    }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Sign out" }).click();
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds' where email=$1",
    [email],
  );
  await signIn(page, email);
  await expect(
    page.locator("p").filter({ hasText: "Current recipient:" }),
  ).toContainText("No reminder recipient selected");
});
test("R22 manager edits recipient while viewer reads and demotion clears assignment", async ({
  page,
  browser,
}) => {
  await setup(page);
  const member = (
      await pool.query(
        "select * from public.practice_memberships order by created_at desc limit 1",
      )
    ).rows[0],
    person = await account(),
    link = capability();
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      member.user_id,
    ]);
    await db.query(
      "select private.create_practice_invitation($1,$2,'manager',$3)",
      [member.practice_id, person.email, link.digest],
    );
    await db.query("commit");
  } finally {
    db.release();
  }
  await person.client.rpc("accept_practice_invitation", {
    p_token_digest: link.digest,
  });
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
    await expect(staff.getByLabel("Practice name")).toHaveCount(0);
    const target = (
      await pool.query(
        "select id from public.practice_memberships where user_id=$1",
        [person.user.id],
      )
    ).rows[0];
    await staff
      .getByLabel("Proposed reminder recipient")
      .selectOption(target.id);
    await staff.getByRole("button", { name: "Save recipient" }).click();
    await expect(
      staff.locator("p").filter({ hasText: "Current recipient:" }),
    ).toContainText(person.email);
    await page.goto("/practice/team");
    const row = page.locator("article").filter({
      has: page.getByRole("heading", { name: person.email, exact: true }),
    });
    await expect(row.getByText(/will clear the assignment/)).toBeVisible();
    await row.getByRole("combobox").selectOption("viewer");
    await row.getByRole("button", { name: "Save role" }).click();
    await expect(
      row.getByText("Viewer · active", { exact: true }),
    ).toBeVisible();
    await staff.reload();
    await expect(
      staff.locator("p").filter({ hasText: "Current recipient:" }),
    ).toContainText("No reminder recipient selected");
    await expect(staff.getByLabel("Proposed reminder recipient")).toHaveCount(
      0,
    );
    const response = await staff.request.get("/practice");
    expect(response.headers()["cache-control"]).toContain("no-store");
    await row.getByRole("combobox").selectOption("manager");
    await row.getByRole("button", { name: "Save role" }).click();
    await expect(
      row.getByText("Office manager · active", { exact: true }),
    ).toBeVisible();
    await staff.reload();
    await expect(
      staff.locator("p").filter({ hasText: "Current recipient:" }),
    ).toContainText("No reminder recipient selected");
    await staff
      .getByLabel("Proposed reminder recipient")
      .selectOption(target.id);
    await staff.getByRole("button", { name: "Save recipient" }).click();
    await expect(staff.getByRole("status")).toContainText(
      "Reminder recipient saved",
    );
    await page.reload();
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Revoke access" }).click();
    await expect(
      row.getByText("Office manager · revoked", { exact: true }),
    ).toBeVisible();
    await staff.reload();
    await expect(staff).toHaveURL(/onboarding\/practice/);
    const replacement = capability(),
      rejoinDb = await pool.connect();
    try {
      await rejoinDb.query("begin");
      await rejoinDb.query(
        "select set_config('request.jwt.claim.sub',$1,true)",
        [member.user_id],
      );
      await rejoinDb.query(
        "select private.create_practice_invitation($1,$2,'manager',$3)",
        [member.practice_id, person.email, replacement.digest],
      );
      await rejoinDb.query("commit");
    } finally {
      await rejoinDb.query("rollback");
      rejoinDb.release();
    }
    expect(
      (
        await person.client.rpc("accept_practice_invitation", {
          p_token_digest: replacement.digest,
        })
      ).data.status,
    ).toBe("success");
    await staff.goto("/practice");
    await expect(
      staff.locator("p").filter({ hasText: "Current recipient:" }),
    ).toContainText("No reminder recipient selected");
  } finally {
    await context.close();
  }
});
test("R23 recipient outage retains input, pending blocks repeats, and foreign Origin cannot write", async ({
  page,
  context,
}) => {
  await setup(page);
  const member = (
    await pool.query(
      "select * from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0];
  await page.getByLabel("Proposed reminder recipient").selectOption(member.id);
  await pool.query(
    "create function private.recipient_ui_fault() returns trigger language plpgsql as $$begin raise exception 'fixture outage'; end$$; create trigger recipient_ui_fault before update on private.practice_reminder_settings for each row execute function private.recipient_ui_fault()",
  );
  try {
    await page.getByRole("button", { name: "Save recipient" }).click();
    await expect(page.locator("p[role=alert]")).toHaveText(
      "We could not complete this request. Try again.",
    );
    await expect(page.getByLabel("Proposed reminder recipient")).toHaveValue(
      member.id,
    );
  } finally {
    await pool.query(
      "drop trigger recipient_ui_fault on private.practice_reminder_settings; drop function private.recipient_ui_fault()",
    );
  }
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select 1 from public.practices where id=$1 for update", [
      member.practice_id,
    ]);
    const request = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/practice"),
    );
    await page.getByRole("button", { name: "Save recipient" }).click();
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(page.getByLabel("Proposed reminder recipient")).toBeDisabled();
    await db.query("commit");
    const sent = await request;
    await expect(page.getByRole("status")).toHaveText(
      "Reminder recipient saved. SMS setup is still pending.",
    );
    const before = (
      await pool.query(
        "select * from private.practice_reminder_settings where practice_id=$1",
        [member.practice_id],
      )
    ).rows;
    const replay = await context.request.post(sent.url(), {
      headers: { ...sent.headers(), origin: "https://attacker.invalid" },
      data: sent.postDataBuffer()!,
    });
    expect(replay.status()).toBe(500);
    expect(
      (
        await pool.query(
          "select * from private.practice_reminder_settings where practice_id=$1",
          [member.practice_id],
        )
      ).rows,
    ).toEqual(before);
  } finally {
    await db.query("rollback");
    db.release();
  }
});

test("R24 candidate invalidated after picker load rejects safely without losing selection", async ({
  page,
}) => {
  await setup(page);
  const owner = (
      await pool.query(
        "select * from public.practice_memberships order by created_at desc limit 1",
      )
    ).rows[0],
    person = await account(),
    link = capability(),
    db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      owner.user_id,
    ]);
    await db.query(
      "select private.create_practice_invitation($1,$2,'manager',$3)",
      [owner.practice_id, person.email, link.digest],
    );
    await db.query("commit");
    await person.client.rpc("accept_practice_invitation", {
      p_token_digest: link.digest,
    });
    const member = (
      await pool.query(
        "select id from public.practice_memberships where user_id=$1",
        [person.user.id],
      )
    ).rows[0];
    await page.reload();
    await page
      .getByLabel("Proposed reminder recipient")
      .selectOption(member.id);
    await db.query("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      owner.user_id,
    ]);
    await db.query(
      "select private.change_practice_member_role($1,1,'viewer')",
      [member.id],
    );
    await db.query("commit");
    await page.getByRole("button", { name: "Save recipient" }).click();
    await expect(page.locator("p[role=alert]")).toHaveText(
      "This person is no longer eligible. Reload and choose another recipient.",
    );
    await expect(page.getByLabel("Proposed reminder recipient")).toHaveValue(
      member.id,
    );
    await expect(
      page.getByRole("button", { name: "Save recipient" }),
    ).toBeDisabled();
    await page.getByRole("link", { name: "Reload recipient" }).click();
    await expect(
      page.getByLabel("Proposed reminder recipient").locator("option"),
    ).toHaveCount(2);
    await expect(
      page.locator("p").filter({ hasText: "Current recipient:" }),
    ).toContainText("No reminder recipient selected");
  } finally {
    await db.query("rollback");
    db.release();
  }
});
test("R25 lost response after commit requires reload and preserves the proposed recipient", async ({
  page,
}) => {
  await setup(page);
  const member = (
    await pool.query(
      "select * from public.practice_memberships order by created_at desc limit 1",
    )
  ).rows[0];
  await page.getByLabel("Proposed reminder recipient").selectOption(member.id);
  await page.route("**/practice", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Save recipient" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText(
    "We could not confirm this save. Reload before saving again.",
  );
  await expect(page.getByLabel("Proposed reminder recipient")).toHaveValue(
    member.id,
  );
  await expect(
    page.getByRole("button", { name: "Save recipient" }),
  ).toBeDisabled();
  expect(
    (
      await pool.query(
        "select membership_id,version from private.practice_reminder_settings where practice_id=$1",
        [member.practice_id],
      )
    ).rows,
  ).toEqual([{ membership_id: member.id, version: 2 }]);
  await page.unroute("**/practice");
  await page.getByRole("link", { name: "Reload recipient" }).click();
  await expect(
    page.getByRole("button", { name: "Save recipient" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Proposed reminder recipient")).toHaveValue(
    member.id,
  );
});
