# 사내 파일 시스템

10~20인 사내 로컬 서버(NAS) 파일을 웹에서 관리하는 시스템.
Discord OAuth2 + Role 기반 권한, 3단 레이아웃 파일 탐색기.

- UI 명세: `docs/file-system-ui-spec.html`
- 기술 스펙: `docs/file-system-dev-spec.md`

## 구조

pnpm 모노레포. 빌드하면 SPA가 서버에 포함되어 **배포 산출물은 프로세스 1개**.

```
shared/   서버·웹 공용 API 타입
server/   Fastify + SQLite(drizzle) — API, 인증, ACL, 파일 스트리밍
web/      Vite + React SPA — 3단 레이아웃 탐색기
```

## 빠른 시작 (개발)

요구사항: **Node 20 이상**(24까지 확인됨) + pnpm(`corepack enable`).
네이티브 모듈(better-sqlite3·sharp)의 빌드 스크립트 허용은 루트 package.json의
`pnpm.onlyBuiltDependencies`에 이미 설정돼 있다 — pnpm 10에서도 추가 조치 불필요.

```bash
pnpm install
pnpm seed:dev     # 샘플 폴더/파일 + ACL 시드 (dev 전용)
pnpm dev          # server :3000 + web :6001 동시 실행
```

→ **http://localhost:6001** 접속. **Discord 미설정 상태에서는 dev auth 모드**로
동작해 [Discord로 로그인] 버튼이 가짜 유저(`DEV_USERNAME`, roles=`DEV_ROLES`)로 로그인한다.

관리자 화면(/admin)까지 보려면 레포 루트에 `.env`를 만들고:

```
ADMIN_ROLE_ID=admin-role
DEV_ROLES=design,admin-role
```

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
- [x] **M2** — 업로드(DnD·진행률 토스트·원자적 저장)·폴더 생성·이름 변경·이동/복사·
      휴지통(+복원, `/trash` 페이지), 전 쓰기 작업 activity_log 기록, 목록에 업로더 표시
- [x] **M3** — 정보 패널 활동 타임라인, 파일명 검색(`/search`), 최근 파일(`/recent`),
      fs_index(기동 전체 스캔 + chokidar 워처 + 주기 재스캔 안전망)
- [x] **M4** — 그리드 뷰(+이미지 썸네일, sharp·webp 디스크 캐시), 반응형(<1024px 정보
      패널→바텀 시트, <720px LNB→드로어), 읽기 전용 자물쇠 시각화, 휴지통 자동 비우기
      (`TRASH_RETENTION_DAYS`, 기본 30일)

**M1~M4 + 확장 R1~R4 전체 완료** (`docs/file-system-extended-spec.md`):

- **R1** — `docker/`(Dockerfile·compose·Caddyfile), `deploy/backup.sh`(sqlite .backup+rsync 증분),
  helmet(CSP)+rate-limit(로그인 10/분), **admin role**(`ADMIN_ROLE_ID` — 전 경로 접근, 남의 home은 read)
- **R2** — 파일 미리보기(이미지/PDF/동영상/오디오/텍스트, **html·svg는 inline 금지**),
  다중 선택(Ctrl/Shift)+일괄 이동·복사·삭제+**zip 다운로드**(폴더 포함), **폴더째 업로드**(DnD·선택 모두),
  Discord 웹훅 알림(5분 디바운스), **SSE 실시간 갱신**(/api/events)
- **R3** — `/admin` 관리 페이지(ACL 규칙 CRUD + Discord role 목록, 사용량 대시보드, 감사 로그),
  사이드바 디스크 게이지, 디스크 여유 10% 미만 웹훅 경고
- **R4** — 공유 링크(무인증 다운로드, 만료 1/7/30일, `/shares` 관리), 버전 보관(같은 이름
  덮어쓰기 시 최근 5개 자동 보관+복원), 다크 모드, 즐겨찾기(핀), 키보드 단축키(Del/F2/Enter/Esc/방향키),
  **문서 내용 검색**(PDF·docx/xlsx/pptx·HWPX·텍스트 → FTS5 trigram, 검색 페이지에
  "파일명 일치 / 문서 내용 일치" 분리 표시. `CONTENT_SEARCH_DISABLED=true`로 끄기,
  `CONTENT_MAX_MB` 초과 파일은 추출 생략, 기본 20MB)

**고도화 1차(2026-07-20, 스펙 외 신규)**:

- **검색 필터** — 위치(검색 시점 폴더 아래로 좁히기, GNB에서 검색하면 자동 후보)·형식
  (문서/이미지/영상/음성/압축)·기간·업로더. 파일명/내용 두 섹션에 공통 적용
- **딥링크** — 우클릭 '링크 복사'(폴더=그 폴더, 파일=부모 폴더+`?focus=이름`),
  링크로 들어오면 해당 행 선택·스크롤·강조. 사내망 http에서도 동작(클립보드 폴백)
- **다운로드 감사 로그** — attachment·zip·공유링크 다운로드를 activity_log에 기록
  (inline 미리보기는 제외). /admin 감사 로그에서 '다운로드' 필터로 조회
- **휴지통 관리** — 항목별 크기+합계 표시(삭제 시점 계산, 기존 행은 lazy 백필),
  admin 전용 개별 영구 삭제·전체 비우기(`trash_purge`로 감사 기록)
- **내용 인덱스 대시보드** — /admin에서 추출 완료/생략/실패 카운트·대기 큐·실패
  목록 확인, 실패 전부 재시도

미구현으로 남긴 것: 오피스 동시 편집·WebDAV 등 비권장 목록. 레거시 바이너리 포맷
(doc/hwp/xls/ppt)의 내용 추출은 파서 유지비 대비 효용이 낮아 제외.

> ⚠ 같은 이름 업로드의 의미가 바뀌었다: " (1)" 회피 대신 **기존본을 버전으로 보관하고
> 이름을 승계**한다(파일↔폴더 충돌만 " (1)"). 이전 버전은 우클릭 → '버전 기록'.

> **검색 구현 노트**: 파일명은 `name_search`(NFC·소문자) LIKE 스캔 — 10~20인 NAS
> 규모에서는 FTS 동기화 복잡도가 이득보다 크다. 문서 **내용**은 별도 2차 인덱스
> (`content_fts`, FTS5 trigram — 한글 포함 3글자 이상 부분 일치, 2글자는 LIKE 폴백)로,
> fs_index 갱신 훅을 그대로 따라가며 추출은 백그라운드 큐에서 한 건씩 처리한다.
>
> **inotify 미지원 마운트**(WSL 9p/drvfs, 일부 NFS/SMB)에서는 `WATCH_POLLING=true`
> 필요. 어느 환경이든 `INDEX_RESCAN_MIN`(기본 10분) 주기 재스캔이 안전망.
