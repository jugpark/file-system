import { useState } from 'react'
import type { CreateShareBody, FsEntry, ShareLinkDto } from '@fs/shared'
import Dialog from '../../components/Dialog'
import { apiJson } from '../../lib/api'
import { useOverlays } from '../overlays/Overlays'

/** R4 공유 링크 생성 — 파일 전용, 만료 필수, 다운로드 전용 */
export default function ShareDialog({ entry, onClose }: { entry: FsEntry; onClose: () => void }) {
  const { showNotice } = useOverlays()
  const [days, setDays] = useState(7)
  const [created, setCreated] = useState<ShareLinkDto | null>(null)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setBusy(true)
    try {
      const body: CreateShareBody = { path: entry.path, expiresDays: days }
      setCreated(await apiJson<ShareLinkDto>('/api/share', 'POST', body))
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '링크 생성에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!created) return
    await navigator.clipboard.writeText(created.url).catch(() => {})
    showNotice('링크를 복사했습니다')
  }

  return (
    <Dialog title={`"${entry.name}" 공유 링크`} onClose={onClose}>
      {!created ? (
        <>
          <p>링크를 아는 누구나 <b>로그인 없이 다운로드</b>할 수 있습니다. 만료 기간이 지나면 자동으로 무효가 됩니다.</p>
          <div className="form-row">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                type="button"
                className={'btn ' + (days === d ? 'primary' : 'ghost')}
                onClick={() => setDays(d)}
              >
                {d}일
              </button>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={onClose}>취소</button>
            <button type="button" className="btn primary" disabled={busy} onClick={create}>
              링크 만들기
            </button>
          </div>
        </>
      ) : (
        <>
          <input className="txt" readOnly value={created.url} onFocus={(e) => e.target.select()} />
          <div className="actions">
            <button type="button" className="btn ghost" onClick={onClose}>닫기</button>
            <button type="button" className="btn primary" onClick={copy}>복사</button>
          </div>
        </>
      )}
    </Dialog>
  )
}
