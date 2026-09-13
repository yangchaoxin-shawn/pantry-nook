/* 对照只切换一个视觉类，不刷新页面，不改变录入值或随机小人的分配。 */
(() => {
  state.page = 'stock';
  render();
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'pantry-texture-mode') return;
    if (!['original', 'gentle'].includes(event.data.mode)) return;
    document.body.classList.toggle('tune-gentle', event.data.mode === 'gentle');
    parent.postMessage({ type:'pantry-texture-applied', mode:event.data.mode }, location.origin);
  });
  parent.postMessage({ type:'pantry-texture-ready' }, location.origin);
})();
