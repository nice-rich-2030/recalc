// calc.js のテスト。SPEC.md §1.3（F-02, F-04-2, F-04-3）と SPEC_DETAIL.md §2.3 C-1〜C-7 の例
const { test } = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../js/calc.js');
const format = require('../js/format.js');

// 記録の値（古い順）から ctx を作る。#1 = 最後の要素
function ctxOf(values, angle = 'deg') {
  return {
    ans: values.length ? values[values.length - 1] : 0,
    getRecord: (n) => (Number.isInteger(n) && n >= 1 && n <= values.length ? values[values.length - n] : undefined),
    angle,
  };
}

// 計算して表示用の文字を返す（失敗したらエラーの code）
function show(src, ctx = ctxOf([])) {
  const r = calc.evaluate(src, ctx);
  return r.ok ? format.display(r.value) : r.error.code;
}

function errorOf(src, ctx = ctxOf([])) {
  const r = calc.evaluate(src, ctx);
  assert.equal(r.ok, false, `${src} は失敗するはず`);
  return r.error;
}

test('F-02-1 四則と優先順位', () => {
  assert.equal(show('2+3*4'), '14');
  assert.equal(show('(2+3)*4'), '20');
  assert.equal(show('12*(3+4)'), '84');
  assert.equal(show('10-4-3'), '3');
  assert.equal(show('100/10/5'), '2');
});

test('F-02-2 べき乗・平方根・階乗・百分率', () => {
  assert.equal(show('2^10'), '1,024');
  assert.equal(show('√16'), '4');
  assert.equal(show('sqrt(16)'), '4');
  assert.equal(show('5!'), '120');
  assert.equal(show('50%'), '0.5');
  assert.equal(show('200*5%'), '10');
});

test('F-02-3 関数と定数', () => {
  assert.equal(show('sin(30)'), '0.5');
  assert.equal(show('sin(π/2)', ctxOf([], 'rad')), '1');
  assert.equal(show('cos(60)'), '0.5');
  assert.equal(show('tan(45)'), '1');
  assert.equal(show('asin(0.5)'), '30');
  assert.equal(show('acos(0)'), '90');
  assert.equal(show('atan(1)'), '45');
  assert.equal(show('atan(1)', ctxOf([], 'rad')), format.display(Math.PI / 4));
  assert.equal(show('log(1000)'), '3');
  assert.equal(show('ln(e)'), '1');
  assert.equal(show('abs(-7)'), '7');
  assert.equal(show('pi'), '3.14159265359');
  assert.equal(show('π'), '3.14159265359');
  assert.equal(show('e'), '2.71828182846');
});

test('F-01-4 / C-3 掛け算記号と省略', () => {
  assert.equal(show('3x4'), '12');
  assert.equal(show('3X4'), '12');
  assert.equal(show('3×4'), '12');
  assert.equal(show('8÷2'), '4');
  assert.equal(show('5−2'), '3');
  assert.equal(show('2π'), format.display(2 * Math.PI));
  assert.equal(show('3(4+5)'), '27');
  assert.equal(show('(1+2)(3+4)'), '21');
  assert.equal(show('2sin(30)'), '1');
  assert.equal(show('2√9'), '6');
  assert.equal(show('π#1', ctxOf([2])), format.display(Math.PI * 2));
  assert.equal(show('2ans', ctxOf([5])), '10');
  // 数の後ろに数は補わない
  assert.equal(show('π2'), 'INCOMPLETE');
  assert.equal(show('(3)4'), 'INCOMPLETE');
  // max のような名前を x の掛け算と誤認しない
  assert.equal(errorOf('max(2)').code, 'UNKNOWN_FUNC');
});

