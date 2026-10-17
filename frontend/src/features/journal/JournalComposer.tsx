import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { createUploadId } from './uploadId';
import Uppy, { type UppyFile } from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import { Dialog, Field } from '../../shared/ui/Primitives';
import { KitchenSketch } from '../../shared/ui/JournalArt';
import { localDate } from '../../shared/api/client';
import { journalApi, JournalError, mediaUrl, type UploadedAsset, type JournalEntry, type EntryPayload, type EditPayload } from './api';
import { PHOTO_ACCEPT, MAX_PHOTOS, validateSource, restoreRemoval, pickEntryDate, type DraftSource, type Removal } from './draft';

type UploadMeta = { uploadId: string; [key: string]: unknown };
type UploadBody = { data: UploadedAsset; [key: string]: unknown };
type QueueFile = UppyFile<UploadMeta, UploadBody>;
type Candidate = { key: string; file: File; preview: string; selected: boolean };
type Replacement = { target: string; sources: DraftSource[] };
function PhotoPreview({ src, label, fallbackName }: { src?: string; label: string; fallbackName?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? <img src={src} alt={label} onError={() => setFailed(true)} /> : <span className="journal-photo-placeholder">▧<small>{fallbackName || '原片预览将在整理后显示'}</small>{fallbackName && <small>当前浏览器无法预览，整理后可查看</small>}</span>;
}
export default function JournalComposer({ active, open, setOpen, onSaved, entry, startRef }: { active: boolean; open: boolean; setOpen: (open: boolean) => void; onSaved: (saved?: JournalEntry) => void; entry?: JournalEntry; startRef?: MutableRefObject<(() => void) | null> }) {
  const [uppy, setUppy] = useState<Uppy<UploadMeta, UploadBody> | null>(null);
  const [files, setFiles] = useState<QueueFile[]>([]);
  const [sources, setSources] = useState<DraftSource[]>(() => entry ? entry.photos.map(photo => ({ key: photo.image.id, asset: photo.image })) : []);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [cover, setCover] = useState<string | null>(entry?.cover_upload_id || null);
  const [undos, setUndos] = useState<Removal[]>([]);
  const [replacement, setReplacement] = useState<Replacement | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [manualDate, setManualDate] = useState<string | null>(entry?.entry_date || null);
  const [caption, setCaption] = useState(entry?.caption || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const replacePicker = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const requestId = useRef(createUploadId());
  const saveLock = useRef(false);
  const readLock = useRef(false);
  const coverRevision = useRef(0);
  const hasAdded = useRef(!!entry);
  const urls = useRef(new Set<string>());
  const alive = useRef(true);
  const pendingPayload = useRef<EntryPayload | EditPayload | null>(null);
  const blocked = saving || pendingSave || conflict;
  const busyInput = blocked || reading || !!replacement || !!candidates.length;
  const fileByKey = new Map(files.map(file => [file.meta.uploadId, file]));
  const assetFor = (source: DraftSource) => source.asset || fileByKey.get(source.key)?.response?.body?.data;
  const images = sources.filter(source => !removed.has(source.key));
  const assets = images.flatMap(source => { const asset = assetFor(source); return asset ? [asset] : []; });
  const complete = (source: DraftSource) => !!source.asset || !!fileByKey.get(source.key)?.progress.uploadComplete;
  const { date: entryDate, fromPhoto: shotDate } = pickEntryDate(manualDate, assets.map(asset => asset.taken_on), localDate());
  const canSave = images.length > 0 && images.length <= MAX_PHOTOS && images.every(complete) && !!cover && images.some(source => source.key === cover) && !replacement && !reading && !candidates.length;
  useEffect(() => {
    alive.current = true;
    const queue = new Uppy<UploadMeta, UploadBody>({ autoProceed: true, restrictions: { maxFileSize: 50 * 1024 * 1024, allowedFileTypes: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'] } }).use(XHRUpload, {
      endpoint: mediaUrl('/api/journal/uploads'), fieldName: 'file', formData: true, allowedMetaFields: false,
      limit: 1, timeout: 180000, shouldRetry: () => false,
      locale: { strings: { uploadStalled: '上传已等待 %{seconds} 秒，可以检查网络后重试。' } },
      headers: file => ({ 'X-Upload-ID': String(file.meta.uploadId) }),
      onAfterResponse(xhr) {
        if (xhr.status < 200 || xhr.status >= 300) {
          let message = `上传未完成（${xhr.status}），可以单张重试。`;
          try { message = JSON.parse(xhr.responseText)?.error?.message || message; } catch { /* 保留明确状态码。 */ }
          throw new Error(message);
        }
        const asset = JSON.parse(xhr.responseText)?.data;
        if (!asset?.id || asset.kind !== 'image' || !asset.original_url || !asset.preview_url) throw new Error('未收到完整的上传结果，请重试核对原文件。');
      },
    });
    const update = () => setFiles(queue.getFiles());
    queue.on('file-added', update).on('file-removed', update).on('upload-progress', update).on('upload-success', update).on('upload-error', update).on('upload', update);
    queueMicrotask(() => { if (alive.current) setUppy(queue); });
    const allocated = urls.current;
    return () => { alive.current = false; queue.destroy(); for (const url of allocated) URL.revokeObjectURL(url); allocated.clear(); };
  }, []);
  useEffect(() => {
    if (!undos.length) return;
    const timer = setTimeout(() => setUndos(current => current.filter(undo => undo.expires > Date.now())), Math.max(0, Math.min(...undos.map(undo => undo.expires)) - Date.now()));
    return () => clearTimeout(timer);
  }, [undos]);
  useEffect(() => {
    if (!sources.length && !caption) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sources.length, caption]);
  // 替换先独立上传；新照片整理成功才替换草稿卡片，原记录在保存前始终不动。
  useEffect(() => {
    if (!replacement) return;
    const records = replacement.sources.map(source => files.find(file => file.meta.uploadId === source.key));
    if (records.some(record => !record?.progress.uploadComplete || !record.response?.body?.data)) return;
    const target = sources.find(source => source.key === replacement.target);
    if (!target) return;
    const replacementImage = replacement.sources[0];
    let current = true;
    // Uppy 的外部上传结果落到一次草稿更新；卸载或取消替换后不再应用。
    queueMicrotask(() => {
      if (!current) return;
      setSources(previous => previous.flatMap(source => source.key === target.key ? [...replacement.sources, source] : [source]));
      setRemoved(previous => new Set([...previous, target.key]));
      setCover(previous => previous === target.key ? replacementImage.key : previous);
      setReplacement(null);
    });
    return () => { current = false; };
  }, [replacement, files, sources]);
  function preview(file: File) { const url = URL.createObjectURL(file); urls.current.add(url); return url; }
  function enqueue(selected: File[]): DraftSource[] {
    const result: DraftSource[] = [];
    const failures: string[] = [];
    for (const file of selected) {
      const key = createUploadId();
      try {
        // 允许同一原文件在不同草稿位置再次使用；每次有独立上传标识。
        uppy!.addFile({ id: key, name: file.name, type: file.type, data: file, source: 'local', meta: { uploadId: key, relativePath: key } });
        result.push({ key, file, preview: preview(file) });
      } catch { failures.push(`「${file.name}」未能加入，请重新选择。`); }
    }
    if (failures.length) setRejected(current => [...current, ...failures]);
    return result;
  }
  function append(selected: File[]) {
    const added = enqueue(selected);
    setSources(current => [...current, ...added]);
    if (!hasAdded.current) {
      const first = added[0];
      if (first) { setCover(first.key); hasAdded.current = true; }
    }
  }
  const addFiles = async (selected: File[], target?: string | null) => {
    if (!uppy || busyInput || readLock.current) return;
    readLock.current = true; setReading(true); setError(''); setRejected([]); setOpen(true);
    try {
      const accepted: File[] = []; const failures: string[] = [];
      // 顺序读取文件头，避免一批大文件同时占用内存。
      for (const file of selected) { const reason = await validateSource(file); if (reason) failures.push(`「${file.name}」：${reason}`); else accepted.push(file); }
      if (!alive.current) return;
      setRejected(failures);
      if (target) {
        if (accepted.length !== 1 || failures.length) {
          setError('替换时请选择 1 张照片。原照片保持不变。'); return;
        }
        const next = enqueue(accepted);
        if (next.length === accepted.length) setReplacement({ target, sources: next });
        return;
      }
      if (images.length + accepted.length > MAX_PHOTOS) {
        setCandidates(accepted.map(file => ({ key: createUploadId(), file, preview: preview(file), selected: false })));
      } else append(accepted);
    } finally { readLock.current = false; if (alive.current) setReading(false); }
  };
  const addRef = useRef(addFiles); useEffect(() => { addRef.current = addFiles; });
  // 有未保存的草稿就回到草稿；否则直接弹出相册（必须在点击事件里同步调用）。
  const hasDraft = images.length > 0 || candidates.length > 0;
  useEffect(() => {
    if (!startRef) return;
    startRef.current = () => { if (hasDraft || busyInput || !uppy) setOpen(true); else picker.current?.click(); };
    return () => { startRef.current = null; };
  });
  useEffect(() => {
    if (!active) return;
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const clear = () => { depth = 0; setDragging(false); };
    const enter = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); depth++; setDragging(true); };
    const over = (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } };
    const leave = (event: DragEvent) => { if (!hasFiles(event)) return; depth = Math.max(0, depth - 1); if (!depth) clear(); };
    const drop = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); clear(); if (event.dataTransfer) void addRef.current(Array.from(event.dataTransfer.files)); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); window.removeEventListener('blur', clear); };
  }, [active]);
  function removeSource(source: DraftSource) {
    const keys = [source.key];
    setRemoved(current => new Set([...current, ...keys]));
    const oldCover = keys.includes(cover || '') ? cover : null;
    if (oldCover) setCover(null);
    setUndos(current => [...current, { keys, cover: oldCover, coverRevision: coverRevision.current, expires: Date.now() + 8000 }]);
  }
  function undoRemove() {
    const undo = undos.at(-1); if (!undo) return;
    const result = restoreRemoval(removed, undo, cover, coverRevision.current, images.length);
    if (!result) { setError('已选满 9 张，请先移除一张再撤销。'); return; }
    setRemoved(result.removed); setCover(result.cover); setUndos(current => current.slice(0, -1));
  }
  async function retry(source: DraftSource) {
    const file = fileByKey.get(source.key); if (!file) return;
    try { await uppy?.retryUpload(file.id); } catch { setError('重试未完成，请检查网络后再试。'); }
  }
  async function save() {
    if (saveLock.current || conflict || (!canSave && !pendingPayload.current)) return;
    saveLock.current = true; setSaving(true); setError('');
    pendingPayload.current ??= { entry_date: entryDate, caption: caption.trim(), upload_ids: assets.map(asset => asset.id), cover_upload_id: assetFor(images.find(source => source.key === cover)!)!.id, client_request_id: requestId.current, ...(entry ? { expected_updated_at: entry.updated_at } : {}) };
    setPendingSave(true);
    try {
      const result = entry ? await journalApi.edit(entry.id, pendingPayload.current as EditPayload) : await journalApi.create(pendingPayload.current);
      uppy?.clear(); setFiles([]); setSources([]); setRemoved(new Set()); setUndos([]); setCover(null); setCaption(''); setManualDate(null); hasAdded.current = false;
      for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear();
      requestId.current = createUploadId(); pendingPayload.current = null; setPendingSave(false); setOpen(false); onSaved(result.data);
    } catch (err) {
      if (err instanceof JournalError && err.status >= 400 && err.status < 500) {
        pendingPayload.current = null; setPendingSave(false);
        if (entry && err.status === 409) setConflict(true);
      }
      setError(err instanceof Error ? err.message : '保存未完成，草稿已保留。');
    } finally { setSaving(false); saveLock.current = false; }
  }
  const toggleCandidate = (key: string) => setCandidates(current => current.map(item => item.key === key ? { ...item, selected: !item.selected } : item));
  const selectedImages = candidates.filter(item => item.selected).length;
  const sourceStatus = (source: DraftSource) => {
    const file = fileByKey.get(source.key);
    if (file?.error) return /[\u4e00-\u9fff]/.test(file.error) ? file.error : '上传未完成，请检查网络后重试';
    if (!complete(source)) return `${file?.progress.percentage || 0}% · 上传与整理中`;
    return '';
  };
  // 模态弹窗打开时外部页面是 inert 的，选图控件要跟着进弹窗；关着时留在外面给首页按钮用。
  const pickers = <>
    <input ref={picker} type="file" hidden multiple accept={PHOTO_ACCEPT} onChange={event => { if (event.target.files?.length) void addFiles(Array.from(event.target.files)); event.target.value = ''; }} aria-label="选择照片" />
    <input ref={replacePicker} type="file" hidden accept={PHOTO_ACCEPT} onChange={event => { if (event.target.files?.length) void addFiles(Array.from(event.target.files), replaceTarget.current); event.target.value = ''; }} aria-label="选择替换照片" />
  </>;
  return <>
    {!open && pickers}
    {open && <Dialog className="journal-composer-dialog" title={entry ? '改一改这一顿' : '记一顿'} onClose={() => setOpen(false)} busy={saving || pendingSave}>
      <form className={`journal-composer ${dragging ? 'is-dragging' : ''}`} onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="journal-composer-scroll">
        {pickers}
        {candidates.length > 0 ? <section className="journal-candidates" aria-label="挑选本次照片">
          <h3>留哪几张，慢慢选。</h3><p>已有 {images.length} 张，还可加入 {9 - images.length} 张。已选 {selectedImages} 张照片。</p>
          <p className="journal-draft-note">确认前不会上传，最多留下 9 张照片。</p>
          <div className="journal-draft-grid">{candidates.map((item, index) => {
            const disabled = !item.selected && selectedImages >= MAX_PHOTOS - images.length;
            return <button type="button" key={item.key} className={`journal-candidate ${item.selected ? 'is-selected' : ''}`} aria-pressed={item.selected} disabled={disabled} onClick={() => toggleCandidate(item.key)} aria-label={`选择候选照片 ${index + 1} ${item.file.name}`}>
              <PhotoPreview src={item.preview} label={`候选照片 ${index + 1}`} fallbackName={item.file.name} />
              <span>{item.selected ? '✓ 已选择' : `照片 ${index + 1}`}</span>
            </button>;
          })}</div>
          {!selectedImages && <p className="journal-draft-note">点选想留下的照片。未选照片会留在你的设备上。</p>}
        </section> : <>
          <div className={`journal-dropzone${images.length ? ' has-photos' : ''}`}>{!images.length && <KitchenSketch kind="empty" />}<button type="button" className={images.length ? 'btn-ghost' : 'btn-primary'} disabled={!uppy || busyInput} onClick={() => picker.current?.click()}>{images.length ? '＋ 再加几张' : '＋ 从相册选照片'}</button><p>一次最多 9 张，原片完整保留</p></div>
          {images.length > 1 && <p className="journal-selection-count">{images.length} 张 · 点一张设为封面</p>}
          {(reading || (images.length > 0 && images.some(source => !complete(source) && !fileByKey.get(source.key)?.error))) && <div className="journal-uploading" role="status"><KitchenSketch kind="loading" /><span>{reading ? '正在看看是不是照片…' : '照片正在送进相册…'}</span></div>}
          <div className="journal-draft-grid">{images.map((source, index) => {
            const asset = assetFor(source); const file = fileByKey.get(source.key); const status = sourceStatus(source);
            const src = asset?.preview_url ? mediaUrl(asset.preview_url) : source.preview;
            const updating = replacement?.target === source.key;
            const working = !complete(source) && !file?.error;
            return <article key={source.key} data-upload-id={source.key} className={`journal-draft-photo ${cover === source.key ? 'is-cover' : ''}`}>
              <button type="button" className="journal-cover-choice" disabled={blocked || !!replacement || reading} aria-pressed={cover === source.key} aria-label={`将第 ${index + 1} 张照片选为封面`} onClick={() => { setCover(source.key); coverRevision.current++; }}><PhotoPreview key={src} src={src} label={`第 ${index + 1} 张照片`} /></button>
              <button type="button" className="journal-photo-remove" aria-label={`移除第 ${index + 1} 张照片`} disabled={blocked || !!replacement || working || reading} onClick={() => removeSource(source)}>×</button>
              <div className="journal-photo-tools"><span>{cover === source.key ? '✓ 当前封面' : ''}</span><button type="button" disabled={busyInput || working} onClick={() => { replaceTarget.current = source.key; replacePicker.current?.click(); }}>替换</button></div>
              {status && <p className={file?.error ? 'journal-error' : 'journal-draft-note'}>{status}</p>}
              {working && <progress value={file?.progress.percentage || 0} max={100} aria-label={`第 ${index + 1} 张上传进度`} />}
              {file?.error && <button type="button" disabled={blocked} onClick={() => void retry(source)}>重试上传</button>}
              {updating && <div className="journal-replacement" role="status"><p>新照片整理完成后替换，旧照片已保留。</p>{replacement.sources.map(next => <div key={next.key}><small>新照片：{complete(next) ? '已收到' : sourceStatus(next)}</small>{fileByKey.get(next.key)?.error && <button type="button" onClick={() => void retry(next)}>重试</button>}</div>)}<button type="button" onClick={() => { setReplacement(null); }}>取消替换</button></div>}
            </article>;
          })}</div>
          {!!undos.length && <div className="journal-undo" role="status">已从草稿移除<button type="button" disabled={blocked || !!replacement} onClick={undoRemove}>撤销</button><small>8 秒内可恢复</small></div>}
          {images.length > 0 && !cover && <p className="journal-warning" role="status">请选择新的封面，再保存这一餐。</p>}
          {images.length > 0 && <>
            <Field label={`哪一天${!manualDate && shotDate ? ' · 按照片拍摄日' : ''}`}><input type="date" required value={entryDate} disabled={blocked} onChange={event => setManualDate(event.target.value || null)} /></Field>
            <Field label="说两句 · 不写也行"><textarea maxLength={2000} value={caption} disabled={blocked} onChange={event => setCaption(event.target.value)} placeholder="吃了什么、谁做的、味道怎么样……可以点键盘上的话筒直接说" rows={3} /></Field>
          </>}

          {conflict && <p className="journal-warning">这篇手记已在其他页面修改，当前草稿未覆盖它。请先保留需要的文字，再取消编辑、刷新后重新整理。</p>}
          {pendingSave && !saving && <p className="journal-warning">保存结果尚未确认。请点击“核对并重试”，核对前暂时不能改稿或关闭面板。</p>}
        </>}
        {!!rejected.length && <div className="journal-error" role="alert"><strong>这些文件没有加入</strong><ul>{rejected.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
        {error && <p className="journal-error" role="alert">{error}</p>}
        </div>
        <div className="journal-composer-footer">
          <span>{candidates.length ? `已选 ${selectedImages} / ${MAX_PHOTOS - images.length} 张` : ''}</span>
          <div className="journal-form-footer">{candidates.length ? <>
            <button type="button" className="btn-ghost" onClick={() => setCandidates([])}>返回整理</button>
            <button type="button" className="btn-primary" disabled={!selectedImages} onClick={() => { append(candidates.filter(item => item.selected).map(item => item.file)); setCandidates([]); }}>加入所选 {selectedImages} 张</button>
          </> : <>
            <button type="button" className="btn-ghost" disabled={saving || pendingSave} onClick={() => setOpen(false)}>{entry ? '取消编辑' : '稍后再记'}</button>
            <button className="btn-primary" disabled={saving || conflict || (!canSave && !pendingSave)}>{saving ? '正在保存…' : pendingSave ? '核对并重试' : entry ? '保存修改' : images.length && !canSave ? '照片还在上传…' : '好了，记下'}</button>
          </>}</div>
        </div>
      </form>
    </Dialog>}
    {dragging && !open && <div className="journal-drop-overlay" aria-hidden="true">松开，把照片放进这一餐<small>可以一次拖入多张 · 原文件保留</small></div>}
  </>;
}
