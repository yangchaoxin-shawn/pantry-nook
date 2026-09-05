// 一次性脚本：创建 pantry_nook 数据库并导入 schema
// 用法：node scripts/init-db.js
require('dotenv').config()
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

async function main() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  }

  const admin = new Client({ ...config, database: 'postgres' })
  await admin.connect()

  const exists = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = 'pantry_nook'"
  )
  if (exists.rowCount === 0) {
    await admin.query('CREATE DATABASE pantry_nook')
    console.log('已创建数据库 pantry_nook')
  } else {
    console.log('数据库 pantry_nook 已存在')
  }
  await admin.end()

  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql')
  const schema = fs.readFileSync(schemaPath, 'utf8')

  const db = new Client({ ...config, database: 'pantry_nook' })
  await db.connect()
  await db.query(schema)
  console.log('已导入表结构')
  await db.end()
  console.log('完成')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
