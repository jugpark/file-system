# 사내 파일 시스템 — 확장 권장 스펙안 (v2 로드맵)

> ✅ **2026-07-13 구현 완료** — R1~R4 전 항목 구현·검증됨(스모크 33+회귀 4 통과).
> ✅ **2026-07-20 추가** — 마지막 보류 항목이던 R4 '문서 내용 검색'까지 구현.
> 남은 예외는 비권장 목록뿐.
> 이하 본문은 설계 원본으로 보존한다.
>
> 기본 명세(`file-system-ui-spec.html` + `file-system-dev-spec.md`)의 M1~M4는 **전부 구현 완료**
> (2026-07-13, main 4커밋). 이 문서는 그 위에 얹을 것을 권장하는 확장 스펙이다.
> 모든 항목은 현 코드베이스(Fastify+SQLite+React 모노레포)에 얹는 방법까지 명시한다.
>
> 공수: **S**=반나절 · **M**=1~2일 · **L**=3일+

---

## 우선순위 요약

| 단계 | 성격 | 항목 |
|---|---|---|
| **R1** | 배포 전 필수 | Docker/Caddy 배포 세트, 백업·복구, 보안 하드닝, 관리자 role |
| **R2** | 체감 효용 최대 | 파일 미리보기, 다중 선택+zip 다운로드, 폴더째 업로드, Discord 알림, SSE 실시간 갱신 |
| **R3** | 운영 관리 | ACL 관리 UI, 스토리지 용량 대시보드, 감사 로그 뷰 |
| **R4** | 선택 (수요 확인 후) | 공유 링크, 간이 버전 보관, 문서 내용 검색, 다크 모드 |
| — | 비권장/보류 | 문서 동시 편집, WebDAV 게이트웨이, 실시간 협업 커서 등 (사유 후술) |

**권장 진행 순서: R1 → 실사용 시작 → R2를 쓰면서 하나씩 → R3.**
R4는 팀에서 실제 요청이 나올 때만. 배포 전에 R2를 먼저 만드는 것은 비권장 —
실사용 피드백 없이 기능을 쌓으면 KPAS에서 겪은 "안 쓰는 기능 크러프트"가 재현된다.

---

## R1 — 배포 전 필수 (전부 합쳐 M)

### R1-1. Docker/Caddy 배포 세트 `S`
dev-spec §9에 설계만 있고 파일이 없다. 작성할 것:
- `docker/Dockerfile` — 멀티스테이지: ①pnpm install+web build ②프로덕션 스테이지에
  server+`server/public`+prod deps만. sharp/better-sqlite3는 네이티브라 **빌드·실행
  스테이지의 베이스 이미지(node:22-slim)를 반드시 일치**시킬 것
- `docker/docker-compose.yml` — `app`(볼륨: 스토리지→`/data/storage`, `./data`→DB·썸네일)
  + `caddy`(80/443, 자동 HTTPS). `env_file: .env`
- 헬스체크: compose `healthcheck`로 `GET /api/health` (이미 구현돼 있음)
- 주의: NAS 마운트가 NFS/SMB라면 `.env`에 `WATCH_POLLING=true` 검토 (9p에서 이미 검증됨)

### R1-2. 백업·복구 절차 `S`
백업 대상은 딱 둘: `STORAGE_ROOT`(파일 실체)와 `app.db`(메타·권한·휴지통 원장).
- `deploy/backup.sh`: `sqlite3 app.db ".backup"`(WAL 안전) + 스토리지 rsync → 외부 디스크/클라우드
- cron 일 1회 + 보존 7일. **복구 리허설 1회 필수** — 백업은 복구해 본 것만 백업이다
- thumbs/는 백업 제외(재생성 가능), `.trash/`는 포함

### R1-3. 보안 하드닝 `S`
10~20인 사내라도 인터넷에 노출되는 순간 필요한 최소선:
- `@fastify/rate-limit` — 전역 완만(예: 300/분) + `/api/auth/*`는 엄격(10/분). 봇 스캔 방어
- `@fastify/helmet` — CSP 등 보안 헤더 (SPA라 스크립트 소스 self로 단순)
- 업로드 확장자 블랙리스트는 **불필요**(브라우저 다운로드 전용, 서버가 실행 안 함).
  대신 `content-disposition: attachment` 유지가 핵심(이미 구현) — HTML/SVG 인라인 렌더로
  인한 쿠키 탈취 벡터 차단. R2 미리보기 구현 시 이 원칙과의 충돌 주의(후술)
- 로그: pino를 파일로도 남기고 logrotate (KPAS에서 로그 무한증식 겪은 그 문제)

