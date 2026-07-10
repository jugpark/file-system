import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { FsEntry } from '@fs/shared'
import { useMe } from '../auth/useMe'
import Explorer from '../explorer/Explorer'
import InfoPanel from '../info/InfoPanel'
import Sidebar from '../sidebar/Sidebar'
import TopBar from './TopBar'

/** UI 명세 §02 — 3단 레이아웃 (LNB · Explorer · Info) */
export default function Shell() {
  const me = useMe().data!
  const params = useParams()
  const raw = '/' + (params['*'] ?? '')
  const path = raw !== '/' && raw.endsWith('/') ? raw.slice(0, -1) : raw

  const [selected, setSelected] = useState<FsEntry | null>(null)
  useEffect(() => setSelected(null), [path])

  return (
    <div className="app">
      <TopBar path={path} me={me} />
      <div className="app-body">
        <Sidebar path={path} me={me} />
        <Explorer path={path} selected={selected} onSelect={setSelected} />
        <InfoPanel entry={selected} />
      </div>
    </div>
  )
}
