import { it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
const boundary = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: boundary.createServerClient,
}));
vi.mock("next/headers", () => ({ cookies: boundary.cookies }));
import { createClient } from "@/lib/supabase/server";
import { updateSession } from "@/lib/supabase/session";
import { proxy } from "@/proxy";
beforeEach(() => vi.resetAllMocks());
it("S07 refreshed cookies and cache protections survive a redirect", async () => {
  const request = new NextRequest("http://127.0.0.1:3000/practice");
  boundary.createServerClient.mockImplementation((_url, _key, options) => {
    expect(options.cookies.getAll()).toEqual([]);
    return {
      auth: {
        getClaims: async () => {
          options.cookies.setAll([
            {
              name: "refreshed",
              value: "fixture",
              options: { httpOnly: true, path: "/" },
            },
          ]);
          return { data: null, error: null };
        },
      },
    };
  });
  const response = await proxy(request);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    new URL("/login", request.url).href,
  );
  expect(response.cookies.get("refreshed")?.value).toBe("fixture");
  expect(request.cookies.get("refreshed")?.value).toBe("fixture");
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
});
it.each([
  { path: "/login", data: null, error: null, method: "GET" },
  {
    path: "/practice",
    data: { claims: { sub: "verified" } },
    error: null,
    method: "GET",
  },
  { path: "/practice", data: null, error: { status: 503 }, method: "GET" },
  { path: "/practice", data: null, error: { status: 401 }, method: "POST" },
])(
  "S07 S24 S26 auth route $path $method",
  async ({ path, data, error, method }) => {
    boundary.createServerClient.mockReturnValue({
      auth: { getClaims: vi.fn().mockResolvedValue({ data, error }) },
    });
    expect(
      (
        await updateSession(
          new NextRequest(`http://127.0.0.1:3000${path}`, { method }),
        )
      ).status,
    ).toBe(200);
  },
);
it("S07 SSR cookie adapter writes in action, tolerates read-only server render", async () => {
  const store = {
    getAll: vi.fn().mockReturnValue([{ name: "existing", value: "value" }]),
    set: vi.fn(),
  };
  boundary.cookies.mockResolvedValue(store);
  boundary.createServerClient.mockImplementation((_u, _k, options) => {
    expect(options.cookies.getAll()).toEqual([
      { name: "existing", value: "value" },
    ]);
    options.cookies.setAll([
      { name: "new", value: "value", options: { path: "/" } },
    ]);
    return { marker: "client" };
  });
  expect(await createClient()).toEqual({ marker: "client" });
  expect(store.set).toHaveBeenCalledWith("new", "value", { path: "/" });
  store.set.mockImplementation(() => {
    throw new Error("read-only");
  });
  expect(await createClient()).toEqual({ marker: "client" });
});
