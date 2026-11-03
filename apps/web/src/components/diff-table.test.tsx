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
      `f-${FILE}-L4`,
      `f-${FILE}-R4`,
      `f-${FILE}-R5`,
      `f-${FILE}-R6`,
      `f-${FILE}-L20`,
      `f-${FILE}-R21`,
    ]);
    // A context line shows both numbers, both linking to its new-side anchor.
    expect(hrefs(html).filter((h) => h === `#f-${FILE}-R3`)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`href="#f-${FILE}-L4"[^>]*>4</a>`));
    expect(html).toMatch(new RegExp(`href="#f-${FILE}-R21"[^>]*>21</a>`));
  });

  it('shows +/− markers with screen-reader labels', async () => {
    const html = await render('unified');
    expect(html.match(/>\+<\/td>/g)).toHaveLength(3);
    expect(html.match(/>−<\/td>/g)).toHaveLength(2);
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
    const row = html.split('<tr>').find((tr) => tr.includes(`id="f-${FILE}-R5"`))!;
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
