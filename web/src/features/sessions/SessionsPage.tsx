import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { SessionListResponse } from '@fs/shared'
import { IconLockOpen } from '../../components/icons'
import { api, apiJson } from '../../lib/api'
import { formatMtime } from '../../lib/format'
import { useMe } from '../auth/useMe'
import { useOverlays } from '../overlays/Overlays'
import AppLayout from '../shell/AppLayout'

/** 사람이 읽는 기기 요약 — User-Agent에서 브라우저·OS만 뽑는다 */
function describeAgent(ua: string | null): string {
  if (!ua) return '알 수 없는 기기'
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iOS/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '기타 OS'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '기타 브라우저'
  return `${browser} · ${os}`
}

/** 세션 관리 — 내 로그인 기기 목록과 원격 해지 */
export default function SessionsPage() {
  const me = useMe().data!
  const queryClient = useQueryClient()
  const { showNotice } = useOverlays()
  const [busy, setBusy] = useState(false)
  const q = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionListResponse>('/api/sessions'),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['sessions'] })

  const revoke = async (id: string) => {
    try {
      await api<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
      invalidate()
      showNotice('세션을 종료했습니다')
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '해지 실패')
    }
  }

  const revokeOthers = async () => {
    setBusy(true)
    try {
      const res = await apiJson<{ revoked: number }>('/api/sessions/revoke-others', 'POST', {})
      showNotice(res.revoked > 0 ? `다른 기기 ${res.revoked}개를 로그아웃했습니다` : '다른 기기가 없습니다')
      invalidate()
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '실패')
    } finally {
      setBusy(false)
    }
  }

  const sessions = q.data?.sessions ?? []
  const hasOthers = sessions.some((s) => !s.current)

  return (
    <AppLayout
      me={me}
      path={null}
      title="세션 관리"
      info={
        <aside className="info">
          <div className="placeholder">
            로그인한 기기 목록입니다
            <br />
            낯선 기기는 종료하세요
          </div>
        </aside>
      }
    >
      <section className="main">
        <div className="m-toolbar">
          {hasOthers && (
            <button className="btn ghost sm" disabled={busy} onClick={revokeOthers}>
              다른 기기 전체 로그아웃
            </button>
          )}
          <span className="m-count">{q.data ? `${sessions.length}개 기기` : ''}</span>
        </div>
        {q.data && sessions.length > 0 && (
          <table className="lv">
            <thead>
              <tr>
                <th>기기</th>
                <th>로그인</th>
                <th>마지막 활동</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="nm">
                    <span className="fic"><IconLockOpen /></span>
                    {describeAgent(s.userAgent)}
                    {s.current && <span className="tag-perm ed mini" style={{ marginLeft: 8 }}>현재 기기</span>}
                  </td>
                  <td className="mono">{formatMtime(s.createdAt)}</td>
                  <td className="mono">{s.lastSeenAt ? formatMtime(s.lastSeenAt) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {!s.current && (
                      <button className="btn ghost sm danger-text" onClick={() => revoke(s.id)}>
                        종료
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AppLayout>
  )
}
