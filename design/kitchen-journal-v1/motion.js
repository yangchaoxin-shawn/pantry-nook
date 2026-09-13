/* 独立原型的动效层；业务状态仍由 preview.js 管理。 */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduce.matches;
  let observer;
  let lastPage = '';
  let closing;
  let closeGeneration = 0;
  const enabled = () => !paused && !reduce.matches;
  const tracked = new Set();
  function animate(element, frames, options) {
    if (!element || !enabled()) return;
    const animation = element.animate(frames, options);
    tracked.add(animation);
    animation.finished.catch(() => {}).finally(() => tracked.delete(animation));
    return animation;
  }
  function syncPreference() {
    document.body.classList.toggle('motion-paused', !enabled());
    const control = document.querySelector('#motion-button');
    control.textContent = enabled() ? '暂停动效' : '开启动效';
    control.setAttribute('aria-pressed', String(!enabled()));
    control.disabled = reduce.matches;
    control.title = reduce.matches ? '跟随系统的减少动态效果设置' : '切换页面动态效果';
    if (!enabled()) { tracked.forEach(animation => animation.cancel()); observer?.disconnect(); }
  }
  function reveal(element, delay = 0) {
    animate(element, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
  }
  window.PantryMotion = {
    page() {
      const key = document.querySelector('h1')?.textContent;
      const changed = lastPage !== key;
      lastPage = key;
      observer?.disconnect();
      if (!enabled()) return;
      if (changed) reveal(document.querySelector('.hero'), 0);
      let index = 0;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          reveal(entry.target, Math.min(index++, 4) * 45);
          observer.unobserve(entry.target);
        });
      }, { threshold: .08 });
      document.querySelectorAll('.menu-card,.stock-group,.catalog-item,.plan-note,.side-note,.history-item').forEach(element => observer.observe(element));
    },
    dialog(wasOpen) {
      closeGeneration++;
      closing?.cancel();
      closing = undefined;
      const dialog = document.querySelector('#dialog');
      dialog.inert = false;
      dialog.classList.remove('closing');
      if (wasOpen) {
        animate(document.querySelector('#dialog-content'), [{ opacity: .5, transform: 'translateX(7px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 180, easing: 'ease-out' });
      } else {
        animate(dialog, [{ opacity: 0, transform: 'translateY(24px) scale(.97)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 300, easing: 'cubic-bezier(.2,.85,.25,1)' });
      }
    },
    closeDialog() {
      const dialog = document.querySelector('#dialog');
      if (closing || !dialog.open) return;
      if (!enabled()) { dialog.close(); return; }
      const generation = ++closeGeneration;
      dialog.inert = true;
      dialog.classList.add('closing');
      closing = animate(dialog, [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(12px) scale(.985)' }], { duration: 140, easing: 'ease-in' });
      closing.finished.catch(() => {}).finally(() => {
        if (generation !== closeGeneration) return;
        closing = undefined;
        dialog.classList.remove('closing');
        dialog.close();
        dialog.inert = false;
      });
    },
    success() {
      const toast = document.querySelector('#toast');
      animate(toast, [{ transform: 'translateX(-50%) translateY(12px) scale(.92)' }, { transform: 'translateX(-50%) translateY(-3px) scale(1.02)', offset: .7 }, { transform: 'translateX(-50%) translateY(0) scale(1)' }], { duration: 430, easing: 'ease-out' });
    },
  };
  document.addEventListener('DOMContentLoaded', () => {
    syncPreference();
    document.querySelector('#motion-button').addEventListener('click', () => { paused = !paused; syncPreference(); });
    reduce.addEventListener('change', () => { paused = reduce.matches; syncPreference(); });
    const dialog = document.querySelector('#dialog');
    dialog.addEventListener('cancel', event => { event.preventDefault(); window.PantryMotion.closeDialog(); });
    document.querySelector('.dialog-close-form').addEventListener('submit', event => { event.preventDefault(); window.PantryMotion.closeDialog(); });
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.action === 'stir-pot') {
      const painting = button.querySelector('.kitchen-painting');
      animate(painting, [{ transform: 'rotate(0) translateY(0)' }, { transform: 'rotate(-3deg) translateY(-5px)', offset: .3 }, { transform: 'rotate(2deg) translateY(-2px)', offset: .6 }, { transform: 'rotate(0) translateY(0)' }], { duration: 750, easing: 'ease-in-out' });
      button.classList.remove('is-stirring');
      requestAnimationFrame(() => { button.classList.add('is-stirring'); setTimeout(() => button.classList.remove('is-stirring'), 1300); });
    } else if (button.id === 'theme-button') {
      animate(button.querySelector('svg'), [{ transform: 'rotate(-45deg) scale(.7)' }, { transform: 'rotate(0) scale(1)' }], { duration: 400, easing: 'ease-out' });
    } else if (button.isConnected && !button.closest('nav')) {
      animate(button, [{ transform: 'scale(.96)' }, { transform: 'scale(1.025)', offset: .6 }, { transform: 'scale(1)' }], { duration: 270, easing: 'ease-out' });
    }
  });
})();
