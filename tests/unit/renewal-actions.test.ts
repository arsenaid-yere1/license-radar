import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  changeRenewal: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/renewals/operations", () => ({
  changeRenewal: mocks.changeRenewal,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { renewalAction } from "@/app/practice/register/[credentialId]/actions";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue("client");
});
function form(intent = "review") {
  const f = new FormData();
  f.set("intent", intent);
  f.set("id", id);
  f.set("requestId", id);
  return f;
}
it("RW05 RW07 server action binds record and parsed form with safe intent feedback", async () => {
  for (const [intent, message] of [
    ["link", "Renewal link saved."],
    ["progress", "Renewal progress saved."],
    ["review", "Review acknowledged."],
  ]) {
    mocks.changeRenewal.mockResolvedValue({ status: "success", changed: true });
    expect(await renewalAction(id, { status: "idle" }, form(intent))).toEqual({
      status: "success",
      changed: true,
      message,
    });
    expect(mocks.changeRenewal).toHaveBeenLastCalledWith(
      "client",
      { intent, id, requestId: id },
      id,
    );
  }
  for (const [status, message] of [
    ["invalid", "Check the highlighted fields."],
    ["forbidden", "You do not have permission to change renewal progress."],
    ["completed", "This renewal cycle is completed. Reload the record."],
  ]) {
    mocks.changeRenewal.mockResolvedValue({ status });
    expect(await renewalAction(id, { status: "idle" }, form())).toEqual({
      status,
      message,
    });
  }
});
it("RW05 auth redirects outside catches and transport errors never disclose internals", async () => {
  mocks.changeRenewal.mockResolvedValue({ status: "auth-required" });
  await expect(renewalAction(id, { status: "idle" }, form())).rejects.toThrow(
    "REDIRECT:/login",
  );
  mocks.changeRenewal.mockRejectedValue(
    new Error("private URL and SQL secret"),
  );
  expect(await renewalAction(id, { status: "idle" }, form())).toEqual({
    status: "unavailable",
    message:
      "We could not confirm this save. Retry this save before leaving this page.",
  });
  mocks.createClient.mockRejectedValue(new Error("private session"));
  expect((await renewalAction(id, { status: "idle" }, form())).status).toBe(
    "unavailable",
  );
});
