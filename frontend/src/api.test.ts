import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { api, ApiError, type Ingredient, type IngredientUpdate } from './api'
import { startedBatchRows } from './batch-ingredient-logic'
import { applyDefaultUnit, orderedUnits, recommendedUnits } from './inventory-units'

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('双人编辑冲突', () => {
  it('返回可核对的最新快照，不自动重发保存', async () => {
    const current = { id: 3, name: '对方新名称', updated_at: '2026-09-12T01:00:00Z' }
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'RECORD_CHANGED', message: '记录已更新', details: { current } } }, 409))
    const result = api.saveIngredient(3, { name: '我的名称', expected_updated_at: '2026-09-12T00:00:00Z' })
    await expect(result).rejects.toBeInstanceOf(ApiError)
    await expect(result).rejects.toMatchObject({ code: 'RECORD_CHANGED', details: { current } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('编辑菜品携带版本，新建不携带版本', async () => {
    fetchMock.mockImplementation(async () => json({ data: { id: 3 } }))
    await api.saveDish(3, '菜名', '2026-09-12T00:00:00Z')
    await api.saveDish(undefined, '新菜名')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ name: '菜名', expected_updated_at: '2026-09-12T00:00:00Z' })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ name: '新菜名' })
  })
})

describe('完整读取与读取失败', () => {
  it('超过两页的作战仍包含最后一页未确认计划，页数和顺序准确', async () => {
    const battles = Array.from({ length: 237 }, (_, index) => ({ id: index + 1, status: index === 236 ? 'planned' : 'confirmed' }))
    fetchMock.mockImplementation(async input => {
      const url = new URL(String(input), 'http://localhost')
      const offset = Number(url.searchParams.get('offset'))
      const limit = Number(url.searchParams.get('limit'))
      return json({ data: battles.slice(offset, offset + limit), meta: { total: battles.length, offset, limit } })
    })
    const result = await api.battles()
    expect(result.map(item => item.id)).toEqual(battles.map(item => item.id))
    expect(result.at(-1)?.status).toBe('planned')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('库存跨页仅返回在库记录', async () => {
    fetchMock.mockImplementation(async input => {
      const url = new URL(String(input), 'http://localhost')
      expect(url.searchParams.get('status')).toBeNull()
      const offset = Number(url.searchParams.get('offset'))
      return json({ data: Array.from({ length: offset === 0 ? 100 : 1 }, (_, index) => ({ id: offset + index + 1, name: `食材${offset + index + 1}` })), meta: { total: 101, limit: 100, offset } })
    })
    expect((await api.ingredients()).at(-1)?.id).toBe(101)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('按存放位置读取时向真实筛选接口传递位置参数', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [{ id: 1, name: '冻虾' }], meta: { total: 1, limit: 100, offset: 0 } }))
    await api.ingredientsAtLocation('冰箱冷冻')
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/ingredients')
    expect(url.searchParams.get('location')).toBe('冰箱冷冻')
  })

  it('第二页失败时拒绝整个读取，避免将不完整库存误认为完整结果', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: Array.from({ length: 100 }, (_, id) => ({ id })), meta: { total: 120 } }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(api.ingredients()).rejects.toThrow('暂时连接不上厨房')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('读取业务错误保留后端可解释的原因', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'CONFLICT', message: '请先处理未确认计划' } }, 409))
    await expect(api.battles()).rejects.toThrow('请先处理未确认计划')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('列表返回对象时给出格式错误而非空列表', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: {} }))
    await expect(api.ingredients()).rejects.toThrow('列表格式不正确')
  })

  it('页面主动取消读取时保留取消原因，避免显示网络故障', async () => {
    const controller = new AbortController()
    const reason = new DOMException('页面已切换', 'AbortError')
    controller.abort(reason)
    fetchMock.mockRejectedValueOnce(reason)
    await expect(api.battles(controller.signal)).rejects.toBe(reason)
  })
})

