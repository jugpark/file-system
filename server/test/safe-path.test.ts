import { describe, expect, it } from 'vitest'
import { PathError, resolveAbs, toRelPath } from '../src/fs/safe-path'

describe('toRelPath', () => {
  it('정상 경로를 정규화한다', () => {
    expect(toRelPath('/a/b')).toBe('/a/b')
    expect(toRelPath('a/b/')).toBe('/a/b')
    expect(toRelPath('//a///b')).toBe('/a/b')
  })

  it('빈 입력은 루트', () => {
    expect(toRelPath(undefined)).toBe('/')
    expect(toRelPath('')).toBe('/')
    expect(toRelPath('/')).toBe('/')
  })

  it('한글 경로를 그대로 보존한다 (NFC 강제 변환 없음 — NFD 파일 접근 보장)', () => {
    const nfd = '/design/시안'.normalize('NFD')
    expect(toRelPath(nfd)).toBe(nfd)
  })

  it('경로 탈출 시도를 거부한다', () => {
    expect(() => toRelPath('..')).toThrow(PathError)
    expect(() => toRelPath('/a/../b')).toThrow(PathError)
    expect(() => toRelPath('/a/..')).toThrow(PathError)
    expect(() => toRelPath('../../etc/passwd')).toThrow(PathError)
    expect(() => toRelPath('/a/./b')).toThrow(PathError)
  })

  it('백슬래시와 제어 문자를 거부한다', () => {
    expect(() => toRelPath('a\\b')).toThrow(PathError)
    expect(() => toRelPath('/a/b' + String.fromCharCode(0))).toThrow(PathError)
    expect(() => toRelPath('/a' + String.fromCharCode(10) + 'b')).toThrow(PathError)
  })

  it('숨김/예약 이름(.trash, .tmp, dotfile)을 404로 거부한다', () => {
    for (const p of ['/.trash', '/.tmp/x', '/a/.hidden']) {
      try {
        toRelPath(p)
        expect.unreachable(`${p} 는 거부돼야 한다`)
      } catch (e) {
        expect(e).toBeInstanceOf(PathError)
        expect((e as PathError).statusCode).toBe(404)
      }
    }
  })
})

describe('resolveAbs', () => {
  const root = '/data/storage'

  it('루트 안의 절대 경로를 만든다', () => {
    expect(resolveAbs(root, '/a/b')).toBe('/data/storage/a/b')
    expect(resolveAbs(root, '/')).toBe('/data/storage')
  })

  it('toRelPath를 우회해 들어온 탈출 경로도 이중으로 차단한다', () => {
    expect(() => resolveAbs(root, '/../x')).toThrow(PathError)
    expect(() => resolveAbs(root, '/..')).toThrow(PathError)
  })

  it('루트와 이름이 비슷한 형제 디렉터리로는 못 나간다', () => {
    // '/data/storage2' 는 '/data/storage'의 prefix 문자열이지만 밖이다
    expect(() => resolveAbs(root, '/../storage2/x')).toThrow(PathError)
  })

  it('구분자로 끝나는 루트(드라이브 루트 등)도 동작한다', () => {
    // Windows C:\ 의 리눅스 유사 케이스 — root가 이미 sep으로 끝남
    expect(resolveAbs('/', '/a/b')).toBe('/a/b')
    expect(resolveAbs('/', '/')).toBe('/')
    expect(() => resolveAbs('/data/', '/../x')).toThrow(PathError)
    expect(resolveAbs('/data/', '/a')).toBe('/data/a')
  })
})
