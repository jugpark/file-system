# 사내 파일 시스템 — 개발 스펙 (모노레포)

> UI 명세: `file-system-ui-spec.html` (v1 draft) 기반.
> 이 문서는 그 UI를 구현하기 위한 **기술 스펙**이다: 저장소 구조, 스택, DB 스키마, API, 인증/권한, 파일 처리 규칙, 마일스톤.

---

## 0. 한 줄 요약

**pnpm 모노레포** 안에 Fastify 백엔드(`server/`)와 Vite+React SPA(`web/`)를 두고,
빌드 시 SPA 정적 파일을 Fastify가 서빙 → **배포 산출물 = Docker 이미지 1개, 프로세스 1개, 포트 1개.**

---

## 1. 저장소 구조

```
file-system/
├─ package.json              # 워크스페이스 루트 (스크립트 허브)
├─ pnpm-workspace.yaml       # packages: server, web, shared
├─ docker/
│  ├─ Dockerfile             # 멀티스테이지: web 빌드 → server 빌드 → 실행
│  └─ docker-compose.yml     # app + caddy
├─ shared/                   # 서버·웹 공용 타입/상수
│  └─ src/
│     ├─ api-types.ts        # 요청/응답 DTO (양쪽에서 import)
│     └─ constants.ts        # 권한 enum, 업로드 제한 등
├─ server/
│  └─ src/
│     ├─ index.ts            # Fastify 부팅, 정적 서빙, 워처 기동
│     ├─ config.ts           # env 로드·검증 (zod)
│     ├─ auth/               # Discord OAuth2, 세션, role 캐시
│     ├─ acl/                # 권한 해석 (path prefix → permission)
│     ├─ fs/                 # 파일 작업 (안전경로, 스트리밍, 휴지통)
│     ├─ watcher/            # chokidar → fs_index 동기화
│     ├─ db/                 # Drizzle 스키마 + 마이그레이션
│     └─ routes/             # /api/* 라우트
└─ web/
   └─ src/
      ├─ app/                # 라우터, QueryClient, 전역 레이아웃
      ├─ features/
      │  ├─ auth/            # 로그인 화면, 세션 훅
      │  ├─ explorer/        # 중앙 메인 뷰 (리스트/그리드, DnD, 우클릭)
      │  ├─ sidebar/         # LNB + 폴더 트리
      │  ├─ info-panel/      # 우측 정보·활동 로그 패널
      │  ├─ upload/          # 업로드 큐 + 진행률 토스트
      │  └─ search/
      ├─ components/         # 공용 UI (아이콘 등, 명세 HTML에서 이식)
      └─ lib/                # api 클라이언트 (shared 타입 사용)
```

### 스크립트 (루트 package.json)

| 명령 | 동작 |
|---|---|
| `pnpm dev` | server(tsx watch, :3000) + web(vite dev, :5173 → /api 프록시) 동시 실행 |
| `pnpm build` | web 빌드 → `server/public/`으로 복사 → server 빌드 |
| `pnpm start` | 빌드된 단일 서버 실행 |
| `pnpm db:migrate` | Drizzle 마이그레이션 |
| `pnpm test` | vitest (server 단위 + web 컴포넌트) |

---

## 2. 기술 스택 (확정)

| 영역 | 선택 | 비고 |
|---|---|---|
| 패키지 매니저 | pnpm workspaces | npm workspaces로 대체 가능 |
| 백엔드 | Node.js 22 LTS + Fastify 5 + TypeScript | `@fastify/multipart`(업로드), `@fastify/static`(SPA), `@fastify/cookie` |
| DB | SQLite (better-sqlite3) + Drizzle ORM | WAL 모드. 검색은 fs_index LIKE 스캔(M3에서 FTS5 대신 채택 — 소규모에선 동기화 복잡도가 이득보다 큼, 대규모화 시 FTS5 trigram 교체) |
| 파일 감시 | chokidar | 외부 변경(삼바/SSH) → 인덱스 보정 |
| 프론트 | React 19 + TypeScript + Vite | SPA, React Router |
| 서버 상태 | TanStack Query | 폴더 목록 캐시 키 = 경로 |
| UI | 전역 CSS — UI 명세 토큰 직접 이식 | `file-system-ui-spec.html`의 CSS 변수·컴포넌트 스타일을 `web/src/styles.css`로 1:1 이식 (운영자 지시, Tailwind 미사용) |
| DnD/업로드 | 네이티브 DnD API + XHR(진행률) | 라이브러리 불필요 |
| 썸네일 | sharp | M4 |
| 배포 | Docker + Caddy(HTTPS) | NAS/서버에 compose 1벌 |

