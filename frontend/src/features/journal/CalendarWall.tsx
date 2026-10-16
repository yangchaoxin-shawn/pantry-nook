import { useEffect, useState } from 'react';
import { localDate } from '../../shared/api/client';
import { journalApi, mediaUrl, monthLabel, type JournalEntry } from './api';
import { entriesByDay, mergeDay, monthCells, shiftMonth } from './calendar';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

export default function CalendarWall({ revision, openDay }: { revision: number; openDay: (entry: JournalEntry) => void }) {
  const today = localDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [state, setState] = useState<{ month: string; entries: JournalEntry[]; error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      // 接口每页最多 100 条；一个月记得多时继续翻，避免月初几天悄悄空着。
      const entries: JournalEntry[] = [];
      for (;;) {
        const result = await journalApi.list(month, entries.length, controller.signal, 100);
        entries.push(...result.data);
        if (!result.data.length || entries.length >= (result.meta?.total ?? 0)) break;
      }
      return entries;
    })()
      .then(entries => { if (!controller.signal.aborted) setState({ month, entries, error: '' }); })
      .catch(err => { if (!controller.signal.aborted) setState({ month, entries: [], error: err instanceof Error ? err.message : '这个月暂时读不到。' }); });
    return () => controller.abort();
  }, [month, revision]);
  const ready = state?.month === month;
  const days = entriesByDay(ready ? state.entries : []);
  const isCurrent = month === today.slice(0, 7);
  return <section className="calendar-wall" aria-label="日历墙">
    <div className="calendar-head">
      <button type="button" onClick={() => setMonth(value => shiftMonth(value, -1))} aria-label="上个月">‹</button>
      <h2>{monthLabel(month)}</h2>
      <button type="button" onClick={() => setMonth(value => shiftMonth(value, 1))} disabled={isCurrent} aria-label="下个月">›</button>
    </div>
    <p className="calendar-summary" role="status">{!ready ? '正在翻到这个月…' : state.error || (state.entries.length ? `这个月记下了 ${state.entries.length} 顿` : isCurrent ? '这个月还空着，等第一顿。' : '这个月没有留下照片。')}</p>
    <div className="calendar-grid">
      {WEEK.map(label => <span key={label} className="calendar-week" aria-hidden="true">{label}</span>)}
      {monthCells(month).map((day, index) => {
        if (day === null) return <span key={`lead-${index}`} className="calendar-cell is-lead" aria-hidden="true" />;
        const list = days.get(day);
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const isToday = date === today;
        if (!list) return <span key={day} className={`calendar-cell${isToday ? ' is-today' : ''}${date > today ? ' is-future' : ''}`}><i>{day}</i></span>;
        const cover = list[0].photos.find(photo => photo.image.id === list[0].cover_upload_id) ?? list[0].photos[0];
        const count = list.reduce((sum, entry) => sum + entry.photos.length, 0);
        return <button key={day} type="button" className={`calendar-cell has-meal${isToday ? ' is-today' : ''}`} onClick={() => openDay(mergeDay(list))} aria-label={`${Number(month.slice(5))} 月 ${day} 日，${list.length} 顿，${count} 张照片`}>
          <img src={mediaUrl(cover.image.thumbnail_url)} alt="" loading="lazy" />
          <i>{day}</i>
          {list.length > 1 && <b>×{list.length}</b>}
        </button>;
      })}
    </div>
  </section>;
}
