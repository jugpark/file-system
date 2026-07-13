import { useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { MeResponse } from '@fs/shared'
import {
  IconChevronDown,
  IconFolder,
  IconLockOpen,
  IconLogout,
  IconMoon,
  IconOpen,
  IconSearch,
  IconSun,
  IconTrash,
} from '../../components/icons'
import { api } from '../../lib/api'
import { browseTo } from '../../lib/paths'
import { getTheme, toggleTheme, type Theme } from '../../lib/theme'

/** UI 명세 §02-B — GNB: breadcrumb · 검색 · 프로필 메뉴. title이 있으면 breadcrumb 대신 표시 */
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
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')

  const submitSearch = () => {
    const q = query.trim()
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
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

      <ProfileMenu me={me} />
    </header>
  )
}

/** 프로필 드롭다운 — 빠른 이동·테마·로그아웃 */
function ProfileMenu({ me }: { me: MeResponse }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(getTheme())

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  const logout = async () => {
    await api<void>('/api/auth/logout', { method: 'POST' })
    queryClient.clear()
    navigate('/login')
  }

  return (
    <div className="profile-wrap" ref={wrapRef}>
      <button
        className="profile-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {me.avatarUrl ? (
          <img className="ava" src={me.avatarUrl} alt="" />
        ) : (
          <span className="ava" aria-hidden="true" />
        )}
        <span className="name">@{me.username}</span>
        <IconChevronDown width={12} height={12} className="chev" />
      </button>

      {open && (
        <div className="ctx profile-pop" role="menu" aria-label="프로필 메뉴">
          <div className="pop-head">
            {me.avatarUrl ? (
              <img className="ava big" src={me.avatarUrl} alt="" />
            ) : (
              <span className="ava big" aria-hidden="true" />
            )}
            <span className="who-col">
              <b>@{me.username}</b>
              {me.isAdmin && <span className="tag-perm ed mini">관리자</span>}
            </span>
          </div>
          <div className="div" role="separator" />
          <button role="menuitem" onClick={() => go(browseTo(me.homeExists ? me.homePath : '/'))}>
            <IconFolder className="ci" />{me.homeExists ? '내 작업 공간' : '전체 보기'}
          </button>
          <button role="menuitem" onClick={() => go('/shares')}>
            <IconOpen className="ci" />공유 링크 관리
          </button>
          <button role="menuitem" onClick={() => go('/trash')}>
            <IconTrash className="ci" />휴지통
          </button>
          {me.isAdmin && (
            <button role="menuitem" onClick={() => go('/admin')}>
              <IconLockOpen className="ci" />관리
            </button>
          )}
          <div className="div" role="separator" />
          <button role="menuitem" onClick={() => setTheme(toggleTheme())}>
            {theme === 'dark' ? <IconSun className="ci" /> : <IconMoon className="ci" />}
            {theme === 'dark' ? '라이트 모드' : '다크 모드'}
            <span className="note">테마</span>
          </button>
          <div className="div" role="separator" />
          <button className="del" role="menuitem" onClick={logout}>
            <IconLogout className="ci" />로그아웃
          </button>
        </div>
      )}
    </div>
  )
}
