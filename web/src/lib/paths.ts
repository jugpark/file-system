/** 상대 경로('/a/b') → 브라우저 라우트('/browse/a/b'), 세그먼트별 인코딩 */
export function browseTo(relPath: string): string {
  return '/browse' + relPath.split('/').map(encodeURIComponent).join('/')
}
