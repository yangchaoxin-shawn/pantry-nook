"""饭桌手记：上传独立处理，发布与归属只在短事务内写入。"""
from __future__ import annotations

from datetime import date
import errno
import hashlib
import json
import os
from pathlib import Path
import shutil
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Header, Query, Response, UploadFile
from fastapi.responses import FileResponse

from ..db import get_pool
from ..errors import AppError, conflict, not_found, validation_error
from ..journal_media import MAX_FILE_BYTES, PROCESS_LOCK, check_space, media_root, process_media, safe_path
from ..journal_models import EntryCreate, EntryUpdate, EntryResponse, EntryListResponse, UploadResponse, JournalDeleteResponse

router = APIRouter()


def asset(row) -> dict:
    details = row['details']
    if isinstance(details, str):
        details = json.loads(details)
    base = f"/api/journal/media/{row['id']}"
    return {**{k: details[k] for k in ('kind', 'live_kind', 'pair_identifier', 'width', 'height', 'preview_width', 'preview_height')},
            **{k: row[k] for k in ('id', 'sha256', 'original_name', 'original_size')},
            'original_url': base + '/original',
            'preview_url': base + '/preview' if details['kind'] == 'image' else None,
            'thumbnail_url': base + '/thumbnail' if details['kind'] == 'image' else None,
            'video_url': base + '/motion' if details['motion'] else None}


def photos(rows) -> list[dict]:
    assets = [asset(row) for row in rows]
    images = [a for a in assets if a['kind'] == 'image']
    videos = [a for a in assets if a['kind'] == 'video']
    if not 1 <= len(images) <= 9:
        raise validation_error('每篇手记需要 1 至 9 张照片')
    pairs = [a['pair_identifier'] for a in images if a['pair_identifier']]
    if len(set(pairs)) != len(pairs):
        raise validation_error('同一实况照片请只选择一份原片')
    video_pairs = [a['pair_identifier'] for a in videos]
    if len(set(video_pairs)) != len(video_pairs) or any(p not in pairs for p in video_pairs):
        raise validation_error('动态片段缺少匹配的原片，请选择同一张实况的照片与 MOV')
    result = []
    for image in images:
        video = next((v for v in videos if v['pair_identifier'] == image['pair_identifier']), None)
        url = image['video_url'] or (video['video_url'] if video else None)
        result.append({'id': image['id'], 'image': image, 'motion': video,
                       'live_status': 'live' if url else ('missing_video' if image['live_kind'] == 'apple_photo' else 'still'),
                       'video_url': url})
    return result


async def entry(conn, row) -> dict:
    rows = await conn.fetch('SELECT * FROM journal_uploads WHERE entry_id=$1 ORDER BY position', row['id'])
    return {**{k: row[k] for k in ('id', 'entry_date', 'caption', 'created_at', 'updated_at')}, 'photos': photos(rows)}


