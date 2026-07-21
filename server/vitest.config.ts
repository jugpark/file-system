import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 테스트가 실 SQLite(app.db) 하나를 공유하므로 파일 병렬 실행을 끈다 —
    // 여러 워커가 기동 시 같은 DB에 마이그레이션을 걸면 'database is locked'가 난다.
    fileParallelism: false,
  },
})
