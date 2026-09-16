import type { JournalEntry, UploadedAsset } from './api';

export const MAX_PHOTOS = 9;
export const MAX_SOURCE_SIZE = 50 * 1024 * 1024;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
export type DraftSource = { key: string; file?: File; asset?: UploadedAsset; preview?: string };
export type Removal = { keys: string[]; cover: string | null; coverRevision: number; expires: number };
export function coverFirst(entry: JournalEntry) {
  return [...entry.photos].sort((a, b) => Number(b.image.id === entry.cover_upload_id) - Number(a.image.id === entry.cover_upload_id));
}
export function restoreRemoval(removed: Set<string>, undo: Removal, cover: string | null, coverRevision: number, currentCount: number) {
  if (currentCount + undo.keys.filter(key => removed.has(key)).length > MAX_PHOTOS) return null;
  return { removed: new Set([...removed].filter(key => !undo.keys.includes(key))), cover: !cover && coverRevision === undo.coverRevision ? undo.cover : cover };
}
/** 扩展名与文件头一起预检；最终是否是真实可解码照片，仍由后端判断。 */
export async function validateSource(file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) return '不支持此格式，请选择 JPG、PNG、WebP、HEIC / HEIF';
  if (!file.size) return '文件为空';
  if (file.size > MAX_SOURCE_SIZE) return '超过单个文件 50 MiB 限制';
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer()); } catch { return '无法读取，请重新选择原文件'; }
  const text = new TextDecoder('latin1').decode(bytes);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = text.slice(0, 4) === 'RIFF' && text.slice(8, 12) === 'WEBP';
  const heif = text.slice(4, 8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8));
  const valid = ext === 'jpg' || ext === 'jpeg' ? jpeg : ext === 'png' ? png : ext === 'webp' ? webp : heif;
  return valid ? null : '文件内容与照片格式不符，改后缀不能转成图片';
}
