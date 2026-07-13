import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

/**
 * SSE 실시간 갱신 (R2) — 서버가 보내는 "이 폴더가 바뀜" 신호로 해당 캐시만 무효화.
 * 진실의 원천은 여전히 서버 readdir — 이 컴포넌트는 refetch 트리거일 뿐이다.
 */
export default function RealtimeSync() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { type: string; path: string }
        if (msg.type !== 'changed') return
        queryClient.invalidateQueries({ queryKey: ['list', msg.path] })
        queryClient.invalidateQueries({ queryKey: ['tree', msg.path] })
        queryClient.invalidateQueries({ queryKey: ['recent'] })
      } catch {
        /* 하트비트 등 무시 */
      }
    }
    return () => es.close()
  }, [queryClient])

  return null
}
