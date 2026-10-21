import { expect, it } from "vitest";
import fc from "fast-check";
import {
  pageSchema,
  fileSchema,
  objectPath,
  uploadClaimSchema,
  downloadSchema,
  cleanupClaimSchema,
  resultSchema,
  removeInputSchema,
  evidenceId,
} from "./schema";
import { evidenceMessage, evidenceStatus } from "./messages";
const id = "aaaaaaaa-0000-4000-8000-000000000001",
  other = "bbbbbbbb-0000-4000-8000-000000000002";
const file = {
  id,
  filename: "proof.pdf",
  mime: "application/pdf",
  byteCount: 8,
  state: "available",
  version: 2,
  createdAt: "2030-01-01T00:00:00Z",
  requestId: null,
};
const cycle = {
  id,
  cycleNumber: 1,
  dateRevision: 1,
  type: "malpractice_policy",
  endDate: "2031-03-02",
  actionDeadline: null,
  completedAt: null,
  successorId: null,
  progress: "not-started",
  acknowledgedAt: null,
};
const page = {
  status: "success",
  credentialId: id,
  cycleId: id,
  title: "Policy",
  archivedAt: null,
  current: true,
  cycle,
  files: [file],
  notices: [],
};
const path = `${id}/${id}/${id}/${id}/${other}.pdf`,
  meta = {
    path,
    mime: "application/pdf",
    byteCount: 8,
    digest: "a".repeat(64),
  };