@router.post('/uploads', response_model=UploadResponse, status_code=201)
async def upload(response: Response, file: UploadFile = File(...), x_upload_id: UUID = Header(...)):
    root = media_root()
    check_space(root)
    stage = root / 'staging' / str(uuid4())
    stage.mkdir(parents=True)
    original = stage / 'original'
    digest, size = hashlib.sha256(), 0
    claimed = False
    pool = await get_pool()
    try:
        with original.open('wb') as target:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise AppError(413, 'UPLOAD_TOO_LARGE', '单个文件不得超过 50 MiB')
                digest.update(chunk)
                target.write(chunk)
        if not size:
            raise validation_error('不能上传空文件')
        checksum = digest.hexdigest()
        async with pool.acquire() as conn:
            # 会话锁仅限制昂贵解码并发，不开启长事务。进程退出后 PostgreSQL 自动释放。
            locked = await conn.fetchval('SELECT pg_try_advisory_lock($1)', PROCESS_LOCK)
            if not locked:
                raise AppError(429, 'MEDIA_BUSY', '另一张照片正在处理中，请稍后重试')
            try:
                async with conn.transaction():
                    await conn.execute('''INSERT INTO journal_uploads(id,sha256,status,original_name,original_size)
                        VALUES($1,$2,'failed',$3,$4) ON CONFLICT(id) DO NOTHING''',
                        x_upload_id, checksum, (file.filename or '照片').replace('\\', '/').split('/')[-1][:255], size)
                    row = await conn.fetchrow('SELECT *, updated_at < now() - interval \'3 minutes\' AS stale FROM journal_uploads WHERE id=$1 FOR UPDATE', x_upload_id)
                    if row['sha256'] != checksum:
                        raise conflict('上传标识已用于其他文件，请重新选择文件')
                    if row['status'] == 'ready':
                        if row['entry_id'] and await conn.fetchval('SELECT deleted_at IS NOT NULL FROM journal_entries WHERE id=$1', row['entry_id']):
                            raise conflict('这份上传所属手记已删除，请重新选择文件')
                        response.status_code = 200
                        return {'data': asset(row)}
                    if row['status'] == 'cancelled':
                        raise conflict('这份上传已取消，请重新选择文件')
                    if row['status'] == 'processing' and not row['stale']:
                        raise conflict('照片正在处理中，请稍后重试')
                    await conn.execute("UPDATE journal_uploads SET status='processing',updated_at=clock_timestamp() WHERE id=$1", x_upload_id)
                    claimed = True
                details = await process_media(stage)
                check_space(root)
                relative = f'assets/{x_upload_id}/{uuid4()}'
                destination = safe_path(relative)
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(stage, destination)
                async with conn.transaction():
                    row = await conn.fetchrow("UPDATE journal_uploads SET status='ready',details=$2,storage_path=$3,updated_at=clock_timestamp() WHERE id=$1 AND status='processing' RETURNING *", x_upload_id, details, relative)
                    if not row:
                        raise conflict('上传已取消，请重新选择文件')
                return {'data': asset(row)}
            finally:
                await conn.execute('SELECT pg_advisory_unlock($1)', PROCESS_LOCK)
    except BaseException as exc:
        if claimed:
            await pool.execute("UPDATE journal_uploads SET status='failed',updated_at=clock_timestamp() WHERE id=$1 AND status='processing'", x_upload_id)
        if isinstance(exc, OSError) and exc.errno in (errno.ENOSPC, errno.EDQUOT):
            raise AppError(507, 'MEDIA_STORAGE_FULL', '图片存储空间不足，请稍后再试') from exc
        raise
    finally:
        await file.close()
        if stage.exists():
            shutil.rmtree(stage)


@router.delete('/uploads/{upload_id}', response_model=JournalDeleteResponse)
async def cancel_upload(upload_id: UUID):
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow('SELECT * FROM journal_uploads WHERE id=$1 FOR UPDATE', upload_id)
        if not row:
            raise not_found('上传')
        if row['entry_id']:
            raise conflict('照片已保存到手记，不能取消上传')
        if row['status'] == 'processing':
            raise conflict('照片正在处理中，请处理完成后再移除')
        await conn.execute("UPDATE journal_uploads SET status='cancelled',updated_at=clock_timestamp() WHERE id=$1", upload_id)
    return {'data': {'deleted': True}}


