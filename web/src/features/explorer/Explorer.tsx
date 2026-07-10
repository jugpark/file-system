import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FsEntry, ListResponse } from '@fs/shared'
import { IconFile, IconFolder, IconUpload } from '../../components/icons'
import { ApiError, api, downloadUrl } from '../../lib/api'
import { formatBytes, formatMtime } from '../../lib/format'
import { browseTo } from '../../lib/paths'
import ContextMenu, { type MenuState } from './ContextMenu'

/** UI 명세 §02-C — Explorer: 뷰 토글 · 리스트 뷰 · 드래그 앤 드롭 존 */
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
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const q = useQuery({
    queryKey: ['list', path],
    queryFn: () => api<ListResponse>(`/api/fs/list?path=${encodeURIComponent(path)}`),
  })

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2500)
    return () => clearTimeout(t)
  }, [notice])

  const openEntry = (entry: FsEntry) => {
    if (entry.isDir) navigate(browseTo(entry.path))
    else window.location.href = downloadUrl(entry.path)
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
          <span>파일을 끌어다 놓아 업로드하세요 (M2)</span>
        </div>
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
          {q.data.entries.map((entry) => (
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
                <span className={'fic' + (entry.isDir ? ' f' : '')}>
                  {entry.isDir ? <IconFolder /> : <IconFile />}
                </span>
                {entry.name}
              </td>
              {/* 마지막 수정자는 DB 메타데이터(M3)에서 연결 */}
              <td className="hidem mono">—</td>
              <td className="mono">{formatMtime(entry.mtime)}</td>
              <td className="mono">{entry.isDir ? '—' : formatBytes(entry.size)}</td>
            </tr>
          ))}
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
        setNotice('업로드는 M2에서 제공됩니다')
      }}
    >
      <div className="m-toolbar">
        <span className="toggle">
          <button className="on">리스트</button>
          <button disabled title="그리드 뷰는 M4에서 제공됩니다">그리드</button>
        </span>
        <span className="m-count">{q.data ? `${q.data.entries.length} 항목` : ''}</span>
      </div>

      {body()}

      <div className={'m-drop' + (dragOver ? ' over' : '')}>
        <IconUpload />
        여기로 파일을 끌어다 놓으면 업로드
      </div>

      {menu && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onOpen={openEntry}
          onNotice={setNotice}
        />
      )}
      {notice && <div className="notice">{notice}</div>}
    </section>
  )
}
