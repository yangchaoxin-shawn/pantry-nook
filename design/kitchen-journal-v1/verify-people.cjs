/* 只验证本轮自动装饰分配，不模拟库存或菜单业务。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {}, document: { addEventListener() {} } };
vm.runInNewContext(fs.readFileSync(`${__dirname}/little-people.js`, 'utf8'), context);
const people = context.window.PantryPeople;
const id = html => html.match(/data-person="([^"]+)"/)[1];
assert.equal(people.entries.length, 24);
assert.equal(new Set(people.entries.map(entry => entry.id)).size, 24);
const initial = Array.from({ length:24 }, (_,i) => id(people.render(`dish:${i}`)));
assert.equal(new Set(initial).size, 24, '一轮内不能重复分配');
for(let pass=0;pass<10;pass++) for(let i=0;i<24;i++) assert.equal(id(people.render(`dish:${i}`)),initial[i],'重绘保持原图');
people.rename('dish:0','dish:新菜名');
assert.equal(id(people.render('dish:新菜名')),initial[0],'改名保持原图');
for(let i=24;i<72;i++) assert.ok(people.entries.some(entry=>entry.id===id(people.render(`dish:${i}`))),'超出一轮后仍能分配');
const plan = people.render('plan:新菜名');
people.rename('plan:新菜名','plan:新搭配');
assert.equal(people.render('plan:新搭配'),plan,'搭配独立命名与改名');
for(const entry of people.entries){const svg=people.artwork(entry.id);assert.ok(svg.includes('aria-hidden="true"'));assert.ok(!svg.includes('<image'),'不嵌入有底色位图');}
console.log('Automatic illustration checks passed: 24 unique poses, stable redraw, rename, next cycles, separate plans, decorative SVG.');
