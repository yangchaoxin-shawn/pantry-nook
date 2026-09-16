// 真实接口照片编辑验收；只允许本轮独立服务，不修改用户评审库。
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = process.env.JOURNAL_TEST_BASE;
assert.ok(base, '必须显式指定独立前端');
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(![3000, 3018, 3019, 3060, 5173, 5200, 5201, 5217, 5218, 5220, 5222].includes(Number(new URL(base).port)));
const health = await fetch(`${base}/health`);
const marker = health.headers.get('x-pantry-nook-test-database');
assert.match(marker || '', /^pantry_nook_test_[a-f0-9]{32}$/);
assert.equal(marker, process.env.JOURNAL_TEST_DATABASE);
assert.equal(health.headers.get('x-pantry-nook-test-media'), marker);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const food = resolve(process.env.JOURNAL_FOOD_SAMPLES);
const samples = resolve(process.env.JOURNAL_SAMPLES);
const output = resolve('.review/journal-editor-browser');
await mkdir(output, { recursive: true });
const names = (await readdir(food)).filter(name => /\.jpg$/i.test(name));
assert.ok(names.length >= 5);
const buffers = await Promise.all(names.slice(0, 5).map(name => readFile(join(food, name))));
const files = (count, prefix = 'photo') => Array.from({ length: count }, (_, i) => ({ name: `${prefix}-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: buffers[i % 5] }));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);
const crashes = [], checks = [], statuses = [];
let uploads = 0;
page.on('pageerror', error => crashes.push(error.message));
page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/journal/uploads')) uploads++; });
page.on('response', res => { if (res.url().includes('/api/journal/') && res.status() >= 400) statuses.push(res.status()); });
const caption = `编辑验收 ${Date.now()}`;
const picker = () => page.getByLabel('选择照片', { exact: true });
const cards = () => page.locator('.journal-draft-photo');
const cover = () => page.locator('.journal-draft-photo.is-cover');
const article = () => page.locator('.journal-sheet').filter({ hasText: caption });
const ready = async () => { await page.waitForFunction(() => !document.querySelector('.journal-composer progress') && !document.querySelector('.journal-replacement'), null, { timeout: 180000 }); };
const list = async () => (await (await fetch(`${base}/api/journal/entries?limit=100&offset=0`)).json()).data;
const entry = async () => (await list()).find(item => item.caption.startsWith(caption));
const replace = async () => { const chooser = page.waitForEvent('filechooser'); await cards().first().getByRole('button', { name: '替换', exact: true }).click(); await (await chooser).setFiles(files(1, 'replacement')); };
const save = async (edit = false) => { await page.getByRole('button', { name: edit ? '保存修改' : '保存这一餐', exact: true }).click(); await page.locator('dialog').waitFor({ state: 'detached' }); };
try {
  await page.goto(base);
  await page.getByRole('button', { name: '手记', exact: true }).click();
  await page.getByRole('button', { name: '＋ 记下一餐', exact: true }).first().click();
  // 超额先选，退出时完全不上传。
  const initialUploads = uploads;
  await picker().setInputFiles(files(12, 'overflow'));
  await page.getByRole('heading', { name: '留哪几张，慢慢选。' }).waitFor();
  assert.equal(uploads, initialUploads);
  assert.equal(await page.locator('.journal-candidate[aria-pressed=true]').count(), 0);
  await page.getByRole('button', { name: '返回整理', exact: true }).click();
  assert.equal(await cards().count(), 0);
  assert.equal(uploads, initialUploads);
  await picker().setInputFiles([{ name: '食谱.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') }, { name: '伪装.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('%PDF-1.7') }]);
  await page.getByText('这些文件没有加入', { exact: true }).waitFor();
  assert.equal(await cards().count(), 0);
  assert.equal(uploads, initialUploads);
  checks.push('超额默认零选择、确认前零上传、退出不丢文件；文档及伪装JPG前置拒绝');

  await picker().setInputFiles(files(12, 'selected'));
  for (const i of [0, 2, 3, 4, 5, 6, 7, 9, 11]) await page.locator('.journal-candidate').nth(i).click();
  assert.equal(await page.locator('.journal-candidate:disabled').count(), 3);
  await page.getByRole('button', { name: '加入所选 9 张', exact: true }).click();
  await ready();
  assert.equal(await cards().count(), 9);
  const order = await cards().evaluateAll(nodes => nodes.map(node => node.dataset.uploadId));
  await page.getByRole('button', { name: '将第 3 张照片选为封面', exact: true }).click();
  assert.deepEqual(await cards().evaluateAll(nodes => nodes.map(node => node.dataset.uploadId)), order);
  assert.equal(await cover().getAttribute('data-upload-id'), order[2]);
  assert.equal(await page.getByText('✓ 当前封面', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '设为封面', exact: true }).count(), 0);
  await page.screenshot({ path: join(output, 'composer-desktop.png'), fullPage: true });
  // 移除按钮不切封面；撤销不抢回用户新选封面。
  await page.getByRole('button', { name: '移除第 3 张照片', exact: true }).click();
  assert.equal(await cover().count(), 0);
  assert.equal(await page.getByRole('button', { name: '保存这一餐', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '将第 4 张照片选为封面', exact: true }).click();
  const newerCover = await cover().getAttribute('data-upload-id');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await cover().getAttribute('data-upload-id'), newerCover);
  assert.deepEqual(await cards().evaluateAll(nodes => nodes.map(node => node.dataset.uploadId)), order);
  await page.locator('dialog textarea').fill(caption);
  await save();
  await article().waitFor();
  let saved = await entry();
  assert.equal(saved.photos.length, 9);
  assert.equal(saved.cover_upload_id, newerCover);
  assert.equal(await article().locator('.journal-image-button img').first().getAttribute('src'), saved.photos.find(photo => photo.image.id === newerCover).image.preview_url);
  checks.push('九张按用户选择保留；点图选封面不跳位；移除封面拦保存；撤销恢复原位且不抢新封面');

  await article().getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('选择替换照片').dispatchEvent('cancel', { bubbles: true });
  assert.equal(await page.locator('dialog').count(), 1, '取消文件选择不得关闭编辑');
  const oldId = saved.photos[0].image.id, oldUrl = saved.photos[0].image.original_url;
  let failUpload = true;
  await page.route('**/api/journal/uploads', route => failUpload ? (failUpload = false, route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST', message: '测试：暂时断网，请重试' } }) })) : route.continue());
  await replace();
  await page.locator('.journal-replacement').getByRole('button', { name: '重试', exact: true }).waitFor();
  assert.equal((await fetch(`${base}${oldUrl}`)).status, 200);
  assert.equal(await cards().first().getAttribute('data-upload-id'), oldId);
  await page.getByRole('button', { name: '取消替换', exact: true }).click();
  await replace();
  await ready();
  await page.waitForFunction(id => document.querySelector('.journal-draft-photo')?.getAttribute('data-upload-id') !== id, oldId);
  assert.equal((await fetch(`${base}${oldUrl}`)).status, 200);
  const replacementId = await cards().first().getAttribute('data-upload-id');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  assert.equal((await entry()).photos[0].image.id, oldId);
  assert.equal((await fetch(`${base}${oldUrl}`)).status, 200);
  checks.push('替换503保留原图；取消替换后同文件可重选；取消编辑不修改已保存照片');

  await article().getByRole('button', { name: '编辑', exact: true }).click();
  await replace();
  await ready();
  await page.waitForFunction(id => document.querySelector('.journal-draft-photo')?.getAttribute('data-upload-id') !== id, oldId);
  assert.notEqual(await cards().first().getAttribute('data-upload-id'), replacementId);
  // 服务提交成功但响应丢失，再次提交必须重放同一编辑结果。
  let loseResponse = true;
  await page.route(`**/api/journal/entries/${saved.id}`, async route => {
    if (loseResponse && route.request().method() === 'PATCH') { loseResponse = false; await route.fetch(); return route.abort('connectionreset'); }
    return route.continue();
  });
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByRole('button', { name: '核对并重试', exact: true }).click();
  await page.locator('dialog').waitFor({ state: 'detached' });
  saved = await entry();
  assert.notEqual(saved.photos[0].image.id, oldId);
  assert.equal(saved.cover_upload_id, newerCover);
  assert.equal((await fetch(`${base}${oldUrl}`)).status, 404);
  checks.push('完整替换保存与封面保持；提交回包丢失后幂等核对；旧媒体保存后404');

  // 从9张编辑到7张，再加入5张，必须只允许选2张。
  await article().getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '移除第 9 张照片', exact: true }).click();
  await page.getByRole('button', { name: '移除第 8 张照片', exact: true }).click();
  const beforeOverflow = uploads;
  await picker().setInputFiles(files(5, 'additional'));
  await page.getByText('已有 7 张，还可加入 2 张。已选 0 张照片。', { exact: true }).waitFor();
  assert.equal(uploads, beforeOverflow);
  await page.locator('.journal-candidate').nth(1).click();
  await page.locator('.journal-candidate').nth(4).click();
  assert.equal(await page.locator('.journal-candidate:disabled').count(), 3);
  await page.getByRole('button', { name: '加入所选 2 张', exact: true }).click();
  await ready();
  assert.equal(await cards().count(), 9);
  await save(true);
  checks.push('已有7张再选5张，上传前选2张，最终9张');

  // 多端数量排版；用真实编辑从9缩至1，逐次保存并核验所有图片均渲染。
  for (let count = 9; count >= 1; count--) {
    if (count < 9) {
      await article().getByRole('button', { name: '编辑', exact: true }).click();
      await page.getByRole('button', { name: '将第 1 张照片选为封面', exact: true }).click();
      await page.getByRole('button', { name: `移除第 ${count + 1} 张照片`, exact: true }).click();
      await save(true);
    }
    for (const [size, width, height] of [['desktop', 1440, 1000], ['tablet', 834, 1112], ['phone', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await article().locator(`.story-count-${count}`).waitFor();
      assert.equal(await article().locator('.journal-image-button').count(), count);
      await article().scrollIntoViewIfNeeded();
      await article().screenshot({ path: join(output, `${size}-${count}.png`) });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${size}/${count}横向溢出`);
    }
  }
  await page.getByLabel('切换暗色主题').click();
  await page.screenshot({ path: join(output, 'phone-dark.png'), fullPage: true });
  await article().getByRole('button', { name: '编辑', exact: true }).click();
  const buttonRect = await page.getByRole('button', { name: '移除第 1 张照片', exact: true }).boundingBox();
  assert.ok(buttonRect.width >= 44 && buttonRect.height >= 44);
  await page.getByRole('button', { name: '移除第 1 张照片', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.screenshot({ path: join(output, 'composer-phone-dark.png'), fullPage: true });
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  checks.push('1至9张桌面/平板/手机真实布局全图可见无横向溢出；暗色；44px移除；零照片不能保存');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('切换亮色主题').click();
  // 各平台照片统一静态；视频前置拒绝，图库无动态控制。
  await page.getByRole('button', { name: '＋ 记下一餐', exact: true }).first().click();
  const beforeVideo = uploads;
  await picker().setInputFiles(join(samples, 'apple-iphone15.mov'));
  await page.getByText('这些文件没有加入', { exact: true }).waitFor();
  assert.equal(uploads, beforeVideo);
  await picker().setInputFiles([join(samples, 'apple-iphone15.heic'), join(samples, 'pixel-8a.jpg'), join(samples, 'samsung-one-ui-6.heic')]);
  await ready();
  await page.waitForFunction(() => !document.querySelector('.journal-composer progress'));
  assert.equal(await cards().count(), 3);
  assert.doesNotMatch(await page.locator('dialog').innerText(), /实况|MOV|配对|片段/);
  await page.locator('dialog textarea').fill(`${caption} 静态照片`);
  await save();
  const photoArticle = page.locator('.journal-sheet').filter({ hasText: `${caption} 静态照片` });
  await photoArticle.getByRole('button', { name: '翻开这篇 ↗', exact: true }).click();
  await page.getByRole('link', { name: '下载原片', exact: true }).waitFor();
  assert.equal(await page.locator('video').count(), 0);
  assert.doesNotMatch(await page.locator('.pswp').innerText(), /实况|播放|声音|动态/);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '关闭照片', exact: true }).click();
  await page.locator('.pswp').waitFor({ state: 'detached' });
  await photoArticle.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '移除第 1 张照片', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await cards().count(), 3);
  await save(true);
  checks.push('MOV前置拒绝；Apple/Pixel/Samsung照片静态上传与图库，无实况文案/视频；移除与撤销正常');
  // 真正的拖入事件经过同一格式检查和上传接口。
  await page.evaluate(bytes => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'drag-food.jpg', { type: 'image/jpeg' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })); }, [...buffers[0]]);
  await cards().first().waitFor(); await ready();
  await page.locator('dialog textarea').fill(`${caption} 拖入`);
  await save();
  const dragged = page.locator('.journal-sheet').filter({ hasText: `${caption} 拖入` });
  await dragged.getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('dialog textarea').fill(`${caption} 本机草稿保留`);
  const current = (await list()).find(item => item.caption === `${caption} 拖入`);
  const external = await fetch(`${base}/api/journal/entries/${current.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry_date: current.entry_date, caption: `${caption} 其他设备修改`, expected_updated_at: current.updated_at }) });
  assert.equal(external.status, 200);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByText('这篇手记已在其他页面修改，当前草稿未覆盖它。请先保留需要的文字，再取消编辑、刷新后重新整理。', { exact: true }).waitFor();
  assert.equal(await page.locator('dialog textarea').inputValue(), `${caption} 本机草稿保留`);
  assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  checks.push('全页真实拖入发布；其他设备版本冲突保留本机输入且阻止覆盖');
  // 共享Dialog修复后，手记和菜品弹窗Escape仍保持关闭行为。
  await page.getByRole('button', { name: '＋ 记下一餐', exact: true }).first().click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').count(), 0);
  await page.getByRole('button', { name: '菜品', exact: true }).click();
  await page.getByRole('button', { name: /添加菜品|新建菜品|记一道菜|新增菜品/ }).first().click();
  await page.locator('dialog').waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').count(), 0);
  checks.push('共享弹窗：取消文件选择不关闭，手记和菜品Escape仍可关闭');
  assert.deepEqual(crashes, []);
  assert.deepEqual(statuses.filter(status => status !== 503 && status !== 409), []);
  const finalHealth = await fetch(`${base}/health`);
  assert.equal(finalHealth.headers.get('x-pantry-nook-test-database'), marker);
  await writeFile(join(output, 'evidence.json'), JSON.stringify({ base, database: marker, checks, crashes, expectedFaults: ['upload503', 'PATCH response abort after commit', 'edit409 after other device update'], productionTouched: false }, null, 2));
  console.log(JSON.stringify({ checks, output }));
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
