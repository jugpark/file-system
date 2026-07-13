import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { ListResponse, MeResponse } from '@fs/shared'
import { IconClock, IconFolder, IconPlus, IconTrash, IconUpload } from '../../components/icons'
import { api } from '../../lib/api'
import { browseTo } from '../../lib/paths'
import { MkdirDialog } from '../actions/dialogs'
import { useOverlays } from '../overlays/Overlays'
import FolderTree from './FolderTree'

/** UI 명세 §02-A — LNB: 메인 액션 · 권한 기반 네비게이션 · 트리 뷰 */
export default function Sidebar({ path, me }: { path: string | null; me: MeResponse }) {
  const location = useLocation()
  const { enqueueUploads } = useOverlays()
  const [newOpen, setNewOpen] = useState(false)
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  // 현재 폴더의 쓰기 권한 (탐색기와 같은 캐시 키 공유)
  const list = useQuery({
    queryKey: ['list', path],
    queryFn: () => api<ListResponse>(`/api/fs/list?path=${encodeURIComponent(path!)}`),
    enabled: path !== null,
  })
  const writable = path !== null && list.data?.permission === 'write'

  useEffect(() => {
    if (!newOpen) return
    const close = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setNewOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [newOpen])

  const inHome = path !== null && (path === me.homePath || path.startsWith(me.homePath + '/'))
  const inTrash = location.pathname === '/trash'

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
            <button
              role="menuitem"
              onClick={() => {
                setNewOpen(false)
                fileInput.current?.click()
              }}
            >
              <IconUpload />파일 업로드
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setNewOpen(false)
                setMkdirOpen(true)
              }}
            >
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
      </div>

      <nav className="m-nav">
        <Link className={inHome ? 'on' : ''} to={browseTo(me.homePath)}>
          <IconFolder />내 작업 공간
        </Link>
        <Link className={location.pathname === '/recent' ? 'on' : ''} to="/recent">
          <IconClock />최근 파일
        </Link>
        <Link className={inTrash ? 'on' : ''} to="/trash">
          <IconTrash />휴지통
        </Link>
      </nav>

      <div className="m-tree">
        <p className="tree-label">공유 폴더</p>
        {/* 'home'은 위의 '내 작업 공간'으로 진입하므로 트리에서 제외 */}
        <FolderTree path="/" currentPath={path ?? ''} excludeNames={['home']} />
      </div>

      {mkdirOpen && path !== null && (
        <MkdirDialog dirPath={path} onClose={() => setMkdirOpen(false)} />
      )}
    </aside>
  )
}
