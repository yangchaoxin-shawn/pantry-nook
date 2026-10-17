import { useEffect, useRef, useState } from 'react';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 进入视口后渐显一次；减少动态效果或环境不支持时直接显示，不藏内容。 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === 'undefined' || reduceMotion());
  useEffect(() => {
    if (revealed || !ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { setRevealed(true); observer.disconnect(); }
    }, { rootMargin: '0px 0px -8% 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [revealed]);
  return { ref, revealed };
}

/** 数字从上一个值滚到新值（保存后“第 N 顿”的积累感）；减少动态效果时直接显示新值。 */
export function useCountUp(value: number, duration = 550) {
  const [displayed, setDisplayed] = useState(value);
  const settled = useRef(value);
  useEffect(() => {
    if (value === settled.current) return;
    const origin = settled.current;
    settled.current = value;
    const span = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = span ? Math.min(1, (now - start) / span) : 1;
      setDisplayed(Math.round(origin + (value - origin) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return displayed;
}
