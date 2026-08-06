const { test, expect, describe } = require('bun:test');
const { levelFor, monthYear, computeColumns, buildGrid } = require('../../public/js/contrib-graph.js');

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

describe('computeColumns', () => {
  // COL_PX = CELL_PX(10) + GAP_PX(2) = 12
  test('derives the column count from available width', () => {
    expect(computeColumns(1200, 700)).toBe(100); // 1200/12 = 100, well under the 100-week cap
  });

  test('caps at the number of whole weeks available', () => {
    expect(computeColumns(10000, 70)).toBe(10); // 70 days = 10 whole weeks, far less than 10000/12
  });

  test('never returns less than 1 column even at zero width', () => {
    expect(computeColumns(0, 700)).toBe(1);
  });

  test('never returns less than 1 column even with under a week of data', () => {
    expect(computeColumns(1200, 3)).toBe(1);
  });
});

describe('buildGrid', () => {
  function days(n, startDate) {
    var start = new Date(startDate + 'T00:00:00Z');
    var out = [];
    for (var i = 0; i < n; i++) {
      var d = new Date(start.getTime() + i * 86400000);
      out.push({ date: d.toISOString().slice(0, 10), count: i % 11 });
    }
    return out;
  }

  test('renders exactly columns * 7 cells from the most recent days', () => {
    var grid = buildGrid(days(21, '2026-01-01'), 2);
    var count = (grid.cellsHtml.match(/contrib-cell/g) || []).length;
    expect(count).toBe(14);
  });

  test('labels left/center/right from the first day of the corresponding column', () => {
    var grid = buildGrid(days(21, '2026-01-01'), 3);
    // last 21 days = all of them here; columns start 2026-01-01, -08, -15
    expect(grid.leftLabel).toBe('Jan 2026');
    expect(grid.centerLabel).toBe('Jan 2026');
    expect(grid.rightLabel).toBe('Jan 2026');
  });

  test('picks up a month boundary correctly across columns', () => {
    var grid = buildGrid(days(14, '2026-01-25'), 2); // second column starts 2026-02-01
    expect(grid.leftLabel).toBe('Jan 2026');
    expect(grid.rightLabel).toBe('Feb 2026');
  });

  test('each cell title reflects its own day count and date', () => {
    var grid = buildGrid(days(7, '2026-03-01'), 1);
    expect(grid.cellsHtml).toContain('0 contributions on 2026-03-01');
    expect(grid.cellsHtml).toContain('1 contribution on 2026-03-02');
  });
});
