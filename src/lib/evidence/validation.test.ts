// @vitest-environment node
import { expect, it, vi } from "vitest";
import fc from "fast-check";
import {
  evidenceFile,
  boundedBody,
  attachmentDisposition,
  MAX_FILE_BYTES,
  EvidenceInputError,
} from "./validation";
const pdf = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF\n");
it("EV03 valid detected formats and exact byte boundary", async () => {
  const fixtures = [
    ["proof.pdf", "application/pdf", pdf],
    ["proof.JPEG", "image/jpeg", new Uint8Array([255, 216, 255, 1])],
    [
      "proof.png",
      "image/png",
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ],
  ] as const;
  for (const [name, type, bytes] of fixtures) {
    const result = await evidenceFile(new File([bytes], name, { type }));
    expect(result).toMatchObject({
      filename: name,
      mime: type,
      byteCount: bytes.length,
      bytes,
    });
  }
  const maximum = new Uint8Array(MAX_FILE_BYTES);
  expect(
    (await evidenceFile(new File([pdf], "😀".repeat(116) + ".pdf"))).filename,
  ).toBe("😀".repeat(116) + ".pdf");
  maximum.set(pdf);
  expect(await evidenceFile(new File([maximum], "max.pdf"))).toMatchObject({
    byteCount: MAX_FILE_BYTES,
  });
  expect(
    (await evidenceFile(new File([pdf], "a".repeat(116) + ".pdf"))).filename,
  ).toHaveLength(120);
  expect((await evidenceFile(new File([pdf], "cafe\u0301.PDF"))).filename).toBe(
    "café.PDF",
  );
  expect(
    (
      await evidenceFile(
        new File([new Uint8Array([255, 216, 255])], "proof.jpg"),
      )
    ).mime,
  ).toBe("image/jpeg");
  for (const version of ["1.0", "2.9"])
    expect(
      (await evidenceFile(new File([`%PDF-${version}`], "proof.pdf"))).mime,
    ).toBe("application/pdf");
});
it("EV03 invalid size type signature and hostile names reject", async () => {
  for (const [name, type, bytes] of [
    ["proof.pdf", "application/pdf", new Uint8Array()],
    ["proof.pdf", "application/pdf", new Uint8Array(MAX_FILE_BYTES + 1)],
    ["proof.pdf", "text/html", pdf],
    ["proof.png", "image/png", pdf],
    ["proof.svg", "image/svg+xml", pdf],
    ["../proof.pdf", "", pdf],
    ["proof\\name.pdf", "", pdf],
    ["proof\n.pdf", "", pdf],
    ["a".repeat(121) + ".pdf", "", pdf],
    ["😀".repeat(117) + ".pdf", "", pdf],
    ["proof.pdf", "", new Uint8Array([1, 2, 3])],
  ] as const)
    await expect(
      evidenceFile(new File([bytes], name, { type })),
    ).rejects.toThrow();
  for (const bytes of [new Uint8Array(), new Uint8Array(MAX_FILE_BYTES + 1)])
    await expect(
      evidenceFile(new File([bytes], "proof.pdf")),
    ).rejects.toMatchObject({
      status: 413,
      message: "Choose a valid PDF, JPEG or PNG file up to 3 MiB.",
    });
  await expect(
    evidenceFile(new File([new Uint8Array([1])], "proof.pdf")),
  ).rejects.toMatchObject({ status: 400 });
  for (const [name, bytes] of [
    ["proof.pdf.exe", pdf],
    ["proof.jpg.exe", new Uint8Array([255, 216, 255])],
    ["proof.png.exe", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    ["proof.jpg", new Uint8Array([0, 216, 255])],
    ["proof.jpg", new Uint8Array([255, 0, 255])],
    ["proof.jpg", new Uint8Array([255, 216, 0])],
    ["proof.png", new Uint8Array([0, 80, 78, 71, 13, 10, 26, 10])],
    ["proof.pdf", new TextEncoder().encode("%PDF-3.7")],
  ] as const)
    await expect(evidenceFile(new File([bytes], name))).rejects.toThrow(
      EvidenceInputError,
    );
});
it("EV03 bounded body counts real chunked bytes and cancels excess", async () => {
  const cancelled = vi.fn(),
    body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
      cancel: cancelled,
    }),
    request = new Request("http://app.test", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
  await expect(boundedBody(request, 3)).rejects.toMatchObject({ status: 413 });
  expect(cancelled).toHaveBeenCalledOnce();
  expect(request.body!.locked).toBe(false);
  expect(
    await boundedBody(
      new Request("http://app.test", { method: "POST", body: "abc" }),
      3,
    ),
  ).toEqual(new Uint8Array([97, 98, 99]));
  await expect(
    boundedBody(
      new Request("http://app.test", {
        method: "POST",
        body: "abcd",
        headers: { "content-length": "1" },
      }),
      3,
    ),
  ).rejects.toThrow();
  await expect(
    boundedBody(new Request("http://app.test", { method: "POST" }), 3),
  ).rejects.toThrow();
});
it("EV03 EV05 property byte limits and safe encoded attachment names", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 100 }), async (n) => {
      const body = "a".repeat(n);
      expect(
        (
          await boundedBody(
            new Request("http://app.test", { method: "POST", body }),
            n,
          )
        ).length,
      ).toBe(n);
      await expect(
        boundedBody(
          new Request("http://app.test", { method: "POST", body: body + "a" }),
          n,
        ),
      ).rejects.toThrow();
    }),
    { seed: 20261013, numRuns: 100 },
  );
  expect(attachmentDisposition("résumé.pdf")).toContain(
    "filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
  );
  expect(attachmentDisposition("résumé.pdf")).toBe(
    "attachment; filename=\"r_sum_.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
  );
  expect(attachmentDisposition("proof.pdf")).toBe(
    "attachment; filename=\"proof.pdf\"; filename*=UTF-8''proof.pdf",
  );
  expect(attachmentDisposition("proof(!')*.pdf")).toBe(
    "attachment; filename=\"proof_____.pdf\"; filename*=UTF-8''proof%28%21%27%29%2A.pdf",
  );
});
it("EV03 property preserves every byte across independently generated stream chunks", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.uint8Array({ minLength: 1, maxLength: 32 }), {
        minLength: 2,
        maxLength: 8,
      }),
      async (chunks) => {
        const expected = Uint8Array.from(
          chunks.flatMap((chunk) => Array.from(chunk)),
        );
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        });
        const request = new Request("http://app.test", {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit);
        expect(await boundedBody(request, expected.length)).toEqual(expected);
        expect(request.body!.locked).toBe(false);
      },
    ),
    { seed: 20261014, numRuns: 100 },
  );
});
