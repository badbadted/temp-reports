#!/usr/bin/env node
/**
 * 行程網頁工具：行程資料放 trips/<name>.json，網頁由 trips/<name>.template.html ＋ 資料產生成 <name>.html
 *
 *   node tools/trip.mjs build    <name>              依資料重新產生網頁
 *   node tools/trip.mjs outline  <name>              精簡文字版行程（給 AI 看，含每天每項的編號）
 *   node tools/trip.mjs describe <name> <ops.json>   檢查修改內容，印出白話說明（不寫檔）
 *   node tools/trip.mjs apply    <name> <ops.json>   套用修改、重新產生網頁
 *   node tools/trip.mjs check    <name>              檢查網頁是否跟資料檔一致（有人直接手改網頁就會不一致）
 *
 * 每天的資料：最上面「這幾天要去哪」那一行（glance）、每日行程的標題（date／place）與一條條行程（items）。
 * 可收摺的詳細資訊（moreHtml：時刻表、票價、菜單）是手寫 HTML，ops 改不到。
 *
 * 修改內容（ops）由 LINE 群組的小帥產生、群組成員確認後才 apply。經 ops 寫進來的字一律跳脫 < >，
 * 不能塞 HTML 進公開網頁。describe／apply 輸出 JSON：{ ok, changes: [白話說明...], error? }
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMITS = { when: 12, title: 40, text: 80, sub: 120, date: 30, place: 60, note: 60, emoji: 8 };
const MAX_OPS = 8;

const paths = (name) => {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`行程名稱不合法：${name}`);
  return {
    json: join(ROOT, 'trips', `${name}.json`),
    tpl: join(ROOT, 'trips', `${name}.template.html`),
    html: join(ROOT, `${name}.html`),
  };
};

const esc = (s) => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── 產生網頁 ─────────────────────────────────────────

function renderGlance(d) {
  const g = d.glance;
  return [
    `    <a class="glance-row ${d.color}" href="#${d.key}">`,
    `      <div class="g-date"><div class="d">${esc(g.d)}</div><div class="w">${esc(g.w)}</div></div>`,
    `      <div class="g-emoji">${esc(g.emoji)}</div>`,
    '      <div class="g-main">',
    `        <div class="place">${esc(g.place)}</div>`,
    `        <div class="night">${esc(g.note)}</div>`,
    '      </div>',
    '    </a>',
  ].join('\n');
}

function renderItem(it) {
  const what = (it.title !== undefined ? `<strong>${esc(it.title)}</strong>` : '')
    + esc(it.text || '')
    + (it.sub !== undefined ? `<span class="sub">${esc(it.sub)}</span>` : '');
  return `        <li><span class="when">${esc(it.when)}</span><span class="what">${what}</span></li>`;
}

function renderDay(d) {
  return [
    `  <!-- ${d.id} -->`,
    `  <div class="day-card ${d.color}" id="${d.key}">`,
    '    <div class="day-head">',
    `      <div class="d-date">${esc(d.date)}</div>`,
    `      <div class="d-place">${esc(d.place)}</div>`,
    '    </div>',
    '    <div class="day-body">',
    '      <ul class="plan">',
    ...d.items.map(renderItem),
    '      </ul>',
    ...(d.moreHtml ? [d.moreHtml] : []),
    '    </div>',
    '  </div>',
  ].join('\n');
}

export function render(trip, tpl) {
  // 用函式當取代值：行程文字裡的 $& $` $' 不會被 String.replace 當成特殊替換碼
  const glance = trip.days.map(renderGlance).join('\n');
  const days = trip.days.map(renderDay).join('\n\n');
  return tpl.replace(/\r\n/g, '\n') // Windows 簽出的模板是 CRLF，統一成 LF 再產生
    .replace('<!-- TRIP-GLANCE -->', () => glance)
    .replace('<!-- TRIP-DAYS -->', () => days);
}

export function outline(trip) {
  const lines = [];
  for (const d of trip.days) {
    const g = d.glance;
    lines.push(`${d.id} ${d.date}｜${d.place}`);
    lines.push(`  一覽：${g.emoji} ${g.place}｜${g.note}`);
    d.items.forEach((it, i) => {
      const what = [it.title, it.text].filter(Boolean).join('');
      lines.push(`  ${d.id}-${i + 1} ${it.when || '（無時間）'} ${what}${it.sub ? `（${it.sub}）` : ''}`);
    });
  }
  return lines.join('\n');
}

// ── 修改 ───────────────────────────────────────────

function str(v, field, { allowEmpty = false } = {}) {
  if (typeof v !== 'string') throw new Error(`${field} 要是文字`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (!s && !allowEmpty) throw new Error(`${field} 不能是空的`);
  if (s.length > LIMITS[field]) throw new Error(`${field} 太長（最多 ${LIMITS[field]} 字）`);
  return s;
}

function findDay(trip, id) {
  const d = trip.days.find(x => x.id === String(id ?? '').toUpperCase());
  if (!d) throw new Error(`找不到 ${id}`);
  return d;
}

function itemAt(d, index) {
  const i = Number(index) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= d.items.length) throw new Error(`${d.id} 沒有第 ${index} 項`);
  return i;
}

const label = (it) => `${it.when ? it.when + ' ' : ''}${[it.title, it.text].filter(Boolean).join('')}`;

// 可留空的欄位：空字串＝拿掉；title 與 text 至少要留一個
function setFields(it, f) {
  for (const k of ['when', 'title', 'text', 'sub']) {
    if (f[k] === undefined) continue;
    const v = str(f[k], k, { allowEmpty: true });
    if (k === 'when') it.when = v;
    else if (v) it[k] = v;
    else delete it[k];
  }
  if (!it.title && !it.text) throw new Error('行程內容不能是空的');
}

/** 套用一組修改到行程（會改動 trip），回傳白話說明；有任何一項不合法就丟錯（呼叫端不寫檔） */
export function applyOps(trip, ops) {
  if (!Array.isArray(ops) || !ops.length) throw new Error('沒有修改內容');
  if (ops.length > MAX_OPS) throw new Error(`一次最多改 ${MAX_OPS} 項`);
  const changes = [];
  for (const op of ops) {
    const d = findDay(trip, op.day);
    switch (op.op) {
      case 'update_item': {
        const it = d.items[itemAt(d, op.index)];
        const before = label(it);
        const f = op.fields || {};
        if (!['when', 'title', 'text', 'sub'].some(k => f[k] !== undefined)) throw new Error('update_item 沒有要改的欄位');
        setFields(it, f);
        changes.push(`${d.id} 第 ${op.index} 項「${before}」改成「${label(it)}${it.sub ? `（${it.sub}）` : ''}」`);
        break;
      }
      case 'add_item': {
        const it = { when: '' };
        setFields(it, op.item || {});
        const after = op.after == null ? d.items.length : Number(op.after);
        if (!Number.isInteger(after) || after < 0 || after > d.items.length) throw new Error(`${d.id} 插入位置不對`);
        d.items.splice(after, 0, it);
        changes.push(`${d.id} 新增「${label(it)}${it.sub ? `（${it.sub}）` : ''}」`);
        break;
      }
      case 'remove_item': {
        const i = itemAt(d, op.index);
        const [it] = d.items.splice(i, 1);
        changes.push(`${d.id} 刪掉「${label(it)}」`);
        break;
      }
      case 'set_day': {
        const parts = [];
        if (op.date !== undefined) { d.date = str(op.date, 'date'); parts.push(`日期標題改成「${d.date}」`); }
        if (op.place !== undefined) { d.place = str(op.place, 'place'); parts.push(`地點改成「${d.place}」`); }
        if (!parts.length) throw new Error('set_day 沒有要改的欄位');
        changes.push(`${d.id} ${parts.join('、')}`);
        break;
      }
      case 'set_glance': {
        const parts = [];
        if (op.emoji !== undefined) { d.glance.emoji = str(op.emoji, 'emoji'); parts.push(`圖示改成 ${d.glance.emoji}`); }
        if (op.place !== undefined) { d.glance.place = str(op.place, 'place'); parts.push(`地點改成「${d.glance.place}」`); }
        if (op.note !== undefined) { d.glance.note = str(op.note, 'note', { allowEmpty: true }); parts.push(`備註改成「${d.glance.note}」`); }
        if (!parts.length) throw new Error('set_glance 沒有要改的欄位');
        changes.push(`行程一覽 ${d.glance.d} ${parts.join('、')}`);
        break;
      }
      default:
        throw new Error(`不認得的修改：${op.op}`);
    }
  }
  return changes;
}

