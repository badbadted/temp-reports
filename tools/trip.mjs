#!/usr/bin/env node
/**
 * 行程網頁工具：行程資料放 trips/<name>.json，網頁由 trips/<name>.template.html ＋ 資料產生成 <name>.html
 *
 *   node tools/trip.mjs build    <name>              依資料重新產生網頁
 *   node tools/trip.mjs outline  <name>              精簡文字版行程（給 AI 看，含每天每項的編號）
 *   node tools/trip.mjs describe <name> <ops.json>   檢查修改內容，印出白話說明（不寫檔）
 *   node tools/trip.mjs apply    <name> <ops.json>   套用修改、重新產生網頁
 *   node tools/trip.mjs check    <name>              檢查網頁是否跟資料檔一致（有人直接手改網頁就會不一致）
 *   node tools/trip.mjs create   <name> <標題>       開新行程（通用版面），並加進首頁清單
 *
 * 兩種版面：有 trips/<name>.template.html 的是手刻版面（頁首、住宿、連結寫死在模板裡，例如聖誕滑雪）；
 * 沒有的用通用版面 trips/_base.template.html，頁首（meta）、資訊區（info）、連結（links）都在資料裡，
 * 小帥也能用 set_meta／set_info／remove_info／add_link／remove_link／add_day／remove_day 改。開新行程一律用通用版面。
 *
 * 每天的資料：最上面「這幾天要去哪」那一行（glance）、每日行程的標題（date／place）與一條條行程（items）。
 * 可收摺的詳細資訊（moreHtml：時刻表、票價、菜單）：手寫的 HTML 原樣保留；ops 可以整個換成「標題＋條列」（set_more，字一律跳脫）或拿掉（remove_more）。
 *
 * 修改內容（ops）由 LINE 群組的小帥產生、群組成員確認後才 apply。經 ops 寫進來的字一律跳脫 < >，
 * 不能塞 HTML 進公開網頁。describe／apply 輸出 JSON：{ ok, changes: [白話說明...], error? }
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMITS = {
  when: 12, title: 40, text: 80, sub: 120, date: 30, place: 60, note: 60, emoji: 8, more_title: 30, more_line: 80,
  // 通用版面
  meta_title: 40, dates: 40, subtitle: 80, info_title: 30, hint: 30, info_line: 100, link_title: 40, url: 300, d: 5, w: 10,
};
const MORE_MAX_LINES = 8;
const MAX_OPS = 8;

const BASE_TPL = join(ROOT, 'trips', '_base.template.html');
const paths = (name) => {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`行程名稱不合法：${name}`);
  const own = join(ROOT, 'trips', `${name}.template.html`);
  return {
    json: join(ROOT, 'trips', `${name}.json`),
    // 有自己的手刻版面就用自己的，沒有就用通用版面
    tpl: existsSync(own) ? own : BASE_TPL,
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

// ── 通用版面才有的區塊（頁首、底部資訊、連結都從資料產生）──────────

const escAttr = (s) => esc(s).replace(/&(?!lt;|gt;)/g, '&amp;').replace(/"/g, '&quot;');

function renderInfo(info) {
  const secs = (info || []).filter(s => s.lines?.length);
  if (!secs.length) return '';
  return [
    '<!-- ===== 住宿・交通・其他資訊 ===== -->',
    '<div class="info-section">',
    '  <h2 class="section-h">ℹ️ 住宿・交通・其他資訊</h2>',
    ...secs.map(s => [
      '  <details class="big">',
      `    <summary>${esc(s.title)}${s.hint ? ` <span class="hint">${esc(s.hint)}</span>` : ''}<span class="arrow">▼</span></summary>`,
      '    <div class="big-inner">',
      '      <ul class="info-list">',
      ...s.lines.map(l => `        <li>${esc(l)}</li>`),
      '      </ul>',
      '    </div>',
      '  </details>',
    ].join('\n')),
    '</div>',
  ].join('\n');
}

function renderLinks(links) {
  if (!links?.length) return '';
  return [
    '<!-- ===== 實用連結 ===== -->',
    '<div class="links-section">',
    '  <h2 class="section-h">🔗 實用連結</h2>',
    '  <div class="links-grid">',
    ...links.map(l => `    <a href="${escAttr(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>`),
    '  </div>',
    '</div>',
  ].join('\n');
}

export function render(trip, tpl) {
  // 用函式當取代值：行程文字裡的 $& $` $' 不會被 String.replace 當成特殊替換碼
  const glance = trip.days.map(renderGlance).join('\n');
  const days = trip.days.length ? trip.days.map(renderDay).join('\n\n') : '  <p class="empty">還沒有排行程，在 LINE 群組叫小帥新增第一天吧。</p>';
  const m = trip.meta || {};
  return tpl.replace(/\r\n/g, '\n') // Windows 簽出的模板是 CRLF，統一成 LF 再產生
    .replace('<!-- TRIP-GLANCE -->', () => glance)
    .replace('<!-- TRIP-DAYS -->', () => days)
    // 以下只有通用版面（_base.template.html）有；手刻版面沒有這些標記，不受影響
    .replaceAll('<!-- TRIP-TITLE -->', () => esc(m.title))
    .replace('<!-- TRIP-DATES -->', () => esc(m.dates))
    .replace('<!-- TRIP-SUBTITLE -->', () => esc(m.subtitle))
    .replace('<!-- TRIP-INFO -->', () => renderInfo(trip.info))
    .replace('<!-- TRIP-LINKS -->', () => renderLinks(trip.links));
}

/** 通用版面的行程：頁首、資訊、連結都在資料裡（手刻版面的沒有 meta） */
export const isBase = (trip) => !!trip.meta;

