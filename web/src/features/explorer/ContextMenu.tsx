import { useEffect } from 'react'
import type { FsEntry } from '@fs/shared'
import {
  IconCopy,
  IconDownload,
  IconInfo,
  IconOpen,
  IconPencil,
  IconTrash,
} from '../../components/icons'
import { downloadUrl } from '../../lib/api'

export interface MenuState {
  x: number
  y: number
  entry: FsEntry
}

/** UI 명세 §3.3 — 우클릭 컨텍스트 메뉴. 수정 계열은 write 권한일 때만 활성 */
export default function ContextMenu({
  state,
  onClose,
  onOpen,
  onRename,
  onMoveCopy,
  onDelete,
}: {
  state: MenuState
  onClose: () => void
  onOpen: (e: FsEntry) => void
  onRename: (e: FsEntry) => void
  onMoveCopy: (e: FsEntry, mode: 'move' | 'copy') => void
  onDelete: (e: FsEntry) => void
}) {
  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const { entry } = state
  const writable = entry.permission === 'write'
  const left = Math.min(state.x, window.innerWidth - 220)
  const top = Math.min(state.y, window.innerHeight - 270)
  const via = (fn: () => void) => () => {
    onClose()
    fn()
  }

  return (
    <div
      className="ctx"
      role="menu"
      aria-label="파일 컨텍스트 메뉴"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button role="menuitem" onClick={via(() => onOpen(entry))}>
        <IconOpen className="ci" />열기
      </button>
      <button
        role="menuitem"
        disabled={entry.isDir}
        onClick={via(() => {
          window.location.href = downloadUrl(entry.path)
        })}
      >
        <IconDownload className="ci" />다운로드
      </button>
      <button role="menuitem" disabled={!writable} onClick={via(() => onRename(entry))}>
        <IconPencil className="ci" />이름 바꾸기<span className="note">수정 권한</span>
      </button>
      <button role="menuitem" onClick={via(() => onMoveCopy(entry, writable ? 'move' : 'copy'))}>
        <IconCopy className="ci" />이동 / 복사
      </button>
      <button role="menuitem" onClick={onClose}>
        <IconInfo className="ci" />정보 보기
      </button>
      <div className="div" role="separator" />
      <button className="del" role="menuitem" disabled={!writable} onClick={via(() => onDelete(entry))}>
        <IconTrash className="ci" />삭제<span className="note">휴지통으로</span>
      </button>
    </div>
  )
}
