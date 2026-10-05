import {
  test,
  expect,
  createdLink,
  pool,
  openInvitation,
  joinSignIn,
} from "../helpers/private-browser";
import { setup } from "../helpers/browser";
import { account, fixtureEmail } from "../helpers/local-fixtures";
import AxeBuilder from "@axe-core/playwright";
test.use({ trace: "off", screenshot: "off", video: "off" });
test("S09 S11 S13 S15 S48 invitation validation, duplicate and reissue recovery", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "Manage team" }).click();
  await expect(page.getByLabel("Staff email")).toBeVisible();
  await page.getByLabel("Staff email").fill("bad");
  await page.getByRole("button", { name: "Create invitation link" }).click();
  await expect(
    page.getByText("Check the highlighted fields.", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Staff email")).toHaveValue("bad");
  const email = fixtureEmail();
  await page.getByLabel("Staff email").fill(email);
  await page.getByRole("button", { name: "Create invitation link" }).click();
  const old = await createdLink(page);
  await expect(
    page.getByRole("heading", { name: email, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create invitation link" }).click();
  await expect(
    page.getByText(
      "A pending invitation already exists for this email. Cancel or reissue it.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Invitation link")).toHaveCount(0);
  await page.getByRole("button", { name: "Reissue link" }).click();
  const next = await createdLink(page);
  expect(next === old).toBe(false);
  await page.setViewportSize({ width: 375, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "reports/team-mobile.png",
    fullPage: true,
    mask: [page.getByLabel("Invitation link")],
  });
  await page.getByRole("button", { name: "Cancel invitation" }).click();
  await expect(
    page.getByText("Invitation canceled.", { exact: true }),
  ).toBeVisible();
});
test("S39 stale administrator settings retain edits after demotion and team route uses live role", async ({
  page,
  browser,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "Manage team" }).click();
  await expect(page.getByLabel("Staff email")).toBeVisible();
  const b = await account();
  await page.getByLabel("Staff email").fill(b.email);
  await page.getByLabel("Invitation role").selectOption("administrator");
  await page.getByRole("button", { name: "Create invitation link" }).click();
  const link = await createdLink(page),
    context = await browser.newContext({ baseURL: "http://127.0.0.1:3000" }),
    staff = await context.newPage();
  try {
    await openInvitation(staff, link);
    await joinSignIn(staff, b.email);
    await staff.getByRole("button", { name: "Review invitation" }).click();
    await staff.getByRole("button", { name: "Accept invitation" }).click();
    await expect(staff.getByLabel("Practice name")).toBeVisible();
    await staff.getByLabel("Practice name").fill("Unsaved staff edit");
    await page.reload();
    const row = page.locator("article").filter({
      has: page.getByRole("heading", { name: b.email, exact: true }),
    });
    page.on("dialog", (dialog) => dialog.accept());
    await row.getByRole("combobox").selectOption("manager");
    await row.getByRole("button", { name: "Save role" }).click();
    await expect(
      row.getByText("Office manager · active", { exact: true }),
    ).toBeVisible();
    await staff.getByRole("button", { name: "Save changes" }).click();
    await expect(
      staff.getByText("You do not have permission to do that.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(staff.getByLabel("Practice name")).toHaveValue(
      "Unsaved staff edit",
    );
    expect((await b.client.from("practices").select("name")).data).toEqual([
      { name: "Cedar Clinic" },
    ]);
    await staff.goto("/practice/team");
    await expect(staff).toHaveURL("http://127.0.0.1:3000/practice");
    await expect(
      staff.getByRole("button", { name: "Save changes" }),
    ).toHaveCount(0);
    await expect(
      staff.getByText("Office manager", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test("S34 S35 S38 administrator role controls prevent final-admin loss and revoke existing session", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "Manage team" }).click();
  await expect(page.getByLabel("Staff email")).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(
    page.getByText("Add another administrator before removing this access.", {
      exact: true,
    }),
  ).toBeVisible();
  const b = await account();
  await page.getByLabel("Staff email").fill(b.email);
  await page.getByRole("button", { name: "Create invitation link" }).click();
  const link = await createdLink(page);
  const raw = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(raw).digest("hex");
  expect(
    (
      await b.client.rpc("accept_practice_invitation", {
        p_token_digest: digest,
      })
    ).data.status,
  ).toBe("success");
  await page.reload();
  const row = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: b.email, exact: true }) });
  await row.getByRole("combobox").selectOption("viewer");
  await row.getByRole("button", { name: "Save role" }).click();
  await expect(row.getByText("Viewer · active", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Revoke access" }).click();
  await expect(
    page.getByText("Viewer · revoked", { exact: true }),
  ).toBeVisible();
  expect((await b.client.from("practices").select("*")).data).toEqual([]);
  expect(
    (
      await pool.query(
        "select state from public.practice_memberships where user_id=$1",
        [b.user.id],
      )
    ).rows[0].state,
  ).toBe("revoked");
});