/** 補充資訊（moreHtml）→ { title, lines }，給 AI 看的純文字 */
export function moreText(html) {
  if (!html) return null;
  const plain = (x) => String(x).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const title = plain(/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] || '補充資訊');
  const lis = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m => plain(m[1])).filter(Boolean);
  const lines = lis.length ? lis : [plain(html.replace(/<summary[\s\S]*?<\/summary>/, ''))].filter(Boolean);
  return { title, lines };
}

function renderMore(title, lines) {
  return [
    '      <details class="more">',
    `        <summary>${esc(title)}</summary>`,
    '        <div class="inner">',
    '          <ul>',
    ...lines.map(l => `            <li>${esc(l)}</li>`),
    '          </ul>',
    '        </div>',
    '      </details>',
  ].join('\n');
}

export function outline(trip) {
  const lines = [];
  if (isBase(trip)) {
    const m = trip.meta;
    lines.push(`〔通用版面：頁首、資訊、連結也能改〕頁面標題：${m.title}｜日期：${m.dates || '（未填）'}｜說明：${m.subtitle || '（未填）'}`);
    for (const s of trip.info || []) lines.push(`資訊「${s.title}」${s.hint ? `（${s.hint}）` : ''}：${s.lines.join('／')}`.slice(0, 500));
    (trip.links || []).forEach((l, i) => lines.push(`連結 ${i + 1}. ${l.title} ${l.url}`));
    if (!trip.days.length) lines.push('（還沒有任何一天）');
  }
  for (const d of trip.days) {
    const g = d.glance;
    lines.push(`${d.id} ${d.date}｜${d.place}`);
    lines.push(`  一覽：${g.emoji} ${g.place}｜${g.note}`);
    d.items.forEach((it, i) => {
      const what = [it.title, it.text].filter(Boolean).join('');
      lines.push(`  ${d.id}-${i + 1} ${it.when || '（無時間）'} ${what}${it.sub ? `（${it.sub}）` : ''}`);
    });
    const m = moreText(d.moreHtml);
    if (m) lines.push(`  補充資訊「${m.title}」：${m.lines.join('／')}`.slice(0, 700));
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

// ── 通用版面專用的修改 ───────────────────────────────

const MAX_DAYS = 9;      // D1～D9
const MAX_INFO = 8;
const MAX_INFO_LINES = 12;
const MAX_LINKS = 15;
const COLORS = { fly: 'c-fly', city: 'c-tokyo', ski: 'c-ski' }; // 金：交通日、紅：城市、綠：雪場／戶外
const URL_RE = /^https:\/\/[^\s"'<>\\]+$/;

/** 刪掉或插入一天後重新編號（D1、D2… 與錨點 d1、d2…） */
function renumber(trip) {
  trip.days.forEach((d, i) => { d.id = `D${i + 1}`; d.key = `d${i + 1}`; });
}

function needBase(trip, what) {
  if (!isBase(trip)) throw new Error(`這份行程是手刻版面，${what}請找 TED 改`);
}

function applyBaseOp(trip, op) {
  switch (op.op) {
    case 'set_meta': {
      needBase(trip, '頁面標題');
      const parts = [];
      for (const [k, f, lim] of [['title', '標題', 'meta_title'], ['dates', '日期', 'dates'], ['subtitle', '說明', 'subtitle']]) {
        if (op[k] === undefined) continue;
        const v = str(op[k], lim, { allowEmpty: k !== 'title' });
        if (v !== (trip.meta[k] || '')) { trip.meta[k] = v; parts.push(`${f}改成「${v}」`); }
      }
      if (op.title !== undefined) trip.title = trip.meta.title;
      return parts.length ? `頁首 ${parts.join('、')}` : null;
    }
    case 'set_info': {
      needBase(trip, '資訊區');
      const title = str(op.title, 'info_title');
      if (!Array.isArray(op.lines) || !op.lines.length) throw new Error('資訊至少要一行');
      if (op.lines.length > MAX_INFO_LINES) throw new Error(`資訊最多 ${MAX_INFO_LINES} 行`);
      const sec = { title, hint: op.hint === undefined ? undefined : str(op.hint, 'hint', { allowEmpty: true }), lines: op.lines.map(l => str(l, 'info_line')) };
      trip.info ||= [];
      const i = trip.info.findIndex(s => s.title === title);
      if (i >= 0) {
        if (sec.hint === undefined) sec.hint = trip.info[i].hint;
        trip.info[i] = sec;
      } else {
        if (trip.info.length >= MAX_INFO) throw new Error(`資訊區最多 ${MAX_INFO} 塊`);
        trip.info.push(sec);
      }
      if (!sec.hint) delete sec.hint;
      return `資訊「${title}」${i >= 0 ? '改成' : '新增'}：${sec.lines.join('／')}`;
    }
    case 'remove_info': {
      needBase(trip, '資訊區');
      const i = (trip.info || []).findIndex(s => s.title === op.title);
      if (i < 0) throw new Error(`沒有「${op.title}」這塊資訊`);
      trip.info.splice(i, 1);
      return `刪掉資訊「${op.title}」`;
    }
    case 'add_link': {
      needBase(trip, '連結');
      const title = str(op.title, 'link_title');
      const url = str(op.url, 'url');
      if (!URL_RE.test(url)) throw new Error('連結要是 https:// 開頭的網址');
      trip.links ||= [];
      if (trip.links.length >= MAX_LINKS) throw new Error(`連結最多 ${MAX_LINKS} 個`);
      trip.links.push({ title, url });
      return `新增連結「${title}」${url}`;
    }
    case 'remove_link': {
      needBase(trip, '連結');
      const i = Number(op.index) - 1;
      if (!Number.isInteger(i) || i < 0 || i >= (trip.links || []).length) throw new Error(`沒有第 ${op.index} 個連結`);
      const [l] = trip.links.splice(i, 1);
      return `刪掉連結「${l.title}」`;
    }
    case 'add_day': {
      needBase(trip, '新增一天');
      if (trip.days.length >= MAX_DAYS) throw new Error(`最多 ${MAX_DAYS} 天`);
      const d = str(op.date, 'd'), w = str(op.weekday ?? '', 'w', { allowEmpty: true });
      if (!/^\d{1,2}\/\d{1,2}$/.test(d)) throw new Error('日期要寫成 1/30 這樣');
      const emoji = str(op.emoji ?? '📍', 'emoji');
      const place = str(op.place, 'place');
      const note = str(op.note ?? '', 'note', { allowEmpty: true });
      const tag = str(op.label ?? '', 'w', { allowEmpty: true });
      const color = COLORS[op.color] || 'c-ski';
      const day = {
        id: '', key: '', color,
        date: `${d}${w ? `（${w}）` : ''}${tag ? ` ${tag}` : ''}`,
        place: `${emoji} ${place}`,
        items: [],
        glance: { color, d, w: [w, tag].filter(Boolean).join('・'), emoji, place, note },
      };
      const after = op.after == null ? trip.days.length : Number(op.after);
      if (!Number.isInteger(after) || after < 0 || after > trip.days.length) throw new Error('新增那天的位置不對');
      trip.days.splice(after, 0, day);
      renumber(trip);
      return `新增 ${day.id} ${day.date}｜${day.place}`;
    }
    case 'remove_day': {
      needBase(trip, '刪掉一天');
      const day = findDay(trip, op.day);
      trip.days.splice(trip.days.indexOf(day), 1);
      renumber(trip);
      return `刪掉 ${op.day.toUpperCase()} ${day.date}（含 ${day.items.length} 項行程），後面的天數往前遞補`;
    }
    default:
      return undefined; // 不是通用版面的修改
  }
}

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
    const base = applyBaseOp(trip, op || {});
    if (base !== undefined) { if (base) changes.push(base); continue; }
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
        if (op.date === undefined && op.place === undefined) throw new Error('set_day 沒有要改的欄位');
        // 值跟原本一樣的不列進說明（AI 常把沒變的欄位一起帶上）
        const parts = [];
        if (op.date !== undefined) { const v = str(op.date, 'date'); if (v !== d.date) { d.date = v; parts.push(`日期標題改成「${v}」`); } }
        if (op.place !== undefined) { const v = str(op.place, 'place'); if (v !== d.place) { d.place = v; parts.push(`地點改成「${v}」`); } }
        if (parts.length) changes.push(`${d.id} ${parts.join('、')}`);
        break;
      }
      case 'set_glance': {
        if (op.emoji === undefined && op.place === undefined && op.note === undefined) throw new Error('set_glance 沒有要改的欄位');
        const g = d.glance;
        const parts = [];
        if (op.emoji !== undefined) { const v = str(op.emoji, 'emoji'); if (v !== g.emoji) { g.emoji = v; parts.push(`圖示改成 ${v}`); } }
        if (op.place !== undefined) { const v = str(op.place, 'place'); if (v !== g.place) { g.place = v; parts.push(`地點改成「${v}」`); } }
        if (op.note !== undefined) { const v = str(op.note, 'note', { allowEmpty: true }); if (v !== g.note) { g.note = v; parts.push(`備註改成「${v}」`); } }
        if (parts.length) changes.push(`行程一覽 ${g.d} ${parts.join('、')}`);
        break;
      }
      case 'set_more': {
        const title = str(op.title, 'more_title');
        if (!Array.isArray(op.lines) || !op.lines.length) throw new Error('補充資訊至少要一行');
        if (op.lines.length > MORE_MAX_LINES) throw new Error(`補充資訊最多 ${MORE_MAX_LINES} 行`);
        const lines = op.lines.map(l => str(l, 'more_line'));
        const html = renderMore(title, lines);
        if (html === d.moreHtml) break;
        d.moreHtml = html;
        changes.push(`${d.id} 補充資訊改成「${title}」：${lines.join('／')}`);
        break;
      }
      case 'remove_more': {
        const m = moreText(d.moreHtml);
        if (!m) throw new Error(`${d.id} 沒有補充資訊`);
        delete d.moreHtml;
        changes.push(`${d.id} 刪掉補充資訊「${m.title}」`);
        break;
      }
      default:
        throw new Error(`不認得的修改：${op.op}`);
    }
  }
  if (!changes.length) throw new Error('跟原本的行程一樣，沒有要改的');
  return changes;
}