// ── CLI ───────────────────────────────────────────

function main() {
  const [cmd, name, opsPath] = process.argv.slice(2);
  const p = paths(name || '');
  const trip = JSON.parse(readFileSync(p.json, 'utf8'));
  const tpl = () => readFileSync(p.tpl, 'utf8');
  const build = (t) => writeFileSync(p.html, render(t, tpl()));
  // 網頁有人直接手改過（沒改資料檔）→ 重新產生會把手改的內容蓋掉，所以先擋下
  const inSync = () => render(trip, tpl()) === readFileSync(p.html, 'utf8').replace(/\r\n/g, '\n');
  if (cmd === 'build') { build(trip); console.log(`已產生 ${p.html}`); return; }
  if (cmd === 'outline') { console.log(outline(trip)); return; }
  if (cmd === 'check') {
    const ok = inSync();
    console.log(JSON.stringify(ok ? { ok } : { ok, error: '網頁跟資料檔不同步（網頁被直接改過）' }));
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (cmd === 'describe' || cmd === 'apply') {
    try {
      if (cmd === 'apply' && !inSync()) throw new Error('網頁跟資料檔不同步（有人直接改過網頁），先把改動同步回 trips/ 再更新');
      const ops = JSON.parse(readFileSync(opsPath, 'utf8'));
      const changes = applyOps(trip, ops);
      if (cmd === 'apply') {
        writeFileSync(p.json, JSON.stringify(trip, null, 2) + '\n');
        build(trip);
      }
      console.log(JSON.stringify({ ok: true, changes }));
    } catch (err) {
      console.log(JSON.stringify({ ok: false, error: err.message }));
      process.exitCode = 1;
    }
    return;
  }
  console.error('用法：node tools/trip.mjs build|outline|describe|apply <name> [ops.json]');
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
