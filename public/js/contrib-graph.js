/* Contribution graph — renders assets/contributions.json (generated
 * server-side by tools/contrib-graph via .github/workflows/contributions.yml)
 * as our own responsive grid, styled in Afterglow green rather than GitHub's.
 */
(function () {
  'use strict';

  var CELL_PX = 10;  /* must match .contrib-cell's width/height in style.css */
  var GAP_PX  = 2;   /* must match .contrib-graph's gap in style.css */
  var COL_PX  = CELL_PX + GAP_PX;

  function levelFor(count) {
    if (count <= 0) return 0;
    if (count <= 2) return 1;
    if (count <= 5) return 2;
    if (count <= 9) return 3;
    return 4;
  }

  function monthYear(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  /* how many whole 7-day columns fit `availableWidth`, capped by how many
     whole weeks `totalDays` actually has — split out of render() so the
     responsive-sizing math is testable without a DOM. */
  function computeColumns(availableWidth, totalDays) {
    var desiredColumns = Math.max(1, Math.floor(availableWidth / COL_PX));
    var maxColumns = Math.floor(totalDays / 7);
    return Math.max(1, Math.min(desiredColumns, maxColumns));
  }

  /* builds the grid's actual markup + month labels from the most recent
     `columns * 7` days — also split out of render() for the same reason;
     the only thing render() itself still does is measure the container's
     width, call this, and write the result into the DOM. */
  function buildGrid(allDays, columns) {
    var recentDays = allDays.slice(-(columns * 7));
    var cols = [];
    for (var c = 0; c < columns; c++) cols.push(recentDays.slice(c * 7, c * 7 + 7));

    var cellsHtml = cols.map(function (col) {
      return col.map(function (day) {
        var level = levelFor(day.count);
        var label = day.count + (day.count === 1 ? ' contribution on ' : ' contributions on ') + day.date;
        return '<span class="contrib-cell" data-level="' + level + '" title="' + label + '"></span>';
      }).join('');
    }).join('');

    return {
      cellsHtml: cellsHtml,
      leftLabel: monthYear(cols[0][0].date),
      centerLabel: monthYear(cols[Math.floor(cols.length / 2)][0].date),
      rightLabel: monthYear(cols[cols.length - 1][0].date)
    };
  }

  /* CommonJS export purely for `bun test` to require() the pure helpers
     above without a DOM — never runs in the browser (module is undefined
     there). Must sit before any document.* access below. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { levelFor: levelFor, monthYear: monthYear, computeColumns: computeColumns, buildGrid: buildGrid };
  }

  if (typeof document === 'undefined') return;

  var container = document.getElementById('contrib-graph');
  if (!container) return;

  var allDays = null; /* flat, chronological (oldest → newest), set once fetched */

  function render() {
    if (!allDays) return;

    var availableWidth = container.clientWidth || (container.parentElement && container.parentElement.clientWidth) || 0;
    var columns = computeColumns(availableWidth, allDays.length);
    var grid = buildGrid(allDays, columns);
    var cells = grid.cellsHtml;
    var leftLabel = grid.leftLabel, centerLabel = grid.centerLabel, rightLabel = grid.rightLabel;

    container.innerHTML =
      '<div class="contrib-graph-wrap">' +
        '<div class="contrib-inner">' +
          '<div class="contrib-months">' +
            '<span>' + leftLabel + '</span>' +
            '<span>' + centerLabel + '</span>' +
            '<span>' + rightLabel + '</span>' +
          '</div>' +
          '<div class="contrib-graph">' + cells + '</div>' +
        '</div>' +
        '<div class="contrib-legend">' +
          '<span>Less</span>' +
          '<span class="contrib-cell" data-level="0"></span>' +
          '<span class="contrib-cell" data-level="1"></span>' +
          '<span class="contrib-cell" data-level="2"></span>' +
          '<span class="contrib-cell" data-level="3"></span>' +
          '<span class="contrib-cell" data-level="4"></span>' +
          '<span>More</span>' +
        '</div>' +
      '</div>';

    /* keep the months row's width matched to the grid's actual rendered
       width, so the 3 labels land at the grid's own left/centre/right */
    var graphEl  = container.querySelector('.contrib-graph');
    var monthsEl = container.querySelector('.contrib-months');
    if (graphEl && monthsEl) monthsEl.style.width = graphEl.scrollWidth + 'px';
  }

  fetch('assets/contributions.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (weeks) {
      allDays = [].concat.apply([], weeks); /* weeks are already chronological, oldest → newest */
      render();

      var resizeTimer;
      window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(render, 150);
      });
    })
    .catch(function () {
      container.remove();
    });
})();
