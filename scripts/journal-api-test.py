"""手记真实 API 定向验证；只写带数据库/媒体隔离标记的本机服务。"""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import re
import runpy
import sys
import uuid

import httpx
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:3060')
parser.add_argument('--samples', required=True, help='上轮公开真实样本所在目录')
parser.add_argument('--output', default='.review/journal-api-evidence.json')
args = parser.parse_args()
if not args.base.startswith('http://127.0.0.1:'):
    raise SystemExit('只允许本机隔离服务')
root=Path(__file__).resolve().parents[1]
saved_argv=sys.argv
try:
    sys.argv=['success_response_contract_test.py']
    contract_helpers=runpy.run_path(str(root/'backend/scripts/success_response_contract_test.py'))
finally:
    sys.argv=saved_argv
contract=contract_helpers['CONTRACT']
validated_operations=set()
def validate_response(response):
    if not response.request.url.path.startswith('/api/journal/') or not 200<=response.status_code<300:
        return
    if 'application/json' not in response.headers.get('content-type',''):
        return
    response.read()
    method=response.request.method.lower()
    for template,operations in contract['paths'].items():
        pattern=re.sub(r'\{[^}]+\}',r'[^/]+',template)
        if re.fullmatch(pattern,response.request.url.path) and method in operations:
            schema=operations[method]['responses'][str(response.status_code)]['content']['application/json']['schema']
            contract_helpers['validate'](response.json(),schema)
            validated_operations.add(method+' '+template)
            return
    raise AssertionError('成功请求缺少归档契约')
c = httpx.Client(base_url=args.base, timeout=180,event_hooks={'response':[validate_response]})
health = c.get('/health')
assert health.headers.get('X-Pantry-Nook-Test-Database', '').startswith('pantry_nook_test_')
assert health.headers.get('X-Pantry-Nook-Test-Media'), '缺少测试媒体标记，拒绝写入'
checks=[]
samples=Path(args.samples)

def uid(): return str(uuid.uuid4())
def synthetic(color=(67,91,50)):
    buf=io.BytesIO();Image.new('RGB',(900,600),color).save(buf,format='JPEG');return buf.getvalue()
def upload(raw,name='sample.jpg',key=None):
    key=key or uid()
    r=c.post('/api/journal/uploads',headers={'X-Upload-ID':key},files={'file':(name,raw)})
    assert r.status_code in (200,201), (r.status_code,r.text)
    asset=r.json()['data']
    original=c.get(asset['original_url'])
    assert original.status_code==200 and original.content==raw
    assert asset['sha256']==hashlib.sha256(raw).hexdigest()
    return asset,key
def publish(ids,key=None,caption='仅测试：一餐手记',day='2039-09-16'):
    return c.post('/api/journal/entries',json={'entry_date':day,'caption':caption,'upload_ids':ids,'client_request_id':key or uid()})
def all_media(asset):
    return [asset[k] for k in ('original_url','preview_url','thumbnail_url','video_url') if asset.get(k)]

business={p:c.get('/api/'+p+'?limit=100&offset=0').json() for p in ['ingredients','dishes','meal-plans','daily-battles','consumptions','inventory-adjustments']}
asset,key=upload(synthetic())
replay=c.post('/api/journal/uploads',headers={'X-Upload-ID':key},files={'file':('sample.jpg',synthetic())})
assert replay.status_code==200 and replay.json()['data']['id']==asset['id']
conflict=c.post('/api/journal/uploads',headers={'X-Upload-ID':key},files={'file':('sample.jpg',synthetic((100,20,10)))})
assert conflict.status_code==409
checks.append('上传原件回读、同键重放与不同内容冲突')
for raw,name in [(b'not image','broken.jpg'),(b'<svg onload="alert(1)"></svg>','unsafe.svg')]:
    bad=c.post('/api/journal/uploads',headers={'X-Upload-ID':uid()},files={'file':(name,raw)})
    assert 400<=bad.status_code<500,(bad.status_code,bad.text)
