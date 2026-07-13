# ── 빌드 스테이지 ─────────────────────────────────────────────
# sharp/better-sqlite3가 네이티브 모듈이라 빌드·실행 베이스 이미지를 반드시 일치시킬 것
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

COPY . .
# 웹 빌드 → server/public 에 포함됨
RUN pnpm --filter @fs/web build
# 서버 + 프로덕션 의존성(+워크스페이스 @fs/shared)만 추출
RUN pnpm --filter @fs/server deploy --prod /out

# ── 실행 스테이지 ─────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
COPY --from=build /repo/server/public ./public

# 데이터 볼륨: 스토리지(NAS)와 DB·썸네일은 컨테이너 밖에 산다
ENV STORAGE_ROOT=/data/storage
ENV DATABASE_PATH=/data/db/app.db
VOLUME ["/data/storage", "/data/db"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
