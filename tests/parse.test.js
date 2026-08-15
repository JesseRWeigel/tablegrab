// The HTML reader. Everything here is a shape real pages actually contain.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseTables, collapse } = require('../src/parse');

const cells = (table) => table.rows.map((row) => row.cells.map((cell) => cell.text));

test('cells and rows close implicitly', () => {
  const [table] = parseTables('<table><tr><td>a<td>b<tr><td>c<td>d</table>');
  assert.deepStrictEqual(cells(table), [['a', 'b'], ['c', 'd']]);
});

test('inline markup adds no space, the way a browser renders it', () => {
  const [table] = parseTables('<table><tr><td>Rail<sup>[1]</sup></td><td><b>bold</b>face</td></tr></table>');
  assert.deepStrictEqual(cells(table), [['Rail[1]', 'boldface']]);
});

test('entities are decoded and a non-breaking space becomes an ordinary one', () => {
  const [table] = parseTables('<table><tr><td>1&nbsp;435</td><td>a&amp;b</td><td>&#8212;</td>'
    + '<td>&#x2014;</td></tr></table>');
  assert.deepStrictEqual(cells(table), [['1 435', 'a&b', '—', '—']]);
});

test('an unknown entity is left alone rather than mangled', () => {
  const [table] = parseTables('<table><tr><td>&notreal; &amp;</td></tr></table>');
  assert.deepStrictEqual(cells(table), [['&notreal; &']]);
});

test('script and style content never reaches a cell', () => {
  const [table] = parseTables(
    '<table><tr><td>keep<script>var x = "drop";</script></td>'
    + '<td><style>td{color:red}</style>also</td></tr></table>');
  assert.deepStrictEqual(cells(table), [['keep', 'also']]);
});

test('a comment is not text', () => {
  const [table] = parseTables('<table><tr><td>a<!-- <td>ghost --></td></tr></table>');
  assert.deepStrictEqual(cells(table), [['a']]);
});

test('an attribute containing a greater-than sign does not end the tag early', () => {
  const [table] = parseTables('<table><tr><td title="a > b">value</td></tr></table>');
  assert.deepStrictEqual(cells(table), [['value']]);
});

test('a nested table is its own table and its cells do not leak upward', () => {
  const tables = parseTables(
    '<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>');
  assert.strictEqual(tables.length, 2);
  assert.deepStrictEqual(cells(tables[0]), [['outer']]);
  assert.deepStrictEqual(cells(tables[1]), [['inner']]);
  assert.strictEqual(tables[0].hasNestedTable, true);
  assert.strictEqual(tables[1].hasNestedTable, false);
});

test('sections and captions are recorded', () => {
  const [table] = parseTables(
    '<table><caption>Cap <b>tion</b></caption><thead><tr><th>h</th></tr></thead>'
    + '<tfoot><tr><td>f</td></tr></tfoot><tbody><tr><td>b</td></tr></tbody></table>');
  assert.strictEqual(table.caption, 'Cap tion');
  assert.deepStrictEqual(table.rows.map((row) => row.section), ['thead', 'tfoot', 'tbody']);
  assert.strictEqual(table.thCount, 1);
  assert.strictEqual(table.tdCount, 2);
});

test('spans are read, including the ones written badly', () => {
  const [table] = parseTables(
    '<table><tr><td colspan="2">a</td><td rowspan=3>b</td><td colspan="">c</td>'
    + '<td rowspan="0">d</td><td colspan="two">e</td></tr></table>');
  const spans = table.rows[0].cells.map((cell) => [cell.colspan, cell.rowspan]);
  assert.deepStrictEqual(spans, [[2, 1], [1, 3], [1, 1], [1, 0], [1, 1]]);
});

test('an img contributes its alt text and nothing else', () => {
  const [table] = parseTables('<table><tr><td><img src="x.png" alt="flag"> Canada</td></tr></table>');
  assert.deepStrictEqual(cells(table), [['flag Canada']]);
});

test('uppercase tags and single quoted attributes parse the same way', () => {
  const [table] = parseTables("<TABLE><TR><TD COLSPAN='2'>A</TD></TR></TABLE>");
  assert.deepStrictEqual(cells(table), [['A']]);
  assert.strictEqual(table.rows[0].cells[0].colspan, 2);
});

test('collapse folds whitespace the way a browser does', () => {
  assert.strictEqual(collapse('  a \n\t b  '), 'a b');
});

test('a document with no table yields nothing rather than throwing', () => {
  assert.deepStrictEqual(parseTables('<p>nothing here</p>'), []);
});

test('a block tag inside a cell separates words', () => {
  const [table] = parseTables('<table><tr><td><p>one</p><p>two</p></td><td>a<br>b</td></tr></table>');
  assert.deepStrictEqual(cells(table), [['one two', 'a b']]);
});

test('textFromHtml agrees with the tokenizer, which is what keeps the DOM path honest', () => {
  const { textFromHtml } = require('../src/parse');
  const bodies = ['Rail<sup>[1]</sup>', '<b>bold</b>face', '<p>one</p><p>two</p>', 'a<br>b',
    '1&nbsp;435', '<img src="x.png" alt="flag"> Canada', 'keep<script>drop()</script>'];
  for (const body of bodies) {
    const [table] = parseTables(`<table><tr><td>${body}</td></tr></table>`);
    assert.strictEqual(textFromHtml(body), table.rows[0].cells[0].text, body);
  }
});
