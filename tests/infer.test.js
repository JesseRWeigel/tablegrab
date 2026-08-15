// Type inference, and the values that must survive it untouched.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { inferValue, inferColumn } = require('../src/infer');

const NUMBERS = [
  ['1,234,567', 1234567],
  ['1,234', 1234],
  ['1 234 567', 1234567],
  ['1.234.567', 1234567],
  ['1.234.567,89', 1234567.89],
  ['1 234,5', 1234.5],
  ['$1,234.56', 1234.56],
  ['€1.234,56', 1234.56],
  ['£12', 12],
  ['1234 USD', 1234],
  ['(1,234.56)', -1234.56],
  ['-15.5', -15.5],
  ['−15.5', -15.5],
  ['+12.5%', 12.5],
  ['0', 0],
  ['0.5', 0.5],
  ['1.234', 1.234],
  ['1,5', 1.5],
];

for (const [text, value] of NUMBERS) {
  test(`number: ${text} reads as ${value}`, () => {
    const cell = inferValue(text);
    assert.strictEqual(cell.type, 'number', `${text} should be a number`);
    assert.strictEqual(cell.value, value);
  });
}

// The refusals. Every one of these is a real column somebody has lost to a converter.
const MUST_STAY_TEXT = [
  '1.2.3',
  '10.4.1',
  '192.168.0.1',
  '07030',
  '02139',
  '007',
  '555-0134',
  '555-123-4567',
  '+1 (555) 013-4000',
  'X-100',
  '1,234-5,678',
  '12 items',
  '2024 Q1',
  '3rd',
  '1,23,456',
  '--5',
  '1e6',
];

for (const text of MUST_STAY_TEXT) {
  test(`refusal: ${text} stays text`, () => {
    const cell = inferValue(text);
    assert.strictEqual(cell.type, 'string', `${text} became ${cell.type} ${cell.value}`);
    assert.strictEqual(cell.value, text);
  });
}

const DATES = [
  ['2024-01-15', '2024-01-15', false],
  ['2024/01/15', '2024-01-15', false],
  ['15/02/2024', '2024-02-15', false],
  ['31-12-2024', '2024-12-31', false],
  ['3 March 2024', '2024-03-03', false],
  ['3rd March 2024', '2024-03-03', false],
  ['May 6, 2024', '2024-05-06', false],
  ['Sept 9, 2024', '2024-09-09', false],
  ['29 February 2024', '2024-02-29', false],
  ['03/04/2024', '2024-03-04', true],
];

for (const [text, value, ambiguous] of DATES) {
  test(`date: ${text} reads as ${value}`, () => {
    const cell = inferValue(text);
    assert.strictEqual(cell.type, 'date', `${text} should be a date`);
    assert.strictEqual(cell.value, value);
    assert.strictEqual(!!cell.ambiguous, ambiguous);
  });
}

test('an impossible date is text', () => {
  assert.strictEqual(inferValue('2023-02-29').type, 'string');
  assert.strictEqual(inferValue('32/01/2024').type, 'string');
  assert.strictEqual(inferValue('2024-13-01').type, 'string');
});

test('nullish markers become empty rather than text', () => {
  for (const text of ['', '—', '–', '-', 'n/a', 'N/A', '?']) {
    const cell = inferValue(text);
    assert.strictEqual(cell.type, 'empty', `${text} should be empty`);
    assert.strictEqual(cell.value, null);
  }
});

test('a column of numbers with one gap stays a number column', () => {
  const column = inferColumn(['1,000', '2,000', '—', '3,000']);
  assert.strictEqual(column.type, 'number');
  assert.strictEqual(column.integer, true);
  assert.deepStrictEqual(column.cells.map((cell) => cell.value), [1000, 2000, null, 3000]);
});

test('a column of numbers with one word is a text column, cell by cell', () => {
  const column = inferColumn(['1,000', '2,000', 'about 3,000']);
  assert.strictEqual(column.type, 'string');
  assert.deepStrictEqual(column.cells.map((cell) => cell.type), ['string', 'string', 'string']);
  assert.deepStrictEqual(column.cells.map((cell) => cell.value), ['1,000', '2,000', 'about 3,000']);
  assert.match(column.warnings.join(' '), /mixed cell types/);
});

test('a postcode column keeps every value as text, including the one without a leading zero', () => {
  const column = inferColumn(['07030', '02139', '10001']);
  assert.strictEqual(column.type, 'string');
  assert.deepStrictEqual(column.cells.map((cell) => cell.value), ['07030', '02139', '10001']);
});

test('one unambiguous date settles the ambiguous ones beside it', () => {
  const column = inferColumn(['03/04/2024', '15/05/2024']);
  assert.strictEqual(column.type, 'date');
  assert.deepStrictEqual(column.cells.map((cell) => cell.value), ['2024-04-03', '2024-05-15']);
});

test('a column with no evidence keeps the default and says so', () => {
  const column = inferColumn(['01/02/2024', '03/04/2024']);
  assert.deepStrictEqual(column.cells.map((cell) => cell.value), ['2024-01-02', '2024-03-04']);
  assert.match(column.warnings.join(' '), /nothing in the column settles/);
});

test('mixed currencies in one column are reported', () => {
  const column = inferColumn(['$100', '€200']);
  assert.strictEqual(column.type, 'number');
  assert.strictEqual(column.currency, null);
  assert.match(column.warnings.join(' '), /mixed currencies: EUR, USD/);
});

test('an empty column is a text column rather than a crash', () => {
  const column = inferColumn(['', '', '']);
  assert.strictEqual(column.type, 'string');
  assert.deepStrictEqual(column.cells.map((cell) => cell.value), [null, null, null]);
});
