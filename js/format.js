// 数値の表示用整形（丸め・3桁区切り・指数表記）。SPEC_DETAIL.md §2.1 format.js / §2.3 C-5
(function () {
  'use strict';

  const DIGITS = 12;        // 有効数字の桁数
  const EXP_HIGH = 1e15;    // 絶対値がこれ以上なら指数表記
  const EXP_LOW = 1e-9;     // 0 でなく絶対値がこれ未満なら指数表記

  // 有効数字 12 桁で丸める。-0 は 0 にする
  function round(value) {
    if (value === 0) return 0;
    return Number(value.toPrecision(DIGITS));
  }

  // 丸めた値を文字にする。grouping=true なら整数部に3桁区切り
  function toText(value, grouping) {
    const v = round(value);
    if (v === 0) return '0';
    const abs = Math.abs(v);
    const [mant, expText] = abs.toExponential(DIGITS - 1).split('e');
    const sign = v < 0 ? '-' : '';

    if (abs >= EXP_HIGH || abs < EXP_LOW) {
      // 仮数の末尾の 0 を消し、大文字の E で書く（1.55112100433E+25）
      const m = mant.replace(/0+$/, '').replace(/\.$/, '');
      return sign + m + 'E' + expText;
    }

    // 指数表記を使わずに小数で書く（String() は 1e-7 などを指数にするため自前で組み立てる）
    const digits = mant.replace('.', '').replace(/0+$/, '') || '0';
    const exp = Number(expText);
    let intPart;
    let fracPart;
    if (exp >= 0) {
      intPart = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
      fracPart = digits.slice(exp + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-exp - 1) + digits;
    }
    if (grouping) intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + intPart + (fracPart ? '.' + fracPart : '');
  }

  // 画面用：丸め＋3桁区切り（2,178）
  function display(value) {
    return toText(value, true);
  }

  // コピー・挿入用：丸めるが区切りなし（1234567.5）。calc.evaluate でそのまま計算できる
  function plain(value) {
    return toText(value, false);
  }

  const api = { round, display, plain };
  // Node（テスト）なら module.exports、ブラウザなら window.ReCalc.format に登録
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (window.ReCalc = window.ReCalc || {}).format = api;
})();
