import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PinListResponse } from '@fs/shared'
import { api, apiJson } from '../../lib/api'

/** R4 즐겨찾기 — 목록 조회 + 토글 */
export function usePins() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['pins'],
    queryFn: () => api<PinListResponse>('/api/pins'),
    staleTime: 60_000,
  })
  const pinnedSet = new Set(query.data?.pins.map((p) => p.path) ?? [])

  const toggle = async (path: string) => {
    if (pinnedSet.has(path)) {
      await api<void>(`/api/pins?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
    } else {
      await apiJson<void>('/api/pins', 'POST', { path })
    }
    queryClient.invalidateQueries({ queryKey: ['pins'] })
  }

  return { pins: query.data?.pins ?? [], pinnedSet, toggle }
}
