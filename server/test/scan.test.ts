import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { config } from '../src/config'
import { gateUpload, scanEnabled, scanFile, ScanUnavailableError } from '../src/fs/scan'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-scan-'))
const sample = path.join(dir, 'sample.bin')
fs.writeFileSync(sample, Buffer.from('hello scan'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

/** 지정한 응답 문자열을 돌려주는 가짜 clamd. INSTREAM 청크는 소비만 한다 */
function fakeClamd(reply: string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let replied = false
      const respond = () => {
        if (replied) return
        replied = true
        socket.end(reply)
      }
      socket.on('data', () => {}) // zINSTREAM + 청크 소비
      socket.on('end', respond)
      socket.on('error', () => {}) // 클라이언트가 먼저 끊는 경우 무시
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() })
    })
  })
}

function withClamd<T>(host: string, port: number, fn: () => Promise<T>): Promise<T> {
  const h = config.clamavHost
  const p = config.clamavPort
  config.clamavHost = host
  config.clamavPort = port
  return fn().finally(() => {
    config.clamavHost = h
    config.clamavPort = p
  })
}

describe('scanEnabled', () => {
  it('CLAMAV_HOST 없으면 비활성', () => {
    expect(scanEnabled()).toBe(false) // 테스트 env엔 미설정
  })
})

describe('scanFile', () => {
  it('OK 응답 → clean', async () => {
    const clamd = await fakeClamd('stream: OK\0')
    try {
      const res = await withClamd('127.0.0.1', clamd.port, () => scanFile(sample))
      expect(res).toEqual({ clean: true })
    } finally {
      clamd.close()
    }
  })

  it('FOUND 응답 → 시그니처명과 함께 clean=false', async () => {
    const clamd = await fakeClamd('stream: Eicar-Test-Signature FOUND\0')
    try {
      const res = await withClamd('127.0.0.1', clamd.port, () => scanFile(sample))
      expect(res.clean).toBe(false)
      expect(res.virus).toBe('Eicar-Test-Signature')
    } finally {
      clamd.close()
    }
  })

  it('연결 불가 → ScanUnavailableError', async () => {
    // 아무도 안 듣는 포트
    await expect(withClamd('127.0.0.1', 1, () => scanFile(sample))).rejects.toBeInstanceOf(
      ScanUnavailableError,
    )
  })
})

describe('gateUpload', () => {
  it('스캔 비활성이면 무조건 통과', async () => {
    expect(await gateUpload(sample, true)).toEqual({ ok: true })
  })

  it('감염이면 익명/인증 무관 차단', async () => {
    const clamd = await fakeClamd('stream: X FOUND\0')
    try {
      const res = await withClamd('127.0.0.1', clamd.port, () => gateUpload(sample, false))
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('감염')
    } finally {
      clamd.close()
    }
  })

  it('스캐너 장애: 익명=차단(fail-closed), 인증=통과(fail-open)', async () => {
    await withClamd('127.0.0.1', 1, async () => {
      expect((await gateUpload(sample, true)).ok).toBe(false) // 익명
      expect((await gateUpload(sample, false)).ok).toBe(true) // 인증
    })
  })
})
