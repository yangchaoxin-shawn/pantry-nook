const express = require('express')
const pool = require('../db')
const { notFound } = require('../lib/errors')
const {
  enumValue,
  optionalDate,
  optionalNumber,
  optionalText,
  pagination,
  parseId,
  requiredText,
  validationError,
} = require('../lib/validation')
const { created, ok } = require('../lib/responses')

const router = express.Router()

const CATEGORIES = [
  '蔬菜',
  '肉类',
  '海鲜',
  '蛋奶',
  '碳水',
  '水果',
  '调味/干货',
  '其他',
]
const LOCATIONS = ['冰箱冷藏', '冰箱冷冻', '室温', '其他']
const STATUSES = ['active', 'consumed', 'discarded']

function ingredientInput(body, { partial = false } = {}) {
  const input = {}
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field)

  if (!partial || has('name')) input.name = requiredText(body.name, 'name')
  if (!partial || has('category')) {
    input.category = enumValue(body.category, 'category', CATEGORIES)
  }
  if (!partial || has('quantity_text')) {
    input.quantity_text = requiredText(body.quantity_text, 'quantity_text')
  }
  if (has('quantity_value')) {
    input.quantity_value = optionalNumber(body.quantity_value, 'quantity_value')
  }
  if (has('quantity_unit')) {
    input.quantity_unit = optionalText(body.quantity_unit, 'quantity_unit', 50)
  }
  if (has('remaining_text')) {
    input.remaining_text = optionalText(body.remaining_text, 'remaining_text')
  }
  if (has('remaining_value')) {
    input.remaining_value = optionalNumber(body.remaining_value, 'remaining_value')
  }
  if (has('location')) {
    input.location = enumValue(body.location, 'location', LOCATIONS, { optional: true })
  }
  if (has('purchase_date')) {
    input.purchase_date = optionalDate(body.purchase_date, 'purchase_date')
  }
  if (has('note')) input.note = optionalText(body.note, 'note', 5000)

  if (partial && Object.keys(input).length === 0) {
    throw validationError('至少需要提供一个可修改字段')
  }
  return input
}

function buildUpdate(input, startIndex = 1) {
  const entries = Object.entries(input)
  return {
    assignments: entries.map(([field], index) => `${field} = $${startIndex + index}`),
    values: entries.map(([, value]) => value),
  }
}

router.get('/', async (req, res) => {
  const { limit, offset } = pagination(req.query)
  const conditions = []
  const values = []
  const addCondition = (column, value) => {
    values.push(value)
    conditions.push(`${column} = $${values.length}`)
  }

  const status = req.query.status === undefined ? 'active' : req.query.status
  if (status !== 'all') {
    addCondition('i.status', enumValue(status, 'status', STATUSES))
  }
  if (req.query.category !== undefined) {
    addCondition('i.category', enumValue(req.query.category, 'category', CATEGORIES))
  }
  if (req.query.location !== undefined) {
    addCondition('i.location', enumValue(req.query.location, 'location', LOCATIONS))
  }
  if (req.query.q !== undefined) {
    const query = requiredText(req.query.q, 'q', 100)
    values.push(`%${query}%`)
    conditions.push(`(i.name ILIKE $${values.length} OR COALESCE(i.note, '') ILIKE $${values.length})`)
  }

  values.push(limit, offset)
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query(
    `SELECT i.*, COUNT(*) OVER()::int AS total_count
     FROM ingredients i
     ${where}
     ORDER BY i.purchase_date DESC NULLS LAST, i.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  )

  const total = result.rows[0]?.total_count ?? 0
  const items = result.rows.map(({ total_count, ...item }) => item)
  return ok(res, items, { total, limit, offset })
})

router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const result = await pool.query('SELECT * FROM ingredients WHERE id = $1', [id])
  if (result.rows.length === 0) throw notFound('食材')
  return ok(res, result.rows[0])
})

router.post('/', async (req, res) => {
  const input = ingredientInput(req.body)
  const remainingText = Object.prototype.hasOwnProperty.call(input, 'remaining_text')
    ? input.remaining_text
    : input.quantity_text
  const remainingValue = Object.prototype.hasOwnProperty.call(input, 'remaining_value')
    ? input.remaining_value
    : input.quantity_value ?? null

  const result = await pool.query(
    `INSERT INTO ingredients (
       name, category, quantity_text, quantity_value, quantity_unit,
       remaining_text, remaining_value, location, purchase_date, note
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.name,
      input.category,
      input.quantity_text,
      input.quantity_value ?? null,
      input.quantity_unit ?? null,
      remainingText,
      remainingValue,
      input.location ?? null,
      input.purchase_date ?? null,
      input.note ?? null,
    ]
  )
  return created(res, result.rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const input = ingredientInput(req.body, { partial: true })
  const { assignments, values } = buildUpdate(input)
  values.push(id)

  const result = await pool.query(
    `UPDATE ingredients
     SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  )
  if (result.rows.length === 0) throw notFound('食材')
  return ok(res, result.rows[0])
})

async function finishIngredient(req, res, status) {
  const id = parseId(req.params.id)
  const remainingText = optionalText(req.body.remaining_text, 'remaining_text')
  const note = optionalText(req.body.note, 'note', 5000)

  const result = await pool.query(
    `UPDATE ingredients
     SET status = $1::varchar,
         remaining_text = COALESCE($2::varchar, remaining_text),
         remaining_value = CASE WHEN $1::varchar = 'consumed' THEN 0::numeric ELSE remaining_value END,
         note = CASE
           WHEN $3::text IS NULL THEN note
           WHEN note IS NULL OR note = '' THEN $3::text
           ELSE note || E'\n' || $3::text
         END,
         ended_at = NOW(),
         updated_at = NOW()
     WHERE id = $4::bigint
     RETURNING *`,
    [status, remainingText, note, id]
  )
  if (result.rows.length === 0) throw notFound('食材')
  return ok(res, result.rows[0])
}

router.post('/:id/consume', async (req, res) => finishIngredient(req, res, 'consumed'))
router.post('/:id/discard', async (req, res) => finishIngredient(req, res, 'discarded'))

router.get('/:id/consumptions', async (req, res) => {
  const id = parseId(req.params.id)
  const ingredient = await pool.query('SELECT id FROM ingredients WHERE id = $1', [id])
  if (ingredient.rows.length === 0) throw notFound('食材')

  const result = await pool.query(
    `SELECT c.*, m.meal_date, m.meal_type, m.title AS meal_title, m.dishes
     FROM consumptions c
     LEFT JOIN meal_records m ON m.id = c.meal_record_id
     WHERE c.ingredient_id = $1
     ORDER BY c.consumed_date DESC, c.created_at DESC`,
    [id]
  )
  return ok(res, result.rows)
})

module.exports = router
