const { test, expect, describe } = require('bun:test');
const { esc, doiInfo, renderCard } = require('../../public/js/presentations.js');

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
