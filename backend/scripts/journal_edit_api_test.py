"""照片编辑真实 API 回归；仅运行于双标记、本机独立数据库服务。"""
import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import re
import sys
from uuid import uuid4

import asyncpg
from dotenv import load_dotenv
import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / '.env')
from app.db import _db_config

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', required=True)
parser.add_argument('--database', required=True, help='显式指定本轮独立测试库')
parser.add_argument('--samples', required=True)
parser.add_argument('--output', default=str(ROOT.parent / '.review/journal-edit-api-evidence.json'))
args = parser.parse_args()
assert re.fullmatch(r'http://127\.0\.0\.1:\d+', args.base), '仅允许本机测试服务'
c = httpx.Client(base_url=args.base, timeout=180)
health = c.get('/health')
database = health.headers.get('X-Pantry-Nook-Test-Database', '')
assert re.fullmatch(r'pantry_nook_test_[0-9a-f]{32}', database), '数据库标记缺失'
assert health.headers.get('X-Pantry-Nook-Test-Media') == database, '媒体标记不一致'
assert database == args.database, '拒绝写入非预期测试库'
config = _db_config()
assert config['host'] in ('localhost', '127.0.0.1'), '数据库必须本机'
config['database'] = database
checks = []


def uid():
    return str(uuid4())


def request(method, path, expected=200, **kwargs):
    response = c.request(method, path, **kwargs)
    assert response.status_code == expected, (response.status_code, response.text)
    return response.json()['data']


def upload(raw, name='test.jpg'):
    image = request('POST', '/api/journal/uploads', 201, headers={'X-Upload-ID': uid()}, files={'file': (name, raw)})
    assert c.get(image['original_url']).content == raw
    assert image['sha256'] == hashlib.sha256(raw).hexdigest()
    return image


def make_photo(index):
    buffer = io.BytesIO()
    Image.new('RGB', (120, 80), (index * 20 % 255, 80, 100)).save(buffer, format='JPEG')
    return buffer.getvalue()


def create(assets, cover=None):
    body = dict(entry_date='2039-09-20', caption='照片编辑专用测试', upload_ids=[a['id'] for a in assets], client_request_id=uid())
    if cover:
        body['cover_upload_id'] = cover['id']
    return request('POST', '/api/journal/entries', 201, json=body)


def edit_body(entry, assets, cover=None, **extra):
    return dict(entry_date='2039-09-21', caption='编辑后', expected_updated_at=entry['updated_at'],
                upload_ids=[a['id'] for a in assets], cover_upload_id=(cover or assets[0])['id'],
                client_request_id=uid(), **extra)


def current(entry):
    return next(row for row in c.get('/api/journal/entries?limit=100&month=2039-09').json()['data'] if row['id'] == entry['id'])


def assert_inaccessible(asset):
    for variant in ('original', 'preview', 'thumbnail'):
        path = '/api/journal/media/' + asset['id'] + '/' + variant
        for method, headers in [('GET', {}), ('HEAD', {}), ('GET', {'Range': 'bytes=0-15'})]:
            assert c.request(method, path, headers=headers).status_code == 404


photos = [upload(make_photo(i)) for i in range(11)]
entry = create(photos[:3], photos[1])
assert entry['cover_upload_id'] == photos[1]['id']
assert [p['id'] for p in entry['photos']] == [p['id'] for p in photos[:3]]
legacy = create([photos[10]])
assert legacy['cover_upload_id'] == photos[10]['id']
checks.append('新建自选封面、旧客户端默认首图、顺序不受封面影响')

for name, raw in [('report.pdf', b'%PDF-1.7'), ('report.docx', b'PK'), ('archive.zip', b'PK'),
                  ('fake.jpg', b'%PDF-1.7'), ('wrong.png', make_photo(0)), ('clip.mp4', b'not-video')]:
    r = c.post('/api/journal/uploads', headers={'X-Upload-ID': uid()}, files={'file': (name, raw)})
    assert r.status_code in (400, 422), (name, r.status_code, r.text)
assert current(entry) == entry
checks.append('文档/压缩包/改后缀/独立MP4拒绝，失败上传不影响原记录')

path = f"/api/journal/entries/{entry['id']}"
body = edit_body(entry, [photos[2], photos[0], photos[3]], photos[3])
edited = request('PATCH', path, json=body)
assert [p['id'] for p in edited['photos']] == [photos[i]['id'] for i in (2, 0, 3)]
assert edited['cover_upload_id'] == photos[3]['id']
assert request('PATCH', path, json=body) == edited
assert c.patch(path, json={**body, 'caption': '同键不同修改'}).status_code == 409
assert_inaccessible(photos[1])
checks.append('替换/移除/重新排序与封面原子保存，重放幂等，移除资源所有读取入口立即失效')

before = current(entry)
for ids, cover, code in [([photos[0], photos[10]], photos[0], 409),
                          ([photos[0], photos[1]], photos[0], 409),
                          (photos[:1], photos[3], 400),
                          ([photos[0], photos[0]], photos[0], 400)]:
    assert c.patch(path, json=edit_body(before, ids, cover)).status_code == code
    assert current(entry) == before
