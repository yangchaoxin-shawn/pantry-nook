// 此页只展示插画方向与短动效，不操作业务数据。
const feedback = document.querySelector('#feedback');
let feedbackTimer;
const sceneTimers = new WeakMap();
document.addEventListener('click', event => {
  const button = event.target.closest('[data-play]');
  if (!button) return;
  const scene = button.closest('.scenario');
  clearTimeout(sceneTimers.get(scene));
  scene.classList.remove('playing');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // 两帧之间重新添加类，让重复点击仍能重播。
    requestAnimationFrame(() => requestAnimationFrame(() => scene.classList.add('playing')));
    sceneTimers.set(scene, setTimeout(() => scene.classList.remove('playing'), 1450));
  }
  feedback.textContent = matchMedia('(prefers-reduced-motion: reduce)').matches ? '跟随系统设置，显示静态插画' : '动作示意 · 没有保存或修改业务数据';
  feedback.classList.add('show');
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => feedback.classList.remove('show'), 2000);
});
