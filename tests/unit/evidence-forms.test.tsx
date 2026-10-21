import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EvidenceRemoveForm } from "@/components/evidence/remove-form";
import { EvidenceUploadForm } from "@/components/evidence/upload-form";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const file = {
  id,
  filename: "proof.pdf",
  mime: "application/pdf" as const,
  byteCount: 8,
  state: "available" as const,
  version: 2,
  createdAt: "2026-10-14T00:00:00Z",
  requestId: null,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("EV08 cancellation restores focus and never sends a removal", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(
    <EvidenceRemoveForm
      file={file}
      endpoint="/evidence"
      disabled={false}
      onLock={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  const opener = screen.getByRole("button", { name: "Remove proof.pdf" });
  fireEvent.click(opener);
  expect(
    screen
      .getByRole("button", { name: "Confirm removal" })
      .matches(":disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    screen
      .getByRole("button", { name: "Confirm removal" })
      .matches(":disabled"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(opener);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(opener);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
    false,
  );
});
it("EV08 terminal upload and removal denials release the form and focus safe feedback", async () => {
  const fetch = vi.fn().mockResolvedValue({
    status: 403,
    json: async () => ({ status: "forbidden" }),
  });
  vi.stubGlobal("fetch", fetch);
  const lock = vi.fn(),
    saved = vi.fn();
  const upload = render(
    <EvidenceUploadForm
      endpoint="/evidence"
      requestId={id}
      disabled={false}
      onLock={lock}
      onSaved={saved}
    />,
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Upload evidence" }).closest("form")!,
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Your current access does not allow this request.",
    ),
  );
  expect(document.activeElement).toBe(screen.getByRole("alert"));
  expect(screen.getByLabelText("Evidence file").matches(":disabled")).toBe(
    false,
  );
  expect(lock.mock.calls).toEqual([[true], [false]]);
  upload.unmount();
  lock.mockClear();
  render(
    <EvidenceRemoveForm
      file={file}
      endpoint="/evidence"
      disabled={false}
      onLock={lock}
      onSaved={saved}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove proof.pdf" }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Your current access does not allow this request.",
    ),
  );
  expect(document.activeElement).toBe(screen.getByRole("alert"));
  expect(lock.mock.calls).toEqual([[true], [false]]);
  expect(saved).not.toHaveBeenCalled();
});
it("EV04 EV08 uncertain removal freezes identity and confirmation until receipt", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        status: "success",
        evidenceId: id,
        version: 3,
        state: "deleted",
      }),
    });
  vi.stubGlobal("fetch", fetch);
  const lock = vi.fn(),
    saved = vi.fn();
  render(
    <EvidenceRemoveForm
      file={file}
      endpoint="/evidence"
      disabled={false}
      onLock={lock}
      onSaved={saved}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove proof.pdf" }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "could not confirm",
    ),
  );
  expect(document.activeElement).toBe(screen.getByRole("alert"));
  expect(screen.getByRole("checkbox").matches(":disabled")).toBe(true);
  expect(
    screen.getByRole("button", { name: "Cancel" }).matches(":disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry this removal" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[0]);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    requestId: expect.any(String),
    expectedVersion: 2,
    confirmed: true,
  });
  expect(lock.mock.calls).toEqual([[true], [true]]);
});
it("EV04 EV08 uncertain upload reuses the actual body and request key", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce({
      status: 200,
      json: async () => ({
        status: "success",
        evidenceId: id,
        version: 2,
        state: "available",
      }),
    });
  vi.stubGlobal("fetch", fetch);
  const saved = vi.fn(),
    lock = vi.fn();
  render(
    <EvidenceUploadForm
      endpoint="/evidence"
      requestId={id}
      disabled={false}
      onLock={lock}
      onSaved={saved}
    />,
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Upload evidence" }).closest("form")!,
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("same file"),
  );
  expect(screen.getByLabelText("Evidence file").matches(":disabled")).toBe(
    true,
  );
  fireEvent.submit(
    screen.getByRole("button", { name: "Retry this upload" }).closest("form")!,
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  expect(fetch.mock.calls[0][1].body.get("requestId")).toBe(id);
  expect(lock.mock.calls).toEqual([[true], [true]]);
});
