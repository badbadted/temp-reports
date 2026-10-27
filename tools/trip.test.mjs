// node tools/trip.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { applyOps, outline, render, isBase } from './trip.mjs';

const load = () => JSON.parse(readFileSync(new URL('../trips/christmas-ski-trip.json', import.meta.url), 'utf8'));
const tpl = readFileSync(new URL('../trips/christmas-ski-trip.template.html', import.meta.url), 'utf8');
const lf = (s) => s.replace(/\r\n/g, '\n');
let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log(`✓ ${name}`); };

test('沒修改時產出與目前網頁一致', () => {
  const orig = readFileSync(new URL('../christmas-ski-trip.html', import.meta.url), 'utf8');
  assert.equal(render(load(), tpl), lf(orig));
  assert.ok(orig.includes('這頁由 tools/trip.mjs 產生'));
});

test('outline 有一覽與每項編號', () => {
  const o = outline(load());
  assert.match(o, /D2-3 15:00 淺草和服體驗/);
  assert.match(o, /D2 12\/25（五）[^\n]*\n  一覽：👘 淺草和服體驗｜晚上：/);
  assert.match(o, /D4-2 （無時間） Kisarapia 摩天輪公園（就在 Outlet 隔壁）/);
});

test('改時間、標題、說明', () => {
  const t = load();
  const c = applyOps(t, [{ op: 'update_item', day: 'D2', index: 3, fields: { when: '16:00', sub: '記得預約' } }]);
  assert.match(c[0], /D2 第 3 項「15:00 淺草和服體驗」改成「16:00 淺草和服體驗（記得預約）」/);
  assert.match(render(t, tpl), /<span class="when">16:00<\/span><span class="what"><strong>淺草和服體驗<\/strong><span class="sub">記得預約<\/span>/);
});

test('新增、刪除、拿掉說明', () => {
  const t = load();
  applyOps(t, [
    { op: 'add_item', day: 'd4', after: 1, item: { when: '18:30', title: '燒肉晚餐', sub: '木更津站附近' } },
    { op: 'remove_item', day: 'D4', index: 3 },
    { op: 'update_item', day: 'D4', index: 1, fields: { sub: '' } },
  ]);
  // 行程資料會被群組改來改去，期望值從原資料算：插在第 1 項後、再刪掉新的第 3 項（原本的第 2 項）
  const orig = load().days[3].items.map(i => i.title);
  assert.deepEqual(t.days[3].items.map(i => i.title), [orig[0], '燒肉晚餐', ...orig.slice(2)]);
  assert.ok(!('sub' in t.days[3].items[0]));
});

test('改每日標題與一覽', () => {
  const t = load();
  const c = applyOps(t, [
    { op: 'set_day', day: 'D4', place: '🛍️ 木更津 Outlet → 🍖 燒肉' },
    { op: 'set_glance', day: 'D4', note: '晚上：木更津吃燒肉', emoji: '🍖' },
  ]);
  assert.equal(c.length, 2);
  const html = render(t, tpl);
  assert.match(html, /<div class="d-place">🛍️ 木更津 Outlet → 🍖 燒肉<\/div>/);
  assert.match(html, /<div class="g-emoji">🍖<\/div>/);
});

test('值沒變的欄位不列進說明；全部沒變就擋下', () => {
  const t = load();
  const d3 = t.days[2];
  const c = applyOps(t, [{ op: 'set_day', day: 'D3', date: d3.date, place: '⛷️ 神樂 → 🍽️ 東京站' }, { op: 'set_glance', day: 'D3', emoji: d3.glance.emoji, note: '晚上：東京站' }]);
  assert.deepEqual(c, ['D3 地點改成「⛷️ 神樂 → 🍽️ 東京站」', '行程一覽 12/26 備註改成「晚上：東京站」']);
  assert.throws(() => applyOps(load(), [{ op: 'set_day', day: 'D3', date: d3.date }]), /沒有要改的/);
});

test('塞 HTML 會被跳脫', () => {
  const t = load();
  applyOps(t, [{ op: 'add_item', day: 'D1', item: { title: '<script>alert(1)</script>', sub: '<img src=x onerror=alert(1)>' } },
    { op: 'set_glance', day: 'D1', place: '<b>x</b>' }]);
  const html = render(t, tpl);
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>x</b>'));
});

