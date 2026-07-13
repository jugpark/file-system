import { createReadStream, type Stats } from 'node:fs'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { extOfName, previewKind } from '@fs/shared'

/**
 * inline 미리보기 스트리밍 — MIME 화이트리스트 기반.
 * ⚠ 보안 불변식: 화이트리스트에 없는 것(특히 html/svg)은 절대 inline으로 서빙하지 않는다.
 *   previewKind()가 null이면 호출부가 attachment로 처리한다.
 */
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
}

export function inlineMimeFor(name: string): string | null {
  const kind = previewKind(name)
  if (!kind) return null
  if (kind === 'text') return 'text/plain; charset=utf-8' // md/코드도 전부 plain — html 렌더 금지
  return MIME[extOfName(name)] ?? null
}

/** Range 지원 inline 스트리밍 (동영상 시킹용) */
export function streamInline(
  req: FastifyRequest,
  reply: FastifyReply,
  abs: string,
  stat: Stats,
  mime: string,
  name: string,
) {
  reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`)
  reply.header('x-content-type-options', 'nosniff')
  reply.header('accept-ranges', 'bytes')
  reply.type(mime)

  const range = req.headers.range
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
  if (m && (m[1] || m[2])) {
    const size = stat.size
    let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2]!, 10)
    let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1
    start = Math.max(0, start)
    end = Math.min(end, size - 1)
    if (start > end || start >= size) {
      return reply.code(416).header('content-range', `bytes */${size}`).send()
    }
    reply.code(206)
    reply.header('content-range', `bytes ${start}-${end}/${size}`)
    reply.header('content-length', end - start + 1)
    return reply.send(createReadStream(abs, { start, end }))
  }

  reply.header('content-length', stat.size)
  return reply.send(createReadStream(abs))
}
