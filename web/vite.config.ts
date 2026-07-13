import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // 6000은 브라우저가 X11 예약 포트로 차단(ERR_UNSAFE_PORT)해서 6001 사용
    port: 6001,
    strictPort: true,
    host: true, // 컨테이너/원격 환경에서 외부 접근 허용
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
