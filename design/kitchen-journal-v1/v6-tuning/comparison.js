(() => {
  const preview = document.querySelector('#preview');
  const buttons = [...document.querySelectorAll('[data-mode]')];
  let mode = 'gentle';
  const send = () => preview.contentWindow.postMessage({ type:'pantry-texture-mode', mode }, location.origin);
  buttons.forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.mode;
    send();
  }));
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== preview.contentWindow) return;
    if (event.data?.type === 'pantry-texture-ready') send();
    if (event.data?.type !== 'pantry-texture-applied' || !['original','gentle'].includes(event.data.mode)) return;
    mode = event.data.mode;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    document.querySelector('#mode-caption').textContent = mode === 'gentle'
      ? '当前：纹理约保留 75% · 仅供对齐，未替换主原型'
      : '当前：第六版原有纹理 · 与稍淡方案共用同一画面';
  });
})();
