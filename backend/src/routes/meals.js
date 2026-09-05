const express = require('express')
const pool = require('../db')
const { notFound } = require('../lib/errors')
const {
  dishesArray,
  enumValue,
  optionalDate,
  optionalText,
  pagination,
  parseId,
  requiredText,
  validationError,
} = require('../lib/validation')
const { created, ok } = require('../lib/responses')

const router = express.Router()
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other']

function mealInput(body, { partial = false } = {}) {
  const input = {}
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field)

  if (!partial || has('meal_date')) {
    input.meal_date = requiredText(body.meal_date, 'meal_date', 10)
    input.meal_date = optionalDate(input.meal_date, 'meal_date')
  }

  if (has('meal_type')) {
    input.meal_type = enumValue(body.meal_type, 'meal_type', MEAL_TYPES, { optional: true })
  }
  if (has('title')) input.title = optionalText(body.title, 'title')
  if (!partial || has('dishes')) input.dishes = dishesArray(body.dishes)
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
    values: entries.map(([, value]) => fieldValue(value)),
  }
}

function fieldValue(value) {
  return Array.isArray(value) ? JSON.stringify(value) : value
}

router.get('/', async (req, res) => {
  const { limit, offset } = pagination(req.query)
  const conditions = []
  const values = []

  if (req.query.from !== undefined) {
    values.push(optionalDate(req.query.from, 'from'))
    conditions.push(`m.meal_date >= $${values.length}`)
  }
  if (req.query.to !== undefined) {
    values.push(optionalDate(req.query.to, 'to'))
    conditions.push(`m.meal_date <= $${values.length}`)
  }
  if (req.query.meal_type !== undefined) {
    values.push(enumValue(req.query.meal_type, 'meal_type', MEAL_TYPES))
    conditions.push(`m.meal_type = $${values.length}`)
  }
  if (req.query.q !== undefined) {
    const query = requiredText(req.query.q, 'q', 100)
    values.push(`%${query}%`)
    conditions.push(`(
      COALESCE(m.title, '') ILIKE $${values.length}
      OR COALESCE(m.note, '') ILIKE $${values.length}
      OR m.dishes::text ILIKE $${values.length}
    )`)
  }

  values.push(limit, offset)
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query(
    `SELECT m.*, COUNT(*) OVER()::int AS total_count
     FROM meal_records m
     ${where}
     ORDER BY m.meal_date DESC, m.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  )

  const total = result.rows[0]?.total_count ?? 0
  const items = result.rows.map(({ total_count, ...item }) => item)
  return ok(res, items, { total, limit, offset })
})

router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const result = await pool.query('SELECT * FROM meal_records WHERE id = $1', [id])
  if (result.rows.length === 0) throw notFound('做菜记录')
  return ok(res, result.rows[0])
})

router.post('/', async (req, res) => {
  const input = mealInput(req.body)
  const result = await pool.query(
    `INSERT INTO meal_records (meal_date, meal_type, title, dishes, note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.meal_date,
      input.meal_type ?? null,
      input.title ?? null,
      JSON.stringify(input.dishes),
      input.note ?? null,
    ]
  )
  return created(res, result.rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const input = mealInput(req.body, { partial: true })
  const entries = Object.entries(input)
  const assignments = entries.map(([field], index) => `${field} = $${index + 1}`)
  const values = entries.map(([, value]) => fieldValue(value))
  values.push(id)

  const result = await pool.query(
    `UPDATE meal_records
     SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  )
  if (result.rows.length === 0) throw notFound('做菜记录')
  return ok(res, result.rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const result = await pool.query(
    'DELETE FROM meal_records WHERE id = $1 RETURNING *',
    [id]
  )
  if (result.rows.length === 0) throw notFound('做菜记录')
  return ok(res, result.rows[0])
})

router.get('/:id/consumptions', async (req, res) => {
  const id = parseId(req.params.id)
  const meal = await pool.query('SELECT id FROM meal_records WHERE id = $1', [id])
  if (meal.rows.length === 0) throw notFound('做菜记录')

  const result = await pool.query(
    `SELECT c.*, i.name AS ingredient_name, i.category, i.location
     FROM consumptions c
     JOIN ingredients i ON i.id = c.ingredient_id
     WHERE c.meal_record_id = $1
     ORDER BY c.created_at DESC`,
    [id]
  )
  return ok(res, result.rows)
})

module.exports = router
