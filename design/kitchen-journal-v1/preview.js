/* 仅用于设计评审：数据驻留内存，不连接 API，不写浏览器持久化。 */
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const art = (name='pot', extra='') => window.PantryArt.render(name, extra);
const categories = ['碳水','蔬菜','蛋白质','水果','其他'];
const categoryIcons = {碳水:'grain',蔬菜:'leaf',蛋白质:'egg',水果:'fruit',其他:'jar'};
const locations = ['室温','冷藏','冷冻'];
const units = {碳水:['kg','g','斤','袋','把','个'],蔬菜:['个','g','斤','kg','把','份'],蛋白质:['g','kg','个','盒','份'],水果:['个','g','斤','kg','盒'],其他:['瓶','盒','袋','g','ml','L']};
const qty = (n) => Number(Number(n).toFixed(6)).toString();
const parseQuantity = (text) => {
  const value = String(text).trim();
  if (/^\d+\s*\/\s*\d+$/.test(value)) { const [a,b] = value.split('/').map(Number); return b > 0 ? a / b : NaN; }
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
};
const state = {
  page: 'menu', scene: 'normal', location: '全部', category: '全部', search: '', catalogTab: 'dishes',
  stock: [
    {id:1,name:'大米',category:'碳水',value:1.7,unit:'kg',location:'室温'},
    {id:2,name:'鸡蛋',category:'蛋白质',value:6,unit:'个',location:'冷藏'},
    {id:3,name:'番茄',category:'蔬菜',value:4,unit:'个',location:'冷藏'},
    {id:4,name:'胡萝卜',category:'蔬菜',value:3,unit:'个',location:'冷藏'},
    {id:5,name:'西兰花',category:'蔬菜',value:1,unit:'个',location:'冷藏'},
    {id:6,name:'鸡胸肉',category:'蛋白质',value:500,unit:'g',location:'冷冻'},
    {id:7,name:'苹果',category:'水果',value:2,unit:'个',location:'冷藏'},
    {id:8,name:'豆腐',category:'蛋白质',value:1,unit:'盒',location:'冷藏'},
  ],
  dishes: ['番茄炒鸡蛋','清炒西兰花','香煎鸡胸肉','胡萝卜炒鸡蛋','菠萝炒饭','番茄豆腐汤'],
  plans: [{name:'家常两道菜',dishes:['番茄炒鸡蛋','清炒西兰花']},{name:'清爽小搭配',dishes:['香煎鸡胸肉','清炒西兰花']}],
  menus: [
    {id:1,date:'2026-09-14',period:'晚餐',done:false,dishes:[{name:'菠萝炒饭',materials:[{id:1,amount:'0.2'},{id:2,amount:'2'},{id:null,name:'菠萝',amount:'1/2个'}]}]},
    {id:2,date:'2026-09-13',period:'晚餐',done:false,dishes:[{name:'番茄炒鸡蛋',materials:[{id:3,amount:'2'},{id:2,amount:'2'}]},{name:'清炒西兰花',materials:[{id:5,amount:'1'}]}]},
    {id:3,date:'2026-09-13',period:'午餐',done:false,dishes:[{name:'胡萝卜炒鸡蛋',materials:[{id:4,amount:'4'},{id:2,amount:'2'}]}]},
    {id:4,date:'2026-09-12',period:'晚餐',done:true,dishes:[{name:'香煎鸡胸肉',materials:[{id:6,amount:'200',unit:'g',name:'鸡胸肉'}]},{name:'番茄豆腐汤',materials:[{id:3,amount:'1',unit:'个',name:'番茄'},{id:8,amount:'1/2',unit:'盒',name:'豆腐'}]}]},
  ], records: [], editor: null, review: null, batch: null, detailId: null,
};
let toastTimer;
const findStock = (id) => state.stock.find(item => item.id === Number(id));
const findMenu = (id) => state.menus.find(menu => menu.id === Number(id));
const allMaterials = (menu) => menu.dishes.flatMap(dish => dish.materials);
const dateLabel = (date) => ({'2026-09-13':'今天','2026-09-14':'明天','2026-09-12':'昨天'}[date] || `${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`);
const button = (text,action,options='') => `<button type="button" class="button" data-action="${action}" ${options}>${text}</button>`;
function toast(text, scene='celebrate') { $('#toast').innerHTML=art(scene,'toast-art')+`<span>${escapeHtml(text)}</span>`; $('#toast').classList.add('show'); window.PantryMotion?.success(); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3000); }
function openDialog(content,{wide=false}={}) {
  const dialog=$('#dialog'); const wasOpen=dialog.open; const previousTitle=$('#dialog-title')?.textContent; const previousScroll=dialog.scrollTop;
  dialog.classList.toggle('wide',wide); $('#dialog-content').innerHTML=content;
  if(!wasOpen) dialog.showModal();
  dialog.scrollTop=wasOpen && previousTitle===$('#dialog-title')?.textContent ? previousScroll : 0;
  window.PantryMotion?.dialog(wasOpen);
}
function dialogHeading(title,subtitle='',eyebrow='PANTRY NOOK') { const scene=/核对|安排|菜单/.test(title)?'pot':/变质|损坏/.test(title)?'leaf':(/库存|食材|恢复/.test(title)||eyebrow==='IN THE PANTRY')?'pantry':'recipe'; return `<div class="dialog-heading"><span class="eyebrow">${eyebrow}</span><h2 id="dialog-title">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}${art(scene,'dialog-art')}</div>`; }
function closeDialog() { window.PantryMotion?.closeDialog(); }
function renderNav() {
  const items=[['menu','menu','餐安排'],['stock','fridge','库存'],['catalog','dish','菜品']];
  const html=items.map(([key,name,title])=>`<button type="button" data-action="nav" data-page="${key}" class="${state.page===key?'active':''}" ${state.page===key?'aria-current="page"':''}>${icon(name)}<span>${title}</span></button>`).join('');
  for (const nav of [$('#desktop-nav'),$('#mobile-nav')]) { nav.dataset.active=items.findIndex(([key])=>key===state.page); nav.innerHTML=html; }
}
function hero(type) {
  const copy={menu:['A LITTLE EVERYDAY JOY','把日子，<span>煮成喜欢的样子。</span>','一餐一饭，慢慢安排。','今天，合伙做顿饭','heytea-direction/direction.png','pot'],stock:['GOOD THINGS AT HOME','家里还有什么？','好好收着，也好好吃掉。','把好东西，带回家','assets/pantry-collage.png','pantry'],catalog:['RECIPES TO KEEP','喜欢的菜，<span>常常做。</span>','存下熟悉的味道，下次直接选。','这一口，还想再吃','assets/recipe-collage.png','recipe']}[type];
  return `<section class="hero ${type==='menu'?'home':type}"><div class="hero-copy"><div class="eyebrow"><span class="tiny-flower" aria-hidden="true">✳</span>${copy[0]}</div><h1>${copy[1]}</h1><p>${copy[2]}</p><span class="hero-scribble" aria-hidden="true">小小厨房，好好生活 <svg viewBox="0 0 90 30"><path d="M2 8q38 32 82 2m-13-1 14 1-6 11"/></svg></span></div><button type="button" class="story-collage" data-action="play-scene" aria-label="播放${type==='menu'?'备餐':type==='stock'?'收纳':'翻食谱'}小动画">${window.PantryIllustrations.render(type,'story-image')}<span class="story-caption">${copy[3]}<span aria-hidden="true">↗</span></span><span class="story-spark" aria-hidden="true">✳</span></button><button type="button" class="hero-art-switch" data-illustration-target="${type}" aria-label="更换${{menu:'餐安排',stock:'库存',catalog:'菜品'}[type]}页头插画">换张插画 ↗</button><span class="page-number" aria-hidden="true">${{menu:'01 / 餐安排',stock:'02 / 小库存',catalog:'03 / 食谱本'}[type]}</span></section>`;
}
function specialScene() {
  if(state.scene==='loading') return `<section class="loading-scene" aria-busy="true" aria-label="正在读取">${art('loading')}<p class="note">正在翻开厨房手账…</p><div class="skeleton"></div><div class="skeleton short"></div></section>`;
  if(state.scene==='error') return `<section class="empty-state" role="alert">${art('error')}<h2>这次没能读到记录</h2><p>重新读取试试。</p>${button('重新读取','retry')}</section>`;
  if(state.scene==='empty') { const copy={menu:['还没安排下一餐','从一道想吃的菜开始。','安排一餐','arrange'],stock:['小厨房，等你填满','把家里已有的食材记下来。','记录食材','single'],catalog:['先记一道拿手菜','简单存下菜名，下次就能直接选。','添加菜品','new-dish']}[state.page]; return `<section class="empty-state">${art(state.page==='catalog'?'recipe':'empty')}<h2>${copy[0]}</h2><p>${copy[1]}</p>${button(copy[2],copy[3])}</section>`; }
  return '';
}
function menuIssue(menu) {
  const pending=allMaterials(menu).filter(item=>!item.id); if(pending.length) return `${pending.map(item=>item.name).join('、')}还没入库`;
  const totals={}; for(const item of allMaterials(menu)) { if(!item.amount) return '还有用量待补充'; totals[item.id]=(totals[item.id]||0)+parseQuantity(item.amount); }
  for(const [id,total] of Object.entries(totals)) {const stock=findStock(id); if(!stock || stock.value<total) return `${stock?.name||'食材'}还差 ${qty(total-(stock?.value||0))}${stock?.unit||''}`;}
  return '';
}
function menuPage() {
  const planned=state.menus.filter(item=>!item.done).sort((a,b)=>b.date.localeCompare(a.date)||['晚餐','午餐','早餐'].indexOf(a.period)-['晚餐','午餐','早餐'].indexOf(b.period));
  const done=state.menus.filter(item=>item.done).sort((a,b)=>b.date.localeCompare(a.date));
  return `<div class="menu-layout"><section><div class="section-title"><h2>接下来吃什么</h2><button class="button primary small" data-action="arrange">${icon('plus')}安排一餐</button></div>
    ${planned.length?planned.map(menu=>{const issue=menuIssue(menu);return `<article class="menu-card"><div class="cloth"></div><div class="menu-card-inner"><div class="between"><div class="date-line"><strong>${dateLabel(menu.date)} · ${menu.period}</strong><span>${menu.date.slice(5).replace('-',' / ')}</span></div><span class="status">待完成</span></div><div class="meal-dishes">${menu.dishes.map(dish=>`<span class="dish-tag">${escapeHtml(dish.name)}</span>`).join('')}</div>${issue?`<div class="issue-note">${escapeHtml(issue)}，可以先保留安排。</div>`:''}<div class="menu-card-footer"><span class="note">${menu.dishes.length} 道菜</span><div class="actions"><button class="text-button" data-action="arrange" data-id="${menu.id}">编辑</button><button class="button primary small" data-action="review" data-id="${menu.id}">核对用料</button></div></div></div></article>`}).join(''):`<div class="empty-state">${art('pot')}<p>下一餐还没安排</p>${button('安排一餐','arrange')}</div>`}
    <div class="section-title history-heading"><h2>好好吃过的饭</h2><small>新的在上，旧的在下</small></div>${done.map(menu=>`<details class="history-item"><summary><div><h3>${dateLabel(menu.date)} · ${menu.period} <span class="note">${menu.date.slice(5).replace('-',' / ')}</span></h3><p>${menu.dishes.map(dish=>escapeHtml(dish.name)).join(' · ')}</p></div><span class="status done">已完成 ﹀</span></summary><div class="history-content">${menu.dishes.map(dish=>`<p><strong>${escapeHtml(dish.name)}</strong> · ${dish.materials.map(item=>`${escapeHtml(item.name||findStock(item.id)?.name)} ${escapeHtml(item.amount)}${escapeHtml(item.unit||findStock(item.id)?.unit||'')}`).join('、')}</p>`).join('')}<div class="actions"><button class="text-button" data-action="copy-menu" data-id="${menu.id}">再安排一次</button><button class="text-button" data-action="history-recovery" data-id="${menu.id}">撤销确认</button></div></div></details>`).join('')||'<p class="note">完成一餐后，会留在这里。</p>'}</section>
    <aside class="side-note"><div class="note-illustration">${art('recipe')}</div><h2>熟悉的味道</h2><p>常用搭配，忙的时候直接拿来。</p>${state.plans.map((plan,index)=>`<button class="plan-shortcut" data-action="use-plan" data-index="${index}"><strong>${escapeHtml(plan.name)}</strong><p>${plan.dishes.map(escapeHtml).join(' · ')}</p><span class="note">用这个搭配 ${icon('arrow')}</span></button>`).join('')}</aside></div><p class="quiet-footer">厨房里的小日常</p>`;
}
function stockGroups() {
  const items=state.stock.filter(item=>item.value>0 && (state.category==='全部'||item.category===state.category) && (state.location==='全部'||item.location===state.location) && item.name.includes(state.search.trim()));
  return items.length?categories.map(category=>{const group=items.filter(item=>item.category===category); return group.length?`<section class="stock-group" aria-label="${category}库存"><h2>${icon(categoryIcons[category])}${category}</h2>${group.map(item=>`<button class="stock-row" data-action="detail" data-id="${item.id}" aria-label="查看${escapeHtml(item.name)}，${qty(item.value)}${escapeHtml(item.unit)}"><span>${escapeHtml(item.name)}</span><span class="stock-quantity">${qty(item.value)}<small>${escapeHtml(item.unit)}</small></span></button>`).join('')}</section>`:'';}).join(''):`<section class="empty-state">${art('empty')}<h2>这里暂时没有食材</h2><p>试试其他名称或存放位置。</p>${button('清除筛选','clear-filters')}</section>`;
}
function stockPage() {
  return `<div class="inventory-toolbar"><label class="search">${icon('search')}<input type="search" id="stock-search" placeholder="找找家里的食材" aria-label="搜索食材" value="${escapeHtml(state.search)}"></label><div class="actions"><button class="button" data-action="single">${icon('plus')}单个记录</button><button class="button primary" data-action="batch">批量记录</button></div></div><div class="filters" aria-label="存放位置">${['全部',...locations].map(location=>`<button data-action="location" data-value="${location}" class="${state.location===location?'active':''}" aria-pressed="${state.location===location}">${location==='全部'?'全部位置':location}</button>`).join('')}</div><div class="category-filters" aria-label="食材类别">${['全部',...categories].map(category=>`<button data-action="category" data-value="${category}" class="${state.category===category?'active':''}" aria-pressed="${state.category===category}">${category}</button>`).join('')}</div><div class="inventory-grid" id="stock-groups">${stockGroups()}</div><div class="sub-links"><button class="text-button" data-action="records">变质 / 损坏记录 ${icon('arrow')}</button></div><p class="quiet-footer">心里有数，下厨不慌</p>`;
}
function catalogPage() {
  return `<div class="section-title"><div class="filters catalog-tabs"><button data-action="catalog-tab" data-value="dishes" class="${state.catalogTab==='dishes'?'active':''}" aria-pressed="${state.catalogTab==='dishes'}">我的菜品</button><button data-action="catalog-tab" data-value="plans" class="${state.catalogTab==='plans'?'active':''}" aria-pressed="${state.catalogTab==='plans'}">常用搭配</button></div><button class="button primary small" data-action="${state.catalogTab==='dishes'?'new-dish':'new-plan'}">${icon('plus')}${state.catalogTab==='dishes'?'添加菜品':'创建搭配'}</button></div>${state.catalogTab==='dishes'?`<div class="catalog-grid">${state.dishes.map((name,index)=>`<article class="catalog-item"><strong><span class="catalog-mark">${art(['plate','pot','recipe'][index%3])}</span>${escapeHtml(name)}</strong><button class="text-button" data-action="edit-dish" data-index="${index}">编辑</button></article>`).join('')}</div>`:`<div class="plan-grid">${state.plans.map((plan,index)=>`<article class="plan-note"><div class="cloth">${window.PantryIllustrations.render('plan-'+index,'plan-illustration',index%2?'chicken-greens':'supper-duo')}<button type="button" class="plan-art-switch" data-illustration-target="plan-${index}" aria-label="更换${escapeHtml(plan.name)}的插画">换张插画 ↗</button></div><div><h3>${escapeHtml(plan.name)}</h3><p>${plan.dishes.map(escapeHtml).join(' · ')}</p><div class="between"><button class="button primary small" data-action="use-plan" data-index="${index}">用这个搭配</button><button class="text-button" data-action="edit-plan" data-index="${index}">编辑</button></div></div></article>`).join('')}</div>`}<p class="quiet-footer">留住喜欢的味道</p>`;
}
function render() { const focused=document.activeElement; const focusKey=focused?.dataset?.action; const focusValue=focused?.dataset?.value; const focusPage=focused?.dataset?.page; renderNav(); $('#scene-select').value=state.scene; $('#main').innerHTML=hero(state.page)+(specialScene()||({menu:menuPage,stock:stockPage,catalog:catalogPage}[state.page])()); window.PantryMotion?.page(); if(['nav','location','category','catalog-tab'].includes(focusKey)){ const candidates=Array.from(document.querySelectorAll(`[data-action="${focusKey}"]`)); candidates.find(el=>el.dataset.value===focusValue&&el.dataset.page===focusPage&&el.getClientRects().length)?.focus({preventScroll:true}); } }
function stockDetail(id) {
  const item=findStock(id); state.detailId=item.id;
  openDialog(`<div class="dialog-body">${dialogHeading(escapeHtml(item.name),'','IN THE PANTRY')}<div class="detail-quantity">${qty(item.value)}<small>${escapeHtml(item.unit)}</small></div><dl class="detail-info"><div><dt>类别</dt><dd>${item.category}</dd></div><div><dt>存放位置</dt><dd>${item.location||'未设置'}</dd></div></dl><div class="detail-actions"><button class="button primary" data-action="edit-stock" data-id="${item.id}">编辑库存</button><button class="text-button danger" data-action="waste" data-id="${item.id}">处理变质 / 损坏</button></div></div>`);
}
function stockEditor(id,returnToReview=false) {
  const item=findStock(id);
  openDialog(`<div class="dialog-body">${dialogHeading('编辑库存',escapeHtml(item.name))}<form id="stock-edit-form"><label class="field"><span>食材名称</span><input name="name" value="${escapeHtml(item.name)}" required></label><div class="field-grid"><label class="field"><span>数量</span><input name="value" value="${qty(item.value)}" inputmode="decimal" required></label><label class="field"><span>单位</span><input name="unit" value="${escapeHtml(item.unit)}" required></label><label class="field"><span>类别</span><select name="category">${categories.map(c=>`<option ${c===item.category?'selected':''}>${c}</option>`).join('')}</select></label><label class="field"><span>存放位置</span><select name="location">${locations.map(l=>`<option ${l===item.location?'selected':''}>${l}</option>`).join('')}</select></label></div><div class="form-message" id="stock-edit-error" role="alert"></div><button class="button primary" type="submit">保存</button></form></div>`);
  if(returnToReview){$('#stock-edit-form').insertAdjacentHTML('beforeend',' <button type="button" class="text-button" data-action="back-review">返回核对</button>');}
  $('#stock-edit-form').addEventListener('submit',event=>{event.preventDefault(); const fields=new FormData(event.target); const name=fields.get('name').trim(); const value=parseQuantity(fields.get('value')); const unit=fields.get('unit').trim(); if(!name||!unit||!(value>0)) return $('#stock-edit-error').textContent='请填写名称、单位和大于 0 的数量。'; if(state.stock.some(s=>s.id!==item.id&&s.value>0&&s.name.toLowerCase()===name.toLowerCase())) return $('#stock-edit-error').textContent='已有同名食材，请保留一个名称。'; Object.assign(item,{name,value,unit,category:fields.get('category'),location:fields.get('location')}); if(returnToReview){state.page='menu';render();renderReview();}else{closeDialog();render();} toast('本页库存已更新');});
}
function wasteDialog(id) {
  const item=findStock(id);
  openDialog(`<div class="dialog-body">${dialogHeading('处理变质 / 损坏',`${escapeHtml(item.name)} · 当前 ${qty(item.value)}${escapeHtml(item.unit)}`)}<form id="waste-form"><label class="field"><span>处理数量（${escapeHtml(item.unit)}）</span><input name="amount" inputmode="decimal" value="${qty(item.value)}" required></label><label class="field"><span>原因</span><select name="reason"><option>变质</option><option>损坏</option><option>其他</option></select></label><div class="form-message" id="waste-error" role="alert"></div><button class="button primary" type="submit">确认处理</button></form></div>`);
  $('#waste-form').addEventListener('submit',event=>{event.preventDefault();const f=new FormData(event.target);const amount=parseQuantity(f.get('amount'));if(!(amount>0)||amount>item.value)return $('#waste-error').textContent=`处理数量需大于 0，且不超过 ${qty(item.value)}${item.unit}。`;item.value-=amount;state.records.unshift({id:Date.now(),stockId:item.id,name:item.name,amount,unit:item.unit,reason:f.get('reason'),restored:false});closeDialog();render();toast('已处理，可从全局记录找回','leaf');});
}
function recordsDialog() {
  openDialog(`<div class="dialog-body">${dialogHeading('变质 / 损坏记录','全部处理记录都留在这里。')}${state.records.length?state.records.map(record=>`<article class="record"><div class="between"><strong>${escapeHtml(record.name)} · ${qty(record.amount)}${escapeHtml(record.unit)}</strong><span class="status">${record.restored?'已撤销':record.reason}</span></div><p>本次预览中的处理</p>${!record.restored?`<button class="text-button" data-action="restore-waste" data-id="${record.id}">撤销这次处理</button>`:''}</article>`).join(''):`<div class="empty-state">${art('leaf')}<h2>暂时没有处理记录</h2><p>处理过的食材会出现在这里。</p></div>`}</div>`);
}
function restoreWaste(id) {
  const record=state.records.find(r=>r.id===Number(id)); const item=findStock(record.stockId);
  openDialog(`<div class="dialog-body">${dialogHeading('核对恢复库存',escapeHtml(item.name))}<div class="rule-note">现有 ${qty(item.value)}${item.unit} ＋ 恢复 ${qty(record.amount)}${record.unit}</div><div class="detail-quantity">${qty(item.value+record.amount)}<small>${item.unit}</small></div><button class="button primary" id="restore-waste-save">确认恢复</button></div>`);
  $('#restore-waste-save').addEventListener('click',()=>{if(record.restored)return;item.value+=record.amount;record.restored=true;render();recordsDialog();toast('本次处理已撤销','pantry');});
}
function startReview(id) {
  const menu=findMenu(id); state.review=structuredClone(menu);
  state.review.dishes.forEach(dish=>dish.materials.forEach(item=>{item.actual=item.amount;})); renderReview();
}
function renderReview() {
  const review=state.review;
  openDialog(`<div class="dialog-body">${dialogHeading('核对这一餐的用料',`${review.date} · ${review.period}`)}${review.dishes.map((dish,di)=>`<section class="review-dish"><h3>${escapeHtml(dish.name)}</h3>${dish.materials.map((item,mi)=>{const stock=findStock(item.id);return `<div class="review-line" data-review-line="${di}-${mi}"><div class="review-row"><div><strong>${escapeHtml(stock?.name||item.name||'原食材')}</strong><span class="note">${stock?`库存 ${qty(stock.value)}${escapeHtml(stock.unit)} · 计划 ${escapeHtml(item.amount||'未填')}${item.amount?escapeHtml(stock.unit):''}`:'待购买 · 尚未关联库存'}</span></div>${stock?`<label class="amount"><span class="sr-only">${escapeHtml(dish.name)}的${escapeHtml(stock.name)}实际用量</span><input data-review-input="${di}-${mi}" inputmode="text" value="${escapeHtml(item.actual)}"><small>${escapeHtml(stock.unit)}</small></label>`:`<button class="button small" data-action="pending-purchase" data-name="${escapeHtml(item.name)}">去补货</button>`}</div><div class="row-feedback" id="feedback-${di}-${mi}"></div></div>`;}).join('')}</section>`).join('')}<div id="review-summary" class="note" aria-live="polite"></div></div><div class="dialog-footer"><button class="text-button" data-action="arrange" data-id="${review.id}">返回调整菜单</button><button class="button primary" id="confirm-meal">确认完成</button></div>`);
  $('[data-review-input]')?.focus();
  $('#dialog-content').querySelectorAll('[data-review-input]').forEach(input=>input.addEventListener('input',()=>{const [di,mi]=input.dataset.reviewInput.split('-').map(Number);review.dishes[di].materials[mi].actual=input.value;checkReview();}));
  $('#confirm-meal').addEventListener('click',()=>{if(!checkReview())return;const original=findMenu(review.id);for(const dish of review.dishes)for(const item of dish.materials){const stock=findStock(item.id);stock.value=Number((stock.value-parseQuantity(item.actual)).toFixed(6));item.amount=item.actual;item.unit=stock.unit;item.name=stock.name;}Object.assign(original,{done:true,dishes:review.dishes});closeDialog();render();toast('这一餐已完成，已留在历史里');});
  checkReview();
}
function checkReview() {
  const review=state.review;const totals={};let invalid=0;const needs=new Set();
  for(const item of allMaterials(review)){const value=parseQuantity(item.actual);if(item.id&&Number.isFinite(value))totals[item.id]=(totals[item.id]||0)+value;}
  review.dishes.forEach((dish,di)=>dish.materials.forEach((item,mi)=>{
    const stock=findStock(item.id);const value=parseQuantity(item.actual);const feedback=$(`#feedback-${di}-${mi}`);const input=$(`[data-review-input="${di}-${mi}"]`);let message='';
    if(!stock){needs.add(item.name);message='补货后，回到菜单关联这份食材。';}
    else if(!Number.isFinite(value)||value<0){invalid++;message=item.actual.trim()?'填写数字或分数，例如 1/2；没用到可填 0。':'请填写本次实际用量。';}
    else if(totals[item.id]>stock.value+0.0000001){needs.add(stock.name);message=`${escapeHtml(stock.name)}库存只有 ${qty(stock.value)}${escapeHtml(stock.unit)}，本餐合计用了 ${qty(totals[item.id])}${escapeHtml(stock.unit)}。<button class="text-button" data-action="review-stock" data-id="${stock.id}">去库存处理</button>`;}
    feedback.innerHTML=message;if(input){input.setAttribute('aria-invalid',String(!Number.isFinite(value)||value<0));input.closest('.amount').classList.toggle('invalid',!Number.isFinite(value)||value<0);}
  }));
  const valid=!invalid&&!needs.size;
  $('#confirm-meal').disabled=!valid;$('#review-summary').textContent=valid?'确认后，按实际用量更新库存。':invalid?'补齐实际用量后即可继续。':`先处理 ${[...needs].join('、')}，再完成这一餐。`;
  return valid;
}
function arrange(id,planIndex,copyId) {
  state.editor=id?structuredClone(findMenu(id)):{id:null,date:'2026-09-13',period:'晚餐',done:false,dishes:(planIndex!==undefined?state.plans[planIndex].dishes:copyId?findMenu(copyId).dishes.map(d=>d.name):[]).map(name=>({name,materials:[]}))}; renderEditor();
}
function renderEditor() {
  const editor=state.editor;
  openDialog(`<div class="dialog-body">${dialogHeading(editor.id?'调整这一餐':'安排一餐','选好菜，再记下这次要用的食材。')}<div class="field-grid"><label class="field"><span>日期</span><input type="date" id="menu-date" value="${editor.date}"></label><label class="field"><span>餐次</span><select id="menu-period">${['早餐','午餐','晚餐'].map(p=>`<option ${p===editor.period?'selected':''}>${p}</option>`).join('')}</select></label></div><div class="between"><h3 class="form-section-title">这餐吃什么</h3><button class="text-button" data-action="new-dish-in-menu">＋ 新菜名</button></div><div class="choices">${state.dishes.map((name,index)=>`<button class="pill ${editor.dishes.some(d=>d.name===name)?'active':''}" data-action="choose-dish" data-index="${index}" aria-pressed="${editor.dishes.some(d=>d.name===name)}">${editor.dishes.some(d=>d.name===name)?'✓ ':''}${escapeHtml(name)}</button>`).join('')}</div>${editor.dishes.map((dish,di)=>`<section class="editor-dish"><div class="between"><h3>${escapeHtml(dish.name)}</h3><small class="muted">本餐用料</small></div>${dish.materials.map((item,mi)=>`<div class="material-row">${item.id!==null?`<select class="input" data-material="${di}-${mi}" aria-label="${escapeHtml(dish.name)}的第${mi+1}种食材"><option value="">选择库存食材</option>${state.stock.filter(s=>s.value>0||s.id===item.id).map(s=>`<option value="${s.id}" ${s.id===item.id?'selected':''}>${escapeHtml(s.name)} · 余 ${qty(s.value)}${escapeHtml(s.unit)}</option>`).join('')}</select>`:`<input class="input" data-pending-name="${di}-${mi}" aria-label="待购买食材名称" placeholder="要买什么" value="${escapeHtml(item.name)}">`}<label class="amount"><span class="sr-only">${escapeHtml(dish.name)}的第${mi+1}种食材预计用量</span><input data-planned="${di}-${mi}" value="${escapeHtml(item.amount)}" placeholder="预计量"><small>${escapeHtml(findStock(item.id)?.unit||'')}</small></label><button class="icon-button" data-action="remove-material" data-di="${di}" data-mi="${mi}" aria-label="移除这项食材">${icon('close')}</button></div>${item.id===null?'<p class="note">待购买</p>':''}`).join('')}<div class="add-material"><button class="text-button" data-action="add-material" data-di="${di}">＋ 库存食材</button><button class="text-button" data-action="add-pending" data-di="${di}">＋ 待购买食材</button></div></section>`).join('')}<div class="form-message" id="editor-error" role="alert"></div></div><div class="dialog-footer"><span class="note">保存安排，库存不变。</span><button class="button primary" id="save-menu">保存这一餐</button></div>`,{wide:true});
  $('#menu-date').addEventListener('change',event=>editor.date=event.target.value);$('#menu-period').addEventListener('change',event=>editor.period=event.target.value);
  editor.dishes.forEach((dish,di)=>dish.materials.forEach((item,mi)=>{
    if(item.id!==null)return;
    const match=state.stock.find(s=>s.value>0&&s.name===item.name);
    if(!match)return;
    const pendingInput=$(`[data-pending-name="${di}-${mi}"]`);
    pendingInput.closest('.material-row').insertAdjacentHTML('afterend',`<button type="button" class="text-button" data-action="associate-pending" data-di="${di}" data-mi="${mi}" data-id="${match.id}">关联已入库的${escapeHtml(match.name)} · ${qty(match.value)}${escapeHtml(match.unit)}</button>`);
  }));
  $('#dialog-content').querySelectorAll('[data-planned]').forEach(input=>input.addEventListener('input',()=>{const [di,mi]=input.dataset.planned.split('-').map(Number);editor.dishes[di].materials[mi].amount=input.value;}));
  $('#dialog-content').querySelectorAll('[data-pending-name]').forEach(input=>input.addEventListener('input',()=>{const [di,mi]=input.dataset.pendingName.split('-').map(Number);editor.dishes[di].materials[mi].name=input.value;}));
  $('#dialog-content').querySelectorAll('[data-material]').forEach(select=>select.addEventListener('change',()=>{const [di,mi]=select.dataset.material.split('-').map(Number);editor.dishes[di].materials[mi].id=select.value?Number(select.value):'';renderEditor();}));
  $('#save-menu').addEventListener('click',()=>{
    const error=$('#editor-error'); if(!editor.date||!editor.dishes.length)return error.textContent='请选择日期和至少一道菜。';
    const duplicate=state.menus.find(m=>m.date===editor.date&&m.period===editor.period&&m.id!==editor.id);if(duplicate)return error.innerHTML=`这天的${escapeHtml(editor.period)}已经安排过了。<button class="text-button" data-action="arrange" data-id="${duplicate.id}">查看已有安排</button>`;
    for(const dish of editor.dishes){if(!dish.materials.length||dish.materials.some(m=>m.id===''||(m.id===null&&!m.name?.trim())))return error.textContent=`请为${dish.name}选好食材。`;const ids=new Set();for(const item of dish.materials){const key=item.id||item.name.trim();if(ids.has(key))return error.textContent=`${dish.name}里有重复食材，请合为一项。`;ids.add(key);if(item.id&&item.amount.trim()&&!Number.isFinite(parseQuantity(item.amount)))return error.textContent=`${dish.name}的预计量请填数字或分数。`;}}
    if(editor.id)Object.assign(findMenu(editor.id),structuredClone(editor));else state.menus.push({...structuredClone(editor),id:Date.now()});state.scene='normal';state.page='menu';closeDialog();render();toast('这一餐已记好');
  });
}
function batchDialog(single=false,names=[]) {
  state.batch={single,category:'蔬菜',location:'冷藏',unit:'个',rows:Array.from({length:single?1:3},(_,i)=>({name:names[i]||'',amount:'',unit:'个'}))};renderBatch();
}
function renderBatch() {
  const batch=state.batch;
  openDialog(`<div class="dialog-body">${dialogHeading(batch.single?'记下一份食材':'一袋食材，一起记下',batch.single?'':'填了几行，就记几样。')}<div class="field-grid triple"><label class="field"><span>${batch.single?'类别':'这一批的类别'}</span><select id="batch-category">${categories.map(c=>`<option ${c===batch.category?'selected':''}>${c}</option>`).join('')}</select></label><label class="field"><span>存放位置</span><select id="batch-location"><option value="">未设置</option>${locations.map(l=>`<option ${l===batch.location?'selected':''}>${l}</option>`).join('')}</select></label><label class="field"><span>常用单位</span><select id="batch-unit">${[...new Set([...units[batch.category],batch.unit])].map(u=>`<option ${u===batch.unit?'selected':''}>${u}</option>`).join('')}</select></label></div><div class="batch-head"><span></span><span>食材名称</span><span>数量</span><span>单位</span><span></span></div>${batch.rows.map((row,index)=>`<div class="batch-row"><span class="row-number">${index+1}</span><input class="input" data-batch-row="${index}" data-key="name" value="${escapeHtml(row.name)}" aria-label="第${index+1}行食材名称" placeholder="${index===0?'例如 胡萝卜':'食材名称'}"><input class="input" data-batch-row="${index}" data-key="amount" value="${escapeHtml(row.amount)}" aria-label="第${index+1}行数量" placeholder="数量"><input class="input" data-batch-row="${index}" data-key="unit" value="${escapeHtml(row.unit)}" aria-label="第${index+1}行单位" list="suggested-units"><button class="icon-button" data-action="clear-batch-row" data-index="${index}" aria-label="清空第${index+1}行">${icon('close')}</button></div>`).join('')}<datalist id="suggested-units">${units[batch.category].map(u=>`<option value="${u}">`).join('')}</datalist>${!batch.single?'<button class="text-button" data-action="add-batch-row">＋ 再加一行</button>':''}<div class="form-message" id="batch-error" role="alert"></div></div><div class="dialog-footer"><span class="note">${batch.single?'':'空白行自动忽略'}</span><button class="button primary" id="batch-save">${batch.single?'保存食材':'保存这一批'}</button></div>`,{wide:!batch.single});
  $('#batch-category').addEventListener('change',event=>{batch.category=event.target.value;renderBatch();});$('#batch-location').addEventListener('change',event=>batch.location=event.target.value);
  $('#batch-unit').addEventListener('change',event=>{const previous=batch.unit;batch.unit=event.target.value;batch.rows.forEach(row=>{if(!row.name&&!row.amount&&row.unit===previous)row.unit=batch.unit;});renderBatch();});
  $('#dialog-content').querySelectorAll('[data-batch-row]').forEach(input=>input.addEventListener('input',()=>batch.rows[Number(input.dataset.batchRow)][input.dataset.key]=input.value));
  $('#batch-save').addEventListener('click',prepareBatch);
}
function prepareBatch() {
  const batch=state.batch;const rows=batch.rows.filter(row=>row.name.trim()||row.amount.trim());const error=$('#batch-error');
  if(!rows.length)return error.textContent='先填一份食材吧。';
  const names=new Set();for(const row of rows){if(!row.name.trim()||!row.unit.trim()||!(parseQuantity(row.amount)>0))return error.textContent='已填写的行需要名称、单位和大于 0 的数量。';const name=row.name.trim().toLowerCase();if(names.has(name))return error.textContent=`${row.name}填了两次，请合为一行。`;names.add(name);}
  const conflicts=rows.map(row=>({row,existing:state.stock.find(item=>item.value>0&&item.name.toLowerCase()===row.name.trim().toLowerCase())})).filter(({row,existing})=>existing&&(existing.unit!==row.unit.trim()||existing.category!==batch.category));
  if(conflicts.length)return batchConflicts(rows,conflicts);commitBatch(rows,[]);
}
const conversion = (value,from,to) => {const family={g:['mass',1],kg:['mass',1000],斤:['mass',500],ml:['volume',1],L:['volume',1000]};if(from===to)return value;if(family[from]&&family[to]&&family[from][0]===family[to][0])return value*family[from][1]/family[to][1];return NaN;};
function batchConflicts(rows,conflicts) {
  conflicts.forEach(c=>{c.category=c.existing.category;c.unit=c.existing.unit;c.value='';});
  openDialog(`<div class="dialog-body">${dialogHeading('同名食材，合在一起','选好类别和单位，只保留一份库存。')}${conflicts.map(({row,existing},index)=>`<section class="review-dish"><h3>${escapeHtml(existing.name)}</h3><p class="note">现有 ${qty(existing.value)}${escapeHtml(existing.unit)} · 本次 ${escapeHtml(row.amount)}${escapeHtml(row.unit)}</p><div class="field-grid" style="margin-top:14px"><label class="field"><span>最终类别</span><select data-conflict-category="${index}">${[...new Set([existing.category,state.batch.category])].map(c=>`<option>${c}</option>`).join('')}</select></label><label class="field"><span>统一单位</span><select data-conflict-unit="${index}">${[...new Set([existing.unit,row.unit])].map(u=>`<option>${escapeHtml(u)}</option>`).join('')}</select></label></div><label class="field"><span>合并后的库存量</span><input data-conflict-value="${index}" aria-label="${escapeHtml(existing.name)}合并后的库存量"><small id="conversion-note-${index}"></small></label></section>`).join('')}<div class="form-message" id="conflict-error" role="alert"></div></div><div class="dialog-footer"><button class="text-button" data-action="back-batch">返回修改</button><button class="button primary" id="save-conflicts">按选择保存</button></div>`);
  function refresh(index){const c=conflicts[index];const total=conversion(c.existing.value,c.existing.unit,c.unit)+conversion(parseQuantity(c.row.amount),c.row.unit,c.unit);c.value=Number.isFinite(total)?qty(total):'';$(`[data-conflict-value="${index}"]`).value=c.value;$(`#conversion-note-${index}`).textContent=Number.isFinite(total)?`已换算为 ${c.unit}，可核对修改。`:`请按实际库存填写最终的 ${c.unit} 数量。`;}
  conflicts.forEach((c,index)=>{refresh(index);$(`[data-conflict-unit="${index}"]`).addEventListener('change',event=>{c.unit=event.target.value;refresh(index);});$(`[data-conflict-category="${index}"]`).addEventListener('change',event=>c.category=event.target.value);$(`[data-conflict-value="${index}"]`).addEventListener('input',event=>c.value=event.target.value);});
  $('#save-conflicts').addEventListener('click',()=>{if(conflicts.some(c=>!(parseQuantity(c.value)>0)))return $('#conflict-error').textContent='请补齐每份食材合并后的库存量。';commitBatch(rows,conflicts);});
}
function commitBatch(rows,conflicts) {
  for(const row of rows){const existing=state.stock.find(item=>item.value>0&&item.name.toLowerCase()===row.name.trim().toLowerCase());const conflict=conflicts.find(c=>c.row===row);if(conflict)Object.assign(existing,{value:parseQuantity(conflict.value),unit:conflict.unit,category:conflict.category});else if(existing)existing.value+=parseQuantity(row.amount);else state.stock.push({id:Date.now()+Math.random(),name:row.name.trim(),value:parseQuantity(row.amount),unit:row.unit.trim(),category:state.batch.category,location:state.batch.location});}
  state.scene='normal';state.page='stock';state.category='全部';state.location='全部';render();
  if(state.review&&allMaterials(state.review).some(m=>!m.id)){openDialog(`<div class="dialog-body">${dialogHeading('食材记好了','回到原来那餐，明确关联刚入库的食材。')}<button class="button primary" data-action="link-pending">回到餐安排</button></div>`);}else closeDialog();toast(`已记录 ${rows.length} 份食材`);
}
function nameEditor(index,inMenu=false) {
  const editing=index!==undefined;openDialog(`<div class="dialog-body">${dialogHeading(editing?'编辑菜名':'记一道喜欢的菜')}<form id="dish-form"><label class="field"><span>菜品名称</span><input name="name" value="${escapeHtml(editing?state.dishes[index]:'')}" placeholder="例如 蒜蓉生菜" required></label><div class="form-message" id="dish-error" role="alert"></div><button class="button primary" type="submit">${inMenu?'加入这一餐':'保存菜名'}</button></form></div>`);
  $('#dish-form').addEventListener('submit',event=>{event.preventDefault();const name=new FormData(event.target).get('name').trim();if(!name)return;const duplicate=state.dishes.findIndex(d=>d===name);if(duplicate>=0&&duplicate!==index)return $('#dish-error').textContent='这道菜已经记过了，直接选择就好。';if(editing)state.dishes[index]=name;else state.dishes.push(name);if(inMenu){state.editor.dishes.push({name,materials:[]});renderEditor();}else{state.scene='normal';closeDialog();render();toast('菜名已记下');}});
}
function planEditor(index) {
  const existing=state.plans[index];const selected=new Set(existing?.dishes||[]);
  openDialog(`<div class="dialog-body">${dialogHeading(existing?'编辑常用搭配':'存一份常用搭配')}<form id="plan-form"><label class="field"><span>搭配名称</span><input name="name" value="${escapeHtml(existing?.name||'')}" required></label><h3 class="form-section-title">放进哪几道菜</h3><div class="choices">${state.dishes.map((d,i)=>`<button type="button" class="pill ${selected.has(d)?'active':''}" data-plan-dish="${i}" aria-pressed="${selected.has(d)}">${escapeHtml(d)}</button>`).join('')}</div><div class="form-message" id="plan-error" role="alert"></div><button class="button primary" type="submit">保存搭配</button></form></div>`);
  $('#dialog-content').querySelectorAll('[data-plan-dish]').forEach(btn=>btn.addEventListener('click',()=>{const name=state.dishes[Number(btn.dataset.planDish)];if(selected.has(name))selected.delete(name);else selected.add(name);btn.classList.toggle('active',selected.has(name));btn.setAttribute('aria-pressed',String(selected.has(name)));}));
  $('#plan-form').addEventListener('submit',event=>{event.preventDefault();const name=new FormData(event.target).get('name').trim();if(!selected.size)return $('#plan-error').textContent='至少选一道菜。';const dishes=[...selected];if(state.plans.some((p,i)=>i!==index&&(p.name===name||JSON.stringify([...p.dishes].sort())===JSON.stringify([...dishes].sort()))))return $('#plan-error').textContent='这份名称或菜品组合已经存在，使用原来的搭配就好。';const next={name,dishes};if(existing)state.plans[index]=next;else state.plans.push(next);closeDialog();render();toast('搭配已保存');});
}
function designGuide() {
  openDialog(`<div class="dialog-body guide">${dialogHeading('小厨房的拙趣日常','棉纸的温度，食物的肌理，有动作的小人物。','DESIGN DIRECTION 05')}<p>本轮加入真正透明的插画与可切换候选库；点顶部“插画库”或搭配上的“换张插画”，可在棉纸、深色、透明格背景中比较。全站融入原创黑线小人、拟真食物拼贴、棉纸纤维与轻餐布纹理。餐安排、库存、菜品各有一幅生活小场景；弹窗、空态、加载与完成反馈使用同一套线稿语言。点击页头插画可播放短动作，顶部可暂停动效，并跟随系统减少动态效果。</p><div class="swatches">${[['棉纸','#FCF9F0'],['主绿','#526C54'],['正文','#2D4135'],['陶红','#A56446'],['布面','#E5E9D9']].map(([name,color])=>`<div class="swatch"><b style="background:${color}"></b>${name}<br>${color}</div>`).join('')}</div><ul><li><strong>库存：</strong>名字＋数量，类别分组；点开才见位置和处理入口。</li><li><strong>餐安排：</strong>待完成在上，历史在下。缺货能保留安排，核对时就地引导。</li><li><strong>核对：</strong>一份食材只填一个实际量，库存始终只读。</li><li><strong>菜品：</strong>菜名与常用搭配。封面插画只作设计候选，菜品图不是实际出餐照片。</li></ul><p>可点击导航、筛选、食材详情、单个/批量录入、同名合并、安排与核对。顶部可切换空数据、加载和错误示意；右上角切换日间与夜间。</p><p class="rule-note">本页是独立设计原型。所有数字均为示例，操作只影响本页内存；刷新可还原。它不代表真实接口、并发或事务已经验证。</p><p><a href="iteration-05.md" download>下载本轮设计说明 ↓</a> · <a href="https://www.xiaohongshu.com/explore/6a7ae50b0000000005030846" target="_blank" rel="noopener">参考原帖 ↗</a></p></div>`,{wide:true});
}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target)return;
  const {action,id,index,di,mi,value,page,name}=target.dataset;
  if(action==='nav'){state.page=page;state.review=null;render();window.scrollTo({top:0});}
  else if(action==='retry'){state.scene='normal';$('#scene-select').value='normal';render();}
  else if(action==='detail')stockDetail(id);
  else if(action==='edit-stock')stockEditor(id);
  else if(action==='waste')wasteDialog(id);
  else if(action==='records')recordsDialog();
  else if(action==='restore-waste')restoreWaste(id);
  else if(action==='location'){state.location=value;render();}
  else if(action==='category'){state.category=value;render();}
  else if(action==='clear-filters'){state.location=state.category='全部';state.search='';render();}
  else if(action==='catalog-tab'){state.catalogTab=value;render();}
  else if(action==='single'||action==='batch'){state.review=null;batchDialog(action==='single');}
  else if(action==='review')startReview(id);
  else if(action==='review-stock'){state.page='stock';state.scene='normal';render();stockEditor(id,true);}
  else if(action==='back-review'){state.page='menu';render();renderReview();}
  else if(action==='pending-purchase')batchDialog(false,[name]);
  else if(action==='link-pending'){const review=state.review;state.page='menu';render();arrange(review.id);}
  else if(action==='associate-pending'){const item=state.editor.dishes[Number(di)].materials[Number(mi)];const stock=findStock(id);const amount=item.amount.trim();const bare=amount.endsWith(stock.unit)?amount.slice(0,-stock.unit.length).trim():amount;item.id=stock.id;item.amount=Number.isFinite(parseQuantity(bare))?bare:'';renderEditor();}
  else if(action==='arrange')arrange(id);
  else if(action==='copy-menu')arrange(undefined,undefined,id);
  else if(action==='use-plan')arrange(undefined,Number(index));
  else if(action==='choose-dish'){const dishName=state.dishes[Number(index)];const found=state.editor.dishes.findIndex(d=>d.name===dishName);if(found>=0)state.editor.dishes.splice(found,1);else state.editor.dishes.push({name:dishName,materials:[]});renderEditor();}
  else if(action==='add-material'||action==='add-pending'){state.editor.dishes[Number(di)].materials.push(action==='add-material'?{id:'',amount:''}:{id:null,name:'',amount:''});renderEditor();}
  else if(action==='remove-material'){state.editor.dishes[Number(di)].materials.splice(Number(mi),1);renderEditor();}
  else if(action==='add-batch-row'){state.batch.rows.push({name:'',amount:'',unit:state.batch.unit});renderBatch();}
  else if(action==='clear-batch-row'){state.batch.rows[Number(index)]={name:'',amount:'',unit:state.batch.unit};renderBatch();}
  else if(action==='back-batch')renderBatch();
  else if(action==='new-dish')nameEditor();
  else if(action==='edit-dish')nameEditor(Number(index));
  else if(action==='new-dish-in-menu')nameEditor(undefined,true);
  else if(action==='new-plan')planEditor();
  else if(action==='edit-plan')planEditor(Number(index));
  else if(action==='history-recovery')openDialog(`<div class="dialog-body">${dialogHeading('核对恢复库存')}<p>正式页面在这里读取最新库存，展示可恢复的数量或合并处理。</p><p class="preview-only">当前仅展示入口位置；这一复杂事务流程保留既有后端实现，设计原型不模拟安全校验。</p>${button('回到历史','close')}</div>`);
  else if(action==='close')closeDialog();
});
document.addEventListener('input',event=>{if(event.target.id==='stock-search'){state.search=event.target.value;$('#stock-groups').innerHTML=stockGroups();}});
$('#scene-select').addEventListener('change',event=>{state.scene=event.target.value;render();});
$('#theme-button').addEventListener('click',()=>{const dark=document.body.classList.toggle('dark');$('#theme-button').setAttribute('aria-label',`切换${dark?'浅':'深'}色主题`);});
$('#guide-button').addEventListener('click',designGuide);
$('.brand').addEventListener('click',event=>{event.preventDefault();state.page='menu';state.review=null;render();window.scrollTo({top:0});});
window.PantryIllustrations.bind({ page:()=>state.page, planNames:()=>state.plans.map(plan=>plan.name), showTarget(target) { state.page=target.startsWith('plan-')?'catalog':target; if(target.startsWith('plan-'))state.catalogTab='plans';state.scene='normal'; }, render, toast });
render();
