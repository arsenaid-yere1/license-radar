import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createRegisterRecord: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/register/operations", () => ({
  createRegisterRecord: mocks.createRegisterRecord,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { registerAction } from "@/app/practice/register/actions";
import { registerInput, registerMessage } from "@/lib/register/messages";
function form() {
  const f = new FormData();
  f.set("intent", "clinician");
  f.set("requestId", "key");
  f.set("name", "Rivera");
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue("client");
});
it("G18 parser allows repeated coverage, ignores framework metadata, rejects scalar repeats and files", () => {
  const f = form();
  f.set("$ACTION_ID", "ignored");
  expect(registerInput(f)).toEqual({
    intent: "clinician",
    requestId: "key",
    name: "Rivera",
  });
  f.set("intent", "credential");
  f.append("coveredClinicianIds", "B");
  f.append("coveredClinicianIds", "A");
  expect(registerInput(f)).toEqual({
    intent: "credential",
    requestId: "key",
    name: "Rivera",
    coveredClinicianIds: ["B", "A"],
  });
  f.append("requestId", "another");
  expect(registerInput(f)).toBeNull();
  for (const key of ["name", "coveredClinicianIds"]) {
    const file = form();
    file.set(key, new File(["secret"], "file.txt"));
    expect(registerInput(file)).toBeNull();
  }
  expect(registerInput(new FormData())).toEqual({});
});
it("G18 actions bind parsed input, exact safe messages and login redirect", async () => {
  const messages = {
    invalid: "Check the highlighted fields.",
    "invalid-reference":
      "An owner or covered clinician is unavailable. Reload and review your selection.",
    "request-conflict":
      "This save request was already used. Reload and review the saved register.",
    forbidden: "You do not have permission to add register records.",
    unavailable:
      "We could not confirm this save. Retry this save before changing it.",
  };
  for (const [status, message] of Object.entries(messages)) {
    mocks.createRegisterRecord.mockResolvedValue({ status });
    expect(await registerAction({ status: "idle" }, form())).toEqual({
      status,
      message,
    });
    expect(registerMessage(status as never)).toBe(message);
    expect(mocks.createRegisterRecord).toHaveBeenLastCalledWith("client", {
      intent: "clinician",
      requestId: "key",
      name: "Rivera",
    });
  }
  for (const [entity, message] of [
    ["clinician", "Clinician saved."],
    ["credential", "Record saved. Dates still need to be entered."],
  ]) {
    mocks.createRegisterRecord.mockResolvedValue({
      status: "success",
      [entity]: { id: "saved" },
    });
    expect((await registerAction({ status: "idle" }, form())).message).toBe(
      message,
    );
  }
  expect(registerMessage("success")).toBe(
    "Record saved. Dates still need to be entered.",
  );
  expect(registerMessage("idle")).toBe(messages.unavailable);
  mocks.createRegisterRecord.mockResolvedValue({ status: "auth-required" });
  await expect(registerAction({ status: "idle" }, form())).rejects.toThrow(
    "REDIRECT:/login",
  );
  mocks.createRegisterRecord.mockRejectedValue(new Error("private"));
  expect(await registerAction({ status: "idle" }, form())).toEqual({
    status: "unavailable",
    message: messages.unavailable,
  });
  mocks.createClient.mockRejectedValue(new Error("private"));
  expect((await registerAction({ status: "idle" }, form())).status).toBe(
    "unavailable",
  );
});
