import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPairing, type UploadedAsset } from './api';

function asset(id: string, kind: UploadedAsset['live_kind'], pair: string | null): UploadedAsset {
  return { id, kind: kind === 'apple_video' ? 'video' : 'image', live_kind: kind, pair_identifier: pair, original_name: `${id}.heic`, original_size: 100, sha256: 'test', width: 3000, height: 4000, preview_width: 1920, preview_height: 2560, preview_url: `/api/journal/media/${id}/preview`, thumbnail_url: null, original_url: `/api/journal/media/${id}/original`, video_url: null };
}
describe('实况队列的发布提示', () => {
  it('MOV 先到仍按配对标识匹配，不依赖选择顺序或文件名', () => {
    const result = uploadPairing([asset('video', 'apple_video', 'pair-a'), asset('unrelated', 'still', null), asset('photo', 'apple_photo', 'pair-a')]);
    expect(result.images).toHaveLength(2); expect(result.unmatched).toHaveLength(0); expect(result.missing).toHaveLength(0);
  });
  it('错配视频阻止发布提示，Apple 只传照片明确缺动态', () => {
    const result = uploadPairing([asset('photo', 'apple_photo', 'pair-a'), asset('video', 'apple_video', 'pair-b')]);
    expect(result.missing.map(item => item.id)).toEqual(['photo']); expect(result.unmatched.map(item => item.id)).toEqual(['video']);
  });
  it('同一实况重复原片和MOV可被明确识别，多余MOV留作可移除冲突', () => {
    const result = uploadPairing([asset('photo', 'apple_photo', 'pair-a'), asset('photo-again', 'apple_photo', 'pair-a'), asset('video', 'apple_video', 'pair-a'), asset('video-again', 'apple_video', 'pair-a')]);
    expect(result.duplicateImages.map(item => item.id)).toEqual(['photo-again']);
    expect(result.duplicateVideos.map(item => item.id)).toEqual(['video-again']);
    expect(result.unmatched.map(item => item.id)).toEqual(['video-again']);
    expect(result.missing).toEqual([]);
  });
  it('普通图片和安卓内嵌视频不被错误要求另传 MOV', () => {
    const result = uploadPairing([asset('still', 'still', null), asset('android', 'motion_photo', null)]);
    expect(result.missing).toEqual([]); expect(result.unmatched).toEqual([]);
  });
});
describe('手记独立 API', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
  it('子路径同时应用于接口和媒体，发布 UUID 原样保留', async () => {
    vi.stubEnv('VITE_API_BASE', '/pantry-nook/'); vi.resetModules();
    const { mediaUrl, journalApi } = await import('./api');
    expect(mediaUrl('/api/journal/media/test/original')).toBe('/pantry-nook/api/journal/media/test/original');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: 1 } }), { status: 201 })); vi.stubGlobal('fetch', fetcher);
    const payload = { entry_date: '2026-09-16', caption: '', upload_ids: ['upload'], cover_upload_id: 'cover-id', client_request_id: 'same-request' };
    await journalApi.create(payload);
    expect(fetcher.mock.calls[0][0]).toBe('/pantry-nook/api/journal/entries'); expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(payload);
  });
  it('编辑完整照片集合与封面、原版本、幂等键原样提交，网络重试不改变负载', async () => {
    const { journalApi } = await import('./api');
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('断网')).mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 7 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const payload = { entry_date: '2026-09-16', caption: '晚饭', upload_ids: ['b', 'a'], cover_upload_id: 'a', client_request_id: 'same-edit', expected_updated_at: '2026-09-16T10:00:00Z' };
    await expect(journalApi.edit(7, payload)).rejects.toThrow('尚未确认保存结果');
    await journalApi.edit(7, payload);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(['PATCH', 'PATCH']);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(payload);
  });
  it('后端版本冲突保留明确状态，不当作成功或吞掉错误', async () => {
    const { journalApi } = await import('./api');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'RECORD_CHANGED', message: '手记已被修改' } }), { status: 409 })));
    await expect(journalApi.remove(7)).rejects.toMatchObject({ message: '手记已被修改', status: 409 });
  });
});
