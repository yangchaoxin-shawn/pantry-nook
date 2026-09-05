const { HttpError } = require('./errors')

function validationError(message, details = null) {
  return new HttpError(400, 'VALIDATION_ERROR', message, details)
}

function parseId(value, fieldName = 'id') {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw validationError(`${fieldName} 必须是正整数`)
  }
  return id
}

function requiredText(value, fieldName, maxLength = 255) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validationError(`${fieldName} 为必填项`)
  }

  const text = value.trim()
  if (text.length > maxLength) {
    throw validationError(`${fieldName} 不能超过 ${maxLength} 个字符`)
  }
  return text
}

function optionalText(value, fieldName, maxLength = 255) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string') {
    throw validationError(`${fieldName} 必须是文本`)
  }

  const text = value.trim()
  if (text.length > maxLength) {
    throw validationError(`${fieldName} 不能超过 ${maxLength} 个字符`)
  }
  return text || null
}

function optionalNumber(value, fieldName, { min = 0, exclusiveMin = false } = {}) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null

  const number = Number(value)
  const invalidRange = exclusiveMin ? number <= min : number < min
  if (!Number.isFinite(number) || invalidRange) {
    const operator = exclusiveMin ? '大于' : '大于或等于'
    throw validationError(`${fieldName} 必须是${operator} ${min} 的数字`)
  }
  return number
}

function optionalDate(value, fieldName) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`${fieldName} 必须使用 YYYY-MM-DD 格式`)
  }

  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw validationError(`${fieldName} 不是有效日期`)
  }
  return value
}

function enumValue(value, fieldName, allowed, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) {
    return value === undefined ? undefined : null
  }
  if (!allowed.includes(value)) {
    throw validationError(`${fieldName} 只能是：${allowed.join('、')}`)
  }
  return value
}

function dishesArray(value) {
  if (!Array.isArray(value)) {
    throw validationError('dishes 必须是菜品名称数组')
  }

  const dishes = value.map((item, index) => requiredText(item, `dishes[${index}]`, 255))
  if (dishes.length === 0) {
    throw validationError('至少需要填写一个菜品')
  }
  if (dishes.length > 50) {
    throw validationError('一条做菜记录最多包含 50 个菜品')
  }
  return dishes
}

function pagination(query) {
  const requestedLimit = query.limit === undefined ? 50 : Number(query.limit)
  const requestedOffset = query.offset === undefined ? 0 : Number(query.offset)

  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    throw validationError('limit 必须是 1 到 100 之间的整数')
  }
  if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
    throw validationError('offset 必须是大于或等于 0 的整数')
  }

  return { limit: requestedLimit, offset: requestedOffset }
}

module.exports = {
  parseId,
  requiredText,
  optionalText,
  optionalNumber,
  optionalDate,
  enumValue,
  dishesArray,
  pagination,
  validationError,
}
