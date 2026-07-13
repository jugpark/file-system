import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { MeResponse } from '@fs/shared'
import Sidebar from '../sidebar/Sidebar'
import TopBar from './TopBar'

/**
 * 공용 앱 프레임 — GNB + LNB + (main·info는 children/info로 주입).
 * <720px에서는 LNB가 숨고 GNB 햄버거로 드로어를 연다 (UI 명세 §04 반응형).
 */
export default function AppLayout({
  me,
  path,
  title,
  info,
  children,
}: {
  me: MeResponse
  path: string | null
  title?: string
  info: ReactNode
  children: ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setDrawerOpen(false), [location])

  return (
    <div className="app">
      <TopBar path={path ?? '/'} me={me} title={title} onMenu={() => setDrawerOpen(true)} />
      <div className="app-body">
        <Sidebar path={path} me={me} />
        {children}
        {info}
      </div>
      {drawerOpen && (
        <div className="drawer-overlay" onMouseDown={() => setDrawerOpen(false)}>
          <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
            <Sidebar path={path} me={me} />
          </div>
        </div>
      )}
    </div>
  )
}
