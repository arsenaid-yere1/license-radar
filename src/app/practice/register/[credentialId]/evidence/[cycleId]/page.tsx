import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { evidenceId } from "@/lib/evidence/schema";
import { readEvidence } from "@/lib/evidence/repository";
import { evidenceConfigured, evidenceEnabled } from "@/lib/evidence/config";
import { EvidencePanel } from "@/components/evidence/panel";
import { evidenceStorageReady } from "@/lib/evidence/storage";
import { SignOutForm } from "@/components/auth/sign-out-form";
export const dynamic = "force-dynamic";
export default async function EvidencePage({
  params,
}: {
  params: Promise<{ credentialId: string; cycleId: string }>;
}) {
  const { client } = await requireUser(),
    access = await getPracticeAccess(client);
  if (access.status !== "success")
    throw new Error("We could not load evidence. Try again.");
  if (!access.access) redirect("/onboarding/practice");
  const raw = await params,
    id = evidenceId.safeParse(raw.credentialId),
    cycle = evidenceId.safeParse(raw.cycleId);
  if (!id.success || !cycle.success) notFound();
  const result = await readEvidence(
    client,
    access.access.practice.id,
    id.data,
    cycle.data,
  );
  if (result.status === "not-found") notFound();
  if (result.status !== "success")
    throw new Error("We could not load evidence. Try again.");
  return (
    <EvidencePanel
      page={result}
      canEdit={access.access.role !== "viewer"}
      configured={
        evidenceEnabled() &&
        evidenceConfigured() &&
        (await evidenceStorageReady())
      }
      timezone={access.access.practice.timezone}
      readKey={randomUUID()}
      requestId={randomUUID()}
      action={<SignOutForm />}
    />
  );
}
