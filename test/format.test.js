// format.js のテスト。SPEC.md §1.3（F-02-7）と SPEC_DETAIL.md §2.3 C-5 の例
const { test } = require('node:test');
const assert = require('node:assert/strict');
const format = require('../js/format.js');

test('F-02-7 丸めと3桁区切り', () => {
  assert.equal(format.display(0.1 + 0.2), '0.3');
  assert.equal(format.display(1234567), '1,234,567');
  assert.equal(format.display(2178.0000000000005), '2,178');
  assert.equal(format.display(1 / 3), '0.333333333333');
  assert.equal(format.display(-1234.5), '-1,234.5');
  assert.equal(format.display(0.000123456), '0.000123456');
  assert.equal(format.display(999), '999');
  assert.equal(format.display(1000), '1,000');
});

test('C-5 小数部には区切りを入れない', () => {
  assert.equal(format.display(1234.56789), '1,234.56789');
  assert.equal(format.display(0.1234567), '0.1234567');
});

test('C-5 指数表記', () => {
  assert.equal(format.display(1.23e21), '1.23E+21');
  assert.equal(format.display([...Array(25)].reduce((p, _, i) => p * (i + 1), 1)), '1.55112100433E+25'); // 25!
  assert.equal(format.display(1e15), '1E+15');
  assert.equal(format.display(999999999999999), '1E+15'); // 12 桁で丸めると 1e15
  assert.equal(format.display(123456789012345), '123,456,789,012,000');
  assert.equal(format.display(1e-9), '0.000000001');
  assert.equal(format.display(9.9e-10), '9.9E-10');
  assert.equal(format.display(-2.5e-12), '-2.5E-12');
});

test('C-5 -0 は 0', () => {
  assert.equal(format.display(-0), '0');
  assert.equal(format.plain(-0), '0');
  assert.equal(format.display(-1e-20 * 0), '0');
});

test('plain は区切りなし', () => {
  assert.equal(format.plain(1234567.5), '1234567.5');
  assert.equal(format.plain(2178.0000000000005), '2178');
  assert.equal(format.plain(1.55112100433e25), '1.55112100433E+25');
});

test('round は有効数字 12 桁', () => {
  assert.equal(format.round(0.1 + 0.2), 0.3);
  assert.equal(format.round(1 / 3), 0.333333333333);
  assert.equal(Object.is(format.round(-0), 0), true);
});
