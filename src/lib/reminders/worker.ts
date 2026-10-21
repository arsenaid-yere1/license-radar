import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { boundedReminderBody, reminderReply } from "./http";
import { submissionSchema } from "./messages";
import type { EmailConfig } from "./config";
import type { EmailProvider } from "./email-provider";
import type { EmailOutcome } from "./messages";
import {
  dispatchRecovery,
  type RecoveryWorkerServices,
} from "./recovery-worker";
export type DispatchConfig = Pick<
  EmailConfig,
  "namespace" | "from" | "replyTo" | "appUrl"
>;
type SendProvider = Pick<EmailProvider, "send">;
export type ReminderServices<C extends DispatchConfig = EmailConfig> = {
  heartbeat?(): Promise<unknown>;
  prepare?(config: C): Promise<SendProvider>;
  directDispatch?: boolean;
  submissionDeadline?: boolean;
  wallNow?(): number;
  recovery?: RecoveryWorkerServices;
  recoveryConfig?(): EmailConfig | null;
  secret: string | null;
  sendingEnabled: boolean;
  config(): C | null;
  storageConfigured(): boolean;
  provider?(config: C): SendProvider;
  start(): Promise<unknown>;
  expire(): Promise<unknown>;
  drain(): Promise<unknown>;
  reconcile(namespace: string): Promise<unknown>;
  claim(): Promise<unknown>;
  begin(
    jobId: string,
    token: string,
    config: {
      namespace: string;
      from: string;
      replyTo: string;
      appUrl: string;
    },
  ): Promise<unknown>;
  record(
    attemptId: string,
    token: string,
    outcome: EmailOutcome,
  ): Promise<unknown>;
  finish(
    runId: string,
    success: boolean,
    counts: Record<string, number>,
  ): Promise<unknown>;
  now?(): number;
};
const countSchema = z.number().int().min(0).max(999999);
const claimSchema = z.strictObject({ jobId: z.uuid(), token: z.uuid() });
const idleSchema = z.strictObject({ status: z.literal("idle") });
const skippedSchema = z.strictObject({
  status: z.enum(["stale", "busy", "unavailable", "consumed", "window-closed"]),
});
const recordedSchema = z.strictObject({ status: z.literal("recorded") });
function authorized(request: Request, secret: string | null) {
  if (!secret) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization) return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    actual.byteLength === expected.byteLength &&
    timingSafeEqual(actual, expected)
  );
}
async function workerBody(request: Request) {
  const body = await boundedReminderBody(request, 1024);
  if ("status" in body) return body.status;
  if (body.body === "") return null;
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return 415;
  try {
    return z.strictObject({}).safeParse(JSON.parse(body.body)).success
      ? null
      : 400;
  } catch {
    return 400;
  }
}
async function delivery(
  provider: SendProvider,
  submission: import("./messages").EmailSubmission,
): Promise<EmailOutcome> {
  try {
    return await provider.send(submission);
  } catch {
    return {
      outcome: "uncertain",
      providerId: null,
      error: "provider-unavailable",
    };
  }
}
type Counts = Record<
  | "scanned"
  | "accounts"
  | "expired"
  | "submitted"
  | "accepted"
  | "failed"
  | "uncertain",
  number
