import AxeBuilder from "@axe-core/playwright";
import { test, expect, pool } from "../helpers/private-browser";
import { setup, signIn } from "../helpers/browser";
import {
  fixtureCode,
  fixtureMode,
  signedOptOut,
} from "../helpers/sms-fixtures";
test.use({ trace: "off", screenshot: "off", video: "off" });
function number() {
  return `+1202${Math.floor(1000000 + Math.random() * 8999999)}`;
}
test("Enrollment survives refresh and sign-in", async ({ page, context }) => {
  const name = `SMS fixture ${crypto.randomUUID()}`;
  await setup(page, name);
  const own = (
    await pool.query(
      "select p.id,u.email from public.practices p join auth.users u on u.id=p.owner_user_id where p.name=$1",
      [name],
    )
  ).rows[0];
  await page.getByRole("link", { name: "My reminder texts" }).click();
  const phone = number();
  await page.getByLabel("International phone number").fill(phone);
  await page.getByLabel("I request a verification text to this phone.").check();
  await page.getByRole("button", { name: "Request verification code" }).click();
  await expect(page.getByLabel("Six-digit verification code")).toBeVisible();
  await page.getByLabel("Six-digit verification code").fill("000000");
  await page.getByLabel("Six-digit verification code").press("Enter");
  await expect(page.locator('.sms-panel [role="alert"]')).toContainText(
    "That code was not approved",
  );
  await expect(page.locator('.sms-panel [role="alert"]')).toBeFocused();
  expect(
    await page
      .getByLabel("Six-digit verification code")
      .evaluate((element: HTMLInputElement) => element.value.length),
  ).toBe(0);
  await page
    .getByLabel("Six-digit verification code")
    .fill(await fixtureCode(phone));
  await page.getByRole("button", { name: "Verify phone" }).click();
  await expect(
    page.getByText(
      "Phone verified. Choose separately whether to receive renewal texts.",
    ),
  ).toBeVisible();
  await expect(
    page.getByLabel("I agree to renewal reminder texts for this practice."),
  ).not.toBeChecked();
  await page
    .getByLabel("I agree to renewal reminder texts for this practice.")
    .check();
  const submission = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/practice/sms"),
  );
  await page.getByRole("button", { name: "Enroll in renewal texts" }).click();
  const sent = await submission;
  await expect(
    page.getByText(
      "Phone verified and consent recorded. Renewal texts are not active yet.",
    ),
  ).toBeVisible();
  const before = (
    await pool.query(
      "select * from private.practice_sms_enrollments where practice_id=$1",
      [own.id],
    )
  ).rows;
  const replay = await context.request.post(sent.url(), {
    headers: { ...sent.headers(), origin: "https://attacker.invalid" },
    data: sent.postDataBuffer()!,
  });
  expect(replay.status()).toBe(500);
  expect(
    (
      await pool.query(
        "select * from private.practice_sms_enrollments where practice_id=$1",
        [own.id],
      )
    ).rows,
  ).toEqual(before);
  expect(
    (await page.request.get("/practice/sms")).headers()["cache-control"],
  ).toContain("no-store");
  await page.reload();
  await expect(
    page.getByText(
      "Phone verified and consent recorded. Renewal texts are not active yet.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await pool.query(
    "update auth.users set confirmation_sent_at=now()-interval '61 seconds' where email=$1",
    [own.email],
  );
  await signIn(page, own.email);
  await page.goto("/practice/sms");
  await expect(
    page.getByText(
      "Phone verified and consent recorded. Renewal texts are not active yet.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Withdraw reminder consent" }).click();
  await expect(
    page.getByText("Reminder consent withdrawn. Renewal texts are not active."),
  ).toBeVisible();
  await page
    .getByLabel("I agree to renewal reminder texts for this practice.")
    .check();
  await page.getByRole("button", { name: "Enroll in renewal texts" }).click();
  await expect(
    page.getByText(
      "Phone verified and consent recorded. Renewal texts are not active yet.",
    ),
  ).toBeVisible();
  const callback = signedOptOut(phone);
  const response = await page.request.post("/api/sms/twilio/inbound", {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": callback.signature,
    },
    data: callback.body,
  });
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("<Response/>");
  await page.reload();
  await expect(
    page.getByText(/Same-number recovery is not available yet/),
  ).toBeVisible();
  const start = signedOptOut(phone, "START");
  expect(
    (
      await page.request.post("/api/sms/twilio/inbound", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": start.signature,
        },
        data: start.body,
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(
    page.getByText(/Same-number recovery is not available yet/),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByLabel("International phone number").fill(number());
  await page.getByLabel("I request a verification text to this phone.").check();
  await page.getByRole("button", { name: "Request verification code" }).click();
  // The actor cooldown still applies after replacing the endpoint.
  await expect(page.locator('.sms-panel [role="alert"]')).toContainText(
    "Too many verification requests",
  );
  expect(
    (
      await pool.query(
        "select verified_revision,consent_event_id from private.practice_sms_enrollments where practice_id=$1",
        [own.id],
      )
    ).rows[0],
  ).toEqual({ verified_revision: null, consent_event_id: null });
});
test("Enrollment is accessible on mobile and desktop", async ({ page }) => {
  await setup(page, `SMS accessible ${crypto.randomUUID()}`);
  await page.goto("/practice/sms");
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByLabel("International phone number").focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "SMS terms and privacy" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const permission = page.getByLabel(
      "I request a verification text to this phone.",
    );
    await expect(permission).toBeFocused();
    await page.keyboard.press("Space");
    await expect(permission).toBeChecked();
    await page.keyboard.press("Space");
    await expect(permission).not.toBeChecked();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Request verification code" }),
    ).toBeFocused();
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(violations.map((v) => v.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/sms-enrollment-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: "SMS terms and privacy" }).click();
  await expect(
    page.getByRole("heading", { name: "SMS privacy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "SMS terms", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sign out" })
    .count()
    .then(async (n) => {
      if (n) await page.getByRole("button", { name: "Sign out" }).click();
    });
  const publicResponse = await page.request.get("/sms-information");
  expect(publicResponse.status()).toBe(200);
});

test("Unknown provider acceptance never grants proof or automatically resends", async ({
  page,
}) => {
  for (const mode of ["start-lost", "check-lost", "mismatch"]) {
    const name = `SMS uncertain ${crypto.randomUUID()}`;
    await setup(page, name);
    await page.goto("/practice/sms");
    const phone = number();
    if (mode !== "check-lost") await fixtureMode(phone, mode);
    await page.getByLabel("International phone number").fill(phone);
    await page
      .getByLabel("I request a verification text to this phone.")
      .check();
    await page
      .getByRole("button", { name: "Request verification code" })
      .click();
    if (mode === "check-lost") {
      await expect(
        page.getByLabel("Six-digit verification code"),
      ).toBeVisible();
      await fixtureMode(phone, mode);
      await page
        .getByLabel("Six-digit verification code")
        .fill(await fixtureCode(phone));
      await page.getByRole("button", { name: "Verify phone" }).click();
    }
    await expect(page.locator('.sms-panel [role="alert"]')).toContainText(
      "Reload",
    );
    await expect(
      page.getByRole("button", { name: "Request verification code" }),
    ).toBeDisabled();
    await page.getByRole("link", { name: "Reload enrollment" }).click();
    await expect(
      page.getByText(
        "Verification could not be confirmed. Wait for this attempt to expire, then request a new code.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Enroll in renewal texts" }),
    ).toHaveCount(0);
    const row = (
      await pool.query(
        "select s.verified_revision,s.consent_event_id,c.state,(select count(*)::int from private.sms_verification_requests r where r.challenge_id=c.id and r.intent='send' and r.reserved_at is not null) bookings from private.practice_sms_enrollments s join public.practices p on p.id=s.practice_id join private.sms_verification_challenges c on c.practice_id=s.practice_id and c.membership_id=s.membership_id where p.name=$1",
        [name],
      )
    ).rows[0];
    expect(row).toEqual({
      verified_revision: null,
      consent_event_id: null,
      state: "uncertain",
      bookings: 1,
    });
    await fixtureMode(phone, "normal");
    await page.getByRole("button", { name: "Sign out" }).click();
  }
});

test("Callback persistence failure returns a private retryable response before suppression", async ({
  page,
}) => {
  await setup(page, `SMS callback retry ${crypto.randomUUID()}`);
  const callback = signedOptOut(number());
  await pool.query(
    "create function private.sms_ui_fault() returns trigger language plpgsql as $$begin raise exception 'fixture callback fault'; end$$; create trigger sms_ui_fault before insert on private.sms_provider_events for each row execute function private.sms_ui_fault()",
  );
  try {
    const failed = await page.request.post("/api/sms/twilio/inbound", {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": callback.signature,
      },
      data: callback.body,
    });
    expect(failed.status()).toBe(503);
    expect(await failed.text()).toBe("");
    expect(failed.headers()["cache-control"]).toContain("no-store");
    expect(
      (
        await pool.query(
          "select count(*)::int n from private.sms_provider_events where message_sid=$1",
          [new URLSearchParams(callback.body).get("MessageSid")],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await pool.query(
      "drop trigger sms_ui_fault on private.sms_provider_events; drop function private.sms_ui_fault()",
    );
  }
  const retry = await page.request.post("/api/sms/twilio/inbound", {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": callback.signature,
    },
    data: callback.body,
  });
  expect(retry.status()).toBe(200);
  expect(await retry.text()).toBe("<Response/>");
});
