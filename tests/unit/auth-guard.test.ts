import { it, expect, vi } from "vitest";
const boundary = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => boundary);
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { requireUser } from "@/lib/auth/require-user";
it("S01 missing identity redirects", async () => {
  boundary.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
  await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
});
it("S03 verified user returned with scoped client", async () => {
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: "verified" } },
        error: null,
      }),
    },
  };
  boundary.createClient.mockResolvedValue(client);
  expect(await requireUser()).toEqual({ client, user: { id: "verified" } });
});
it("S24 server auth outage raises a safe recoverable error", async () => {
  boundary.createClient.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: null }, error: { status: 503 } }),
    },
  });
  await expect(requireUser()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
});

it("S24 SDK transport status zero cannot pretend the user signed out", async () => {
  boundary.createClient.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: null }, error: { status: 0 } }),
    },
  });
  await expect(requireUser()).rejects.toThrow(
    "We could not complete this request. Try again.",
  );
});
