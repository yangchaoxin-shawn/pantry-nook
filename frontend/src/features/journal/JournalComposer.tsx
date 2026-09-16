import { useCallback, useEffect, useRef, useState } from 'react';
import Uppy, { type UppyFile } from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import { Dialog, Field } from '../../shared/ui/Primitives';
import { localDate } from '../../shared/api/client';
import { journalApi, mediaUrl, uploadPairing, type UploadedAsset } from './api';

type UploadMeta = { uploadId: string; [key: string]: unknown };
type UploadBody = { data: UploadedAsset; [key: string]: unknown };
type QueueFile = UppyFile<UploadMeta, UploadBody>;
export default function JournalComposer({ active, open, setOpen, onSaved }: { active: boolean; open: boolean; setOpen: (open: boolean) => void; onSaved: () => void }) {
  const [uppy, setUppy] = useState<Uppy<UploadMeta, UploadBody> | null>(null);
  const [files, setFiles] = useState<QueueFile[]>([]);
  const [entryDate, setEntryDate] = useState(localDate);
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const saveLock = useRef(false);
  // 一旦提交过，重试必须复用同一份负载，防止网络结果不明时改稿造成重复发布。
  const pendingPayload = useRef<Parameters<typeof journalApi.create>[0] | null>(null);
  const [pendingSave, setPendingSave] = useState(false);
  useEffect(() => {
    const queue = new Uppy<UploadMeta, UploadBody>({ autoProceed: true, locale: { pluralize: () => 0, strings: {
      youCanOnlyUploadX: { 0: '每篇最多 %{smart_count} 个源文件', 1: '每篇最多 %{smart_count} 个源文件' },
      exceedsSize: '%{file} 超过单文件大小限制 %{size}',
      youCanOnlyUploadFileTypes: '请选择 JPG、PNG、WebP、HEIC / HEIF 或实况对应的 MOV 文件',
      noMoreFilesAllowed: '本篇已达到文件数量上限', noDuplicates: '「%{fileName}」已经在本次队列中',
      failedToUpload: '「%{file}」上传未完成，可单独重试', noInternetConnection: '网络已断开，请连接后重试',
    } }, restrictions: {
      maxNumberOfFiles: 18, maxFileSize: 50 * 1024 * 1024,
      allowedFileTypes: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.mov'],
    } }).use(XHRUpload, {
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
        if (!asset?.id || !['image', 'video'].includes(asset.kind) || !asset.original_url) throw new Error('未收到完整的上传结果，请重试核对原文件。');
      },
    });
    const update = () => setFiles(queue.getFiles());
    queue.on('file-added', update).on('file-removed', update).on('upload-progress', update).on('upload-success', update).on('upload-error', update).on('upload', update);
    let active = true;
    queueMicrotask(() => { if (active) setUppy(queue); });
    return () => { active = false; queue.destroy(); };
  }, []);
  const assets = files.flatMap(file => file.progress.uploadComplete && file.response?.body?.data ? [file.response.body.data] : []);
  const pairing = uploadPairing(assets);
  const uploading = files.some(file => !file.error && !file.progress.uploadComplete);
  const canSave = files.length > 0 && assets.length === files.length && pairing.images.length > 0 && pairing.images.length <= 9 && !pairing.unmatched.length && !removing;
  useEffect(() => {
    if (!files.length && !caption) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [files.length, caption]);
  const addFiles = useCallback((selected: File[]) => {
    if (!uppy || saving || pendingSave || removing) return;
    const messages: string[] = [];
    let imageCount = uppy.getFiles().filter(file => !/\.mov$/i.test(file.name || '')).length;
    for (const file of selected) {
      if (!/\.mov$/i.test(file.name) && imageCount >= 9) { messages.push('每篇最多 9 张照片，对应的实况视频可一起加入。'); continue; }
      try {
        uppy.addFile({ name: file.name, type: file.type, data: file, source: 'local', meta: { uploadId: crypto.randomUUID() } });
        if (!/\.mov$/i.test(file.name)) imageCount++;
      } catch (err) { messages.push(`「${file.name}」未加入：${err instanceof Error ? err.message : '请检查文件格式和大小。'}`); }
    }
    setError([...new Set(messages)].join(' '));
    setOpen(true);
  }, [uppy, saving, pendingSave, removing, setOpen]);
  useEffect(() => {
    if (!active) return;
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const enter = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); depth++; setDragging(true); };
    const over = (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = saving || pendingSave ? 'none' : 'copy'; } };
    const clear = () => { depth = 0; setDragging(false); };
    const leave = (event: DragEvent) => { if (!hasFiles(event)) return; depth = Math.max(0, depth - 1); if (!depth) clear(); };
    const drop = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); clear(); if (event.dataTransfer) addFiles(Array.from(event.dataTransfer.files)); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); window.removeEventListener('blur', clear); };
  }, [active, saving, pendingSave, addFiles]);
  async function removeFile(file: QueueFile) {
    if (!uppy || removing) return;
    setRemoving(file.id); setError('');
    try {
      if (file.response?.body?.data) await journalApi.cancelUpload(file.response.body.data.id);
      uppy.removeFile(file.id);
    } catch (err) { setError(err instanceof Error ? err.message : '暂时无法移除，请重试。'); }
    finally { setRemoving(null); }
  }
  async function save() {
    if (saveLock.current || (!canSave && !pendingPayload.current)) return;
    saveLock.current = true; setSaving(true); setError('');
    pendingPayload.current ??= { entry_date: entryDate, caption: caption.trim(), upload_ids: assets.map(asset => asset.id), client_request_id: requestId.current };
    setPendingSave(true);
    try {
      await journalApi.create(pendingPayload.current);
      uppy?.clear(); setFiles([]); setCaption(''); setEntryDate(localDate()); requestId.current = crypto.randomUUID();
      pendingPayload.current = null; setPendingSave(false); setOpen(false); onSaved();
    } catch (err) {
      // 明确业务拒绝可继续改稿；网络或 5xx 结果不明时保留同一请求再核对。
      if (err instanceof Error && 'status' in err && typeof err.status === 'number' && err.status >= 400 && err.status < 500) { pendingPayload.current = null; setPendingSave(false); }
      setError(err instanceof Error ? err.message : '保存未完成，草稿已保留。');
    } finally { setSaving(false); saveLock.current = false; }
  }
  return <>
    {open && <Dialog title="记下这一餐" onClose={() => setOpen(false)} busy={saving}>
      <form className={`journal-composer ${dragging ? 'is-dragging' : ''}`} onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="journal-dropzone">
          <button type="button" className="btn-primary" disabled={!uppy || saving || pendingSave || !!removing} onClick={() => picker.current?.click()}>＋ 从相册选照片</button>
          <p>也可以把照片拖到这里。<br />每篇 9 张照片 · 实况原片与对应 MOV 可一起选择</p>
          <input ref={picker} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.mov,video/quicktime" onChange={event => { if (event.target.files) addFiles(Array.from(event.target.files)); event.target.value = ''; }} aria-label="选择照片及实况视频" />
        </div>
        {files.length > 0 && <ul className="journal-upload-list">{files.map(file => {
          const asset = file.response?.body?.data;
          return <li key={file.id} data-upload-id={file.meta.uploadId}>
            {asset?.thumbnail_url ? <img src={mediaUrl(asset.thumbnail_url)} alt="已上传照片预览" /> : <span className="journal-file-mark" aria-hidden="true">{ /\.mov$/i.test(file.name || '') ? '▷' : '▧' }</span>}
            <div><strong>{file.name}</strong><small>{file.error ? (/[\u4e00-\u9fff]/.test(file.error) ? file.error : '上传未完成，请检查网络后单张重试。') : file.progress.uploadComplete ? (asset?.kind === 'video' ? '动态片段已收到' : asset?.id === pairing.images[0]?.id ? '已收到 · 封面' : '原片已收到') : `${file.progress.percentage ?? 0}% · 上传与整理中`}</small><progress value={file.progress.percentage ?? 0} max={100} aria-label={`${file.name} 上传进度`} /></div>
            <div className="journal-upload-actions">{file.error && <button type="button" disabled={saving || pendingSave || !!removing} onClick={() => { void uppy?.retryUpload(file.id).catch(err => setError(String(err))); }}>重试</button>}<button type="button" disabled={saving || pendingSave || !!removing} onClick={() => void removeFile(file)} aria-label={`移除 ${file.name}`}>{removing === file.id ? '移除中' : '移除'}</button></div>
          </li>;
        })}</ul>}
        {!!pairing.unmatched.length && <p className="journal-warning" role="status">有 {pairing.unmatched.length} 个动态片段未找到对应照片。请补充同一张实况的原片，或移除该视频后保存。</p>}
        {!!pairing.missing.length && <p className="journal-warning" role="status">{pairing.missing.length} 张实况缺少动态片段。可继续补充对应 MOV，也可以先保存静态照片。</p>}
        <p className="journal-preserve">◎ 原文件，为你保留。<small>收到的文件完整保存；日常浏览使用另生成的预览图。单个文件不超过 50 MiB。</small></p>
        <Field label="这一天"><input type="date" required value={entryDate} disabled={saving || pendingSave} onChange={event => setEntryDate(event.target.value)} /></Field>
        <Field label="留一句话 · 不写也可以"><textarea maxLength={2000} value={caption} disabled={saving || pendingSave} onChange={event => setCaption(event.target.value)} placeholder="今天的饭，有什么想记住的？" rows={3} /></Field>
        <details className="journal-motion-help"><summary>怎样留下完整实况？</summary><p>iPhone / iPad 请把导出的未修改照片与对应 MOV 一起选择；安卓选择原始动态照片。系统会按真实配对信息识别。微信保存的普通 JPG 若已丢失动态，无法在这里还原。</p></details>
        {error && <p className="journal-error" role="alert">{error}</p>}
        {pendingSave && !saving && <p className="journal-warning">保存结果尚未确认，点击“核对并重试”会复用同一次请求。核对完成前暂时不能改稿。</p>}
        <div className="journal-form-footer"><span>{pairing.images.length} 张已就绪{uploading ? ' · 正在整理' : ''}</span><button className="btn-primary" disabled={saving || (!canSave && !pendingSave)}>{saving ? '正在保存…' : pendingSave ? '核对并重试' : '保存这一餐'}</button></div>
        <p className="journal-draft-note">关闭面板会保留本次草稿；刷新或关闭网页后未发布草稿不会保留。</p>
      </form>
    </Dialog>}
    {dragging && !open && <div className="journal-drop-overlay" aria-hidden="true">松开，把照片放进这一餐<small>可以一次拖入多张 · 原文件保留</small></div>}
  </>;
}
