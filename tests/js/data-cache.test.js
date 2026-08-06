const { test, expect, describe, beforeEach, afterEach } = require('bun:test');
const DataCache = require('../../public/js/data-cache.js');

/* localStorage is not a Bun global (confirmed: bare `localStorage` throws
   ReferenceError under `bun -e`) — data-cache.js references it as a bare
   identifier, so a minimal in-memory mock is installed on globalThis for
   the load() tests below, and removed again afterwards. */
function makeLocalStorageMock() {
  var store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); }
  };
}

var originalFetch, hadLocalStorage, originalLocalStorage;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  hadLocalStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = makeLocalStorageMock();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (hadLocalStorage) { globalThis.localStorage = originalLocalStorage; }
  else { delete globalThis.localStorage; }
});

function mockFetch(handler) {
  globalThis.fetch = (url) => {
    const body = handler(url);
    if (body === null) return Promise.resolve({ ok: false, status: 404 });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
}

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

describe('load', () => {
  function run(opts) {
    return new Promise((resolve, reject) => {
      DataCache.load(Object.assign({
        cacheKey: 'test-key',
        snapshotUrl: 'data/test.json',
        onData: resolve,
        onError: reject
      }, opts));
    });
  }

  test('a fresh cache hit skips the network entirely', () => {
    globalThis.localStorage.setItem('test-key', JSON.stringify({ data: { from: 'cache' }, fetchedAt: Date.now() }));
    let liveCalled = false;
    return run({ liveFetch: () => { liveCalled = true; return Promise.resolve({ from: 'live' }); } })
      .then((data) => {
        expect(liveCalled).toBe(false);
        expect(data).toEqual({ from: 'cache' });
      });
  });

  test('no cache: live fetch success is used and refreshes the cache', () => {
    return run({ liveFetch: () => Promise.resolve({ from: 'live' }) })
      .then((data) => {
        expect(data).toEqual({ from: 'live' });
        const stored = JSON.parse(globalThis.localStorage.getItem('test-key'));
        expect(stored.data).toEqual({ from: 'live' });
      });
  });

  test('live fetch failure falls back to stale cache', () => {
    globalThis.localStorage.setItem('test-key', JSON.stringify({ data: { from: 'stale' }, fetchedAt: 0 }));
    return run({ liveFetch: () => Promise.reject(new Error('boom')) })
      .then((data) => {
        expect(data).toEqual({ from: 'stale' });
      });
  });

  test('live fetch failure with no cache falls back to the same-origin snapshot', () => {
    mockFetch(() => ({ from: 'snapshot' }));
    return run({ liveFetch: () => Promise.reject(new Error('boom')) })
      .then((data) => {
        expect(data).toEqual({ from: 'snapshot' });
      });
  });

  test('live fetch failure, no cache, snapshot failure all call onError', () => {
    mockFetch(() => null);
    return run({ liveFetch: () => Promise.reject(new Error('boom')) })
      .catch((err) => err)
      .then((err) => {
        expect(err).toBeInstanceOf(Error);
      });
  });
});
