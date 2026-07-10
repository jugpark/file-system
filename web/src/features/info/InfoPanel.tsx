import { useQuery } from '@tanstack/react-query'
import type { FsEntry, ListResponse } from '@fs/shared'
import { IconFile, IconFolder, IconLock, IconLockOpen } from '../../components/icons'
import { api } from '../../lib/api'
import { extOf, formatBytes, formatMtime } from '../../lib/format'

/** UI 명세 §02-D — 정보·로그 패널. 활동 로그 데이터는 M3에서 연결 */
export default function InfoPanel({ entry }: { entry: FsEntry | null }) {
  // 폴더면 항목 수 표시용으로 목록을 조회 (탐색기와 캐시 공유)
  const childList = useQuery({
    queryKey: ['list', entry?.path],
    queryFn: () => api<ListResponse>(`/api/fs/list?path=${encodeURIComponent(entry!.path)}`),
    enabled: !!entry?.isDir,
    staleTime: 30_000,
  })

  if (!entry) {
    return (
      <aside className="info">
        <div className="placeholder">
          파일이나 폴더를 선택하면
          <br />
          정보가 표시됩니다
        </div>
      </aside>
    )
  }

  const sub = entry.isDir
    ? `폴더${childList.data ? ` · ${childList.data.entries.length}개 항목` : ''}`
    : `${extOf(entry.name)} · ${formatBytes(entry.size)}`

  return (
    <aside className="info">
      <div className="thumb" aria-hidden="true">
        {entry.isDir ? <IconFolder /> : <IconFile />}
      </div>
      <h5>{entry.name}</h5>
      <div className="sub">{sub}</div>

      {entry.permission === 'write' ? (
        <span className="tag-perm ed">
          <IconLockOpen />
          수정 가능
        </span>
      ) : (
        <span className="tag-perm rd">
          <IconLock />
          읽기 전용
        </span>
      )}

      <div className="kv">
        <div className="row">
          <span className="k">경로</span>
          <span className="v">{entry.path}</span>
        </div>
        <div className="row">
          <span className="k">수정</span>
          <span className="v">{formatMtime(entry.mtime)}</span>
        </div>
      </div>

      <div className="m-log">
        <div className="todo">활동 로그는 M3에서 제공됩니다.</div>
      </div>
    </aside>
  )
}
