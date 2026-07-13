import { useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { MeResponse } from '@fs/shared'
import { IconFolder, IconLogout, IconSearch } from '../../components/icons'
import { api } from '../../lib/api'
import { browseTo } from '../../lib/paths'
import { getTheme, toggleTheme, type Theme } from '../../lib/theme'

/** UI 명세 §02-B — GNB: breadcrumb · 검색 · 유저 프로필. title이 있으면 breadcrumb 대신 표시 */
export default function TopBar({
  path,
  me,
  title,
  onMenu,
}: {
  path: string
  me: MeResponse
  title?: string
  onMenu?: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')

  const submitSearch = () => {
    const q = query.trim()
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  const logout = async () => {
    await api<void>('/api/auth/logout', { method: 'POST' })
    queryClient.clear()
    navigate('/login')
  }

  const segs = path.split('/').filter(Boolean)
  const crumbs = segs.map((name, i) => ({
    name,
    rel: '/' + segs.slice(0, i + 1).join('/'),
  }))

  return (
    <header className="gnb">
      {onMenu && (
        <button className="btn-menu" onClick={onMenu} aria-label="메뉴 열기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={17} height={17}>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}
      <div className="brand">
        <span className="glyph" aria-hidden="true">
          <IconFolder width={15} height={15} strokeWidth={2.2} />
        </span>
        <span>사내 스토리지</span>
      </div>

      <nav className="bc" aria-label="현재 경로">
        {title ? (
          <b>{title}</b>
        ) : (
          <>
            <Link to={browseTo('/')}>전체</Link>
            {crumbs.map((c, i) => (
              <Fragment key={c.rel}>
                <span className="car">›</span>
                {i === crumbs.length - 1 ? (
                  <b>{c.name}</b>
                ) : (
                  <Link to={browseTo(c.rel)}>{c.name}</Link>
                )}
              </Fragment>
            ))}
          </>
        )}
      </nav>

      <span className="spacer" />

      <label className="gnb-search live">
        <IconSearch width={12} height={12} strokeWidth={2.2} />
        <input
          placeholder="파일 검색"
          aria-label="파일 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
        />
      </label>

      <ThemeToggle />

      <div className="gnb-user">
        {me.avatarUrl ? (
          <img className="ava" src={me.avatarUrl} alt="" />
        ) : (
          <span className="ava" aria-hidden="true" />
        )}
        <span className="name">@{me.username}</span>
        <button className="btn-logout" onClick={logout} title="로그아웃" aria-label="로그아웃">
          <IconLogout width={15} height={15} />
        </button>
      </div>
    </header>
  )
}

/** R4 다크 모드 토글 */
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme())
  return (
    <button
      className="btn-logout"
      onClick={() => setTheme(toggleTheme())}
      title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
      aria-label="테마 전환"
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" width={15} height={15}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={15} height={15}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  )
}
