import { describe, expect, it } from 'vitest';
import Uppy from '@uppy/core';
import { coverFirst, restoreRemoval, validateSource, type Removal } from './draft';
import type { JournalEntry, JournalPhoto } from './api';

const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);
describe('文件进入上传队列前的边界', () => {
  it('接受照片文件头，拒绝文档和伪装照片；选择与拖入共用此校验', async () => {
    expect(await validateSource(new File([jpeg], '照片.JPG', { type: 'image/jpeg' }))).toBeNull();
    expect(await validateSource(new File(['%PDF-document'], '记录.pdf'))).toContain('不支持此格式');
    expect(await validateSource(new File(['%PDF-document'], '记录.jpg', { type: 'image/jpeg' }))).toContain('内容与照片格式不符');
    expect(await validateSource(new File(['<svg/>'], '矢量.svg'))).toContain('不支持此格式');
    expect(await validateSource(new File([], '空照片.png'))).toBe('文件为空');
  });
  it('大小在读取文件头前检查，不将大文件加载进内存', async () => {
    let read = false;
    const file = { name: 'large.jpg', size: 50 * 1024 * 1024 + 1, slice: () => { read = true; throw new Error('不应读取'); } } as unknown as File;
    expect(await validateSource(file)).toContain('50 MiB'); expect(read).toBe(false);
  });
  it('HEIC 和 MOV 区分文件头；MOV 格式通过仍需后端识别实况标识', async () => {
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic0000mif1')]);
    const movie = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypqt  0000qt  ')]);
    expect(await validateSource(new File([heic], '原片.heic'))).toBeNull();
    expect(await validateSource(new File([movie], '动态.mov'))).toBeNull();
    expect(await validateSource(new File([heic], '错误.mov'))).not.toBeNull();
  });
  it('同一文件重新选择具有独立队列ID，不被Uppy自身重复检查拦截', () => {
    const uppy = new Uppy({ autoProceed: false });
    const file = new File([jpeg], '相同原片.jpg', { type: 'image/jpeg', lastModified: 123 });
    const first = uppy.addFile({ name: file.name, type: file.type, data: file, meta: { relativePath: 'first', uploadId: 'first' } });
    const second = uppy.addFile({ name: file.name, type: file.type, data: file, meta: { relativePath: 'second', uploadId: 'second' } });
    expect(first).not.toBe(second); expect(uppy.getFiles()).toHaveLength(2);
    expect(uppy.getFiles().map(item => item.name)).toEqual(['相同原片.jpg', '相同原片.jpg']);
    uppy.destroy();
  });
});
describe('封面和撤销保持用户后续选择', () => {
  const undo: Removal = { keys: ['photo', 'motion'], cover: 'photo', coverRevision: 4, expires: 9999999999999 };
  it('整组恢复照片及实况；恢复封面而不更改源数组位置', () => {
    const result = restoreRemoval(new Set(['photo', 'motion', 'other']), undo, null, 4, 2, true)!;
    expect([...result.removed]).toEqual(['other']); expect(result.cover).toBe('photo');
  });
  it('不覆盖后来点选的新封面；用户选后又移除也不恢复旧选择', () => {
    expect(restoreRemoval(new Set(undo.keys), undo, 'new', 5, 2, true)?.cover).toBe('new');
    expect(restoreRemoval(new Set(undo.keys), undo, null, 5, 2, true)?.cover).toBeNull();
  });
  it('满9张禁止撤销图片，不将MOV本身计为照片', () => {
    expect(restoreRemoval(new Set(undo.keys), undo, 'new', 5, 9, true)).toBeNull();
    expect(restoreRemoval(new Set(['motion']), { ...undo, keys: ['motion'], cover: null }, 'new', 5, 9, false)).not.toBeNull();
  });
  it('展示以封面开始，其他照片相对顺序和原记录不变', () => {
    const photos = ['a', 'b', 'c', 'd'].map(id => ({ id, image: { id } }) as JournalPhoto);
    const entry = { cover_upload_id: 'c', photos } as JournalEntry;
    expect(coverFirst(entry).map(photo => photo.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(photos.map(photo => photo.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
