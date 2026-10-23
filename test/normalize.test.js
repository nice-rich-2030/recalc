// normalize.js のテスト。SPEC.md §1.3（F-05-3, F-01-4）と SPEC_DETAIL.md §2.1 normalize.js の例
const { test } = require('node:test');
const assert = require('node:assert/strict');
const normalize = require('../js/normalize.js');

test('F-05-3 貼り付けの整形', () => {
  assert.equal(normalize.normalizePaste('1,234,567'), '1234567');
  assert.equal(normalize.normalizePaste('１２３'), '123');
  assert.equal(normalize.normalizePaste('3×4÷2'), '3*4/2');
  assert.equal(normalize.normalizePaste('¥1,000'), '1000');
  assert.equal(normalize.normalizePaste('$20'), '20');
  assert.equal(normalize.normalizePaste('  12+3 \n'), '12+3');
});

test('§2.1 normalizePaste の例', () => {
  assert.equal(normalize.normalizePaste('¥1,234,567'), '1234567');
  assert.equal(normalize.normalizePaste('１２×３'), '12*3');
  assert.equal(normalize.normalizePaste('3 ÷ 4\n'), '3/4');
  assert.equal(normalize.normalizePaste('￥１，２３４'), '1234');
  assert.equal(normalize.normalizePaste('€5'), '5');
});

test('桁区切りは数字3桁ごとの , だけ', () => {
  assert.equal(normalize.normalizePaste('1,2'), '1,2');
  assert.equal(normalize.normalizePaste('1234,567'), '1234,567');
  assert.equal(normalize.normalizePaste('1,234.5'), '1234.5');
  assert.equal(normalize.normalizePaste('1,234+5,678'), '1234+5678');
  assert.equal(normalize.normalizePaste('1,2345'), '1,2345');
});

test('マイナス記号のゆれ', () => {
  assert.equal(normalize.normalizePaste('5−2'), '5-2');
  assert.equal(normalize.normalizePaste('5–2'), '5-2');
  assert.equal(normalize.normalizePaste('5ー2'), '5-2');
  assert.equal(normalize.normalizePaste('５－２'), '5-2');
});

test('x / X は C-3 と同じ条件のときだけ掛け算', () => {
  assert.equal(normalize.normalizeExpr('3x4'), '3*4');
  assert.equal(normalize.normalizeExpr('3X4'), '3*4');
  assert.equal(normalize.normalizeExpr('(1+2)x3'), '(1+2)*3');
  assert.equal(normalize.normalizeExpr('5!x2'), '5!*2');
  assert.equal(normalize.normalizeExpr('πx2'), 'π*2');
  assert.equal(normalize.normalizeExpr('ansx2'), 'ans*2');
  assert.equal(normalize.normalizeExpr('max(2)'), 'max(2)');
  assert.equal(normalize.normalizeExpr('x2'), 'x2');
});

test('normalizeExpr は記号だけそろえ、空白を除く', () => {
  assert.equal(normalize.normalizeExpr('2 × π'), '2*π');
  assert.equal(normalize.normalizeExpr('1980 * 1.1'), '1980*1.1');
  assert.equal(normalize.normalizeExpr('8÷2−1'), '8/2-1');
});

test('toHalfWidth', () => {
  assert.equal(normalize.toHalfWidth('ａｎｓ＋１'), 'ans+1');
  assert.equal(normalize.toHalfWidth('（１）'), '(1)');
});
