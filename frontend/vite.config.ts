import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiTarget = env.PANTRY_API_PROXY_TARGET || 'http://localhost:3000'
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
      },
    },
  }
})