it("EV01 EV02 EV09 property bounded coherent private projection", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 3145728 }),
      fc.integer({ min: 1, max: 2147483647 }),
      (byteCount, version) => {
        expect(
          fileSchema.parse({ ...file, byteCount, version, private: "secret" }),
        ).toEqual({ ...file, byteCount, version });
        expect(fileSchema.safeParse({ ...file, byteCount: 0 }).success).toBe(
          false,
        );
        expect(
          fileSchema.safeParse({ ...file, byteCount: 3145729 }).success,
        ).toBe(false);
        expect(
          fileSchema.safeParse({ ...file, version: 2147483648 }).success,
        ).toBe(false);
      },
    ),
    { seed: 20261013, numRuns: 1000 },
  );
  expect(pageSchema.parse({ ...page, actor: id })).toEqual(page);
  expect(evidenceId.parse(id.toUpperCase())).toBe(id);
  const unicodeName = "😀".repeat(116) + ".pdf";
  expect(fileSchema.parse({ ...file, filename: unicodeName }).filename).toBe(
    unicodeName,
  );
  expect(
    fileSchema.safeParse({ ...file, filename: "😀".repeat(117) + ".pdf" })
      .success,
  ).toBe(false);
  expect(
    fileSchema.parse({ ...file, createdAt: "2030-01-01T02:00:00+02:00" })
      .createdAt,
  ).toBe("2030-01-01T02:00:00+02:00");
  expect(
    pageSchema.parse({ ...page, archivedAt: "2030-01-01T02:00:00+02:00" })
      .archivedAt,
  ).toBe("2030-01-01T02:00:00+02:00");
  for (const mime of ["application/pdf", "image/jpeg", "image/png"]) {
    expect(
      fileSchema.parse({ ...file, mime, filename: "a".repeat(120) }).mime,
    ).toBe(mime);
    expect(
      uploadClaimSchema.parse({
        status: "upload",
        evidenceId: id,
        objectId: other,
        token: id,
        ...meta,
        mime,
      }).mime,
    ).toBe(mime);
  }
  expect(
    pageSchema.parse({ ...page, title: "a".repeat(240) }).title,
  ).toHaveLength(240);
  for (const patch of [
    { cycleId: other },
    { files: [file, file] },
    { files: [{ ...file, state: "deleted" }] },
    { notices: [file] },
    { title: "" },
    { title: "a".repeat(241) },
    { files: [{ ...file, filename: null }] },
    { files: [{ ...file, filename: "" }] },
    { files: [{ ...file, filename: "a".repeat(121) }] },
    { files: [{ ...file, createdAt: "bad" }] },
    { files: [{ ...file, mime: "text/html" }] },
    { files: [{ ...file, version: 0 }] },
    { files: [{ ...file, byteCount: 1.5 }] },
    { files: [{ ...file, requestId: "bad" }] },
  ])
    expect(pageSchema.safeParse({ ...page, ...patch }).success).toBe(false);
  for (const state of ["deleted", "abandoned"])
    expect(
      pageSchema.parse({
        ...page,
        files: [],
        notices: [{ ...file, filename: null, state }],
      }).notices[0].filename,
    ).toBeNull();
  expect(
    pageSchema.parse({
      ...page,
      files: [{ ...file, state: "pending", requestId: id }],
    }).files[0].requestId,
  ).toBe(id);
  expect(
    pageSchema.parse({
      ...page,
      files: [],
      notices: [{ ...file, state: "deleting" }],
    }).notices[0].state,
  ).toBe("deleting");
  const rows = Array.from({ length: 21 }, (_, n) => ({
    ...file,
    id: `aaaaaaaa-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
  }));
  expect(
    pageSchema.safeParse({ ...page, files: rows.slice(0, 20) }).success,
  ).toBe(true);
  expect(pageSchema.safeParse({ ...page, files: rows }).success).toBe(false);
  expect(
    pageSchema.parse({
      ...page,
      files: [],
      notices: rows.slice(0, 20).map((r) => ({ ...r, state: "deleted" })),
    }).notices,
  ).toHaveLength(20);
  expect(
    pageSchema.safeParse({ ...page, notices: [{ ...file, state: "deleted" }] })
      .success,
  ).toBe(false);
  expect(
    pageSchema.safeParse({
      ...page,
      files: [],
      notices: rows.map((r) => ({ ...r, state: "deleted" })),
    }).success,
  ).toBe(false);
});
it("EV03 EV04 EV05 strict service claims immutable paths and explicit removal", () => {
  expect(
    uploadClaimSchema.parse({
      status: "upload",
      evidenceId: id,
      objectId: other,
      token: id,
      ...meta,
    }),
  ).toMatchObject(meta);
  expect(
    downloadSchema.parse({
      status: "download",
      accessId: id,
      filename: "proof.pdf",
      ...meta,
    }),
  ).toMatchObject(meta);
  expect(
    cleanupClaimSchema.parse({ objectId: id, token: other, path }),
  ).toEqual({ objectId: id, token: other, path });
  for (const extension of ["pdf", "jpg", "png"])
    expect(objectPath.parse(path.replace(/pdf$/, extension))).toContain(
      extension,
    );
  for (const bad of [
    path + "x",
    path.toUpperCase(),
    "../" + path,
    path.replace(other, "filename"),
    path.replace(".pdf", ".html"),
    path.slice(1),
    "",
    path.replace(/\//, "//"),
  ])
    expect(objectPath.safeParse(bad).success).toBe(false);
  for (const patch of [
    { byteCount: 0 },
    { byteCount: 3145729 },
    { digest: "A".repeat(64) },
    { digest: "a".repeat(63) },
    { digest: "a".repeat(65) },
    { mime: "text/html" },
    { token: "bad" },
  ])
    expect(
      uploadClaimSchema.safeParse({
        status: "upload",
        evidenceId: id,
        objectId: other,
        token: id,
        ...meta,
        ...patch,
      }).success,
    ).toBe(false);
  const removal = { requestId: id, expectedVersion: 2, confirmed: true };
  expect(removeInputSchema.parse(removal)).toEqual(removal);
  for (const patch of [
    { actor: id },
    { confirmed: false },
    { confirmed: "true" },
    { expectedVersion: 0 },
    { expectedVersion: 1.5 },
    { expectedVersion: 2147483648 },
    { requestId: "bad" },
  ])
    expect(removeInputSchema.safeParse({ ...removal, ...patch }).success).toBe(
      false,
    );
  expect(
    resultSchema.parse({
      status: "success",
      evidenceId: id,
      state: "available",
      private: "secret",
    }),
  ).toEqual({ status: "success", evidenceId: id, state: "available" });
  expect(
    resultSchema.safeParse({ status: "success", evidenceId: id, state: "sent" })
      .success,
  ).toBe(false);
  expect(resultSchema.safeParse({ status: "not-real" }).success).toBe(false);
});
it("EV03 EV06 exact user feedback and HTTP statuses", () => {
  for (const [status, message] of [
    ["available", "Evidence uploaded. Renewal dates are unchanged."],
    ["deleting", "Removed from this cycle; file cleanup pending."],
    ["deleted", "Evidence removed and file cleanup confirmed."],
    [
      "abandoned",
      "This upload was closed. Refresh evidence before starting again.",
    ],
    ["invalid", "Choose a valid PDF, JPEG or PNG file up to 3 MiB."],
    [
      "quota",
      "Evidence storage is full. Remove an attachment or wait for file cleanup.",
    ],
    ["forbidden", "Your current access does not allow this request."],
    ["not-found", "This evidence is unavailable."],
    ["archived", "Archived records cannot receive new evidence."],
    [
      "request-conflict",
      "This retry differs from the original request. Refresh evidence.",
    ],
    [
      "conflict",
      "Evidence changed. Refresh saved evidence before trying again.",
    ],
  ])
    expect(evidenceMessage(status)).toBe(message);
  expect(evidenceMessage("unknown")).toBe(
    "We could not confirm this request. Retry with the same file and request.",
  );
  for (const [status, code] of [
    ["forbidden", 403],
    ["not-found", 404],
    ["invalid", 400],
    ["unavailable", 503],
    ["quota", 409],
    ["busy", 409],
    ["request-conflict", 409],
    ["archived", 409],
    ["conflict", 409],
    ["pending", 409],
    ["deleted", 409],
    ["deleting", 409],
    ["abandoned", 409],
    ["available", 409],
  ] as const) {
    expect(resultSchema.parse({ status })).toEqual({ status });
    expect(evidenceStatus({ status })).toBe(code);
  }
  expect(
    evidenceStatus({ status: "success", evidenceId: id, state: "available" }),
  ).toBe(200);
});
