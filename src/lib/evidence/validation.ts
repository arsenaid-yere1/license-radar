import { createHash } from "node:crypto";
export const MAX_FILE_BYTES = 3145728;
export const MAX_REQUEST_BYTES = 3670016;
export class EvidenceInputError extends Error {
  constructor(public status = 400) {
    super("Choose a valid PDF, JPEG or PNG file up to 3 MiB.");
  }
}
export function bytesDigest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function safeFilename(name: string) {
  const filename = name.normalize("NFC");
  if (Array.from(filename).length > 120 || /[\x00-\x1f\x7f/\\]/.test(filename))
    throw new EvidenceInputError();
  return filename;
}
function detectedMime(bytes: Uint8Array) {
  if (/%PDF-[12]\.[0-9]/.test(new TextDecoder().decode(bytes.subarray(0, 8))))
    return "application/pdf";
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  else if (bytes.subarray(0, 8).join(",") === "137,80,78,71,13,10,26,10")
    return "image/png";
  throw new EvidenceInputError();
}
export async function evidenceFile(file: File) {
  const filename = safeFilename(file.name);
  if (file.size < 1 || file.size > MAX_FILE_BYTES)
    throw new EvidenceInputError(413);
  const bytes = new Uint8Array(await file.arrayBuffer()),
    mime = detectedMime(bytes);
  const extension = {
    "application/pdf": /\.pdf$/i,
    "image/jpeg": /\.jpe?g$/i,
    "image/png": /\.png$/i,
  }[mime];
  if (!extension.test(filename) || (file.type && file.type !== mime))
    throw new EvidenceInputError();
  return {
    filename,
    mime,
    byteCount: bytes.length,
    digest: bytesDigest(bytes),
    bytes,
  };
}
export async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (!request.body) throw new EvidenceInputError();
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new EvidenceInputError(413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  return bytes;
}
export function attachmentDisposition(name: string) {
  const fallback = name.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
