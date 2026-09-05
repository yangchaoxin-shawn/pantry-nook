require('dotenv').config()
const express = require('express')
const cors = require('cors')
const pool = require('./db')

const ingredientsRouter = require('./routes/ingredients')
const mealsRouter = require('./routes/meals')
const consumptionsRouter = require('./routes/consumptions')

const app = express()

app.disable('x-powered-by')
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || '*',
}))
app.use(express.json({ limit: '1mb' }))

app.get('/health', async (req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok', database: 'connected' })
})

app.use('/api/ingredients', ingredientsRouter)
app.use('/api/meals', mealsRouter)
app.use('/api/consumptions', consumptionsRouter)

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: '接口不存在',
    },
  })
})

app.use((err, req, res, next) => {
  const status = err.status || 500
  if (status >= 500) console.error(err)

  res.status(status).json({
    error: {
      code: status >= 500 ? 'INTERNAL_ERROR' : (err.code || 'REQUEST_ERROR'),
      message: status >= 500 ? '服务器内部错误' : err.message,
      ...(status < 500 && err.details ? { details: err.details } : {}),
    },
  })
})

const PORT = Number(process.env.PORT) || 3000
const server = app.listen(PORT, () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`)
})

async function shutdown(signal) {
  console.log(`收到 ${signal}，正在关闭服务`)
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

module.exports = app
