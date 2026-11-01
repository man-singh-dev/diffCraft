import { describe, expect, it } from 'vitest';
import {
  decodePatchBytes,
  INVALID_TEXT_MESSAGE,
  MAX_PATCH_FILE_BYTES,
  readPatchFile,
  TOO_LARGE_MESSAGE,
} from './decode-patch-file.js';

const TEXT = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-é\n+ü 😀\n';
const BOM = String.fromCharCode(0xfeff);

const utf8 = (text: string) => new TextEncoder().encode(text);

function utf16(text: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (let k = 0; k < text.length; k++) view.setUint16(k * 2, text.charCodeAt(k), littleEndian);
  return bytes;
}

const concat = (...parts: (number[] | Uint8Array)[]) =>
  Uint8Array.from(parts.flatMap((part) => Array.from(part)));

describe('decodePatchBytes', () => {
  it('decodes UTF-8 without a BOM', () => {
    expect(decodePatchBytes(utf8(TEXT))).toEqual({ ok: true, text: TEXT });
  });

  it('strips a UTF-8 BOM (EF BB BF)', () => {
    expect(decodePatchBytes(concat([0xef, 0xbb, 0xbf], utf8(TEXT)))).toEqual({
      ok: true,
      text: TEXT,
    });
  });

  it('keeps a second BOM as text, like parsePatch', () => {
    const bytes = concat([0xef, 0xbb, 0xbf], utf8(`${BOM}${TEXT}`));
    expect(decodePatchBytes(bytes)).toEqual({ ok: true, text: `${BOM}${TEXT}` });
  });

  it('decodes UTF-16 LE by its BOM (FF FE)', () => {
    expect(decodePatchBytes(concat([0xff, 0xfe], utf16(TEXT, true)))).toEqual({
      ok: true,
      text: TEXT,
    });
  });

  it('decodes UTF-16 BE by its BOM (FE FF)', () => {
    expect(decodePatchBytes(concat([0xfe, 0xff], utf16(TEXT, false)))).toEqual({
      ok: true,
      text: TEXT,
    });
  });

  it('decodes an empty file to empty text', () => {
    expect(decodePatchBytes(new Uint8Array())).toEqual({ ok: true, text: '' });
  });

  it.each([
    ['a lone continuation byte', [0x80]],
    ['a truncated sequence', [0x61, 0xc3]],
    ['Latin-1 text', [0x63, 0x61, 0x66, 0xe9]],
    ['an overlong encoding', [0xc0, 0xaf]],
  ])('rejects invalid UTF-8: %s', (_, bytes) => {
    expect(decodePatchBytes(Uint8Array.from(bytes))).toEqual({
      ok: false,
      message: INVALID_TEXT_MESSAGE,
    });
  });

  it('rejects UTF-16 with an odd number of bytes', () => {
    expect(decodePatchBytes(Uint8Array.from([0xff, 0xfe, 0x61, 0x00, 0x62]))).toEqual({
      ok: false,
      message: INVALID_TEXT_MESSAGE,
    });
  });

  it('rejects UTF-16 with an unpaired surrogate', () => {
    expect(decodePatchBytes(Uint8Array.from([0xff, 0xfe, 0x00, 0xd8, 0x61, 0x00]))).toEqual({
      ok: false,
      message: INVALID_TEXT_MESSAGE,
    });
  });

  it('decodes UTF-16 without a BOM as UTF-8 (the NULs are left for parsePatch to reject)', () => {
    const result = decodePatchBytes(utf16('ab', true));
    expect(result).toEqual({ ok: true, text: 'a\0b\0' });
  });
});

describe('readPatchFile', () => {
  it('reads and decodes a file', async () => {
    const file = new Blob([concat([0xff, 0xfe], utf16(TEXT, true))]);
    expect(await readPatchFile(file)).toEqual({ ok: true, text: TEXT });
  });

  it('accepts a file of exactly 1 MiB', async () => {
    const file = new Blob([new Uint8Array(MAX_PATCH_FILE_BYTES).fill(0x61)]);
    const result = await readPatchFile(file);
    expect(result.ok).toBe(true);
  });

  it('rejects a file over 1 MiB without reading it', async () => {
    const file = new Blob([new Uint8Array(MAX_PATCH_FILE_BYTES + 1)]);
    let read = false;
    const spy = Object.assign(file, {
      arrayBuffer: () => {
        read = true;
        return Promise.resolve(new ArrayBuffer(0));
      },
    });
    expect(await readPatchFile(spy)).toEqual({ ok: false, message: TOO_LARGE_MESSAGE });
    expect(read).toBe(false);
  });

  it('turns a read failure into a message', async () => {
    const file = Object.assign(new Blob(['x']), {
      arrayBuffer: () => Promise.reject(new Error('NotReadableError')),
    });
    expect(await readPatchFile(file)).toEqual({ ok: false, message: "Couldn't read this file." });
  });
});
