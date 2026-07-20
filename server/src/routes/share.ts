import crypto from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import { desc, eq, sql } from 'drizzle-orm'
import type { CreateShareBody, ShareKind, ShareLinkDto, ShareListResponse } from '@fs/shared'
import { resolvePermission } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { config } from '../config'
import { db } from '../db'
import { shareLinks } from '../db/schema'
import { emitChanged } from '../events'
import { indexUpsert } from '../fs/indexer'
import { recordActivity } from '../fs/meta'
import { resolveCollision, validateEntryName } from '../fs/names'
import { PathError, resolveAbs, toRelPath } from '../fs/safe-path'
import { notifyFileActivity } from '../notify'
import { errorBody } from '../types'

/**
 * R4 공유 링크 — 인증 없이 토큰만으로 접근하는 외부 통로. 두 종류:
 *   download: 파일 받아가기 (파일 전용)
 *   upload:   파일 요청 — 외부인이 지정 폴더로 파일을 보냄 (폴더 전용)
 * 인증 우회 통로이므로: write 권한자만 생성 · 만료 필수 · 전부 activity 기록.
 */

function toDto(row: typeof shareLinks.$inferSelect): ShareLinkDto {
  return {
    token: row.token,
    kind: row.kind,
    path: row.path,
    name: path.basename(row.path) || '/',
    url:
      row.kind === 'upload'
        ? `${config.baseUrl}/share-upload/${row.token}`
        : `${config.baseUrl}/share/${row.token}`,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    downloadCount: row.downloadCount,
    expired: row.expiresAt < Date.now(),
  }
}

