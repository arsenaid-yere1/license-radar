import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createRegisterRecord: vi.fn(),
  changeRegisterRecord: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/register/operations", () => ({
  createRegisterRecord: mocks.createRegisterRecord,
  changeRegisterRecord: mocks.changeRegisterRecord,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import {
  maintenanceAction,
  registerAction,
} from "@/app/practice/register/actions";
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
  for (const key of [
    "name",
    "coveredClinicianIds",
    "issuer",
    "jurisdiction",
    "endDate",
    "actionDeadline",
  ]) {
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
    ["credential", "Record saved."],
  ]) {
    mocks.createRegisterRecord.mockResolvedValue({
      status: "success",
      [entity]: { id: "saved" },
    });
    expect((await registerAction({ status: "idle" }, form())).message).toBe(
      message,
    );
  }
  expect(registerMessage("success")).toBe("Record saved.");
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

it("D14 dates and metadata reject duplicate scalar FormData", () => {
  for (const key of ["issuer", "jurisdiction", "endDate", "actionDeadline"]) {
    const f = form();
    f.append(key, "2028-02-29");
    f.append(key, "different");
    expect(registerInput(f)).toBeNull();
  }
});

it("M11 maintenance action preserves safe feedback and redirects outside catches", async () => {
  const f = form();
  f.set("intent", "update");
  const expected = {
    success: "Changes saved.",
    conflict: "This record changed. Compare your draft with the saved values.",
    invalid: "Check the highlighted fields.",
    "invalid-reference":
      "An owner or covered clinician is unavailable. Reload and review your selection.",
    "request-conflict":
      "This save request was already used. Reload and review the saved register.",
    archived:
      "This record is archived. Reload the register to review its history.",
    "not-found": "This record is unavailable. Reload the register.",
    forbidden: "You do not have permission to change register records.",
    unavailable:
      "We could not confirm this save. Retry this save before leaving this page.",
  };
  for (const [status, message] of Object.entries(expected)) {
    mocks.changeRegisterRecord.mockResolvedValue({ status });
    expect(await maintenanceAction({ status: "idle" }, f)).toEqual({
      status,
      message,
    });
    expect(mocks.changeRegisterRecord).toHaveBeenLastCalledWith("client", {
      intent: "update",
      requestId: "key",
      name: "Rivera",
    });
  }
  f.set("intent", "archive");
  mocks.changeRegisterRecord.mockResolvedValue({ status: "success" });
  expect((await maintenanceAction({ status: "idle" }, f)).message).toBe(
    "Record archived.",
  );
  mocks.changeRegisterRecord.mockResolvedValue({ status: "auth-required" });
  await expect(maintenanceAction({ status: "idle" }, f)).rejects.toThrow(
    "REDIRECT:/login",
  );
  mocks.changeRegisterRecord.mockRejectedValue(new Error("private"));
  expect(await maintenanceAction({ status: "idle" }, f)).toEqual({
    status: "unavailable",
    message: expected.unavailable,
  });
  mocks.createClient.mockRejectedValue(new Error("private"));
  expect((await maintenanceAction({ status: "idle" }, f)).status).toBe(
    "unavailable",
  );
});
