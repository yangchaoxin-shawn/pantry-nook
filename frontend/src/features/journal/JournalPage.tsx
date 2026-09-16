import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../shared/ui/Primitives';
import { journalApi, mediaUrl, monthLabel, type JournalEntry } from './api';
import JournalComposer from './JournalComposer';
import './journal-page.css';
import { coverFirst } from './draft';

function CameraSketch() {
  return <svg className="journal-camera-sketch" viewBox="0 0 120 130" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="42" cy="26" r="10"/><path d="M35 36q-7 17-4 33l18 1 2-30M33 45 15 54l-5-10m39-1 12 10 13-10M35 70l-6 27-12 4m28-32 9 26 14 2"/><rect x="55" y="24" width="29" height="21" rx="3"/><circle cx="68" cy="34" r="6"/><path d="M60 24v-4h11v4m21 6 12-5m-10 13 10 5M78 100c15-7 24-3 27 5m-69 12q29-10 63-3"/></svg>;
}
export default function JournalPage({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [month, setMonth] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadMoreError, setLoadMoreError] = useState('');
  const [moreBusy, setMoreBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [deleting, setDeleting] = useState<JournalEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const deleteLock = useRef(false);
  const gallery = useRef<(() => void) | undefined>(undefined);
  const generation = useRef(0);
  const moreLock = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); generation.current++; moreLock.current = false;
    journalApi.list(month, 0, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setEntries(result.data); setTotal(result.meta?.total ?? result.data.length);
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '手记暂时读取失败。'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, revision]);
  useEffect(() => () => gallery.current?.(), []);
  async function more() {
    if (moreLock.current) return;
    const current = generation.current; moreLock.current = true; setMoreBusy(true); setLoadMoreError('');
    try { const result = await journalApi.list(month, entries.length); if (current === generation.current) { setEntries(existing => [...existing, ...result.data.filter(item => !existing.some(old => old.id === item.id))]); setTotal(result.meta?.total ?? total); } }
    catch (err) { if (current === generation.current) setLoadMoreError(err instanceof Error ? err.message : '下一页暂时读取失败，请重试。'); }
    finally { if (current === generation.current) { moreLock.current = false; setMoreBusy(false); } }
  }
  async function openGallery(entry: JournalEntry, index = 0) {
    try { const module = await import('./gallery'); gallery.current?.(); gallery.current = module.openJournalGallery(entry, index); }
    catch { setNotice('看图组件暂时没能打开，请刷新页面后重试。'); }
  }
  function resetLoading() { setLoading(true); setError(''); setLoadMoreError(''); setMoreBusy(false); }
  function changeMonth(value: string) { resetLoading(); setMonth(value); }
  function refresh(message = '') { resetLoading(); setRevision(value => value + 1); setNotice(message); }
  async function remove() {
    if (!deleting || deleteLock.current) return;
    deleteLock.current = true; setDeleteBusy(true); setDeleteError('');
    try { await journalApi.remove(deleting.id); setDeleting(null); refresh('这篇手记已移除。'); }
    catch (err) { setDeleteError(err instanceof Error ? err.message : '删除未完成，请重试。'); }
    finally { setDeleteBusy(false); deleteLock.current = false; }
  }
  const groups = entries.reduce<Record<string, JournalEntry[]>>((result, entry) => { (result[entry.entry_date.slice(0, 7)] ??= []).push(entry); return result; }, {});
  return <section className="photo-journal" aria-label="饭桌手记">
    <div className="journal-intro"><div><p className="eyebrow">OUR TABLE, OUR LITTLE DAYS</p><h1>把这一餐，<br />留在<span>日子里。</span></h1><p className="journal-intro-note">照片里有饭，也有我们好好过的每一天。</p></div><div className="journal-capture"><CameraSketch /><button className="btn-primary" onClick={() => setComposerOpen(true)}>＋ 记下一餐</button></div></div>
    <div className="journal-filter"><span>我们的饭桌 <small>· {total} 篇手记</small></span><label>翻到<input type="month" aria-label="按月份查看手记" value={month} onChange={event => changeMonth(event.target.value)} /></label>{month && <button onClick={() => changeMonth('')}>全部月份</button>}<button onClick={() => refresh()} disabled={loading || moreBusy}>刷新</button></div>
    {notice && <p className="journal-notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></p>}
    {loading ? <div className="journal-empty" role="status"><CameraSketch /><p>正在翻开饭桌手记…</p></div> : error ? <div className="journal-empty" role="alert"><h2>这页手记，暂时没能打开。</h2><p>{error}</p><button className="btn-primary" onClick={() => refresh()}>重新打开</button></div> : entries.length === 0 ? <div className="journal-empty"><CameraSketch /><h2>{month ? '这个月，还没有留下照片。' : '第一张照片，留给下一餐。'}</h2><p>刚出锅的菜、摆好的碗筷，<br />或者只是你们一起吃饭的样子。</p><button className="btn-primary" onClick={() => setComposerOpen(true)}>＋ 记下一餐</button></div> : <>
      {Object.entries(groups).map(([groupMonth, groupEntries]) => <section className="journal-month" key={groupMonth} aria-label={monthLabel(groupMonth)}><h2 className="journal-chapter">{monthLabel(groupMonth)}<span>· 把日常，慢慢收藏</span></h2>{groupEntries.map(entry => <article className={`journal-sheet ${entry.photos.length === 1 ? 'journal-single' : ''}`} key={entry.id}>
        <div className="journal-margin"><div className="journal-day">{entry.entry_date.slice(-2)}</div><time dateTime={entry.entry_date}>{new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })}</time><p>{entry.caption || '这一餐，也值得留下来。'}</p><span className="journal-hand-arrow" aria-hidden="true">↘</span></div>
        <div className={`journal-photo-story story-count-${entry.photos.length}`}>{coverFirst(entry).map((photo, index) => <figure className={`journal-print ${photo.image.preview_height > photo.image.preview_width ? 'is-portrait' : 'is-landscape'}`} key={photo.id}><button className="journal-image-button" aria-label={`查看 ${entry.entry_date} 第 ${index + 1} 张照片`} onClick={() => void openGallery(entry, index)}><img src={mediaUrl(photo.image.preview_url)} alt={`${entry.entry_date} 的饭桌照片 ${index + 1}`} width={photo.image.preview_width} height={photo.image.preview_height} loading="lazy" /></button><figcaption><span>{photo.live_status === 'live' ? '◎ 实况' : photo.live_status === 'missing_video' ? '静态 · 缺少动态片段' : index === 0 ? '这一餐，记住了。' : '日常一瞬'}</span><small>{String(index + 1).padStart(2, '0')} / {String(entry.photos.length).padStart(2, '0')}</small></figcaption></figure>)}</div>
        <div className="journal-entry-foot"><span>{entry.photos.length} 张照片</span><button onClick={() => void openGallery(entry)}>翻开这篇 ↗</button><button onClick={() => setEditing(entry)}>编辑</button><button onClick={() => { setDeleting(entry); setDeleteError(''); }}>删除</button></div>
      </article>)}</section>)}
      {loadMoreError && <p role="alert" className="journal-error">{loadMoreError}</p>}
      <div className="journal-end">{entries.length < total ? <button className="btn-ghost" disabled={moreBusy} onClick={() => void more()}>{moreBusy ? '正在翻页…' : '再往前翻一页 ↓'}</button> : <p>这一页先写到这里。下一餐见。<br />﹏</p>}</div>
    </>}
    <JournalComposer active={active && !editing && !deleting} open={composerOpen} setOpen={setComposerOpen} onSaved={() => { setMonth(''); refresh('这一餐，已经留在日子里。'); }} />
    {editing && <JournalComposer key={editing.id} entry={editing} active={active} open setOpen={value => { if (!value) setEditing(null); }} onSaved={() => refresh('手记已更新。')} />}
    {deleting && <Dialog title="删除这篇手记？" onClose={() => setDeleting(null)} busy={deleteBusy}><div className="journal-composer"><p>{deleting.entry_date} 的 {deleting.photos.length} 张照片及文字将从手记移除，删除后无法在页面恢复。</p>{deleteError && <p role="alert" className="journal-error">{deleteError}</p>}<div className="journal-form-footer"><button className="btn-ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>保留手记</button><button className="btn-danger" onClick={() => void remove()} disabled={deleteBusy}>{deleteBusy ? '删除中…' : '确认删除'}</button></div></div></Dialog>}
  </section>;
}
