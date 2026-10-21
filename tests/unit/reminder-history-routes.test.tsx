import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const boundary = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  history: vi.fn(),
  timeline: vi.fn(),
  check: vi.fn(),
  create: vi.fn(),
  getUser: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: boundary.user }));
vi.mock("@/lib/practice/access", () => ({
  getPracticeAccess: boundary.access,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: boundary.create }));
vi.mock("@/lib/reminders/history", async (original) => ({
  ...(await original<typeof import("@/lib/reminders/history")>()),
  getReminderHistory: boundary.history,
  getReminderTimeline: boundary.timeline,
  getReminderHistoryV2: boundary.history,
  getReminderTimelineV2: boundary.timeline,
  requestReminderCheck: boundary.check,
}));
vi.mock("@/components/auth/sign-out-form", () => ({
  SignOutForm: () => <button>Sign out</button>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: boundary.refresh }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import HistoryPage from "@/app/practice/reminders/[credentialId]/page";
import { emailCheckAction } from "@/app/practice/reminders/[credentialId]/actions";
const practiceId = "10000000-0000-4000-8000-000000000001";
const credentialId = "10000000-0000-4000-8000-000000000002";
const attemptId = "10000000-0000-4000-8000-000000000003";
const requestId = "10000000-0000-4000-8000-000000000004";
const client = { auth: { getUser: boundary.getUser } };
const recovery = {
  disposition: "accepted",
  version: 2,
  postCount: 1,
  retryDue: null,
  retryExpires: "2030-01-02T09:00:00Z",
  checkCount: 0,
  checkDue: null,
  canCheck: true,
};
const row = {
  id: requestId,
  attemptId,
  recipient: "former",
  dueDate: "2030-03-02",
  timezone: "UTC",
  scheduleKind: "normal",
  nominalTarget: "2030-01-01T09:00:00Z",
  dispatchTarget: "2030-01-01T09:00:00Z",
  state: "accepted",
  delivery: "delivered",
  reason: null,
  startedAt: "2030-01-01T10:00:00Z",
  recovery,
};
const history = {
  status: "success",
  credential: {
    id: credentialId,
    title: "Medical license",
    archived: false,
    currentDueDate: "2030-04-01",
    currentTimezone: "America/Los_Angeles",
  },
  rows: [row],
  nextCursor: requestId,
};
function page(
  query: { after?: string; attempt?: string; event?: string } = {},
  id = credentialId,
) {
  return HistoryPage({
    params: Promise.resolve({ credentialId: id }),
    searchParams: Promise.resolve(query),
  });
}
async function resolveServerComponents(
  node: React.ReactNode,
): Promise<React.ReactNode> {
  if (Array.isArray(node))
    return React.Children.toArray(
      await Promise.all(node.map(resolveServerComponents)),
    );
  if (!React.isValidElement(node)) return node;
  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  if (
    typeof element.type === "function" &&
    element.type.constructor.name === "AsyncFunction"
  ) {
    const component = element.type as (
      props: unknown,
    ) => Promise<React.ReactNode>;
    return resolveServerComponents(await component(element.props));
  }
  return element.props.children === undefined
    ? element
    : React.cloneElement(
        element,
        {},
        await resolveServerComponents(element.props.children),
      );
}
function form() {
  const result = new FormData();
  result.set("requestId", requestId);
  result.set("attemptId", attemptId);
  result.set("expectedVersion", "2");
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.user.mockResolvedValue({ client });
  boundary.access.mockResolvedValue({
    status: "success",
    access: { practice: { id: practiceId }, role: "administrator" },
  });
  boundary.history.mockResolvedValue(history);
  boundary.timeline.mockResolvedValue({
    status: "success",
    rows: [
      {
        id: requestId,
        source: "check",
        observedAt: "2030-01-01T10:00:00Z",
        operation: "delivered",
        anomaly: false,
      },
    ],
    nextCursor: null,
  });
  boundary.create.mockResolvedValue(client);
  boundary.getUser.mockResolvedValue({
    data: { user: { id: practiceId } },
    error: null,
  });
  boundary.check.mockResolvedValue({ status: "queued" });
});
afterEach(cleanup);
it("GM07 Gmail acceptance has one submission, no delivery check or Resend recovery guidance", async () => {
  boundary.history.mockResolvedValue({
    ...history,
    rows: [
      {
        ...row,
        delivery: null,
        provider: {
          kind: "gmail",
          maxPosts: 1,
          automaticResend: false,
          deliveryChecks: false,
        },
        recovery: {
          ...recovery,
          disposition: "legacy",
          canCheck: false,
          retryExpires: null,
        },
      },
    ],
  });
  render(await page());
  expect(
    screen.getByText("Accepted by Gmail; delivery is not confirmed"),
  ).toBeTruthy();
  expect(
    screen.getByText("Automatic resend and delivery checks are unavailable."),
  ).toBeTruthy();
  expect(screen.getByText("1 of 1")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Check delivery status" }),
  ).toBeNull();
  expect(screen.queryByText("Recorded before recovery tracking")).toBeNull();
  expect(
    screen.queryByText(/This message predates recovery tracking/),
  ).toBeNull();
});
it("DR01 historical reads always bind the current practice and authorized record cursor", async () => {
  render(await page({ after: requestId }));
  expect(boundary.history).toHaveBeenCalledWith(
    client,
    practiceId,
    credentialId,
    requestId,
  );
  expect(screen.getByRole("heading", { name: "Medical license" })).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Older reminder records" })
      .getAttribute("href"),
  ).toBe(`/practice/reminders/${credentialId}?after=${requestId}`);
  expect(
    screen
      .getByRole("link", { name: "View attempt events" })
      .getAttribute("href"),
  ).toBe(`/practice/reminders/${credentialId}?attempt=${attemptId}`);
});
it("DR02 acceptance, delivery, historical recipient and frozen/current dates stay distinct", async () => {
  render(await page());
  expect(
    screen.getByText("Submission outcome").nextElementSibling?.textContent,
  ).toBe("accepted");
  expect(
    screen.getByText("Delivery evidence").nextElementSibling?.textContent,
  ).toBe("delivered");
  expect(
    screen.getByRole("heading", { name: "Former recipient" }),
  ).toBeTruthy();
  expect(screen.getByText(/Current due date: 2030-04-01/)).toBeTruthy();
  expect(screen.getByText("Frozen due date")).toBeTruthy();
  expect(screen.getByText("2030-03-02 · UTC")).toBeTruthy();
  expect(
    screen.getByText(/delivery does not mean the renewal is complete/),
  ).toBeTruthy();
});
it.each([
  [
    "retry-pending",
    "The same frozen message is waiting for a permitted retry.",
  ],
  [
    "canceled",
    "Eligibility or message details changed. This message will not be retried.",
  ],
  ["expired", "The safe retry period ended. This message will not be retried."],
  [
    "exhausted",
    "All three submission reservations were used. Contact your practice administrator for review.",
  ],
  [
    "permanent",
    "The provider rejected this submission. Contact your practice administrator to review delivery settings.",
  ],
  [
    "review-needed",
    "Acceptance could not be confirmed. Contact your practice administrator or support to review the outcome.",
  ],
  [
    "legacy",
    "This message predates recovery tracking. Its recorded outcome remains available; it will not be retried automatically.",
  ],
])(
  "DR02 %s recovery explains the available next step",
  async (disposition, guidance) => {
    boundary.history.mockResolvedValue({
      ...history,
      rows: [{ ...row, recovery: { ...recovery, disposition } }],
    });
    render(await page());
    expect(screen.getByText(guidance)).toBeTruthy();
    if (disposition === "legacy")
      expect(
        screen.getByText("Recorded before recovery tracking"),
      ).toBeTruthy();
  },
);
it.each([
  [
    "email-disabled",
    "The recipient disabled reminder emails. Review the practice reminder settings.",
  ],
  [
    "email-suppressed",
    "Email is blocked after a delivery problem. Contact your practice administrator for review.",
  ],
  [
    "already-attempted",
    "This recipient's message attempt is already consumed. Reviewing eligibility does not send it again.",
  ],
  [
    "private-unrecognized-reason",
    "Scheduling details changed. Review current record dates and practice reminder settings.",
  ],
  [
    "constructor",
    "Scheduling details changed. Review current record dates and practice reminder settings.",
  ],
])(
  "DR02 blocked history explains %s without exposing internal reasons",
  async (reason, guidance) => {
    boundary.history.mockResolvedValue({
      ...history,
      rows: [
        { ...row, state: "blocked", reason, attemptId: null, recovery: null },
      ],
    });
    render(await page());
    expect(screen.getByText(guidance)).toBeTruthy();
    expect(screen.queryByText(reason)).toBeNull();
  },
);
it("DR01 archived history omits active-detail links and remains readable for viewers", async () => {
  boundary.access.mockResolvedValue({
    status: "success",
    access: { practice: { id: practiceId }, role: "viewer" },
  });
  boundary.history.mockResolvedValue({
    ...history,
    credential: { ...history.credential, archived: true },
  });
  render(await page());
  expect(screen.getByText(/Archived record/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Open record" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Check delivery status" }),
  ).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Former recipient" }),
  ).toBeTruthy();
  expect(boundary.check).not.toHaveBeenCalled();
});
it("DR01 anonymous, revoked and absent memberships disclose no history", async () => {
  boundary.user.mockRejectedValueOnce(new Error("REDIRECT:/login"));
  await expect(page()).rejects.toThrow("REDIRECT:/login");
  expect(boundary.history).not.toHaveBeenCalled();
  boundary.access.mockResolvedValueOnce({ status: "forbidden" });
  await expect(page()).rejects.toThrow("We could not load reminder history");
  boundary.access.mockResolvedValueOnce({ status: "success", access: null });
  await expect(page()).rejects.toThrow("REDIRECT:/onboarding/practice");
  expect(boundary.history).not.toHaveBeenCalled();
});
it("DR01 missing records and malformed path/cursor show the same neutral history view", async () => {
  for (const [id, query] of [
    ["bad", {}],
    [credentialId, { after: "bad" }],
  ] as const) {
    const view = render(await page(query, id));
    expect(
      screen.getByRole("heading", { name: "Reminder history unavailable" }),
    ).toBeTruthy();
    expect(boundary.history).not.toHaveBeenCalled();
    view.unmount();
  }
  boundary.history.mockResolvedValue({ status: "not-found" });
  render(await page());
  expect(
    screen.getByText("This record is unavailable in your practice."),
  ).toBeTruthy();
});
it("DR01 failed storage cannot replace authorized history with an empty success", async () => {
  for (const status of ["forbidden", "unavailable"]) {
    boundary.history.mockResolvedValue({ status });
    await expect(page()).rejects.toThrow("We could not load reminder history");
  }
});
it("DR08 timeline cursors are opaque, scoped and malformed cursors never query storage", async () => {
  for (const query of [
    { attempt: "bad" },
    { attempt: attemptId, event: "bad-json" },
    {
      attempt: attemptId,
      event: JSON.stringify({
        id: requestId,
        source: "delivery",
        observedAt: "2030-01-01T10:00:00Z",
        providerId: requestId,
      }),
    },
  ]) {
    const view = render(await resolveServerComponents(await page(query)));
    expect(screen.getByText(/unavailable\./)).toBeTruthy();
    expect(boundary.timeline).not.toHaveBeenCalled();
    view.unmount();
  }
  const cursor = {
    id: requestId,
    source: "check",
    observedAt: "2030-01-01T10:00:00Z",
  };
  boundary.timeline.mockResolvedValue({
    ...(await boundary.timeline()),
    nextCursor: cursor,
  });
  render(
    await resolveServerComponents(
      await page({ attempt: attemptId, event: JSON.stringify(cursor) }),
    ),
  );
  expect(boundary.timeline).toHaveBeenLastCalledWith(
    client,
    practiceId,
    attemptId,
    cursor,
    credentialId,
  );
  expect(screen.getByText(/application recorded evidence/)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Earlier events" }).getAttribute("href"),
  ).toBe(
    `/practice/reminders/${credentialId}?attempt=${attemptId}&event=${encodeURIComponent(JSON.stringify(cursor))}`,
  );
});
it("DR08 unavailable timeline remains explicit without an invented delivery result", async () => {
  for (const status of ["not-found", "unavailable", "forbidden"]) {
    boundary.timeline.mockResolvedValue({ status });
    const view = render(
      await resolveServerComponents(await page({ attempt: attemptId })),
    );
    expect(
      screen.getByText("Attempt events unavailable. Reload to try again."),
    ).toBeTruthy();
    view.unmount();
  }
});
it("DR13 check actions bind live role, opaque attempt, request and expected version", async () => {
  const input = form();
  input.set("providerId", "ignored-private-override");
  input.set("destination", "ignored@example.com");
  expect(await emailCheckAction({ status: "idle" }, input)).toEqual({
    status: "queued",
  });
  expect(boundary.check).toHaveBeenCalledWith(client, practiceId, {
    attemptId,
    requestId,
    expectedVersion: 2,
  });
  for (const access of [
    null,
    { practice: { id: practiceId }, role: "viewer" },
  ]) {
    boundary.check.mockClear();
    boundary.access.mockResolvedValueOnce({ status: "success", access });
    expect(await emailCheckAction({ status: "idle" }, form())).toEqual({
      status: "forbidden",
    });
    expect(boundary.check).not.toHaveBeenCalled();
  }
});
it("DR13 malformed, duplicate and uploaded check identities fail before auth/storage", async () => {
  const duplicate = form();
  duplicate.append("requestId", requestId);
  const upload = form();
  upload.set("attemptId", new File([attemptId], "attempt.txt"));
  const invalid = form();
  invalid.set("expectedVersion", "01");
  for (const input of [new FormData(), duplicate, upload, invalid]) {
    expect(await emailCheckAction({ status: "idle" }, input)).toEqual({
      status: "invalid",
    });
    expect(boundary.create).not.toHaveBeenCalled();
    expect(boundary.check).not.toHaveBeenCalled();
  }
});
it("DR13 missing auth redirects and safe storage failures cannot queue checks", async () => {
  boundary.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  await expect(emailCheckAction({ status: "idle" }, form())).rejects.toThrow(
    "REDIRECT:/login",
  );
  expect(boundary.check).not.toHaveBeenCalled();
  boundary.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: { message: "private auth" },
  });
  expect(await emailCheckAction({ status: "idle" }, form())).toEqual({
    status: "unavailable",
  });
  boundary.access.mockResolvedValueOnce({ status: "unavailable" });
  expect(await emailCheckAction({ status: "idle" }, form())).toEqual({
    status: "unavailable",
  });
  boundary.create.mockRejectedValueOnce(new Error("private storage"));
  expect(await emailCheckAction({ status: "idle" }, form())).toEqual({
    status: "unavailable",
  });
  expect(boundary.check).not.toHaveBeenCalled();
});
