import { createClient } from "@/lib/supabase/server";
import { evidenceConfigured, evidenceEnabled } from "@/lib/evidence/config";
import { handleEvidence, type EvidenceParams } from "@/lib/evidence/operations";
import * as gateway from "@/lib/evidence/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<EvidenceParams> },
) {
  return handleEvidence(request, await params, {
    client: createClient,
    configured: () => evidenceEnabled() && evidenceConfigured(),
    ready: gateway.evidenceStorageReady,
    gateway,
  });
}
