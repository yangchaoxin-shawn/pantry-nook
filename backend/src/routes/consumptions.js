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

function consumptionInput(body, { partial = false } = {}) {
  const input = {}
  const has = (field) => Object.prototype.hasOwnProperty.call(body, field)

  if (!partial || has('consumed_date')) {
    input.consumed_date = requiredText(body.consumed_date, 'consumed_date', 10)
    input.consumed_date = optionalDate(input.consumed_date, 'consumed_date')
  }
  if (!partial || has('ingredient_id')) {
    const ingredientId = Number(body.ingredient_id)
    if (!Number.isSafeInteger(ingredientId) || ingredientId <= 0) {
      throw validationError('ingredient_id 必须是正整数')
    }
    input.ingredient_id = ingredientId
  }
  if (has('meal_record_id')) {
    if (body.meal_record_id === null || body.meal_record_id === '') {
      input.meal_record_id = null
    } else {
      const mealId = Number(body.meal_record_id)
      if (!Number.isSafeInteger(mealId) || mealId <= 0) {
        throw validationError('meal_record_id 必须是正整数')
      }
      input.meal_record_id = mealId
    }
  }
  if (!partial || has('quantity_used_text')) {
    input.quantity_used_text = requiredText(body.quantity_used_text, 'quantity_used_text')
  }
  if (has('quantity_value')) {
    input.quantity_value = optionalNumber(body.quantity_value, 'quantity_value', { min: 0, exclusiveMin: true })
  }
  if (has('quantity_unit')) {
    input.quantity_unit = optionalText(body.quantity_unit, 'quantity_unit', 50)
  }
  if (has('note')) input.note = optionalText(body.note, 'note', 5000)

  if (partial && Object.keys(input).length === 0) {
    throw validationError('至少需要提供一个可修改字段')
  }
  return input
}

async function assertRelations(input) {
  if (input.ingredient_id !== undefined) {
    const ingredient = await pool.query('SELECT id FROM ingredients WHERE id = $1', [input.ingredient_id])
    if (ingredient.rows.length === 0) throw notFound('食材')
  }
  if (input.meal_record_id !== undefined && input.meal_record_id !== null) {
    const meal = await pool.query('SELECT id FROM meal_records WHERE id = $1', [input.meal_record_id])
    if (meal.rows.length === 0) throw notFound('做菜记录')
  }
}

function fieldValue(value) {
  return value
}

router.get('/', async (req, res) => {
  const { limit, offset } = pagination(req.query)
  const conditions = []
  const values = []

  if (req.query.from !== undefined) {
    values.push(optionalDate(req.query.from, 'from'))
    conditions.push(`c.consumed_date >= $${values.length}`)
  }
  if (req.query.to !== undefined) {
    values.push(optionalDate(req.query.to, 'to'))
    conditions.push(`c.consumed_date <= $${values.length}`)
  }
  if (req.query.ingredient_id !== undefined) {
    const ingredientId = parseId(req.query.ingredient_id, 'ingredient_id')
    values.push(ingredientId)
    conditions.push(`c.ingredient_id = $${values.length}`)
  }
  if (req.query.q !== undefined) {
    const query = requiredText(req.query.q, 'q', 100)
    values.push(`%${query}%`)
    conditions.push(`(
      i.name ILIKE $${values.length}
      OR c.quantity_used_text ILIKE $${values.length}
      OR COALESCE(c.note, '') ILIKE $${values.length}
    )`)
  }

  values.push(limit, offset)
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query(
    `SELECT c.*, i.name AS ingredient_name, i.category, i.location,
            m.meal_date, m.meal_type, m.title AS meal_title, m.dishes,
            COUNT(*) OVER()::int AS total_count
     FROM consumptions c
     JOIN ingredients i ON i.id = c.ingredient_id
     LEFT JOIN meal_records m ON m.id = c.meal_record_id
     ${where}
     ORDER BY c.consumed_date DESC, c.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  )

  const total = result.rows[0]?.total_count ?? 0
  const items = result.rows.map(({ total_count, ...item }) => item)
  return ok(res, items, { total, limit, offset })
})

router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const result = await pool.query(
    `SELECT c.*, i.name AS ingredient_name, i.category, i.location,
            m.meal_date, m.meal_type, m.title AS meal_title, m.dishes
     FROM consumptions c
     JOIN ingredients i ON i.id = c.ingredient_id
     LEFT JOIN meal_records m ON m.id = c.meal_record_id
     WHERE c.id = $1`,
    [id]
  )
  if (result.rows.length === 0) throw notFound('消耗记录')
  return ok(res, result.rows[0])
})

router.post('/', async (req, res) => {
  const input = consumptionInput(req.body)
  await assertRelations(input)
  const result = await pool.query(
    `INSERT INTO consumptions (
       consumed_date, ingredient_id, meal_record_id,
       quantity_used_text, quantity_value, quantity_unit, note
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.consumed_date,
      input.ingredient_id,
      input.meal_record_id ?? null,
      input.quantity_used_text,
      input.quantity_value ?? null,
      input.quantity_unit ?? null,
      input.note ?? null,
    ]
  )
  return created(res, result.rows[0])
})

router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const input = consumptionInput(req.body, { partial: true })
  await assertRelations(input)
  const entries = Object.entries(input)
  const assignments = entries.map(([field], index) => `${field} = $${index + 1}`)
  const values = entries.map(([, value]) => fieldValue(value))
  values.push(id)

  const result = await pool.query(
    `UPDATE consumptions
     SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  )
  if (result.rows.length === 0) throw notFound('消耗记录')
  return ok(res, result.rows[0])
})

router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id)
  const result = await pool.query(
    'DELETE FROM consumptions WHERE id = $1 RETURNING *',
    [id]
  )
  if (result.rows.length === 0) throw notFound('消耗记录')
  return ok(res, result.rows[0])
})

module.exports = router