test('文字裡的 $ 替換碼照字面輸出', () => {
  const t = load();
  applyOps(t, [{ op: 'add_item', day: 'D1', item: { title: "費用 $` $' $& $$" } }]);
  const html = render(t, tpl);
  assert.ok(html.includes("<strong>費用 $` $' $&amp; $$</strong>") || html.includes("<strong>費用 $` $' $& $$</strong>"));
  assert.equal(html.split('<!DOCTYPE html>').length, 2); // 模板沒有被複製一份進來
});

test('不合法的修改會被擋', () => {
  const t = load();
  assert.throws(() => applyOps(t, [{ op: 'remove_item', day: 'D1', index: 99 }]), /沒有第 99 項/);
  assert.throws(() => applyOps(t, [{ op: 'update_item', day: 'D9', index: 1, fields: { text: 'x' } }]), /找不到 D9/);
  assert.throws(() => applyOps(t, Array(16).fill({ op: 'remove_item', day: 'D1', index: 1 })), /一次最多/);
  assert.throws(() => applyOps(t, [{ op: 'update_item', day: 'D1', index: 1, fields: { title: 'x'.repeat(41) } }]), /太長/);
  assert.throws(() => applyOps(t, [{ op: 'update_item', day: 'D1', index: 2, fields: { text: '' } }]), /不能是空的/);
  assert.throws(() => applyOps(t, [{ op: 'drop_table', day: 'D1' }]), /不認得/);
  assert.throws(() => applyOps(t, []), /沒有修改/);
});

test('補充資訊：outline 讀得到、可以整個換掉或拿掉（字會跳脫）', () => {
  // 用自己的樣本，不靠線上資料（群組隨時會改行程）
  const sample = load();
  sample.days[1].moreHtml = '      <details class="more">\n        <summary>測試資訊</summary>\n        <div class="inner"><ul><li>📍 A 地點</li><li>💡 17:00～23:00</li></ul></div>\n      </details>';
  assert.match(outline(sample), /D2[\s\S]*補充資訊「測試資訊」：📍 A 地點／💡 17:00～23:00/);
  const t = load();
  const c = applyOps(t, [{ op: 'set_more', day: 'D2', title: '晴空塔聖誕市集資訊', lines: ['📍 晴空塔城 4F 廣場', '<script>alert(1)</script>'] }]);
  assert.match(c[0], /D2 補充資訊改成「晴空塔聖誕市集資訊」：📍 晴空塔城 4F 廣場／/);
  const html = render(t, tpl);
  assert.ok(html.includes('<summary>晴空塔聖誕市集資訊</summary>'));
  assert.ok(html.includes('<li>&lt;script&gt;alert(1)&lt;/script&gt;</li>'));
  assert.ok(!html.includes('六本木聖誕市集資訊'));
  assert.match(applyOps(t, [{ op: 'remove_more', day: 'D2' }])[0], /D2 刪掉補充資訊「晴空塔聖誕市集資訊」/);
  assert.throws(() => applyOps(t, [{ op: 'remove_more', day: 'D2' }]), /沒有補充資訊/);
  assert.throws(() => applyOps(load(), [{ op: 'set_more', day: 'D2', title: 'x', lines: [] }]), /至少要一行/);
  assert.throws(() => applyOps(load(), [{ op: 'set_more', day: 'D2', title: 'x', lines: Array(9).fill('a') }]), /最多 8 行/);
});

const baseTpl = readFileSync(new URL('../trips/_base.template.html', import.meta.url), 'utf8');
const fresh = () => ({ title: '測試行程', meta: { title: '測試行程', dates: '', subtitle: '' }, days: [], info: [], links: [] });

test('通用版面：空行程也產得出網頁', () => {
  const html = render(fresh(), baseTpl);
  assert.ok(html.includes('<title>測試行程 — 行程表</title>'));
  assert.ok(html.includes('<h1>測試行程</h1>'));
  assert.ok(html.includes('還沒有排行程'));
  assert.ok(!html.includes('<!-- TRIP-'));
  assert.ok(!html.includes('<div class="info-section">') && !html.includes('<div class="links-section">'));
  assert.match(outline(fresh()), /通用版面[\s\S]*還沒有任何一天/);
});

