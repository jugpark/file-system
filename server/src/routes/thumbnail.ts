import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { isImageName } from '@fs/shared'
import { resolvePermission } from '../acl/resolve'
import { loadAclRules } from '../acl/store'
import { config } from '../config'
import { resolveAbs, toRelPath } from '../fs/safe-path'
import { errorBody } from '../types'

export default async function thumbnailRoutes(app: FastifyInstance) {
  /** 이미지 썸네일 — webp로 리사이즈해 디스크 캐시. 캐시 키에 mtime 포함(수정 시 자동 무효) */
  app.get('/api/fs/thumbnail', async (req, reply) => {
    const user = req.user!
    const q = req.query as { path?: string; w?: string }
    const rel = toRelPath(q.path)
    if (resolvePermission(user, rel, loadAclRules()) === 'none') {
      return reply.code(403).send(errorBody('FORBIDDEN', '접근 권한이 없습니다'))
    }
    if (!isImageName(rel)) {
      return reply.code(415).send(errorBody('NOT_AN_IMAGE', '이미지 파일이 아닙니다'))
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
        await sharp(abs, { failOn: 'truncated' })
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
