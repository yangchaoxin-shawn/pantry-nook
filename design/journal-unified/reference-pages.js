/* 既有模块以真实线上截图为基准；本页不请求业务 API。 */
(() => {
  const names={menu:'餐安排',inventory:'库存',catalog:'菜品'};
  const notes={
    menu:['本轮保留','标题、入口和空状态沿用线上。核验时待做与历史均为空，因此不能把示例时间线当作线上验证结果。'],
    inventory:['让标题、操作和插画形成完整一组','线上插画确实偏小。建议适度放大，并将原有「单个记录 / 批量记录」放到说明下方；手机并排组织操作与插画，减少文字悬空。清单和筛选规则保持现有设计。'],
    catalog:['保留菜品簿，让菜名更好读','保持连续菜单纸、线迹和不同姿态的小人，调整短菜名所需宽度与装饰占比；长名称自然换行，编辑 / 删除仍保持原来的操作层级。']
  };
  let width=1440;
  function draw(){
    const theme=document.documentElement.dataset.theme==='light'?'light':'dark';
    for(const [name,label] of Object.entries(names)){
      const section=document.getElementById(name+'-page');
      const shot=(suffix)=>'/review-captures/'+name+'-'+width+'-'+theme+(suffix?'-'+suffix:'')+'.png';
      const frame=(title,src,kind)=>`<figure class="review-shot ${kind}"><figcaption>${title}<a href="${src}" target="_blank" rel="noopener">打开原尺寸 ↗</a></figcaption><div class="review-image-scroll"><img src="${src}" alt="${label} · ${title}" loading="lazy"></div></figure>`;
      section.innerHTML=`<div class="review-intro"><p class="eyebrow">线上基准 · 2026.09.17</p><h1>${label} · ${notes[name][0]}</h1><p>${notes[name][1]}</p><div class="review-device" role="group" aria-label="${label}对照尺寸"><button data-width="1440" aria-pressed="${width===1440}">桌面</button><button data-width="390" aria-pressed="${width===390}">手机</button><span>右上角可切换亮暗主题</span></div></div><div class="review-pair ${width===390?'review-phone':''} ${name==='menu'?'review-single':''}">${name==='menu'?frame('线上原样 · 本轮保留',shot(''),'baseline'):frame('线上原样',shot('before'),'baseline')+frame('建议效果 · 尚未上线',shot('after'),'proposal')}</div><p class="review-boundary">截图只读核验；建议效果是在同一线上页面的浏览器副本中临时调整排版后截图。没有修改线上代码或数据。${name==='menu'?'':'显示区可向下滚动查看，图片可打开原尺寸。'}</p>`;
      section.querySelectorAll('[data-width]').forEach(b=>b.onclick=()=>{width=Number(b.dataset.width);draw();});
      section.querySelectorAll('img').forEach(img=>img.onerror=()=>{img.hidden=true;const p=document.createElement('p');p.className='review-missing';p.textContent='本机截图尚未准备，无法显示线上对照。请重新取得只读截图，不以示例代替。';img.parentElement.append(p);});
    }
  }
  draw();new MutationObserver(draw).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  function sync(name){['state','photo-count','reset'].forEach(id=>document.getElementById(id).disabled=name!=='journal');history.replaceState(null,'','#'+name);}
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>sync(b.dataset.page)));
  window.addEventListener('DOMContentLoaded',()=>{const name=location.hash.slice(1);if(['menu','inventory','catalog','journal'].includes(name))document.querySelector(`[data-page="${name}"]`).click();});
})();