test('通用版面：新增天數、頁首、資訊、連結，全部跳脫', () => {
  const t = fresh();
  const c = applyOps(t, [
    { op: 'set_meta', title: '2028 北海道<b>', dates: '1/20（四）— 1/24（一）・5 天', subtitle: '高雄 ⇄ 札幌' },
    { op: 'add_day', date: '1/20', weekday: '四', emoji: '✈️', place: '飛札幌', note: '華航 08:00', color: 'fly' },
    { op: 'add_day', date: '1/21', weekday: '五', emoji: '⛷️', place: '二世谷', color: 'ski' },
    { op: 'add_day', after: 0, date: '1/19', weekday: '三', place: '前一天集合' },
    { op: 'set_info', title: '🏨 住宿', hint: '札幌 2 晚', lines: ['JR Tower Hotel', '<img src=x>'] },
    { op: 'add_link', title: '二世谷雪況', url: 'https://www.niseko.ne.jp/' },
  ]);
  assert.equal(c.length, 6);
  assert.deepEqual(t.days.map(d => `${d.id}${d.key}${d.date}`), ['D1d11/19（三）', 'D2d21/20（四）', 'D3d31/21（五）']);
  // 新增的那天能直接加行程
  applyOps(t, [{ op: 'add_item', day: 'D2', item: { when: '08:00', title: '高雄出發' } }]);
  const html = render(t, baseTpl);
  assert.ok(html.includes('<h1>2028 北海道&lt;b&gt;</h1>'));
  assert.ok(html.includes('<li>&lt;img src=x&gt;</li>'));
  assert.ok(html.includes('<a href="https://www.niseko.ne.jp/" target="_blank" rel="noopener">二世谷雪況</a>'));
  assert.ok(html.includes('id="d2"') && html.includes('高雄出發'));
  assert.match(outline(t), /資訊「🏨 住宿」（札幌 2 晚）：JR Tower Hotel／<img src=x>[\s\S]*連結 1\. 二世谷雪況/);
  // 刪一天後重新編號
  assert.match(applyOps(t, [{ op: 'remove_day', day: 'D1' }])[0], /刪掉 D1 1\/19（三）/);
  assert.deepEqual(t.days.map(d => d.id), ['D1', 'D2']);
  assert.equal(t.days[0].items[0].title, '高雄出發');
  // 同名資訊是整塊替換、可刪；連結可刪
  applyOps(t, [{ op: 'set_info', title: '🏨 住宿', lines: ['換飯店'] }]);
  assert.deepEqual(t.info, [{ title: '🏨 住宿', hint: '札幌 2 晚', lines: ['換飯店'] }]);
  applyOps(t, [{ op: 'remove_info', title: '🏨 住宿' }, { op: 'remove_link', index: 1 }]);
  assert.deepEqual([t.info, t.links], [[], []]);
});

test('通用版面：不合法的擋下、手刻版面不能用', () => {
  const t = fresh();
  assert.throws(() => applyOps(t, [{ op: 'add_link', title: 'x', url: 'javascript:alert(1)' }]), /https/);
  assert.throws(() => applyOps(t, [{ op: 'add_link', title: 'x', url: 'https://a.com/"onmouseover=1' }]), /https/);
  assert.throws(() => applyOps(t, [{ op: 'add_day', date: '明天', place: 'x' }]), /1\/30/);
  assert.throws(() => applyOps(t, [{ op: 'remove_day', day: 'D1' }]), /找不到/);
  assert.throws(() => applyOps(t, [{ op: 'set_info', title: 'x', lines: [] }]), /至少要一行/);
  const many = fresh();
  for (let i = 0; i < 20; i++) applyOps(many, [{ op: 'add_day', date: `2/${i + 1}`, place: 'x' }]);
  assert.throws(() => applyOps(many, [{ op: 'add_day', date: '2/21', place: 'x' }]), /最多 20 天/);
  assert.ok(!isBase(load()));
  assert.throws(() => applyOps(load(), [{ op: 'set_meta', title: 'x' }]), /手刻版面/);
  assert.throws(() => applyOps(load(), [{ op: 'add_day', date: '1/1', place: 'x' }]), /手刻版面/);
});

console.log(`\n${pass} 項全部通過`);
