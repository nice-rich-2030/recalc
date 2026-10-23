// 構文解析と計算（画面に依存しない）。SPEC_DETAIL.md §2.1 calc.js / §2.3 C-1〜C-4, C-7
// eval と Function() は使わない（SPEC.md §1.9）
(function () {
  'use strict';

  // エラーの文（code → 画面に出す文。%s に文字や番号が入る）
  const MESSAGES = {
    EMPTY: '',
    BAD_CHAR: '使えない文字があります: %s',
    UNKNOWN_FUNC: '知らない関数: %s',
    PAREN_OPEN: 'かっこが閉じていません',
    PAREN_EXTRA: 'かっこが多すぎます',
    INCOMPLETE: '式が途中で終わっています',
    DIV_ZERO: '0 で割ることはできません',
    NO_RECORD: '#%s の記録はありません',
    DOMAIN: '計算できない値です',
    OVERFLOW: '数が大きすぎます',
  };

  const MAX_DEPTH = 100;     // かっこの入れ子の上限（C-2）
  const SNAP = 1e-12;        // 三角関数の結果をこれ未満なら 0 にする（C-4）
  const MAX_FACTORIAL = 170; // これを超える階乗は OVERFLOW（C-4）

  class CalcError extends Error {
    constructor(code, pos, arg, key) {
      super(MESSAGES[key || code].replace('%s', arg));
      this.name = 'CalcError';
      this.code = code;
      this.pos = pos;
    }
  }

  const FUNCS = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'ln', 'sqrt', 'abs'];
  const CONSTS = ['pi', 'e', 'ans'];

  // 演算子の強さ（C-1）。演算子を足すときはここに1行足す
  const INFIX = {
    '+': { power: 10, right: false },
    '-': { power: 10, right: false },
    '*': { power: 20, right: false },
    '/': { power: 20, right: false },
    '^': { power: 40, right: true },
  };
  const PREFIX_POWER = 30;   // 前置 - + √
  const POSTFIX_POWER = 50;  // 後置 ! %

  const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?/;   // 指数は大文字 E のみ（C-3）
  const SYMBOLS = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '/': '/', '÷': '/', '^': '^', '!': '!', '%': '%', '√': '√' };

  // 値で終わるトークンか（この後ろに x は掛け算、( や定数は省略した掛け算になる）
  function endsValue(t) {
    return t && (t.type === 'num' || t.type === 'rp' || t.type === 'ref' ||
      (t.type === 'name' && CONSTS.includes(t.value)) ||
      (t.type === 'op' && (t.value === '!' || t.value === '%')));
  }

  // 省略した掛け算の右側になれるトークンか（C-3）
  function startsImplicit(t) {
    return t.type === 'lp' || t.type === 'name' || t.type === 'ref' || (t.type === 'op' && t.value === '√');
  }

  // 文字列 → トークン配列。各トークンは { type, value, pos, end }（pos〜end は元の文字の範囲）
  function tokenize(src) {
    const tokens = [];
    const push = (t) => {
      const prev = tokens[tokens.length - 1];
      if (endsValue(prev) && startsImplicit(t)) {
        tokens.push({ type: 'op', value: '*', pos: t.pos, end: t.pos, implicit: true });
      }
      tokens.push(t);
    };

    let i = 0;
    while (i < src.length) {
      const c = src[i];
      const rest = src.slice(i);
      let m;
      if (/\s/.test(c)) {
        i++;
      } else if ((m = NUMBER.exec(rest))) {
        push({ type: 'num', value: Number(m[0]), pos: i, end: i + m[0].length });
        i += m[0].length;
      } else if (c === '#') {
        m = /^#(\d+)/.exec(rest);
        if (!m) throw new CalcError('BAD_CHAR', i, '#');
        push({ type: 'ref', value: Number(m[1]), pos: i, end: i + m[0].length });
        i += m[0].length;
      } else if ((c === 'x' || c === 'X') && endsValue(tokens[tokens.length - 1])) {
        push({ type: 'op', value: '*', pos: i, end: i + 1 });
        i++;
      } else if (/[a-zA-Z]/.test(c)) {
        const name = /^[a-zA-Z]+/.exec(rest)[0];
        if (!FUNCS.includes(name) && !CONSTS.includes(name)) throw new CalcError('UNKNOWN_FUNC', i, name);
        push({ type: 'name', value: name, pos: i, end: i + name.length });
        i += name.length;
      } else if (c === 'π') {
        push({ type: 'name', value: 'pi', pos: i, end: i + 1 });
        i++;
      } else if (c === '(' || c === ')') {
        push({ type: c === '(' ? 'lp' : 'rp', pos: i, end: i + 1 });
        i++;
      } else if (SYMBOLS[c]) {
        push({ type: 'op', value: SYMBOLS[c], pos: i, end: i + 1 });
        i++;
      } else {
        throw new CalcError('BAD_CHAR', i, c);
      }
    }
    return tokens;
  }

  // トークン配列 → 構文木（Pratt 方式の再帰下降。C-2）
  function parse(tokens) {
    if (tokens.length === 0) throw new CalcError('EMPTY', 0);
    let i = 0;
    let depth = 0;
    const endPos = tokens[tokens.length - 1].end;
    const peek = () => tokens[i];
    const next = () => tokens[i++];

    // 開いたかっこを閉じる。足りなければ PAREN、別のものが来たら INCOMPLETE
    function closeParen() {
      const t = peek();
      if (!t) throw new CalcError('PAREN', endPos, '', 'PAREN_OPEN');
      if (t.type !== 'rp') throw new CalcError('INCOMPLETE', t.pos);
      i++;
      depth--;
    }

    function openParen(pos) {
      if (++depth > MAX_DEPTH) throw new CalcError('INCOMPLETE', pos);
    }

    function nud(t) {
      if (!t) throw new CalcError('INCOMPLETE', endPos);
      switch (t.type) {
        case 'num':
          return { type: 'num', value: t.value };
        case 'ref':
          return { type: 'ref', n: t.value, pos: t.pos };
        case 'lp': {
          openParen(t.pos);
          const inner = parseExpr(0);
          closeParen();
          return inner;
        }
        case 'name': {
          if (CONSTS.includes(t.value)) return { type: 'const', name: t.value };
          // 関数は必ずかっこを取る（sin 30 はエラー。C-1）
          const lp = next();
          if (!lp || lp.type !== 'lp') throw new CalcError('INCOMPLETE', lp ? lp.pos : endPos);
          openParen(lp.pos);
          const arg = parseExpr(0);
          closeParen();
          return { type: 'call', name: t.value, arg };
        }
        case 'op':
          if (t.value === '-' || t.value === '+' || t.value === '√') {
            return { type: 'prefix', op: t.value, arg: parseExpr(PREFIX_POWER) };
          }
          throw new CalcError('INCOMPLETE', t.pos);
        default:
          throw new CalcError('INCOMPLETE', t.pos);
      }
    }

    function parseExpr(minPower) {
      let left = nud(next());
      for (;;) {
        const t = peek();
        if (!t || t.type !== 'op') break;
        if (t.value === '!' || t.value === '%') {
          if (POSTFIX_POWER <= minPower) break;
          i++;
          left = { type: 'postfix', op: t.value, arg: left };
          continue;
        }
        const info = INFIX[t.value];
        if (!info || info.power <= minPower) break;
        i++;
        const right = parseExpr(info.right ? info.power - 1 : info.power);
        left = { type: 'binary', op: t.value, left, right };
      }
      return left;
    }

    const tree = parseExpr(0);
    const rest = peek();
    if (rest) {
      if (rest.type === 'rp') throw new CalcError('PAREN', rest.pos, '', 'PAREN_EXTRA');
      // 数の後ろに数（π2、(3)4）など
      throw new CalcError('INCOMPLETE', rest.pos);
    }
    return tree;
  }

  // 結果が有限の数であることを確かめる（C-4 結果全体）
  function check(value) {
    if (Number.isNaN(value)) throw new CalcError('DOMAIN', 0);
    if (!Number.isFinite(value)) throw new CalcError('OVERFLOW', 0);
    return value;
  }

  function snap(value) {
    return Math.abs(value) < SNAP ? 0 : value;
  }

  function factorial(n) {
    if (n < 0 || !Number.isInteger(n)) throw new CalcError('DOMAIN', 0);
    if (n > MAX_FACTORIAL) throw new CalcError('OVERFLOW', 0);
    let r = 1;
    for (let k = 2; k <= n; k++) r *= k;
    return r;
  }

  function callFunc(name, x, angle) {
    const deg = angle === 'deg';
    const toRad = (v) => (deg ? (v * Math.PI) / 180 : v);
    const fromRad = (v) => (deg ? (v * 180) / Math.PI : v);
    switch (name) {
      case 'sin': return snap(Math.sin(toRad(x)));
      case 'cos': return snap(Math.cos(toRad(x)));
      case 'tan': {
        // 度モードで 90 の奇数倍は定義されない
        if (deg && Number.isInteger(x / 90) && (x / 90) % 2 !== 0) throw new CalcError('DOMAIN', 0);
        return snap(Math.tan(toRad(x)));
      }
      case 'asin':
      case 'acos':
        if (x < -1 || x > 1) throw new CalcError('DOMAIN', 0);
        return fromRad(name === 'asin' ? Math.asin(x) : Math.acos(x));
      case 'atan': return fromRad(Math.atan(x));
      case 'log':
      case 'ln':
        if (x <= 0) throw new CalcError('DOMAIN', 0);
        return name === 'log' ? Math.log10(x) : Math.log(x);
      case 'sqrt':
        if (x < 0) throw new CalcError('DOMAIN', 0);
        return Math.sqrt(x);
      case 'abs': return Math.abs(x);
    }
  }

  // 構文木 → 数値
  function evalNode(node, ctx) {
    switch (node.type) {
      case 'num':
        return node.value;
      case 'const':
        if (node.name === 'pi') return Math.PI;
        if (node.name === 'e') return Math.E;
        return ctx.ans;
      case 'ref': {
        const v = ctx.getRecord(node.n);
        if (v === undefined) throw new CalcError('NO_RECORD', node.pos, node.n);
        return v;
      }
      case 'call':
        return check(callFunc(node.name, evalNode(node.arg, ctx), ctx.angle));
      case 'prefix': {
        const x = evalNode(node.arg, ctx);
        if (node.op === '-') return -x;
        if (node.op === '+') return x;
        if (x < 0) throw new CalcError('DOMAIN', 0);
        return Math.sqrt(x);
      }
      case 'postfix': {
        const x = evalNode(node.arg, ctx);
        return check(node.op === '!' ? factorial(x) : x / 100);
      }
      case 'binary': {
        const a = evalNode(node.left, ctx);
        const b = evalNode(node.right, ctx);
        switch (node.op) {
          case '+': return check(a + b);
          case '-': return check(a - b);
          case '*': return check(a * b);
          case '/':
            if (b === 0) throw new CalcError('DIV_ZERO', 0);
            return check(a / b);
          case '^': return check(Math.pow(a, b));
        }
      }
    }
    throw new Error('unknown node: ' + node.type);
  }

  // ctx の既定値をそろえる
  function withDefaults(ctx) {
    return {
      ans: 0,
      getRecord: () => undefined,
      angle: 'deg',
      ...ctx,
    };
  }

  // 外から使う唯一の入口。{ ok:true, value } / { ok:false, error }。CalcError を外へ出さない
  function evaluate(src, ctx) {
    try {
      const c = withDefaults(ctx);
      return { ok: true, value: evalNode(parse(tokenize(src)), c) };
    } catch (e) {
      if (e instanceof CalcError) return { ok: false, error: e };
      throw e;
    }
  }

  // 値を式の中に入れる文字（C-7）。最短表記で、指数の e は E にする
  function valueText(value) {
    return String(value).replace('e', 'E');
  }

  // 記録用：#n と ans を確定時の値に置き換えた式を返す（C-7）。evaluate が成功した式にだけ使う
  function resolveRefs(src, ctx) {
    const c = withDefaults(ctx);
    let out = '';
    let last = 0;
    for (const t of tokenize(src)) {
      let value;
      if (t.type === 'ref') value = c.getRecord(t.value);
      else if (t.type === 'name' && t.value === 'ans') value = c.ans;
      else continue;
      out += src.slice(last, t.pos) + wrapValue(valueText(value), src.slice(0, t.pos));
      last = t.end;
    }
    return out + src.slice(last);
  }

  // 数値の文字を式に入れるとき、必要なら ( ) で囲む（C-7。記録のクリック挿入 F-04-1 でも使う）
  // 負の数・指数表記、または直前（before の最後の文字）が演算子・( ・先頭以外なら囲む（2#1 を 22178 にしない）
  function wrapValue(text, before) {
    const prevChar = before.replace(/\s+$/, '').slice(-1);
    const safePrev = prevChar === '' || '+-−*×/÷^√('.includes(prevChar);
    return text.startsWith('-') || text.includes('E') || !safePrev ? '(' + text + ')' : text;
  }

  const api = { evaluate, tokenize, parse, evalNode, resolveRefs, wrapValue, CalcError, MESSAGES };
  // Node（テスト）なら module.exports、ブラウザなら window.ReCalc.calc に登録
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (window.ReCalc = window.ReCalc || {}).calc = api;
})();
