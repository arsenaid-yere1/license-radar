import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, pool } from "../helpers/private-browser";
import { setup } from "../helpers/browser";
test.use({ trace: "off", screenshot: "off", video: "off" });
const item = (page: Page, title = "Number fixture") =>
  page
    .getByRole("list", { name: "Saved records" })
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const editor = (page: Page) =>
  page.getByRole("region", { name: "Edit Number fixture", exact: true });
async function open(page: Page) {
  await setup(page);
  await page
    .getByRole("link", { name: "Renewal register", exact: true })
    .click();
  await page.getByLabel("Record title").fill("Number fixture");
  await page.getByLabel("License number (optional)").fill("  000Ab-12 / 陈  ");
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  await expect(page.getByText("Record saved.", { exact: true })).toBeFocused();
  return (
    await pool.query(
      "select * from public.credentials where title='Number fixture' order by created_at desc limit 1",
    )
  ).rows[0];
}
test("RN01 RN03 RN06 real number creation detail successor and archived readback at both widths", async ({
  page,
}) => {
  const c = await open(page);
  await expect(item(page)).toContainText("License number: 000Ab-12 / 陈");
  await expect(item(page)).toContainText(`App reference: ${c.id.slice(-6)}`);
  await item(page)
    .getByRole("link", { name: "Review renewal", exact: true })
    .click();
  await expect(page.getByText("License number: 000Ab-12 / 陈")).toBeVisible();
  await page.getByRole("button", { name: "Record confirmed renewal" }).click();
  await page
    .getByLabel("New expiration date", { exact: true })
    .fill("2091-03-02");
  await page
    .getByLabel("I have confirmed this renewal and its new dates.")
    .check();
  await page
    .getByRole("button", { name: "Confirm renewal and new dates" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Renewal confirmed. New dates saved.",
  );
  await page.reload();
  await expect(page.getByText("License number: 000Ab-12 / 陈")).toBeVisible();
  await page.goto("/practice/register");
  await item(page)
    .getByRole("button", { name: "Edit record", exact: true })
    .click();
  await editor(page)
    .getByLabel("License number (optional)")
    .fill("X".repeat(120));
  await editor(page).getByRole("button", { name: "Save changes" }).click();
  await expect(item(page)).toContainText(`License number: ${"X".repeat(120)}`);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/credential-numbers-${width}.png`,
      fullPage: true,
    });
  }
  await item(page)
    .getByRole("button", { name: "Archive record", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm archive" }).click();
  await expect(
    page.getByText("Record archived.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Archived records", exact: true })
    .click();
  await expect(item(page)).toContainText(`License number: ${"X".repeat(120)}`);
  expect(
    (
      await pool.query(
        "select max(cycle_number)::int n from public.credential_cycles where credential_id=$1",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(2);
});
test("RN07 RN08 type reset cancel, replacement, conflict comparison and explicit clear", async ({
  page,
  context,
}) => {
  await open(page);
  await item(page)
    .getByRole("button", { name: "Edit record", exact: true })
    .click();
  const e = editor(page);
  await e.getByLabel("Record type").selectOption("dea_registration");
  await e.getByRole("button", { name: "Keep current type" }).click();
  await expect(e.getByLabel("License number (optional)")).toHaveValue(
    "000Ab-12 / 陈",
  );
  await e.getByLabel("Record type").selectOption("dea_registration");
  await e.getByRole("button", { name: "Confirm type change" }).click();
  await expect(e.getByLabel("DEA registration number (optional)")).toHaveValue(
    "",
  );
  await e.getByLabel("DEA registration number (optional)").fill("001DEA");
  await e.getByRole("button", { name: "Save changes" }).click();
  await expect(item(page)).toContainText("DEA registration number: 001DEA");
  const second = await context.newPage();
  await second.goto("/practice/register");
  await item(second)
    .getByRole("button", { name: "Edit record", exact: true })
    .click();
  await editor(second)
    .getByLabel("DEA registration number (optional)")
    .fill("losing");
  await item(page)
    .getByRole("button", { name: "Edit record", exact: true })
    .click();
  await e.getByLabel("DEA registration number (optional)").fill("winning");
  await e.getByRole("button", { name: "Save changes" }).click();
  await expect(item(page)).toContainText("DEA registration number: winning");
  await editor(second).getByRole("button", { name: "Save changes" }).click();
  await expect(
    editor(second).getByText("DEA registration number: winning"),
  ).toBeVisible();
  await expect(
    editor(second).getByLabel("DEA registration number (optional)"),
  ).toHaveValue("losing");
  await expect(
    editor(second).getByLabel("DEA registration number (optional)"),
  ).toBeDisabled();
  await editor(second)
    .getByRole("button", { name: "Reload saved values" })
    .click();
  await expect(
    editor(second).getByLabel("DEA registration number (optional)"),
  ).toHaveValue("winning");
  await editor(second)
    .getByLabel("DEA registration number (optional)")
    .fill("");
  await editor(second).getByRole("button", { name: "Save changes" }).click();
  await expect(item(second)).toContainText(
    "DEA registration number: Not entered",
  );
  await second.reload();
  await item(second)
    .getByRole("button", { name: "Edit record", exact: true })
    .click();
  await editor(second)
    .getByLabel("Record type")
    .selectOption("malpractice_policy");
  await editor(second).getByLabel("Policy number (optional)").fill("000POL");
  await editor(second).getByRole("button", { name: "Save changes" }).click();
  await expect(item(second)).toContainText("Policy number: 000POL");
  await second.close();
});
test("RN08 lost committed number save freezes exact payload and retry leaves one mutation", async ({
  page,
}) => {
  const c = await open(page),
    requests: [string, FormDataEntryValue][][] = [];
  await item(page)
    .getByRole("button", { name: "Edit record", exact: true })
    .click();
  await editor(page).getByLabel("License number (optional)").fill("000-new");
  let drop = true;
  await page.route("**/practice/register", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const r = route.request();
    const form = await new Response(r.postData()!, {
      headers: { "content-type": r.headers()["content-type"] },
    }).formData();
    requests.push(Array.from(form).filter(([key]) => key.startsWith("1_")));
    if (drop) {
      drop = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await editor(page).getByRole("button", { name: "Save changes" }).click();
  await expect(
    editor(page).getByRole("button", { name: "Retry this save" }),
  ).toBeVisible();
  await expect(
    editor(page).getByLabel("License number (optional)"),
  ).toBeDisabled();
  await editor(page).getByRole("button", { name: "Retry this save" }).click();
  await expect(item(page)).toContainText("License number: 000-new");
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(
    (
      await pool.query(
        "select count(*)::int n from private.register_change_requests where credential_id=$1",
        [c.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
