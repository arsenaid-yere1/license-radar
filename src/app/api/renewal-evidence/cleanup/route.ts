import { timingSafeEqual } from "node:crypto";
import { cleanupSecret, evidenceConfigured } from "@/lib/evidence/config";
import { cleanEvidence } from "@/lib/evidence/cleanup";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = cleanupSecret(),
    actual = request.headers.get("authorization");
  if (!secret || secret.length < 32) return new Response(null, { status: 503 });
  const expected = `Bearer ${secret}`;
  if (
    !actual ||
    Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  )
    return new Response(null, { status: 401 });
  if (!evidenceConfigured()) return new Response(null, { status: 503 });
  try {
    const result = await cleanEvidence();
    return Response.json(result, {
      status: result.success ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