---

## 3. 환경 변수

```
BASE_URL=https://files.example.com
PORT=3000
SESSION_SECRET=            # 32바이트 랜덤
STORAGE_ROOT=/data/storage # 실제 파일 루트 (볼륨 마운트)
DATABASE_PATH=/data/app.db
MAX_UPLOAD_MB=2048

DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=         # 서버 멤버의 role 조회용 (필수!)
DISCORD_GUILD_ID=          # 사내 서버 ID
```

> **준비물**: Discord Developer Portal에서 앱 생성 → OAuth2 redirect에 `{BASE_URL}/api/auth/callback` 등록, 봇 생성 후 사내 서버에 초대(권한: 멤버 읽기). 유저 OAuth 토큰만으로는 **서버 내 role을 조회할 수 없어** 봇 토큰이 필수다.

---

## 4. 인증 · 세션

### 로그인 플로우
1. `GET /api/auth/login` → Discord authorize URL로 리다이렉트 (scope: `identify`)
2. `GET /api/auth/callback` → code 교환 → 유저 ID 획득
3. 봇 토큰으로 `GET /guilds/{GUILD_ID}/members/{userId}` 호출
   - 404(비멤버) → 로그인 화면에 "사내 디스코드 서버 멤버만 접근할 수 있습니다" 에러 표시
   - 성공 → role ID 목록 획득
4. `users` upsert, `sessions` 생성, httpOnly+secure 쿠키 발급 (유효 14일)

### Role 캐시
- 세션에 role 목록 + `roles_fetched_at` 저장, **TTL 10분** — 만료 시 요청 처리 전에 봇 API로 재조회.
- 재조회 시 404(서버에서 강퇴됨) → 세션 즉시 파기.
- Discord API 장애 시: 캐시가 있으면 stale 허용(최대 1시간), 없으면 401.

---

## 5. 권한 모델 (ACL)

### 규칙
- `folder_acl` 테이블: `(path_prefix, role_id, permission)` — permission ∈ `read` | `write`.
- 해석: 유저의 role들로 매칭되는 prefix 중 **가장 긴(깊은) prefix가 승리**, 같은 깊이면 write > read. 매칭 없으면 **deny**(목록에서도 숨김).
- **개인 공간**: `/home/{discordUserId}/` 는 ACL 없이 본인에게 자동 write. 첫 로그인 시 폴더 자동 생성.
- 모든 검사는 **서버에서** 수행. UI의 자물쇠 배지·메뉴 비활성화는 표시용일 뿐이다.

### 예시
| path_prefix | role | permission |
|---|---|---|
| `/design/` | @디자인팀 | write |
| `/design/` | @개발팀 | read |
| `/ops/confidential/` | @경영지원 | write |

→ 개발팀원이 `/design/shared/시안_v2` 열람 가능, 이름 변경 시도 시 서버가 403.

### ACL 관리 (v1)
관리 UI는 만들지 않는다. `folder_acl`은 시드 스크립트(`server/src/db/seed-acl.ts`)로 관리하고, 변경 시 스크립트 수정 후 재실행. (관리 화면은 v2 후보)

---

## 6. DB 스키마 (Drizzle / SQLite)

```
users          id(discord id, PK), username, avatar_url, created_at, last_login_at
sessions       id(random, PK), user_id, roles_json, roles_fetched_at, expires_at
folder_acl     id, path_prefix, role_id, permission, note
file_meta      path(PK, NFC 정규화 상대경로), uploader_id, uploaded_at
activity_log   id, path, actor_id, action, detail_json, created_at
               -- action: upload | mkdir | rename | move | copy | trash | restore
trash          id, original_path, stored_name, is_dir, deleted_by, deleted_at
fs_index      path(PK), name, parent, is_dir, size, mtime, updated_at
               -- + FTS5 가상 테이블(name) : 검색·최근파일 전용
```

