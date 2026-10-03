import { test, expect } from "../helpers/coverage";
import { setup, signIn } from "../helpers/browser";
import { deliveredCode } from "../helpers/local-mail";
import { pool } from "../helpers/local-fixtures";
test("S24 interrupted Data API retains inputs and retry succeeds", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Practice name").fill("Saved Clinic");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Practice settings saved.");
  await expect(page.locator('input[name="expectedVersion"]')).toHaveValue("2");
  await page.getByLabel("Practice name").fill("   ");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Check the highlighted fields.",
  );
  await expect(page.locator('input[name="expectedVersion"]')).toHaveValue("2");
  await page.getByLabel("Practice name").fill("Valid Clinic");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Practice settings saved.");
  await expect(page.locator('input[name="expectedVersion"]')).toHaveValue("3");
  await page.getByLabel("Practice name").fill("Retry Clinic");
  await pool.query(
    "revoke update(name,timezone) on public.practices from authenticated",
  );
  try {
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "We could not complete this request. Try again.",
    );
    await expect(page.getByLabel("Practice name")).toHaveValue("Retry Clinic");
    await expect(page.locator('input[name="expectedVersion"]')).toHaveValue(
      "3",
    );
  } finally {
    await pool.query(
      "grant update(name,timezone) on public.practices to authenticated",
    );
  }
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Practice settings saved.");
  await expect(page.locator('input[name="expectedVersion"]')).toHaveValue("4");
  await page.reload();
  await expect(page.getByLabel("Practice name")).toHaveValue("Retry Clinic");
});
test("S26 expires between open/save requires fresh authentication", async ({
  page,
  context,
}) => {
  const { email } = await signIn(page);
  await page.getByLabel("Practice name").fill("Cedar Clinic");
  await page.getByRole("button", { name: "Create practice" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3000/practice");
  const before = (
    await pool.query(
      "select * from public.practices where owner_user_id=(select id from auth.users where email=$1)",
      [email],
    )
  ).rows[0];
  await context.clearCookies();
  await page.getByLabel("Practice name").fill("Expired edit");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    (
      await pool.query("select * from public.practices where id=$1", [
        before.id,
      ])
    ).rows[0],
  ).toEqual(before);
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds' where email=$1",
    [email],
  );
  await signIn(page, email);
  await page.getByLabel("Practice name").fill("Recovered edit");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Practice settings saved.");
  expect(
    (
      await pool.query(
        "select name,version from public.practices where id=$1",
        [before.id],
      )
    ).rows[0],
  ).toEqual({ name: "Recovered edit", version: before.version + 1 });
});
test("S04 expired and reused OTP never create a session", async ({ page }) => {
  const { email, code } = await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Work email").fill(email);
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds' where email=$1",
    [email],
  );
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("status")).toContainText("invalid or expired");
  const currentCode = await deliveredCode(email);
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '11 minutes', recovery_sent_at=now()-interval '11 minutes' where email=$1",
    [email],
  );
  await page.getByLabel("Six-digit code").fill(currentCode);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("status")).toContainText("invalid or expired");
});
