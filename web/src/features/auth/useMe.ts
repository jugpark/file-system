import { useQuery } from '@tanstack/react-query'
import type { MeResponse } from '@fs/shared'
import { api } from '../../lib/api'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/api/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}
