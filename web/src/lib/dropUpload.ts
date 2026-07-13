export interface DropFile {
  file: File
  /** 드롭한 위치 기준 하위 폴더 경로 (폴더째 드롭 시). 없으면 현재 폴더에 저장 */
  relDir?: string
}

interface FsEntryLike {
  isFile: boolean
  isDirectory: boolean
  name: string
  file(ok: (f: File) => void, err: (e: unknown) => void): void
  createReader(): { readEntries(ok: (es: FsEntryLike[]) => void, err: (e: unknown) => void): void }
}

/** DnD로 떨어진 파일/폴더 트리를 평탄화 (R2 폴더째 업로드) */
export async function collectDropped(dt: DataTransfer): Promise<DropFile[]> {
  const entries = Array.from(dt.items ?? [])
    .map((item) => (item.webkitGetAsEntry?.() as FsEntryLike | null) ?? null)
    .filter((e): e is FsEntryLike => e !== null)

  // webkitGetAsEntry 미지원 브라우저 → 파일만
  if (entries.length === 0) return Array.from(dt.files).map((file) => ({ file }))

  const out: DropFile[] = []
  async function walk(entry: FsEntryLike, relDir: string): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((ok, err) => entry.file(ok, err))
      out.push({ file, relDir: relDir || undefined })
      return
    }
    if (!entry.isDirectory) return
    const childDir = relDir ? `${relDir}/${entry.name}` : entry.name
    const reader = entry.createReader()
    // readEntries는 100개 단위로 끊겨 반환 — 빈 배열까지 반복
    for (;;) {
      const batch = await new Promise<FsEntryLike[]>((ok, err) => reader.readEntries(ok, err))
      if (batch.length === 0) break
      for (const child of batch) await walk(child, childDir)
    }
  }
  for (const entry of entries) await walk(entry, '')
  return out
}

/** <input webkitdirectory>로 선택된 파일 목록 → DropFile[] */
export function fromDirectoryInput(files: FileList): DropFile[] {
  return Array.from(files).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    return { file, relDir: dir || undefined }
  })
}