### R1-4. 관리자(admin) 개념 `S`
지금은 모든 권한이 folder_acl로만 흐른다. 운영에는 "전체를 보는 사람"이 필요하다:
- `.env`에 `ADMIN_ROLE_ID=` 1개 추가. 해당 Discord role 보유자는 ACL 무시하고 전 경로 write
  (단 남의 `/home/*`은 **read까지만** — 개인 공간 존중, 이것도 activity_log에 남김)
- 구현: `resolvePermission()`에 admin 분기 한 줄 + 테스트. R3의 ACL 관리 UI가 이 role을 전제로 함

---

## R2 — 체감 효용 최대 (항목별 독립, 원하는 것만)

### R2-1. 파일 미리보기 `M` ★가장 추천
더블클릭=다운로드는 사무실에서 의외로 불편하다. "열어보고 맞는 파일인지 확인"이 700번 일어난다.
- **이미지**: 썸네일 인프라가 이미 있음 → 라이트박스 모달(원본은 `?inline=1` 다운로드 스트림)
- **PDF**: `content-disposition: inline` + 브라우저 내장 뷰어 (새 탭). PDF는 inline 안전
- **텍스트/코드/마크다운**: 1MB 이하만 fetch → `<pre>`/마크다운 렌더. **HTML·SVG는 절대
  inline 렌더 금지**(저장 XSS → 세션 쿠키 탈취). 텍스트로만 표시
- **동영상/오디오**: 다운로드 스트림이 이미 Range 지원 → `<video>` 태그로 즉시 재생 가능
- API 변경: `GET /api/fs/download?inline=1` — 화이트리스트(MIME별 inline 허용 목록) 기반으로만
  `content-disposition` 전환. UI: 더블클릭=미리보기(가능 시), 컨텍스트 메뉴 '다운로드'는 유지

### R2-2. 다중 선택 + 일괄 작업 + zip 다운로드 `M`
- 선택 모델: Ctrl/Shift+클릭, 체크박스(모바일). 선택 N개 → 툴바에 일괄 이동/복사/삭제/다운로드
- 서버는 이미 batch(paths[]) — **API 변경 불필요**, 순수 프론트 작업
- zip: `GET /api/fs/download-zip?paths=...` — `archiver`로 스트리밍(디스크 임시파일 없음).
  폴더 다운로드 요구는 반드시 나온다
- 이동/복사 드래그: 행을 트리/폴더 행 위로 드롭. HTML5 DnD로 가능하나 공수 대비 효용 낮음 → 후순위

### R2-3. 폴더째 업로드 `S`
현재 파일 다중 업로드만 됨. 디자이너의 "시안 폴더 통째로" 요구는 확실히 나온다.
- DnD의 `webkitGetAsEntry()`로 디렉터리 트리 순회 → 상대경로 수집
- 업로드 API에 `relPath` 필드 추가(폴더 자동 생성, mkdir 로직 재사용). 파일별 진행률 토스트는 그대로

### R2-4. Discord 알림 `S` ★조직 특성상 저비용 고효용
이미 봇이 서버에 들어와 있다(role 조회용). 웹훅 하나면 끝:
- 공유 폴더(`/home` 제외)에 업로드/삭제 발생 시 지정 채널에 "📁 @주광 님이 디자인팀에
  시안_v3.psd 업로드" — `recordActivity()`에 훅 한 줄
- 스팸 방지: 같은 유저·같은 폴더 5분 윈도 묶음(디바운스). `.env`: `DISCORD_WEBHOOK_URL=`, 끌 수 있게

### R2-5. SSE 실시간 갱신 `M`
둘이 같은 폴더를 보다가 한쪽이 업로드하면 다른 쪽은 수동 새로고침해야 한다.
- `GET /api/events` (SSE) — 쓰기 라우트+워처가 `{type:'changed', path}` 발행(사내 인원수면
  인메모리 EventEmitter로 충분, 브로커 불필요)
- 웹: EventSource 수신 → 해당 경로 TanStack Query invalidate. **기존 캐시 무효화 체계에
  정확히 얹히는 구조**라 위험이 낮다
- 참고: 폴링 재검증(refetchInterval 30초)이 공수 1/10로 80% 효과 — 팀이 작으면 이걸로 시작해도 됨

---

## R3 — 운영 관리

### R3-1. ACL 관리 UI `M~L`
지금은 `acl-seed.ts` 수정+재실행(개발자만 가능). 운영자가 바뀌거나 조직이 바뀌면 병목이 된다.
- admin(R1-4) 전용 `/admin/acl` 페이지: folder_acl 테이블 CRUD, 폴더는 FolderPicker 재사용,
  role 목록은 봇 API `GET /guilds/{id}/roles`로 이름 표시(ID 수기 입력 제거)
- 모든 변경은 activity_log에 `acl_change`로 기록 (감사 추적)
- 위험: 권한 시스템을 웹에서 만지게 되므로 **admin 검사를 서버 미들웨어에서 이중으로**

