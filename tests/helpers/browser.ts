import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { deliveredCode } from "./local-mail";
import { fixtureEmail } from "./local-fixtures";
export async function signIn(page: Page, email = fixtureEmail()) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  const code = await deliveredCode(email);
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page).toHaveURL(/onboarding\/practice|\/practice$/);
  return { email, code };
}
export async function setup(page: Page, name = "Cedar Clinic") {
  await signIn(page);
  await page.getByLabel("Practice name").fill(name);
  await page
    .getByLabel("Practice timezone")
    .selectOption("America/Los_Angeles");
  await page.getByRole("button", { name: "Create practice" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3000/practice");
}
