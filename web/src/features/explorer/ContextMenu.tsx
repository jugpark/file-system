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

/**
 * UI 명세 §3.3 — 우클릭 컨텍스트 메뉴.
 * 항목 구성은 명세와 동일하게 유지하고, 쓰기 동작(M2)은 비활성 상태로 노출한다.
 */
export default function ContextMenu({
  state,
  onClose,
  onOpen,
  onNotice,
}: {
  state: MenuState
  onClose: () => void
  onOpen: (e: FsEntry) => void
  onNotice: (msg: string) => void
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
  const left = Math.min(state.x, window.innerWidth - 220)
  const top = Math.min(state.y, window.innerHeight - 270)
  const m2 = () => onNotice('M2에서 제공됩니다')

  return (
    <div
      className="ctx"
      role="menu"
      aria-label="파일 컨텍스트 메뉴"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        role="menuitem"
        onClick={() => {
          onOpen(entry)
          onClose()
        }}
      >
        <IconOpen className="ci" />열기
      </button>
      <button
        role="menuitem"
        disabled={entry.isDir}
        onClick={() => {
          window.location.href = downloadUrl(entry.path)
          onClose()
        }}
      >
        <IconDownload className="ci" />다운로드
      </button>
      <button role="menuitem" disabled={entry.permission !== 'write'} onClick={m2}>
        <IconPencil className="ci" />이름 바꾸기<span className="note">수정 권한</span>
      </button>
      <button role="menuitem" onClick={m2}>
        <IconCopy className="ci" />이동 / 복사
      </button>
      <button role="menuitem" onClick={onClose}>
        <IconInfo className="ci" />정보 보기
      </button>
      <div className="div" role="separator" />
      <button className="del" role="menuitem" disabled={entry.permission !== 'write'} onClick={m2}>
        <IconTrash className="ci" />삭제<span className="note">휴지통으로</span>
      </button>
    </div>
  )
}
