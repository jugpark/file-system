import { useEffect } from 'react'
import type { FsEntry } from '@fs/shared'
import {
  IconClock,
  IconCopy,
  IconDownload,
  IconInfo,
  IconOpen,
  IconPencil,
  IconTrash,
} from '../../components/icons'
import { downloadUrl, zipUrl } from '../../lib/api'

export interface MenuState {
  x: number
  y: number
  entry: FsEntry
}

/** UI 명세 §3.3 + 확장(공유·버전·즐겨찾기). 수정 계열은 write 권한일 때만 활성 */
export default function ContextMenu({
  state,
  onClose,
  onOpen,
  onRename,
  onMoveCopy,
  onDelete,
  onShare,
  onVersions,
  onTogglePin,
  onCopyLink,
  onToggleSubscribe,
  isPinned,
  isSubscribed,
}: {
  state: MenuState
  onClose: () => void
  onOpen: (e: FsEntry) => void
  onRename: (e: FsEntry) => void
  onMoveCopy: (e: FsEntry, mode: 'move' | 'copy') => void
  onDelete: (e: FsEntry) => void
  onShare: (e: FsEntry) => void
  onVersions: (e: FsEntry) => void
  onTogglePin: (e: FsEntry) => void
  onCopyLink: (e: FsEntry) => void
  onToggleSubscribe: (e: FsEntry) => void
  isPinned: boolean
  isSubscribed: boolean
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
  const top = Math.min(state.y, window.innerHeight - 380)
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
        onClick={via(() => {
          window.location.href = entry.isDir ? zipUrl([entry.path]) : downloadUrl(entry.path)
        })}
      >
        <IconDownload className="ci" />다운로드{entry.isDir && <span className="note">zip</span>}
      </button>
      <button role="menuitem" disabled={!writable} onClick={via(() => onRename(entry))}>
        <IconPencil className="ci" />이름 바꾸기<span className="note">수정 권한</span>
      </button>
      <button role="menuitem" onClick={via(() => onMoveCopy(entry, writable ? 'move' : 'copy'))}>
        <IconCopy className="ci" />이동 / 복사
      </button>
      <button role="menuitem" onClick={via(() => onTogglePin(entry))}>
        <IconInfo className="ci" />{isPinned ? '즐겨찾기 제거' : '즐겨찾기 추가'}
      </button>
      <button role="menuitem" onClick={via(() => onCopyLink(entry))}>
        <IconOpen className="ci" />링크 복사<span className="note">사내용</span>
      </button>
      {entry.isDir && (
        <button role="menuitem" onClick={via(() => onToggleSubscribe(entry))}>
          <IconClock className="ci" />{isSubscribed ? '알림 구독 해제' : '알림 구독'}
          <span className="note">DM</span>
        </button>
      )}
      {!entry.isDir && (
        <button role="menuitem" onClick={via(() => onVersions(entry))}>
          <IconClock className="ci" />버전 기록
        </button>
      )}
      <button role="menuitem" disabled={!writable} onClick={via(() => onShare(entry))}>
        <IconOpen className="ci" />
        {entry.isDir ? '파일 요청 링크' : '공유 링크'}
        <span className="note">{entry.isDir ? '외부 수신' : '외부 공유'}</span>
      </button>
      <div className="div" role="separator" />
      <button className="del" role="menuitem" disabled={!writable} onClick={via(() => onDelete(entry))}>
        <IconTrash className="ci" />삭제<span className="note">휴지통으로</span>
      </button>
    </div>
  )
}
