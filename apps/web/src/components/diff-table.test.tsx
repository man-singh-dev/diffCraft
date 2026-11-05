import { parsePatch } from '@diffcraft/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// server-only throws outside a React Server Components build.
vi.mock('server-only', () => ({}));

const { highlightedRows } = await import('../lib/diff-view.server.js');
const { DiffTable } = await import('./diff-table.js');

const FILE = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';

const patch = [
  '--- a/page.ts',
  '+++ b/page.ts',
  '@@ -3,3 +3,4 @@ function render()',
  ' const a = 1;',
  '-const html = "<b>";',
  '+const html = "<script>alert(1)</script>";',
  '+',
  ' const z = 26;',
  '@@ -20 +21 @@',
  '-old',
  '\\ No newline at end of file',
  '+new',
  '\\ No newline at end of file',
  '',
].join('\n');
const hunks = parsePatch(patch).files[0]!.hunks;

async function render(view: 'unified' | 'split') {
  const diff = await highlightedRows('page.ts', hunks, view);
  return renderToStaticMarkup(<DiffTable fileId={FILE} diff={diff} />);
}

const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
/** The rendered text, still HTML-escaped: the markup between the tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, '');
const hrefs = (html: string) => [...html.matchAll(/ href="([^"]+)"/g)].map((m) => m[1]);

describe('DiffTable (unified)', () => {
  it('rows have line anchors as ids, and line numbers link to them', async () => {
    const html = await render('unified');
    expect(ids(html)).toEqual([
      `f-${FILE}-R3`,
      `f-${FILE}-L3`, // a context row's old number also has an id
      `f-${FILE}-L4`,
      `f-${FILE}-R4`,
      `f-${FILE}-R5`,
      `f-${FILE}-R6`,
      `f-${FILE}-L5`,
      `f-${FILE}-L20`,
      `f-${FILE}-R21`,
    ]);
    // A context line shows both numbers: the row is its new-side anchor, the old number its old one.
    expect(html).toMatch(new RegExp(`<tr id="f-${FILE}-R3"`));
    expect(html).toMatch(new RegExp(`id="f-${FILE}-L3" href="#f-${FILE}-L3"[^>]*>3</a>`));
    expect(html).toMatch(new RegExp(`href="#f-${FILE}-R3"[^>]*>3</a>`));
    expect(html).toMatch(new RegExp(`href="#f-${FILE}-L4"[^>]*>4</a>`));
    expect(html).toMatch(new RegExp(`href="#f-${FILE}-R21"[^>]*>21</a>`));
  });

  it('shows +/− markers with screen-reader labels', async () => {
    const html = await render('unified');
    expect(html.match(/<span aria-hidden="true">\+<\/span>/g)).toHaveLength(3);
    expect(html.match(/<span aria-hidden="true">−<\/span>/g)).toHaveLength(2);
    expect(html.match(/added line: /g)).toHaveLength(3);
    expect(html.match(/removed line: /g)).toHaveLength(2);
  });

  it('hunk headers, a gap row and the no-newline marker', async () => {
    const html = await render('unified');
    expect(html).toContain('@@ -3,3 +3,4 @@ function render()');
    expect(html).toContain('@@ -20 +21 @@');
    expect(html).toContain('⋯ 2 lines hidden'); // old lines 1–2 before the first hunk
    expect(html).toContain('⋯ 14 lines hidden'); // old lines 6–19 between the hunks
    expect(html.match(/No newline at end of file/g)).toHaveLength(2);
  });

  it('escapes code: a <script> line is text, not markup', async () => {
    const html = await render('unified');
    expect(html).not.toMatch(/<script/i);
    expect(text(html)).toContain('&quot;&lt;script&gt;alert(1)&lt;/script&gt;&quot;');
  });

  it('colors pieces with inline styles and marks changed words', async () => {
    const html = await render('unified');
    expect(html).toMatch(/<span style="color:#[0-9A-Fa-f]{6}"[^>]*>const<\/span>/);
    expect(html).toMatch(/class="[^"]*bg-red-400\/35[^"]*"/);
    expect(html).toMatch(/class="[^"]*bg-emerald-400\/30[^"]*"/);
  });
});

describe('DiffTable (split)', () => {
  it('each half has its own anchor; a context row has both', async () => {
    const html = await render('split');
    expect(ids(html)).toEqual([
      `f-${FILE}-L3`,
      `f-${FILE}-R3`,
      `f-${FILE}-L4`,
      `f-${FILE}-R4`,
      `f-${FILE}-R5`,
      `f-${FILE}-L5`,
      `f-${FILE}-R6`,
      `f-${FILE}-L20`,
      `f-${FILE}-R21`,
    ]);
    expect(hrefs(html)).toEqual(ids(html).map((id) => `#${id}`));
  });

  it('a leftover added line has an empty left half', async () => {
    const html = await render('split');
    const row = html.split('<tr').find((tr) => tr.includes(`id="f-${FILE}-R5"`))!;
    // Three empty, darker cells before the right half.
    expect(row.match(/<td class="[^"]*bg-slate-950\/70[^"]*"><\/td>/g)).toHaveLength(3);
    expect(row).toContain('added line: ');
    expect(row).not.toContain('removed line: ');
  });

  it('escapes code in the split view too', async () => {
    const html = await render('split');
    expect(html).not.toMatch(/<script/i);
    expect(text(html)).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('DiffTable: changed-word emphasis', () => {
  const emphasisPatch = [
    '--- a/config.ts',
    '+++ b/config.ts',
    '@@ -1,2 +1,3 @@',
    '-export const timeout = 3000;',
    '+export const timeout = 4000;',
    '+export const retries = 2;',
    ' export default timeout;',
    '',
  ].join('\n');
  const emphasisHunks = parsePatch(emphasisPatch).files[0]!.hunks;
  const EMPHASIS = /bg-(red|emerald)-400\/3\d/;

  /** The emphasised text of each line, keyed by its line anchor's suffix ("L1", "R2", …). */
  async function emphasised(view: 'unified' | 'split') {
    const diff = await highlightedRows('config.ts', emphasisHunks, view);
    const html = renderToStaticMarkup(<DiffTable fileId={FILE} diff={diff} />);
    const byLine: Record<string, string[]> = {};
    for (const tr of html.split('<tr').slice(1)) {
      // Unified rows have one anchor; split rows have one per half, each followed by its cells.
      const halves = tr.split(/(?= id="f-)/).filter((part) => part.startsWith(' id="f-'));
      for (const half of halves) {
        const line = /-(L|R)\d+(?=")/.exec(half)![0].slice(1);
        byLine[line] = [...half.matchAll(/<span[^>]*class="([^"]*)"[^>]*>([^<]*)<\/span>/g)]
          .filter((m) => EMPHASIS.test(m[1]!))
          .map((m) => m[2]!);
      }
    }
    return byLine;
  }

  it.each(['unified', 'split'] as const)(
    '%s: only the changed number of a paired line is emphasised; an unpaired line has none',
    async (view) => {
      const lines = await emphasised(view);
      expect(lines.L1).toEqual(['3000']);
      expect(lines.R1).toEqual(['4000']);
      expect(lines.R2).toEqual([]); // unpaired added line: line background only
      expect(lines.R3).toEqual([]); // context
    },
  );

  it('a pair that fell back to whole-line has no emphasis', async () => {
    // "old" → "new" share no tokens, so diffWords marks each whole line changed.
    for (const view of ['unified', 'split'] as const) {
      const diff = await highlightedRows('page.ts', hunks, view);
      const html = renderToStaticMarkup(<DiffTable fileId={FILE} diff={diff} />);
      const secondHunk = html.slice(html.indexOf('@@ -20 +21 @@'));
      expect(secondHunk).toContain('old');
      expect(secondHunk).not.toMatch(EMPHASIS);
    }
  });
});
