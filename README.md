# 사내 파일 시스템

10~20인 사내 로컬 서버(NAS) 파일을 웹에서 관리하는 시스템.
Discord OAuth2 + Role 기반 권한, 3단 레이아웃 파일 탐색기.

- UI 명세: `../file-system-ui-spec.html`
- 기술 스펙: `../file-system-dev-spec.md`

## 구조

pnpm 모노레포. 빌드하면 SPA가 서버에 포함되어 **배포 산출물은 프로세스 1개**.

```
shared/   서버·웹 공용 API 타입
server/   Fastify + SQLite(drizzle) — API, 인증, ACL, 파일 스트리밍
web/      Vite + React SPA — 3단 레이아웃 탐색기
```

## 빠른 시작 (개발)

```bash
pnpm install
pnpm seed:dev     # 샘플 폴더/파일 + ACL 시드 (dev 전용)
pnpm dev          # server :3000 + web :5173 동시 실행
```

→ http://localhost:5173 접속. **Discord 미설정 상태에서는 dev auth 모드**로
동작해 [Discord로 로그인] 버튼이 가짜 유저(`DEV_USERNAME`, roles=`DEV_ROLES`)로 로그인한다.

실제 Discord 연동: `.env.example`을 `.env`로 복사해 `DISCORD_*` 4개를 채우면 된다.
Developer Portal에서 앱 생성 → OAuth2 redirect `{BASE_URL}/api/auth/callback` 등록,
봇 생성 후 사내 서버에 초대(유저 토큰으로는 role 조회가 안 되므로 봇 토큰 필수).

## 명령

| 명령 | 동작 |
|---|---|
| `pnpm dev` | 개발 서버 (server + web, /api는 프록시) |
| `pnpm build` | web 빌드 → `server/public/` |
| `pnpm start` | 프로덕션 단일 서버 (:3000) |
| `pnpm test` | 서버 단위 테스트 (경로 보안·ACL) |
| `pnpm typecheck` | 전 패키지 타입 검사 |
| `pnpm seed:acl` | `server/src/db/acl-seed.ts`의 ACL 적용 |
| `pnpm seed:dev` | 샘플 스토리지 + ACL 시드 |

## 권한 모델 (v1)

- ACL은 `server/src/db/acl-seed.ts`에서 코드로 관리 → `pnpm seed:acl` (관리 UI는 v2)
- 가장 깊은 path prefix가 승리, 같은 깊이면 write > read, 매칭 없으면 숨김
- `/home/{discordUserId}`는 본인 자동 write, 남의 home은 ACL로도 불가

## 마일스톤 현황

- [x] **M1** — 로그인/차단, ACL·경로보안(+테스트), 트리·리스트·breadcrumb·다운로드, 스켈레톤
- [ ] **M2** — 업로드(DnD·진행률)·폴더 생성·이름 변경·이동/복사·휴지통, 활동 로그 기록
- [ ] **M3** — 정보 패널 활동 타임라인, 검색(FTS5), 최근 파일, chokidar 인덱스
- [ ] **M4** — 그리드 뷰·썸네일, 반응형(바텀 시트), 휴지통 자동 비우기

UI에 이미 자리 잡은 비활성 요소(새로 만들기, 이름 바꾸기, 삭제, 검색, 그리드 토글,
드롭존)는 해당 마일스톤에서 활성화된다.
