// Is this a table of data, or a table being used to lay out a page?
//
// Old pages, and most HTML email, nest tables to position things. Exporting one of those as CSV
// produces a file that looks like data and is not, which is worse than refusing. So this scores
// the structural signals and refuses below a threshold. The caller can override with force,
// because a heuristic that cannot be overridden is a bug in someone's afternoon.

'use strict';

const PRESENTATION_ROLES = new Set(['presentation', 'none']);

function classify(grid) {
  const reasons = [];
  let score = 0;

  const role = String((grid.attrs && grid.attrs.role) || '').toLowerCase();
  if (PRESENTATION_ROLES.has(role)) {
    score += 5;
    reasons.push(`role="${role}" says outright that this is layout`);
  }
  if (grid.hasNestedTable) {
    score += 3;
    reasons.push('contains a nested table, which data tables almost never do');
  }
  if (grid.thCount === 0) {
    score += 1;
    reasons.push('no th cells anywhere');
  }
  if (grid.height < 2) {
    score += 3;
    reasons.push(`only ${grid.height} row(s)`);
  }
  if (grid.width < 2) {
    score += 2;
    reasons.push(`only ${grid.width} column(s)`);
  }
  const attrs = grid.attrs || {};
  const legacy = ['border', 'cellpadding', 'cellspacing', 'align', 'bgcolor']
    .filter((name) => attrs[name] !== undefined);
  if (legacy.length >= 2 && grid.thCount === 0) {
    score += 2;
    reasons.push(`legacy layout attributes (${legacy.join(', ')}) and no header cells`);
  }
  if (grid.headerRows === 0 && grid.thCount === 0 && !grid.caption) {
    score += 1;
    reasons.push('no caption, no thead and no header cells, so nothing names the columns');
  }
  const texts = [];
  for (let r = 0; r < grid.height; r += 1) {
    for (let c = 0; c < grid.width; c += 1) texts.push(grid.slots[r][c].text);
  }
  const longest = texts.reduce((best, text) => Math.max(best, text.length), 0);
  if (longest > 400) {
    score += 2;
    reasons.push(`a cell holds ${longest} characters, which reads as page copy`);
  }
  if (grid.caption) {
    score -= 1;
    reasons.push('has a caption, which is a data table signal');
  }
  if (grid.headerRows > 0) {
    score -= 1;
    reasons.push('has a header row, which is a data table signal');
  }

  return { isData: score < 3, score, reasons };
}

module.exports = { classify };
