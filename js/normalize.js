// 人が打った・貼った文字を、計算できる形にそろえる。SPEC_DETAIL.md §2.1 normalize.js
(function () {
  'use strict';

  // 全角英数記号（！〜～）と全角空白を半角にする
  function toHalfWidth(text) {
    return text
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ');
  }

  // x / X は、前が数・)・定数（π pi e ans）・後置演算子のときだけ掛け算とみなす（§2.3 C-3）
  const VALUE_END = /(?:[\d.)!%π]|(?:^|[^a-zA-Z])(?:pi|e|ans))$/;
  function replaceX(text) {
    let out = '';
    for (const c of text) {
      out += (c === 'x' || c === 'X') && VALUE_END.test(out) ? '*' : c;
    }
    return out;
  }

  // 記号をそろえる（× x ÷ − – → * / -）
  function unifySymbols(text) {
    return replaceX(text.replace(/×/g, '*'))
      .replace(/÷/g, '/')
      .replace(/[−–]/g, '-')
      .replace(/(?<=\d)ー(?=\d)/g, '-');
  }

  // 記録する式用：記号だけそろえ、空白を除く（2 × π → 2*π）
  function normalizeExpr(text) {
    return unifySymbols(text.replace(/\s+/g, ''));
  }

  // 貼り付け用：全部の整形を行う（¥1,234,567 → 1234567、１２×３ → 12*3）
  function normalizePaste(text) {
    return unifySymbols(toHalfWidth(text).replace(/[¥$€￥\s]/g, ''))
      // 数字3桁ごとの , だけを桁区切りとみなして除く（1,2 はそのまま残す）
      .replace(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,])/g, (m) => m.replace(/,/g, ''));
  }

  const api = { normalizePaste, normalizeExpr, toHalfWidth };
  // Node（テスト）なら module.exports、ブラウザなら window.ReCalc.normalize に登録
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (window.ReCalc = window.ReCalc || {}).normalize = api;
})();
