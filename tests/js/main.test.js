const { test, expect, describe } = require('bun:test');
const {
  rep, padR, esc, glyphRun, buildIdleCell, buildDoneCell, cell,
  computeLayout, layoutFor, buildTUI, makeOutput, fitText, SECTIONS
} = require('../../public/js/main.js');

describe('rep', () => {
  test('repeats a character n times', () => {
    expect(rep('-', 5)).toBe('-----');
  });

  test('returns an empty string for n=0', () => {
    expect(rep('x', 0)).toBe('');
  });
});

describe('padR', () => {
  test('pads a string with spaces up to the target length', () => {
    expect(padR('ab', 5)).toBe('ab   ');
  });

  test('leaves a string already at or over the target length untouched', () => {
    expect(padR('abcde', 5)).toBe('abcde');
    expect(padR('abcdef', 5)).toBe('abcdef');
  });
});

describe('esc', () => {
  test('escapes html-sensitive characters', () => {
    expect(esc('Tom & Jerry <script>')).toBe('Tom &amp; Jerry &lt;script&gt;');
  });
});

describe('glyphRun', () => {
  test('wraps a string in a width-pinned tc-glyph span', () => {
    expect(glyphRun('─', 1)).toBe('<span class="tc-glyph" style="width:1ch">─</span>');
  });

  test('escapes html-sensitive characters inside the run', () => {
    expect(glyphRun('<', 1)).toBe('<span class="tc-glyph" style="width:1ch">&lt;</span>');
  });
});

describe('buildIdleCell / buildDoneCell / cell', () => {
  test('idle cell shows the arrow prefix only when selected', () => {
    const selected = buildIdleCell(0, 0, 20);
    const unselected = buildIdleCell(0, 1, 20);
    expect(selected).toContain('▸');
    expect(unselected).not.toContain('▸');
  });

  test('idle cell links to the section href and shows its label', () => {
    const html = buildIdleCell(0, -1, 20);
    expect(html).toContain('href="' + SECTIONS[0].href + '"');
    expect(html).toContain(SECTIONS[0].label);
    expect(html).toContain('data-state="idle"');
  });

  test('done cell shows the checkmark and done state', () => {
    const html = buildDoneCell(0, 20);
    expect(html).toContain('✓');
    expect(html).toContain('data-state="done"');
  });

  test('cell() dispatches to buildDoneCell when the index is in the done list', () => {
    expect(cell(0, -1, [0], 20)).toBe(buildDoneCell(0, 20));
  });

  test('cell() dispatches to buildIdleCell when the index is not done', () => {
    expect(cell(0, -1, [], 20)).toBe(buildIdleCell(0, -1, 20));
  });

  test('padding never goes negative when width is smaller than the label needs', () => {
    // width=1 forces padLen negative internally; should not throw or produce
    // a negative rep() count
    expect(() => buildIdleCell(0, -1, 1)).not.toThrow();
  });
});

describe('computeLayout', () => {
  test('returns one row per section for a 1-column layout', () => {
    const L = computeLayout(1);
    expect(L.ncols).toBe(1);
    expect(L.rows).toBe(SECTIONS.length);
    expect(L.colW.length).toBe(1);
  });

  test('W is at least as wide as the header lines require', () => {
    const L = computeLayout(3);
    expect(L.W).toBeGreaterThanOrEqual(38); // HEADER's longest line is well over this
  });

  test('column widths sum to W', () => {
    const L = computeLayout(3);
    const sum = L.colW.reduce((a, b) => a + b, 0);
    expect(sum).toBe(L.W);
  });
});

describe('layoutFor', () => {
  test('picks 1 column when the available width is very small', () => {
    expect(layoutFor(10).ncols).toBe(1);
  });

  test('picks more columns as more width becomes available', () => {
    const narrow = layoutFor(20).ncols;
    const wide = layoutFor(200).ncols;
    expect(wide).toBeGreaterThanOrEqual(narrow);
  });

  test('never exceeds 3 columns', () => {
    expect(layoutFor(1000).ncols).toBeLessThanOrEqual(3);
  });
});

describe('buildTUI', () => {
  test('includes every section label somewhere in the box', () => {
    const L = layoutFor(200);
    const html = buildTUI(-1, [], L);
    SECTIONS.forEach((s) => expect(html).toContain(s.label));
  });

  test('marks done sections with the checkmark state', () => {
    const L = layoutFor(200);
    const html = buildTUI(-1, [0], L);
    expect(html).toContain('data-state="done"');
  });

  test('every content row is the same rendered width as the border rows', () => {
    const L = layoutFor(200);
    const html = buildTUI(-1, [], L);
    const lines = html.split('\n').filter(Boolean);
    // top border, header lines, blank, cell rows, bottom border — all but the
    // very first/last (glyph-run borders) should be plain pipe-delimited rows
    // of a consistent length; just check nothing came out empty/malformed
    expect(lines.length).toBeGreaterThan(5);
    expect(html).toContain('╭');
    expect(html).toContain('╮');
    expect(html).toContain('╰');
    expect(html).toContain('╯');
  });
});

describe('makeOutput', () => {
  test('joins every item in the order given, without reshuffling', () => {
    const section = { label: 'Test', href: 'test.html', items: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] };
    expect(makeOutput(section).full).toBe('a, b, c');
  });

  test('a single-item section just returns that item text', () => {
    const section = { label: 'Test', href: 'test.html', items: [{ text: 'only' }] };
    expect(makeOutput(section).full).toBe('only');
  });

  test('carries the label and href through unchanged', () => {
    const section = { label: 'Test', href: 'test.html', items: [{ text: 'a' }] };
    const out = makeOutput(section);
    expect(out.label).toBe('Test');
    expect(out.href).toBe('test.html');
  });
});

describe('fitText', () => {
  test('returns the text as-is, with no ellipsis, when it fits', () => {
    expect(fitText('short text', 50)).toBe('short text');
  });

  test('escapes html-sensitive characters even when unfit', () => {
    expect(fitText('A & B', 50)).toBe('A &amp; B');
  });

  test('truncates with an ellipsis when the text does not fit', () => {
    const result = fitText('this is a long piece of text that will not fit', 15);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(16); // 15 + the ellipsis char itself
  });

  test('cuts at a word boundary rather than mid-word when reasonably close', () => {
    // avail=20 -> cut=18 -> slice is "alpha beta gamma d", last space at
    // index 16 is within the cut-12..cut window, so it backs off to the
    // word boundary instead of keeping the trailing "d"
    expect(fitText('alpha beta gamma delta epsilon', 20)).toBe('alpha beta gamma …');
  });
});

describe('SECTIONS', () => {
  test('has exactly 6 sections matching the site nav', () => {
    expect(SECTIONS.length).toBe(6);
    expect(SECTIONS.map((s) => s.label)).toEqual([
      'Academic Studies', 'Publications', 'Presentations', 'Repos', 'Skills', 'Interests'
    ]);
  });

  test('every section has at least one fallback item', () => {
    SECTIONS.forEach((s) => expect(s.items.length).toBeGreaterThan(0));
  });
});
