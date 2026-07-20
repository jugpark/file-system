import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ShareListResponse } from '@fs/shared'
import { IconFile, IconFolder, IconOpen } from '../../components/icons'
import { api } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { formatMtime } from '../../lib/format'
import { useMe } from '../auth/useMe'
import { useOverlays } from '../overlays/Overlays'
import AppLayout from '../shell/AppLayout'

/** R4 공유 링크 관리 — 내가 만든(admin은 전체) 링크의 만료·해지 */
export default function SharesPage() {
  const me = useMe().data!
  const queryClient = useQueryClient()
  const { showNotice } = useOverlays()
  const q = useQuery({
    queryKey: ['shares'],
    queryFn: () => api<ShareListResponse>('/api/share'),
  })

  const copy = async (url: string) => {
    const ok = await copyText(url)
    showNotice(ok ? '링크를 복사했습니다' : '복사 실패 — 링크를 직접 선택해 복사하세요')
  }
  const revoke = async (token: string) => {
    try {
      await api<void>(`/api/share/${token}`, { method: 'DELETE' })
      queryClient.invalidateQueries({ queryKey: ['shares'] })
      showNotice('링크를 해지했습니다')
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '해지 실패')
    }
  }

  return (
    <AppLayout
      me={me}
      path={null}
      title="공유 링크"
      info={
        <aside className="info">
          <div className="placeholder">
            공유 링크=로그인 없이 다운로드
            <br />
            파일 요청=로그인 없이 이 폴더로 전송
          </div>
        </aside>
      }
    >
      <section className="main">
        {q.data && q.data.links.length === 0 && (
          <div className="state-box">
            <IconOpen />
            <span className="t">공유 링크가 없습니다</span>
            <span>파일 우클릭 → '공유 링크', 폴더 우클릭 → '파일 요청 링크'</span>
          </div>
        )}
        {q.data && q.data.links.length > 0 && (
          <table className="lv">
            <thead>
              <tr>
                <th>대상</th>
                <th>종류</th>
                <th className="hidem">경로</th>
                <th>만료</th>
                <th>사용</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {q.data.links.map((link) => (
                <tr key={link.token} style={link.expired ? { opacity: 0.5 } : undefined}>
                  <td className="nm">
                    <span className={'fic' + (link.kind === 'upload' ? ' f' : '')}>
                      {link.kind === 'upload' ? <IconFolder /> : <IconFile />}
                    </span>
                    {link.name}
                  </td>
                  <td>
                    <span className={'tag-perm ' + (link.kind === 'upload' ? 'ed' : 'rd')}>
                      {link.kind === 'upload' ? '파일 요청' : '다운로드'}
                    </span>
                  </td>
                  <td className="hidem mono">{link.path}</td>
                  <td className="mono">{link.expired ? '만료됨' : formatMtime(link.expiresAt)}</td>
                  <td className="mono">
                    {link.kind === 'upload' ? `${link.downloadCount}개 받음` : `${link.downloadCount}회`}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!link.expired && (
                      <button className="btn ghost sm" onClick={() => copy(link.url)}>복사</button>
                    )}{' '}
                    <button className="btn ghost sm" onClick={() => revoke(link.token)}>해지</button>
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