### 진실의 원천 원칙 ⭐
- **탐색(목록)은 항상 라이브 `fs.readdir`** — 파일 존재 여부에 대해 DB를 믿지 않는다.
- DB는 경로를 키로 한 **부가 정보**(업로더, 로그)와 **검색 인덱스**만 담당.
- `fs_index`는 chokidar 이벤트로 갱신 + **서버 기동 시 전체 스캔 1회**로 보정. 외부에서 직접 넣은 파일은 메타데이터 없이(업로더 "—") 표시된다 — 이것이 정직한 상태다.
- rename/move 시 `file_meta`·`fs_index`의 경로 키를 함께 갱신(폴더면 하위 prefix 일괄), 이전 경로는 `activity_log.detail_json`에 남긴다.

---

## 7. API 설계

모든 응답 DTO는 `shared/src/api-types.ts`에 정의. 에러는 `{ error: { code, message } }` 통일.

### 인증
```
GET  /api/auth/login              → Discord로 리다이렉트
GET  /api/auth/callback           → 세션 발급 후 / 로 리다이렉트
POST /api/auth/logout
GET  /api/me                      → { user, roles }
```

### 파일 시스템 (전부 세션 + ACL 검사)
```
GET    /api/fs/list?path=          → { entries: [{name,isDir,size,mtime,uploader?,permission}] }
GET    /api/fs/tree?path=&depth=1  → 사이드바 트리 (권한 있는 폴더만)
GET    /api/fs/download?path=      → 스트리밍, Range 지원, Content-Disposition
POST   /api/fs/upload?path=        → multipart 스트리밍. 응답에 최종 파일명(충돌 시 " (1)" 부여)
POST   /api/fs/mkdir               { path, name }
PATCH  /api/fs/rename              { path, newName }
POST   /api/fs/move                { paths[], destDir }        # 원본 read+대상 write 필요... 원본도 write
POST   /api/fs/copy                { paths[], destDir }        # 원본 read + 대상 write
DELETE /api/fs/trash               { paths[] }                 # .trash/로 이동 + 기록
POST   /api/fs/restore             { trashIds[] }
GET    /api/fs/thumbnail?path=&w=  → 이미지 썸네일 (M4, 캐시)
```

### 메타
```
GET /api/search?q=                 → fs_index FTS5, 권한 필터 적용
GET /api/recent?limit=20           → fs_index mtime 상위 + 권한 필터
GET /api/activity?path=&limit=20   → 정보 패널 타임라인
GET /api/trash                     → 내가 볼 수 있는 휴지통 목록
```

### 업로드 상세
- `@fastify/multipart` 스트리밍 → `STORAGE_ROOT/.tmp/{uuid}`에 기록 → 완료 시 `fs.rename`으로 최종 위치 이동(**같은 볼륨 = 원자적**). 실패/중단 시 tmp 정리(기동 시 잔여물 청소 포함).
- 진행률은 클라이언트 XHR `upload.onprogress`로 표시(서버 push 불필요).
- 파일명 처리: **NFC 정규화**, 금지 문자(`/ \ : * ? " < > |`, 제어문자) 거부, 선행 `.` 및 예약명(`.trash`, `.tmp`) 거부.

### 경로 보안 (모든 fs 라우트 공통 미들웨어) ⭐
```
resolve(STORAGE_ROOT, 요청경로) 후 STORAGE_ROOT prefix 검증 (traversal 차단)
→ NFC 정규화 → ACL 해석 → 핸들러 진입
```

### 휴지통
- 실체: `STORAGE_ROOT/.trash/{trashId}` 로 rename + `trash` 레코드.
- 복원: 원경로가 비어 있으면 그대로, 점유 시 " (복원)" 접미사.
- 보존 30일 — 하루 1회 스케줄러가 만료분 영구 삭제.

---

## 8. 프론트엔드 구성

### 라우트
```
/login                 로그인 카드 (비멤버 에러 표시 포함)
/browse/*path          메인 3단 레이아웃 (기본 진입: /browse/home/{me})
/recent                최근 파일
/search?q=             검색 결과 (탐색기와 동일 리스트 뷰)
/trash                 휴지통
```

