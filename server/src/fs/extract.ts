import fsp from 'node:fs/promises'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'

/**
 * 문서 텍스트 추출 — 내용 검색(content-index)의 입력을 만든다.
 * 지원: 평문 계열(코드·md·csv…), PDF(unpdf), OOXML(docx/xlsx/pptx)·HWPX(zip+XML).
 * 레거시 바이너리 포맷(doc/hwp/xls/ppt)은 파서 유지비 대비 효용이 낮아 제외.
 */

/** 추출 결과 상한 — FTS 저장량·스니펫 품질과 인덱싱 비용의 균형점 */
export const MAX_TEXT_CHARS = 500_000

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'html', 'htm', 'css',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cc', 'cpp', 'h', 'hpp',
  'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'sh', 'bat', 'ps1', 'sql',
  'yml', 'yaml', 'toml', 'ini', 'conf', 'properties', 'tex',
])

export type ExtractKind = 'text' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'hwpx'

/** 이 경로가 내용 추출 대상이면 종류를, 아니면 null */
export function extractableKind(relPath: string): ExtractKind | null {
  const ext = path.posix.extname(relPath.toLowerCase()).slice(1)
  if (TEXT_EXTS.has(ext)) return 'text'
  if (ext === 'pdf' || ext === 'docx' || ext === 'xlsx' || ext === 'pptx' || ext === 'hwpx') return ext
  return null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * XML → 평문. 문단 닫힘을 줄바꿈으로 남기고 태그를 제거한다.
 * 태그를 공백이 아닌 빈 문자열로 지우는 이유: docx는 한 단어가 여러 <w:t> run으로
 * 쪼개질 수 있어, 공백을 넣으면 단어 중간이 끊겨 검색이 안 된다.
 */
function xmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<(?:w:br|a:br|w:cr)\s*\/?>/g, '\n')
      .replace(/<(?:w:tab)\s*\/?>/g, ' ')
      .replace(/<\/(?:w:p|a:p|hp:p|si|text)>/g, '\n')
      .replace(/<[^>]*>/g, ''),
  )
}

/** zip 안에서 패턴에 맞는 엔트리들을 이름순으로 이어붙여 XML 텍스트로 */
function zipXmlText(buf: Buffer, pattern: RegExp): string {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => pattern.test(f.name) })
  return Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, data]) => xmlToText(strFromU8(data)))
    .join('\n')
}

async function pdfText(buf: Buffer): Promise<string> {
  // pdfjs 로딩 비용이 커서 PDF를 처음 만날 때만 lazy import
  const { extractText, getDocumentProxy } = await import('unpdf')
  const doc = await getDocumentProxy(new Uint8Array(buf))
  const { text } = await extractText(doc, { mergePages: true })
  return text
}

function plainText(buf: Buffer): string {
  // NUL이 섞여 있으면 확장자만 텍스트인 바이너리로 보고 건너뜀
  const head = buf.subarray(0, 8192)
  if (head.includes(0)) return ''
  return buf.toString('utf8')
}

/** 잡공백 정리 + NFC 정규화 + 상한 절단 */
function finalize(text: string): string {
  const t = text
    .normalize('NFC')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  return t.length > MAX_TEXT_CHARS ? t.slice(0, MAX_TEXT_CHARS) : t
}

/** 파일에서 검색용 텍스트 추출. 실패는 throw — 호출부가 status로 기록한다 */
export async function extractFileText(abs: string, kind: ExtractKind): Promise<string> {
  const buf = await fsp.readFile(abs)
  switch (kind) {
    case 'text':
      return finalize(plainText(buf))
    case 'pdf':
      return finalize(await pdfText(buf))
    case 'docx':
      return finalize(zipXmlText(buf, /^word\/(document|header\d*|footer\d*)\.xml$/))
    case 'xlsx':
      return finalize(zipXmlText(buf, /^xl\/sharedStrings\.xml$/))
    case 'pptx':
      return finalize(zipXmlText(buf, /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/))
    case 'hwpx':
      return finalize(zipXmlText(buf, /^Contents\/section\d+\.xml$/))
  }
}
