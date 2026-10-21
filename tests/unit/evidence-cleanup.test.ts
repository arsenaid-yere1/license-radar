// @vitest-environment node
import { expect, it, vi } from "vitest";
import { cleanEvidence } from "@/lib/evidence/cleanup";
const claim = { objectId: "object", token: "token", path: "bound-path" };
it("EV06 EV07 cleanup confirms only successful purge and durable receipt", async () => {
  const gateway = {
    claimCleanup: vi.fn().mockResolvedValue([claim]),
    purgeObject: vi.fn().mockResolvedValue(true),
    recordCleanup: vi.fn().mockResolvedValue(true),
  };
  expect(await cleanEvidence(null, gateway)).toEqual({
    success: true,
    removed: 1,
    pending: 0,
  });
  expect(gateway.recordCleanup).toHaveBeenCalledWith("object", "token", true);
  gateway.purgeObject.mockResolvedValue(false);
  expect(await cleanEvidence(null, gateway)).toEqual({
    success: false,
    removed: 0,
    pending: 1,
  });
  expect(gateway.recordCleanup).toHaveBeenLastCalledWith(
    "object",
    "token",
    false,
  );
  gateway.purgeObject.mockResolvedValue(true);
  gateway.recordCleanup.mockResolvedValue(false);
  expect(await cleanEvidence(null, gateway)).toEqual({
    success: false,
    removed: 0,
    pending: 1,
  });
  gateway.claimCleanup.mockResolvedValue(null);
  expect(await cleanEvidence(null, gateway)).toEqual({
    success: false,
    removed: 0,
    pending: 0,
  });
});
it("EV07 stops starting physical purges after the bounded worker deadline", async () => {
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(35000)
    .mockReturnValue(35001);
  const gateway = {
    claimCleanup: vi
      .fn()
      .mockResolvedValue([claim, { ...claim, objectId: "later" }]),
    purgeObject: vi.fn().mockResolvedValue(true),
    recordCleanup: vi.fn().mockResolvedValue(true),
  };
  try {
    expect(await cleanEvidence(null, gateway)).toEqual({
      success: false,
      removed: 1,
      pending: 1,
    });
    expect(gateway.purgeObject).toHaveBeenCalledOnce();
    expect(gateway.recordCleanup).toHaveBeenCalledWith("object", "token", true);
  } finally {
    clock.mockRestore();
  }
});
