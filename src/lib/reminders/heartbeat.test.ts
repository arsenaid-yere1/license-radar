import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reminderHeartbeat } from "./heartbeat";
const url = "https://hc-ping.com/10000000-0000-4000-8000-000000000001";
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("EMAIL_PROVIDER_FIXTURE", undefined);
  vi.stubEnv("REMINDER_HEALTHCHECK_ENABLED", "true");
  vi.stubEnv("REMINDER_HEALTHCHECK_URL", url);
  network = vi.fn().mockResolvedValue(new Response("OK"));
  vi.stubGlobal("fetch", network);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("SA01 posts one empty private heartbeat and waits for exact acknowledgment", async () => {
  expect(await reminderHeartbeat()).toBe(true);
  expect(network).toHaveBeenCalledTimes(1);
  const [target, options] = network.mock.calls[0];
  expect(target).toBe(url);
  expect(options).toEqual({
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: expect.any(AbortSignal),
  });
  expect(options.signal.aborted).toBe(true);
});
it("SA03 only explicit production context and enablement can contact the monitor", async () => {
  for (const [key, values] of Object.entries({
    VERCEL: [undefined, "", "0", "true"],
    VERCEL_ENV: [undefined, "", "preview", "development"],
    EMAIL_PROVIDER_FIXTURE: ["local-e4-s2", "unexpected", ""],
    REMINDER_HEALTHCHECK_ENABLED: [undefined, "", "false", "TRUE"],
  })) {
    const original = process.env[key];
    for (const value of values) {
      vi.stubEnv(key, value);
      expect(await reminderHeartbeat()).toBe(false);
      expect(network).not.toHaveBeenCalled();
    }
    vi.stubEnv(key, original);
  }
});
it("SA03 accepts only canonical fixed-origin UUID URLs", async () => {
  for (const bad of [
    undefined,
    "",
    "https://hc-ping.com/",
    url + "/",
    url + "?x=1",
    url + "#x",
    url + "\n",
    " " + url,
    url.replace("https:", "http:"),
    url.replace("hc-ping.com", "hc-ping.com.attacker.invalid"),
    url.replace("hc-ping.com", "user@hc-ping.com"),
    url.replace("hc-ping.com", "hc-ping.com:443"),
    url.replace("10000000", "z0000000"),
    url.toUpperCase(),
  ]) {
    vi.stubEnv("REMINDER_HEALTHCHECK_URL", bad);
    expect(await reminderHeartbeat()).toBe(false);
    expect(network).not.toHaveBeenCalled();
  }
});
it("SA04 rejects non-200, missing, oversized, malformed and misleading acknowledgment bodies", async () => {
  for (const response of [
    new Response(null),
    new Response("OK", { status: 201 }),
    new Response("OK", { status: 302 }),
    new Response("OK", { status: 500 }),
    ...[
      "",
      "NO",
      "O",
      "OK\n",
      "OK (not found)",
      "OK (rate limited)",
      "x".repeat(1024),
    ].map((b) => new Response(b)),
    new Response(new Uint8Array([255, 254])),
  ]) {
    network.mockResolvedValueOnce(response);
    expect(await reminderHeartbeat()).toBe(false);
  }
  expect(network).toHaveBeenCalledTimes(12);
});
it("SA04 accepts an exact streamed OK across chunk boundaries and cancels the reader", async () => {
  const cancel = vi.fn();
  const read = vi
    .fn()
    .mockResolvedValueOnce({ done: false, value: new Uint8Array([79]) })
    .mockResolvedValueOnce({ done: false, value: new Uint8Array([75]) })
    .mockResolvedValueOnce({ done: true });
  cancel.mockResolvedValue(undefined);
  network.mockResolvedValue({
    status: 200,
    body: { getReader: () => ({ read, cancel }) },
  });
  expect(await reminderHeartbeat()).toBe(true);
  expect(read).toHaveBeenCalledTimes(3);
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("SA04 failed headers or response reading stays private and does not retry", async () => {
  for (const failure of [
    () => Promise.reject(Error(url)),
    () =>
      Promise.resolve({
        status: 200,
        body: {
          getReader: () => {
            throw Error(url);
          },
        },
      }),
    () =>
      Promise.resolve({
        status: 200,
        body: {
          getReader: () => ({
            read: () => Promise.reject(Error(url)),
            cancel: () => Promise.reject(Error(url)),
          }),
        },
      }),
  ]) {
    network.mockImplementationOnce(failure);
    expect(await reminderHeartbeat()).toBe(false);
  }
  expect(network).toHaveBeenCalledTimes(3);
});
it("SA04 a single 3000ms deadline covers stalled headers and stalled body", async () => {
  vi.useFakeTimers();
  for (const body of [false, true]) {
    const cancel = vi.fn().mockResolvedValue(undefined);
    network.mockImplementationOnce(() =>
      body
        ? Promise.resolve({
            status: 200,
            body: {
              getReader: () => ({ read: () => new Promise(() => {}), cancel }),
            },
          })
        : new Promise(() => {}),
    );
    let settled = false;
    const result = reminderHeartbeat().then((v) => {
      settled = true;
      return v;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(false);
    expect(network.mock.lastCall?.[1].signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(body ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  }
  expect(network).toHaveBeenCalledTimes(2);
});

it("SA04 exceeding two acknowledgment bytes stops reading immediately", async () => {
  const read = vi
    .fn()
    .mockResolvedValue({ done: false, value: new Uint8Array([79, 75, 32]) });
  const cancel = vi.fn().mockResolvedValue(undefined);
  network.mockResolvedValue({
    status: 200,
    body: { getReader: () => ({ read, cancel }) },
  });
  expect(await reminderHeartbeat()).toBe(false);
  expect(read).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("SA04 header latency consumes the same body deadline", async () => {
  vi.useFakeTimers();
  let headers!: (value: unknown) => void;
  network.mockImplementation(
    () =>
      new Promise((r) => {
        headers = r;
      }),
  );
  let settled = false;
  const result = reminderHeartbeat().then((v) => {
    settled = true;
    return v;
  });
  await vi.advanceTimersByTimeAsync(2000);
  const cancel = vi.fn().mockResolvedValue(undefined);
  headers({
    status: 200,
    body: { getReader: () => ({ read: () => new Promise(() => {}), cancel }) },
  });
  await vi.advanceTimersByTimeAsync(999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("SA04 every settled request clears its deadline timer", async () => {
  vi.useFakeTimers();
  expect(await reminderHeartbeat()).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  network.mockRejectedValueOnce(Error("transport"));
  expect(await reminderHeartbeat()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