// ── CLI ───────────────────────────────────────────

/** 開新行程（通用版面）：建資料檔、產生網頁、加進首頁清單。回傳 { ok, url?, error? } */
export function createTrip(name, title, today = new Date().toISOString().slice(0, 10)) {
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(name || '')) throw new Error('名稱只能用小寫英文、數字和 -（例如 snow-trip-2028）');
  const p = paths(name);
  if (existsSync(p.json) || existsSync(p.html)) throw new Error(`已經有「${name}」這個行程了`);
  const t = str(title, 'meta_title');
  const trip = { title: t, meta: { title: t, dates: '', subtitle: '' }, days: [], info: [], links: [] };
  writeFileSync(p.json, JSON.stringify(trip, null, 2) + '\n');
  writeFileSync(p.html, render(trip, readFileSync(BASE_TPL, 'utf8')));
  // 首頁清單加一行（放最上面）
  const idx = join(ROOT, 'index.html');
  const html = readFileSync(idx, 'utf8').replace(/\r\n/g, '\n');
  const li = `  <li><a href="${name}.html">${esc(t)} — 行程表</a><span class="date">${today}</span></li>`;
  if (html.includes('<ul>\n')) writeFileSync(idx, html.replace('<ul>\n', () => `<ul>\n${li}\n`));
  return { ok: true, name, title: t };
}

function main() {
  const [cmd, name, opsPath] = process.argv.slice(2);
  if (cmd === 'create') {
    try { console.log(JSON.stringify(createTrip(name, process.argv.slice(4).join(' ')))); }
    catch (err) { console.log(JSON.stringify({ ok: false, error: err.message })); process.exitCode = 1; }
    return;
  }
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
  console.error('用法：node tools/trip.mjs build|outline|describe|apply|check <name> [ops.json]，或 create <name> <標題>');
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
