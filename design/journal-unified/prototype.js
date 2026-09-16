// 独立设计稿，所有记录只在内存中演示；不请求任何业务 API。
const $ = id => document.getElementById(id);
const paths = {
  pantry:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 10h14M9 6v1m0 7v3"/>',
  bowl:'<path d="M3 11h18c0 6-3 9-9 9s-9-3-9-9ZM9 7c-2-2 2-2 0-4m6 4c-2-2 2-2 0-4"/>',
  camera:'<path d="M3 6h4l2-3h6l2 3h4v15H3Z"/><circle cx="12" cy="13" r="4"/>',
  book:'<path d="M4 5a2 2 0 0 1 2-2h14v17H6a2 2 0 0 0-2 2V5Zm0 13a2 2 0 0 1 2-2h14M8 7h8m-8 4h5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon:'<path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z"/>',
  refresh:'<path d="M20 11a8 8 0 1 0-2 7M20 4v7h-7"/>',
  left:'<path d="m15 5-7 7 7 7"/>',right:'<path d="m9 5 7 7-7 7"/>',check:'<path d="m5 12 4 4L19 6"/>'
};
const icon = name => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.camera}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let seq=0;
let newDraft=null, saveCommitted=false;
const sample = (n,offset=0) => Array.from({length:n},(_,i)=>({id:++seq,src:`/samples/${(i+offset)%5}.jpg`,name:`饭桌照片 ${i+1}`}));
const initial = () => [
  {id:1,date:'2026-09-16',caption:'热气还没散，就先留下一张。',photos:sample(3)},
  {id:2,date:'2026-09-15',caption:'两个人的饭，刚刚好。',photos:sample(1,3)},
  {id:3,date:'2026-09-13',caption:'简单做，慢慢吃。',photos:sample(1,4)}
];
let entries=initial(), draft=[], cover=null, editing=null, removed=null, undoTimer, toastTimer, candidates=[], chosen=new Set(), replacing=null, deleting=null, viewEntry=null, viewIndex=0, opener=null, failure=false;
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function openDialog(id){opener=document.activeElement;$(id).showModal();}
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',()=>{opener?.focus();if(dialog.id==='composer'){if(!editing&&!saveCommitted)newDraft={photos:draft.map(p=>({...p})),cover,date:$('entry-date').value,caption:$('caption').value};clearTimeout(undoTimer);$('undo').hidden=true;}}));
// 只滚动编辑器内部，避免 scrollIntoView 连带移动整个弹窗。
function scrollComposerTo(element){
  if(!$('composer').open)return;
  const scroller=$('composer').querySelector('.composer-scroll');
  const target=element.getBoundingClientRect(),bounds=scroller.getBoundingClientRect();
  scroller.scrollTop+=target.top-bounds.top-8;
}
function showError(message){$('form-error').textContent=message;$('form-error').hidden=!message;if(message)scrollComposerTo($('form-error'));}
const composerFooter=$('composer').querySelector('.composer-footer');
const normalFooterActions=$('save').parentElement;
const candidateFooterActions=$('candidate-section').querySelector('.candidate-actions');
composerFooter.append(candidateFooterActions);
candidateFooterActions.hidden=true;
function updateComposerFooter(){
  const picking=candidates.length>0;
  normalFooterActions.hidden=picking;candidateFooterActions.hidden=!picking;
  $('composer').classList.toggle('is-picking',picking);
  if(picking){$('save-note').textContent=`已选 ${chosen.size} / ${9-draft.length} 张 · 加入后继续整理`;
    $('confirm-candidates').textContent=`加入所选 ${chosen.size} 张`;
    $('cancel-candidates').textContent='返回整理';
  }
}
// 通过照片真实尺寸决定版式，示例与用户选图都按同一规则处理。
function applyPhotoOrientations(){
  $('entries').querySelectorAll('.journal-print img').forEach(img=>{
    const apply=()=>{
      if(!img.naturalWidth||!img.naturalHeight)return;
      const figure=img.closest('.journal-print'),ratio=img.naturalWidth/img.naturalHeight;
      figure.classList.toggle('is-portrait',ratio<.9);
      figure.classList.toggle('is-landscape',ratio>1.1);
      figure.style.setProperty('--photo-ratio',String(ratio));
      if(figure===figure.parentElement.firstElementChild)figure.parentElement.classList.toggle('has-portrait-cover',ratio<.9);
    };
    if(img.complete)apply();else img.addEventListener('load',apply,{once:true});
  });
}
function stateMarkup(kind){
  if(kind==='loading')return '<div class="empty-state" role="status"><p>正在翻开饭桌手记…</p><div class="loading-lines" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div></div></div>';
  if(kind==='error')return `<div class="empty-state" role="alert"><h2>这页手记，暂时没能打开。</h2><p>请检查网络连接后，再试一次。</p><button class="btn-primary" data-retry>重新打开</button></div>`;
  return `<div class="empty-state"><img src="/assets/table-memories.png" alt=""><h2>${$('month').value?'这个月，还没有留下照片。':'第一张照片，留给下一餐。'}</h2><p>刚出锅的菜、摆好的碗筷，<br>都是值得收藏的小日常。</p><button class="btn-primary" data-create>${icon('plus')}记下一餐</button></div>`;
}
function render(){
  const filtered=entries.filter(e=>!$('month').value||e.date.startsWith($('month').value));
  $('total').textContent=`· ${filtered.length} 篇手记`;$('all-months').hidden=!$('month').value;
  const state=$('state').value;
  if(state!=='normal'||!filtered.length){$('entries').innerHTML=stateMarkup(state==='normal'?'empty':state);return;}
  let month='';
  $('entries').innerHTML=filtered.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(entry=>{
    const current=entry.date.slice(0,7),heading=month!==current?`<div class="album-month"><h2>${current.slice(0,4)} 年 ${Number(current.slice(5))} 月</h2><span>把日常，慢慢收藏</span></div>`:'';month=current;
    return `${heading}<article class="album-entry ${entry.photos.length===1?'single':''}"><div class="entry-note"><div class="entry-date">${entry.date.slice(-2)}</div><time datetime="${entry.date}">${new Date(entry.date+'T12:00:00').toLocaleDateString('zh-CN',{weekday:'long'})}</time><p>${escapeHtml(entry.caption||'这一餐，也值得留下来。')}</p><span class="note-line" aria-hidden="true">﹏</span></div><div class="journal-photo-story story-count-${entry.photos.length}">${entry.photos.map((photo,i)=>`<figure class="journal-print"><button class="journal-image-button" data-view="${entry.id}" data-index="${i}" aria-label="查看 ${entry.date} 第 ${i+1} 张照片"><img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.name)}" loading="lazy"></button><figcaption><span>${i===0?'这一餐，记住了。':'日常一瞬'}</span><small>${String(i+1).padStart(2,'0')} / ${String(entry.photos.length).padStart(2,'0')}</small></figcaption></figure>`).join('')}</div><div class="entry-actions"><span class="entry-count">${entry.photos.length} 张照片</span><button class="text-button open-entry" data-view="${entry.id}">翻开这篇 ↗</button><button class="text-button" data-edit="${entry.id}">编辑</button><button class="text-button danger" data-delete="${entry.id}">删除</button></div></article>`;
  }).join('');
  applyPhotoOrientations();
}
$('entries').onclick=e=>{const el=e.target.closest('button');if(!el)return;if(el.hasAttribute('data-create'))openComposer();if(el.hasAttribute('data-retry')){$('state').value='normal';render();}if(el.dataset.edit)openComposer(entries.find(x=>x.id===Number(el.dataset.edit)));if(el.dataset.view){viewEntry=entries.find(x=>x.id===Number(el.dataset.view));viewIndex=Number(el.dataset.index||0);renderViewer();openDialog('viewer');}if(el.dataset.delete){deleting=Number(el.dataset.delete);openDialog('delete-dialog');}};
function openComposer(entry){editing=entry?.id||null;saveCommitted=false;draft=(entry?.photos||newDraft?.photos||[]).map(p=>({...p}));cover=entry?draft[0]?.id||null:newDraft?.cover||null;removed=null;candidates=[];chosen.clear();failure=false;$('candidate-section').hidden=true;$('selection-section').hidden=false;$('composer-title').textContent=entry?'编辑这篇手记':'记下一餐';$('entry-date').value=entry?.date||newDraft?.date||'2026-09-16';$('caption').value=entry?entry.caption:newDraft?.caption||'';$('composer').querySelector('.composer-footer [data-close]').textContent=entry?'取消编辑':'稍后再记';$('save').textContent=entry?'保存修改':'保存手记';showError('');$('undo').hidden=true;renderDraft();openDialog('composer');$('composer').scrollTop=0;$('composer').querySelector('.composer-scroll').scrollTop=0;}
function renderDraft(){
  $('selection-count').textContent=`已选 ${draft.length} / 9 张`;
  $('save').disabled=!draft.length||!cover||candidates.length>0;
  $('save-note').textContent=draft.length&&!cover?'请点选一张照片作为封面。':(editing?'保存后更新原记录。':'关闭保留草稿，刷新后清空。');
  updateComposerFooter();
  $('draft-grid').innerHTML=draft.map(p=>`<div class="draft-photo ${p.id===cover?'is-cover':''}"><button class="cover-choice" data-cover="${p.id}" aria-label="选择${escapeHtml(p.name)}为封面" aria-pressed="${p.id===cover}"><img src="${escapeHtml(p.src)}" alt="${escapeHtml(p.name)}"></button><button class="icon-button photo-remove" data-remove="${p.id}" aria-label="移除${escapeHtml(p.name)}">${icon('close')}</button><div class="photo-tools"><span>${p.id===cover?'✓ 当前封面':''}</span><button class="text-button" data-replace="${p.id}">替换</button></div></div>`).join('');
}
$('draft-grid').onclick=e=>{const el=e.target.closest('button');if(!el)return;if(el.dataset.cover){cover=Number(el.dataset.cover);renderDraft();}if(el.dataset.remove){const index=draft.findIndex(p=>p.id===Number(el.dataset.remove));removed={photo:draft[index],index,wasCover:draft[index].id===cover};draft.splice(index,1);if(removed.wasCover)cover=null;$('undo').hidden=false;clearTimeout(undoTimer);undoTimer=setTimeout(()=>{removed=null;$('undo').hidden=true;},8000);renderDraft();}if(el.dataset.replace){replacing=Number(el.dataset.replace);$('replacement').click();}};
$('undo-remove').onclick=()=>{if(!removed)return;if(draft.length>=9){showError('已经选满 9 张，请先移除一张再撤销。');return;}draft.splice(removed.index,0,removed.photo);if(removed.wasCover&&!cover)cover=removed.photo.id;removed=null;clearTimeout(undoTimer);$('undo').hidden=true;renderDraft();};
function addPhotos(photos){if(!photos.length)return;if(photos.length+draft.length<=9){draft.push(...photos);if(draft.length===photos.length)cover=photos[0].id;renderDraft();return;}candidates=photos;chosen=new Set();$('candidate-section').hidden=false;$('selection-section').hidden=true;renderCandidates();renderDraft();scrollComposerTo($('candidate-section'));}
function renderCandidates(){const slots=9-draft.length;$('candidate-description').textContent=`本次带来 ${candidates.length} 张，还可以加入 ${slots} 张。已选 ${chosen.size} 张，请挑选后再加入。`;$('candidate-grid').innerHTML=candidates.map((p,i)=>`<button class="candidate-choice ${chosen.has(p.id)?'selected':''}" data-candidate="${p.id}" aria-pressed="${chosen.has(p.id)}"><img src="${escapeHtml(p.src)}" alt="候选照片 ${i+1}"><span>${chosen.has(p.id)?'✓ 已选择':`照片 ${i+1}`}</span></button>`).join('');$('confirm-candidates').disabled=!chosen.size;updateComposerFooter();}
$('candidate-grid').onclick=e=>{const el=e.target.closest('[data-candidate]');if(!el)return;const id=Number(el.dataset.candidate);if(chosen.has(id))chosen.delete(id);else if(chosen.size<9-draft.length)chosen.add(id);else{showError(`最多再选 ${9-draft.length} 张，可以先取消一张再换选。`);return;}showError('');renderCandidates();};
function closeCandidates(){candidates=[];chosen.clear();$('candidate-section').hidden=true;$('selection-section').hidden=false;renderDraft();}
$('cancel-candidates').onclick=closeCandidates;
$('confirm-candidates').onclick=()=>{const accepted=candidates.filter(p=>chosen.has(p.id));closeCandidates();addPhotos(accepted);showError('');};
async function readFiles(files){const photos=[],errors=[];for(const file of files){if(!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)){errors.push(`${file.name} 不是支持的照片格式。`);continue;}if(file.size>30*1024*1024){errors.push(`${file.name} 超过设计稿的 30 MB 预览限制。`);continue;}const src=URL.createObjectURL(file);const img=new Image();img.src=src;try{await img.decode();photos.push({id:++seq,src,name:file.name});}catch{URL.revokeObjectURL(src);errors.push(/\.hei[cf]$/i.test(file.name)?'设计稿没有 HEIC 转换服务，请用 JPG 体验；正式系统保留 HEIC 上传能力。':`${file.name} 无法读取为照片，请换一张。`);}}showError(errors.join(' '));return photos;}
$('choose').onclick=()=>$('files').click();$('files').onchange=async e=>{addPhotos(await readFiles(e.target.files));e.target.value='';};
$('replacement').onchange=async e=>{const photos=await readFiles([...e.target.files].slice(0,1));if(photos.length){const target=draft.findIndex(p=>p.id===replacing);if(target>=0){photos[0].id=replacing;draft[target]=photos[0];renderDraft();}}e.target.value='';};
['dragenter','dragover'].forEach(name=>$('dropzone').addEventListener(name,e=>{e.preventDefault();$('dropzone').classList.add('is-dragging');}));$('dropzone').ondragleave=()=>$('dropzone').classList.remove('is-dragging');$('dropzone').ondrop=async e=>{e.preventDefault();$('dropzone').classList.remove('is-dragging');addPhotos(await readFiles(e.dataTransfer.files));};
window.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();});window.addEventListener('drop',e=>{if(e.target.closest('#dropzone'))return;e.preventDefault();if(e.dataTransfer.files.length)toast('先打开“记下一餐”，再将照片拖到选图区。');});
$('sample3').onclick=()=>addPhotos(sample(3));$('sample12').onclick=()=>addPhotos(sample(12));$('save-failure').onclick=()=>{failure=false;showError('保存暂时失败，照片和文字已留在当前草稿中。请重试保存。');};
$('save').onclick=()=>{if(!draft.length||!cover)return;if(!$('entry-date').value){showError('请填写这餐的日期。');return;}if(failure){failure=false;showError('重试已就绪，请再次点击保存；草稿内容保持不变。');return;}const photos=[draft.find(p=>p.id===cover),...draft.filter(p=>p.id!==cover)];const entry={id:editing||Date.now(),date:$('entry-date').value,caption:$('caption').value.trim(),photos};if(editing)entries=entries.map(e=>e.id===editing?entry:e);else entries.unshift(entry);$('month').value='';$('state').value='normal';render();saveCommitted=true;if(!editing)newDraft=null;$('composer').close();toast(editing?'手记已更新（设计稿演示）。':'这一餐，已经留在日子里（设计稿演示）。');};
function renderViewer(){const p=viewEntry.photos[viewIndex];$('view-image').src=p.src;$('view-image').alt=p.name;$('viewer-date').textContent=viewEntry.date;$('viewer-count').textContent=`${viewIndex+1} / ${viewEntry.photos.length}`;$('viewer-caption').textContent=viewEntry.caption;$('download').href=p.src;$('download').download=/\.[a-z0-9]+$/i.test(p.name)?p.name:p.name+'.jpg';$('prev').disabled=viewIndex===0;$('next').disabled=viewIndex===viewEntry.photos.length-1;$('viewer-thumbs').innerHTML=viewEntry.photos.map((p,i)=>`<button data-slide="${i}" class="${i===viewIndex?'current':''}" aria-label="查看第 ${i+1} 张照片" aria-pressed="${i===viewIndex}"><img src="${escapeHtml(p.src)}" alt=""></button>`).join('');}
$('prev').onclick=()=>{if(viewIndex>0){viewIndex--;renderViewer();}};$('next').onclick=()=>{if(viewIndex<viewEntry.photos.length-1){viewIndex++;renderViewer();}};$('viewer-thumbs').onclick=e=>{const button=e.target.closest('[data-slide]');if(button){viewIndex=Number(button.dataset.slide);renderViewer();}};
$('viewer').addEventListener('keydown',e=>{if(e.key==='ArrowLeft')$('prev').click();if(e.key==='ArrowRight')$('next').click();});
let touchX=0;$('view-image').addEventListener('touchstart',e=>touchX=e.changedTouches[0].clientX,{passive:true});$('view-image').addEventListener('touchend',e=>{const delta=e.changedTouches[0].clientX-touchX;if(Math.abs(delta)>50)$(delta>0?'prev':'next').click();},{passive:true});
$('confirm-delete').onclick=()=>{entries=entries.filter(e=>e.id!==deleting);render();$('delete-dialog').close();toast('这篇手记已移除（设计稿演示）。');};
$('create').onclick=()=>openComposer();$('theme').onclick=()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';$('theme').innerHTML=icon(dark?'sun':'moon');};
document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>{['menu','inventory','catalog','journal'].forEach(name=>$(name+'-page').hidden=name!==button.dataset.page);document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-current',b===button?'page':'false');});});
document.addEventListener('click',event=>{if(event.target.closest('[data-reference]'))toast('这里是现有模块的只读视觉对照，完整操作请在正式测试入口体验。');});
$('month').onchange=render;$('all-months').onclick=()=>{$('month').value='';render();};$('state').onchange=render;$('photo-count').onchange=()=>{if(entries.length)entries[0].photos=sample(Number($('photo-count').value));$('state').value='normal';render();};$('refresh').onclick=()=>{render();toast('手记已刷新（设计稿演示）。');};$('reset').onclick=()=>{entries=initial();newDraft=null;$('month').value='';$('state').value='normal';$('photo-count').value='3';render();toast('已恢复示例内容。');};
render();
