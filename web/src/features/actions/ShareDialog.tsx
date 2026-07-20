import { useState } from 'react'
import type { CreateShareBody, FsEntry, ShareLinkDto } from '@fs/shared'
import Dialog from '../../components/Dialog'
import { apiJson } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { useOverlays } from '../overlays/Overlays'

/**
 * R4 공유 링크 생성 — 만료 필수.
 * 파일 = download(받아가기) / 폴더 = upload(파일 요청 — 외부인이 이 폴더로 보냄)
 */
export default function ShareDialog({ entry, onClose }: { entry: FsEntry; onClose: () => void }) {
  const { showNotice } = useOverlays()
  const [days, setDays] = useState(7)
  const [created, setCreated] = useState<ShareLinkDto | null>(null)
  const [busy, setBusy] = useState(false)
  const isRequest = entry.isDir

  const create = async () => {
    setBusy(true)
    try {
      const body: CreateShareBody = {
        path: entry.path,
        expiresDays: days,
        kind: isRequest ? 'upload' : 'download',
      }
      setCreated(await apiJson<ShareLinkDto>('/api/share', 'POST', body))
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '링크 생성에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!created) return
    const ok = await copyText(created.url)
    showNotice(ok ? '링크를 복사했습니다' : '복사 실패 — 주소를 직접 선택해 복사하세요')
  }

  return (
    <Dialog
      title={isRequest ? `"${entry.name}" 파일 요청 링크` : `"${entry.name}" 공유 링크`}
      onClose={onClose}
    >
      {!created ? (
        <>
          <p>
            {isRequest ? (
              <>링크를 받은 사람이 <b>로그인 없이 이 폴더로 파일을 보낼</b> 수 있습니다. 기존 파일은 보이지 않고, 같은 이름은 " (1)"로 자동 회피됩니다.</>
            ) : (
              <>링크를 아는 누구나 <b>로그인 없이 다운로드</b>할 수 있습니다. 만료 기간이 지나면 자동으로 무효가 됩니다.</>
            )}
          </p>
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
