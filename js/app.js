// 画面の操作・キー操作。SPEC_DETAIL.md §2.1 app.js
// DOM に触るのはこのファイルだけ。計算・整形・保存の中身は calc / normalize / format / store に任せる
(function () {
  'use strict';

  const { calc, normalize, format, store } = window.ReCalc;

  // 画面に出す文
  const TEXT = {
    empty: 'Enter で計算すると、ここに記録が残ります',
    count: (n) => n + '件',
    today: '今日',
    saveFailed: '記録を保存できません',
    tooLongToRecord: '式が長すぎて記録できません',
    confirmClearAll: 'すべての記録を消します。よろしいですか？',
    copied: 'コピーしました',
    copyFailed: 'コピーできませんでした',
    pasteTooLong: '200 文字までです',
    imported: (r) => r.added + '件を読み込みました' + (r.skipped ? '（' + r.skipped + '件は同じ記録のため飛ばしました）' : ''),
    importFailed: (reason) => '読み込めないファイルです（' + reason + '）',
  };

  const RESULT_MAX = 88;   // 結果の文字の大きさ（px。css の --result-size と同じ）
  const RESULT_MIN = 36;   // 長い結果はここまで縮める
  const TOAST_MS = 1500;   // 通知を出しておく時間
  const FLASH_MS = 120;    // キーボードで打ったとき、対応するキーを沈ませておく時間
  const AUTO_ANS_KEYS = ['+', '*', '×', '/', '^'];   // 空欄で入れると先頭に ans を補う（F-04-4。ボタンも同じ）

  const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
  const $ = (id) => document.getElementById(id);
  const el = {
    expr: $('expr'), preview: $('preview'), result: $('result'),
    list: $('list'), count: $('count'), toast: $('toast'), keys: $('keys'), help: $('help'),
  };

  // 状態（app.js の中だけで持つ）
  let storage;        // localStorage（使えなければ何も保存しない代わり）
  let data;           // 読み込んだ Store（E-03）
  let lastValue;      // 結果欄に出している値（コピー用）
  let saveWarned = false;
  let navIndex = null; // ↑↓でいま何番目の記録を出しているか（null = 呼び出していない）
  let draft = '';      // ↑を押す前に打っていた式

  function ctx() {
    return { ans: store.getAns(data), getRecord: (n) => store.getRecord(data, n), angle: data.settings.angle };
  }

  function debugLog(src) {
    if (!DEBUG) return;
    try {
      const tokens = calc.tokenize(src);
      console.debug('[ReCalc] tokens', tokens);
      console.debug('[ReCalc] tree', calc.parse(tokens));
    } catch (e) {
      console.debug('[ReCalc] error', e);
    }
  }

  // ---- 表示 ----

  // 画面に見せる式：掛け算の * は × で見せる（保存する式は * のまま。normalize が × を * に戻す）
  function toDisplay(expr) {
    return expr.replace(/\*/g, '×');
  }

  function showResult(value) {
    lastValue = value;
    el.result.classList.remove('error');
    el.result.textContent = format.display(value);
    fitResult();
  }

  function showError(message) {
    el.result.classList.add('error');
    el.result.style.fontSize = '';
    el.result.textContent = message;
  }

  function clearError() {
    if (el.result.classList.contains('error')) showResult(lastValue);
  }

  // 結果が横幅に収まるまで文字を小さくする
  function fitResult() {
    const r = el.result;
    if (r.classList.contains('error')) return;
    let size = RESULT_MAX;
    r.style.fontSize = size + 'px';
    while (r.scrollWidth > r.clientWidth && size > RESULT_MIN) {
      size -= 2;
      r.style.fontSize = size + 'px';
    }
  }

  function updatePreview() {
    clearError();
    const src = normalize.normalizeExpr(el.expr.value);
    debugLog(src);
    const r = calc.evaluate(src, ctx());
    el.preview.textContent = r.ok ? '= ' + format.display(r.value) : '';
  }

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), TOAST_MS);
  }

  // DEG / RAD のランプ
  function renderAngle() {
    for (const b of document.querySelectorAll('[data-angle]')) {
      const on = b.dataset.angle === data.settings.angle;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  // ---- 記録一覧 ----

  const pad2 = (n) => String(n).padStart(2, '0');

  // 日付の見出し（今日／10月22日）と行の時刻（HH:mm）
  function dayLabel(d, now) {
    if (d.toDateString() === now.toDateString()) return TEXT.today;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function timeLabel(d) {
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function button(className, text, title) {
    const b = document.createElement('button');
    b.className = className;
    b.textContent = text;
    if (title) b.title = title;
    return b;
  }

  // 新しい順に描画。日付が変わるところに見出し。記録の式は textContent で入れる（SPEC.md §1.9）
  function renderHistory() {
    const records = data.records;
    el.count.textContent = TEXT.count(records.length);
    el.list.replaceChildren();
    if (records.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = TEXT.empty;
      el.list.append(li);
      return;
    }
    const now = new Date();
    let lastDay = null;
    for (let n = 1; n <= records.length; n++) {
      const rec = records[records.length - n];
      const d = new Date(rec.createdAt);
      const day = dayLabel(d, now);
      if (day !== lastDay) {
        const sep = document.createElement('li');
        sep.className = 'sep';
        sep.textContent = day;
        el.list.append(sep);
        lastDay = day;
      }
      const li = document.createElement('li');
      li.className = 'rec';
      li.dataset.n = n;
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = timeLabel(d);
      const tools = document.createElement('span');
      tools.className = 'tools';
      tools.append(button('tool', 'コピー', '式 = 結果 をコピー'), button('tool del', '消す', 'この記録を消す'));
      li.append(button('no', '#' + n), button('ex', toDisplay(rec.expr)), button('val', format.display(rec.value)), when, tools);
      el.list.append(li);
    }
  }

  // ---- 入力 ----

  // 選択範囲を置き換えて挿入し、カーソルを挿入した文字の後ろへ。入力欄の上限を超える分は切り捨て、切ったら true
  function insertAtCursor(text) {
    const input = el.expr;
    const room = input.maxLength - input.value.length + (input.selectionEnd - input.selectionStart);
    const cut = text.length > room;
    input.setRangeText(cut ? text.slice(0, Math.max(room, 0)) : text, input.selectionStart, input.selectionEnd, 'end');
    updatePreview();
    return cut;
  }

  // 入力欄全体を置き換え、カーソルを末尾へ
  function setInput(text) {
    el.expr.value = text;
    el.expr.setSelectionRange(text.length, text.length);
    updatePreview();
  }

  // 演算子などを入れる。空欄で + × / ^ なら先頭に ans を補う（F-04-4）
  function typeText(text) {
    if (AUTO_ANS_KEYS.includes(text) && el.expr.value === '' && data.records.length > 0) text = 'ans' + text;
    insertAtCursor(toDisplay(text));
  }

  function backspace() {
    const input = el.expr;
    const { selectionStart: a, selectionEnd: b } = input;
    if (a !== b) input.setRangeText('', a, b, 'end');
    else if (a > 0) input.setRangeText('', a - 1, a, 'end');
    updatePreview();
  }

  // ± ：式全体を -(式) で囲む／外す。空なら - を入れる（F-01-2）
  function negate() {
    const v = el.expr.value;
    if (v === '') return insertAtCursor('-');
    const m = /^-\((.*)\)$/.exec(v);
    setInput(m && isBalanced(m[1]) ? m[1] : '-(' + v + ')');
  }

  // かっこが途中で閉じすぎていないか（-(1)+(2) の外側を外さないため）
  function isBalanced(text) {
    let depth = 0;
    for (const c of text) {
      if (c === '(') depth++;
      else if (c === ')' && --depth < 0) return false;
    }
    return depth === 0;
  }

  function setAngle(unit) {
    data.settings.angle = unit;
    persist();
    renderAngle();
    updatePreview();
  }

  // ↑↓：前の記録の式を呼び出す（F-04-5）
  function recall(step) {
    const len = data.records.length;
    if (step > 0) {
      if (len === 0) return;
      if (navIndex === null) {
        draft = el.expr.value;
        navIndex = 1;
      } else {
        navIndex = Math.min(navIndex + 1, len);
      }
    } else {
      if (navIndex === null) return;
      navIndex--;
      if (navIndex === 0) {
        navIndex = null;
        return setInput(draft);
      }
    }
    setInput(toDisplay(data.records[len - navIndex].expr));
  }

  // キーボードで打ったとき、対応するキーを沈んだ見た目にする
  function flashKey(key) {
    const k = key === '*' ? '×' : key;
    const btn = [...el.keys.querySelectorAll('button')].find((b) => b.dataset.key === k || b.dataset.insert === k);
    if (!btn) return;
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), FLASH_MS);
  }

  function onKeyClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (btn.dataset.insert !== undefined) typeText(btn.dataset.insert);
    else if (action === 'commit') commit();
    else if (action === 'clear') clearInput();
    else if (action === 'backspace') backspace();
    else if (action === 'negate') negate();
    else if (action === 'copy') copyResult();
    el.expr.focus();
  }

  // 記録のクリック（F-04-1）・削除（F-03-4）
  function onHistoryClick(e) {
    const btn = e.target.closest('button');
    const li = btn && btn.closest('.rec');
    if (!li) return;
    const n = Number(li.dataset.n);
    const rec = data.records[data.records.length - n];
    const input = el.expr;
    if (btn.classList.contains('no')) insertAtCursor('#' + n);
    else if (btn.classList.contains('ex')) insertAtCursor('(' + toDisplay(rec.expr) + ')');
    else if (btn.classList.contains('val')) insertAtCursor(calc.wrapValue(format.plain(rec.value), input.value.slice(0, input.selectionStart)));
    else if (btn.classList.contains('tool') && !btn.classList.contains('del')) {
      copyText(toDisplay(rec.expr) + ' = ' + format.display(rec.value));
    } else if (btn.classList.contains('del')) {
      store.deleteRecord(data, n);
      persist();
      renderHistory();
      updatePreview();
    }
    input.focus();
  }

  // ---- クリップボード（F-05） ----

  // navigator.clipboard を使い、使えなければ隠し textarea＋execCommand('copy') で代用する（SPEC_VALIDATION.md Q-01）
  async function copyText(text) {
    let ok = false;
    let path = 'clipboard';
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      path = 'execCommand';
      ok = copyByTextarea(text);
    }
    if (DEBUG) console.debug('[ReCalc] copy path=' + path + ' ok=' + ok + ' text=' + text);
    toast(ok ? TEXT.copied : TEXT.copyFailed);
  }

  function copyByTextarea(text) {
    const input = el.expr;
    const { selectionStart: a, selectionEnd: b } = input;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    ta.remove();
    input.focus();
    input.setSelectionRange(a, b);
    return ok;
  }

  function copyResult() {
    copyText(format.plain(lastValue));
  }

  // 貼り付けた文字を整形してから入れる（F-05-3）
  function onPaste(e) {
    e.preventDefault();
    const text = toDisplay(normalize.normalizePaste(e.clipboardData.getData('text')));
    if (insertAtCursor(text)) toast(TEXT.pasteTooLong);
  }

  // ---- 書き出し・読み込み（F-06） ----

  function exportFile(kind) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = 'recalc-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.' + kind;
    const blob = kind === 'json'
      ? new Blob([store.toJSON(data)], { type: 'application/json' })
      : new Blob([store.toCSV(data)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    el.expr.focus();
  }

  async function importFile(file) {
    try {
      const result = store.importJSON(data, await file.text());
      persist();
      renderHistory();
      updatePreview();
      toast(TEXT.imported(result));
    } catch (e) {
      if (!(e instanceof store.ImportError)) throw e;
      toast(TEXT.importFailed(e.message));
    }
    el.expr.focus();
  }

  // ---- ヘルプ（S-02） ----

  function openHelp() {
    if (!el.help.open) el.help.showModal();
  }

  function closeHelp() {
    el.help.close();   // close イベントで入力欄にフォーカスを戻す
  }

  // パネルの外（暗くした所）をクリックしたら閉じる
  function onHelpClick(e) {
    const r = el.help.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) closeHelp();
  }

  function clearAllRecords() {
    if (data.records.length === 0 || !window.confirm(TEXT.confirmClearAll)) return;
    store.clearAll(data);
    persist();
    renderHistory();
    updatePreview();
    el.expr.focus();
  }

  function persist() {
    if (!store.save(storage, data) && !saveWarned) {
      saveWarned = true;
      toast(TEXT.saveFailed);
    }
  }

  // 確定（SPEC_DETAIL.md §2.0「確定後の流れ」）
  function commit() {
    const src = normalize.normalizeExpr(el.expr.value);
    debugLog(src);
    const c = ctx();
    const r = calc.evaluate(src, c);
    if (!r.ok) {
      if (r.error.code !== 'EMPTY') showError(r.error.message);
      return;
    }
    const expr = calc.resolveRefs(src, c);
    if (expr.length > store.MAX_EXPR_LENGTH) {
      toast(TEXT.tooLongToRecord);
    } else {
      store.addRecord(data, expr, r.value);
      persist();
    }
    showResult(r.value);
    el.expr.value = '';
    el.preview.textContent = '';
    navIndex = null;
    renderHistory();
  }

  function clearInput() {
    el.expr.value = '';
    el.preview.textContent = '';
    navIndex = null;
    clearError();
  }

  function onKeyDown(e) {
    if (e.isComposing) return;
    const plainKey = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (plainKey) flashKey(e.key);
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearInput();
    } else if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey) && !e.altKey &&
        el.expr.selectionStart === el.expr.selectionEnd) {
      // 文字を選んでいないときだけ結果をコピー（選んでいれば普通のコピー）
      e.preventDefault();
      copyResult();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      recall(e.key === 'ArrowUp' ? 1 : -1);
    } else if ((AUTO_ANS_KEYS.includes(e.key) || e.key === '*') && plainKey) {
      // * は × で見せる。空欄なら ans を補う
      e.preventDefault();
      typeText(e.key);
    }
  }

  // ---- 起動 ----

  function init() {
    try {
      storage = window.localStorage;
    } catch (e) {
      // プライベートモードなどで localStorage に触れない。保存は毎回失敗させて1回だけ通知する
      storage = { getItem: () => null, setItem: () => { throw e; } };
    }
    data = store.load(storage);
    showResult(store.getAns(data));
    renderAngle();
    renderHistory();

    el.expr.addEventListener('keydown', onKeyDown);
    el.expr.addEventListener('input', updatePreview);
    // ボタンを押しても入力欄のフォーカス（とカーソル位置）を外さない
    for (const area of [el.keys, el.list, document.querySelector('.unit')]) {
      area.addEventListener('mousedown', (e) => e.target.closest('button') && e.preventDefault());
    }
    el.keys.addEventListener('click', onKeyClick);
    el.list.addEventListener('click', onHistoryClick);
    for (const b of document.querySelectorAll('[data-angle]')) {
      b.addEventListener('click', () => {
        setAngle(b.dataset.angle);
        el.expr.focus();
      });
    }
    $('clear-all').addEventListener('click', clearAllRecords);
    $('help-open').addEventListener('click', openHelp);
    $('help-close').addEventListener('click', closeHelp);
    el.help.addEventListener('click', onHelpClick);
    // Esc でも閉じる（dialog の既定動作）。ブラウザが開く前の場所へフォーカスを戻した後で、入力欄へ移す
    el.help.addEventListener('close', () => setTimeout(() => el.expr.focus()));
    // F1 はどこにフォーカスがあってもヘルプを開く（ブラウザの既定動作を止める）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        openHelp();
      }
    });
    el.expr.addEventListener('paste', onPaste);
    $('export-json').addEventListener('click', () => exportFile('json'));
    $('export-csv').addEventListener('click', () => exportFile('csv'));
    const fileInput = $('import-file');
    $('import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) importFile(fileInput.files[0]);
      fileInput.value = '';   // 同じファイルをもう一度選べるようにする
    });
    window.addEventListener('resize', fitResult);
    document.fonts && document.fonts.ready.then(fitResult);
    el.expr.focus();
  }

  init();
})();
