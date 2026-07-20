import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { FsEntry, ListResponse } from '@fs/shared'
import { IconFile, IconFolder, IconLock, IconTrash, IconUpload } from '../../components/icons'
import { ApiError, api, downloadUrl, zipUrl } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { collectDropped } from '../../lib/dropUpload'
import { formatBytes, formatMtime } from '../../lib/format'
import { browseTo } from '../../lib/paths'
import { DeleteDialog, MoveCopyDialog, RenameDialog } from '../actions/dialogs'
import ShareDialog from '../actions/ShareDialog'
import { usePins } from '../actions/usePins'
import VersionsDialog from '../actions/VersionsDialog'
import { useOverlays } from '../overlays/Overlays'
import PreviewModal, { canPreview } from '../preview/PreviewModal'
import ContextMenu, { type MenuState } from './ContextMenu'
import GridView from './GridView'

type ViewMode = 'list' | 'grid'

type DialogState =
  | { type: 'rename'; entry: FsEntry }
  | { type: 'move' | 'copy'; entries: FsEntry[] }
  | { type: 'delete'; entries: FsEntry[] }
  | { type: 'share'; entry: FsEntry }
  | { type: 'versions'; entry: FsEntry }
  | null

/** UI 명세 §02-C — Explorer: 리스트/그리드, DnD 업로드, 다중 선택, 미리보기, 단축키 */
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
  const { pinnedSet, toggle: togglePin } = usePins()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [preview, setPreview] = useState<FsEntry | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
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
  const entries = q.data?.entries ?? []
  const checkedEntries = entries.filter((e) => checked.has(e.path))

  useEffect(() => {
    setChecked(new Set())
    anchorRef.current = null
  }, [path])

  // ── 딥링크: ?focus=<이름> 으로 진입하면 해당 행 선택·스크롤·플래시 ──
  const [params, setParams] = useSearchParams()
  const [flashPath, setFlashPath] = useState<string | null>(null)
  useEffect(() => {
    const focusName = params.get('focus')
    if (!focusName || !q.data) return
    // 파라미터는 1회성 — 새로고침/이동 시 반복 강조 방지
    setParams(
      (p) => {
        p.delete('focus')
        return p
      },
      { replace: true },
    )
    const entry = q.data.entries.find((e) => e.name === focusName)
    if (!entry) {
      showNotice(`"${focusName}" 항목이 이 폴더에 없습니다 (이동·삭제됐을 수 있음)`)
      return
    }
    setChecked(new Set([entry.path]))
    anchorRef.current = entry.path
    onSelect(entry)
    setFlashPath(entry.path)
    const t = setTimeout(() => setFlashPath(null), 2600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data])

  /** 사내용 딥링크 — 폴더는 그 폴더로, 파일은 부모 폴더+focus로 */
  const copyLink = async (entry: FsEntry) => {
    const url = entry.isDir
      ? `${location.origin}${browseTo(entry.path)}`
      : `${location.origin}${browseTo(path)}?focus=${encodeURIComponent(entry.name)}`
    const ok = await copyText(url)
    showNotice(ok ? '링크를 복사했습니다' : '복사에 실패했습니다 — 주소창에서 직접 복사하세요')
  }

  const openEntry = (entry: FsEntry) => {
    if (entry.isDir) return navigate(browseTo(entry.path))
    if (canPreview(entry)) setPreview(entry)
    else window.location.href = downloadUrl(entry.path)
  }

  /** 클릭 선택 — 일반=단일, Ctrl=토글, Shift=범위 */
  const handleSelect = (entry: FsEntry, ev: ReactMouseEvent) => {
    onSelect(entry)
    if (ev.ctrlKey || ev.metaKey) {
      setChecked((prev) => {
        const next = new Set(prev)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
      anchorRef.current = entry.path
      return
    }
    if (ev.shiftKey && anchorRef.current) {
      const a = entries.findIndex((e) => e.path === anchorRef.current)
      const b = entries.findIndex((e) => e.path === entry.path)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setChecked(new Set(entries.slice(lo, hi + 1).map((e) => e.path)))
        return
      }
    }
    setChecked(new Set([entry.path]))
    anchorRef.current = entry.path
  }

  const openMenu = (entry: FsEntry, ev: ReactMouseEvent) => {
    ev.preventDefault()
    onSelect(entry)
    if (!checked.has(entry.path)) {
      setChecked(new Set([entry.path]))
      anchorRef.current = entry.path
    }
    setMenu({ x: ev.clientX, y: ev.clientY, entry })
  }

  // ── R4 키보드 단축키 ──
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (dialog || menu || preview) return
      const target = ev.target as HTMLElement
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return

      if (ev.key === 'Escape') {
        setChecked(new Set())
        onSelect(null)
        return
      }
      if (ev.key === 'Delete' && checkedEntries.length > 0) {
        if (checkedEntries.every((e) => e.permission === 'write')) {
          setDialog({ type: 'delete', entries: checkedEntries })
        } else {
          showNotice('수정 권한이 없는 항목이 있습니다')
        }
        return
      }
      if (ev.key === 'F2' && checkedEntries.length === 1) {
        const entry = checkedEntries[0]!
        if (entry.permission === 'write') setDialog({ type: 'rename', entry })
        return
      }
      if (ev.key === 'Enter' && checkedEntries.length === 1) {
        openEntry(checkedEntries[0]!)
        return
      }
      if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && entries.length > 0) {
        ev.preventDefault()
        const cur = entries.findIndex((e) => checked.has(e.path))
        const next =
          cur < 0
            ? 0
            : Math.min(Math.max(cur + (ev.key === 'ArrowDown' ? 1 : -1), 0), entries.length - 1)
        const entry = entries[next]!
        setChecked(new Set([entry.path]))
        anchorRef.current = entry.path
        onSelect(entry)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const handleDrop = async (dt: DataTransfer) => {
    const items = await collectDropped(dt)
    if (items.length === 0) return
    if (!writable) {
      showNotice('이 폴더에 수정 권한이 없습니다')
      return
    }
    enqueueUploads(
      items.map((it) => ({ file: it.file, relDir: it.relDir })),
      path,
    )
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
    if (entries.length === 0) {
      return (
        <div className="state-box">
          <IconFolder />
          <span className="t">비어 있는 폴더</span>
          {writable && <span>파일이나 폴더를 끌어다 놓아 업로드하세요</span>}
        </div>
      )
    }
    if (view === 'grid') {
      return (
        <GridView
          entries={entries}
          selected={selected}
          checkedPaths={checked}
          onSelect={handleSelect}
          onOpen={openEntry}
          onMenu={(entry, ev) => openMenu(entry, ev)}
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
          {entries.map((entry) => {
            const readonlyDir = entry.isDir && entry.permission === 'read'
            return (
              <tr
                key={entry.path}
                className={
                  (checked.has(entry.path) ? 'sel' : '') +
                  (flashPath === entry.path ? ' flash' : '')
                }
                ref={(el) => {
                  if (el && flashPath === entry.path) el.scrollIntoView({ block: 'center' })
                }}
                onClick={(ev) => handleSelect(entry, ev)}
                onDoubleClick={() => openEntry(entry)}
                onContextMenu={(ev) => openMenu(entry, ev)}
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

  const multi = checkedEntries.length >= 2
  const allWritable = checkedEntries.every((e) => e.permission === 'write')

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
        void handleDrop(ev.dataTransfer)
      }}
    >
      <div className="m-toolbar">
        {multi ? (
          <div className="selbar">
            <span className="sel-count">{checkedEntries.length}개 선택</span>
            <button
              className="btn ghost sm"
              onClick={() => (window.location.href = zipUrl(checkedEntries.map((e) => e.path)))}
            >
              zip 다운로드
            </button>
            <button
              className="btn ghost sm"
              disabled={!allWritable}
              onClick={() => setDialog({ type: 'move', entries: checkedEntries })}
            >
              이동
            </button>
            <button
              className="btn ghost sm"
              onClick={() => setDialog({ type: 'copy', entries: checkedEntries })}
            >
              복사
            </button>
            <button
              className="btn ghost sm danger-text"
              disabled={!allWritable}
              onClick={() => setDialog({ type: 'delete', entries: checkedEntries })}
            >
              <IconTrash width={12} height={12} /> 삭제
            </button>
            <button className="btn ghost sm" onClick={() => setChecked(new Set())}>해제</button>
          </div>
        ) : (
          <span className="toggle">
            <button className={view === 'list' ? 'on' : ''} onClick={() => switchView('list')}>
              리스트
            </button>
            <button className={view === 'grid' ? 'on' : ''} onClick={() => switchView('grid')}>
              그리드
            </button>
          </span>
        )}
        <span className="m-count">{q.data ? `${entries.length} 항목` : ''}</span>
      </div>

      {body()}

      <div
        className={'m-drop' + (dragOver ? ' over' : '')}
        style={writable ? undefined : { opacity: 0.5 }}
      >
        <IconUpload />
        {writable ? '여기로 파일·폴더를 끌어다 놓으면 업로드' : '읽기 전용 폴더입니다'}
      </div>

      {menu && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onOpen={openEntry}
          onRename={(entry) => setDialog({ type: 'rename', entry })}
          onMoveCopy={(entry, mode) =>
            setDialog({ type: mode, entries: multi ? checkedEntries : [entry] })
          }
          onDelete={(entry) =>
            setDialog({ type: 'delete', entries: multi ? checkedEntries : [entry] })
          }
          onShare={(entry) => setDialog({ type: 'share', entry })}
          onVersions={(entry) => setDialog({ type: 'versions', entry })}
          onTogglePin={(entry) => void togglePin(entry.path)}
          onCopyLink={(entry) => void copyLink(entry)}
          isPinned={pinnedSet.has(menu.entry.path)}
        />
      )}

      {dialog?.type === 'rename' && (
        <RenameDialog entry={dialog.entry} onClose={() => setDialog(null)} />
      )}
      {(dialog?.type === 'move' || dialog?.type === 'copy') && (
        <MoveCopyDialog entries={dialog.entries} mode={dialog.type} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'delete' && (
        <DeleteDialog
          entries={dialog.entries}
          onClose={() => {
            setDialog(null)
            setChecked(new Set())
            onSelect(null)
          }}
        />
      )}
      {dialog?.type === 'share' && (
        <ShareDialog entry={dialog.entry} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'versions' && (
        <VersionsDialog entry={dialog.entry} onClose={() => setDialog(null)} />
      )}
      {preview && <PreviewModal entry={preview} onClose={() => setPreview(null)} />}
    </section>
  )
}
