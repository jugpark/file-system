import { useState, type FormEvent } from 'react'
import type { FsEntry } from '@fs/shared'
import Dialog from '../../components/Dialog'
import FolderPicker from './FolderPicker'
import { useFsActions } from './useFsActions'

export function MkdirDialog({ dirPath, onClose }: { dirPath: string; onClose: () => void }) {
  const actions = useFsActions()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const ok = await actions.mkdir(dirPath, name.trim())
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog title="새 폴더" onClose={onClose}>
      <form onSubmit={submit}>
        <input
          className="txt"
          autoFocus
          placeholder="폴더 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>만들기</button>
        </div>
      </form>
    </Dialog>
  )
}

export function RenameDialog({ entry, onClose }: { entry: FsEntry; onClose: () => void }) {
  const actions = useFsActions()
  const [name, setName] = useState(entry.name)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim() === entry.name) return onClose()
    setBusy(true)
    const ok = await actions.rename(entry.path, name.trim())
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog title="이름 바꾸기" onClose={onClose}>
      <form onSubmit={submit}>
        <input
          className="txt"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => {
            // 확장자 앞까지만 선택
            const dot = entry.name.lastIndexOf('.')
            e.target.setSelectionRange(0, !entry.isDir && dot > 0 ? dot : entry.name.length)
          }}
        />
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>변경</button>
        </div>
      </form>
    </Dialog>
  )
}

function labelFor(entries: FsEntry[]): string {
  return entries.length === 1 ? `"${entries[0]!.name}"` : `${entries.length}개 항목`
}

export function MoveCopyDialog({
  entries,
  mode,
  onClose,
}: {
  entries: FsEntry[]
  mode: 'move' | 'copy'
  onClose: () => void
}) {
  const actions = useFsActions()
  const [dest, setDest] = useState('/')
  const [busy, setBusy] = useState(false)
  const label = mode === 'move' ? '이동' : '복사'
  const paths = entries.map((e) => e.path)

  const submit = async () => {
    setBusy(true)
    const ok = mode === 'move' ? await actions.move(paths, dest) : await actions.copy(paths, dest)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog title={`${labelFor(entries)} ${label}`} onClose={onClose}>
      <FolderPicker value={dest} onChange={setDest} />
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onClose}>취소</button>
        <button type="button" className="btn primary" disabled={busy} onClick={submit}>
          여기로 {label}
        </button>
      </div>
    </Dialog>
  )
}

export function DeleteDialog({ entries, onClose }: { entries: FsEntry[]; onClose: () => void }) {
  const actions = useFsActions()
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const ok = await actions.trashPaths(entries.map((e) => e.path))
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog title="휴지통으로 이동" onClose={onClose}>
      <p>
        <b>{labelFor(entries)}</b>
        {entries.length === 1 && entries[0]!.isDir ? ' 폴더와 내용 전체를' : '을(를)'} 휴지통으로
        옮깁니다. 휴지통에서 복원할 수 있습니다.
      </p>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onClose}>취소</button>
        <button type="button" className="btn danger" disabled={busy} onClick={submit}>삭제</button>
      </div>
    </Dialog>
  )
}
