"""仅在指定本地 Docker 测试实例演练数据库和媒体联合备份恢复。

创建两个新的 pantry_nook_test_<UUID> 数据库、专属媒体目录与 3063/3064
临时服务；保留证据和数据，只停止本脚本创建的服务。绝不连接 3060。
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from uuid import uuid4

import asyncpg
from dotenv import load_dotenv
import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / '.env')
from app.db import _db_config

CONTAINER = 'pantry-journal-test-db'
PATTERN = re.compile(r'pantry_nook_test_[0-9a-f]{32}')


def command(args, **kwargs):
    result = subprocess.run(args, capture_output=True, timeout=120, **kwargs)
    if result.returncode:
        raise RuntimeError(f'测试工具执行失败：{args[0]} {args[1]}，退出码 {result.returncode}')
    return result.stdout


def sha(data: bytes):
    return hashlib.sha256(data).hexdigest()


def image_bytes(color):
    output = io.BytesIO()
    Image.new('RGB', (100, 70), color).save(output, format='JPEG', quality=95)
    return output.getvalue()


def assert_marker(client, expected=None):
    response = client.get('/health')
    response.raise_for_status()
    database = response.headers.get('X-Pantry-Nook-Test-Database', '')
    assert PATTERN.fullmatch(database), '服务缺少测试数据库标记'
    assert response.headers.get('X-Pantry-Nook-Test-Media') == database
    if expected:
        assert database == expected, '测试服务数据库发生变化'
    return database


def start_server(port, folder, database=None):
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1', port)) != 0, f'端口 {port} 已使用，拒绝操作现有服务'
    log = (folder / f'server-{port}.log').open('wb')
    args = [sys.executable, 'scripts/isolated_server.py', '--port', str(port)]
    if database:
        assert PATTERN.fullmatch(database)
        args.extend(['--reuse-test-database', database])
    process = subprocess.Popen(args, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                               env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    client = httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=120)
    try:
        for _ in range(60):
            if process.poll() is not None:
                raise RuntimeError(f'隔离服务 {port} 启动失败，见本轮日志')
            try:
                identifier = assert_marker(client, database)
                return process, log, client, identifier
            except httpx.TransportError:
                time.sleep(.5)
        raise RuntimeError(f'隔离服务 {port} 启动超时')
    except BaseException:
        stop_server(process, log, client)
        raise


def stop_server(process, log, client):
    client.close()
    if process.poll() is None:
        if os.name == 'nt':
            command(['taskkill', '/PID', str(process.pid), '/T', '/F'])
        else:
            process.terminate()
        process.wait(timeout=20)
    log.close()


async def new_database():
    config = _db_config()
    config['database'] = 'postgres'
    connection = await asyncpg.connect(**config)
    database = 'pantry_nook_test_' + uuid4().hex
    try:
        await connection.execute('CREATE DATABASE "' + database + '"')
    finally:
        await connection.close()
    return database


def media_manifest(folder):
    result = {}
    for item in sorted(folder.rglob('*')):
        assert not item.is_symlink(), '本轮测试不跟随媒体软链接'
        if item.is_file() and item.name != '.pantry-test-database':
            result[item.relative_to(folder).as_posix()] = sha(item.read_bytes())
    return result


def main():
    config = _db_config()
    assert config['host'] in ('localhost', '127.0.0.1') and config['port'] == 55460, '只允许专用本地 55460 Docker 测试实例'
    mapping = command(['docker', 'port', CONTAINER, '5432/tcp']).decode().strip()
    assert mapping == '127.0.0.1:55460'
    folder = ROOT.parent / '.review' / 'journal-backup-restore-test' / uuid4().hex
    folder.mkdir(parents=True)
    evidence = {'passed': False, 'source_port': 3063, 'restored_port': 3064, 'production_touched': False}
    source = restored = None
    try:
        source = start_server(3063, folder)
        client, database = source[2:]
        evidence['source_database'] = database
        raw = image_bytes('tomato')

        def write(method, url, **kwargs):
            assert_marker(client, database)
            response = client.request(method, url, **kwargs)
            response.raise_for_status()
            return response.json()['data']

        image = write('POST', '/api/journal/uploads', files={'file': ('mock-backup.jpg', raw, 'image/jpeg')},
                      headers={'X-Upload-ID': str(uuid4())})
        kept = write('POST', '/api/journal/entries', json={'entry_date': '2043-05-06', 'caption': '备份恢复测试保留记录',
                    'upload_ids': [image['id']], 'client_request_id': str(uuid4())})
        deleted_image = write('POST', '/api/journal/uploads', files={'file': ('mock-deleted.jpg', image_bytes('gold'), 'image/jpeg')},
                              headers={'X-Upload-ID': str(uuid4())})
        removed = write('POST', '/api/journal/entries', json={'entry_date': '2043-05-07', 'caption': '备份恢复测试已删除记录',
                       'upload_ids': [deleted_image['id']], 'client_request_id': str(uuid4())})
        write('DELETE', f"/api/journal/entries/{removed['id']}")
        assert client.get(deleted_image['original_url']).status_code == 404
        assert sha(client.get(image['original_url']).content) == sha(raw)
        stop_server(*source[:3])
        source = None
        # 停写后形成一致的数据库+媒体备份；演练不要求线上不停机快照。
        dump = command(['docker', 'exec', CONTAINER, 'pg_dump', '-U', config['user'], '-Fc', database])
        assert dump.startswith(b'PGDMP')
        backup = folder / 'journal-test.dump'
        backup.write_bytes(dump)
        source_media = ROOT.parent / '.review' / 'media-test' / database
        manifest = media_manifest(source_media)
        assert len(manifest) == 6, '预期两张照片各有原件、预览与缩略图'
        media_backup = folder / 'media-backup'
        shutil.copytree(source_media, media_backup)
        assert media_manifest(media_backup) == manifest
        restored_database = asyncio.run(new_database())
        evidence['restored_database'] = restored_database
        command(['docker', 'exec', '-i', CONTAINER, 'pg_restore', '-U', config['user'],
                 '--exit-on-error', '--no-owner', '--no-privileges', '-d', restored_database], input=dump)
        restored_media = ROOT.parent / '.review' / 'media-test' / restored_database
        assert not restored_media.exists()
        shutil.copytree(media_backup, restored_media)
        (restored_media / '.pantry-test-database').write_text(restored_database, encoding='utf-8')
        assert media_manifest(restored_media) == manifest
        restored = start_server(3064, folder, restored_database)
        restored_client = restored[2]
        assert_marker(restored_client, restored_database)
        listed = restored_client.get('/api/journal/entries').json()
        assert listed['meta']['total'] == 1 and listed['data'][0]['id'] == kept['id']
        assert listed['data'][0]['caption'] == kept['caption']
        download = restored_client.get(image['original_url'])
        assert download.status_code == 200 and sha(download.content) == sha(raw)
        assert restored_client.get(image['preview_url']).headers['content-type'].startswith('image/jpeg')
        denied = []
        for variant in ('original', 'preview', 'thumbnail'):
            url = f"/api/journal/media/{deleted_image['id']}/{variant}"
            for method, headers in (('GET', {}), ('HEAD', {}), ('GET', {'Range': 'bytes=0-15'})):
                response = restored_client.request(method, url, headers=headers)
                assert response.status_code == 404, (method, variant, response.status_code)
                denied.append(f'{method} {variant}' + (' Range' if headers else ''))
        evidence.update(passed=True, dump_sha256=sha(dump), dump_bytes=len(dump), media_file_count=len(manifest),
                        media_checksums=manifest, original_sha256=sha(raw), restored_entry_id=kept['id'],
                        deleted_entry_id=removed['id'], deleted_resource_checks=denied,
                        database_and_media_restored=True, original_exact_bytes=True,
                        source_stopped_before_backup=True, data_and_backup_retained=True)
    finally:
        if source:
            stop_server(*source[:3])
        if restored:
            stop_server(*restored[:3])
        evidence['own_services_stopped'] = True
        (folder / 'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': evidence['passed'], 'evidence': str(folder / 'evidence.json'),
                      'media_file_count': evidence['media_file_count'], 'own_services_stopped': True}, ensure_ascii=True))


if __name__ == '__main__':
    main()
