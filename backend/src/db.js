const { Pool, types } = require('pg')

// PostgreSQL DATE 保持 YYYY-MM-DD，避免被本地时区转换成前一天。
types.setTypeParser(1082, (value) => value)
// 当前业务数量和 ID 都处于 JavaScript 安全数字范围，API 统一返回 number。
types.setTypeParser(1700, (value) => Number(value))
types.setTypeParser(20, (value) => Number(value))

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'pantry_nook',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
})

pool.on('error', (err) => {
  console.error('PostgreSQL client error', err)
})

module.exports = pool
