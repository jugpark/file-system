import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FsEntry, VersionListResponse } from '@fs/shared'
import Dialog from '../../components/Dialog'
import { api, apiJson } from '../../lib/api'
import { formatBytes, formatMtime } from '../../lib/format'
import { useOverlays } from '../overlays/Overlays'

/** R4 버전 기록 — 같은 이름 덮어쓰기로 보관된 이전본 열람/복원 */
export default function VersionsDialog({ entry, onClose }: { entry: FsEntry; onClose: () => void }) {
  const { showNotice } = useOverlays()
  const queryClient = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['versions', entry.path],
    queryFn: () =>
      api<VersionListResponse>(`/api/fs/versions?path=${encodeURIComponent(entry.path)}`),
  })

  const restore = async (id: string) => {
    setBusyId(id)
    try {
      await apiJson('/api/fs/versions/restore', 'POST', { path: entry.path, id })
      queryClient.invalidateQueries({ queryKey: ['list'] })
      queryClient.invalidateQueries({ queryKey: ['versions', entry.path] })
      queryClient.invalidateQueries({ queryKey: ['activity'] })
      showNotice('이전 버전으로 복원했습니다 (현재본은 버전으로 보관)')
      onClose()
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '복원에 실패했습니다')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog title={`"${entry.name}" 버전 기록`} onClose={onClose}>
      {q.isPending && <p>불러오는 중…</p>}
      {q.data && q.data.versions.length === 0 && (
        <p>보관된 이전 버전이 없습니다. 같은 이름으로 다시 업로드하면 기존본이 자동 보관됩니다.</p>
      )}
      {q.data && q.data.versions.length > 0 && (
        <div className="ver-list">
          {q.data.versions.map((v) => (
            <div className="ver-row" key={v.id}>
              <span className="ver-time">{formatMtime(v.mtime)}</span>
              <span className="ver-size">{formatBytes(v.size)}</span>
              <a
                className="btn ghost sm"
                href={`/api/fs/versions/download?path=${encodeURIComponent(entry.path)}&id=${encodeURIComponent(v.id)}`}
              >
                받기
              </a>
              {entry.permission === 'write' && (
                <button
                  className="btn primary sm"
                  disabled={busyId === v.id}
                  onClick={() => restore(v.id)}
                >
                  복원
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onClose}>닫기</button>
      </div>
    </Dialog>
  )
}
