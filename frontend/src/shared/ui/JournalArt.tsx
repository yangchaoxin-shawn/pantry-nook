import { useEffect, useState, type ReactNode } from 'react';
import pantryScene from '../../assets/journal/pantry-home.webp';

/** 已确认的透明插画只承担装饰，实际库存始终来自业务 API。 */
export function JournalHero({ actions }: { actions: ReactNode }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => { if (preference.matches) setPlaying(false); };
    preference.addEventListener('change', stop);
    return () => preference.removeEventListener('change', stop);
  }, []);
  return <section className="journal-hero" aria-labelledby="inventory-title">
    <div className="journal-hero-copy">
      <p className="journal-eyebrow"><span aria-hidden="true">✳</span> GOOD THINGS AT HOME</p>
      <h1 id="inventory-title">家里还有什么？</h1>
      <p>好好收着，也好好吃掉。</p>
    </div>
    <div className="journal-hero-actions">{actions}</div>
    <button type="button" className={`journal-scene${playing ? ' is-playing' : ''}`}
      aria-label="播放收纳小动画" onClick={() => { if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(true); }}
      onAnimationEnd={() => setPlaying(false)}>
      <img src={pantryScene} alt="" width="960" height="707" decoding="async" draggable="false" />
      <span className="journal-scene-caption" aria-hidden="true">把好东西，带回家 <span>↗</span></span>
    </button>
    <span className="journal-page-number" aria-hidden="true">02 / 小库存</span>
  </section>;
}

export function KitchenSketch({ kind = 'empty' }: { kind?: 'empty' | 'error' | 'loading' }) {
  return <svg className={`kitchen-sketch sketch-${kind}`} viewBox="0 0 190 125" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path opacity=".4" d="M13 111q76 4 158-2" />
    <circle cx="46" cy="37" r="10" />
    <path d="m40 48-4 30 19 1-5-29M37 77l-7 21-13 1m36-21 11 20 12 1" />
    <path className="sketch-hand" d="m43 54 28 8 6-14m-27 12 18 12 18-10" />
    {kind === 'empty' && <><path d="m81 76 56-2 23 15-65 4zM81 76v30l14 4 1-17m64-4v15l-65 6" fill="var(--surface-warm)" /><path d="M112 54q-9-13 2-18 15-7 15 5 0 8-11 9v6m0 7v1" /></>}
    {kind === 'error' && <><path d="m108 48 40-1 5 57-47 1zM117 92l23-1" fill="var(--surface-warm)" /><path d="m106 19 6 7m16-12v8m20-3-5 9m-25 46 18-1" /></>}
    {kind === 'loading' && <><path d="m96 44 48-1m-48 53 48 1m-42-51c0 22 18 24 18 24s18 1 18 25m0-49c0 20-18 24-18 24s-18 4-18 25" /><path d="m112 52 19-1-10 12z" fill="var(--primary-100)" /></>}
  </svg>;
}
