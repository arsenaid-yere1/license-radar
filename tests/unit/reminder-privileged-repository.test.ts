import { afterEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({
  create: vi.fn(),
  rpc: vi.fn(),
  abort: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: boundary.create }));
import * as repository from "@/lib/sms/privileged-repository";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
it("PR01 every named email operation binds its inputs and installs a five-second RPC deadline", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "fixture-only-credential");
  boundary.create.mockReturnValue({ rpc: boundary.rpc });
  boundary.rpc.mockReturnValue({ abortSignal: boundary.abort });
  boundary.abort.mockResolvedValue({
    data: { status: "recorded" },
    error: null,
  });
  const config = {
    namespace: "fixture",
    from: "reminders@example.test",
    replyTo: "support@example.test",
    appUrl: "http://127.0.0.1:3000",
  };
  const outcome = {
    outcome: "accepted" as const,
    providerId: "provider",
    error: null,
  };
  const cases = [
    [
      () => repository.drainReminderAccounts(),
      "drain_email_reminder_accounts",
      {},
    ],
    [
      () => repository.reconcileReminderJobs("fixture"),
      "reconcile_email_reminders",
      { p_namespace: "fixture" },
    ],
    [() => repository.claimReminderJob(), "claim_email_reminder", {}],
    [
      () => repository.beginReminderSubmission("job", "token", config),
      "begin_email_reminder",
      { p_job_id: "job", p_claim_token: "token", p_config: config },
    ],
    [
      () => repository.recordReminderSubmission("attempt", "token", outcome),
      "record_email_reminder",
      {
        p_attempt_id: "attempt",
        p_token: "token",
        p_outcome: "accepted",
        p_provider_id: "provider",
        p_error: null,
      },
    ],
    [
      () => repository.expireReminderSubmissions(),
      "expire_email_submissions",
      {},
    ],
    [
      () => repository.findReminderBinding("fixture", "provider", null),
      "email_reminder_binding",
      { p_namespace: "fixture", p_provider_id: "provider", p_attempt_id: null },
    ],
    [
      () =>
        repository.applyReminderEvent(
          "fixture",
          "event",
          "provider",
          "attempt",
          "delivered",
          "from",
          "to",
        ),
      "apply_email_reminder_event",
      {
        p_namespace: "fixture",
        p_event_id: "event",
        p_provider_id: "provider",
        p_attempt_id: "attempt",
        p_status: "delivered",
        p_from: "from",
        p_to: "to",
      },
    ],
    [() => repository.startReminderRun(), "start_email_reminder_run", {}],
    [
      () => repository.finishReminderRun("run", true, { submitted: 1 }),
      "finish_email_reminder_run",
      { p_run_id: "run", p_success: true, p_counts: { submitted: 1 } },
    ],
  ] as const;
  const timer = vi.spyOn(AbortSignal, "timeout");
  try {
    expect(repository.reminderStorageConfigured()).toBe(true);
    for (const [call, name, args] of cases) {
      expect(await call()).toEqual({ status: "recorded" });
      expect(boundary.rpc).toHaveBeenLastCalledWith(name, args);
      expect(boundary.abort).toHaveBeenLastCalledWith(expect.any(AbortSignal));
      expect(timer).toHaveBeenLastCalledWith(5000);
    }
    expect(timer).toHaveBeenCalledTimes(10);
    boundary.abort.mockResolvedValue({
      data: null,
      error: { message: "private" },
    });
    expect(await repository.claimReminderJob()).toBeNull();
    boundary.abort.mockRejectedValue(new Error("private"));
    expect(await repository.claimReminderJob()).toBeNull();
  } finally {
    timer.mockRestore();
  }
});
it("PR02 missing storage never constructs a privileged client", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  expect(repository.reminderStorageConfigured()).toBe(false);
  expect(await repository.claimReminderJob()).toBeNull();
  expect(boundary.create).not.toHaveBeenCalled();
});