checks.append('坏文件与主动内容拒绝')
request_id=uid();entry=publish([asset['id']],request_id);assert entry.status_code==201,entry.text
entry=entry.json()['data']
assert publish([asset['id']],request_id).json()['data']['id']==entry['id']
assert publish([asset['id']],request_id,caption='变更后不可回放').status_code==409
assert publish([asset['id']]).status_code==409
checks.append('发布幂等、同键不同请求冲突、资源不可重复绑定')
edited=c.patch(f"/api/journal/entries/{entry['id']}",json={'entry_date':'2039-09-17','caption':'修改文字','expected_updated_at':entry['updated_at']})
assert edited.status_code==200,edited.text
assert c.patch(f"/api/journal/entries/{entry['id']}",json={'entry_date':'2039-09-18','caption':'旧版本','expected_updated_at':entry['updated_at']}).status_code==409
assert c.get('/api/journal/entries?month=2039-09&limit=1&offset=0').json()['meta']['limit']==1
checks.append('编辑日期文字、版本冲突与月份分页')
apple_photo,_=upload((samples/'apple-iphone15.heic').read_bytes(),'apple.heic')
apple_movie,_=upload((samples/'apple-iphone15.mov').read_bytes(),'unrelated-filename.mov')
assert apple_photo['pair_identifier']==apple_movie['pair_identifier'] and apple_photo['pair_identifier']
pair=publish([apple_movie['id'],apple_photo['id']]);assert pair.status_code==201,pair.text
pair=pair.json()['data'];assert len(pair['photos'])==1 and pair['photos'][0]['live_status']=='live'
checks.append('Apple真实标识自动配对、不依赖文件名及上传顺序、两份原件回读')
missing,_=upload((samples/'apple-iphone15.heic').read_bytes(),'missing.heic')
still=publish([missing['id']]);assert still.status_code==201,still.text
assert still.json()['data']['photos'][0]['live_status']=='missing_video'
orphan,_=upload((samples/'apple-iphone15.mov').read_bytes(),'orphan.mov')
assert 400<=publish([orphan['id']]).status_code<500
checks.append('苹果缺视频明确静图状态、孤立MOV不能发布')
for name in ['pixel-8a.jpg','samsung-one-ui-6.heic']:
    motion,_=upload((samples/name).read_bytes(),name)
    motion_entry=publish([motion['id']]);assert motion_entry.status_code==201,motion_entry.text
    assert motion_entry.json()['data']['photos'][0]['live_status']=='live'
    assert motion.get('video_url')
checks.append('Pixel JPG与三星HEIC真实内嵌实况、原文件含视频逐字节保留')
race_asset,_=upload(synthetic((77,90,131)))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    responses=list(pool.map(lambda _:publish([race_asset['id']]),range(2)))
assert sorted(r.status_code for r in responses)==[201,409],[(r.status_code,r.text) for r in responses]
checks.append('并发发布同一资源只成功一次')
for media in [asset,apple_photo,apple_movie]:
    for url in all_media(media):
        full=c.get(url);assert full.status_code==200,(url,full.status_code)
        assert 'no-store' in full.headers.get('cache-control','')
        part=c.get(url,headers={'Range':'bytes=0-15'})
        assert part.status_code==206 and part.content==full.content[:16],(url,part.status_code)
        assert c.head(url).status_code==200
checks.append('图片与视频GET/HEAD/Range实际字节及禁止缓存')
for item in [entry,pair]:
    assert c.delete(f"/api/journal/entries/{item['id']}").status_code==200
for media in [asset,apple_photo,apple_movie]:
    for url in all_media(media):
        for method,headers in [('GET',{}),('HEAD',{}),('GET',{'Range':'bytes=0-15'}),('GET',{'If-None-Match':'*'})]:
            assert c.request(method,url,headers=headers).status_code==404,(method,url)
checks.append('删除后图像/独立MOV/兼容视频含条件请求均不可读取')
unbound,_=upload(synthetic((77,20,99)))
assert c.delete('/api/journal/uploads/'+unbound['id']).status_code==200
assert c.get(unbound['original_url']).status_code==404
checks.append('取消未绑定上传后原件拒绝读取')
for p,snapshot in business.items(): assert c.get('/api/'+p+'?limit=100&offset=0').json()==snapshot,p
checks.append('库存菜品菜单消耗等原业务列表未改变')
expected_operations={method+' '+path for path,operations in contract['paths'].items() if path.startswith('/api/journal/') and '/media/' not in path for method in operations if method in {'get','post','patch','delete'}}
assert validated_operations==expected_operations,(validated_operations,expected_operations)
checks.append('全部手记JSON成功操作按归档OpenAPI验证，媒体另验真实字节')
result={'checks':checks,'contract_operations':sorted(validated_operations),'base':args.base,'database':health.headers['X-Pantry-Nook-Test-Database'],'media':health.headers['X-Pantry-Nook-Test-Media'],'production_touched':False}
output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
