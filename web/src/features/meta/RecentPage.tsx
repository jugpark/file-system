import { useQuery } from '@tanstack/react-query'
import type { RecentResponse } from '@fs/shared'
import { IconClock } from '../../components/icons'
import { api } from '../../lib/api'
import { useMe } from '../auth/useMe'
import AppLayout from '../shell/AppLayout'
import EntriesTable from './EntriesTable'

/** UI 명세 §02-A '최근 파일' — 실제 mtime 기준 최근 수정 파일 */
export default function RecentPage() {
  const me = useMe().data!
  const query = useQuery({
    queryKey: ['recent'],
    queryFn: () => api<RecentResponse>('/api/recent?limit=30'),
  })

  return (
    <AppLayout
      me={me}
      path={null}
      title="최근 파일"
      info={
        <aside className="info">
          <div className="placeholder">
            수정 시각 기준 최근 파일
            <br />
            30개까지 표시됩니다
          </div>
        </aside>
      }
    >
      <section className="main">
          {query.isPending && (
            <div className="sk">
              {[45, 60, 35].map((w, i) => (
                <div className="skrow" key={i}>
                  <span className="sq" />
                  <span className="b" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          )}
          {query.data && query.data.entries.length === 0 && (
            <div className="state-box">
              <IconClock />
              <span className="t">최근 파일이 없습니다</span>
            </div>
          )}
          {query.data && query.data.entries.length > 0 && (
            <EntriesTable entries={query.data.entries} />
          )}
      </section>
    </AppLayout>
  )
}
