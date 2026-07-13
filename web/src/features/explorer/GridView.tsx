import type { MouseEvent } from 'react'
import { isImageName, type FsEntry } from '@fs/shared'
import { IconFile, IconFolder, IconLock } from '../../components/icons'
import { thumbnailUrl } from '../../lib/api'

/**
 * UI 명세 §02-C 그리드 뷰 — 이미지=썸네일, 그 외=아이콘.
 * 읽기 전용 폴더는 자물쇠+흐린 색 (§04 권한 시각화).
 */
export default function GridView({
  entries,
  selected,
  onSelect,
  onOpen,
  onMenu,
}: {
  entries: FsEntry[]
  selected: FsEntry | null
  onSelect: (e: FsEntry) => void
  onOpen: (e: FsEntry) => void
  onMenu: (e: FsEntry, ev: MouseEvent) => void
}) {
  return (
    <div className="gcards">
      {entries.map((entry) => {
        const readonlyDir = entry.isDir && entry.permission === 'read'
        return (
          <div
            key={entry.path}
            className={
              'gcard' + (selected?.path === entry.path ? ' sel' : '') + (readonlyDir ? ' ro' : '')
            }
            onClick={() => onSelect(entry)}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(ev) => {
              ev.preventDefault()
              onSelect(entry)
              onMenu(entry, ev)
            }}
          >
            <div className="gthumb">
              {!entry.isDir && isImageName(entry.name) ? (
                <img
                  loading="lazy"
                  src={thumbnailUrl(entry.path)}
                  alt=""
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              ) : entry.isDir ? (
                readonlyDir ? (
                  <IconLock width={26} height={26} />
                ) : (
                  <IconFolder width={26} height={26} />
                )
              ) : (
                <IconFile width={26} height={26} />
              )}
            </div>
            <div className="gname">
              <span className={'fic' + (entry.isDir ? ' f' : '') + (readonlyDir ? ' ro' : '')}>
                {entry.isDir ? <IconFolder width={13} height={13} /> : <IconFile width={13} height={13} />}
              </span>
              <span className="nm-t" title={entry.name}>{entry.name}</span>
              {readonlyDir && <IconLock className="ro-mini" width={11} height={11} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}
