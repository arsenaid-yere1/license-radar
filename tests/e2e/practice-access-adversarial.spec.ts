import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  test,
  expect,
  createdLink,
  openInvitation,
  joinSignIn,
  pool,
} from "../helpers/private-browser";
import { setup } from "../helpers/browser";
import { fixtureEmail } from "../helpers/local-fixtures";
import { assertArtifact } from "../../tools/gauntlet-contract.mjs";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("A04 markup invitation preview is text and foreign-Origin action cannot write", async ({
  page,
  context,
}) => {
  const markup = "<img src=x onerror=alert(1)>";
  await setup(page, markup);
  await page.getByLabel("Practice name").fill("Authorized clinic");
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/practice"),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  const request = await sent;
  await expect(page.getByRole("status")).toHaveText("Practice settings saved.");
  const response = await context.request.post(request.url(), {
    headers: { ...request.headers(), origin: "https://attacker.invalid" },
    data: request.postDataBuffer()!,
  });
  expect(response.status()).toBe(500);
  await page.reload();
  await expect(page.getByLabel("Practice name")).toHaveValue(
    "Authorized clinic",
  );
  await page.getByLabel("Practice name").fill(markup);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Practice settings saved.");
  await page.getByRole("link", { name: "Manage team" }).click();
  await expect(page.getByLabel("Staff email")).toBeVisible();
  await page.getByLabel("Staff email").fill("evil<script>@example.test");
  await page.getByRole("button", { name: "Create invitation link" }).click();
  await expect(
    page.getByText("Check the highlighted fields.", { exact: true }),
  ).toBeVisible();
  const email = fixtureEmail();
  await page.getByLabel("Staff email").fill(email);
  await page.getByRole("button", { name: "Create invitation link" }).click();
  const link = await createdLink(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await openInvitation(page, link);
  await joinSignIn(page, email);
  await page.getByRole("button", { name: "Review invitation" }).click();
  await expect(
    page.getByRole("heading", { name: markup, exact: true }),
  ).toBeVisible();
  expect(await page.locator("img").count()).toBe(0);
  expect(
    (
      await pool.query(
        "select count(*)::int n from public.practice_memberships where user_id=(select id from auth.users where email=$1)",
        [email],
      )
    ).rows[0].n,
  ).toBe(0);
});

test("A05 fragment token stays out of request URLs referrers and retained text artifacts", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "Manage team" }).click();
  await expect(page.getByLabel("Staff email")).toBeVisible();
  const email = fixtureEmail();
  await page.getByLabel("Staff email").fill(email);
  await page.getByRole("button", { name: "Create invitation link" }).click();
  const link = await createdLink(page),
    token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  const observed: { url: string; referrer: string }[] = [];
  page.on("request", (request) =>
    observed.push({
      url: request.url(),
      referrer: request.headers().referer ?? "",
    }),
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await openInvitation(page, link);
  await joinSignIn(page, email);
  await page.getByRole("button", { name: "Review invitation" }).click();
  expect(observed.length).toBeGreaterThan(0);
  expect(
    observed.every(
      (r) => !r.url.includes(token) && !r.referrer.includes(token),
    ),
  ).toBe(true);
  const current = await page.evaluate(() => ({
    hash: location.hash,
    referrer: document.referrer,
  }));
  expect(current.hash).toBe("");
  expect(current.referrer.includes(token)).toBe(false);
  let checked = 0;
  function inspect(dir: string) {
    for (const name of readdirSync(dir)) {
      const path = `${dir}/${name}`;
      if (statSync(path).isDirectory()) inspect(path);
      else if (/\.(json|log|txt|html|md)$/.test(name)) {
        assertArtifact(readFileSync(path, "utf8"), [token]);
        checked++;
      }
    }
  }
  inspect("reports");
  expect(checked).toBeGreaterThan(0);
});
