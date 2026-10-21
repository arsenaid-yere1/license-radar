import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/practice/access", () => ({ getPracticeAccess: mocks.access }));
vi.mock("@/lib/renewals/repository", () => ({
  getRenewalRegister: mocks.read,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: () => {
    throw new Error("REDIRECT");
  },
}));
import Detail from "@/app/practice/register/[credentialId]/page";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
afterEach(cleanup);
it("RN03 RN04 active read-only detail displays number while links keep internal identity", async () => {
  mocks.user.mockResolvedValue({ client: "client" });
  mocks.access.mockResolvedValue({
    status: "success",
    access: {
      role: "viewer",
      practice: { id, timezone: "UTC", name: "Practice" },
    },
  });
  for (const [type, label] of [
    ["state_license", "License number"],
    ["dea_registration", "DEA registration number"],
    ["malpractice_policy", "Policy number"],
  ]) {
    mocks.read.mockResolvedValue({
      status: "success",
      register: {
        clinicians: [],
        credentials: [
          {
            id,
            title: "Fixture",
            type,
            owner_kind: "practice",
            owner_clinician_id: null,
            owner_name: "Practice",
            version: 1,
            record_number: "000Z-01",
            covered_clinicians: [],
            issuer: null,
            jurisdiction: null,
            archived_at: null,
            current_cycle: {
              id,
              cycle_number: 1,
              date_revision: 1,
              end_date: null,
              action_deadline: null,
            },
            renewal: {
              link: { url: null, version: 1 },
              workflow: {
                cycleId: id,
                status: "not-started",
                version: 1,
                acknowledgedAt: null,
              },
            },
          },
        ],
      },
    });
    const view = render(
      await Detail({ params: Promise.resolve({ credentialId: id }) }),
    );
    expect(screen.getByText(`${label}: 000Z-01`)).toBeTruthy();
    expect(view.container.querySelector('a[href*="000Z-01"]')).toBeNull();
    expect(screen.queryByLabelText(`${label} (optional)`)).toBeNull();
    view.unmount();
  }
});
