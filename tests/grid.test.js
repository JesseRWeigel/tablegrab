// Colspan and rowspan into a rectangle, one shape at a time.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseTables } = require('../src/parse');
const { buildGrid, rectangle } = require('../src/grid');

function gridOf(html, options) {
  const [table] = parseTables(html);
  return buildGrid(table, options || {});
}

test('a plain table is already rectangular', () => {
  const grid = gridOf('<table><tr><td>a<td>b<tr><td>c<td>d</table>');
  assert.deepStrictEqual(rectangle(grid), [['a', 'b'], ['c', 'd']]);
  assert.deepStrictEqual(grid.ragged, []);
});

test('a colspan repeats its text across the columns it covers', () => {
  const grid = gridOf('<table><tr><td colspan="3">wide<tr><td>a<td>b<td>c</table>');
  assert.deepStrictEqual(rectangle(grid), [['wide', 'wide', 'wide'], ['a', 'b', 'c']]);
});

test('a rowspan pushes the row below it to the right', () => {
  const grid = gridOf(
    '<table><tr><td rowspan="2">tall<td>a<tr><td>b<tr><td>c<td>d</table>');
  assert.deepStrictEqual(rectangle(grid), [['tall', 'a'], ['tall', 'b'], ['c', 'd']]);
});

test('a rowspan in the middle of a row is not confused for the first column', () => {
  const grid = gridOf(
    '<table><tr><td>a<td rowspan="2">mid<td>c<tr><td>d<td>f</table>');
  assert.deepStrictEqual(rectangle(grid), [['a', 'mid', 'c'], ['d', 'mid', 'f']]);
});

test('only the anchor slot is the anchor', () => {
  const grid = gridOf('<table><tr><td colspan="2" rowspan="2">big<td>x<tr><td>y</table>');
  assert.strictEqual(grid.slots[0][0].anchor, true);
  assert.strictEqual(grid.slots[0][1].anchor, false);
  assert.strictEqual(grid.slots[1][0].anchor, false);
  assert.strictEqual(grid.slots[0][0].merged, true);
  assert.strictEqual(grid.slots[0][2].merged, false);
});

test('a short row leaves the tail empty rather than shifting left', () => {
  const grid = gridOf('<table><tr><td>a<td>b<td>c<tr><td>d</table>');
  assert.deepStrictEqual(rectangle(grid), [['a', 'b', 'c'], ['d', '', '']]);
  assert.deepStrictEqual(grid.ragged, [{ row: 1, filled: 1, width: 3 }]);
});

test('rowspan="0" runs to the end of its section and no further', () => {
  const grid = gridOf(
    '<table><tbody><tr><td rowspan="0">a<td>1<tr><td>2</tbody>'
    + '<tfoot><tr><td>x<td>y</tfoot></table>');
  assert.deepStrictEqual(rectangle(grid), [['a', '1'], ['a', '2'], ['x', 'y']]);
  assert.match(grid.notes.join(' '), /rowspan="0" expanded to 2 rows/);
});

test('a rowspan reaching past the last row is clipped', () => {
  const grid = gridOf('<table><tr><td rowspan="9">a<td>1<tr><td>2</table>');
  assert.deepStrictEqual(rectangle(grid), [['a', '1'], ['a', '2']]);
  assert.strictEqual(grid.height, 2);
});

test('sections render thead, tbody, tfoot whatever order they were written in', () => {
  const grid = gridOf(
    '<table><tfoot><tr><td>foot</td></tr></tfoot><tbody><tr><td>body</td></tr></tbody>'
    + '<thead><tr><th>head</th></tr></thead></table>');
  assert.deepStrictEqual(rectangle(grid), [['head'], ['body'], ['foot']]);
  assert.strictEqual(grid.headerRows, 1);
  assert.deepStrictEqual(grid.footRows, [1]);
});

test('a two row header collapses into compound names', () => {
  const grid = gridOf(
    '<table><thead><tr><th rowspan="2">Region<th colspan="2">Revenue</tr>'
    + '<tr><th>2023<th>2024</tr></thead><tbody><tr><td>a<td>1<td>2</tbody></table>');
  assert.deepStrictEqual(grid.columns, ['Region', 'Revenue / 2023', 'Revenue / 2024']);
});

test('an empty header cell does not leave a gap in the compound name', () => {
  const grid = gridOf(
    '<table><thead><tr><th></th><th colspan="2">Revenue</th></tr>'
    + '<tr><th>Item</th><th>2023</th><th>2024</th></tr></thead>'
    + '<tbody><tr><td>a<td>1<td>2</tbody></table>');
  assert.deepStrictEqual(grid.columns, ['Item', 'Revenue / 2023', 'Revenue / 2024']);
});

test('duplicate column names are made unique', () => {
  const grid = gridOf('<table><tr><th>n<th>n<th>n<tr><td>1<td>2<td>3</table>');
  assert.deepStrictEqual(grid.columns, ['n', 'n_2', 'n_3']);
});

test('a column with no header at all is named by position', () => {
  const grid = gridOf('<table><thead><tr><th>a</th><th></th></tr></thead>'
    + '<tbody><tr><td>1<td>2</tbody></table>');
  assert.deepStrictEqual(grid.columns, ['a', 'column_2']);
});

test('header rows are found without a thead', () => {
  const grid = gridOf('<table><tr><th>a<th>b<tr><td>1<td>2</table>');
  assert.strictEqual(grid.headerRows, 1);
  assert.deepStrictEqual(grid.rows, [['1', '2']]);
});

test('a table of nothing but th rows keeps one header row and the rest as data', () => {
  const grid = gridOf('<table><tr><th>a<th>b<tr><th>c<th>d</table>');
  assert.strictEqual(grid.headerRows, 1);
  assert.deepStrictEqual(grid.rows, [['c', 'd']]);
});

test('a leading th column does not make every row a header row', () => {
  const grid = gridOf('<table><tr><th>name<th>value<tr><th>a<td>1<tr><th>b<td>2</table>');
  assert.strictEqual(grid.headerRows, 1);
  assert.deepStrictEqual(grid.rows, [['a', '1'], ['b', '2']]);
});

test('overlapping spans keep the earlier cell and leave a note', () => {
  const grid = gridOf(
    '<table><tr><td>a<td rowspan="2">b<td>c<tr><td colspan="3">wide</table>');
  assert.deepStrictEqual(rectangle(grid), [['a', 'b', 'c'], ['wide', 'b', 'wide']]);
  assert.match(grid.notes.join(' '), /overlapping spans/);
});

test('the header row count can be forced', () => {
  const grid = gridOf('<table><tr><th>a<th>b<tr><td>1<td>2</table>', { headerRows: 0 });
  assert.deepStrictEqual(grid.columns, ['column_1', 'column_2']);
  assert.deepStrictEqual(grid.rows, [['a', 'b'], ['1', '2']]);
});

test('the compound separator can be changed', () => {
  const grid = gridOf(
    '<table><thead><tr><th colspan="2">Revenue</tr><tr><th>2023<th>2024</tr></thead>'
    + '<tbody><tr><td>1<td>2</tbody></table>', { separator: '.' });
  assert.deepStrictEqual(grid.columns, ['Revenue.2023', 'Revenue.2024']);
});
