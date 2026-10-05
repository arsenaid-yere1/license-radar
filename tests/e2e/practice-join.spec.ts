import {
  test,
  expect,
  createdLink,
  openInvitation,
  joinSignIn,
  pool,
} from "../helpers/private-browser";
import { setup } from "../helpers/browser";
import { fixtureEmail, account } from "../helpers/local-fixtures";
import AxeBuilder from "@axe-core/playwright";
test.use({ trace: "off", screenshot: "off", video: "off" });
async function createLink(page: Parameters<typeof setup>[0], email: string) {
  await page.getByRole("link", { name: "Manage team" }).click();
  await expect(page.getByLabel("Staff email")).toBeVisible();
  await page.getByLabel("Staff email").fill(email);
  await page.getByRole("button", { name: "Create invitation link" }).click();
  await expect(
    page.getByText("Invitation link created.", { exact: true }),
  ).toBeVisible();
  return createdLink(page);
}
test("S18 S44 S47 new account retains same-tab context through OTP and explicitly joins as manager", async ({
  page,
}) => {
  await setup(page, "Cedar Clinic");
  const email = fixtureEmail(),
    link = await createLink(page, email);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await openInvitation(page, link);
  await page.reload();
  await joinSignIn(page, email);
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.practice_memberships where user_id=(select id from auth.users where email=$1)",
        [email],
      )
    ).rows[0].n,
  ).toBe(0);
  await page.getByRole("button", { name: "Review invitation" }).click();
  await expect(
    page.getByRole("heading", { name: "Cedar Clinic", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Office manager", { exact: true })).toBeVisible();
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.practice_memberships where user_id=(select id from auth.users where email=$1)",
        [email],
      )
    ).rows[0].n,
  ).toBe(0);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(/\/practice$/);
  expect(
    await page.evaluate(
      () => sessionStorage.getItem("practice-invitation") === null,
    ),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "Manage team" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Office manager", { exact: true })).toBeVisible();
  await page.goto("/onboarding/practice");
  await expect(page).toHaveURL(/\/practice$/);
});
test("S19 S45 wrong account denied then sign-out clears context and reopened link joins existing account", async ({
  page,
}) => {
  await setup(page);
  const b = await account(),
    c = await account(),
    link = await createLink(page, b.email);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await openInvitation(page, link);
  await joinSignIn(page, c.email);
  await page.getByRole("button", { name: "Review invitation" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "This invitation is unavailable. Ask an administrator for a new link.",
  );
  await expect(
    page.getByRole("heading", { name: "Cedar Clinic", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(
      () => sessionStorage.getItem("practice-invitation") === null,
    ),
  ).toBe(true);
  await openInvitation(page, link);
  await joinSignIn(page, b.email);
  await page.getByRole("button", { name: "Review invitation" }).click();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(/\/practice$/);
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.practice_memberships where user_id=$1",
        [b.user.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
test("S46 S48 GET does not consume and mobile keyboard join has private headers and accessibility", async ({
  page,
}) => {
  await setup(page);
  const email = fixtureEmail(),
    link = await createLink(page, email);
  await page.screenshot({
    path: "reports/team-desktop.png",
    fullPage: true,
    mask: [page.getByLabel("Invitation link")],
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await openInvitation(page, link);
  const response = await page.reload();
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await joinSignIn(page, email);
  await page.getByRole("button", { name: "Review invitation" }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Accept invitation" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/practice$/);
  await page.screenshot({ path: "reports/join-mobile.png", fullPage: true });
});
test("S44 another tab requires reopening the invitation", async ({
  page,
  context,
}) => {
  await setup(page);
  const email = fixtureEmail(),
    link = await createLink(page, email);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await openInvitation(page, link);
  await joinSignIn(page, email);
  const other = await context.newPage();
  await other.goto("/join");
  await expect(
    other.getByText(
      "This invitation is unavailable. Ask an administrator for a new link.",
    ),
  ).toBeVisible();
  await other.close();
});