test('C-3 数の書き方（大文字 E のみ指数）', () => {
  assert.equal(show('1.5'), '1.5');
  assert.equal(show('.5'), '0.5');
  assert.equal(show('1.'), '1');
  assert.equal(show('1.5E+25'), '1.5E+25');
  assert.equal(show('2E-3'), '0.002');
  // 小文字の e は定数 e（2e = 2×e）
  assert.equal(show('2e'), format.display(2 * Math.E));
});

test('C-1 演算子の優先順位', () => {
  assert.equal(show('3!^2'), '36');
  assert.equal(show('2^3^2'), '512');
  assert.equal(show('-2^2'), '-4');
  assert.equal(show('√16^2'), '16');
  assert.equal(show('2^-1'), '0.5');
  assert.equal(show('1/2π'), format.display(Math.PI / 2));
  assert.equal(show('1/2π'), '1.57079632679');
  assert.equal(show('-3+5'), '2');
  assert.equal(show('+3'), '3');
  // 関数はかっこが必要
  assert.equal(show('sin 30'), 'INCOMPLETE');
});

test('C-4 関数と値の範囲', () => {
  assert.equal(show('cos(90)'), '0');
  assert.equal(show('sin(180)'), '0');
  assert.equal(show('sin(π)', ctxOf([], 'rad')), '0');
  assert.equal(show('tan(90)'), 'DOMAIN');
  assert.equal(show('tan(-270)'), 'DOMAIN');
  assert.equal(show('tan(180)'), '0');
  assert.equal(show('0!'), '1');
  assert.equal(show('3.5!'), 'DOMAIN');
  assert.equal(show('(-1)!'), 'DOMAIN');
  assert.equal(show('170!'), '7.25741561531E+306');
  assert.equal(show('171!'), 'OVERFLOW');
  assert.equal(show('√-1'), 'DOMAIN');
  assert.equal(show('sqrt(-4)'), 'DOMAIN');
  assert.equal(show('log(0)'), 'DOMAIN');
  assert.equal(show('ln(-1)'), 'DOMAIN');
  assert.equal(show('asin(2)'), 'DOMAIN');
  assert.equal(show('acos(-1.5)'), 'DOMAIN');
  assert.equal(show('1/0'), 'DIV_ZERO');
  assert.equal(show('(-8)^(1/3)'), 'DOMAIN');
  assert.equal(show('10^400'), 'OVERFLOW');
});

test('F-02-6 エラーの文', () => {
  assert.equal(errorOf('1/0').message, '0 で割ることはできません');
  assert.equal(errorOf('(2+3').message, 'かっこが閉じていません');
  assert.equal(errorOf('2+3)').message, 'かっこが多すぎます');
  assert.equal(errorOf('foo(2)').message, '知らない関数: foo');
  assert.equal(errorOf('2&3').message, '使えない文字があります: &');
  assert.equal(errorOf('#').message, '使えない文字があります: #');
  assert.equal(errorOf('12+').message, '式が途中で終わっています');
  assert.equal(errorOf('√-1').message, '計算できない値です');
  assert.equal(errorOf('171!').message, '数が大きすぎます');
  assert.equal(errorOf('').code, 'EMPTY');
  assert.equal(errorOf('   ').code, 'EMPTY');
  assert.equal(errorOf('*2').code, 'INCOMPLETE');
  assert.equal(errorOf('()').code, 'INCOMPLETE');
});

test('C-2 かっこの入れ子は 100 段まで', () => {
  assert.equal(show('('.repeat(100) + '1' + ')'.repeat(100)), '1');
  assert.equal(show('('.repeat(101) + '1' + ')'.repeat(101)), 'INCOMPLETE');
});

test('F-04-2 ans', () => {
  assert.equal(show('ans*1.1', ctxOf([1980])), '2,178');
  assert.equal(show('ans', ctxOf([])), '0');
  assert.equal(show('ans+1', ctxOf([])), '1');
});

