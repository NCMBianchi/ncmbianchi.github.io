const { test, expect, describe } = require('bun:test');
const { esc, fmtPercent } = require('../../public/js/skills-languages.js');

describe('esc', () => {
  test('escapes html-sensitive characters', () => {
    expect(esc('C++ & C#')).toBe('C++ &amp; C#');
  });
});

describe('fmtPercent', () => {
  test('drops a trailing .0 for whole numbers', () => {
    expect(fmtPercent(42)).toBe('42');
    expect(fmtPercent(7)).toBe('7');
  });

  test('rounds to one decimal place otherwise', () => {
    expect(fmtPercent(12.345)).toBe('12.3');
    expect(fmtPercent(0.049)).toBe('0');
  });
});
