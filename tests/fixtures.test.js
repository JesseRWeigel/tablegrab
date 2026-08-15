// Every fixture is checked against an answer written out by hand in fixtures/expected/,
// not against whatever the code happened to produce. If a change to the grid builder moves a
// cell, this is the file that says so.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { parseTables, buildGrid, analyse, classify, toSQL } = require('../src/index');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const EXPECTED = path.join(FIXTURES, 'expected');

function load(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function expected(name) {
  return JSON.parse(fs.readFileSync(path.join(EXPECTED, name), 'utf8'));
}

function analysisOf(file, index, options) {
  const tables = parseTables(load(file));
  assert.ok(tables[index], `${file} has no table at index ${index}`);
  const grid = buildGrid(tables[index], options || {});
  return { grid, analysis: analyse(grid, options || {}), verdict: classify(grid) };
}

function rectangleOf(grid) {
  const out = [];
  for (let r = 0; r < grid.height; r += 1) {
    const line = [];
    for (let c = 0; c < grid.width; c += 1) line.push(grid.slots[r][c].text);
    out.push(line);
  }
  return out;
}

function valuesOf(analysis) {
  return analysis.rows.map((row) => row.map((cell) => (cell.type === 'empty' ? null : cell.value)));
}

function sqlTypesOf(analysis) {
  const create = toSQL(analysis).split('\n');
  return create
    .filter((line) => line.startsWith('  "'))
    .map((line) => line.trim().split(/\s+/).pop().replace(/,$/, ''));
}

for (const name of ['merged.json', 'ragged.json', 'types.json', 'dates.json', 'overlap.json']) {
  const want = expected(name);
  test(`${want.file}: the rectangle matches the hand-written answer`, () => {
    const { grid } = analysisOf(want.file, want.index);
    assert.strictEqual(grid.width, want.width, 'width');
    assert.strictEqual(grid.height, want.height, 'height');
    assert.strictEqual(grid.headerRows, want.headerRows, 'header rows');
    assert.strictEqual(grid.caption, want.caption, 'caption');
    assert.deepStrictEqual(rectangleOf(grid), want.rectangle);
  });

  test(`${want.file}: columns, types and values match the hand-written answer`, () => {
    const { grid, analysis } = analysisOf(want.file, want.index);
    assert.deepStrictEqual(grid.columns, want.columns, 'column names');
    assert.deepStrictEqual(analysis.columns.map((column) => column.type), want.types);
    assert.deepStrictEqual(valuesOf(analysis), want.values);
    if (want.labels) {
      assert.deepStrictEqual(analysis.columns.map((column) => column.label), want.labels);
    }
    if (want.sqlTypes) assert.deepStrictEqual(sqlTypesOf(analysis), want.sqlTypes);
  });

  test(`${want.file}: spans, ragged rows and notes are reported`, () => {
    const { grid, verdict } = analysisOf(want.file, want.index);
    assert.deepStrictEqual(grid.footRows, want.footRows, 'tfoot rows');
    assert.deepStrictEqual(grid.ragged, want.ragged, 'ragged rows');
    assert.deepStrictEqual(grid.notes, want.notes, 'notes');
    assert.strictEqual(verdict.isData, want.isData, 'data table verdict');
  });
}

test('dates: --day-first flips only the column nothing else settles', () => {
  const want = expected('dates.json');
  const { analysis } = analysisOf(want.file, want.index, { dayFirst: true });
  assert.deepStrictEqual(valuesOf(analysis), want.dayFirstValues);
});

test('dates: both date columns warn about the ambiguity they resolved', () => {
  const want = expected('dates.json');
  const { analysis } = analysisOf(want.file, want.index);
  for (const index of want.warningColumns) {
    assert.ok(analysis.columns[index].warnings.length > 0,
      `column ${index} should carry a warning`);
    assert.match(analysis.columns[index].warnings.join(' '), /ambiguous/);
  }
});

test('layout: the layout tables are refused and the data table inside is not', () => {
  const want = expected('layout.json');
  for (const entry of want.tables) {
    const { grid, analysis, verdict } = analysisOf(want.file, entry.index);
    assert.strictEqual(verdict.isData, entry.isData,
      `table ${entry.index} verdict, reasons: ${verdict.reasons.join('; ')}`);
    assert.strictEqual(grid.width, entry.width, `table ${entry.index} width`);
    assert.strictEqual(grid.height, entry.height, `table ${entry.index} height`);
    for (const reason of entry.reasonsInclude || []) {
      assert.ok(verdict.reasons.some((text) => text.includes(reason)),
        `table ${entry.index} should give the reason ${reason}`);
    }
    if (entry.columns) {
      assert.deepStrictEqual(grid.columns, entry.columns);
      assert.deepStrictEqual(analysis.columns.map((column) => column.type), entry.types);
      assert.deepStrictEqual(valuesOf(analysis), entry.values);
    }
  }
});

test('a refused table throws unless force is passed', () => {
  const { grabTable } = require('../src/index');
  const tables = parseTables(load('layout.html'));
  assert.throws(() => grabTable(tables[0], { format: 'csv' }), /layout table/);
  const forced = grabTable(tables[0], { format: 'csv', force: true });
  assert.match(forced.output, /Acme Analytics/);
});

test('the tfoot row comes out last even though it is written first', () => {
  const { grid } = analysisOf('merged.html', 0);
  assert.deepStrictEqual(grid.footRows, [5]);
  assert.strictEqual(grid.rows[5][0], 'Total');
  assert.strictEqual(grid.rows[grid.rows.length - 1][0], 'Total');
});
