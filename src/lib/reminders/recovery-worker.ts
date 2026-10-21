import "server-only";
import { z } from "zod";
import type { EmailConfig } from "./config";
import { emailPayloadSchema, type EmailSubmission } from "./messages";
import { parseDeliveryResource } from "./recovery";
import type { DeliveryObservation } from "./recovery";

export type RecoveryOutcome = {
  kind: "accepted" | "rate-limited" | "permanent" | "uncertain";
  providerId: string | null;
  errorCode: string | null;
  retryAfterSeconds: number | null;
};
export type RecoveryWorkerServices = {
  sendingEnabled: boolean;
  provider(config: EmailConfig): {
    sendRecovery(submission: EmailSubmission): Promise<RecoveryOutcome>;
    retrieve(id: string): Promise<unknown>;
  };
  claim(namespace: string, sendingEnabled: boolean): Promise<unknown>;
  begin(
    jobId: string,
    token: string,
    config: {
      namespace: string;
      from: string;
      replyTo: string;
      appUrl: string;
    },
    kind: "fresh" | "retry",
  ): Promise<unknown>;
  record(
    submissionId: string,
    token: string,
    outcome: RecoveryOutcome,
  ): Promise<unknown>;
  recordCheck(
    checkId: string,
    token: string,
    observation: DeliveryObservation & { matched: boolean },
  ): Promise<unknown>;
  now?(): number;
  wallNow?(): number;
};
const timestamp = z.iso.datetime({ offset: true });
const claimSchema = z.union([
  z.strictObject({ status: z.literal("idle") }),
  z.strictObject({
    kind: z.enum(["fresh", "retry"]),
    jobId: z.uuid(),
    token: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal("check"),
    attemptId: z.uuid(),
    checkId: z.uuid(),
    token: z.uuid(),
    providerId: z.uuid(),
    from: z.email().max(254),
    to: z.email().max(254),
    deadline: timestamp,
  }),
]);
const permissionSchema = z
  .strictObject({
    status: z.literal("submit"),
    attemptId: z.uuid(),
    token: z.uuid(),
    payload: emailPayloadSchema,
    key: z.string().max(80),
    submissionId: z.uuid(),
    ordinal: z.number().int().min(1).max(3),
    deadline: timestamp,
    expiresAt: timestamp,
  })
  .refine(
    (value) =>
      value.key === `reminder-email/${value.attemptId}` &&
      value.payload.tags[0].value === value.attemptId,
  );
const skippedSchema = z.strictObject({
  status: z.enum(["stale", "busy", "unavailable", "consumed", "window-closed"]),
});
const recordedSchema = z.strictObject({ status: z.literal("recorded") });
const outcomeSchema = z
  .strictObject({
    kind: z.enum(["accepted", "rate-limited", "permanent", "uncertain"]),
    providerId: z.uuid().nullable(),
    errorCode: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .nullable(),
    retryAfterSeconds: z.number().int().positive().max(2147483647).nullable(),
  })
  .refine((value) => {
    if (value.kind === "accepted")
      return (
        value.providerId !== null &&
        value.errorCode === null &&
        value.retryAfterSeconds === null
      );
    if (value.kind === "rate-limited")
      return (
        value.providerId === null && value.errorCode === "rate_limit_exceeded"
      );
    return value.retryAfterSeconds === null;
  });
