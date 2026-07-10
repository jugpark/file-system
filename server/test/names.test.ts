import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveCollision, validateEntryName } from '../src/fs/names'
import { PathError } from '../src/fs/safe-path'

describe('validateEntryName', () => {
  it('정상 이름은 NFC로 정규화해 반환', () => {
    expect(validateEntryName('기획서.pdf')).toBe('기획서.pdf')
    const nfd = '시안'.normalize('NFD')
    expect(validateEntryName(nfd)).toBe('시안'.normalize('NFC'))
    expect(validateEntryName('  공백트림  ')).toBe('공백트림')
  })

  it('빈 이름·과長·예약어 거부', () => {
    expect(() => validateEntryName('')).toThrow(PathError)
    expect(() => validateEntryName('   ')).toThrow(PathError)
    expect(() => validateEntryName('a'.repeat(201))).toThrow(PathError)
    expect(() => validateEntryName('.')).toThrow(PathError)
    expect(() => validateEntryName('..')).toThrow(PathError)
  })

  it("'.' 시작(숨김/예약)과 금지 문자 거부", () => {
    expect(() => validateEntryName('.hidden')).toThrow(PathError)
    expect(() => validateEntryName('.trash')).toThrow(PathError)
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(() => validateEntryName(bad), bad).toThrow(PathError)
    }
    expect(() => validateEntryName('a' + String.fromCharCode(0) + 'b')).toThrow(PathError)
  })
})

describe('resolveCollision', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-names-'))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('충돌 없으면 그대로', async () => {
    expect(await resolveCollision(dir, 'a.txt')).toBe('a.txt')
  })

  it('충돌 시 " (n)" 접미사, 확장자 보존', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), '')
    expect(await resolveCollision(dir, 'a.txt')).toBe('a (1).txt')
    fs.writeFileSync(path.join(dir, 'a (1).txt'), '')
    expect(await resolveCollision(dir, 'a.txt')).toBe('a (2).txt')
  })

  it('확장자 없는 이름(폴더)도 동작', async () => {
    fs.mkdirSync(path.join(dir, '새 폴더'))
    expect(await resolveCollision(dir, '새 폴더')).toBe('새 폴더 (1)')
  })
})
