import { useQuery } from '@tanstack/react-query'
import { isImageName, type ActivityAction, type ActivityResponse, type FsEntry, type ListResponse } from '@fs/shared'
import { IconFile, IconFolder, IconLock, IconLockOpen } from '../../components/icons'
import { api, thumbnailUrl } from '../../lib/api'
import { extOf, formatBytes, formatMtime } from '../../lib/format'

const ACTION_LABEL: Record<ActivityAction, string> = {
  upload: '업로드함',
  mkdir: '폴더를 만듦',
  rename: '이름을 변경함',
  move: '이동함',
  copy: '복사본을 만듦',
  trash: '삭제함',
  restore: '복원함',
  acl_change: '권한을 변경함',
  share_create: '공유 링크를 만듦',
  share_revoke: '공유 링크를 해지함',
  version_restore: '이전 버전으로 복원함',
  settings_change: '서버 설정을 변경함',
}

/** UI 명세 §02-D — 정보·로그 패널. variant='sheet'면 <1024px 바텀 시트 내부용 */
export default function InfoPanel({
  entry,
  variant,
}: {
  entry: FsEntry | null
  variant?: 'sheet'
}) {
  const rootClass = 'info' + (variant === 'sheet' ? ' in-sheet' : '')
  // 폴더면 항목 수 표시용으로 목록을 조회 (탐색기와 캐시 공유)
  const childList = useQuery({
    queryKey: ['list', entry?.path],
    queryFn: () => api<ListResponse>(`/api/fs/list?path=${encodeURIComponent(entry!.path)}`),
    enabled: !!entry?.isDir,
    staleTime: 30_000,
  })

  // UI 명세 §02-D — 파일 생애주기 타임라인
  const activity = useQuery({
    queryKey: ['activity', entry?.path],
    queryFn: () =>
      api<ActivityResponse>(`/api/activity?path=${encodeURIComponent(entry!.path)}&limit=8`),
    enabled: !!entry,
    staleTime: 10_000,
  })

  if (!entry) {
    return (
      <aside className={rootClass}>
        <div className="placeholder">
          파일이나 폴더를 선택하면
          <br />
          정보가 표시됩니다
        </div>
      </aside>
    )
  }

  const sub = entry.isDir
    ? `폴더${childList.data ? ` · ${childList.data.entries.length}개 항목` : ''}`
    : `${extOf(entry.name)} · ${formatBytes(entry.size)}`

  return (
    <aside className={rootClass}>
      <div className="thumb" aria-hidden="true">
        {!entry.isDir && isImageName(entry.name) ? (
          <img
            src={thumbnailUrl(entry.path, 480)}
            alt=""
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        ) : entry.isDir ? (
          <IconFolder />
        ) : (
          <IconFile />
        )}
      </div>
      <h5>{entry.name}</h5>
      <div className="sub">{sub}</div>

      {entry.permission === 'write' ? (
        <span className="tag-perm ed">
          <IconLockOpen />
          수정 가능
        </span>
      ) : (
        <span className="tag-perm rd">
          <IconLock />
          읽기 전용
        </span>
      )}

      <div className="kv">
        <div className="row">
          <span className="k">경로</span>
          <span className="v">{entry.path}</span>
        </div>
        <div className="row">
          <span className="k">수정</span>
          <span className="v">{formatMtime(entry.mtime)}</span>
        </div>
        {entry.uploader && (
          <div className="row">
            <span className="k">업로더</span>
            <span className="v">@{entry.uploader}</span>
          </div>
        )}
      </div>

      <div className="m-log">
        {activity.isPending && <div className="todo">기록 불러오는 중…</div>}
        {activity.data && activity.data.items.length === 0 && (
          <div className="todo">기록된 활동이 없습니다. (직접 반입된 파일일 수 있음)</div>
        )}
        {activity.data?.items.map((item) => (
          <div className="lg" key={item.id}>
            <span className="d" aria-hidden="true" />
            <span>
              <b>@{item.actorName}</b> 님이 {ACTION_LABEL[item.action]}
              {item.action === 'rename' && typeof item.detail?.from === 'string' && (
                <> ({(item.detail.from as string).split('/').pop()} →)</>
              )}
              <br />
              <span className="tm">{formatMtime(item.createdAt)}</span>
            </span>
          </div>
        ))}
      </div>
    </aside>
  )
}
