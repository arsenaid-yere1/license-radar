import { test, expect } from "../helpers/coverage";
import { setup } from "../helpers/browser";
test("S07 S17 A01 separate contexts and forged cookies expose no profile", async ({
  page,
  browser,
}) => {
  await setup(page, "Private Cedar");
  const other = await browser.newContext();
  const p = await other.newPage();
  await p.goto("http://127.0.0.1:3000/practice");
  await expect(p).toHaveURL(/\/login$/);
  await other.addCookies([
    {
      name: "sb-127-auth-token",
      value: "base64-forged-victim",
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await p.goto("http://127.0.0.1:3000/practice");
  await expect(p).toHaveURL(/\/login$/);
  await setup(p, "Other Clinic");
  await expect(p.getByLabel("Practice name")).toHaveValue("Other Clinic");
  await page.reload();
  await expect(page.getByLabel("Practice name")).toHaveValue("Private Cedar");
  const response = await page.goto("/onboarding/practice");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page).toHaveURL("http://127.0.0.1:3000/practice");
  await other.close();
});
test("S22 two tabs retain losing edit and offer reload", async ({
  page,
  context,
}) => {
  await setup(page);
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:3000/practice");
  await page.getByLabel("Practice name").fill("Winner");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Practice settings saved.");
  await other.getByLabel("Practice name").fill("Unsaved loser");
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(other.getByRole("status")).toHaveText(
    "These settings changed. Reload before saving.",
  );
  await expect(other.getByLabel("Practice name")).toHaveValue("Unsaved loser");
  await other.getByRole("link", { name: "Reload current settings" }).click();
  await expect(other.getByLabel("Practice name")).toHaveValue("Winner");
  await other.close();
});

test("S07 real expired cookie refresh retains the verified owner", async ({
  page,
  context,
}) => {
  await setup(page, "Refresh Clinic");
  const cookies = await context.cookies();
  const chunks = cookies
    .filter((c) => /^sb-.*-auth-token(?:\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!chunks.length) throw new Error("No fixture auth cookie");
  const base = chunks[0].name.replace(/\.\d+$/, "");
  const session = JSON.parse(
    Buffer.from(
      chunks
        .map((c) => c.value)
        .join("")
        .slice(7),
      "base64url",
    ).toString(),
  );
  const parts = session.access_token.split(".");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  payload.exp = Math.floor(Date.now() / 1000) - 60;
  parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
  session.access_token = parts.join(".");
  session.expires_at = payload.exp;
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const replacements = [];
  for (let offset = 0; offset < encoded.length; offset += 3000)
    replacements.push({
      ...chunks[0],
      name: `${base}.${offset / 3000}`,
      value: encoded.slice(offset, offset + 3000),
    });
  await context.clearCookies();
  await context.addCookies(replacements);
  await page.goto("/practice");
  await expect(page.getByLabel("Practice name")).toHaveValue("Refresh Clinic");
  const refreshed = (await context.cookies())
    .filter((c) => c.name === base || c.name.startsWith(base + "."))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fresh = JSON.parse(
    Buffer.from(
      refreshed
        .map((c) => c.value)
        .join("")
        .slice(7),
      "base64url",
    ).toString(),
  );
  expect(fresh.access_token).not.toBe(session.access_token);
  expect(
    JSON.parse(
      Buffer.from(fresh.access_token.split(".")[1], "base64url").toString(),
    ).sub,
  ).toBe(payload.sub);
});
test("A01 foreign Origin cannot replay an authenticated server action", async ({
  page,
  context,
}) => {
  await setup(page, "Origin Clinic");
  await page.getByLabel("Practice name").fill("Authorized edit");
  const request = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/practice"),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  const sent = await request;
  await expect(page.getByRole("status")).toHaveText("Practice settings saved.");
  const replay = await context.request.post(sent.url(), {
    headers: { ...sent.headers(), origin: "https://attacker.invalid" },
    data: sent.postDataBuffer()!,
  });
  expect(replay.status()).toBe(500);
  await page.reload();
  await expect(page.getByLabel("Practice name")).toHaveValue("Authorized edit");
});
