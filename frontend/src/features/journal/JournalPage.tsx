import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../shared/ui/Primitives';
import { localDate } from '../../shared/api/client';
import { KitchenSketch } from '../../shared/ui/JournalArt';
import { JournalSceneHero } from '../../shared/ui/JournalSceneHero';
import { LittlePerson } from '../../shared/ui/LittlePerson';
import { journalApi, monthLabel, type JournalEntry } from './api';
import JournalComposer from './JournalComposer';
import CalendarWall from './CalendarWall';
import { MealSheet, MonthChapter, SceneArt } from './AlbumParts';
import { shortDate } from './calendar';
import './journal-page.css';

type View = 'timeline' | 'calendar';
type Celebration = { id: number; date: string; ordinal: number };

export default function JournalPage({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  // 后端随每页返回本页月份的全月顿数，与 total 同一快照，不另发请求。
  const [monthTotals, setMonthTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');
  const [moreBusy, setMoreBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<View>('timeline');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [deleting, setDeleting] = useState<JournalEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  // 刚记下的那一顿：庆祝画面里由它的小人出场，并告诉用户补记的照片归到了哪天。
  const [celebrate, setCelebrate] = useState<Celebration | null>(null);
  const deleteLock = useRef(false);
  const gallery = useRef<(() => void) | undefined>(undefined);
  const generation = useRef(0);
  const moreLock = useRef(false);
  const start = useRef<(() => void) | null>(null);
  const today = localDate();
  useEffect(() => {
    const controller = new AbortController(); generation.current++; moreLock.current = false;
    journalApi.list('', 0, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setEntries(result.data); setTotal(result.meta?.total ?? result.data.length); setMonthTotals(result.meta?.month_totals ?? {});
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '相册暂时读取失败。'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => () => gallery.current?.(), []);
  useEffect(() => {
    if (notice?.kind !== 'success') return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!celebrate || loading) return;
    const timer = setTimeout(() => setCelebrate(null), 3200);
    return () => clearTimeout(timer);
  }, [celebrate, loading]);
  async function more() {
    if (moreLock.current) return;
    const current = generation.current; moreLock.current = true; setMoreBusy(true); setLoadMoreError('');
    try { const result = await journalApi.list('', entries.length); if (current === generation.current) { setEntries(existing => [...existing, ...result.data.filter(item => !existing.some(old => old.id === item.id))]); setTotal(result.meta?.total ?? total); setMonthTotals(existing => ({ ...existing, ...result.meta?.month_totals })); } }
    catch (err) { if (current === generation.current) setLoadMoreError(err instanceof Error ? err.message : '下一页暂时读取失败，请重试。'); }
    finally { if (current === generation.current) { moreLock.current = false; setMoreBusy(false); } }
  }
  async function openGallery(entry: JournalEntry, index = 0) {
    try { const module = await import('./gallery'); gallery.current?.(); gallery.current = module.openJournalGallery(entry, index); }
    catch { setNotice({ message: '看图组件暂时没能打开，请刷新页面后重试。', kind: 'error' }); }
  }
  function refresh(message = '') { setLoading(true); setError(''); setLoadMoreError(''); setMoreBusy(false); setRevision(value => value + 1); setNotice(message ? { message, kind: 'success' } : null); }
  async function remove() {
    if (!deleting || deleteLock.current) return;
    deleteLock.current = true; setDeleteBusy(true); setDeleteError('');
    try { await journalApi.remove(deleting.id); setDeleting(null); refresh('这一顿已移除。'); }
    catch (err) { setDeleteError(err instanceof Error ? err.message : '删除未完成，请重试。'); }
    finally { setDeleteBusy(false); deleteLock.current = false; }
  }
  const begin = () => (start.current ? start.current() : setComposerOpen(true));
  const groups = entries.reduce<Record<string, JournalEntry[]>>((result, entry) => { (result[entry.entry_date.slice(0, 7)] ??= []).push(entry); return result; }, {});
  const ready = !loading || entries.length > 0;
  const heroTitle = !ready ? <>翻开相册，<span>稍等一下。</span></> : total ? <>我们一起，<span>吃了 <b className="album-hero-count">{total}</b> 顿饭。</span></> : <>把这一顿，<span>留在日子里。</span></>;
  return <section className="photo-journal" aria-label="厨房相册">
    <JournalSceneHero kind="journal" eyebrow="OUR KITCHEN ALBUM" title={heroTitle} description="拍了就传，日期按照片自动归档。" page="01 / 厨房相册"
      actions={<button type="button" className="album-capture" onClick={begin}><span aria-hidden="true">＋</span>记一顿</button>} />
    {total > 0 && <div className="album-views" role="group" aria-label="查看方式">
      {([['timeline', '一顿一顿翻'], ['calendar', '日历墙']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} className={view === key ? 'is-active' : ''} onClick={() => setView(key)}>{label}</button>)}
    </div>}
    {notice?.kind === 'success' && active && !celebrate && <div className="toast" role="status">✓ {notice.message}</div>}
    {notice?.kind === 'error' && <p className="journal-notice journal-error" role="alert">{notice.message}<button aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></p>}
    {loading && !entries.length ? <div className="album-state" role="status"><KitchenSketch kind="loading" /><p>正在翻开相册…</p></div>
      : error ? <div className="album-state" role="alert"><KitchenSketch kind="error" /><h2>相册暂时没能打开。</h2><p>{error}</p><button className="btn-primary" onClick={() => refresh()}>重新打开</button></div>
      : entries.length === 0 ? <div className="album-state album-first"><SceneArt scene="team" className="album-first-scene" /><h2>第一张照片，留给下一顿。</h2><p>刚出锅的菜、摆好的碗筷，<br />或者只是你们一起吃饭的样子。</p></div>
      : view === 'calendar' ? <CalendarWall revision={revision} openDay={entry => void openGallery(entry)} />
      : <>
      {Object.entries(groups).map(([month, monthEntries], chapter) => <section className="journal-month album-month" key={month} aria-label={monthLabel(month)}>
        <MonthChapter month={month} count={monthTotals[month] ?? monthEntries.length} page={chapter + 1} />
        {monthEntries.map(entry => <MealSheet key={entry.id} entry={entry} today={today}
          ordinal={entry.ordinal}
          open={index => void openGallery(entry, index)} edit={() => setEditing(entry)} remove={() => { setDeleting(entry); setDeleteError(''); }} />)}
      </section>)}
      {loadMoreError && <p role="alert" className="journal-error">{loadMoreError}</p>}
      <div className="journal-end">{entries.length < total ? <button className="btn-ghost" disabled={moreBusy} onClick={() => void more()}>{moreBusy ? '正在翻页…' : '再往前翻 ↓'}</button> : <p>第 1 顿就到这里。下一顿见。<br />﹏</p>}</div>
    </>}
    {celebrate && !loading && !error && <div className="album-celebrate" role="status">
      <LittlePerson namespace="meal" businessId={celebrate.id} className="album-celebrate-person" autoPlay />
      <p><span>第</span><strong>{celebrate.ordinal}</strong><span>顿，记下了</span></p>
      {celebrate.date !== today && <small>记在 {shortDate(celebrate.date, today)}</small>}
    </div>}
    <JournalComposer active={active && !editing && !deleting} open={composerOpen} setOpen={setComposerOpen} startRef={start}
      onSaved={saved => { setView('timeline'); setCelebrate(saved ? { id: saved.id, date: saved.entry_date, ordinal: saved.ordinal } : null); refresh(saved ? '' : '记下了。'); }} />
    {editing && <JournalComposer key={editing.id} entry={editing} active={active} open setOpen={value => { if (!value) setEditing(null); }} onSaved={() => refresh('改好了。')} />}
    {deleting && <Dialog title="删除这一顿？" onClose={() => setDeleting(null)} busy={deleteBusy}><div className="journal-composer"><p>{deleting.entry_date} 的 {deleting.photos.length} 张照片和文字会从相册移除，删除后无法在页面恢复。</p>{deleteError && <p role="alert" className="journal-error">{deleteError}</p>}<div className="journal-form-footer"><button className="btn-ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>留着</button><button className="btn-danger" onClick={() => void remove()} disabled={deleteBusy}>确认删除</button></div></div></Dialog>}
  </section>;
}
