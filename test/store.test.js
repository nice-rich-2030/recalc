// store.js のテスト。SPEC.md §1.3（F-03, F-06 と受け渡し基準）と SPEC_DETAIL.md §2.1 store.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../js/store.js');
const calc = require('../js/calc.js');
const normalize = require('../js/normalize.js');

// localStorage の代わり
function fakeStorage(initial = {}, { failWrite = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failWrite) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
  };
}

function storeWith(values) {
  const data = store.load(fakeStorage());
  values.forEach((v, i) => store.addRecord(data, String(v), v, new Date(Date.UTC(2026, 9, 23, 1, i))));
  return data;
}

// app.js の commit と同じ流れで1件確定する（SPEC_DETAIL.md §2.0）
function commit(data, input, now) {
  const expr = normalize.normalizeExpr(input);
  const ctx = { ans: store.getAns(data), getRecord: (n) => store.getRecord(data, n), angle: data.settings.angle };
  const r = calc.evaluate(expr, ctx);
  assert.ok(r.ok, input);
  store.addRecord(data, calc.resolveRefs(expr, ctx), r.value, now);
  return r.value;
}

test('E-03 空の Store と load / save', () => {
  const storage = fakeStorage();
  const data = store.load(storage);
  assert.deepEqual(data, { version: 1, records: [], settings: { angle: 'deg' } });
  store.addRecord(data, '1+1', 2, new Date('2026-10-23T01:00:00Z'));
  data.settings.angle = 'rad';
  assert.equal(store.save(storage, data), true);
  assert.deepEqual(store.load(storage), data);
  assert.equal(store.KEY, 'recalc:v1');
  assert.ok(storage.map.has('recalc:v1'));
});

test('壊れたデータは recalc:broken に退避して空で起動', () => {
  const storage = fakeStorage({ 'recalc:v1': '{壊れた' });
  assert.deepEqual(store.load(storage).records, []);
  assert.equal(storage.map.get('recalc:broken'), '{壊れた');

  const wrong = fakeStorage({ 'recalc:v1': JSON.stringify({ version: 1, records: [{ expr: 1 }] }) });
  assert.deepEqual(store.load(wrong).records, []);
  assert.ok(wrong.map.has('recalc:broken'));
});

test('save の失敗は false（例外を出さない）', () => {
  const data = store.load(fakeStorage());
  assert.equal(store.save(fakeStorage({}, { failWrite: true }), data), false);
  const throwing = { getItem: () => { throw new Error('SecurityError'); } };
  assert.deepEqual(store.load(throwing).records, []);
});

test('F-03-5 上限 1000 件。超えたら古い記録から消える', () => {
  const data = storeWith([]);
  for (let i = 1; i <= 1001; i++) store.addRecord(data, String(i), i);
  assert.equal(data.records.length, 1000);
  assert.equal(data.records[0].value, 2);
  assert.equal(store.getRecord(data, 1), 1001);
});

test('F-04-3 getRecord(data, 1) は最新。範囲外は undefined', () => {
  const data = storeWith([10, 20, 30]);
  assert.equal(store.getRecord(data, 1), 30);
  assert.equal(store.getRecord(data, 3), 10);
  assert.equal(store.getRecord(data, 0), undefined);
  assert.equal(store.getRecord(data, 4), undefined);
  assert.equal(store.getAns(data), 30);
  assert.equal(store.getAns(storeWith([])), 0);
});

test('F-03-4 削除で番号が詰まる・すべて消す', () => {
  const data = storeWith([10, 20, 30, 40]); // #1=40 #2=30 #3=20 #4=10
  store.deleteRecord(data, 2);
  assert.deepEqual(data.records.map((r) => r.value), [10, 20, 40]);
  assert.equal(store.getRecord(data, 2), 20);
  store.deleteRecord(data, 9);
  assert.equal(data.records.length, 3);
  store.clearAll(data);
  assert.deepEqual(data.records, []);
});

test('F-03-1 / §1.5 シナリオ 2〜4：確定の流れと相対番号', () => {
  const data = storeWith([]);
  assert.equal(commit(data, '1980*1.1'), 2178);
  assert.equal(commit(data, 'ans*12'), 26136);
  assert.equal(data.records[1].expr, '2178*12');
  assert.equal(store.getRecord(data, 2), 2178);
  assert.equal(commit(data, '#2/3'), 726);
  assert.equal(data.records[2].expr, '2178/3');
  // 丸める前の値がそのまま式に入る
  commit(data, '0.1+0.2');
  commit(data, '#1*10');
  assert.equal(data.records[4].expr, '0.30000000000000004*10');
});

