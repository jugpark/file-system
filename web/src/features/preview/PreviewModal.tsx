import { useEffect, useState } from 'react'
import { previewKind, TEXT_PREVIEW_MAX_BYTES, type FsEntry, type PreviewTextResponse } from '@fs/shared'
import { IconChevronDown, IconDownload, IconFile } from '../../components/icons'
import { api, downloadUrl } from '../../lib/api'
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

/**
 * R2 파일 미리보기 — 이미지/PDF/동영상/오디오/텍스트/문서(오피스·한글).
 * html·svg는 서버가 inline을 거부한다. siblings가 오면 방향키/버튼으로 넘겨본다.
 */
export default function PreviewModal({
  entry,
  siblings,
  onNavigate,
  onClose,
}: {
  entry: FsEntry
  /** 같은 폴더의 미리보기 가능한 파일들 (넘겨보기용). 없으면 단일 미리보기 */
  siblings?: FsEntry[]
  onNavigate?: (e: FsEntry) => void
  onClose: () => void
}) {
  const kind = previewKind(entry.name)
  const [text, setText] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const list = siblings ?? []
  const idx = list.findIndex((e) => e.path === entry.path)
  const canNav = onNavigate && idx >= 0 && list.length > 1
  const go = (delta: number) => {
    if (!canNav) return
    const next = list[(idx + delta + list.length) % list.length]
    if (next) onNavigate!(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    setText(null)
    setTruncated(false)
    let alive = true
    if (kind === 'text') {
      fetch(inlineUrl(entry.path))
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((t) => alive && setText(t))
        .catch(() => alive && setText('(내용을 불러오지 못했습니다)'))
    } else if (kind === 'doc') {
      api<PreviewTextResponse>(`/api/fs/preview-text?path=${encodeURIComponent(entry.path)}`)
        .then((r) => {
          if (!alive) return
          setText(r.text.trim() || '(추출된 텍스트가 없습니다 — 원본을 다운로드해 확인하세요)')
          setTruncated(r.truncated)
        })
        .catch(() => alive && setText('(문서 내용을 불러오지 못했습니다)'))
    }
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
      case 'doc':
        return (
          <div className="pv-doc">
            <div className="pv-doc-note">
              문서에서 추출한 텍스트입니다. 서식·이미지는 원본을 다운로드해 확인하세요.
              {truncated && ' (길어서 일부만 표시)'}
            </div>
            <pre className="pv-text">{text ?? '불러오는 중…'}</pre>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="pv-overlay" onMouseDown={onClose}>
      {canNav && (
        <button
          className="pv-nav prev"
          onMouseDown={(e) => {
            e.stopPropagation()
            go(-1)
          }}
          aria-label="이전 파일"
        >
          <IconChevronDown className="rot90" />
        </button>
      )}
      <div className="pv-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pv-head">
          <span className="pv-name">{entry.name}</span>
          <span className="pv-meta">
            {formatBytes(entry.size)}
            {canNav && ` · ${idx + 1}/${list.length}`}
          </span>
          <a className="pv-dl" href={downloadUrl(entry.path)} title="다운로드">
            <IconDownload width={15} height={15} />
          </a>
          <button className="pv-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="pv-body">{body()}</div>
      </div>
      {canNav && (
        <button
          className="pv-nav next"
          onMouseDown={(e) => {
            e.stopPropagation()
            go(1)
          }}
          aria-label="다음 파일"
        >
          <IconChevronDown className="rot-90" />
        </button>
      )}
    </div>
  )
}
