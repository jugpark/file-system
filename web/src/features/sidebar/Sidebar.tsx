import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { ListResponse, MeResponse, UsageResponse } from '@fs/shared'
import {
  IconClock,
  IconFile,
  IconFolder,
  IconLockOpen,
  IconOpen,
  IconPlus,
  IconTrash,
  IconUpload,
} from '../../components/icons'
import { api } from '../../lib/api'
import { fromDirectoryInput } from '../../lib/dropUpload'
import { formatBytes } from '../../lib/format'
import { browseTo } from '../../lib/paths'
import { MkdirDialog } from '../actions/dialogs'
import { usePins } from '../actions/usePins'
import { useOverlays } from '../overlays/Overlays'
import FolderTree from './FolderTree'

function parentOf(path: string): string {
  const segs = path.split('/').filter(Boolean)
  return '/' + segs.slice(0, -1).join('/')
}

/** UI 명세 §02-A — LNB: 메인 액션 · 네비게이션 · 즐겨찾기 · 트리 · 디스크 게이지 */
export default function Sidebar({ path, me }: { path: string | null; me: MeResponse }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { enqueueUploads } = useOverlays()
  const { pins } = usePins()
  const [newOpen, setNewOpen] = useState(false)
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const dirInput = useRef<HTMLInputElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // 현재 폴더의 쓰기 권한 (탐색기와 같은 캐시 키 공유)
  const list = useQuery({
    queryKey: ['list', path],
    queryFn: () => api<ListResponse>(`/api/fs/list?path=${encodeURIComponent(path!)}`),
    enabled: path !== null,
  })
  const writable = path !== null && list.data?.permission === 'write'

  const usage = useQuery({
    queryKey: ['usage'],
    queryFn: () => api<UsageResponse>('/api/usage'),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!newOpen) return
    const close = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setNewOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [newOpen])

  const inHome = path !== null && (path === me.homePath || path.startsWith(me.homePath + '/'))

  return (
    <aside className="lnb">
      <div className="new-wrap" ref={popRef}>
        <button
          className="m-new"
          disabled={!writable}
          title={writable ? undefined : '이 폴더에 수정 권한이 없습니다'}
          onClick={() => setNewOpen((o) => !o)}
        >
          <IconPlus width={13} height={13} />
          새로 만들기
        </button>
        {newOpen && writable && (
          <div className="new-pop" role="menu">
            <button role="menuitem" onClick={() => { setNewOpen(false); fileInput.current?.click() }}>
              <IconUpload />파일 업로드
            </button>
            <button role="menuitem" onClick={() => { setNewOpen(false); dirInput.current?.click() }}>
              <IconUpload />폴더 업로드
            </button>
            <button role="menuitem" onClick={() => { setNewOpen(false); setMkdirOpen(true) }}>
              <IconFolder />폴더 생성
            </button>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length && path !== null) {
              enqueueUploads(Array.from(e.target.files), path)
            }
            e.target.value = ''
          }}
        />
        <input
          ref={dirInput}
          type="file"
          hidden
          // @ts-expect-error 비표준이지만 전 브라우저 지원
          webkitdirectory=""
          onChange={(e) => {
            if (e.target.files?.length && path !== null) {
              enqueueUploads(fromDirectoryInput(e.target.files), path)
            }
            e.target.value = ''
          }}
        />
      </div>

      <nav className="m-nav">
        <Link className={inHome ? 'on' : ''} to={browseTo(me.homeExists ? me.homePath : '/')}>
          <IconFolder />{me.homeExists ? '내 작업 공간' : '전체'}
        </Link>
        <Link className={location.pathname === '/recent' ? 'on' : ''} to="/recent">
          <IconClock />최근 파일
        </Link>
        <Link className={location.pathname === '/shares' ? 'on' : ''} to="/shares">
          <IconOpen />공유 링크
        </Link>
        <Link className={location.pathname === '/trash' ? 'on' : ''} to="/trash">
          <IconTrash />휴지통
        </Link>
        {me.isAdmin && (
          <Link className={location.pathname === '/admin' ? 'on' : ''} to="/admin">
            <IconLockOpen />관리
          </Link>
        )}
      </nav>

      {pins.length > 0 && (
        <div className="m-tree pins">
          <p className="tree-label">즐겨찾기</p>
          {pins.map((pin) => (
            <div className={'tree-row' + (path === pin.path ? ' on' : '')} key={pin.path}>
              <span className="tree-arw leaf">▸</span>
              <button
                className="tree-name pin-name"
                title={pin.path}
                onClick={() => navigate(browseTo(pin.isDir ? pin.path : parentOf(pin.path)))}
              >
                {pin.isDir ? <IconFolder width={12} height={12} /> : <IconFile width={12} height={12} />}
                {pin.name}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="m-tree">
        <p className="tree-label">공유 폴더</p>
        {/* 'home'은 위의 '내 작업 공간'으로 진입하므로 트리에서 제외 */}
        <FolderTree path="/" currentPath={path ?? ''} excludeNames={['home']} />
      </div>

      {usage.data && (
        <div className="lnb-usage">
          <div className="gauge">
            <i
              style={{
                width: `${Math.min(100, Math.round(((usage.data.totalBytes - usage.data.freeBytes) / usage.data.totalBytes) * 100))}%`,
              }}
            />
          </div>
          여유 {formatBytes(usage.data.freeBytes)} / {formatBytes(usage.data.totalBytes)}
        </div>
      )}

      {mkdirOpen && path !== null && (
        <MkdirDialog dirPath={path} onClose={() => setMkdirOpen(false)} />
      )}
    </aside>
  )
}
