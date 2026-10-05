import type { Page } from "@playwright/test";
import { test, expect } from "./coverage";
import { deliveredCode } from "./local-mail";
import { pool } from "./local-fixtures";
export { test, expect, pool };
// In the pinned Playwright runtime this disables automatic ARIA snapshots that
// would retain readonly invitation-link values. These files use a distinct worker
// configuration (traces/screenshots/video off), preserving S1 trace diagnostics.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
export async function openInvitation(page: Page, link: string) {
  try {
    await page.goto(link);
  } catch {
    throw new Error("Invitation navigation failed");
  }
  await expect
    .poll(() =>
      page.evaluate(
        () => location.pathname === "/join" && location.hash.length === 0,
      ),
    )
    .toBe(true);
}
export async function createdLink(page: Page) {
  const value = await page.getByLabel("Invitation link").last().inputValue();
  try {
    const url = new URL(value);
    if (
      url.pathname !== "/join" ||
      !new URLSearchParams(url.hash.slice(1)).get("token")
    )
      throw new Error();
  } catch {
    throw new Error("Created invitation link is malformed");
  }
  return value;
}
export async function joinSignIn(page: Page, email: string) {
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds',recovery_sent_at=now()-interval '61 seconds' where email=$1",
    [email],
  );
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  await page.getByLabel("Six-digit code").fill(await deliveredCode(email));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => location.pathname === "/join" && location.hash.length === 0,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Review invitation" }),
  ).toBeVisible();
}
