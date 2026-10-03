import { test, expect } from "../helpers/coverage";
import { signIn, setup } from "../helpers/browser";
import { fixtureEmail, pool } from "../helpers/local-fixtures";
import { deliveredCode, mailCount } from "../helpers/local-mail";
import AxeBuilder from "@axe-core/playwright";
test("S01 S02 S03 S04 S05 real OTP, invalid code and resend recovery", async ({
  page,
}) => {
  await page.goto("/practice");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/onboarding/practice");
  await expect(page).toHaveURL(/\/login$/);
  const email = fixtureEmail();
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  expect(await mailCount(email)).toBe(1);
  await page.getByLabel("Six-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("status")).toContainText("invalid or expired");
  await page.getByRole("button", { name: "Send a new code" }).click();
  await expect(page.getByRole("status")).toContainText("wait 60 seconds");
  expect(await mailCount(email)).toBe(1);
  await page.waitForTimeout(61000);
  await page
    .getByRole("button", { name: /Send sign-in code|Send a new code/ })
    .click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  expect(await mailCount(email)).toBe(2);
  await page.getByLabel("Six-digit code").fill(await deliveredCode(email));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(/onboarding\/practice/);
});
test("S08 S09 S10 S13 S14 S15 S16 S21 mobile keyboard create refresh edit signout and return", async ({
  page,
  browser,
}) => {
  const { email } = await signIn(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await page
    .getByLabel("Practice timezone")
    .selectOption("America/Los_Angeles");
  await page.getByLabel("Practice name").fill("  ");
  await page.getByRole("button", { name: "Create practice" }).click();
  await expect(page.getByText("Enter a practice name.")).toBeVisible();
  await expect(page.getByRole("status")).toBeFocused();
  await expect(page.getByLabel("Practice timezone")).toHaveValue(
    "America/Los_Angeles",
  );
  await page.getByLabel("Practice name").fill("😀".repeat(121));
  await page.getByRole("button", { name: "Create practice" }).click();
  await expect(page.getByText("Use 120 characters or fewer.")).toBeVisible();
  await page.getByLabel("Practice name").fill("  Cedar Clinic  ");
  await page.getByLabel("Practice name").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Practice timezone")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("http://127.0.0.1:3000/practice");
  await expect(
    page.getByRole("heading", { name: "Cedar Clinic", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Practice name")).toHaveValue("Cedar Clinic");
  await page.getByLabel("Practice name").fill("Cedar Medical");
  await page.getByLabel("Practice timezone").selectOption("America/New_York");
  await expect(page.getByText(/Example only/)).toContainText(
    "October 3, 2026 at 09:00 (America/New_York)",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Practice settings saved.");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Cedar Medical", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "reports/practice-mobile.png",
    fullPage: true,
  });
  const id = (
    await pool.query(
      "select id from public.practices where owner_user_id=(select id from auth.users where email=$1)",
      [email],
    )
  ).rows[0].id;
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/practice");
  await expect(page).toHaveURL(/\/login$/);
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds', recovery_sent_at=now()-interval '61 seconds' where email=$1",
    [email],
  );
  await signIn(page, email);
  await expect(page.getByLabel("Practice name")).toHaveValue("Cedar Medical");
  expect(
    (
      await pool.query(
        "select id from public.practices where owner_user_id=(select id from auth.users where email=$1)",
        [email],
      )
    ).rows[0].id,
  ).toBe(id);
  const savedSession = await page.context().storageState();
  const reopened = await browser.newContext({ storageState: savedSession });
  const reopenedPage = await reopened.newPage();
  await reopenedPage.goto("http://127.0.0.1:3000/practice");
  await expect(reopenedPage.getByLabel("Practice name")).toHaveValue(
    "Cedar Medical",
  );
  await expect(reopenedPage.getByLabel("Practice timezone")).toHaveValue(
    "America/New_York",
  );
  await reopened.close();
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto("http://127.0.0.1:3000/practice");
  await expect(freshPage).toHaveURL(/\/login$/);
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds', recovery_sent_at=now()-interval '61 seconds' where email=$1",
    [email],
  );
  await signIn(freshPage, email);
  await expect(freshPage.getByLabel("Practice name")).toHaveValue(
    "Cedar Medical",
  );
  expect(
    (
      await pool.query(
        "select id from public.practices where owner_user_id=(select id from auth.users where email=$1)",
        [email],
      )
    ).rows[0].id,
  ).toBe(id);
  await fresh.close();
});
test("A01 markup names render as text with desktop accessibility", async ({
  page,
}) => {
  await setup(page, "<img src=x onerror=alert(1)>");
  await expect(
    page.getByRole("heading", {
      name: "<img src=x onerror=alert(1)>",
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.locator("img").count()).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "reports/practice-desktop.png",
    fullPage: true,
  });
});