test('F-04-3 #n は n 個前の記録', () => {
  const ctx = ctxOf([10, 20, 30]); // #1=30, #2=20, #3=10
  assert.equal(show('#1', ctx), '30');
  assert.equal(show('#2', ctx), '20');
  assert.equal(show('#1+#2', ctx), '50');
  assert.equal(show('#3*2', ctx), '20');
  assert.equal(show('#1', ctx), show('ans', ctx));
  assert.equal(errorOf('#7', ctx).message, '#7 の記録はありません');
  assert.equal(errorOf('#0', ctx).code, 'NO_RECORD');
});

test('C-7 記録する式の置き換え', () => {
  const ctx = ctxOf([2178]);
  assert.equal(calc.resolveRefs('#1*1.1', ctx), '2178*1.1');
  assert.equal(calc.resolveRefs('2ans', ctx), '2(2178)');
  assert.equal(calc.resolveRefs('2#1', ctx), '2(2178)');
  assert.equal(calc.resolveRefs('ans*12', ctx), '2178*12');
  assert.equal(calc.resolveRefs('(#1)', ctx), '(2178)');
  assert.equal(calc.resolveRefs('√#1', ctx), '√2178');
  assert.equal(calc.resolveRefs('1+2', ctx), '1+2');
  // 負の数・指数表記は囲む。12 桁に丸めない
  assert.equal(calc.resolveRefs('#1+1', ctxOf([-5])), '(-5)+1');
  assert.equal(calc.resolveRefs('#1*2', ctxOf([1.5e25])), '(1.5E+25)*2');
  assert.equal(calc.resolveRefs('#1*2', ctxOf([1e-7])), '(1E-7)*2');
  assert.equal(calc.resolveRefs('#1', ctxOf([0.30000000000000004])), '0.30000000000000004');
  // #2 と #1 が並んでもくっつかない
  assert.equal(calc.resolveRefs('#2#1', ctxOf([3, 4])), '3(4)');
});

test('F-04-1 結果のクリック挿入：必要なときだけ ( ) で囲む', () => {
  assert.equal(calc.wrapValue('2178', ''), '2178');
  assert.equal(calc.wrapValue('2178', '1+'), '2178');
  assert.equal(calc.wrapValue('2178', '3×'), '2178');
  assert.equal(calc.wrapValue('2178', '('), '2178');
  assert.equal(calc.wrapValue('2178', '3'), '(2178)');
  assert.equal(calc.wrapValue('-5', '3'), '(-5)');
  assert.equal(calc.wrapValue('-5', '3+'), '(-5)');
  assert.equal(calc.wrapValue('1.5E+25', ''), '(1.5E+25)');
  // 入れた式がそのまま計算できる（受け渡し基準）
  assert.equal(show('3' + calc.wrapValue(format.plain(-5), '3')), '-15');
});

test('F-04 受け渡し基準：置き換えた式を計算し直すと同じ値', () => {
  const values = [2178.0000000000005, -3.25, 1.5e25, 1 / 3, 0.1 + 0.2];
  const ctx = ctxOf(values);
  const exprs = ['#1*1.1', '2ans', '#2+#3', '#4^2/#5', '-#2', '#1#2', 'sin(#4)', '#3%'];
  for (const src of exprs) {
    const before = calc.evaluate(src, ctx);
    assert.ok(before.ok, src);
    const resolved = calc.resolveRefs(src, ctx);
    const after = calc.evaluate(resolved, ctxOf([]));
    assert.ok(after.ok, `${src} → ${resolved}`);
    assert.equal(after.value, before.value, `${src} → ${resolved}`);
  }
});

test('C-5 plain の出力はそのまま計算できる', () => {
  const values = [2178, 1234567.5, -0.5, 1 / 3, 1.5e25, -2.5e-12, 25 * 24 * 23, 1e15, 0.000000001];
  for (const v of values) {
    const text = format.plain(v);
    const r = calc.evaluate(text, ctxOf([]));
    assert.ok(r.ok, text);
    assert.equal(format.plain(r.value), text);
  }
});
