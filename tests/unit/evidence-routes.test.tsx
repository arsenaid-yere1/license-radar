import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const b = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  read: vi.fn(),
  enabled: vi.fn(),
  configured: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: b.user }));
vi.mock("@/lib/practice/access", () => ({ getPracticeAccess: b.access }));
vi.mock("@/lib/evidence/repository", () => ({ readEvidence: b.read }));
vi.mock("@/lib/evidence/config", () => ({
  evidenceEnabled: b.enabled,
  evidenceConfigured: b.configured,
}));
vi.mock("@/lib/evidence/storage", () => ({
  evidenceStorageReady: async () => true,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (v: string) => {
    throw new Error(v);
  },
  useRouter: () => ({ refresh: b.refresh }),
}));
import Page from "@/app/practice/register/[credentialId]/evidence/[cycleId]/page";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  fileId = "bbbbbbbb-0000-4000-8000-000000000002";
const data = {
  status: "success",
  credentialId: id,
  cycleId: id,
  title: "Policy",
  archivedAt: null,
  current: true,
  cycle: {
    id,
    cycleNumber: 1,
    dateRevision: 1,
    type: "malpractice_policy",
    endDate: "2030-03-02",
    actionDeadline: null,
    completedAt: null,
    successorId: null,
    progress: "not-started",
    acknowledgedAt: null,
  },
  files: [
    {
      id: fileId,
      filename: "proof.pdf",
      mime: "application/pdf",
      byteCount: 8,
      state: "available",
      version: 2,
      createdAt: "2030-01-01T00:00:00Z",
      requestId: null,
    },
  ],
  notices: [],
};
const load = (credentialId = id, cycleId = id) =>
  Page({ params: Promise.resolve({ credentialId, cycleId }) });
beforeEach(() => {
  vi.resetAllMocks();
  b.user.mockResolvedValue({ client: "client" });
  b.access.mockResolvedValue({
    status: "success",
    access: { role: "viewer", practice: { id, timezone: "UTC" } },
  });
  b.read.mockResolvedValue(data);
  b.enabled.mockReturnValue(true);
  b.configured.mockReturnValue(true);
});
afterEach(cleanup);
it("EV01 EV02 viewer can download exact cycle without upload or removal", async () => {
  render(await load(id.toUpperCase(), id.toUpperCase()));
  expect(b.read).toHaveBeenCalledWith("client", id, id, id);
  expect(
    screen
      .getByRole("link", { name: "Download proof.pdf" })
      .getAttribute("href"),
  ).toBe(`/api/renewal-evidence/${id}/${id}/${fileId}`);
  expect(screen.queryByRole("button", { name: "Upload evidence" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove proof.pdf" })).toBeNull();
});
it("EV02 EV10 archived read and unavailable configuration retain history", async () => {
  b.access.mockResolvedValue({
    status: "success",
    access: { role: "manager", practice: { id, timezone: "UTC" } },
  });
  b.read.mockResolvedValue({
    ...data,
    archivedAt: "2030-01-01T00:00:00Z",
    current: false,
  });
  render(await load());
  expect(screen.queryByRole("button", { name: "Upload evidence" })).toBeNull();
  expect(screen.getByRole("button", { name: "Remove proof.pdf" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Current record" })).toBeNull();
  cleanup();
  b.configured.mockReturnValue(false);
  render(await load());
  expect(screen.getByText(/file storage is unavailable/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Download proof.pdf" })).toBeNull();
});
it("EV02 invalid foreign no-practice and transport responses fail safely", async () => {
  await expect(load("bad")).rejects.toThrow("NOT_FOUND");
  b.read.mockResolvedValue({ status: "not-found" });
  await expect(load()).rejects.toThrow("NOT_FOUND");
  b.read.mockResolvedValue({ status: "unavailable" });
  await expect(load()).rejects.toThrow("We could not load evidence");
  b.access.mockResolvedValue({ status: "unavailable" });
  await expect(load()).rejects.toThrow("We could not load evidence");
  b.access.mockResolvedValue({ status: "success", access: null });
  await expect(load()).rejects.toThrow("/onboarding/practice");
});
it("EV04 manager can resume only a sanitized own pending request", async () => {
  b.access.mockResolvedValue({
    status: "success",
    access: { role: "manager", practice: { id, timezone: "UTC" } },
  });
  b.read.mockResolvedValue({
    ...data,
    files: [{ ...data.files[0], state: "pending", requestId: fileId }],
    notices: [{ ...data.files[0], id, filename: null, state: "deleted" }],
    cycle: { ...data.cycle, type: "state_license", endDate: null },
  });
  render(await load());
  expect(screen.getByText(/Expiration: Not entered/)).toBeTruthy();
  expect(screen.getByText(/Removed attachment: Evidence removed/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Download proof.pdf" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Resume upload for proof.pdf" }),
  );
  const input = document.querySelector<HTMLInputElement>(
    'input[name="requestId"]',
  );
  expect(input?.value).toBe(fileId);
});
