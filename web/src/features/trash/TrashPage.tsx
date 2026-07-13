import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { TrashListResponse } from '@fs/shared'
import { IconFile, IconFolder, IconTrash } from '../../components/icons'
import { api } from '../../lib/api'
import { formatMtime } from '../../lib/format'
import { useFsActions } from '../actions/useFsActions'
import { useMe } from '../auth/useMe'
import AppLayout from '../shell/AppLayout'

/** 휴지통 — 내가 지운 것 + write 권한 범위의 항목. 복원은 원래 자리로 */
export default function TrashPage() {
  const me = useMe().data!
  const actions = useFsActions()
  const [busyId, setBusyId] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['trash'],
    queryFn: () => api<TrashListResponse>('/api/trash'),
  })

  const restore = async (id: string) => {
    setBusyId(id)
    await actions.restore([id])
    setBusyId(null)
  }

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
          </div>
        </aside>
      }
    >
      <section className="main">
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
          {q.data && q.data.items.length === 0 && (
            <div className="state-box">
              <IconTrash />
              <span className="t">휴지통이 비어 있습니다</span>
              <span>삭제한 항목은 여기서 복원할 수 있습니다</span>
            </div>
          )}
          {q.data && q.data.items.length > 0 && (
            <table className="lv">
              <thead>
                <tr>
                  <th>이름</th>
                  <th className="hidem">원래 위치</th>
                  <th>삭제한 사람</th>
                  <th>삭제 일시</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((item) => (
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
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn ghost"
                        disabled={busyId === item.id}
                        onClick={() => restore(item.id)}
                      >
                        복원
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </AppLayout>
  )
}
