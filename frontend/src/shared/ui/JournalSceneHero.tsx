import { useState, type ReactNode } from "react";
import kitchenTeam from "../../assets/journal/kitchen-team.webp";
import recipeTime from "../../assets/journal/recipe-time.webp";
import "./journal-scene-hero.css";

const scenes = {
  menu: {
    image: kitchenTeam,
    width: 960,
    height: 335,
    label: "播放一起做饭的小动画",
    kicker: "A LITTLE EVERYDAY JOY",
    title: <>把日子，<span>煮成喜欢的样子。</span></>,
    description: "一餐一饭，慢慢安排。",
    caption: "今天，合伙做顿饭",
    page: "01 / 餐安排",
  },
  catalog: {
    image: recipeTime,
    width: 960,
    height: 481,
    label: "播放翻食谱的小动画",
    kicker: "RECIPES TO KEEP",
    title: <>喜欢的菜，<span>常常做。</span></>,
    description: "存下熟悉的味道，下次直接选。",
    caption: "翻到喜欢的那页",
    page: "03 / 菜品簿",
  },
} as const;

export function JournalSceneHero({
  kind,
  eyebrow,
  actions,
}: {
  kind: keyof typeof scenes;
  eyebrow?: string;
  actions: ReactNode;
}) {
  const scene = scenes[kind];
  const [playing, setPlaying] = useState(false);

  return <section className={`journal-page-hero journal-page-hero-${kind}`} aria-labelledby={`${kind}-page-title`}>
    <div className="journal-page-hero-copy">
      <p className="journal-page-kicker"><span aria-hidden="true">✳</span>{eyebrow || scene.kicker}</p>
      <h1 id={`${kind}-page-title`}>{scene.title}</h1>
      <p>{scene.description}</p>
    </div>
    <button
      type="button"
      className={`journal-page-scene${playing ? " is-playing" : ""}`}
      aria-label={scene.label}
      onClick={() => {
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setPlaying(true);
        }
      }}
      onAnimationEnd={() => setPlaying(false)}
    >
      <img
        src={scene.image}
        alt=""
        width={scene.width}
        height={scene.height}
        decoding="async"
        fetchPriority="high"
        draggable="false"
      />
      <span aria-hidden="true">{scene.caption} <i>↗</i></span>
    </button>
    <div className="journal-page-actions">{actions}</div>
    <span className="journal-page-index" aria-hidden="true">{scene.page}</span>
  </section>;
}
