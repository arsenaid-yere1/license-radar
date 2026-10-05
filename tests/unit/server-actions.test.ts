import { it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const boundary = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => boundary);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { loginAction, signOutAction } from "@/app/login/actions";
import {
  createPracticeAction,
  updatePracticeAction,
} from "@/app/practice/actions";
function client({
  user = { id: "owner" },
  authError = null,
  authResult = { error: null },
  rows = [
    {
      data: { id: "own", name: "Cedar", timezone: "UTC", version: 1 },
      error: null,
    },
  ],
}: {
  user?: unknown;
  authError?: unknown;
  authResult?: unknown;
  rows?: unknown[];
} = {}) {
  const single = vi.fn();
  for (const row of rows) single.mockResolvedValueOnce(row);
  const chain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle: single,
  };
  for (const fn of [chain.select, chain.insert, chain.update, chain.eq])
    fn.mockReturnValue(chain);
  const c = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: authError }),
      signInWithOtp: vi.fn().mockResolvedValue(authResult),
      verifyOtp: vi.fn().mockResolvedValue(authResult),
      signOut: vi.fn().mockResolvedValue(authResult),
    },
    from: vi.fn().mockReturnValue(chain),
    rpc: vi.fn().mockImplementation(() => single()),
  };
  boundary.createClient.mockResolvedValue(c);
  return c as unknown as SupabaseClient;
}
function form(input: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(input)) f.set(k, v);
  return f;
}
const idle = { status: "idle" };
const profile = { name: " Cedar ", timezone: "UTC" };
beforeEach(() => vi.resetAllMocks());
it("S02 S03 action trims email, requests code and redirects only after verification", async () => {
  const c = client();
  expect(
    await loginAction(
      idle,
      form({ email: " fixture@example.test ", intent: "request" }),
    ),
  ).toEqual({
    status: "sent",
    email: "fixture@example.test",
    message: "Check your email for a six-digit code.",
  });
  expect(c.auth.signInWithOtp).toHaveBeenCalledWith({
    email: "fixture@example.test",
  });
  await expect(
    loginAction(
      idle,
      form({
        email: "fixture@example.test",
        token: "123456",
        intent: "verify",
      }),
    ),
  ).rejects.toThrow("REDIRECT:/");
  expect(c.auth.verifyOtp).toHaveBeenCalledWith({
    email: "fixture@example.test",
    token: "123456",
    type: "email",
  });
});
it("S04 malformed request and verification return safe messages", async () => {
  client();
  expect((await loginAction(idle, form({ email: "bad" }))).message).toBe(
    "Enter a valid email address.",
  );
  expect(
    (
      await loginAction(
        { status: "sent", email: "fixture@example.test" },
        form({ token: "bad", intent: "verify" }),
      )
    ).message,
  ).toBe("That code is invalid or expired. Request a new code and try again.");
  expect((await loginAction(idle, form({}))).message).toBe(
    "Enter a valid email address.",
  );
});
it("S05 rate-limited resend retains email and useful retry", async () => {
  client({ authResult: { error: { code: "over_email_send_rate_limit" } } });
  expect(
    await loginAction(idle, form({ email: "fixture@example.test" })),
  ).toMatchObject({
    email: "fixture@example.test",
    message: "Please wait 60 seconds before requesting another code.",
  });
});
it("S24 auth provider failure and client setup failure stay safe", async () => {
  client({ authResult: { error: { code: "unexpected" } } });
  expect(
    (await loginAction(idle, form({ email: "fixture@example.test" }))).message,
  ).toBe("We could not complete this request. Try again.");
  boundary.createClient.mockRejectedValue(new Error("private"));
  expect(
    await loginAction(idle, form({ email: "fixture@example.test" })),
  ).toEqual({
    status: "unavailable",
    email: "fixture@example.test",
    message: "We could not complete this request. Try again.",
  });
  expect(await createPracticeAction(idle, form(profile))).toEqual({
    status: "unavailable",
    message: "We could not complete this request. Try again.",
  });
});
it("S06 signout success redirects, error cannot claim signout", async () => {
  client();
  await expect(signOutAction()).rejects.toThrow("REDIRECT:/login");
  client({ authResult: { error: { code: "outage" } } });
  await expect(signOutAction()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
});
it("S08 create redirects and ignores framework action metadata", async () => {
  const c = client();
  await expect(
    createPracticeAction(
      idle,
      form({ ...profile, $ACTION_ID_fixture: "framework" }),
    ),
  ).rejects.toThrow("REDIRECT:/practice");
  expect(c.rpc).toHaveBeenCalledWith("create_practice", {
    p_name: "Cedar",
    p_timezone: "UTC",
  });
});
it("S12 action rejects forged identity and malformed version strings", async () => {
  client();
  expect(
    await createPracticeAction(idle, form({ ...profile, role: "admin" })),
  ).toMatchObject({
    status: "invalid",
    message: "Check the highlighted fields.",
  });
  for (const expectedVersion of [
    "",
    "-1",
    "1.5",
    "01",
    "Infinity",
    "9007199254740992",
  ]) {
    client();
    expect(
      await updatePracticeAction(idle, form({ ...profile, expectedVersion })),
    ).toMatchObject({
      status: "invalid",
      errors: { expectedVersion: "Reload the settings and try again." },
    });
  }
});
it("S21 version parsed without exposing client identity", async () => {
  client({
    rows: [
      { data: { id: "own", version: 1 }, error: null },
      { data: { id: "own", version: 2 }, error: null },
    ],
  });
  expect(
    await updatePracticeAction(
      idle,
      form({ ...profile, expectedVersion: "1" }),
    ),
  ).toMatchObject({
    status: "success",
    practice: { id: "own", version: 2 },
    message: "Practice settings saved.",
  });
});
it("S22 conflict and S24 unavailable have distinct safe messages", async () => {
  client({ rows: [{ data: null, error: null }] });
  expect(
    await updatePracticeAction(
      idle,
      form({ ...profile, expectedVersion: "1" }),
    ),
  ).toEqual({
    status: "conflict",
    message: "These settings changed. Reload before saving.",
  });
  client({ rows: [{ data: null, error: { code: "network" } }] });
  expect(
    await updatePracticeAction(
      idle,
      form({ ...profile, expectedVersion: "1" }),
    ),
  ).toEqual({
    status: "unavailable",
    message: "We could not complete this request. Try again.",
  });
});
it("S26 missing user redirects without persistence", async () => {
  const c = client({ user: null });
  await expect(
    updatePracticeAction(idle, form({ ...profile, expectedVersion: "1" })),
  ).rejects.toThrow("REDIRECT:/login");
  expect(c.from).not.toHaveBeenCalled();
});

it("S03 code whitespace is normalized before verified API call", async () => {
  const c = client();
  await expect(
    loginAction(
      idle,
      form({
        email: "fixture@example.test",
        token: " 123456 ",
        intent: "verify",
      }),
    ),
  ).rejects.toThrow("REDIRECT:/");
  expect(c.auth.verifyOtp).toHaveBeenCalledWith({
    email: "fixture@example.test",
    token: "123456",
    type: "email",
  });
});
it("S04 absent email stays empty and invalid verification keeps code entry available", async () => {
  client();
  expect(await loginAction(idle, form({}))).toMatchObject({
    email: "",
    message: "Enter a valid email address.",
  });
  expect(
    await loginAction(
      { status: "sent", email: "fixture@example.test" },
      form({ intent: "verify" }),
    ),
  ).toMatchObject({
    status: "sent",
    email: "fixture@example.test",
    message:
      "That code is invalid or expired. Request a new code and try again.",
  });
});
it("S12 multi-digit versions are accepted and decimal strings are rejected", async () => {
  client({
    rows: [
      { data: { id: "own", version: 12 }, error: null },
      { data: { id: "own", version: 13 }, error: null },
    ],
  });
  expect(
    await updatePracticeAction(
      idle,
      form({ ...profile, expectedVersion: "12" }),
    ),
  ).toMatchObject({ status: "success", practice: { version: 13 } });
  client();
  expect(
    await updatePracticeAction(
      idle,
      form({ ...profile, expectedVersion: "1.0" }),
    ),
  ).toMatchObject({
    status: "invalid",
    errors: { expectedVersion: "Reload the settings and try again." },
  });
});
it("S46 invitation OTP returns only to the allowlisted join route", async () => {
  client();
  await expect(
    loginAction(
      idle,
      form({
        email: "fixture@example.test",
        token: "123456",
        intent: "verify",
        destination: "/join",
      }),
    ),
  ).rejects.toThrow("REDIRECT:/join");
  for (const destination of [
    "https://evil.test",
    "//evil.test",
    "/%2f%2fevil.test",
    "/join?token=secret",
  ]) {
    client();
    await expect(
      loginAction(
        idle,
        form({
          email: "fixture@example.test",
          token: "123456",
          intent: "verify",
          destination,
        }),
      ),
    ).rejects.toThrow("REDIRECT:/");
  }
});
it("A04 arbitrary and absent OTP return destinations use exactly the home route", async () => {
  for (const destination of [
    undefined,
    "https://evil.test",
    "//evil.test",
    "/join?next=evil",
  ]) {
    client();
    await expect(
      loginAction(
        idle,
        form({
          email: "fixture@example.test",
          token: "123456",
          intent: "verify",
          ...(destination === undefined ? {} : { destination }),
        }),
      ),
    ).rejects.toThrow(/^REDIRECT:\/$/);
  }
});
it("S33 revoked or demoted settings action reports permission denial", async () => {
  client({
    rows: [
      { data: { id: "own", version: 1 }, error: null },
      { data: null, error: { code: "42501" } },
    ],
  });
  expect(
    await updatePracticeAction(
      idle,
      form({ ...profile, expectedVersion: "1" }),
    ),
  ).toEqual({
    status: "forbidden",
    message: "You do not have permission to do that.",
  });
});
