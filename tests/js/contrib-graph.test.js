const { test, expect, describe } = require('bun:test');
const { levelFor, monthYear } = require('../../public/js/contrib-graph.js');

describe('levelFor', () => {
  test('buckets zero and negative counts as level 0', () => {
    expect(levelFor(0)).toBe(0);
    expect(levelFor(-1)).toBe(0);
  });

  test('buckets the low range as level 1', () => {
    expect(levelFor(1)).toBe(1);
    expect(levelFor(2)).toBe(1);
  });

  test('buckets the mid ranges as levels 2 and 3', () => {
    expect(levelFor(5)).toBe(2);
    expect(levelFor(9)).toBe(3);
  });

  test('buckets anything above 9 as level 4', () => {
    expect(levelFor(10)).toBe(4);
    expect(levelFor(50)).toBe(4);
  });
});

describe('monthYear', () => {
  test('formats a date string as "Mon YYYY" in UTC', () => {
    expect(monthYear('2026-01-15')).toBe('Jan 2026');
    expect(monthYear('2025-12-31')).toBe('Dec 2025');
  });
});
