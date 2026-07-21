import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { extOfName, isImageName } from '@fs/shared'
import { resolvePermission } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { config } from '../config'
import { resolveAbs, toRelPath } from '../fs/safe-path'
import { errorBody } from '../types'

/**
 * PDF 첫 페이지를 PNG로 렌더 (unpdf + @napi-rs/canvas).
 * canvas는 네이티브 모듈이라 없을 수 있어 lazy import — 실패 시 null 반환(호출부가 415로 폴백).
 */
async function renderPdfFirstPage(abs: string): Promise<Buffer | null> {
  try {
    const fsp = await import('node:fs/promises')
    const { renderPageAsImage } = await import('unpdf')
    const data = new Uint8Array(await fsp.readFile(abs))
    const png = await renderPageAsImage(data, 1, {
      scale: 2,
      canvasImport: () => import('@napi-rs/canvas' as string),
    })
    return Buffer.from(png)
  } catch {
    return null
  }
}

export default async function thumbnailRoutes(app: FastifyInstance) {
  /** 이미지 썸네일 — webp로 리사이즈해 디스크 캐시. 캐시 키에 mtime 포함(수정 시 자동 무효) */
  app.get('/api/fs/thumbnail', async (req, reply) => {
    const user = req.user!
    const q = req.query as { path?: string; w?: string }
    const rel = toRelPath(q.path)
    if (resolvePermission(user, rel, loadAclRules()) === 'none') {
      return reply.code(403).send(errorBody('FORBIDDEN', '접근 권한이 없습니다'))
    }
    const isPdf = extOfName(rel) === 'pdf'
    if (!isImageName(rel) && !isPdf) {
      return reply.code(415).send(errorBody('UNSUPPORTED', '썸네일 대상이 아닙니다'))
    }
    const abs = resolveAbs(config.storageRoot, rel)
    const stat = await fsp.stat(abs).catch(() => null)
    if (!stat?.isFile()) {
      return reply.code(404).send(errorBody('NOT_FOUND', '존재하지 않는 파일입니다'))
    }

    const width = Math.min(Math.max(Number(q.w) || 240, 32), 1024)
    const key = crypto
      .createHash('sha1')
      .update(`${rel}|${Math.round(stat.mtimeMs)}|${width}`)
      .digest('hex')
    const cachePath = path.join(config.thumbsDir, `${key}.webp`)

    if (!(await fsp.stat(cachePath).catch(() => null))) {
      const tmpPath = path.join(config.thumbsDir, `.${key}.${crypto.randomUUID()}.tmp`)
      try {
        // PDF는 첫 페이지를 PNG로 렌더한 뒤 sharp에 태워 일반 이미지와 같은 경로로 처리
        const source = isPdf ? await renderPdfFirstPage(abs) : abs
        if (source == null) {
          return reply.code(415).send(errorBody('THUMBNAIL_FAILED', 'PDF 썸네일을 만들 수 없습니다'))
        }
        await sharp(source, { failOn: 'truncated' })
          .rotate() // EXIF 방향 반영
          .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toFile(tmpPath)
        await fsp.rename(tmpPath, cachePath) // 동시 생성 경합은 마지막 승자로 수렴
      } catch (err) {
        await fsp.unlink(tmpPath).catch(() => {})
        req.log.warn({ err, rel }, 'thumbnail 생성 실패')
        return reply.code(415).send(errorBody('THUMBNAIL_FAILED', '썸네일을 만들 수 없는 파일입니다'))
      }
    }

    reply.header('cache-control', 'private, max-age=604800')
    reply.type('image/webp')
    return reply.send(createReadStream(cachePath))
  })
}
