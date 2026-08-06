const { test, expect, describe, beforeEach, afterEach, afterAll } = require('bun:test');

/* A minimal document/window stub, defined before the require below, so the
   one-and-only module evaluation of presentations.js also runs its DOM-
   wiring tail (past the `typeof document === 'undefined'` guard) instead of
   returning early — that tail is otherwise 0% covered under plain `bun
   test`. Deliberately done once at the top, not via a second require() in a
   separate file: Bun's coverage instrumentation is per module-instance, and
   an earlier attempt that busted require.cache to re-require a second,
   separately-stubbed instance made overall coverage worse, not better — the
   second instance's own (much smaller) set of hits replaced the first
   instance's, discarding all the coverage the plain-logic tests below
   already earned. Cleaned up in afterAll so it doesn't leak into files that
   require other public/js/*.js modules later in the same test run. */
var domList = { innerHTML: '' };
var domStatus = { textContent: '', innerHTML: '' };
var domCapturedOpts;
globalThis.document = {
  getElementById: (id) => ({ 'pres-list': domList, 'pres-status': domStatus }[id] || null)
};
globalThis.window = { DataCache: { load: (opts) => { domCapturedOpts = opts; } } };

const { esc, doiInfo, renderCard, liveFetch } = require('../../public/js/presentations.js');

afterAll(() => {
  delete globalThis.document;
  delete globalThis.window;
});

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
  test('escapes html-sensitive characters', () => {
    expect(esc('A & B < C > D')).toBe('A &amp; B &lt; C &gt; D');
  });
});

describe('doiInfo', () => {
  test('labels a structured zenodo doi as Zenodo', () => {
    const work = {
      'external-ids': { 'external-id': [
        { 'external-id-type': 'doi', 'external-id-value': '10.5281/zenodo.123', 'external-id-url': { value: 'https://doi.org/10.5281/zenodo.123' } }
      ] }
    };
    expect(doiInfo(work)).toEqual({ code: '10.5281/zenodo.123', url: 'https://doi.org/10.5281/zenodo.123', label: 'Zenodo' });
  });

  test('labels a structured non-zenodo doi as DOI', () => {
    const work = {
      'external-ids': { 'external-id': [
        { 'external-id-type': 'doi', 'external-id-value': '10.1/x', 'external-id-url': { value: 'https://doi.org/10.1/x' } }
      ] }
    };
    expect(doiInfo(work).label).toBe('DOI');
  });

  test('extracts a doi from the free-text citation when no structured id exists', () => {
    const work = { citation: { 'citation-value': 'See https://doi.org/10.5281/zenodo.999 for slides.' } };
    const info = doiInfo(work);
    expect(info.code).toBe('10.5281/zenodo.999');
    expect(info.label).toBe('Zenodo');
  });

  test('strips trailing punctuation off a citation-extracted doi', () => {
    const work = { citation: { 'citation-value': 'DOI: 10.1234/abc.def.' } };
    expect(doiInfo(work).code).toBe('10.1234/abc.def');
  });

  test('falls back to the plain work url labelled Link', () => {
    const work = { url: { value: 'https://example.com/slides' } };
    expect(doiInfo(work)).toEqual({ code: null, url: 'https://example.com/slides', label: 'Link' });
  });

  test('returns null when nothing at all is available', () => {
    expect(doiInfo({})).toBeNull();
  });
});

describe('renderCard', () => {
  test('renders the event and a Zenodo tag with its code', () => {
    const work = {
      'publication-date': { year: { value: '2023' } },
      type: 'conference-presentation',
      title: { title: { value: 'A Talk' } },
      'journal-title': { value: 'Some Conference' },
      'external-ids': { 'external-id': [
        { 'external-id-type': 'doi', 'external-id-value': '10.5281/zenodo.42', 'external-id-url': { value: 'https://doi.org/10.5281/zenodo.42' } }
      ] }
    };
    const html = renderCard(work);
    expect(html).toContain('Conference Presentation');
    expect(html).toContain('Some Conference');
    expect(html).toContain('Zenodo: 10.5281/zenodo.42');
  });

  test('omits the event paragraph when there is none', () => {
    const work = { type: 'presentation', title: { title: { value: 'Talk' } } };
    expect(renderCard(work)).not.toContain('pres-event');
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

  test('filters to presentation-ish types and sorts newest first', () => {
    mockFetch((url) => {
      if (url.includes('/works')) {
        return { group: [
          { 'work-summary': [summary('conference-presentation', 2022, 1)] },
          { 'work-summary': [summary('lecture-speech', 2026, 2)] },
          { 'work-summary': [summary('journal-article', 2026, 3)] } // belongs on publications.html, not here
        ] };
      }
      const putCode = url.split('/').pop();
      return { 'put-code': putCode };
    });

    return liveFetch().then((works) => {
      expect(works.length).toBe(2);
      expect(works[0]['put-code']).toBe('2'); // 2026 (newest) first
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

describe('DOM wiring (the module-level DataCache.load call)', () => {
  test('wires DataCache.load with the right cache key, snapshot url and liveFetch', () => {
    expect(domCapturedOpts.cacheKey).toBe('pres-cache-v1');
    expect(domCapturedOpts.snapshotUrl).toBe('data/presentations.json');
    expect(typeof domCapturedOpts.liveFetch).toBe('function');
  });

  test('onData renders works into the list element', () => {
    const work = { type: 'presentation', title: { title: { value: 'Talk' } } };
    domCapturedOpts.onData([work]);
    expect(domList.innerHTML).toContain('pres-card');
  });

  test('onData with no works sets the empty-state status message', () => {
    domCapturedOpts.onData([]);
    expect(domStatus.textContent).toBe('No presentations on record yet.');
  });

  test('onError sets a fallback status message linking to the ORCID record', () => {
    domCapturedOpts.onError(new Error('boom'));
    expect(domStatus.innerHTML).toContain('orcid.org');
  });
});
