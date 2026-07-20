import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SubscriptionListResponse } from '@fs/shared'
import { api, apiJson } from '../../lib/api'

/** 폴더 구독 — 구독 폴더 아래 업로드/삭제 시 Discord DM. 핀과 같은 토글 패턴 */
export function useSubscriptions() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api<SubscriptionListResponse>('/api/subscriptions'),
    staleTime: 60_000,
  })
  const subscribedSet = new Set(query.data?.subscriptions.map((s) => s.path) ?? [])

  const toggle = async (path: string): Promise<boolean> => {
    const subscribing = !subscribedSet.has(path)
    if (subscribing) {
      await apiJson<void>('/api/subscriptions', 'POST', { path })
    } else {
      await api<void>(`/api/subscriptions?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
    }
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
    return subscribing
  }

  return { subscribedSet, toggle }
}
