import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { IconUpload } from '../../components/icons'

/**
 * 우측 하단 토스트 스택 — UI 명세 §3.2 업로드 진행률 토스트 + 일반 알림.
 * 업로드는 XHR로 보내 progress 이벤트를 받는다.
 */

interface UploadItem {
  id: string
  name: string
  size: number
  loaded: number
  status: 'uploading' | 'done' | 'error'
  error?: string
}

interface OverlaysApi {
  showNotice: (msg: string) => void
  enqueueUploads: (files: File[], dirPath: string) => void
}

const Ctx = createContext<OverlaysApi | null>(null)

export function useOverlays(): OverlaysApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('OverlaysProvider 밖에서 useOverlays 호출')
  return v
}

function fmtMb(n: number): string {
  return (n / 1024 / 1024).toFixed(1)
}

export function OverlaysProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 3000)
  }, [])

  const patch = (id: string, p: Partial<UploadItem>) =>
    setUploads((items) => items.map((it) => (it.id === id ? { ...it, ...p } : it)))
  const drop = (id: string, delay: number) =>
    setTimeout(() => setUploads((items) => items.filter((it) => it.id !== id)), delay)

  const enqueueUploads = useCallback(
    (files: File[], dirPath: string) => {
      for (const file of files) {
        const id = crypto.randomUUID()
        setUploads((items) => [
          ...items,
          { id, name: file.name, size: file.size, loaded: 0, status: 'uploading' },
        ])
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/api/fs/upload?path=${encodeURIComponent(dirPath)}`)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) patch(id, { loaded: e.loaded, size: e.total })
        }
        xhr.onload = () => {
          if (xhr.status < 300) {
            patch(id, { status: 'done', loaded: file.size })
            queryClient.invalidateQueries({ queryKey: ['list'] })
            queryClient.invalidateQueries({ queryKey: ['tree'] })
            queryClient.invalidateQueries({ queryKey: ['recent'] })
            drop(id, 2500)
          } else {
            let msg = `업로드 실패 (${xhr.status})`
            try {
              msg = JSON.parse(xhr.responseText).error.message
            } catch {
              /* 기본 메시지 유지 */
            }
            patch(id, { status: 'error', error: msg })
            drop(id, 5000)
          }
        }
        xhr.onerror = () => {
          patch(id, { status: 'error', error: '네트워크 오류' })
          drop(id, 5000)
        }
        const fd = new FormData()
        fd.append('file', file)
        xhr.send(fd)
      }
    },
    [queryClient],
  )

  return (
    <Ctx.Provider value={{ showNotice, enqueueUploads }}>
      {children}
      <div className="toasts">
        {uploads.map((u) => {
          const pct = u.size > 0 ? Math.round((u.loaded / u.size) * 100) : 0
          return (
            <div key={u.id} className={'toast' + (u.status === 'error' ? ' err' : '')}>
              <div className="th">
                <IconUpload />
                {u.status === 'uploading' ? '업로드 중' : u.status === 'done' ? '업로드 완료' : '업로드 실패'}
                <span className="fn">{u.name}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${u.status === 'done' ? 100 : pct}%` }} />
              </div>
              <div className="pc">
                {u.status === 'error'
                  ? u.error
                  : `${pct}% · ${fmtMb(u.loaded)} / ${fmtMb(u.size)} MB`}
              </div>
            </div>
          )
        })}
        {notice && <div className="toast notice-toast">{notice}</div>}
      </div>
    </Ctx.Provider>
  )
}
