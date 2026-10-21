import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
const requireUser = vi.hoisted(() =>
  vi.fn(() => {
    throw Error("Private access attempted");
  }),
);
vi.mock("@/lib/auth/require-user", () => ({ requireUser }));
vi.mock("@/components/auth/email-code-form", () => ({
  EmailCodeForm: () => <div>Code form</div>,
}));
import About from "@/app/about/page";
import Privacy from "@/app/privacy/page";
import Login from "@/app/login/page";
afterEach(cleanup);

it("GM10 public information pages reproduce the approved copy without authentication or private content", () => {
  const approved = JSON.parse(
    readFileSync("tests/fixtures/gmail-public-copy.json", "utf8"),
  ) as Record<string, string>;
  for (const [Page, section] of [
    [About, "about"],
    [Privacy, "privacy"],
  ] as const) {
    const copy = approved[section];
    const view = render(<Page />);
    const main = screen.getByRole("main");
    const text = main.textContent!.replace(/\s+/g, " ");
    for (const paragraph of copy
      .trim()
      .split(/\n\s*\n/)
      .filter((p) => !p.startsWith("#") && !p.startsWith("Links:"))) {
      expect(text).toContain(
        paragraph.replaceAll("**", "").replaceAll("`", "").replace(/\s+/g, " "),
      );
    }
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("/login");
    expect(screen.queryByRole("form")).toBeNull();
    expect(requireUser).not.toHaveBeenCalled();
    view.unmount();
  }
});

it("GM10 public navigation exposes the matching privacy, about, revocation and operator contact links", () => {
  const about = render(<About />);
  expect(
    screen.getByRole("link", { name: "Privacy" }).getAttribute("href"),
  ).toBe("/privacy");
  about.unmount();
  const privacy = render(<Privacy />);
  expect(
    screen
      .getByRole("link", { name: "About License Radar" })
      .getAttribute("href"),
  ).toBe("/about");
  expect(
    screen
      .getByRole("link", {
        name: "https://myaccount.google.com/connections",
      })
      .getAttribute("href"),
  ).toBe("https://myaccount.google.com/connections");
  expect(
    screen
      .getByRole("link", { name: "arsen.yere1@gmail.com" })
      .getAttribute("href"),
  ).toBe("mailto:arsen.yere1@gmail.com");
  privacy.unmount();
  render(<Login />);
  expect(
    screen.getByRole("link", { name: "Privacy" }).getAttribute("href"),
  ).toBe("/privacy");
});
