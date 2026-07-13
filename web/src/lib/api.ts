import type { ApiErrorBody } from '@fs/shared'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    let code = 'UNKNOWN'
    let message = `요청 실패 (${res.status})`
    try {
      const body = (await res.json()) as ApiErrorBody
      code = body.error.code
      message = body.error.message
    } catch {
      /* JSON이 아니면 기본 메시지 */
    }
    throw new ApiError(res.status, code, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function apiJson<T>(url: string, method: string, body: unknown): Promise<T> {
  return api<T>(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function downloadUrl(path: string): string {
  return `/api/fs/download?path=${encodeURIComponent(path)}`
}

export function thumbnailUrl(path: string, width = 240): string {
  return `/api/fs/thumbnail?path=${encodeURIComponent(path)}&w=${width}`
}

export function zipUrl(paths: string[]): string {
  const params = new URLSearchParams()
  for (const p of paths) params.append('paths', p)
  return `/api/fs/download-zip?${params.toString()}`
}