export default async function shareRoutes(app: FastifyInstance) {
  app.post('/api/share', async (req, reply) => {
    const user = req.user!
    const body = req.body as CreateShareBody
    const kind: ShareKind = body?.kind === 'upload' ? 'upload' : 'download'
    const rel = toRelPath(body?.path)
    if (resolvePermission(user, rel, loadAclRules()) !== 'write') {
      return reply.code(403).send(errorBody('FORBIDDEN', '공유 링크는 수정 권한자만 만들 수 있습니다'))
    }
    const abs = resolveAbs(config.storageRoot, rel)
    const stat = await fsp.stat(abs).catch(() => null)
    if (kind === 'download' && !stat?.isFile()) {
      return reply.code(400).send(errorBody('FILE_ONLY', '파일만 공유할 수 있습니다'))
    }
    if (kind === 'upload' && !stat?.isDirectory()) {
      return reply.code(400).send(errorBody('DIR_ONLY', '파일 요청 링크는 폴더에만 만들 수 있습니다'))
    }
    const days = [1, 7, 30].includes(Number(body?.expiresDays)) ? Number(body.expiresDays) : 7
    const token = crypto.randomBytes(16).toString('base64url')
    const now = Date.now()
    db.insert(shareLinks)
      .values({
        token,
        kind,
        path: rel,
        createdBy: user.id,
        createdAt: now,
        expiresAt: now + days * 24 * 60 * 60 * 1000,
      })
      .run()
    recordActivity('share_create', rel, user.id, { token, expiresDays: days, kind })
    const row = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get()!
    return toDto(row)
  })

  /** 내 공유 링크 목록 (admin은 전체) */
  app.get('/api/share', async (req) => {
    const user = req.user!
    const rows = user.isAdmin
      ? db.select().from(shareLinks).orderBy(desc(shareLinks.createdAt)).all()
      : db
          .select()
          .from(shareLinks)
          .where(eq(shareLinks.createdBy, user.id))
          .orderBy(desc(shareLinks.createdAt))
          .all()
    const res: ShareListResponse = { links: rows.map(toDto) }
    return res
  })

  app.delete('/api/share/:token', async (req, reply) => {
    const user = req.user!
    const { token } = req.params as { token: string }
    const row = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get()
    if (!row) return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 링크입니다'))
    if (row.createdBy !== user.id && !user.isAdmin) {
      return reply.code(403).send(errorBody('FORBIDDEN', '본인이 만든 링크만 해지할 수 있습니다'))
    }
    db.delete(shareLinks).where(eq(shareLinks.token, token)).run()
    recordActivity('share_revoke', row.path, user.id, { token })
    return reply.code(204).send()
  })

  /**
   * 공개 다운로드 — 인증 가드 밖(/api/* 가 아님). 공개 엔드포인트라 rate limit 강화.
   * 실패 응답은 존재 여부를 구분하지 않는 단일 메시지(토큰 스캔 대응).
   */
  app.get(
    '/share/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params as { token: string }
      const gone = () =>
        reply
          .code(404)
          .type('text/plain; charset=utf-8')
          .send('링크가 만료됐거나 존재하지 않습니다.')
      if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return gone()
      const row = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get()
      if (!row || row.kind !== 'download' || row.expiresAt < Date.now()) return gone()
      const abs = resolveAbs(config.storageRoot, row.path)
      const stat = await fsp.stat(abs).catch(() => null)
      if (!stat?.isFile()) return gone()

      db.update(shareLinks)
        .set({ downloadCount: sql`${shareLinks.downloadCount} + 1` })
        .where(eq(shareLinks.token, token))
        .run()
      // 감사 로그 — 무인증 경로라 행위자는 'share-link', 어느 링크였는지는 detail에
      recordActivity('download', row.path, 'share-link', { token, sharedBy: row.createdBy })
      const name = path.basename(row.path)
      reply.header(
        'content-disposition',
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`,
      )
      return reply.sendFile(row.path.slice(1), config.storageRoot)
    },
  )

  // ─── 파일 요청 (upload kind) — 무인증 업로드 페이지 + 수신 ───

  const uploadToken = (token: string) => {
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null
    const row = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get()
    if (!row || row.kind !== 'upload' || row.expiresAt < Date.now()) return null
    return row
  }

  const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

  /** 업로드 페이지 — 내부 경로는 노출하지 않고 폴더 이름만 보여준다 */
  app.get(
    '/share-upload/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params as { token: string }
      const row = uploadToken(token)
      if (!row) {
        return reply
          .code(404)
          .type('text/plain; charset=utf-8')
          .send('링크가 만료됐거나 존재하지 않습니다.')
      }
      const folderName = escapeHtml(path.basename(row.path) || '전체')
      const expires = new Date(row.expiresAt).toLocaleDateString('ko-KR')
      // CSP(script-src 'self') 때문에 스크립트는 인라인이 아니라 /share-upload.js 로 서빙
      return reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>파일 보내기 — ${folderName}</title>
<style>
  body{margin:0;font-family:'Pretendard',-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#F1F2F5;color:#14161D;display:grid;place-items:center;min-height:100vh}
  .card{background:#fff;border-radius:16px;padding:32px;max-width:440px;width:calc(100% - 48px);box-shadow:0 8px 30px rgba(20,22,29,.08)}
  h1{font-size:1.1rem;margin:0 0 6px}
  p{color:#565C6B;font-size:.85rem;margin:0 0 18px;line-height:1.6}
  .drop{border:2px dashed #E3E5EB;border-radius:10px;padding:34px 16px;text-align:center;color:#7C8290;font-size:.85rem;cursor:pointer;transition:.15s}
  .drop.over,.drop:hover{border-color:#5865F2;background:#EDEFFE;color:#3A45C4}
  input[type=file]{display:none}
  ul{list-style:none;margin:14px 0 0;padding:0;font-size:.82rem}
  li{display:flex;justify-content:space-between;gap:10px;padding:7px 2px;border-bottom:1px solid #ECEDF1}
  li b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ok{color:#12946C}.err{color:#C6413B}.busy{color:#7C8290}
  .foot{margin-top:16px;font-size:.72rem;color:#7C8290}
</style></head><body>
<div class="card">
  <h1>📁 "${folderName}" 폴더로 파일 보내기</h1>
  <p>여기로 올린 파일은 담당자에게 바로 전달됩니다. 링크 만료: <b>${expires}</b></p>
  <label class="drop" id="drop">클릭하거나 파일을 끌어다 놓으세요<input type="file" id="file" multiple></label>
  <ul id="list"></ul>
  <div class="foot">파일당 최대 ${config.maxUploadMb.toLocaleString()}MB · 같은 이름은 자동으로 " (1)" 이 붙습니다</div>
</div>
<script src="/share-upload.js"></script>
</body></html>`)
    },
  )

  /** 업로드 페이지 스크립트 — CSP 'self' 준수용 별도 경로 */
  app.get('/share-upload.js', async (_req, reply) => {
    return reply.type('application/javascript; charset=utf-8').send(`(() => {
  const token = location.pathname.split('/').pop()
  const drop = document.getElementById('drop')
  const input = document.getElementById('file')
  const list = document.getElementById('list')

  function row(name) {
    const li = document.createElement('li')
    const b = document.createElement('b'); b.textContent = name
    const s = document.createElement('span'); s.className = 'busy'; s.textContent = '올리는 중…'
    li.append(b, s); list.append(li)
    return s
  }
  async function send(files) {
    for (const f of files) {
      const st = row(f.name)
      try {
        const fd = new FormData(); fd.append('file', f)
        const res = await fetch('/share-upload/' + token, { method: 'POST', body: fd })
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || 'HTTP ' + res.status)
        st.className = 'ok'; st.textContent = '완료'
      } catch (e) { st.className = 'err'; st.textContent = e.message || '실패' }
    }
  }
  input.addEventListener('change', () => { send([...input.files]); input.value = '' })
  ;['dragover', 'dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault()
    drop.classList.toggle('over', ev === 'dragover')
    if (ev === 'drop') send([...e.dataTransfer.files])
  }))
})()`)
  })

  /** 파일 수신 — 절대 덮어쓰지 않음(항상 ' (n)' 회피), 전부 감사 기록 */
  app.post(
    '/share-upload/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params as { token: string }
      const row = uploadToken(token)
      if (!row) {
        return reply.code(404).send(errorBody('GONE', '링크가 만료됐거나 존재하지 않습니다'))
      }
      const dirAbs = resolveAbs(config.storageRoot, row.path)
      const dirStat = await fsp.stat(dirAbs).catch(() => null)
      if (!dirStat?.isDirectory()) {
        return reply.code(410).send(errorBody('GONE', '대상 폴더가 사라졌습니다'))
      }
      const data = await req.file()
      if (!data) return reply.code(400).send(errorBody('NO_FILE', '업로드할 파일이 없습니다'))
      const name = validateEntryName(data.filename)

      const tmpPath = path.join(config.tmpDir, crypto.randomUUID())
      try {
        await pipeline(data.file, createWriteStream(tmpPath))
        if (data.file.truncated) {
          throw new PathError(`파일이 최대 크기(${config.maxUploadMb}MB)를 초과했습니다`, 413)
        }
        const size = (await fsp.stat(tmpPath)).size
        const finalName = await resolveCollision(dirAbs, name)
        const destRel = row.path === '/' ? `/${finalName}` : `${row.path}/${finalName}`
        await fsp.rename(tmpPath, path.join(dirAbs, finalName))
        db.update(shareLinks)
          .set({ downloadCount: sql`${shareLinks.downloadCount} + 1` })
          .where(eq(shareLinks.token, token))
          .run()
        recordActivity('upload', destRel, 'share-link', { size, token, sharedBy: row.createdBy })
        indexUpsert(destRel, { isDir: false, size, mtimeMs: Date.now() })
        emitChanged(row.path)
        notifyFileActivity('upload', '외부(파일요청)', destRel)
        return { ok: true, name: finalName }
      } catch (err) {
        await fsp.unlink(tmpPath).catch(() => {})
        throw err
      }
    },
  )
}
