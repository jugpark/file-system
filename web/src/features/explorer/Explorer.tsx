import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FsEntry, ListResponse } from '@fs/shared'
import { IconFile, IconFolder, IconLock, IconUpload } from '../../components/icons'
import { ApiError, api, downloadUrl } from '../../lib/api'
import { formatBytes, formatMtime } from '../../lib/format'
import { browseTo } from '../../lib/paths'
import { DeleteDialog, MoveCopyDialog, RenameDialog } from '../actions/dialogs'
import { useOverlays } from '../overlays/Overlays'
import ContextMenu, { type MenuState } from './ContextMenu'
import GridView from './GridView'

type ViewMode = 'list' | 'grid'

type DialogState =
  | { type: 'rename'; entry: FsEntry }
  | { type: 'move' | 'copy'; entry: FsEntry }
  | { type: 'delete'; entry: FsEntry }
  | null

/** UI 명세 §02-C — Explorer: 뷰 토글 · 리스트 뷰 · 드래그 앤 드롭 업로드 */
export default function Explorer({
  path,
  selected,
  onSelect,
}: {
  path: string
  selected: FsEntry | null
  onSelect: (e: FsEntry | null) => void
}) {
  const navigate = useNavigate()
  const { enqueueUploads, showNotice } = useOverlays()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [dragOver, setDragOver] = useState(false)
  const [view, setView] = useState<ViewMode>(() =>
    localStorage.getItem('viewMode') === 'grid' ? 'grid' : 'list',
  )
  const switchView = (v: ViewMode) => {
    setView(v)
    localStorage.setItem('viewMode', v)
  }

  const q = useQuery({
    queryKey: ['list', path],
    queryFn: () => api<ListResponse>(`/api/fs/list?path=${encodeURIComponent(path)}`),
  })
  const writable = q.data?.permission === 'write'

  const openEntry = (entry: FsEntry) => {
    if (entry.isDir) navigate(browseTo(entry.path))
    else window.location.href = downloadUrl(entry.path)
  }

  const handleDrop = (files: File[]) => {
    if (files.length === 0) return
    if (!writable) {
      showNotice('이 폴더에 수정 권한이 없습니다')
      return
    }
    enqueueUploads(files, path)
  }

  const body = () => {
    if (q.isPending) {
      return (
        <div className="sk" aria-label="불러오는 중">
          {[38, 52, 30, 44].map((w, i) => (
            <div className="skrow" key={i}>
              <span className="sq" />
              <span className="b" style={{ width: `${w}%` }} />
              <span className="b" style={{ width: '14%', marginLeft: 'auto' }} />
            </div>
          ))}
        </div>
      )
    }
    if (q.isError) {
      const err = q.error
      const msg =
        err instanceof ApiError && err.status === 403
          ? '접근 권한이 없습니다'
          : err instanceof ApiError && err.status === 404
            ? '존재하지 않는 폴더입니다'
            : '목록을 불러오지 못했습니다'
      return (
        <div className="state-box">
          <IconFolder />
          <span className="t">{msg}</span>
        </div>
      )
    }
    if (q.data.entries.length === 0) {
      return (
        <div className="state-box">
          <IconFolder />
          <span className="t">비어 있는 폴더</span>
          {writable && <span>파일을 끌어다 놓아 업로드하세요</span>}
        </div>
      )
    }
    if (view === 'grid') {
      return (
        <GridView
          entries={q.data.entries}
          selected={selected}
          onSelect={onSelect}
          onOpen={openEntry}
          onMenu={(entry, ev) => setMenu({ x: ev.clientX, y: ev.clientY, entry })}
        />
      )
    }
    return (
      <table className="lv">
        <thead>
          <tr>
            <th>파일 / 폴더명</th>
            <th className="hidem">마지막 수정자</th>
            <th>수정 일시</th>
            <th>크기</th>
          </tr>
        </thead>
        <tbody>
          {q.data.entries.map((entry) => {
            const readonlyDir = entry.isDir && entry.permission === 'read'
            return (
              <tr
                key={entry.path}
                className={selected?.path === entry.path ? 'sel' : ''}
                onClick={() => onSelect(entry)}
                onDoubleClick={() => openEntry(entry)}
                onContextMenu={(ev) => {
                  ev.preventDefault()
                  onSelect(entry)
                  setMenu({ x: ev.clientX, y: ev.clientY, entry })
                }}
              >
                <td className="nm">
                  <span className={'fic' + (entry.isDir ? ' f' : '') + (readonlyDir ? ' ro' : '')}>
                    {entry.isDir ? <IconFolder /> : <IconFile />}
                  </span>
                  {entry.name}
                  {readonlyDir && <IconLock className="ro-mini" width={11} height={11} />}
                </td>
                <td className="hidem">
                  {entry.uploader ? (
                    <span className="who"><i />@{entry.uploader}</span>
                  ) : (
                    <span className="mono">—</span>
                  )}
                </td>
                <td className="mono">{formatMtime(entry.mtime)}</td>
                <td className="mono">{entry.isDir ? '—' : formatBytes(entry.size)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <section
      className="main"
      onDragOver={(ev) => {
        ev.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(ev) => {
        ev.preventDefault()
        setDragOver(false)
        handleDrop(Array.from(ev.dataTransfer.files))
      }}
    >
      <div className="m-toolbar">
        <span className="toggle">
          <button className={view === 'list' ? 'on' : ''} onClick={() => switchView('list')}>
            리스트
          </button>
          <button className={view === 'grid' ? 'on' : ''} onClick={() => switchView('grid')}>
            그리드
          </button>
        </span>
        <span className="m-count">{q.data ? `${q.data.entries.length} 항목` : ''}</span>
      </div>

      {body()}

      <div
        className={'m-drop' + (dragOver ? ' over' : '')}
        style={writable ? undefined : { opacity: 0.5 }}
      >
        <IconUpload />
        {writable ? '여기로 파일을 끌어다 놓으면 업로드' : '읽기 전용 폴더입니다'}
      </div>

      {menu && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onOpen={openEntry}
          onRename={(entry) => setDialog({ type: 'rename', entry })}
          onMoveCopy={(entry, mode) => setDialog({ type: mode, entry })}
          onDelete={(entry) => setDialog({ type: 'delete', entry })}
        />
      )}

      {dialog?.type === 'rename' && (
        <RenameDialog entry={dialog.entry} onClose={() => setDialog(null)} />
      )}
      {(dialog?.type === 'move' || dialog?.type === 'copy') && (
        <MoveCopyDialog entry={dialog.entry} mode={dialog.type} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'delete' && (
        <DeleteDialog
          entry={dialog.entry}
          onClose={() => {
            setDialog(null)
            onSelect(null)
          }}
        />
      )}
    </section>
  )
}
