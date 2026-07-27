const { test, expect, describe } = require('bun:test');
const DataCache = require('../../public/js/data-cache.js');

describe('isFresh', () => {
  test('is false for a missing/null entry', () => {
    expect(DataCache.isFresh(null)).toBe(false);
    expect(DataCache.isFresh(undefined)).toBe(false);
  });

  test('is true for an entry fetched just now', () => {
    expect(DataCache.isFresh({ fetchedAt: Date.now() })).toBe(true);
  });

  test('is false for an entry older than the TTL', () => {
    const stale = { fetchedAt: Date.now() - DataCache.TTL_MS - 1000 };
    expect(DataCache.isFresh(stale)).toBe(false);
  });

  test('is true for an entry just inside the TTL', () => {
    const fresh = { fetchedAt: Date.now() - (DataCache.TTL_MS - 1000) };
    expect(DataCache.isFresh(fresh)).toBe(true);
  });
});