### 핵심 컴포넌트 ↔ UI 명세 매핑
| UI 명세 | 컴포넌트 | 비고 |
|---|---|---|
| A. 좌측 사이드바 | `Sidebar` + `FolderTree` | 트리는 `/api/fs/tree` lazy 로드(펼칠 때 fetch) |
| B. GNB | `TopBar` + `Breadcrumb` + `SearchBar` | breadcrumb = 현재 경로 split |
| C. 중앙 탐색기 | `Explorer` (`ListView`/`GridView`) | 뷰 모드는 localStorage |
| C. DnD | `DropZone` | 드래그오버 시 하이라이트, 폴더 드롭 지원 |
| C. 우클릭 | `ContextMenu` (자체 구현, 명세 .ctx 스타일) | permission=read면 수정계 항목 disabled+툴팁 |
| D. 정보 패널 | `InfoPanel` | 단일 클릭 선택 시 열림, <1024px에선 바텀 시트 |
| 업로드 토스트 | `UploadQueue` | 다중 파일 큐, 개별 진행률/취소 |
| 스켈레톤 | `ListSkeleton` | Query pending 상태에 표시 |

### TanStack Query 캐시 키
```
['list', path] ['tree', path] ['activity', path] ['recent'] ['search', q] ['me']
```
쓰기 작업 성공 시 해당 경로 + 부모 경로 invalidate. (실시간 동기화는 v1 범위 밖 — 새로고침/재조회로 충분. v2에서 SSE 후보)

---

## 9. 배포

```
docker-compose.yml
├─ app    : 모노레포 멀티스테이지 빌드 (web 빌드 → server에 포함)
│           volumes: 스토리지 경로 → /data/storage, ./data → /data (SQLite)
└─ caddy  : 443 → app:3000, 자동 HTTPS
```

- 백업 대상 = `STORAGE_ROOT` + `app.db` 두 개뿐.
- 헬스체크: `GET /api/health` (DB 접근 + STORAGE_ROOT 쓰기 확인).
- 로그: pino → stdout (docker logs).

---

## 10. 마일스톤

### M1 — 읽기 전용 골격 (보안 기반 완성이 목표)
- 모노레포 스캐폴딩, Docker 빌드 통과
- Discord OAuth2 로그인/로그아웃, 비멤버 차단, role 캐시
- ACL 해석기 + 경로 안전 미들웨어 (**단위 테스트 필수**: traversal, prefix 승리 규칙, NFC)
- 사이드바 트리 + 리스트 뷰 + breadcrumb + 다운로드(Range)
- 스켈레톤 로딩
- ✅ 완료 기준: 다른 role 계정 2개로 접속 시 보이는 폴더가 ACL대로 다르고, `../` 요청이 전부 403.

### M2 — 쓰기 작업
- DnD 업로드(큐+진행률 토스트, 원자적 저장), 폴더 생성, 이름 변경, 이동/복사, 휴지통(+복원)
- 모든 쓰기에 `activity_log` 기록
- ✅ 완료 기준: read 권한 계정의 모든 쓰기 API가 403, 업로드 중단 시 tmp 잔여물 없음, 삭제→복원 왕복 정상.

### M3 — 메타데이터 활용
- 우측 정보 패널(기본 정보 + 권한 배지 + 활동 타임라인)
- chokidar + 기동 시 스캔으로 `fs_index` 유지, 검색(FTS5), 최근 파일
- ✅ 완료 기준: 삼바로 직접 넣은 파일이 1분 내 검색에 잡히고 목록에 업로더 "—"로 표시.

### M4 — 마감
- 그리드 뷰 + 이미지 썸네일(sharp, 디스크 캐시)
- 반응형(정보 패널 → 바텀 시트, 사이드바 → 드로어)
- 권한 자물쇠 시각화, 빈 폴더/에러 상태 화면, 휴지통 자동 비우기 스케줄러
- ✅ 완료 기준: 태블릿 뷰포트에서 탐색~업로드 전 과정 동작.

### v2 후보 (범위 밖)
~~ACL 관리 UI · SSE 실시간 갱신 · 파일 미리보기(PDF/이미지 뷰어) · 공유 링크 · 버전 관리~~
→ **`file-system-extended-spec.md`로 확장·구체화됨** (R1 배포 필수 → R2 체감 기능 → R3 운영 → R4 수요 확인 후, 우선순위·공수·구현 포인트 포함)
