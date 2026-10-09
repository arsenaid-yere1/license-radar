import { expect, it, vi } from "vitest";
import { boundedReminderBody } from "./http";
it("HB01 body limits measure UTF-8 bytes, reject invalid encoding and honor stream cancellation deadlines", async () => {
  expect(
    await boundedReminderBody(
      new Request("http://127.0.0.1", { method: "POST", body: "é" }),
      1,
    ),
  ).toEqual({ status: 413 });
  expect(
    await boundedReminderBody(new Response(new Uint8Array([255])), 10),
  ).toEqual({ status: 400 });
  expect(await boundedReminderBody(new Response("é"), 2)).toEqual({
    body: "é",
  });
  expect(await boundedReminderBody(new Response(null), 1)).toEqual({
    body: "",
  });
  const cancel = vi.fn();
  vi.useFakeTimers();
  try {
    const pending = boundedReminderBody(
      new Response(new ReadableStream({ cancel })),
      10,
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ status: 408 });
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
it("HB02 advertised oversize rejects without reading, exact bounds succeed and read faults clear their timer", async () => {
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.error(new Error("read failure"));
    },
  });
  const read = { headers: new Headers({ "content-length": "11" }), body };
  expect(await boundedReminderBody(read, 10)).toEqual({ status: 413 });
  expect(
    await boundedReminderBody(
      new Response("x".repeat(10), { headers: { "content-length": "10" } }),
      10,
    ),
  ).toEqual({ body: "x".repeat(10) });
  vi.useFakeTimers();
  try {
    expect(
      await boundedReminderBody({ ...read, headers: new Headers() }, 10),
    ).toEqual({ status: 400 });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
