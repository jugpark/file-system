import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { PurgeTrashResponse, TrashItem, TrashListResponse } from '@fs/shared'
import Dialog from '../../components/Dialog'
import { IconFile, IconFolder, IconTrash } from '../../components/icons'
import { api, apiJson } from '../../lib/api'
import { formatBytes, formatMtime } from '../../lib/format'
import { useFsActions } from '../actions/useFsActions'
import { useMe } from '../auth/useMe'
import { useOverlays } from '../overlays/Overlays'
import AppLayout from '../shell/AppLayout'

type PurgeTarget = { kind: 'one'; item: TrashItem } | { kind: 'all' } | null

/** 휴지통 — 내가 지운 것 + write 권한 범위의 항목. 복원은 원래 자리로, 영구 삭제는 admin만 */
export default function TrashPage() {
  const me = useMe().data!
  const actions = useFsActions()
  const queryClient = useQueryClient()
  const { showNotice } = useOverlays()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget>(null)
  const [purging, setPurging] = useState(false)

  const q = useQuery({
    queryKey: ['trash'],
    queryFn: () => api<TrashListResponse>('/api/trash'),
  })

  const restore = async (id: string) => {
    setBusyId(id)
    await actions.restore([id])
    setBusyId(null)
  }

  const purge = async () => {
    if (!purgeTarget) return
    setPurging(true)
    try {
      const body = purgeTarget.kind === 'one' ? { ids: [purgeTarget.item.id] } : {}
      const res = await apiJson<PurgeTrashResponse>('/api/admin/trash/purge', 'POST', body)
      showNotice(`${res.purged}개 항목을 영구 삭제했습니다`)
      queryClient.invalidateQueries({ queryKey: ['trash'] })
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '영구 삭제 실패')
    } finally {
      setPurging(false)
      setPurgeTarget(null)
    }
  }

  const items = q.data?.items ?? []

  return (
    <AppLayout
      me={me}
      path={null}
      title="휴지통"
      info={
        <aside className="info">
          <div className="placeholder">
            휴지통 항목은 원래 위치로
            <br />
            복원됩니다
            {me.isAdmin && (
              <>
                <br />
                <br />
                영구 삭제는 되돌릴 수 없습니다
              </>
            )}
          </div>
        </aside>
      }
    >
      <section className="main">
          <div className="m-toolbar">
            {me.isAdmin && items.length > 0 && (
              <button
                className="btn ghost sm danger-text"
                onClick={() => setPurgeTarget({ kind: 'all' })}
              >
                <IconTrash width={12} height={12} /> 휴지통 비우기
              </button>
            )}
            <span className="m-count">
              {q.data ? `${items.length}개 · ${formatBytes(q.data.totalBytes)}` : ''}
            </span>
          </div>
          {q.isPending && (
            <div className="sk">
              {[40, 55].map((w, i) => (
                <div className="skrow" key={i}>
                  <span className="sq" />
                  <span className="b" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          )}
          {q.data && items.length === 0 && (
            <div className="state-box">
              <IconTrash />
              <span className="t">휴지통이 비어 있습니다</span>
              <span>삭제한 항목은 여기서 복원할 수 있습니다</span>
            </div>
          )}
          {q.data && items.length > 0 && (
            <table className="lv">
              <thead>
                <tr>
                  <th>이름</th>
                  <th className="hidem">원래 위치</th>
                  <th>삭제한 사람</th>
                  <th>삭제 일시</th>
                  <th>크기</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="nm">
                      <span className={'fic' + (item.isDir ? ' f' : '')}>
                        {item.isDir ? <IconFolder /> : <IconFile />}
                      </span>
                      {item.name}
                    </td>
                    <td className="hidem mono">{item.originalPath}</td>
                    <td>
                      <span className="who"><i />@{item.deletedByName}</span>
                    </td>
                    <td className="mono">{formatMtime(item.deletedAt)}</td>
                    <td className="mono">{formatBytes(item.size)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn ghost"
                        disabled={busyId === item.id}
                        onClick={() => restore(item.id)}
                      >
                        복원
                      </button>
                      {me.isAdmin && (
                        <button
                          className="btn ghost danger-text"
                          style={{ marginLeft: 6 }}
                          onClick={() => setPurgeTarget({ kind: 'one', item })}
                        >
                          영구 삭제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {purgeTarget && (
            <Dialog
              title={purgeTarget.kind === 'all' ? '휴지통 비우기' : '영구 삭제'}
              onClose={() => setPurgeTarget(null)}
            >
              <p style={{ margin: '0 0 14px', color: 'var(--slate)', fontSize: '.88rem' }}>
                {purgeTarget.kind === 'all'
                  ? `휴지통의 ${items.length}개 항목(${formatBytes(q.data?.totalBytes ?? 0)})을 전부 영구 삭제합니다.`
                  : `"${purgeTarget.item.name}"을(를) 영구 삭제합니다.`}
                <br />이 작업은 되돌릴 수 없습니다.
              </p>
              <div className="actions">
                <button type="button" className="btn ghost" onClick={() => setPurgeTarget(null)}>
                  취소
                </button>
                <button type="button" className="btn primary" disabled={purging} onClick={purge}>
                  영구 삭제
                </button>
              </div>
            </Dialog>
          )}
      </section>
    </AppLayout>
  )
}
