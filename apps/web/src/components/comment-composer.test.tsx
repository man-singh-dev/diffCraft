import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommentComposer, insertSuggestion } from './comment-composer';

const FENCE = '```';

describe('insertSuggestion', () => {
  it('into an empty composer, with the cursor after the line', () => {
    const result = insertSuggestion('', 0, 0, 'const b = 3;');
    expect(result.value).toBe(`${FENCE}suggestion\nconst b = 3;\n${FENCE}`);
    expect(result.value.slice(0, result.cursor)).toBe(`${FENCE}suggestion\nconst b = 3;`);
  });

  it('appended after text, on its own lines', () => {
    const result = insertSuggestion('Try this:', 9, 9, 'x');
    expect(result.value).toBe(`Try this:\n${FENCE}suggestion\nx\n${FENCE}`);
  });

  it('at a cursor in the middle of a line, splitting it', () => {
    expect(insertSuggestion('abcdef', 3, 3, 'x').value).toBe(
      `abc\n${FENCE}suggestion\nx\n${FENCE}\ndef`,
    );
  });

  it('at the start of a line, without extra blank lines', () => {
    expect(insertSuggestion('a\nb', 2, 2, 'x').value).toBe(`a\n${FENCE}suggestion\nx\n${FENCE}\nb`);
  });

  it('replaces a selection', () => {
    expect(insertSuggestion('keep DROP keep', 5, 9, 'x').value).toBe(
      `keep \n${FENCE}suggestion\nx\n${FENCE}\n keep`,
    );
  });
});

describe('CommentComposer', () => {
  const render = (props: Partial<Parameters<typeof CommentComposer>[0]>) =>
    renderToStaticMarkup(
      <CommentComposer label="Reply" submitLabel="Reply" onSubmit={async () => null} {...props} />,
    );

  it('offers "Suggest change" only with a line to suggest from', () => {
    expect(render({ suggestionLine: 'const b = 3;' })).toContain('Suggest change');
    expect(render({})).not.toContain('Suggest change');
  });

  it('disables it once the body has a suggestion', () => {
    const html = render({
      suggestionLine: 'x',
      initialValue: `${FENCE}suggestion\ny\n${FENCE}`,
    });
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Suggest change/);
  });
});
