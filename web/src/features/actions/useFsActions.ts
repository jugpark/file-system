import { useQueryClient } from '@tanstack/react-query'
import type {
  BatchResponse,
  MkdirResponse,
  RenameResponse,
} from '@fs/shared'
import { apiJson } from '../../lib/api'
import { useOverlays } from '../overlays/Overlays'

/** 쓰기 작업 공통 — 성공 시 목록/트리/휴지통 캐시 무효화, 실패는 토스트로 */
export function useFsActions() {
  const queryClient = useQueryClient()
  const { showNotice } = useOverlays()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['list'] })
    queryClient.invalidateQueries({ queryKey: ['tree'] })
    queryClient.invalidateQueries({ queryKey: ['trash'] })
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      const result = await fn()
      invalidate()
      return result
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '작업에 실패했습니다')
      return null
    }
  }

  /** batch 응답에서 실패 항목이 있으면 토스트. 전부 성공 시 true */
  function reportBatch(res: BatchResponse | null): boolean {
    if (!res) return false
    const failed = res.results.filter((r) => !r.ok)
    if (failed.length > 0) {
      showNotice(failed[0]!.error ?? `${failed.length}개 항목이 실패했습니다`)
      return false
    }
    return true
  }

  return {
    mkdir: (path: string, name: string) =>
      run(() => apiJson<MkdirResponse>('/api/fs/mkdir', 'POST', { path, name })),
    rename: (path: string, newName: string) =>
      run(() => apiJson<RenameResponse>('/api/fs/rename', 'PATCH', { path, newName })),
    move: async (paths: string[], destDir: string) =>
      reportBatch(await run(() => apiJson<BatchResponse>('/api/fs/move', 'POST', { paths, destDir }))),
    copy: async (paths: string[], destDir: string) =>
      reportBatch(await run(() => apiJson<BatchResponse>('/api/fs/copy', 'POST', { paths, destDir }))),
    trashPaths: async (paths: string[]) =>
      reportBatch(await run(() => apiJson<BatchResponse>('/api/fs/trash', 'DELETE', { paths }))),
    restore: async (trashIds: string[]) =>
      reportBatch(await run(() => apiJson<BatchResponse>('/api/fs/restore', 'POST', { trashIds }))),
  }
}
