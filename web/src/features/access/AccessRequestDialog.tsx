import { useState } from 'react'
import type { CreateAccessRequestBody } from '@fs/shared'
import Dialog from '../../components/Dialog'
import { ApiError, apiJson } from '../../lib/api'
import { useOverlays } from '../overlays/Overlays'

/** 못 보는/읽기전용 폴더 권한 신청 — admin 처리 큐로 들어간다 */
export default function AccessRequestDialog({
  path,
  onClose,
}: {
  path: string
  onClose: () => void
}) {
  const { showNotice } = useOverlays()
  const [permission, setPermission] = useState<'read' | 'write'>('read')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const body: CreateAccessRequestBody = { path, permission, note: note.trim() || undefined }
      await apiJson('/api/access-requests', 'POST', body)
      showNotice('접근 요청을 보냈습니다 — 관리자가 처리하면 알림이 옵니다')
      onClose()
    } catch (err) {
      // 이미 권한 있음/대기 중은 안내로 처리
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : '요청 실패'
      showNotice(msg)
      if (err instanceof ApiError && (err.code === 'ALREADY' || err.code === 'PENDING')) onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="접근 요청" onClose={onClose}>
      <p>
        <span className="mono">{path}</span> 폴더에 대한 권한을 관리자에게 요청합니다.
      </p>
      <div className="form-row">
        <select
          className="txt sm"
          value={permission}
          onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
        >
          <option value="read">읽기</option>
          <option value="write">수정</option>
        </select>
        <input
          className="txt sm"
          style={{ flex: 1 }}
          placeholder="사유 (선택) — 예: 디자인 시안 확인 필요"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onClose}>취소</button>
        <button type="button" className="btn primary" disabled={busy} onClick={submit}>
          요청 보내기
        </button>
      </div>
    </Dialog>
  )
}