describe('写入结果与库存原文', () => {
  it('库存类别只调整单位建议，不排除其他真实单位', () => {
    expect(recommendedUnits('蔬菜')).toEqual(['个', 'g', 'kg', '斤', '把', '颗', '份'])
    expect(orderedUnits('蔬菜').slice(0, 7)).toEqual(['个', 'g', 'kg', '斤', '把', '颗', '份'])
    expect(orderedUnits('蔬菜')).toContain('ml')
    expect(orderedUnits('其他').slice(0, 7)).toEqual(['ml', 'L', '瓶', '包', '盒', '袋', '份'])
  })

  it('批量默认单位只补空值，不覆盖每项已经填写的单位', () => {
    expect(applyDefaultUnit([
      { name: '菠菜', unit: '' },
      { name: '西兰花', unit: '个' },
    ], 'g')).toEqual([
      { name: '菠菜', unit: 'g' },
      { name: '西兰花', unit: '个' },
    ])
  })

  it('批量录入仅填写一行时，带默认单位的空白行不进入校验', () => {
    const rows = [
      { name: '大米', quantity: '5', unit: 'kg' },
      { name: '', quantity: '', unit: '个' },
      { name: '', quantity: '', unit: '个' },
    ]
    expect(startedBatchRows(rows)).toEqual([{ name: '大米', quantity: '5', unit: 'kg' }])
  })

  it('写入超时提示结果尚未确认且只发送一次', async () => {
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const saving = api.saveBattle(undefined, {
      battle_date: '2026-09-09',
      meal_slot: 'dinner',
      dish_ids: [1],
      preparations: [{ dish_id: 1, ingredient_id: 1 }],
    })
    const assertion = expect(saving).rejects.toThrow('操作结果尚未确认，请先关闭弹窗并刷新页面核对')
    controller.abort(new DOMException('等待超时', 'TimeoutError'))
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['not json', JSON.stringify({}), JSON.stringify('saved')])('单条编辑的不可用响应仍提示先核对，响应=%s', async response => {
    fetchMock.mockResolvedValueOnce(new Response(response, { status: 201 }))
    await expect(api.saveIngredient(3, { name: '回归食材', expected_updated_at: '2026-09-12T00:00:00Z' })).rejects.toThrow('操作结果尚未确认')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('撤销的显式目标状态按 target_status 发送，支持非默认取消目标', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { id: 7, status: 'cancelled' } }))
    await api.battleAction(7, 'revoke-confirmation', { target_status: 'cancelled' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/daily-battles/7/revoke-confirmation')
    expect(JSON.parse(String(init?.body))).toEqual({ target_status: 'cancelled' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('批量录入只发送一次，并按原样提交整批食材', async () => {
    const ingredients = [
      { name: '鸡蛋', category: '蛋白质' as const, stock_text: '6', stock_value: 6, stock_unit: '个' },
      { name: '菠菜', category: '蔬菜' as const, stock_text: '300', stock_value: 300, stock_unit: 'g', location: '冰箱冷藏' as const },
    ]
    fetchMock.mockResolvedValueOnce(json({ data: ingredients }, 201))
    await api.saveIngredientsBatch(ingredients)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/ingredients/batch')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ items: ingredients, resolutions: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('库存原文保持原样，不擅自换算单位', async () => {
    expectTypeOf<Ingredient['stock_text']>().toEqualTypeOf<string>()
    const raw = { id: 3, stock_text: '["一份"]', stock_value: 1, stock_unit: '份' }
    fetchMock.mockResolvedValueOnce(json({ data: [raw], meta: { total: 1, limit: 100, offset: 0 } }))
    const result = await api.ingredients()
    expect(result[0].stock_text).toBe('["一份"]')

    const patch: IngredientUpdate = { stock_text: '2', stock_value: 2, expected_updated_at: '2026-09-12T00:00:00Z' }
    fetchMock.mockResolvedValueOnce(json({ data: raw }))
    await api.saveIngredient(3, patch)
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ stock_text: '2', stock_value: 2, expected_updated_at: '2026-09-12T00:00:00Z' })
  })

  it('只改名称的 PATCH 不携带余量，避免覆盖另一设备确认后的库存', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { id: 3, name: '新名称', stock_text: '两份' } }))
    await api.saveIngredient(3, { name: '新名称', expected_updated_at: '2026-09-12T00:00:00Z' })
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ name: '新名称', expected_updated_at: '2026-09-12T00:00:00Z' })
  })

  it('没有字段变化时读取最新记录，不发送空 PATCH', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { id: 3, stock_text: '最新余量' } }))
    const result = await api.saveIngredient(3, {})
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined()
    expect(result.data.stock_text).toBe('最新余量')
  })
})
