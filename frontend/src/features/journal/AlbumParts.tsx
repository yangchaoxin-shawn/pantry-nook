import { useState } from 'react';
import { LittlePerson } from '../../shared/ui/LittlePerson';
import { mediaUrl, monthLabel, type JournalEntry } from './api';
import { chapterArt, pageIndex, printLine, SCENES, type SceneKey } from './album-art';
import { coverFirst } from './draft';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 可点的透明插画：点一下播放短动作，减少动态效果时不动。 */
export function SceneArt({ scene, className = '' }: { scene: SceneKey; className?: string }) {
  const [playing, setPlaying] = useState(false);
  const art = SCENES[scene];
  return <button type="button" className={`album-scene${playing ? ' is-playing' : ''} ${className}`.trim()} aria-label={`播放“${art.caption}”小动画`}
    onClick={() => { if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(true); }}
    onAnimationEnd={() => setPlaying(false)}>
    <img src={art.src} alt="" width={art.width} height={art.height} decoding="async" draggable="false" />
    <span aria-hidden="true">{art.caption} <i>↗</i></span>
  </button>;
}

/** 每个月一张章节页：插画轮换、页码和本月顿数，像翻手记的扉页。 */
export function MonthChapter({ month, count, page }: { month: string; count: number; page: number }) {
  const art = chapterArt(month);
  return <header className="album-chapter">
    <div className="album-chapter-copy">
      <span className="album-chapter-kicker"><i aria-hidden="true">✳</i>CHAPTER {pageIndex(page)}</span>
      <h2>{monthLabel(month)}</h2>
      <p>{art.line}</p>
      <span className="album-chapter-count"><b>{count}</b> 顿</span>
    </div>
    <SceneArt scene={art.scene} className="album-chapter-scene" />
  </header>;
}

/** 一顿：日期印章 + 固定小人在左，照片拍立得在右，手写下划线托着那句话。 */
export function MealSheet({ entry, ordinal, today, open, edit, remove }: { entry: JournalEntry; ordinal: number; today: string; open: (index: number) => void; edit: () => void; remove: () => void }) {
  const photos = coverFirst(entry);
  const [year, month, day] = entry.entry_date.split('-');
  const weekday = WEEKDAYS[new Date(`${entry.entry_date}T12:00:00`).getDay()];
  const portraitCover = photos[0]?.image.preview_height > photos[0]?.image.preview_width;
  const stroke = entry.id % 4;
  return <article className={`meal-sheet meal-stroke-${stroke}${photos.length === 1 ? ' meal-single' : ''}`} aria-label={`第 ${ordinal} 顿，${Number(month)} 月 ${Number(day)} 日`}>
    <div className="meal-margin">
      <div className="meal-stamp">
        <span className="meal-no"><small>NO.</small>{pageIndex(ordinal)}</span>
        <time dateTime={entry.entry_date}>
          <span className="meal-stamp-year">{entry.entry_date === today ? '今天' : year}</span>
          <span className="meal-stamp-day">{month}<i>/</i>{day}</span>
        </time>
        <span className="meal-stamp-weekday">{weekday}</span>
      </div>
      <LittlePerson namespace="meal" businessId={entry.id} className="meal-person" />
      {entry.caption && <p className="meal-caption"><span>{entry.caption}</span></p>}
    </div>
    <div className={`journal-photo-story story-count-${photos.length}${portraitCover && photos.length >= 7 ? ' has-portrait-cover' : ''}`}>
      {photos.map((photo, index) => <figure className={`journal-print ${photo.image.preview_height > photo.image.preview_width ? 'is-portrait' : 'is-landscape'}`} key={photo.id}>
        <button className="journal-image-button" aria-label={`查看第 ${ordinal} 顿的第 ${index + 1} 张照片`} onClick={() => open(index)}>
          <img src={mediaUrl(photo.image.preview_url)} alt={`${entry.entry_date} 的饭桌照片 ${index + 1}`} width={photo.image.preview_width} height={photo.image.preview_height} loading="lazy" />
        </button>
        <figcaption><span>{printLine(index)}</span><small>{pageIndex(index + 1)} / {pageIndex(photos.length)}</small></figcaption>
      </figure>)}
    </div>
    <div className="journal-entry-foot">
      <span>{photos.length} 张照片</span>
      <button onClick={() => open(0)}>翻开这一顿 ↗</button>
      <button onClick={edit}>改一改</button>
      <button className="meal-delete" onClick={remove}>删除</button>
    </div>
  </article>;
}
