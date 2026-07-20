import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { extractableKind, extractFileText, MAX_TEXT_CHARS } from '../src/fs/extract'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-extract-'))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function write(name: string, data: Buffer | Uint8Array | string): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, data)
  return p
}

/** 텍스트 하나가 든 최소 유효 PDF — xref 오프셋까지 정확히 생성 */
function minimalPdf(text: string): Buffer {
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  const add = (n: number, body: string) => {
    offsets[n] = out.length
    out += `${n} 0 obj\n${body}\nendobj\n`
  }
  add(1, '<</Type/Catalog/Pages 2 0 R>>')
  add(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>')
  add(3, '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>')
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  offsets[4] = out.length
  out += `4 0 obj\n<</Length ${stream.length}>>\nstream\n${stream}\nendstream\nendobj\n`
  add(5, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>')
  const xrefPos = out.length
  out += 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  out += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`
  return Buffer.from(out, 'latin1')
}

describe('extractableKind', () => {
  it('지원 확장자 매핑', () => {
    expect(extractableKind('/a/보고서.PDF')).toBe('pdf')
    expect(extractableKind('/a/회의록.docx')).toBe('docx')
    expect(extractableKind('/a/문서.hwpx')).toBe('hwpx')
    expect(extractableKind('/a/readme.md')).toBe('text')
    expect(extractableKind('/a/사진.jpg')).toBeNull()
    expect(extractableKind('/a/한글.hwp')).toBeNull() // 레거시 바이너리는 미지원
  })
})

describe('extractFileText', () => {
  it('평문 — 그대로, NUL 섞인 바이너리는 빈 문자열', async () => {
    const p = write('메모.txt', '2026년 상반기 예산 계획\n둘째 줄')
    expect(await extractFileText(p, 'text')).toContain('예산 계획')
    const b = write('가짜.txt', Buffer.from([0x41, 0x00, 0x42, 0x00]))
    expect(await extractFileText(b, 'text')).toBe('')
  })

  it('docx — 쪼개진 run이 한 단어로 이어지고 문단은 줄바꿈', async () => {
    const doc =
      '<?xml version="1.0"?><w:document><w:body>' +
      '<w:p><w:r><w:t>회의</w:t></w:r><w:r><w:t>록</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>예산안 &amp; 결산 검토</w:t></w:r></w:p>' +
      '</w:body></w:document>'
    const p = write('회의록.docx', zipSync({ 'word/document.xml': strToU8(doc) }))
    const text = await extractFileText(p, 'docx')
    expect(text).toContain('회의록')
    expect(text).toContain('예산안 & 결산 검토')
    expect(text).toMatch(/회의록\n/)
  })

  it('xlsx — sharedStrings의 셀 텍스트', async () => {
    const ss =
      '<?xml version="1.0"?><sst><si><t>거래처명</t></si><si><t>납품 단가표</t></si></sst>'
    const p = write('단가.xlsx', zipSync({ 'xl/sharedStrings.xml': strToU8(ss) }))
    const text = await extractFileText(p, 'xlsx')
    expect(text).toContain('거래처명')
    expect(text).toContain('납품 단가표')
  })

  it('pptx — 슬라이드 본문', async () => {
    const slide =
      '<?xml version="1.0"?><p:sld><p:txBody><a:p><a:r><a:t>분기 실적 요약</a:t></a:r></a:p></p:txBody></p:sld>'
    const p = write('실적.pptx', zipSync({ 'ppt/slides/slide1.xml': strToU8(slide) }))
    expect(await extractFileText(p, 'pptx')).toContain('분기 실적 요약')
  })

  it('hwpx — 섹션 본문', async () => {
    const sec =
      '<?xml version="1.0"?><hs:sec><hp:p><hp:run><hp:t>공문 초안 내용</hp:t></hp:run></hp:p></hs:sec>'
    const p = write('공문.hwpx', zipSync({ 'Contents/section0.xml': strToU8(sec) }))
    expect(await extractFileText(p, 'hwpx')).toContain('공문 초안 내용')
  })

  it('pdf — unpdf 텍스트 추출', async () => {
    const p = write('doc.pdf', minimalPdf('Hello unpdf search'))
    expect(await extractFileText(p, 'pdf')).toContain('Hello unpdf search')
  })

  it('상한 초과분은 절단', async () => {
    const p = write('big.txt', 'x'.repeat(MAX_TEXT_CHARS + 1000))
    expect((await extractFileText(p, 'text')).length).toBe(MAX_TEXT_CHARS)
  })

  it('깨진 zip 문서는 throw — 호출부가 error로 기록', async () => {
    const p = write('broken.docx', Buffer.from('this is not a zip'))
    await expect(extractFileText(p, 'docx')).rejects.toThrow()
  })
})
