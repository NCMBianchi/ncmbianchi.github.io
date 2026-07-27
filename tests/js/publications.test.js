const { test, expect, describe } = require('bun:test');
const { esc, doiInfo, authorsOf, renderCard } = require('../../public/js/publications.js');

describe('esc', () => {
  test('escapes ampersand, less-than and greater-than', () => {
    expect(esc('Tom & Jerry <script>')).toBe('Tom &amp; Jerry &lt;script&gt;');
  });

  test('coerces non-strings', () => {
    expect(esc(2024)).toBe('2024');
  });
});

describe('doiInfo', () => {
  test('reads the structured doi external-id when present', () => {
    const work = {
      'external-ids': { 'external-id': [
        { 'external-id-type': 'doi', 'external-id-value': '10.1186/foo', 'external-id-url': { value: 'https://doi.org/10.1186/foo' } }
      ] }
    };
    expect(doiInfo(work)).toEqual({ code: '10.1186/foo', url: 'https://doi.org/10.1186/foo' });
  });

  test('falls back to the work url when there is no doi', () => {
    const work = { url: { value: 'https://example.com/paper' } };
    expect(doiInfo(work)).toEqual({ code: null, url: 'https://example.com/paper' });
  });

  test('returns null when neither a doi nor a url exists', () => {
    expect(doiInfo({})).toBeNull();
  });
});

describe('authorsOf', () => {
  test('joins credit-names with a comma', () => {
    const work = { contributors: { contributor: [
      { 'credit-name': { value: 'A. Person' } },
      { 'credit-name': { value: 'B. Person' } }
    ] } };
    expect(authorsOf(work)).toBe('A. Person, B. Person');
  });

  test('skips contributors with no credit-name', () => {
    const work = { contributors: { contributor: [
      { 'credit-name': { value: 'A. Person' } },
      {}
    ] } };
    expect(authorsOf(work)).toBe('A. Person');
  });

  test('returns empty string when there are no contributors', () => {
    expect(authorsOf({})).toBe('');
  });
});

describe('renderCard', () => {
  const work = {
    'publication-date': { year: { value: '2024' } },
    type: 'journal-article',
    title: { title: { value: 'A <Great> Paper' } },
    'journal-title': { value: 'Nature & Friends' },
    'external-ids': { 'external-id': [
      { 'external-id-type': 'doi', 'external-id-value': '10.1/x', 'external-id-url': { value: 'https://doi.org/10.1/x' } }
    ] },
    contributors: { contributor: [ { 'credit-name': { value: 'Jane Doe' } } ] },
    _citations: 1
  };

  test('escapes title, venue and includes year/type', () => {
    const html = renderCard(work);
    expect(html).toContain('2024');
    expect(html).toContain('Journal Article');
    expect(html).toContain('A &lt;Great&gt; Paper');
    expect(html).toContain('Nature &amp; Friends');
    expect(html).toContain('Jane Doe');
  });

  test('links the title to the doi and shows the DOI tag', () => {
    const html = renderCard(work);
    expect(html).toContain('href="https://doi.org/10.1/x"');
    expect(html).toContain('DOI: 10.1/x');
  });

  test('shows a singular citation count correctly', () => {
    const html = renderCard(work);
    expect(html).toContain('1 citation<');
  });

  test('shows a plural citation count correctly', () => {
    const html = renderCard(Object.assign({}, work, { _citations: 3 }));
    expect(html).toContain('3 citations<');
  });

  test('falls back to a plain "Link" tag when there is no doi code', () => {
    const noDoi = Object.assign({}, work, { 'external-ids': undefined, url: { value: 'https://example.com' } });
    const html = renderCard(noDoi);
    expect(html).toContain('>Link<');
  });
});