@router.get('/media/{upload_id}/{variant}', response_class=FileResponse, operation_id='journal_media_get')
@router.head('/media/{upload_id}/{variant}', response_class=FileResponse, operation_id='journal_media_head')
async def media(upload_id: UUID, variant: Literal['original', 'preview', 'thumbnail', 'motion']):
    pool = await get_pool()
    row = await pool.fetchrow("""SELECT u.* FROM journal_uploads u LEFT JOIN journal_entries e ON e.id=u.entry_id
        WHERE u.id=$1 AND u.status='ready' AND (u.entry_id IS NULL OR e.deleted_at IS NULL)""", upload_id)
    if not row:
        raise not_found('图片')
    details = row['details']
    if (variant in ('preview', 'thumbnail') and details['kind'] != 'image') or (variant == 'motion' and not details['motion']):
        raise not_found('图片')
    name = {'original': 'original', 'preview': 'preview.jpg', 'thumbnail': 'thumbnail.jpg', 'motion': 'motion.mp4'}[variant]
    path = safe_path(row['storage_path']) / name
    if not path.is_file():
        raise not_found('图片')
    return FileResponse(path, media_type=details['mime'] if variant == 'original' else ('video/mp4' if variant == 'motion' else 'image/jpeg'),
                        filename=row['original_name'] if variant == 'original' else None,
                        headers={'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})


@router.get('/entries', response_model=EntryListResponse)
async def list_entries(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
                       month: str | None = Query(None, pattern=r'^\d{4}-\d{2}$')):
    start, end = None, None
    if month:
        try:
            start = date.fromisoformat(month + '-01')
            end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
        except ValueError:
            raise validation_error('月份格式不正确')
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction(isolation='repeatable_read', readonly=True):
        where = 'deleted_at IS NULL AND ($1::date IS NULL OR entry_date >= $1) AND ($2::date IS NULL OR entry_date < $2)'
        total = await conn.fetchval('SELECT COUNT(*) FROM journal_entries WHERE ' + where, start, end)
        rows = await conn.fetch('SELECT * FROM journal_entries WHERE ' + where + ' ORDER BY entry_date DESC,id DESC LIMIT $3 OFFSET $4', start, end, limit, offset)
        return {'data': [await entry(conn, row) for row in rows], 'meta': {'total': total, 'limit': limit, 'offset': offset}}


@router.post('/entries', response_model=EntryResponse, status_code=201)
async def create_entry(body: EntryCreate, response: Response):
    if len(set(body.upload_ids)) != len(body.upload_ids):
        raise validation_error('不能重复添加同一份上传')
    payload = body.model_dump(mode='json', exclude={'client_request_id'})
    checksum = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        # 发布与删除锁只覆盖短事务；统一锁序避免同资源并发发布及取消竞态。
        await conn.execute('SELECT pg_advisory_xact_lock($1)', PROCESS_LOCK + 1)
        previous = await conn.fetchrow('SELECT * FROM journal_entries WHERE client_request_id=$1', body.client_request_id)
        if previous:
            if previous['request_sha256'] != checksum or previous['deleted_at']:
                raise conflict('这次发布标识已被使用，请重新打开编辑窗口')
            response.status_code = 200
            return {'data': await entry(conn, previous)}
        rows = await conn.fetch('SELECT * FROM journal_uploads WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', body.upload_ids)
        if len(rows) != len(body.upload_ids) or any(r['status'] != 'ready' or r['entry_id'] is not None for r in rows):
            raise conflict('部分照片尚未就绪、已取消或已保存，请检查后重试')
        ordered = sorted(rows, key=lambda r: body.upload_ids.index(r['id']))
        photos(ordered)
        row = await conn.fetchrow('''INSERT INTO journal_entries(client_request_id,request_sha256,entry_date,caption)
            VALUES($1,$2,$3,$4) RETURNING *''', body.client_request_id, checksum, body.entry_date, body.caption)
        for position, upload_id in enumerate(body.upload_ids):
            await conn.execute('UPDATE journal_uploads SET entry_id=$2,position=$3,updated_at=clock_timestamp() WHERE id=$1', upload_id, row['id'], position)
        return {'data': await entry(conn, row)}


@router.patch('/entries/{entry_id}', response_model=EntryResponse)
async def update_entry(entry_id: int, body: EntryUpdate):
    if body.expected_updated_at.tzinfo is None:
        raise validation_error('版本时间必须包含时区')
    pool = await get_pool()
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow('SELECT * FROM journal_entries WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', entry_id)
        if not row:
            raise not_found('手记')
        if row['updated_at'] != body.expected_updated_at:
            raise conflict('这篇手记已在其他设备更新，请刷新后再编辑')
        row = await conn.fetchrow('UPDATE journal_entries SET entry_date=$2,caption=$3,updated_at=clock_timestamp() WHERE id=$1 RETURNING *', entry_id, body.entry_date, body.caption)
        return {'data': await entry(conn, row)}


@router.delete('/entries/{entry_id}', response_model=JournalDeleteResponse)
async def delete_entry(entry_id: int):
    pool = await get_pool()
    result = await pool.execute('UPDATE journal_entries SET deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND deleted_at IS NULL', entry_id)
    if result == 'UPDATE 0':
        raise not_found('手记')
    return {'data': {'deleted': True}}
