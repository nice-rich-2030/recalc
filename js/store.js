// 記録・設定の保存、書き出し・読み込み。SPEC_DETAIL.md §2.1 store.js / SPEC.md §1.4（E-01〜E-03）
// localStorage は直接触らず、呼ぶ側から storage（getItem / setItem を持つもの）を受け取る
(function () {
  'use strict';

  // CSV の結果を画面と同じ形にするため format.js を使う（ブラウザでは先に読み込まれている）
  const format = typeof module !== 'undefined' && module.exports ? require('./format.js') : window.ReCalc.format;

  const KEY = 'recalc:v1';
  const BROKEN_KEY = 'recalc:broken';
  const VERSION = 1;
  const MAX_RECORDS = 1000;       // 記録の上限（F-03-5）
  const MAX_EXPR_LENGTH = 1000;   // 記録・読み込みの式の上限（C-6, C-7）

  class ImportError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ImportError';
    }
  }

  function emptyStore() {
    return { version: VERSION, records: [], settings: { angle: 'deg' } };
  }

  // E-01 として正しいか
  function isRecord(r) {
    return r !== null && typeof r === 'object' &&
      typeof r.expr === 'string' && r.expr.length <= MAX_EXPR_LENGTH &&
      typeof r.value === 'number' && Number.isFinite(r.value) &&
      typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt));
  }

  // E-03 の形を確かめ、だめな理由を返す（正しければ null）
  function checkStore(data) {
    if (data === null || typeof data !== 'object') return '形式が違います';
    if (data.version !== VERSION) return '対応していない版です';
    if (!Array.isArray(data.records)) return '記録がありません';
    if (data.records.length > MAX_RECORDS) return '記録が多すぎます';
    if (!data.records.every(isRecord)) return '記録の中身が正しくありません';
    return null;
  }

  function cleanSettings(s) {
    return { angle: s && s.angle === 'rad' ? 'rad' : 'deg' };
  }

  // recalc:v1 を読む。ない・壊れている → 空の Store。壊れていたら元データを recalc:broken に退避
  function load(storage) {
    let text;
    try {
      text = storage.getItem(KEY);
    } catch (e) {
      return emptyStore();
    }
    if (text === null || text === undefined) return emptyStore();
    try {
      const data = JSON.parse(text);
      if (checkStore(data) === null) {
        return { version: VERSION, records: data.records, settings: cleanSettings(data.settings) };
      }
    } catch (e) {
      // 下で退避する
    }
    try {
      storage.setItem(BROKEN_KEY, text);
    } catch (e) {
      // 退避できなくても起動は続ける
    }
    return emptyStore();
  }

  // JSON にして書く。失敗したら false（例外を外へ出さない）
  function save(storage, data) {
    try {
      storage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function trim(data) {
    const over = data.records.length - MAX_RECORDS;
    if (over > 0) data.records.splice(0, over);
  }

  // E-01 を作って末尾へ。1000件を超えたら先頭から削る。追加した記録を返す
  function addRecord(data, expr, value, now) {
    const rec = { expr, value, createdAt: (now || new Date()).toISOString() };
    data.records.push(rec);
    trim(data);
    return rec;
  }

  // n 個前の記録（相対番号 #n）を1件削除
  function deleteRecord(data, n) {
    const idx = data.records.length - n;
    if (Number.isInteger(n) && n >= 1 && idx >= 0) data.records.splice(idx, 1);
  }

  function clearAll(data) {
    data.records = [];
  }

  // n 個前の記録の value（#1 = 最後の要素）。範囲外なら undefined
  function getRecord(data, n) {
    const len = data.records.length;
    if (!Number.isInteger(n) || n < 1 || n > len) return undefined;
    return data.records[len - n].value;
  }

  function getAns(data) {
    const len = data.records.length;
    return len ? data.records[len - 1].value : 0;
  }

  // 書き出し用の JSON（E-03 そのまま、字下げあり）
  function toJSON(data) {
    return JSON.stringify(data, null, 2);
  }

  // ローカル時刻の YYYY-MM-DD HH:mm
  function localDateTime(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 先頭に BOM、日時,式,結果 の CSV（古い順）。Excel 向けに行末は CRLF
  function toCSV(data) {
    const quote = (s) => '"' + s.replace(/"/g, '""') + '"';
    const rows = data.records.map((r) => [localDateTime(r.createdAt), quote(r.expr), format.plain(r.value)].join(','));
    return '﻿' + ['日時,式,結果', ...rows].join('\r\n') + '\r\n';
  }

  // 検証してから記録を追加し、日時の古い順に並べ直す。形が違えば ImportError（何も変えない）
  function importJSON(data, text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new ImportError('JSON として読めません');
    }
    const problem = checkStore(parsed);
    if (problem) throw new ImportError(problem);

    // ここから先は検証済みなので書き換えてよい
    const keyOf = (r) => r.createdAt + '\u0000' + r.expr;
    const seen = new Set(data.records.map(keyOf));
    let added = 0;
    let skipped = 0;
    for (const r of parsed.records) {
      const key = keyOf(r);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      data.records.push({ expr: r.expr, value: r.value, createdAt: r.createdAt });
      added++;
    }
    data.records.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    trim(data);
    return { added, skipped };
  }

  const api = {
    KEY, MAX_RECORDS, MAX_EXPR_LENGTH, ImportError,
    load, save, addRecord, deleteRecord, clearAll, getRecord, getAns, toJSON, toCSV, importJSON,
  };
  // Node（テスト）なら module.exports、ブラウザなら window.ReCalc.store に登録
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (window.ReCalc = window.ReCalc || {}).store = api;
})();
