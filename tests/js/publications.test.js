const { test, expect, describe, beforeEach, afterEach } = require('bun:test');
const { esc, doiInfo, authorsOf, renderCard, attachCitations, liveFetch } = require('../../public/js/publications.js');

var originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

function mockFetch(handler) {
  globalThis.fetch = (url) => {
    const body = handler(url);
    if (body === null) return Promise.resolve({ ok: false, status: 404 });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
}

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

describe('attachCitations', () => {
  test('attaches _citations from the per-DOI Semantic Scholar lookup', () => {
    mockFetch(() => ({ citationCount: 3 }));
    const works = [{ 'external-ids': { 'external-id': [
      { 'external-id-type': 'doi', 'external-id-value': '10.1/x' }
    ] } }];
    return attachCitations(works).then((result) => {
      expect(result[0]._citations).toBe(3);
    });
  });

  test('leaves works with no DOI untouched (no fetch attempted)', () => {
    let called = false;
    mockFetch(() => { called = true; return { citationCount: 3 }; });
    const works = [{}];
    return attachCitations(works).then((result) => {
      expect(called).toBe(false);
      expect(result[0]._citations).toBeUndefined();
    });
  });

  test('leaves _citations unset (no throw) when the lookup fails', () => {
    mockFetch(() => null);
    const works = [{ 'external-ids': { 'external-id': [
      { 'external-id-type': 'doi', 'external-id-value': '10.1/x' }
    ] } }];
    return attachCitations(works).then((result) => {
      expect(result[0]._citations).toBeUndefined();
    });
  });
});

describe('liveFetch', () => {
  function summary(type, year, putCode) {
    return {
      type: type,
      'put-code': putCode,
      'publication-date': { year: { value: String(year) } }
    };
  }

  test('filters to real paper types, sorts newest first, and fetches full detail', () => {
    mockFetch((url) => {
      if (url.includes('/works')) {
        return { group: [
          { 'work-summary': [summary('journal-article', 2023, 1)] },
          { 'work-summary': [summary('journal-article', 2025, 2)] },
          { 'work-summary': [summary('research-tool', 2025, 3)] } // belongs on repos.html, not here
        ] };
      }
      // per-work detail fetch — echo back a minimal work with the put-code baked in,
      // no DOI so attachCitations() (also exercised here) is a no-op
      const putCode = url.split('/').pop();
      return { 'put-code': putCode };
    });

    return liveFetch().then((works) => {
      expect(works.length).toBe(2); // research-tool excluded
      expect(works[0]['put-code']).toBe('2'); // 2025 (newest) first
      expect(works[1]['put-code']).toBe('1');
    });
  });

  test('resolves to an empty array when nothing matches', () => {
    mockFetch(() => ({ group: [] }));
    return liveFetch().then((works) => {
      expect(works).toEqual([]);
    });
  });
});
