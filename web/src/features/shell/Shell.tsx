import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { FsEntry } from '@fs/shared'
import { useMe } from '../auth/useMe'
import Explorer from '../explorer/Explorer'
import InfoPanel from '../info/InfoPanel'
import AppLayout from './AppLayout'

/** UI 명세 §02 — 3단 레이아웃. <1024px에서 정보 패널은 바텀 시트로 전환 */
export default function Shell() {
  const me = useMe().data!
  const params = useParams()
  const raw = '/' + (params['*'] ?? '')
  const path = raw !== '/' && raw.endsWith('/') ? raw.slice(0, -1) : raw

  const [selected, setSelected] = useState<FsEntry | null>(null)
  useEffect(() => setSelected(null), [path])

  return (
    <AppLayout me={me} path={path} info={<InfoPanel entry={selected} />}>
      <Explorer path={path} selected={selected} onSelect={setSelected} />
      {selected && (
        <div className="sheet-overlay" onMouseDown={() => setSelected(null)}>
          <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sheet-grip" aria-hidden="true" />
            <InfoPanel entry={selected} variant="sheet" />
          </div>
        </div>
      )}
    </AppLayout>
  )
}
