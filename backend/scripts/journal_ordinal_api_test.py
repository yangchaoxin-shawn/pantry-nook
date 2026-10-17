"""“第 N 顿”编号与月份顿数的真实 API 回归；只读，仅运行于带测试标记的本机独立库。"""
import argparse
from collections import Counter
import re

import httpx

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', required=True)
parser.add_argument('--database', required=True, help='显式指定本轮独立测试库')
args = parser.parse_args()
assert re.fullmatch(r'http://(127\.0\.0\.1|localhost):\d+', args.base), '仅允许本机测试服务'
c = httpx.Client(base_url=args.base, timeout=60)
marker = c.get('/health').headers.get('X-Pantry-Nook-Test-Database', '')
assert re.fullmatch(r'pantry_nook_test_[0-9a-f]{32}', marker) and marker == args.database, '拒绝访问非预期数据库'

# 一次取全量作为对照：编号 = 按 (日期, id) 升序的位置。
everything = []
while True:
    page = c.get('/api/journal/entries', params={'limit': 100, 'offset': len(everything)}).json()
    everything += page['data']
    if len(everything) >= page['meta']['total'] or not page['data']:
        break
total = page['meta']['total']
expected = {e['id']: i + 1 for i, e in enumerate(sorted(everything, key=lambda e: (e['entry_date'], e['id'])))}
by_month = Counter(e['entry_date'][:7] for e in everything)
assert len(everything) == total and total > 0, '测试库里需要至少一顿'

# 小分页逐页对照：编号不受分页影响，月份顿数是全月数而不是本页条数。
offset, pages = 0, 0
while offset < total:
    page = c.get('/api/journal/entries', params={'limit': 3, 'offset': offset}).json()
    for e in page['data']:
        assert e['ordinal'] == expected[e['id']], (e['id'], e['ordinal'], expected[e['id']])
    assert set(page['meta']['month_totals']) == {e['entry_date'][:7] for e in page['data']}
    for month, count in page['meta']['month_totals'].items():
        assert count == by_month[month], (month, count, by_month[month])
    offset += len(page['data']); pages += 1

# 按月筛选时编号仍是全库编号，month_totals 为空。
month = max(by_month)
filtered = c.get('/api/journal/entries', params={'limit': 100, 'month': month}).json()
assert all(e['ordinal'] == expected[e['id']] for e in filtered['data'])
assert filtered['meta']['month_totals'] == {} and filtered['meta']['total'] == by_month[month]
assert max(expected.values()) == total and min(expected.values()) == 1
print(f'编号与月份顿数一致：{total} 顿，{len(by_month)} 个月，逐页核对 {pages} 页')
