import { useNavigate } from 'react-router-dom'
import type { FsEntry } from '@fs/shared'
import { IconDownload, IconFile, IconFolder } from '../../components/icons'
import { downloadUrl } from '../../lib/api'
import { formatBytes, formatMtime } from '../../lib/format'
import { browseTo } from '../../lib/paths'

function parentOf(path: string): string {
  const segs = path.split('/').filter(Boolean)
  return '/' + segs.slice(0, -1).join('/')
}

/** 검색·최근 파일 결과 공용 테이블 — 이름 클릭=열기, 위치 클릭=폴더로 이동 */
export default function EntriesTable({ entries }: { entries: FsEntry[] }) {
  const navigate = useNavigate()

  const open = (entry: FsEntry) => {
    if (entry.isDir) navigate(browseTo(entry.path))
    else window.location.href = downloadUrl(entry.path)
  }

  return (
    <table className="lv">
      <thead>
        <tr>
          <th>파일 / 폴더명</th>
          <th className="hidem">위치</th>
          <th>수정 일시</th>
          <th>크기</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.path} onDoubleClick={() => open(entry)}>
            <td className="nm" onClick={() => open(entry)} style={{ cursor: 'pointer' }}>
              <span className={'fic' + (entry.isDir ? ' f' : '')}>
                {entry.isDir ? <IconFolder /> : <IconFile />}
              </span>
              {entry.name}
            </td>
            <td className="hidem mono">
              <a
                href={browseTo(parentOf(entry.path))}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(browseTo(parentOf(entry.path)))
                }}
              >
                {parentOf(entry.path)}
              </a>
            </td>
            <td className="mono">{formatMtime(entry.mtime)}</td>
            <td className="mono">{entry.isDir ? '—' : formatBytes(entry.size)}</td>
            <td style={{ textAlign: 'right' }}>
              {!entry.isDir && (
                <a
                  href={downloadUrl(entry.path)}
                  title="다운로드"
                  aria-label={`${entry.name} 다운로드`}
                  style={{ color: 'var(--slate-soft)', display: 'inline-flex' }}
                >
                  <IconDownload width={15} height={15} />
                </a>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