assert c.patch(path, json={**edit_body(before, photos[:1]), 'upload_ids': []}).status_code == 400
assert c.patch(path, json={'entry_date': '2039-09-21', 'expected_updated_at': before['updated_at'], 'cover_upload_id': photos[0]['id']}).status_code == 400
checks.append('跨手记资源、已移除资源、非法封面、重复/空列表及不完整编辑拒绝且原记录不变')

# 10 张测试需要排除已移除、已绑定其他手记的资源，因此追加新原片。
more = [upload(make_photo(i + 20)) for i in range(3)]
ten = [photos[0], photos[2], photos[3], *photos[4:10], more[0]]
assert len(ten) == 10
assert c.patch(path, json=edit_body(before, ten)).status_code == 400
assert current(entry) == before
nine = ten[:9]
edited = request('PATCH', path, json=edit_body(before, nine, nine[-1]))
assert len(edited['photos']) == 9 and edited['cover_upload_id'] == nine[-1]['id']
assert c.patch(path, json=body).status_code == 409
checks.append('10张后端拒绝、9张成功；旧幂等请求不能覆盖后续修改')

concurrent = [edit_body(edited, nine, nine[0]), edit_body(edited, nine, nine[1])]
with ThreadPoolExecutor(max_workers=2) as executor:
    outcomes = list(executor.map(lambda b: c.patch(path, json=b).status_code, concurrent))
assert sorted(outcomes) == [200, 409], outcomes
edited = current(entry)
checks.append('同版本并发修改仅一次成功，其余明确冲突')


async def rollback_test():
    conn = await asyncpg.connect(**config)
    try:
        # 故障只注入此独立库、此测试记录，验证归属更新之后的真实事务回滚。
        await conn.execute("""CREATE FUNCTION journal_edit_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.caption='__journal_test_rollback__' THEN RAISE EXCEPTION 'test rollback'; END IF;
            RETURN NEW; END $$""")
        await conn.execute('CREATE TRIGGER journal_edit_test_failure BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_edit_test_failure()')
        failing = edit_body(edited, [more[1]], more[1])
        failing['caption'] = '__journal_test_rollback__'
        response = await asyncio.to_thread(c.patch, path, json=failing)
        assert response.status_code == 500, response.text
        assert current(entry) == edited
        rows = await conn.fetch('SELECT id,status,entry_id FROM journal_uploads WHERE id=ANY($1::uuid[])', [p['id'] for p in nine] + [more[1]['id']])
        assert all(r['status'] == 'ready' for r in rows)
        assert next(r for r in rows if str(r['id']) == more[1]['id'])['entry_id'] is None
        assert not await conn.fetchval('SELECT EXISTS(SELECT 1 FROM journal_entry_edits WHERE client_request_id=$1)', failing['client_request_id'])
        for asset in nine:
            assert c.get(asset['original_url']).status_code == 200
        # 已成功移除的资源保留实体文件，便于已有保留期清理策略处理。
        removed = await conn.fetchrow('SELECT * FROM journal_uploads WHERE id=$1', photos[1]['id'])
        assert removed['status'] == 'cancelled' and removed['entry_id'] is None and removed['position'] is None
        media_root = ROOT.parent / '.review/media-test' / database
        if media_root.exists():
            assert (media_root / removed['storage_path'] / 'original').is_file()
    finally:
        await conn.execute('DROP TRIGGER IF EXISTS journal_edit_test_failure ON journal_entries')
        await conn.execute('DROP FUNCTION IF EXISTS journal_edit_test_failure()')
        await conn.close()


asyncio.run(rollback_test())
checks.append('归属写入后数据库故障整事务回滚，原照片/封面/版本不变；已成功移除原件仍保存在磁盘')

samples = Path(args.samples)
apple_raw = (samples / 'apple-iphone15.heic').read_bytes()
mov_raw = (samples / 'apple-iphone15.mov').read_bytes()
apple = upload(apple_raw, 'different-a.heic')
for name in ('different-b.mov', 'different-b.mp4', 'disguised.jpg', 'disguised.heic'):
    response = c.post('/api/journal/uploads', headers={'X-Upload-ID': uid()}, files={'file': (name, mov_raw)})
    assert response.status_code in (400, 422), (name, response.text)
assert not ({'live_kind', 'pair_identifier', 'video_url'} & apple.keys())
live = create([apple, more[1]], apple)
live_path = f"/api/journal/entries/{live['id']}"


