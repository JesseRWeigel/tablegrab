'use strict';

const { parseTables, collapse } = require('./parse');
const { buildGrid, rectangle } = require('./grid');
const { analyse, inferValue, inferColumn } = require('./infer');
const { classify } = require('./detect');
const { emit, toCSV, toJSON, toMarkdown, toSQL } = require('./emit');
const { fromDom } = require('./dom');

// One table, from parsed cells to a finished export.
function grabTable(table, options) {
  const opts = options || {};
  const grid = buildGrid(table, opts);
  const verdict = classify(grid);
  if (!verdict.isData && !opts.force) {
    const error = new Error(
      `refused: this looks like a layout table (score ${verdict.score}). `
      + `${verdict.reasons.join('; ')}. Pass force to export it anyway.`);
    error.verdict = verdict;
    error.grid = grid;
    throw error;
  }
  const analysis = analyse(grid, opts);
  return { grid, analysis, verdict, output: opts.format ? emit(analysis, opts.format, opts) : null };
}

// Every table in a document, in source order.
function grab(html, options) {
  const opts = options || {};
  const tables = parseTables(html);
  if (opts.index !== undefined) {
    if (!tables[opts.index]) throw new Error(`no table at index ${opts.index} (found ${tables.length})`);
    return grabTable(tables[opts.index], opts);
  }
  return tables.map((table) => {
    try {
      return grabTable(table, opts);
    } catch (err) {
      return { error: String(err.message), verdict: err.verdict || null, grid: err.grid || null };
    }
  });
}

module.exports = {
  parseTables, fromDom, buildGrid, rectangle, analyse, inferValue, inferColumn,
  classify, emit, toCSV, toJSON, toMarkdown, toSQL, grab, grabTable, collapse,
};
