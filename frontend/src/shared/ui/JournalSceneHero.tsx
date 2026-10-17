import { useState, type ReactNode } from "react";
import kitchenTeam from "../../assets/journal/kitchen-team.webp";
import recipeTime from "../../assets/journal/recipe-time.webp";
import tableMemories from "../../assets/journal/table-memories.png";
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
  journal: {
    image: tableMemories,
    width: 1862,
    height: 845,
    label: "播放收藏饭桌照片的小动画",
    kicker: "OUR TABLE, OUR LITTLE DAYS",
    title: <>把这一餐，<span>留在日子里。</span></>,
    description: "照片里有饭，也有我们好好过的每一天。",
    caption: "这一餐，值得留一张",
    page: "04 / 饭桌手记",
  },
} as const;

export function JournalSceneHero({
  kind,
  eyebrow,
  actions,
  title,
  description,
  page,
}: {
  kind: keyof typeof scenes;
  eyebrow?: string;
  actions: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  page?: string;
}) {
  const scene = { ...scenes[kind], ...(title ? { title } : {}), ...(description ? { description } : {}), ...(page ? { page } : {}) };
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
