import fs from 'node:fs'
import path from 'node:path'
import {
  BASE, section, ok, eq, summary, makeIdentity, extraSession, openDb,
  req, GET, POST, PATCH, DEL, upload, anonUpload, sleep,
} from './lib.mjs'

async function searchUntil(id, q, want, tries = 20) {
  let last
  for (let i = 0; i < tries; i++) {
    last = (await GET(id, `/api/search?q=${encodeURIComponent(q)}`)).data
    if (want(last)) return last
    await sleep(300)
  }
  return last
}

function walkDisk(dir, base = '') {
  const out = []
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.')) continue
    const rel = base + '/' + d.name
    out.push({ rel, isDir: d.isDirectory() })
    if (d.isDirectory()) out.push(...walkDisk(path.join(dir, d.name), rel))
  }
  return out
}

/** 전체 시나리오 실행. DATA = 서버의 데이터 루트(app.db + storage/). 성공 시 true */
export async function runChecks(DATA) {
  const DB = path.join(DATA, 'app.db')
  const STORAGE = path.join(DATA, 'storage')

  const admin = makeIdentity(DB, { id: 'u_admin', username: 'admin', roles: ['admin'] })
  const editor = makeIdentity(DB, { id: 'u_editor', username: 'editor', roles: ['team'] })
  const guest = makeIdentity(DB, { id: 'u_guest', username: 'guest', roles: [] })

  section('신원·인증')
  eq((await GET(admin, '/api/me')).data?.isAdmin, true, 'admin isAdmin')
  eq((await GET(editor, '/api/me')).data?.isAdmin, false, 'editor 비관리자')
  eq((await GET(null, '/api/me')).status, 401, '무인증 401')
  eq((await GET({ cookie: 'sid=bogus.bad' }, '/api/me')).status, 401, '위조 쿠키 401')

  await POST(admin, '/api/admin/acl', { pathPrefix: '/team', roleId: 'team', permission: 'write' })
  await POST(admin, '/api/admin/acl', { pathPrefix: '/shared', roleId: 'team', permission: 'read' })
  eq((await POST(guest, '/api/admin/acl', { pathPrefix: '/x', roleId: 'y', permission: 'read' })).status, 403, 'admin API 비관리자 403')

  section('A. 핵심 FS — mkdir/upload/list/tree/rename/move/copy (editor)')
  eq((await POST(editor, '/api/fs/mkdir', { path: '/team', name: 'sub' })).status, 200, 'mkdir /team/sub')
  const up1 = await upload(editor.cookie, '/team/docs', '보고서.txt', '2026년 분기 예산 계획 초안')
  eq(up1.status, 200, 'upload 보고서.txt')
  eq(up1.data?.path, '/team/docs/보고서.txt', 'upload 반환 경로')
  const list = await GET(editor, '/api/fs/list?path=/team/docs')
  ok(list.data?.entries?.some((e) => e.name === '보고서.txt'), '목록에 업로드 파일')
  eq(list.data?.entries?.find((e) => e.name === '보고서.txt')?.uploader, 'editor', '업로더 표기')
  ok((await GET(editor, '/api/fs/tree?path=/team')).data?.nodes?.some((n) => n.name === 'docs'), '트리에 docs')
  eq((await PATCH(editor, '/api/fs/rename', { path: '/team/docs/보고서.txt', newName: '보고서_v2.txt' })).data?.path, '/team/docs/보고서_v2.txt', 'rename 경로')
  await POST(editor, '/api/fs/mkdir', { path: '/team', name: 'archive' })
  ok((await POST(editor, '/api/fs/move', { paths: ['/team/docs/보고서_v2.txt'], destDir: '/team/archive' })).data?.results?.[0]?.ok, 'move 성공')
  ok((await POST(editor, '/api/fs/copy', { paths: ['/team/archive/보고서_v2.txt'], destDir: '/team/docs' })).data?.results?.[0]?.ok, 'copy 성공')
  ok((await GET(editor, '/api/fs/list?path=/team/docs')).data.entries.some((e) => e.name === '보고서_v2.txt'), 'copy 결과 존재')

  section('B. 권한 정합성 — 모든 변경 라우트가 동일하게 강제 (guest=무권한)')
  eq((await GET(guest, '/api/fs/list?path=/team')).status, 403, 'guest list 403')
  eq((await upload(guest.cookie, '/team/docs', 'x.txt', 'hi')).status, 403, 'guest upload 403')
  eq((await POST(guest, '/api/fs/mkdir', { path: '/team', name: 'z' })).status, 403, 'guest mkdir 403')
  eq((await PATCH(guest, '/api/fs/rename', { path: '/team/docs/보고서_v2.txt', newName: 'q.txt' })).status, 403, 'guest rename 403')
  const gmove = await POST(guest, '/api/fs/move', { paths: ['/team/docs/보고서_v2.txt'], destDir: '/team' })
  ok(gmove.status === 403 || gmove.data?.results?.[0]?.ok === false, 'guest move 거부')
  const gt = await req(guest, 'DELETE', '/api/fs/trash', { body: { paths: ['/team/docs/보고서_v2.txt'] } })
  ok(gt.data?.results?.[0]?.ok === false, 'guest trash 배치 실패(권한)')
  eq((await POST(guest, '/api/share', { path: '/team/docs/보고서_v2.txt', expiresDays: 7 })).status, 403, 'guest share 403')
  eq((await GET(guest, '/api/fs/download?path=/team/docs/보고서_v2.txt')).status, 403, 'guest download 403')
  eq((await GET(guest, '/api/fs/thumbnail?path=/team/docs/보고서_v2.txt')).status, 403, 'guest thumbnail 403')

  section('B2. 읽기 전용(/shared, editor=read)')
  eq((await GET(editor, '/api/fs/list?path=/shared')).status, 200, 'editor /shared 읽기 200')
  eq((await upload(editor.cookie, '/shared', 'e.txt', 'x')).status, 403, 'editor /shared 업로드 403')
  eq((await POST(editor, '/api/fs/mkdir', { path: '/shared', name: 'd' })).status, 403, 'editor /shared mkdir 403')

  section('B3. 홈 격리 — 본인 write / 타인 불가 / admin read-only')
  eq((await upload(editor.cookie, '/home/u_editor', 'mine.txt', '개인메모')).status, 200, 'editor 본인 홈 업로드 200')
  eq((await GET(guest, '/api/fs/list?path=/home/u_editor')).status, 403, 'guest 타인 홈 403')
  eq((await GET(admin, '/api/fs/list?path=/home/u_editor')).status, 200, 'admin 타인 홈 읽기 200')
  eq((await upload(admin.cookie, '/home/u_editor', 'a.txt', 'x')).status, 403, 'admin 타인 홈 쓰기 403')

  section('C. 휴지통 — 삭제/복원/크기/영구삭제')
  const delRes = await req(editor, 'DELETE', '/api/fs/trash', { body: { paths: ['/team/docs/보고서_v2.txt'] } })
  ok(delRes.data?.results?.[0]?.ok, 'trash 성공')
  ok(!(await GET(editor, '/api/fs/list?path=/team/docs')).data.entries.some((e) => e.name === '보고서_v2.txt'), '삭제 후 사라짐')
  const trash = await GET(editor, '/api/trash')
  const titem = trash.data?.items?.find((i) => i.originalPath === '/team/docs/보고서_v2.txt')
  ok(titem?.size > 0, '휴지통 항목 크기>0')
  ok(typeof trash.data?.totalBytes === 'number', 'totalBytes 존재')
  ok((await POST(editor, '/api/fs/restore', { trashIds: [titem.id] })).data?.results?.[0]?.ok, '복원 성공')
  ok((await GET(editor, '/api/fs/list?path=/team/docs')).data.entries.some((e) => e.name === '보고서_v2.txt'), '복원 후 원위치')
  await upload(editor.cookie, '/team/sub', 'a.bin', 'x'.repeat(100))
  await upload(editor.cookie, '/team/sub', 'b.bin', 'y'.repeat(50))
  await req(editor, 'DELETE', '/api/fs/trash', { body: { paths: ['/team/sub'] } })
  const folderItem = (await GET(editor, '/api/trash')).data.items.find((i) => i.originalPath === '/team/sub')
  ok(folderItem?.isDir && folderItem.size >= 150, '폴더 휴지통 크기=하위 합계')
  eq((await POST(admin, '/api/admin/trash/purge', { ids: [folderItem.id] })).data?.purged, 1, 'admin 개별 영구삭제')
  ok(!(await GET(editor, '/api/trash')).data.items.some((i) => i.id === folderItem.id), '영구삭제 후 사라짐')

  section('D. 버전 보관')
  await upload(editor.cookie, '/team/docs', 'ver.txt', '버전1 내용')
  await upload(editor.cookie, '/team/docs', 'ver.txt', '버전2 내용 덮어씀')
  const vers = await GET(editor, '/api/fs/versions?path=/team/docs/ver.txt')
  ok(vers.data?.versions?.length >= 1, '이전 버전 보관')
  eq((await POST(editor, '/api/fs/versions/restore', { path: '/team/docs/ver.txt', id: vers.data.versions[0].id })).status, 200, '버전 복원 200')

  section('E. 공유 링크 + 파일 요청 링크')
  const share = await POST(editor, '/api/share', { path: '/team/docs/보고서_v2.txt', expiresDays: 7 })
  eq(share.data?.kind, 'download', 'download kind')
  eq((await fetch(share.data.url)).status, 200, '익명 다운로드 200')
  eq((await GET(editor, '/api/share')).data.links.find((l) => l.token === share.data.token)?.downloadCount, 1, '다운로드 카운트')
  const reqLink = await POST(editor, '/api/share', { path: '/team/drop', expiresDays: 7, kind: 'upload' })
  eq(reqLink.data?.kind, 'upload', 'upload kind')
  eq((await POST(editor, '/api/share', { path: '/team/drop', expiresDays: 7 })).status, 400, '폴더에 download kind 400')
  eq((await fetch(BASE + '/share/' + reqLink.data.token)).status, 404, 'upload 토큰 /share/ 거부')
  const page = await (await fetch(reqLink.data.url)).text()
  ok(page.includes('drop') && !page.includes(STORAGE), '업로드 페이지 폴더명 노출·내부경로 비노출')
  eq((await anonUpload(reqLink.data.url, '외부.txt', '외부 제출 v1')).data?.name, '외부.txt', '익명 업로드 1')
  eq((await anonUpload(reqLink.data.url, '외부.txt', '외부 제출 v2')).data?.name, '외부 (1).txt', '익명 업로드 2 충돌회피')
  eq((await GET(editor, '/api/fs/list?path=/team/drop')).data.entries.filter((e) => !e.isDir).length, 2, 'drop 2개 수신')
  await DEL(editor, '/api/share/' + share.data.token)
  eq((await fetch(share.data.url)).status, 404, '해지 후 404')

  section('F. 검색 — 파일명 + 내용(FTS) + 필터 + 권한')
  ok((await searchUntil(editor, '보고서', (d) => d.entries.length > 0)).entries.some((e) => e.name.includes('보고서')), '파일명 검색')
  const s2 = await searchUntil(editor, '예산', (d) => d.content.length > 0)
  ok(s2.contentEnabled && s2.content.length > 0, '내용 검색 히트')
  const sg = await GET(guest, '/api/search?q=예산')
  eq(sg.data.content.length, 0, 'guest 내용검색 권한필터')
  eq(sg.data.entries.length, 0, 'guest 파일명검색 권한필터')
  ok((await GET(editor, '/api/search?q=보고서&ext=txt')).data.entries.every((e) => e.name.endsWith('.txt')), 'ext 필터')
  eq((await GET(editor, '/api/search?q=보고서&ext=pdf')).data.entries.length, 0, 'ext=pdf 결과 0')
  ok((await GET(editor, '/api/search?q=보고서&from=/team/archive')).data.entries.every((e) => e.path.startsWith('/team/archive')), 'from 스코프 필터')

  section('G. 구독 + 접근 요청')
  eq((await POST(editor, '/api/subscriptions', { path: '/team' })).status, 204, '구독 등록')
  eq((await POST(editor, '/api/subscriptions', { path: '/team/docs/ver.txt' })).status, 400, '파일 구독 400')
  ok((await GET(editor, '/api/subscriptions')).data.subscriptions.some((s) => s.path === '/team'), '구독 목록')
  eq((await DEL(editor, '/api/subscriptions?path=/team')).status, 204, '구독 해제')
  eq((await POST(guest, '/api/access-requests', { path: '/team', permission: 'read', note: '확인' })).status, 201, '접근 요청 생성')
  eq((await POST(guest, '/api/access-requests', { path: '/team', permission: 'read' })).status, 409, '중복 요청 409')
  const areq = (await GET(admin, '/api/admin/access-requests')).data.requests.find((r) => r.path === '/team' && r.status === 'pending')
  eq(areq?.requesterName, 'guest', '요청자 표기')
  eq((await POST(admin, '/api/admin/access-requests/' + areq.id + '/resolve', { approve: true })).status, 200, '승인 처리')
  eq((await GET(admin, '/api/admin/access-requests')).data.requests.find((r) => r.id === areq.id)?.status, 'approved', '상태 approved')

  section('H. 세션 관리')
  extraSession(DB, 'u_editor', 'e2e/second-device')
  const sess = await GET(editor, '/api/sessions')
  ok(sess.data.sessions.length >= 2, '세션 2개 이상')
  eq(sess.data.sessions.filter((s) => s.current).length, 1, '현재 세션 1개')
  eq((await DEL(editor, '/api/sessions/' + encodeURIComponent(sess.data.sessions.find((s) => s.current).id))).status, 400, '현재 세션 삭제 400')
  ok((await POST(editor, '/api/sessions/revoke-others', {})).data.revoked >= 1, '다른 기기 로그아웃')
  eq((await GET(editor, '/api/sessions')).data.sessions.length, 1, '해지 후 1개')

  section('I. 관리 대시보드')
  ok((await GET(admin, '/api/admin/usage')).data.totalBytes > 0, 'usage')
  ok(Array.isArray((await GET(admin, '/api/admin/activity')).data.items), 'activity 로그')
  eq((await GET(admin, '/api/admin/content-index')).data.enabled, true, 'content-index 상태')
  eq((await GET(admin, '/api/admin/backup-status')).data.known, false, 'backup-status(파일없음)')
  eq((await GET(editor, '/api/admin/usage')).status, 403, '비관리자 대시보드 403')

  section('J. 경로 보안')
  for (const bad of ['/../etc', '/team/../../x', '/team/\\x']) {
    const r = await GET(editor, '/api/fs/list?path=' + encodeURIComponent(bad))
    ok(r.status === 400 || r.status === 404 || r.status === 403, `위험 경로 거부: ${bad} (${r.status})`)
  }
  eq((await GET(editor, '/api/fs/list?path=/.trash')).status, 404, '.trash 접근 차단')

  section('K. 정합성 불변식 (DB ↔ 디스크 ↔ 로그)')
  await sleep(1000)
  const db = openDb(DB)
  const idxRows = db.prepare('SELECT path, is_dir FROM fs_index').all()
  const idxSet = new Set(idxRows.map((r) => r.path))
  const disk = walkDisk(STORAGE)
  const missingInIdx = disk.filter((d) => !idxSet.has(d.rel))
  eq(missingInIdx.length, 0, `디스크→인덱스 누락 0 (${missingInIdx.slice(0, 3).map((m) => m.rel).join(',')})`)
  const diskSet = new Set(disk.map((d) => d.rel))
  const orphanIdx = idxRows.filter((r) => !diskSet.has(r.path))
  eq(orphanIdx.length, 0, `인덱스 고아 0 (${orphanIdx.slice(0, 3).map((m) => m.path).join(',')})`)
  const cOrphan = db.prepare('SELECT path FROM content_index').all().filter((r) => !idxSet.has(r.path))
  eq(cOrphan.length, 0, `content_index 고아 0 (${cOrphan.slice(0, 3).map((m) => m.path).join(',')})`)
  const trashRows = db.prepare('SELECT id FROM trash').all()
  const trashDir = path.join(STORAGE, '.trash')
  const trashFiles = fs.existsSync(trashDir) ? new Set(fs.readdirSync(trashDir)) : new Set()
  eq(trashRows.filter((r) => !trashFiles.has(r.id)).length, 0, '휴지통 원장↔실체 일치')
  const tmpDir = path.join(STORAGE, '.tmp')
  eq(fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir).length : 0, 0, '.tmp 잔여물 0')
  const actions = new Set(db.prepare('SELECT DISTINCT action FROM activity_log').all().map((r) => r.action))
  for (const a of ['upload', 'mkdir', 'rename', 'move', 'copy', 'trash', 'restore', 'download', 'trash_purge', 'share_create', 'share_revoke', 'version_restore', 'acl_change']) {
    ok(actions.has(a), `activity_log에 '${a}' 기록`)
  }
  ok(db.prepare("SELECT COUNT(*) c FROM activity_log WHERE actor_id='share-link' AND action='upload'").get().c >= 2, '익명 업로드 감사 기록')
  db.close()

  return summary()
}
