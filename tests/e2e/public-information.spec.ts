import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../helpers/coverage";

test("GM10 anonymous visitors can review Gmail information and privacy with accessible responsive navigation", async ({
  page,
}) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/about");
    await expect(
      page.getByRole("heading", { name: "License Radar", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "License Radar does not request permission to read your inbox.",
        { exact: false },
      ),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id),
    ).toEqual([]);
    await page.screenshot({
      path: `reports/gmail-about-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Privacy", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("http://127.0.0.1:3000/privacy");
    await expect(
      page.getByRole("heading", { name: "Privacy", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "arsen.yere1@gmail.com", exact: true }),
    ).toHaveAttribute("href", "mailto:arsen.yere1@gmail.com");
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/gmail-privacy-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Privacy", exact: true }),
    ).toHaveAttribute("href", "/privacy");
  }
});
