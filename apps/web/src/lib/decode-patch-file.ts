/** Same as the parser's patch limit. */
export const MAX_PATCH_FILE_BYTES = 1024 * 1024;

export type DecodeResult = { ok: true; text: string } | { ok: false; message: string };

export const TOO_LARGE_MESSAGE = 'This file is larger than 1 MiB, the limit for a patch.';
export const INVALID_TEXT_MESSAGE = "This file isn't valid UTF-8 or UTF-16.";

/** Invalid bytes are an error, not replacement characters. */
export function decodePatchBytes(bytes: Uint8Array): DecodeResult {
  let encoding = 'utf-8';
  let start = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) [encoding, start] = ['utf-16le', 2];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) [encoding, start] = ['utf-16be', 2];
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;

  try {
    // ignoreBOM: the BOM is already skipped, so a second one is kept as text, as in parsePatch.
    const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
    return { ok: true, text: decoder.decode(bytes.subarray(start)) };
  } catch {
    return { ok: false, message: INVALID_TEXT_MESSAGE };
  }
}

export async function readPatchFile(file: Blob): Promise<DecodeResult> {
  if (file.size > MAX_PATCH_FILE_BYTES) return { ok: false, message: TOO_LARGE_MESSAGE };
  try {
    return decodePatchBytes(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { ok: false, message: "Couldn't read this file." };
  }
}