### R3-2. 스토리지 용량 대시보드 `S`
NAS는 반드시 가득 찬다. 차기 전에 보이게:
- fs_index에 size가 이미 있음 → `SELECT parent, SUM(size)` 롤업으로 폴더별 용량 즉시 산출
  (du 스캔 불필요, **공짜 데이터**)
- 사이드바 하단 게이지(디스크 여유: `statfs`) + admin 페이지에 폴더별 top 10
- `/api/health`에 디스크 여유 % 포함 → 90% 초과 시 R2-4 웹훅으로 경고

### R3-3. 감사 로그 뷰 `S`
activity_log는 쌓이는데 파일 단위 타임라인으로만 보인다. admin 전용 전체 스트림 뷰
(누가·언제·무엇을, 유저/기간/액션 필터). 테이블+쿼리는 다 있고 UI만 붙이면 됨.

---

## R4 — 수요 확인 후 (미리 만들지 말 것)

| 항목 | 공수 | 판단 기준 |
|---|---|---|
| **공유 링크** (토큰·만료·다운로드 전용) | M | 외부 협력사와 파일을 주고받기 시작하면. 인증 우회 경로가 생기는 것이므로 만료 기본 7일·다운로드 전용·activity 기록 필수 |
| **간이 버전 보관** | M | 같은 이름 업로드 시 덮어쓰기 대신 `.versions/`에 기존본 이동(최근 N개). "덮어썼는데 이전 게 필요해요"가 2번 나오면 도입. 전체 VCS는 과설계 |
| **문서 내용 검색** (PDF/오피스 텍스트 추출→FTS5) | L | ✅ 2026-07-20 구현. PDF(unpdf)·docx/xlsx/pptx/hwpx(zip+XML)·평문 → `content_fts`(FTS5 trigram). fs_index 훅 추종 + 백그라운드 추출 큐, 2글자 질의는 LIKE 폴백. 레거시 바이너리(doc/hwp/xls/ppt)는 계속 제외 |
| **다크 모드** | S | 명세 토큰이 CSS 변수라 `prefers-color-scheme` 오버라이드만으로 가능. 요청 나오면 반나절 |
| **즐겨찾기/핀** | S | 사이드바에 유저별 pinned_paths 테이블. 폴더 깊어지면 도입 |
| **키보드 단축키** (F2/Del/화살표) | S | 파워유저가 생기면 |

## 비권장 / 보류 (하지 말 것과 이유)

- **오피스 문서 동시 편집**(Collabora/OnlyOffice 통합): 별도 서버 운영 부담이 본체보다 커진다.
  사내 규모에선 "다운로드→수정→재업로드 + 버전 보관(R4)"이 현실적
- **WebDAV/SMB 게이트웨이**: NAS가 이미 SMB를 제공한다. 웹은 웹의 역할(권한·로그·공유)만
- **실시간 협업 표시**(누가 보고 있는지 커서/프레즌스): 효용 대비 복잡도 과다
- **PostgreSQL 전환**: 현 규모에서 SQLite 병목 징후가 없다. Drizzle 덕에 필요 시점에 전환해도 늦지 않음
- **모바일 네이티브 앱**: 반응형 웹(M4)으로 충분. PWA manifest 추가(S) 정도만 여지

---

## 스키마·API 추가분 요약 (구현 시 참조)

```
테이블: share_links(token PK, path, created_by, expires_at, download_count)   [R4 공유링크]
        pinned_paths(user_id, path, PK(user_id,path))                          [R4 즐겨찾기]
        (R1~R3는 신규 테이블 없음 — 기존 테이블+env로 해결)

API:    GET  /api/fs/download?inline=1        [R2-1]  MIME 화이트리스트 기반 inline
        GET  /api/fs/download-zip?paths=      [R2-2]  archiver 스트리밍
        POST /api/fs/upload (+relPath 필드)   [R2-3]
        GET  /api/events (SSE)                [R2-5]
        GET/POST/DELETE /api/admin/acl        [R3-1]  admin 전용
        GET  /api/admin/usage                 [R3-2]
        GET  /api/admin/activity              [R3-3]

env:    ADMIN_ROLE_ID [R1-4] · DISCORD_WEBHOOK_URL [R2-4]
```

## 원칙 재확인

확장 전반에 걸쳐 기본 명세의 콜아웃을 유지한다 — **"UI는 로컬 스토리지의 실제 상태와 DB
로그를 정직하게 비추는 창"**. 어떤 기능도 이 원칙을 깨는 캐시·가상 상태를 도입하지 않는다
(SSE도 무효화 신호일 뿐, 진실의 원천은 여전히 readdir). 그리고 보안 불변식 두 가지:
모든 권한 검사는 서버에서, HTML/SVG는 절대 inline으로 서빙하지 않는다.
