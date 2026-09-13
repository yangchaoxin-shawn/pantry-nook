(() => {
  const preview = document.querySelector('#preview');
  const buttons = [...document.querySelectorAll('[data-mode]')];
  const captions = {
    original: '当前：第六版原有纹理 · 与减淡方案共用同一画面',
    gentle: '当前：纹理约保留 75% · 仅供对齐，未替换主原型',
    half: '当前：纹理约保留 50% · 仅供对齐，未替换主原型',
  };
  let mode = 'half';
  const send = () => preview.contentWindow.postMessage({ type:'pantry-texture-mode', mode }, location.origin);
  buttons.forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.mode;
    send();
  }));
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== preview.contentWindow) return;
    if (event.data?.type === 'pantry-texture-ready') send();
    if (event.data?.type !== 'pantry-texture-applied' || !['original','gentle','half'].includes(event.data.mode)) return;
    mode = event.data.mode;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    document.querySelector('#mode-caption').textContent = captions[mode];
  });
})();
