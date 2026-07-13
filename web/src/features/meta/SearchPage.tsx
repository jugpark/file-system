import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import type { SearchResponse } from '@fs/shared'
import { IconSearch } from '../../components/icons'
import { api } from '../../lib/api'
import { useMe } from '../auth/useMe'
import Sidebar from '../sidebar/Sidebar'
import TopBar from '../shell/TopBar'
import EntriesTable from './EntriesTable'

/** UI 명세 §02-B 검색 — 파일명 부분 일치, 권한 범위 내 결과만 */
export default function SearchPage() {
  const me = useMe().data!
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()

  const query = useQuery({
    queryKey: ['search', q],
    queryFn: () => api<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  })

  return (
    <div className="app">
      <TopBar path="/" me={me} title={`검색: ${q}`} />
      <div className="app-body">
        <Sidebar path={null} me={me} />
        <section className="main">
          <div className="m-toolbar">
            <span className="m-count">
              {query.data
                ? `${query.data.entries.length}건${query.data.truncated ? '+ (상위만 표시)' : ''}`
                : ''}
            </span>
          </div>
          {query.isPending && q.length > 0 && (
            <div className="sk">
              {[45, 60].map((w, i) => (
                <div className="skrow" key={i}>
                  <span className="sq" />
                  <span className="b" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          )}
          {q.length === 0 && (
            <div className="state-box">
              <IconSearch />
              <span className="t">검색어를 입력하세요</span>
              <span>상단 검색바에서 파일명으로 검색합니다</span>
            </div>
          )}
          {query.data && query.data.entries.length === 0 && (
            <div className="state-box">
              <IconSearch />
              <span className="t">"{q}" 결과 없음</span>
              <span>권한이 있는 폴더 안에서만 검색됩니다</span>
            </div>
          )}
          {query.data && query.data.entries.length > 0 && (
            <EntriesTable entries={query.data.entries} />
          )}
        </section>
        <aside className="info">
          <div className="placeholder">
            파일명 부분 일치로 검색하며
            <br />
            내 권한 범위의 결과만 보입니다
          </div>
        </aside>
      </div>
    </div>
  )
}
