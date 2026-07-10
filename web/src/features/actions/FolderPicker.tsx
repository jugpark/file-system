import { useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import type { TreeResponse } from '@fs/shared'
import { IconFolder } from '../../components/icons'
import { api } from '../../lib/api'

/** 이동/복사 대상 폴더 선택 — 트리 API로 하위 폴더를 탐색하며 내려간다 */
export default function FolderPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (path: string) => void
}) {
  const [cur, setCur] = useState(value)
  const { data } = useQuery({
    queryKey: ['tree', cur],
    queryFn: () => api<TreeResponse>(`/api/fs/tree?path=${encodeURIComponent(cur)}`),
    staleTime: 30_000,
  })

  const go = (path: string) => {
    setCur(path)
    onChange(path)
  }

  const segs = cur.split('/').filter(Boolean)
  const crumbs = segs.map((name, i) => ({ name, rel: '/' + segs.slice(0, i + 1).join('/') }))

  return (
    <div>
      <div className="picker-bc">
        {crumbs.length === 0 ? <b>전체</b> : <button onClick={() => go('/')}>전체</button>}
        {crumbs.map((c, i) => (
          <Fragment key={c.rel}>
            <span className="car">›</span>
            {i === crumbs.length - 1 ? (
              <b>{c.name}</b>
            ) : (
              <button onClick={() => go(c.rel)}>{c.name}</button>
            )}
          </Fragment>
        ))}
      </div>
      <div className="picker-list">
        {data?.nodes.length === 0 && <div className="empty">하위 폴더 없음</div>}
        {data?.nodes.map((n) => (
          <button key={n.path} onClick={() => go(n.path)}>
            <IconFolder />
            {n.name}
          </button>
        ))}
      </div>
    </div>
  )
}
