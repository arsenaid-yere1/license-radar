import { beforeEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: boundary.create }));
vi.mock("@/lib/reminders/operations", () => ({
  saveEmailPreference: boundary.save,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { emailPreferenceAction } from "@/app/practice/reminders/actions";
const id = "10000000-0000-4000-8000-000000000001";
function form(enabled = "false", expectedVersion = "1") {
  const result = new FormData();
  result.set("requestId", id);
  result.set("enabled", enabled);
  result.set("expectedVersion", expectedVersion);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.create.mockResolvedValue("client");
  boundary.save.mockResolvedValue({ status: "success" });
});
it("EA01 action binds exact personal choice/version and returns safe feedback or redirects", async () => {
  for (const enabled of ["true", "false"]) {
    expect(
      await emailPreferenceAction({ status: "idle" }, form(enabled, "2")),
    ).toEqual({
      status: "success",
      message: "Email reminder preference saved.",
    });
    expect(boundary.save).toHaveBeenLastCalledWith("client", {
      requestId: id,
      enabled: enabled === "true",
      expectedVersion: 2,
    });
  }
  for (const status of [
    "invalid",
    "forbidden",
    "conflict",
    "request-conflict",
    "unavailable",
  ]) {
    boundary.save.mockResolvedValue({ status });
    expect(await emailPreferenceAction({ status: "idle" }, form())).toEqual({
      status,
      message: "We could not confirm this change. Reload before trying again.",
    });
  }
  boundary.save.mockResolvedValue({ status: "auth-required" });
  await expect(
    emailPreferenceAction({ status: "idle" }, form()),
  ).rejects.toThrow("REDIRECT:/login");
});
it("EA02 malformed, duplicate or uploaded preference values cannot become a boolean change", async () => {
  const duplicate = form();
  duplicate.append("enabled", "true");
  const upload = form();
  upload.set("enabled", new File(["true"], "fixture.txt"));
  for (const bad of [
    form("forged"),
    form("false", "01"),
    form("false", "1e3"),
    duplicate,
    upload,
  ]) {
    boundary.save.mockClear();
    expect((await emailPreferenceAction({ status: "idle" }, bad)).status).toBe(
      "invalid",
    );
    expect(boundary.save).not.toHaveBeenCalled();
  }
});
it("EA03 client creation and storage faults return safe retry guidance without private errors", async () => {
  boundary.save.mockRejectedValue(new Error("private storage error"));
  expect((await emailPreferenceAction({ status: "idle" }, form())).status).toBe(
    "unavailable",
  );
  boundary.create.mockRejectedValue(new Error("private client error"));
  expect((await emailPreferenceAction({ status: "idle" }, form())).status).toBe(
    "unavailable",
  );
});
