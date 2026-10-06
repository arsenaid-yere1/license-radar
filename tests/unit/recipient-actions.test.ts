import { expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  saveRecipient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/recipients/operations", () => ({
  saveRecipient: mocks.saveRecipient,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { recipientAction } from "@/app/practice/recipient-actions";
import { recipientInput, recipientMessage } from "@/lib/recipients/messages";
function form(
  entries: Record<string, string> = { intent: "clear", expectedVersion: "1" },
) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue("client");
});
it("R17 action binds parsed values and safe recipient-specific messages", async () => {
  for (const status of [
    "success",
    "invalid",
    "forbidden",
    "conflict",
    "invalid-recipient",
    "unavailable",
  ] as const) {
    const result = {
      status,
      ...(status === "success"
        ? { recipient: { selected: { id: "member" } } }
        : {}),
    };
    mocks.saveRecipient.mockResolvedValue(result);
    expect(await recipientAction({ status: "idle" }, form())).toEqual({
      ...result,
      message: recipientMessage(status),
    });
    expect(mocks.saveRecipient).toHaveBeenLastCalledWith("client", {
      intent: "clear",
      expectedVersion: 1,
    });
  }
  mocks.saveRecipient.mockResolvedValue({
    status: "success",
    recipient: { selected: null },
  });
  expect((await recipientAction({ status: "idle" }, form())).message).toBe(
    "Reminder recipient cleared. No recipient is selected.",
  );
  expect(recipientMessage("success")).toBe(
    "Reminder recipient saved. SMS setup is still pending.",
  );
  expect(recipientMessage("invalid")).toBe(
    "Choose a valid recipient or explicitly clear the selection.",
  );
  expect(recipientMessage("forbidden")).toBe(
    "You do not have permission to change the reminder recipient.",
  );
  expect(recipientMessage("conflict")).toBe(
    "The reminder recipient changed. Reload before saving.",
  );
  expect(recipientMessage("invalid-recipient")).toBe(
    "This person is no longer eligible. Reload and choose another recipient.",
  );
  expect(recipientMessage("unavailable")).toBe(
    "We could not complete this request. Try again.",
  );
});
it("R17 auth redirects and unexpected client/operation failures stay private", async () => {
  mocks.saveRecipient.mockResolvedValue({ status: "auth-required" });
  await expect(recipientAction({ status: "idle" }, form())).rejects.toThrow(
    "REDIRECT:/login",
  );
  mocks.saveRecipient.mockRejectedValue(new Error("secret"));
  expect(await recipientAction({ status: "idle" }, form())).toEqual({
    status: "unavailable",
    message: "We could not complete this request. Try again.",
  });
  mocks.createClient.mockRejectedValue(new Error("secret"));
  expect((await recipientAction({ status: "idle" }, form())).status).toBe(
    "unavailable",
  );
});
it("R13 form parser rejects duplicates and files without interpreting omission as clear", () => {
  expect(
    recipientInput(
      form({
        intent: "assign",
        expectedVersion: "2",
        membershipId: "candidate",
        $ACTION_ID: "ignored",
      }),
    ),
  ).toEqual({
    intent: "assign",
    expectedVersion: 2,
    membershipId: "candidate",
  });
  for (const raw of ["0", "-1", "01", "1.5", "1e3", "", " 1", "1\n"])
    expect(
      recipientInput(form({ intent: "clear", expectedVersion: raw }))
        ?.expectedVersion,
    ).toBeNaN();
  expect(recipientInput(new FormData())?.expectedVersion).toBeNaN();
  const duplicate = form();
  duplicate.append("intent", "assign");
  expect(recipientInput(duplicate)).toBeNull();
  const file = form();
  file.set("membershipId", new File(["data"], "fixture.txt"));
  expect(recipientInput(file)).toBeNull();
});
