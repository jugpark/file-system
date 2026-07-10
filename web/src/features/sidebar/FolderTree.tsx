import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TreeNode, TreeResponse } from '@fs/shared'
import { api } from '../../lib/api'
import { browseTo } from '../../lib/paths'

function useTree(path: string, enabled = true) {
  return useQuery({
    queryKey: ['tree', path],
    queryFn: () => api<TreeResponse>(`/api/fs/tree?path=${encodeURIComponent(path)}`),
    staleTime: 30_000,
    enabled,
  })
}

/** 아코디언 폴더 트리 — 펼칠 때 하위 1단계를 lazy 로드 */
export default function FolderTree({
  path,
  currentPath,
  excludeNames,
}: {
  path: string
  currentPath: string
  excludeNames?: string[]
}) {
  const { data, isPending } = useTree(path)

  if (isPending) {
    return (
      <div className="sk">
        <div className="skrow"><span className="b" style={{ width: '70%' }} /></div>
        <div className="skrow"><span className="b" style={{ width: '55%' }} /></div>
      </div>
    )
  }
  if (!data) return null

  const nodes = data.nodes.filter((n) => !excludeNames?.includes(n.name))
  return (
    <>
      {nodes.map((n) => (
        <TreeRow key={n.path} node={n} currentPath={currentPath} />
      ))}
    </>
  )
}

function TreeRow({ node, currentPath }: { node: TreeNode; currentPath: string }) {
  const navigate = useNavigate()
  const isCurrent = currentPath === node.path
  const isAncestor = isCurrent || currentPath.startsWith(node.path + '/')
  const [open, setOpen] = useState(isAncestor)
  // 다른 경로에서 이 노드 아래로 이동해 오면 자동으로 펼친다
  useEffect(() => {
    if (isAncestor) setOpen(true)
  }, [isAncestor])

  return (
    <div>
      <div className={'tree-row' + (isCurrent ? ' on' : '')}>
        <button
          className={'tree-arw' + (node.hasChildren ? '' : ' leaf')}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? '접기' : '펼치기'}
          aria-expanded={open}
        >
          {open ? '▾' : '▸'}
        </button>
        <button className="tree-name" onClick={() => navigate(browseTo(node.path))}>
          {node.name}
        </button>
      </div>
      {open && node.hasChildren && (
        <div className="tree-children">
          <FolderTree path={node.path} currentPath={currentPath} />
        </div>
      )}
    </div>
  )
}
