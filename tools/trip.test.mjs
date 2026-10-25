// node tools/trip.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { applyOps, outline, render } from './trip.mjs';

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
  assert.match(o, /一覽：🛍️ 三井 Outlet 木更津・摩天輪公園｜晚上：晴空塔聖誕市集 🎄/);
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
  assert.deepEqual(t.days[3].items.map(i => i.title), ['三井 Outlet Park 木更津', '燒肉晚餐', '東京晴空塔聖誕市集']);
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
  assert.throws(() => applyOps(t, Array(9).fill({ op: 'remove_item', day: 'D1', index: 1 })), /一次最多/);
  assert.throws(() => applyOps(t, [{ op: 'update_item', day: 'D1', index: 1, fields: { title: 'x'.repeat(41) } }]), /太長/);
  assert.throws(() => applyOps(t, [{ op: 'update_item', day: 'D1', index: 2, fields: { text: '' } }]), /不能是空的/);
  assert.throws(() => applyOps(t, [{ op: 'drop_table', day: 'D1' }]), /不認得/);
  assert.throws(() => applyOps(t, []), /沒有修改/);
});

console.log(`\n${pass} 項全部通過`);