function uncertain(errorCode: string): RecoveryOutcome {
  return {
    kind: "uncertain",
    providerId: null,
    errorCode,
    retryAfterSeconds: null,
  };
}
type Counts = {
  submitted: number;
  accepted: number;
  failed: number;
  uncertain: number;
  checked: number;
};
type Provider = ReturnType<RecoveryWorkerServices["provider"]>;
type Check = Extract<z.infer<typeof claimSchema>, { kind: "check" }>;
type Send = Extract<z.infer<typeof claimSchema>, { kind: "fresh" | "retry" }>;
function remember(seen: Set<string>, id: string) {
  if (seen.has(id)) throw new Error("Repeated recovery reservation");
  seen.add(id);
}
async function observe(provider: Provider, claim: Check) {
  try {
    const observation = parseDeliveryResource(
      await provider.retrieve(claim.providerId),
      {
        providerId: claim.providerId,
        attemptId: claim.attemptId,
        from: claim.from,
        to: claim.to,
      },
    );
    return observation
      ? { ...observation, matched: true }
      : { status: null, bounced: false, matched: false };
  } catch {
    return { status: null, bounced: false, matched: false };
  }
}
async function send(
  provider: Provider,
  permission: z.infer<typeof permissionSchema>,
) {
  try {
    const submission: EmailSubmission = {
      status: permission.status,
      attemptId: permission.attemptId,
      token: permission.token,
      payload: permission.payload,
      key: permission.key,
    };
    const parsed = outcomeSchema.safeParse(
      await provider.sendRecovery(submission),
    );
    return parsed.success ? parsed.data : uncertain("invalid-response");
  } catch {
    return uncertain("provider-unavailable");
  }
}
function interruptedPermission(
  permission: z.infer<typeof permissionSchema>,
  config: EmailConfig,
  remaining: number,
  absoluteNow: number,
) {
  return (
    remaining < 21000 ||
    Date.parse(permission.deadline) - absoluteNow < 15000 ||
    Date.parse(permission.expiresAt) - absoluteNow < 15000 ||
    permission.payload.from !== config.from ||
    permission.payload.reply_to !== config.replyTo
  );
}
async function submit(
  services: RecoveryWorkerServices,
  provider: Provider,
  config: EmailConfig,
  claim: Send,
  counts: Counts,
  deadline: number,
  now: () => number,
  wallNow: () => number,
  seen: Set<string>,
) {
  const raw = await services.begin(
    claim.jobId,
    claim.token,
    {
      namespace: config.namespace,
      from: config.from,
      replyTo: config.replyTo,
      appUrl: config.appUrl,
    },
    claim.kind,
  );
  if (skippedSchema.safeParse(raw).success) return;
  const permission = permissionSchema.parse(raw);
  remember(seen, permission.submissionId);
  if (
    (claim.kind === "fresh" && permission.ordinal !== 1) ||
    (claim.kind === "retry" && permission.ordinal < 2)
  )
    throw new Error("Invalid recovery reservation ordinal");
  const interrupted = interruptedPermission(
    permission,
    config,
    deadline - now(),
    wallNow(),
  );
  const outcome = interrupted
    ? uncertain("interrupted")
    : await send(provider, permission);
  if (!interrupted) counts.submitted++;
  if (outcome.kind === "accepted") counts.accepted++;
  else if (outcome.kind === "uncertain") counts.uncertain++;
  else counts.failed++;
  recordedSchema.parse(
    await services.record(permission.submissionId, permission.token, outcome),
  );
}
function clocks(services: RecoveryWorkerServices, deadline?: number) {
  const now = services.now ?? (() => performance.now());
  return {
    now,
    wallNow: services.wallNow ?? (() => Date.now()),
    end: deadline ?? now() + 45000,
  };
}
function recoverySettings(
  config: EmailConfig | null,
  maxSlots: number | undefined,
) {
  const limit = z
    .number()
    .int()
    .min(0)
    .max(4)
    .parse(maxSlots ?? 4);
  return config && limit > 0 ? { config, limit } : null;
}
export async function dispatchRecovery(
  services: RecoveryWorkerServices,
  rawConfig: EmailConfig | null,
  deadline?: number,
  maxSlots?: number,
) {
  const counts: Counts = {
    submitted: 0,
    accepted: 0,
    failed: 0,
    uncertain: 0,
    checked: 0,
  };
  const settings = recoverySettings(rawConfig, maxSlots);
  if (!settings) return counts;
  const { config, limit } = settings;
  const { now, wallNow, end } = clocks(services, deadline);
  const provider = services.provider(config);
  const submissions = new Set<string>(),
    checks = new Set<string>();
  // Bound scans as well as network operations, including locked/skipped work.
  for (let slot = 0; slot < limit && end - now() >= 31000; slot++) {
    const claim = claimSchema.parse(
      await services.claim(config.namespace, services.sendingEnabled),
    );
    if ("status" in claim) break;
    if (claim.kind === "check") {
      remember(checks, claim.checkId);
      if (end - now() < 16000 || Date.parse(claim.deadline) - wallNow() < 15000)
        break;
      const observation = await observe(provider, claim);
      counts.checked++;
      recordedSchema.parse(
        await services.recordCheck(claim.checkId, claim.token, observation),
      );
    } else {
      if (!services.sendingEnabled) continue;
      if (end - now() < 26000) break;
      await submit(
        services,
        provider,
        config,
        claim,
        counts,
        end,
        now,
        wallNow,
        submissions,
      );
    }
  }
  return counts;
}
