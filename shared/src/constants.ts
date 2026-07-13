export const SESSION_COOKIE = 'sid'
export const SESSION_TTL_DAYS = 14
/** role 캐시 TTL (ms) — 초과 시 Discord에서 재조회 */
export const ROLE_CACHE_TTL_MS = 10 * 60 * 1000
/** Discord 장애 시 stale role 허용 한도 (ms) */
export const ROLE_STALE_MAX_MS = 60 * 60 * 1000

/** 파일/폴더명에 쓸 수 없는 문자 (경로 구분자·와일드카드·제어문자 U+0000-U+001F) */
export const FORBIDDEN_NAME_CHARS = new RegExp('[\\\\/:*?"<>|\\u0000-\\u001f]')

/** 썸네일 생성 대상 확장자 (서버 sharp 기준) */
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'tiff', 'bmp'])

export function extOfName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isImageName(name: string): boolean {
  return IMAGE_EXTS.has(extOfName(name))
}

export const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v'])
export const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac'])
export const TEXT_EXTS = new Set([
  'txt', 'md', 'csv', 'json', 'log', 'js', 'ts', 'tsx', 'jsx', 'py', 'sh',
  'yml', 'yaml', 'toml', 'ini', 'css', 'sql', 'env', 'conf',
])

export type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text'

/**
 * 브라우저 미리보기 종류. null=미리보기 불가(다운로드만).
 * ⚠ 보안 불변식: html/svg/htm은 어떤 경우에도 inline 렌더 금지(저장 XSS) — 여기 절대 넣지 말 것.
 */
export function previewKind(name: string): PreviewKind | null {
  const ext = extOfName(name)
  if (IMAGE_EXTS.has(ext) && ext !== 'tiff') return 'image'
  if (ext === 'pdf') return 'pdf'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (TEXT_EXTS.has(ext)) return 'text'
  return null
}

/** 미리보기로 텍스트를 그대로 열 수 있는 최대 크기 */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024

/** 같은 이름 덮어쓰기 시 보관하는 이전 버전 수 */
export const MAX_VERSIONS = 5
