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

export function isImageName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && IMAGE_EXTS.has(name.slice(dot + 1).toLowerCase())
}