async def legacy_video_fixture():
    # 只在已验证双标记的本机专属测试库/媒体目录注入旧版记录，不触及用户数据。
    health = c.get('/health')
    assert health.headers.get('X-Pantry-Nook-Test-Database') == database
    assert health.headers.get('X-Pantry-Nook-Test-Media') == database
    media_root = (ROOT.parent / '.review/media-test' / database).resolve()
    assert (media_root / '.pantry-test-database').read_text(encoding='utf-8') == database
    video_id = uid()
    relative = f'assets/{video_id}/{uid()}'
    directory = media_root / relative
    assert directory.resolve().is_relative_to(media_root)
    directory.mkdir(parents=True)
    (directory / 'original').write_bytes(mov_raw)
    # 历史派生文件也必须保留，应用不再读取或转换它。
    (directory / 'motion.mp4').write_bytes(b'historical derived video test bytes')
    conn = await asyncpg.connect(**config)
    try:
        image_details = json.loads(await conn.fetchval('SELECT details::text FROM journal_uploads WHERE id=$1', apple['id']))
        image_details.update(live_kind='apple_photo', pair_identifier='legacy-test-pair', motion=False)
        await conn.execute('UPDATE journal_uploads SET details=$2::jsonb WHERE id=$1', apple['id'], json.dumps(image_details))
        details = dict(kind='video', live_kind='apple_video', pair_identifier='legacy-test-pair',
                       width=100, height=100, preview_width=100, preview_height=100, mime='video/quicktime', motion=True)
        await conn.execute("""INSERT INTO journal_uploads(id,sha256,status,original_name,original_size,details,storage_path,entry_id,position)
            VALUES($1,$2,'ready','legacy.mov',$3,$4::jsonb,$5,$6,2)""", video_id, hashlib.sha256(mov_raw).hexdigest(),
            len(mov_raw), json.dumps(details), relative, live['id'])
        snapshot = dict(await conn.fetchrow('SELECT * FROM journal_uploads WHERE id=$1', video_id))
        image_path = await conn.fetchval('SELECT storage_path FROM journal_uploads WHERE id=$1', apple['id'])
        return video_id, directory, snapshot, media_root / image_path / 'original'
    finally:
        await conn.close()


video_id, old_directory, old_row, old_image_path = asyncio.run(legacy_video_fixture())
old_bytes = {name: (old_directory / name).read_bytes() for name in ('original', 'motion.mp4')}


async def verify_old_video_unchanged():
    conn = await asyncpg.connect(**config)
    try:
        assert dict(await conn.fetchrow('SELECT * FROM journal_uploads WHERE id=$1', video_id)) == old_row
        assert old_image_path.read_bytes() == apple_raw
        for name, raw in old_bytes.items():
            assert (old_directory / name).read_bytes() == raw
    finally:
        await conn.close()


loaded = current(live)
assert all(set(photo) == {'id', 'image'} for photo in loaded['photos'])
assert all(not ({'live_kind', 'pair_identifier', 'video_url'} & photo['image'].keys()) for photo in loaded['photos'])
assert [p['id'] for p in loaded['photos']] == [apple['id'], more[1]['id']]
assert_inaccessible({'id': video_id})
for asset_id in (video_id, apple['id']):
    assert c.get(f'/api/journal/media/{asset_id}/motion').status_code in (400, 422)
# 创建/修改不能把历史视频重新绑定进静态照片列表。
assert c.patch(live_path, json=edit_body(loaded, [apple, {'id': video_id}], apple)).status_code == 400
assert c.post('/api/journal/entries', json=dict(entry_date='2039-09-21', upload_ids=[video_id], client_request_id=uid())).status_code == 409
# 先只改文字，再换封面并重排，最后替换原配照片；视频行和原件始终不变。
text_edited = request('PATCH', live_path, json=dict(entry_date='2039-09-21', caption='旧实况文字编辑', expected_updated_at=loaded['updated_at']))
asyncio.run(verify_old_video_unchanged())
cover_edited = request('PATCH', live_path, json=edit_body(text_edited, [more[1], apple], more[1]))
assert cover_edited['cover_upload_id'] == more[1]['id']
assert c.get(apple['original_url']).content == apple_raw
asyncio.run(verify_old_video_unchanged())
static_replaced = request('PATCH', live_path, json=edit_body(cover_edited, [more[1]], more[1]))
assert len(static_replaced['photos']) == 1
assert_inaccessible(apple)
asyncio.run(verify_old_video_unchanged())
request('DELETE', live_path)
assert_inaccessible(more[1])
asyncio.run(verify_old_video_unchanged())
checks.append('MOV/MP4及伪装视频拒绝；旧实况仅静图，编辑文字/封面/替换/软删除保留历史视频完整数据库行及原件、派生文件')

other = create([more[0]])
contenders = [(legacy, [photos[10], more[2]]), (other, [more[0], more[2]])]
def claim_shared(contender):
    record, assets = contender
    return c.patch(f"/api/journal/entries/{record['id']}", json=edit_body(record, assets)).status_code
with ThreadPoolExecutor(max_workers=2) as executor:
    outcomes = list(executor.map(claim_shared, contenders))
assert sorted(outcomes) == [200, 409], outcomes
checks.append('两篇手记并发争同一未绑定新照片，仅一次绑定成功')

last_body = edit_body(edited, nine, nine[0])
last = request('PATCH', path, json=last_body)
request('DELETE', path)
assert c.patch(path, json=last_body).status_code == 404
for asset in nine:
    assert_inaccessible(asset)
checks.append('已删除手记的编辑重放返回404，原有媒体不可访问')

output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'base': args.base, 'test_database': database, 'checks': checks}, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False, indent=2))
