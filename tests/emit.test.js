// The four outputs, and the escaping each of them needs.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseTables } = require('../src/parse');
const { buildGrid } = require('../src/grid');
const { analyse } = require('../src/infer');
const { toCSV, toJSON, toMarkdown, toSQL, identifier, uniqueIdentifiers } = require('../src/emit');

function analysisOf(html) {
  const [table] = parseTables(html);
  return analyse(buildGrid(table, {}), {});
}

const AWKWARD = '<table><thead><tr><th>na"me</th><th>note</th><th>n</th></tr></thead><tbody>'
  + '<tr><td>a,b</td><td>say "hi"</td><td>1,000</td></tr>'
  + '<tr><td>O\'Brien</td><td>pipe | here</td><td>2</td></tr></tbody></table>';

test('csv quotes only the fields that need it', () => {
  const csv = toCSV(analysisOf(AWKWARD));
  assert.strictEqual(csv, [
    '"na""me",note,n',
    '"a,b","say ""hi""",1000',
    "O'Brien,pipe | here,2",
    '',
  ].join('\n'));
});

test('csv quotes a field with leading or trailing space', () => {
  const analysis = analysisOf('<table><tr><th>a</th></tr><tr><td>&#32;pad&#32;</td></tr></table>');
  analysis.rows[0][0].raw = ' pad ';
  assert.match(toCSV(analysis), /" pad "/);
});

test('json carries types rather than strings', () => {
  const records = JSON.parse(toJSON(analysisOf(AWKWARD)));
  assert.deepStrictEqual(records, [
    { 'na"me': 'a,b', note: 'say "hi"', n: 1000 },
    { 'na"me': "O'Brien", note: 'pipe | here', n: 2 },
  ]);
  assert.strictEqual(typeof records[0].n, 'number');
});

test('markdown escapes pipes and right aligns number columns', () => {
  const md = toMarkdown(analysisOf(AWKWARD));
  const lines = md.trim().split('\n');
  assert.strictEqual(lines[1], '| --- | --- | ---: |');
  assert.ok(lines[3].includes('pipe \\| here'), lines[3]);
});

test('sql quotes identifiers, escapes strings and types the columns', () => {
  const sql = toSQL(analysisOf(AWKWARD), { table: 'Awkward Table' });
  assert.match(sql, /CREATE TABLE "awkward_table"/);
  assert.match(sql, /"na_me"\s+TEXT/);
  assert.match(sql, /"n"\s+INTEGER/);
  assert.match(sql, /'O''Brien'/);
  assert.match(sql, /VALUES\n/);
});

test('sql uses the caption when no table name is given', () => {
  const analysis = analysisOf('<table><caption>Q1 Results</caption><tr><th>a</th></tr>'
    + '<tr><td>1</td></tr></table>');
  assert.match(toSQL(analysis), /CREATE TABLE "q1_results"/);
});

test('sql emits nulls rather than empty strings', () => {
  const analysis = analysisOf('<table><tr><th>a</th><th>b</th></tr>'
    + '<tr><td>1</td><td></td></tr></table>');
  assert.match(toSQL(analysis), /\(1, NULL\)/);
});

test('sql emits a create statement even with no rows', () => {
  const analysis = analysisOf('<table><tr><th>a</th><th>b</th></tr></table>');
  const sql = toSQL(analysis);
  assert.match(sql, /CREATE TABLE/);
  assert.ok(!sql.includes('INSERT'), sql);
});

test('identifiers are sanitised and made unique', () => {
  assert.strictEqual(identifier('Revenue / 2023', 0), 'revenue_2023');
  assert.strictEqual(identifier('2023', 0), 'c_2023');
  assert.strictEqual(identifier('  ', 3), 'column_4');
  assert.deepStrictEqual(uniqueIdentifiers(['a b', 'a-b', 'a_b']), ['a_b', 'a_b_2', 'a_b_3']);
});

test('a date is the same value in all four formats', () => {
  const analysis = analysisOf('<table><tr><th>when</th></tr><tr><td>15/02/2024</td></tr></table>');
  assert.match(toCSV(analysis), /2024-02-15/);
  assert.match(toJSON(analysis), /"2024-02-15"/);
  assert.match(toMarkdown(analysis), /2024-02-15/);
  assert.match(toSQL(analysis), /'2024-02-15'/);
});

test('the thousands separator is removed exactly once, in every format', () => {
  const analysis = analysisOf('<table><tr><th>n</th></tr><tr><td>$1,234,567</td></tr></table>');
  for (const output of [toCSV(analysis), toJSON(analysis), toMarkdown(analysis), toSQL(analysis)]) {
    assert.ok(output.includes('1234567'), output);
    assert.ok(!output.includes('1,234,567'), output);
  }
});

test('the currency shows up in the column label rather than being silently dropped', () => {
  const analysis = analysisOf('<table><tr><th>Revenue</th></tr><tr><td>$1,234</td></tr></table>');
  assert.strictEqual(analysis.columns[0].label, 'Revenue (USD)');
  assert.match(toCSV(analysis), /Revenue \(USD\)/);
});

test('an unknown format is an error rather than an empty file', () => {
  const { emit } = require('../src/emit');
  assert.throws(() => emit(analysisOf(AWKWARD), 'xlsx'), /unknown format/);
});
