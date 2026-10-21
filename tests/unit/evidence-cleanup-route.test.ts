// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const b = vi.hoisted(() => ({
  claimCleanup: vi.fn(),
  purgeObject: vi.fn(),
  recordCleanup: vi.fn(),
}));
vi.mock("@/lib/evidence/storage", () => b);
import { POST } from "@/app/api/renewal-evidence/cleanup/route";
const secret = "local-fixture-only-cleanup-secret-1234";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("EVIDENCE_CLEANUP_SECRET", secret);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-fixture-only-service");
  vi.stubEnv("RENEWAL_EVIDENCE_ENABLED", "false");
  b.claimCleanup.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
const request = (authorization?: string) =>
  new Request("http://app.test/cleanup", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
it("EV07 EV10 cleanup requires the independent secret even when user evidence is off", async () => {
  for (const auth of [
    undefined,
    "Bearer wrong",
    "Bearer " + "é".repeat(secret.length),
  ])
    expect((await POST(request(auth))).status).toBe(401);
  expect(b.claimCleanup).not.toHaveBeenCalled();
  const response = await POST(request(`Bearer ${secret}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    success: true,
    removed: 0,
    pending: 0,
  });
});
it("EV07 configuration and failed cleanup never report success", async () => {
  vi.stubEnv("EVIDENCE_CLEANUP_SECRET", "short");
  expect((await POST(request())).status).toBe(503);
  vi.stubEnv("EVIDENCE_CLEANUP_SECRET", secret);
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-fixture-only-service");
  b.claimCleanup.mockResolvedValue(null);
  expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
  b.claimCleanup.mockRejectedValue(new Error("unavailable"));
  expect((await POST(request(`Bearer ${secret}`))).status).toBe(503);
});
