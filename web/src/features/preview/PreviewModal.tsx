import { useEffect, useState } from 'react'
import { previewKind, TEXT_PREVIEW_MAX_BYTES, type FsEntry } from '@fs/shared'
import { IconDownload, IconFile } from '../../components/icons'
import { downloadUrl } from '../../lib/api'
import { formatBytes } from '../../lib/format'

function inlineUrl(path: string): string {
  return `${downloadUrl(path)}&inline=1`
}

export function canPreview(entry: FsEntry): boolean {
  if (entry.isDir) return false
  const kind = previewKind(entry.name)
  if (!kind) return false
  if (kind === 'text' && entry.size > TEXT_PREVIEW_MAX_BYTES) return false
  return true
}

/** R2 파일 미리보기 — 이미지/PDF/동영상/오디오/텍스트. html·svg는 서버가 inline을 거부한다 */
export default function PreviewModal({ entry, onClose }: { entry: FsEntry; onClose: () => void }) {
  const kind = previewKind(entry.name)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (kind !== 'text') return
    let alive = true
    fetch(inlineUrl(entry.path))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => alive && setText(t))
      .catch(() => alive && setText('(내용을 불러오지 못했습니다)'))
    return () => {
      alive = false
    }
  }, [entry.path, kind])

  const body = () => {
    switch (kind) {
      case 'image':
        return <img className="pv-img" src={inlineUrl(entry.path)} alt={entry.name} />
      case 'pdf':
        return <iframe className="pv-frame" src={inlineUrl(entry.path)} title={entry.name} />
      case 'video':
        return <video className="pv-media" src={inlineUrl(entry.path)} controls autoPlay />
      case 'audio':
        return (
          <div className="pv-audio">
            <IconFile width={34} height={34} />
            <audio src={inlineUrl(entry.path)} controls autoPlay />
          </div>
        )
      case 'text':
        return <pre className="pv-text">{text ?? '불러오는 중…'}</pre>
      default:
        return null
    }
  }

  return (
    <div className="pv-overlay" onMouseDown={onClose}>
      <div className="pv-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pv-head">
          <span className="pv-name">{entry.name}</span>
          <span className="pv-meta">{formatBytes(entry.size)}</span>
          <a className="pv-dl" href={downloadUrl(entry.path)} title="다운로드">
            <IconDownload width={15} height={15} />
          </a>
          <button className="pv-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="pv-body">{body()}</div>
      </div>
    </div>
  )
}
