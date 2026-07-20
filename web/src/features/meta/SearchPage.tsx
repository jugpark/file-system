import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ContentMatch, SearchResponse } from '@fs/shared'
import { IconFile, IconSearch } from '../../components/icons'
import { api, downloadUrl } from '../../lib/api'
import { formatMtime } from '../../lib/format'
import { browseTo } from '../../lib/paths'
import { useMe } from '../auth/useMe'
import AppLayout from '../shell/AppLayout'
import EntriesTable from './EntriesTable'

function parentOf(path: string): string {
  const segs = path.split('/').filter(Boolean)
  return '/' + segs.slice(0, -1).join('/')
}

/** 스니펫 속 질의어 하이라이트 — 서버가 평문을 주므로 여기서 <mark>만 입힌다 */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  const parts: ReactNode[] = []
  let i = 0
  let k = 0
  for (;;) {
    const j = lower.indexOf(ql, i)
    if (j < 0) {
      parts.push(text.slice(i))
      break
    }
    if (j > i) parts.push(text.slice(i, j))
    parts.push(<mark key={k++}>{text.slice(j, j + q.length)}</mark>)
    i = j + q.length
  }
  return <>{parts}</>
}

function ContentMatches({ matches, q }: { matches: ContentMatch[]; q: string }) {
  const navigate = useNavigate()
  return (
    <div>
      {matches.map((m) => (
        <div className="cm-item" key={m.entry.path}>
          <div className="cm-head">
            <span className="fic">
              <IconFile />
            </span>
            <a className="cm-name" href={downloadUrl(m.entry.path)}>
              {m.entry.name}
            </a>
            <a
              className="cm-loc"
              href={browseTo(parentOf(m.entry.path))}
              onClick={(e) => {
                e.preventDefault()
                navigate(browseTo(parentOf(m.entry.path)))
              }}
            >
              {parentOf(m.entry.path)}
            </a>
            <span className="cm-mtime">{formatMtime(m.entry.mtime)}</span>
          </div>
          <div className="cm-snippet">
            <Highlight text={m.snippet} q={q} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** UI 명세 §02-B 검색 — 파일명 부분 일치 + 문서 내용 일치(FTS), 권한 범위 내 결과만 */
export default function SearchPage() {
  const me = useMe().data!
  const [params] = useSearchParams()
  const q = (params.get('q') ?? '').trim()

  const query = useQuery({
    queryKey: ['search', q],
    queryFn: () => api<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  })

  // 서버가 구버전이어도 UI가 깨지지 않게 방어
  const content = query.data?.content ?? []
  const contentEnabled = query.data?.contentEnabled ?? false
  const nameCount = query.data?.entries.length ?? 0

  return (
    <AppLayout
      me={me}
      path={null}
      title={`검색: ${q}`}
      info={
        <aside className="info">
          <div className="placeholder">
            {contentEnabled ? (
              <>
                파일명과 문서 내용(PDF·오피스·텍스트)을
                <br />
                함께 검색하며, 내 권한 범위의 결과만 보입니다
              </>
            ) : (
              <>
                파일명 부분 일치로 검색하며
                <br />
                내 권한 범위의 결과만 보입니다
              </>
            )}
          </div>
        </aside>
      }
    >
      <section className="main">
        <div className="m-toolbar">
          <span className="m-count">
            {query.data
              ? `파일명 ${nameCount}건${query.data.truncated ? '+' : ''}` +
                (contentEnabled ? ` · 내용 ${content.length}건${query.data.contentTruncated ? '+' : ''}` : '')
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
            <span>상단 검색바에서 파일명이나 문서 내용으로 검색합니다</span>
          </div>
        )}
        {query.data && nameCount === 0 && content.length === 0 && (
          <div className="state-box">
            <IconSearch />
            <span className="t">"{q}" 결과 없음</span>
            <span>권한이 있는 폴더 안에서만 검색됩니다</span>
          </div>
        )}
        {query.data && nameCount > 0 && (
          <>
            <div className="sec-h">파일명 일치</div>
            <EntriesTable entries={query.data.entries} />
          </>
        )}
        {query.data && content.length > 0 && (
          <>
            <div className="sec-h">문서 내용 일치</div>
            <ContentMatches matches={content} q={q} />
          </>
        )}
      </section>
    </AppLayout>
  )
}
