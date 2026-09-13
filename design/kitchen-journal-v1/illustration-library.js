/* 设计提案专用：选图只保存在本页内存，不写入菜品、库存或 API。 */
(() => {
  const entries = [
    ['kitchen-team', '今天，合伙做饭', '场景'],
    ['pantry-home', '把好东西带回家', '场景'],
    ['recipe-time', '翻到喜欢的那页', '场景'],
    ['supper-duo', '两菜，也很丰盛', '搭配'],
    ['three-bowls', '三碗家常', '搭配'],
    ['breakfast', '慢慢吃个早餐', '搭配'],
    ['noodle-duo', '一碗热面', '搭配'],
    ['tomato-egg', '番茄炒鸡蛋', '菜品'],
    ['chicken-greens', '鸡肉与西兰花', '菜品'],
    ['tofu-soup', '番茄豆腐汤', '菜品'],
    ['pineapple-rice', '菠萝炒饭', '菜品'],
    ['market-basket', '刚从菜场回来', '场景'],
    ['pantry-jars', '小罐子，大满足', '场景'],
    ['recipe-afternoon', '食谱里的小午后', '场景'],
    ['hotpot-friends', '围着一锅热气', '搭配'],
  ].map(([id, title, category]) => ({ id, title, category, src: `assets/cutouts/${id}.webp?v=6.0` }));
  const sketches = [['pantry', '收纳小能手'], ['recipe', '翻翻食谱'], ['pot', '开饭啦'], ['empty', '等一份新鲜'], ['error', '稍等一下'], ['loading', '慢慢准备'], ['celebrate', '好好吃饭'], ['plate', '留一个位子'], ['leaf', '照顾小日常']];
  entries.push(...sketches.map(([scene, title]) => ({ id: `ink-${scene}`, title, category: '小线稿', scene })));
  entries.push(...window.PantryPeople.entries.map(entry=>({...entry,id:'person-'+entry.id,person:entry.id,category:'小人'})));
  const defaults = { menu: 'kitchen-team', stock: 'pantry-home', catalog: 'recipe-time' };
  const choices = new Map();
  let host, activeTarget = 'menu', candidate, category = '全部', surface = 'paper';
  const byId = id => entries.find(entry => entry.id === id) || entries[0];
  const selected = (target, fallback) => byId(choices.get(target) || defaults[target] || fallback || (Number(target.split('-')[1]) % 2 ? 'chicken-greens' : 'supper-duo'));
  const markup = (entry, className = '', eager = false) => entry.person
    ? `<span class="transparent-art ${className}">${window.PantryPeople.artwork(entry.person)}</span>` : entry.scene
    ? `<span class="transparent-art ${className}">${window.PantryArt.render(entry.scene)}</span>`
    : `<img class="transparent-art ${className}" src="${entry.src}" alt="" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
  function targets() {
    return [['menu', '餐安排 · 页头'], ['stock', '库存 · 页头'], ['catalog', '菜品 · 页头']];
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function open(target = host.page()) {
    activeTarget = target;
    candidate = selected(target).id;
    category = '全部';
    surface = document.body.classList.contains('dark') ? 'night' : 'paper';
    draw();
    document.querySelector('#illustration-dialog').showModal();
  }
  function draw() {
    const entry = byId(candidate);
    const modal = document.querySelector('#illustration-dialog');
    const priorScroll = modal.scrollTop;
    const focusKey = document.activeElement?.dataset?.artAction;
    const focusValue = document.activeElement?.dataset?.value;
    modal.innerHTML = `<div class="art-library-heading"><div><span class="eyebrow">LITTLE KITCHEN, MANY STORIES</span><h2 id="illustration-title">厨房里的插画样张</h2><p>24 种小人姿态 · 15 幅拼贴 · 9 幅场景线稿</p></div><button class="icon-button" data-art-action="close" aria-label="关闭插画库">×</button></div>
      <div class="art-library-layout"><section class="art-preview-panel"><label class="field"><span>放在这里</span><select id="art-target" aria-label="插画使用位置">${targets().map(([id, name]) => `<option value="${id}" ${id === activeTarget ? 'selected' : ''}>${escape(name)}</option>`).join('')}</select></label>
      <div class="art-stage art-surface-${surface}">${markup(entry, 'art-stage-image', true)}<span class="art-stage-spark" aria-hidden="true">✳</span></div>
      <div class="art-surface-options" aria-label="预览背景">${[['paper','棉纸'],['night','深色'],['check','透明格']].map(([value,label]) => `<button data-art-action="surface" data-value="${value}" aria-pressed="${surface === value}">${label}</button>`).join('')}</div>
      <h3 class="art-candidate-title">${entry.title}</h3><p class="art-candidate-note">${entry.category === '菜品' ? '菜品创作示意，可作封面候选。' : '一幅小插画，留一点厨房里的趣味。'}</p></section>
      <section class="art-options-panel"><div class="art-category-options" aria-label="插画分类">${['全部','小人','场景','搭配','菜品','小线稿'].map(value => `<button data-art-action="category" data-value="${value}" aria-pressed="${category === value}">${value}</button>`).join('')}</div>
      <div class="art-choice-grid">${entries.filter(item => category === '全部' || item.category === category).map(item => `<button class="art-choice ${item.id === candidate ? 'selected' : ''}" data-art-action="candidate" data-value="${item.id}" aria-pressed="${item.id === candidate}" aria-label="选择${item.title}"><span class="art-thumb art-surface-${surface}">${markup(item)}</span><span>${item.title}</span>${item.id === candidate ? '<span class="art-choice-check" aria-hidden="true">✓</span>' : ''}</button>`).join('')}</div></section></div>
      <footer class="art-library-footer"><span>这里只预览页头；菜品的小人自动配上。</span><button class="button primary" data-art-action="apply">用这幅插画</button></footer>`;
    modal.scrollTop = priorScroll;
    if (focusKey) [...modal.querySelectorAll('[data-art-action]')].find(el => el.dataset.artAction === focusKey && el.dataset.value === focusValue)?.focus({ preventScroll: true });
    modal.querySelector('#art-target').addEventListener('change', event => {
      activeTarget = event.target.value;
      candidate = selected(activeTarget).id;
      draw();
      modal.querySelector('#art-target').focus({ preventScroll: true });
    });
  }
  document.addEventListener('click', event => {
    const change = event.target.closest('[data-illustration-target]');
    if (change) return open(change.dataset.illustrationTarget);
    const control = event.target.closest('[data-art-action]');
    if (!control) return;
    const { artAction: action, value } = control.dataset;
    const modal = document.querySelector('#illustration-dialog');
    if (action === 'close') return modal.close();
    if (action === 'apply') {
      choices.set(activeTarget, candidate);
      modal.close();
      host.showTarget(activeTarget);
      host.render();
      const trigger = document.querySelector(`[data-illustration-target="${activeTarget}"]`) || document.querySelector('#illustration-button');
      trigger.focus({ preventScroll: true });
      host.toast(`已换上「${byId(candidate).title}」`);
      return;
    }
    if (action === 'candidate') candidate = value;
    if (action === 'category') category = value;
    if (action === 'surface') surface = value;
    draw();
  });
  window.PantryIllustrations = {
    entries,
    render: (target, className, fallback) => markup(selected(target, fallback), className, ['menu','stock','catalog'].includes(target)),
    bind(options) {
      host = options;
      document.querySelector('#illustration-button').addEventListener('click', () => open());
    },
  };
})();
