import { Link } from 'react-router-dom'
import type { MeResponse } from '@fs/shared'
import { IconClock, IconFolder, IconPlus } from '../../components/icons'
import { browseTo } from '../../lib/paths'
import FolderTree from './FolderTree'

/** UI 명세 §02-A — LNB: 메인 액션 · 권한 기반 네비게이션 · 트리 뷰 */
export default function Sidebar({ path, me }: { path: string; me: MeResponse }) {
  const inHome = path === me.homePath || path.startsWith(me.homePath + '/')

  return (
    <aside className="lnb">
      <button className="m-new" disabled title="업로드·폴더 생성은 M2에서 제공됩니다">
        <IconPlus width={13} height={13} />
        새로 만들기
      </button>

      <nav className="m-nav">
        <Link className={inHome ? 'on' : ''} to={browseTo(me.homePath)}>
          <IconFolder />내 작업 공간
        </Link>
        <div className="nav-item disabled" title="최근 파일은 M3에서 제공됩니다">
          <IconClock />최근 파일
        </div>
      </nav>

      <div className="m-tree">
        <p className="tree-label">공유 폴더</p>
        {/* 'home'은 위의 '내 작업 공간'으로 진입하므로 트리에서 제외 */}
        <FolderTree path="/" currentPath={path} excludeNames={['home']} />
      </div>
    </aside>
  )
}
