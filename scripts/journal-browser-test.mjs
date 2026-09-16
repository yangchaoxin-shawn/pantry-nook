// 本地真实接口浏览器验收；媒体素材与证据留在忽略目录，不进入仓库。
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = process.env.JOURNAL_TEST_BASE || 'http://127.0.0.1:5220';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const health = await fetch(`${base}/health`);
assert.match(health.headers.get('x-pantry-nook-test-database') || '', /^pantry_nook_test_[a-f0-9]{32}$/);
assert.ok(health.headers.get('x-pantry-nook-test-media'));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const samples = resolve(process.env.JOURNAL_SAMPLES);
const food = resolve(process.env.JOURNAL_FOOD_SAMPLES);
const output = resolve(process.env.JOURNAL_BROWSER_OUTPUT || '.review/journal-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);
const crashes = [], responses = [], checks = [];
page.on('pageerror', err => crashes.push(err.message));
page.on('response', res => { if(res.url().includes('/api/journal/')) responses.push({ url: res.url(), status: res.status(), method: res.request().method() }); });
const caption = `浏览器验收 ${Date.now()} · 两个人好好吃饭`;
let month = '2040-09';
for (let year=2040; year<2200; year++) {
  month = `${year}-09`;
  const existing = await (await fetch(`${base}/api/journal/entries?month=${month}&limit=1&offset=0`)).json();
  if(existing.meta.total === 0) break;
}
try {
  await page.goto(base);
  await page.getByRole('button', { name: '手记', exact: true }).click();
  await page.getByLabel('按月份查看手记').fill(month);
  await page.getByText('这个月，还没有留下照片。').waitFor();
  await page.screenshot({ path: join(output, 'empty-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '＋ 记下一餐', exact: true }).first().click();
  const photos = (await readdir(food)).filter(name => /\.jpg$/i.test(name)).slice(0, 5).map(name => join(food, name));
  assert.equal(photos.length, 5);
  // 真实多选：先 MOV 后 HEIC，并混合五张普通照片。
  await page.getByLabel('选择照片及实况视频').setInputFiles([join(samples, 'apple-iphone15.mov'), join(samples, 'apple-iphone15.heic'), ...photos]);
  await page.waitForFunction(() => document.querySelector('.journal-form-footer')?.textContent?.includes('6 张已就绪') && !document.querySelector('.journal-form-footer')?.textContent?.includes('正在整理'), null, { timeout: 180000 });
  assert.equal(await page.getByRole('button', { name: '重试', exact: true }).count(), 0);
  assert.equal(responses.filter(item => item.status === 429).length, 0);
  await page.getByLabel('这一天', { exact: true }).fill(`${month}-16`);
  await page.locator('dialog textarea').fill(caption);
  await page.screenshot({ path: join(output, 'uploaded-seven-sources.png'), fullPage: true });
  await page.getByRole('button', { name: '保存这一餐', exact: true }).click();
  const article = page.locator('.journal-sheet').filter({ hasText: caption }).filter({has:page.locator('.journal-mini-strip')});
  await article.waitFor();
  assert.match(await article.innerText(), /6 张照片/);
  checks.push('一次选择七源文件含Apple反序双文件，六照片正常发布，无429');
  await page.getByLabel('按月份查看手记').fill(month);
  await article.waitFor();
  await page.screenshot({ path: join(output, 'desktop-light.png'), fullPage: true });
  await article.getByRole('button', { name: '翻开这篇 ↗' }).click();
  await page.getByRole('button', { name: '◎ 播放实况', exact: true }).click();
  await page.waitForFunction(() => { const v = document.querySelector('.journal-viewer-video'); return v && !v.paused && v.currentTime > 0.1 && v.videoWidth > 0; });
  await page.getByRole('button', { name: '声音关', exact: true }).click();
  assert.equal(await page.locator('video').evaluate(v => v.muted), false);
  await page.getByRole('button', { name: '下一张', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.journal-viewer-video')?.hidden);
  assert.equal(await page.locator('video').evaluate(v => v.paused), true);
  await page.getByRole('button', { name: '上一张', exact: true }).click();
  await page.getByRole('button', { name: '◎ 播放实况', exact: true }).waitFor();
  // 长按用实际指针事件；不代替真机相册/原生手势验收。
  const image = page.locator('.pswp__item').nth(1).locator('img.pswp__img').last();
  const rect = await image.boundingBox();
  assert.ok(rect);
  await page.mouse.move(rect.x + rect.width/2, rect.y + rect.height/2);
  await page.mouse.down();
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v && !v.hidden && !v.paused; });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('video')?.hidden);
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  checks.push('真实MOV兼容副本播放、声音开关、播放中切图停止、长按松手回封面');
  await article.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('dialog textarea').fill(`${caption} · 已修改`);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await article.getByText(`${caption} · 已修改`, { exact: true }).waitFor();
  for (const [name, width, height, dark] of [['tablet',834,1112,false],['phone',390,844,false],['phone-dark',390,844,true]]) {
    await page.setViewportSize({ width, height });
    if(dark) { await page.getByLabel('切换暗色主题').click(); await page.waitForTimeout(800); }
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}横向溢出`);
  }
  checks.push('桌面平板手机亮暗布局无横向溢出，真实编辑后刷新可读');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('切换亮色主题').click();
  // 人为中断一次上传；只这一次失败模拟，其余都是实际后端。
  let fail = true;
  await page.route('**/api/journal/uploads', async route => {
    if (fail && route.request().method() === 'POST') { fail=false; return route.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({error:{code:'TEST_NETWORK',message:'测试：网络暂时中断，请重试'}}) }); }
    return route.continue();
  });
  const buffer = await readFile(photos[0]);
  await page.evaluate(({ bytes }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'drag-retry.jpg', { type:'image/jpeg' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer:transfer, bubbles:true, cancelable:true }));
  }, { bytes:[...buffer] });
  await page.getByRole('button', { name:'重试', exact:true }).click();
  await page.waitForFunction(() => document.querySelector('.journal-form-footer')?.textContent?.includes('1 张已就绪') && !document.querySelector('.journal-form-footer')?.textContent?.includes('正在整理'));
  await page.getByLabel('这一天', {exact:true}).fill(`${month}-17`);
  await page.locator('dialog textarea').fill(`${caption} · 拖入重试`);
  // 模拟服务已提交但回包丢失，再点核对必须只有一篇。
  let loseResponse = true;
  await page.route('**/api/journal/entries', async route => {
    if (loseResponse && route.request().method()==='POST') { loseResponse=false; await route.fetch(); return route.abort('connectionreset'); }
    return route.continue();
  });
  await page.getByRole('button', {name:'保存这一餐',exact:true}).click();
  await page.getByRole('button', {name:'核对并重试',exact:true}).click();
  await page.locator('.journal-sheet').filter({hasText:`${caption} · 拖入重试`}).waitFor();
  const list = await (await fetch(`${base}/api/journal/entries?month=${month}&limit=100&offset=0`)).json();
  assert.equal(list.data.filter(item=>item.caption === `${caption} · 拖入重试`).length,1);
  checks.push('全页拖入、单张503后重试、发布已成功但回包丢失后幂等核对不重复');
  await article.getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await article.waitFor({state:'detached'});
  checks.push('浏览器真实确认删除后列表移除');
  assert.deepEqual(crashes, []);
  const unexpected=responses.filter(item=>item.status>=400 && item.status!==503);
  assert.deepEqual(unexpected, []);
  await writeFile(join(output,'evidence.json'),JSON.stringify({base,checks,crashes,expected_faults:['one upload503','one publishresponse aborted after commit'],production_touched:false},null,2));
  console.log(JSON.stringify({checks,output}));
} catch(error) {
  await page.screenshot({path:join(output,'failure.png'),fullPage:true});
  console.error(await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