test('F-04 受け渡し基準：記録の式を入れ直すと同じ結果', () => {
  const data = storeWith([]);
  commit(data, '1980*1.1');
  commit(data, '#1*12+ans');
  const rec = data.records[1];
  const again = calc.evaluate('(' + rec.expr + ')', { ans: 0, getRecord: () => undefined, angle: 'deg' });
  assert.equal(again.value, rec.value);
});

test('F-06-2 CSV（BOM 付き、古い順、ローカル時刻、12 桁の結果、" のエスケープ）', () => {
  const data = storeWith([]);
  // ローカル時刻で作るので、テストを動かす端末のタイムゾーンに関係なく同じ文字になる
  store.addRecord(data, '1+1', 2, new Date(2026, 9, 22, 21, 5));
  store.addRecord(data, 'a"b,c', 0.30000000000000004, new Date(2026, 9, 23, 9, 44));
  store.addRecord(data, '25!', [...Array(25)].reduce((p, _, i) => p * (i + 1), 1), new Date(2026, 9, 23, 10, 0));
  const csv = store.toCSV(data);
  assert.equal(csv[0], '﻿');
  assert.equal(csv.slice(1), [
    '日時,式,結果',
    '2026-10-22 21:05,"1+1",2',
    '2026-10-23 09:44,"a""b,c",0.3',
    '2026-10-23 10:00,"25!",1.55112100433E+25',
    '',
  ].join('\r\n'));
});

test('F-06-3 importJSON：追加して日時順・重複は飛ばす', () => {
  const data = storeWith([]);
  store.addRecord(data, '1+1', 2, new Date('2026-10-23T02:00:00Z'));
  const other = storeWith([]);
  store.addRecord(other, '1+1', 2, new Date('2026-10-23T02:00:00Z'));  // 重複
  store.addRecord(other, '5*5', 25, new Date('2026-10-22T09:00:00Z')); // 古い
  const result = store.importJSON(data, store.toJSON(other));
  assert.deepEqual(result, { added: 1, skipped: 1 });
  assert.deepEqual(data.records.map((r) => r.expr), ['5*5', '1+1']);
});

test('F-06-3 importJSON：合計 1000 件を超えたら古い方から消す', () => {
  const data = storeWith([]);
  for (let i = 0; i < 600; i++) store.addRecord(data, 'a' + i, i, new Date(Date.UTC(2026, 9, 23, 0, 0, i)));
  const other = storeWith([]);
  for (let i = 0; i < 600; i++) store.addRecord(other, 'b' + i, i, new Date(Date.UTC(2026, 9, 22, 0, 0, i)));
  store.importJSON(data, store.toJSON(other));
  assert.equal(data.records.length, 1000);
  assert.equal(data.records[0].expr, 'b200');
  assert.equal(data.records[999].expr, 'a599');
});

test('F-06-3 importJSON：形が違えば ImportError で何も変えない', () => {
  const data = storeWith([1, 2]);
  const before = JSON.stringify(data);
  const good = { expr: '1', value: 1, createdAt: '2026-10-23T00:00:00.000Z' };
  const bad = [
    'これは JSON ではない',
    'null',
    '[]',
    JSON.stringify({ version: 2, records: [] }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, records: Array(1001).fill(good) }),
    JSON.stringify({ version: 1, records: [good, { ...good, expr: 5 }] }),
    JSON.stringify({ version: 1, records: [{ ...good, expr: 'x'.repeat(1001) }] }),
    JSON.stringify({ version: 1, records: [{ ...good, value: '1' }] }),
    JSON.stringify({ version: 1, records: [{ ...good, createdAt: 'きのう' }] }),
  ];
  for (const text of bad) {
    assert.throws(() => store.importJSON(data, text), store.ImportError, text.slice(0, 40));
    assert.equal(JSON.stringify(data), before);
  }
  // 1000 文字ちょうどは受け付ける
  assert.doesNotThrow(() => store.importJSON(data, JSON.stringify({ version: 1, records: [{ ...good, expr: 'x'.repeat(1000) }] })));
});

test('F-06 受け渡し基準：書き出した JSON を別のブラウザ（空の Store）で読むと同じ記録', () => {
  const data = storeWith([]);
  commit(data, '1980*1.1', new Date('2026-10-23T01:44:00Z'));
  commit(data, 'ans*12', new Date('2026-10-23T01:45:00Z'));
  commit(data, 'sin(30)+cos(60)', new Date('2026-10-23T01:46:00Z'));
  const file = store.toJSON(data);

  const otherStorage = fakeStorage();
  const other = store.load(otherStorage);
  assert.deepEqual(store.importJSON(other, file), { added: 3, skipped: 0 });
  assert.deepEqual(other.records, data.records);
  store.save(otherStorage, other);
  assert.deepEqual(store.load(otherStorage).records, data.records);
  // 同じファイルをもう一度読んでも増えない
  assert.deepEqual(store.importJSON(other, file), { added: 0, skipped: 3 });
});