>;
function parsePermission(raw: unknown, required: boolean | undefined) {
  const bounded = required
    ? z.looseObject({ deadline: z.iso.datetime({ offset: true }) }).parse(raw)
    : null;
  const frozen = bounded
    ? Object.fromEntries(
        Object.entries(bounded).filter(([key]) => key !== "deadline"),
      )
    : raw;
  const submission = submissionSchema.parse(frozen);
  return { submission, bounded };
}
async function submitClaim<C extends DispatchConfig>(
  services: ReminderServices<C>,
  config: C,
  provider: SendProvider,
  claimed: z.infer<typeof claimSchema>,
  counts: Counts,
  deadline: number,
  now: () => number,
) {
  const rawSubmission = await services.begin(claimed.jobId, claimed.token, {
    namespace: config.namespace,
    from: config.from,
    replyTo: config.replyTo,
    appUrl: config.appUrl,
  });
  if (skippedSchema.safeParse(rawSubmission).success) return;
  // Missing replies may conceal committed permission; no retry or provider POST.
  const { submission, bounded } = parsePermission(
    rawSubmission,
    services.submissionDeadline,
  );
  const interrupted =
    deadline - now() < 21000 ||
    (bounded !== null &&
      Date.parse(bounded.deadline) - (services.wallNow?.() ?? Date.now()) <
        15000) ||
    submission.payload.from !== config.from ||
    submission.payload.reply_to !== config.replyTo;
  const outcome: EmailOutcome = interrupted
    ? { outcome: "uncertain", providerId: null, error: "interrupted" }
    : await delivery(provider, submission);
  if (!interrupted) counts.submitted++;
  counts[outcome.outcome]++;
  recordedSchema.parse(
    await services.record(submission.attemptId, submission.token, outcome),
  );
}
async function dispatch<C extends DispatchConfig>(
  services: ReminderServices<C>,
  config: C,
  counts: Counts,
  deadline: number,
  now: () => number,
  prepared: SendProvider | null,
) {
  const provider = prepared ?? services.provider?.(config);
  if (!provider) throw new Error();
  const seen = new Set<string>();
  for (let i = 0; i < 4 && deadline - now() >= 31000; i++) {
    const raw = await services.claim();
    if (idleSchema.safeParse(raw).success) break;
    const claimed = claimSchema.parse(raw);
    if (services.submissionDeadline && seen.has(claimed.jobId))
      throw new Error();
    seen.add(claimed.jobId);
    if (deadline - now() < 26000) break;
    await submitClaim(
      services,
      config,
      provider,
      claimed,
      counts,
      deadline,
      now,
    );
  }
}
async function finish<C extends DispatchConfig>(
  services: ReminderServices<C>,
  runId: string | undefined,
  success: boolean,
  counts: Counts,
) {
  if (!runId) return false;
  try {
    return (await services.finish(runId, success, counts)) === true && success;
  } catch {
    return false;
  }
}
async function preflight<C extends DispatchConfig>(
  request: Request,
  services: ReminderServices<C>,
) {
  if (request.method !== "POST") return reminderReply(405);
  if (!authorized(request, services.secret)) return reminderReply(401);
  const invalid = await workerBody(request);
  if (invalid !== null) return reminderReply(invalid);
  if (!services.storageConfigured()) return reminderReply(503);
  return null;
}
async function dispatchSelected<C extends DispatchConfig>(
  services: ReminderServices<C>,
  config: C,
  counts: Counts,
  deadline: number,
  now: () => number,
) {
  const prepared = services.prepare ? await services.prepare(config) : null;
  if (deadline - now() < 11000) return;
  counts.accounts = countSchema.parse(await services.drain());
  if (deadline - now() < 6000) return;
  counts.scanned = z
    .object({ scanned: countSchema })
    .parse(await services.reconcile(config.namespace)).scanned;
  if (!services.recovery || services.directDispatch)
    await dispatch(services, config, counts, deadline, now, prepared);
}
async function runDispatch<C extends DispatchConfig>(
  services: ReminderServices<C>,
  counts: Counts,
  deadline: number,
  now: () => number,
) {
  if (services.sendingEnabled) {
    const config = services.config();
    if (!config) throw new Error();
    await dispatchSelected(services, config, counts, deadline, now);
  }
  if (services.recovery) {
    const result = await dispatchRecovery(
      services.recovery,
      services.recoveryConfig?.() ?? null,
      deadline,
      4 - counts.submitted,
    );
    counts.submitted += result.submitted;
    counts.accepted += result.accepted;
    counts.failed += result.failed;
    counts.uncertain += result.uncertain;
  }
}
export async function handleReminderRun<C extends DispatchConfig>(
  request: Request,
  services: ReminderServices<C>,
): Promise<Response> {
  const now = services.now ?? (() => performance.now());
  const deadline = now() + 45000;
  const rejected = await preflight(request, services);
  if (rejected) return rejected;
  const counts = {
    scanned: 0,
    accounts: 0,
    expired: 0,
    submitted: 0,
    accepted: 0,
    failed: 0,
    uncertain: 0,
  };
  let runId: string | undefined;
  let success = true;
  try {
    runId = z.uuid().parse(await services.start());
    counts.expired = countSchema.parse(await services.expire());
    await runDispatch(services, counts, deadline, now);
  } catch {
    success = false;
  }
  success = await finish(services, runId, success, counts);
  if (success && services.sendingEnabled) {
    try {
      await services.heartbeat?.();
    } catch {
      // Monitoring cannot change an already committed reminder result.
    }
  }
  return reminderReply(success ? 200 : 503, {
    status: success ? "complete" : "unavailable",
    counts,
  });
}
