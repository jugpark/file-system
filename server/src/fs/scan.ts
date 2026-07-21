import net from 'node:net'
import { createReadStream } from 'node:fs'
import { config } from '../config'

/**
 * 바이러스 스캔 — clamd(ClamAV 데몬)에 INSTREAM 프로토콜로 파일을 흘려보낸다.
 * 무의존: clamd TCP 프로토콜이 단순해 별도 라이브러리 없이 net 소켓으로 구현.
 *
 * INSTREAM: `zINSTREAM\0` 전송 후 [4바이트 BE 길이][청크]... 를 보내고
 * [길이 0] 로 끝내면 clamd가 `stream: OK` 또는 `stream: <바이러스명> FOUND` 응답.
 *
 * CLAMAV_HOST 미설정이면 전 기능 비활성(scanEnabled=false) — dev·미설치 환경에서 무해.
 */

export function scanEnabled(): boolean {
  return !!config.clamavHost
}

export interface ScanResult {
  clean: boolean
  /** clean=false일 때 탐지된 시그니처명 */
  virus?: string
}

/** clamd 연결 실패·프로토콜 오류 시 던진다 (호출부가 fail-open/closed 결정) */
export class ScanUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanUnavailableError'
  }
}

/** 파일 하나를 스캔. clamd 미도달이면 ScanUnavailableError */
export function scanFile(absPath: string): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.clamavHost, port: config.clamavPort })
    let response = ''
    let settled = false

    const fail = (msg: string) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new ScanUnavailableError(msg))
    }

    socket.setTimeout(config.clamavTimeoutMs)
    socket.on('timeout', () => fail('clamd 응답 시간 초과'))
    socket.on('error', (err) => fail(`clamd 연결 실패: ${err.message}`))

    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      const stream = createReadStream(absPath, { highWaterMark: 64 * 1024 })
      stream.on('data', (chunk: string | Buffer) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const len = Buffer.alloc(4)
        len.writeUInt32BE(buf.length, 0)
        socket.write(len)
        socket.write(buf)
      })
      stream.on('end', () => {
        // 길이 0 청크 = 스트림 종료. write쪽만 half-close하고 읽기쪽은 응답 수신용으로 유지
        socket.end(Buffer.alloc(4))
      })
      stream.on('error', (err) => fail(`파일 읽기 실패: ${err.message}`))
    })

    socket.on('data', (data: Buffer) => {
      response += data.toString('utf8')
    })

    socket.on('close', () => {
      if (settled) return
      settled = true
      // z 명령 응답은 NUL로 끝난다 — trim 전에 제거
      const line = response.replace(/\0/g, '').trim()
      if (/\bOK$/.test(line)) return resolve({ clean: true })
      const found = line.match(/:\s*(.+)\s+FOUND$/)
      if (found) return resolve({ clean: false, virus: found[1] })
      // 예상 밖 응답(오류 문자열 등)은 스캔 실패로 간주 — 호출부가 정책 결정
      reject(new ScanUnavailableError(`clamd 응답 해석 불가: ${line || '(빈 응답)'}`))
    })
  })
}

/**
 * 업로드 게이트 — 스테이징 파일을 스캔하고 통과 여부를 돌려준다.
 * @param anonymous 무인증 경로(파일 요청 링크)면 clamd 미도달 시 fail-closed
 * @returns clean=false면 감염, 그리고 사유(virus 또는 unavailable 메시지)
 */
export async function gateUpload(
  absPath: string,
  anonymous: boolean,
  log?: { warn: (o: unknown, m?: string) => void },
): Promise<{ ok: boolean; reason?: string }> {
  if (!scanEnabled()) return { ok: true }
  try {
    const res = await scanFile(absPath)
    if (res.clean) return { ok: true }
    return { ok: false, reason: `감염된 파일입니다 (${res.virus})` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 무인증 업로드는 스캐너가 죽으면 막는다(fail-closed). 인증 업로드는 통과시키되 경고 로그.
    const failClosed = anonymous ? config.scanFailClosed : false
    log?.warn({ err }, `바이러스 스캔 불가 — ${failClosed ? '차단(fail-closed)' : '통과(fail-open)'}`)
    return failClosed
      ? { ok: false, reason: '보안 검사를 완료할 수 없어 업로드를 거부했습니다' }
      : { ok: true }
  }
}
