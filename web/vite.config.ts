import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // dev에서 API는 Fastify(:3000)로 프록시 — OAuth redirect도 이 경유로 동작
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    // 빌드 결과물을 서버가 직접 서빙 → 배포 산출물은 서버 하나
    outDir: '../server/public',
    emptyOutDir: true,
  },
})
