import type { components } from "../../shared/api/schema";
export type UploadedAsset = components["schemas"]["UploadedAsset"];
export type JournalPhoto = components["schemas"]["JournalPhoto"];
export type JournalEntry = components["schemas"]["JournalEntry"];
export type EntryPayload = components["schemas"]["EntryCreate"] & { cover_upload_id: string };
export type EditPayload = components["schemas"]["EntryUpdate"] & Pick<EntryPayload, "upload_ids" | "cover_upload_id" | "client_request_id">;
export type Envelope<T> = { data: T; meta?: { total: number; limit: number; offset: number } };
export const JOURNAL_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
export function mediaUrl(path: string | null) { return path ? `${JOURNAL_BASE}${path}` : ''; }
export class JournalError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function request<T>(path: string, method = 'GET', payload?: unknown, signal?: AbortSignal): Promise<Envelope<T>> {
  const response = await fetch(mediaUrl(`/api/journal${path}`), {
    method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }).catch((error) => {
    if (signal?.aborted) throw error;
    throw new Error(method === 'GET' ? '暂时读不到手记，请检查网络后重试。' : method === 'DELETE' ? '尚未确认删除结果，请检查网络后重试核对。' : '尚未确认保存结果。草稿已保留，请重试核对。');
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new JournalError(body?.error?.message || `请求未完成（${response.status}），请重试。`, response.status);
  if (!body || !('data' in body)) throw new Error('收到的手记数据格式不正确，请重试。');
  return body;
}
export const journalApi = {
  list: (month: string, offset = 0, signal?: AbortSignal) => request<JournalEntry[]>(`/entries?limit=20&offset=${offset}${month ? `&month=${encodeURIComponent(month)}` : ''}`, 'GET', undefined, signal),
  create: (payload: EntryPayload) => request<JournalEntry>('/entries', 'POST', payload),
  edit: (id: number, payload: EditPayload) => request<JournalEntry>(`/entries/${id}`, 'PATCH', payload),
  remove: (id: number) => request<unknown>(`/entries/${id}`, 'DELETE'),
  cancelUpload: (id: string) => request<unknown>(`/uploads/${id}`, 'DELETE'),
};
export function monthLabel(month: string) { return `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5, 7))} 月`; }
export function uploadPairing(assets: UploadedAsset[]) {
  const images = assets.filter(asset => asset.kind === 'image');
  const videos = assets.filter(asset => asset.kind === 'video');
  const duplicateVideos = videos.filter((video, index) => video.pair_identifier && videos.findIndex(other => other.pair_identifier === video.pair_identifier) !== index);
  const duplicateImages = images.filter((image, index) => image.pair_identifier && images.findIndex(other => other.pair_identifier === image.pair_identifier) !== index);
  const unmatched = videos.filter(video => duplicateVideos.includes(video) || !video.pair_identifier || !images.some(image => image.live_kind === 'apple_photo' && image.pair_identifier === video.pair_identifier));
  const missing = images.filter(image => image.live_kind === 'apple_photo' && !videos.some(video => video.pair_identifier && video.pair_identifier === image.pair_identifier));
  return { images, unmatched, missing, duplicateVideos, duplicateImages };
}
