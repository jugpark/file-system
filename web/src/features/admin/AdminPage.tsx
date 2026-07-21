import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type {
  AccessRequestListResponse,
  AclRuleDto,
  AdminActivityResponse,
  BackupStatusResponse,
  ContentIndexStatusResponse,
  RoleDto,
  SettingsResponse,
  UsageResponse,
} from '@fs/shared'
import { api, apiJson } from '../../lib/api'
import { formatBytes, formatMtime } from '../../lib/format'
import { useMe } from '../auth/useMe'
import { useOverlays } from '../overlays/Overlays'
import AppLayout from '../shell/AppLayout'

const ACTION_LABELS: Record<string, string> = {
  upload: '업로드', mkdir: '폴더 생성', rename: '이름 변경', move: '이동', copy: '복사',
  trash: '삭제', restore: '복원', acl_change: '권한 변경',
  share_create: '공유 생성', share_revoke: '공유 해지', version_restore: '버전 복원',
  settings_change: '설정 변경', download: '다운로드', trash_purge: '휴지통 비움',
}

/** R3 관리 — ACL 규칙 · 스토리지 사용량 · 감사 로그 (admin 전용) */
export default function AdminPage() {
  const me = useMe().data!
  if (!me.isAdmin) return <Navigate to="/" replace />
  return (
    <AppLayout
      me={me}
      path={null}
      title="관리"
      info={
        <aside className="info">
          <div className="placeholder">모든 변경은 감사 로그에<br />기록됩니다</div>
        </aside>
      }
    >
      <section className="main">
        <AccessRequestsSection />
        <StorageSection />
        <AclSection />
        <UsageSection />
        <BackupSection />
        <ContentIndexSection />
        <AuditSection />
      </section>
    </AppLayout>
  )
}

/** 스토리지 위치 — 여기서 지정한 경로가 탐색기의 "전체" 루트가 된다 */
function StorageSection() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showNotice } = useOverlays()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const q = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api<SettingsResponse>('/api/admin/settings'),
  })

  const apply = async () => {
    const root = input.trim()
    if (!root) return
    setBusy(true)
    try {
      const res = await apiJson<SettingsResponse>('/api/admin/settings', 'PUT', {
        storageRoot: root,
      })
      // 루트가 바뀌면 모든 목록/트리/검색 캐시가 무효
      queryClient.clear()
      showNotice(`스토리지 위치 변경: ${res.storageRoot}`)
      setInput('')
      navigate('/browse/')
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '적용에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-section">
      <h3 className="page-h">스토리지 위치</h3>
      <p style={{ color: 'var(--slate)', fontSize: '.85rem', margin: '0 0 10px' }}>
        지정한 경로가 탐색기의 <b>전체</b> 루트가 되고, 그 하위 항목만 표시됩니다.
        변경 즉시 전체 사용자에게 적용되며 검색 인덱스는 새 위치 기준으로 다시 만들어집니다.
      </p>
      <div className="form-row">
        <input
          className="txt sm"
          style={{ minWidth: 280, fontFamily: 'var(--mono)' }}
          placeholder={q.data ? `현재: ${q.data.storageRoot}` : '예: C:/ 또는 /data/storage'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
        />
        <button className="btn primary sm" disabled={busy || !input.trim()} onClick={apply}>
          적용
        </button>
      </div>
      {q.data && (
        <p style={{ color: 'var(--slate-soft)', fontSize: '.74rem', marginTop: 8, fontFamily: 'var(--mono)' }}>
          현재 루트: {q.data.storageRoot}
          {q.data.indexDisabled && ' · 검색 인덱스 꺼짐(INDEX_DISABLED)'}
        </p>
      )}
    </div>
  )
}

function AclSection() {
  const queryClient = useQueryClient()
  const { showNotice } = useOverlays()
  const acl = useQuery({
    queryKey: ['admin-acl'],
    queryFn: () => api<{ rules: AclRuleDto[] }>('/api/admin/acl'),
  })
  const roles = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api<{ roles: RoleDto[] }>('/api/admin/roles'),
    staleTime: 5 * 60 * 1000,
  })
  const roleName = (id: string) => roles.data?.roles.find((r) => r.id === id)?.name ?? id

  const [prefix, setPrefix] = useState('')
  const [roleId, setRoleId] = useState('')
  const [perm, setPerm] = useState<'read' | 'write'>('read')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-acl'] })

  const add = async () => {
    if (!prefix.trim() || !roleId) return showNotice('폴더 경로와 role을 선택하세요')
    setBusy(true)
    try {
      await apiJson('/api/admin/acl', 'POST', {
        pathPrefix: prefix.trim(),
        roleId,
        permission: perm,
        note: note.trim() || undefined,
      })
      setPrefix(''); setNote('')
      invalidate()
      showNotice('규칙을 추가했습니다')
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '추가 실패')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    try {
      await api<void>(`/api/admin/acl/${id}`, { method: 'DELETE' })
      invalidate()
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  return (
    <div className="admin-section">
      <h3 className="page-h">폴더 권한 (ACL)</h3>
      <table className="lv">
        <thead>
          <tr><th>폴더</th><th>Role</th><th>권한</th><th className="hidem">메모</th><th></th></tr>
        </thead>
        <tbody>
          {acl.data?.rules.map((r) => (
            <tr key={r.id}>
              <td className="nm mono">{r.pathPrefix}</td>
              <td>{roleName(r.roleId)}</td>
              <td>
                <span className={'tag-perm ' + (r.permission === 'write' ? 'ed' : 'rd')}>
                  {r.permission === 'write' ? '수정 가능' : '읽기 전용'}
                </span>
              </td>
              <td className="hidem mono">{r.note ?? '—'}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn ghost sm" onClick={() => remove(r.id)}>삭제</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-row">
        <input className="txt sm" placeholder="/design" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        <select className="txt sm" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">role 선택</option>
          {roles.data?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select className="txt sm" value={perm} onChange={(e) => setPerm(e.target.value as 'read' | 'write')}>
          <option value="read">읽기 전용</option>
          <option value="write">수정 가능</option>
        </select>
        <input className="txt sm" placeholder="메모 (선택)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary sm" disabled={busy} onClick={add}>추가</button>
      </div>
    </div>
  )
}

function UsageSection() {
  const usage = useQuery({
    queryKey: ['admin-usage'],
    queryFn: () => api<UsageResponse>('/api/admin/usage'),
  })
  if (!usage.data) return null
  const { totalBytes, freeBytes, folders } = usage.data
  const usedPct = Math.round(((totalBytes - freeBytes) / totalBytes) * 100)
  return (
    <div className="admin-section">
      <h3 className="page-h">스토리지 사용량</h3>
      <div className="gauge big"><i style={{ width: `${usedPct}%` }} /></div>
      <p className="tight" style={{ color: 'var(--slate)', fontSize: '.85rem', margin: '8px 0 14px' }}>
        사용 {usedPct}% · 여유 {formatBytes(freeBytes)} / 전체 {formatBytes(totalBytes)}
      </p>
      <table className="lv">
        <thead><tr><th>최상위 폴더</th><th>파일 합계</th></tr></thead>
        <tbody>
          {folders?.map((f) => (
            <tr key={f.path}>
              <td className="nm mono">{f.path}</td>
              <td className="mono">{formatBytes(f.bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 접근 요청 처리 큐 — 대기 요청 승인/반려 (실제 ACL은 아래 규칙 표에서 추가) */
function AccessRequestsSection() {
  const queryClient = useQueryClient()
  const { showNotice } = useOverlays()
  const [busy, setBusy] = useState(false)
  const q = useQuery({
    queryKey: ['admin-access-requests'],
    queryFn: () => api<AccessRequestListResponse>('/api/admin/access-requests'),
    refetchInterval: 60_000,
  })
  const pending = (q.data?.requests ?? []).filter((r) => r.status === 'pending')

  const resolve = async (id: number, approve: boolean) => {
    setBusy(true)
    try {
      await apiJson(`/api/admin/access-requests/${id}/resolve`, 'POST', { approve })
      showNotice(approve ? '승인 처리했습니다 — 아래 ACL 규칙에 권한을 추가하세요' : '반려했습니다')
      queryClient.invalidateQueries({ queryKey: ['admin-access-requests'] })
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '처리 실패')
    } finally {
      setBusy(false)
    }
  }

  // 대기 요청이 없으면 섹션 자체를 숨겨 관리 화면을 어지럽히지 않는다
  if (pending.length === 0) return null

  return (
    <div className="admin-section">
      <h3 className="page-h">접근 요청 <span className="tag-perm ed mini">{pending.length}</span></h3>
      <p style={{ color: 'var(--slate)', fontSize: '.85rem', margin: '0 0 10px' }}>
        승인해도 자동 부여되지 않습니다(권한은 role 기반) — 승인 후 아래 <b>폴더 권한(ACL)</b>에서
        해당 폴더·role에 규칙을 추가하세요.
      </p>
      <table className="lv">
        <thead>
          <tr><th>요청자</th><th>폴더</th><th>권한</th><th className="hidem">사유</th><th></th></tr>
        </thead>
        <tbody>
          {pending.map((r) => (
            <tr key={r.id}>
              <td><span className="who"><i />@{r.requesterName}</span></td>
              <td className="nm mono">{r.path}</td>
              <td>
                <span className={'tag-perm ' + (r.permission === 'write' ? 'ed' : 'rd')}>
                  {r.permission === 'write' ? '수정' : '읽기'}
                </span>
              </td>
              <td className="hidem">{r.note ?? '—'}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn primary sm" disabled={busy} onClick={() => resolve(r.id, true)}>승인</button>{' '}
                <button className="btn ghost sm" disabled={busy} onClick={() => resolve(r.id, false)}>반려</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 백업 상태 — backup.sh가 남긴 마지막 실행 결과 */
function BackupSection() {
  const q = useQuery({
    queryKey: ['admin-backup-status'],
    queryFn: () => api<BackupStatusResponse>('/api/admin/backup-status'),
  })
  if (!q.data) return null
  const d = q.data
  return (
    <div className="admin-section">
      <h3 className="page-h">백업 상태</h3>
      {!d.known ? (
        <p style={{ color: 'var(--slate)', fontSize: '.85rem', margin: 0 }}>
          아직 백업 기록이 없습니다 — <span className="mono">deploy/backup.sh</span>를 cron에 등록하세요.
        </p>
      ) : (
        <p className="tight" style={{ fontSize: '.85rem', margin: 0, color: 'var(--slate)' }}>
          <span className={'tag-perm ' + (d.ok ? 'rd' : 'ed')} style={{ marginRight: 8 }}>
            {d.ok ? '성공' : '실패'}
          </span>
          마지막 백업 {d.at ? formatMtime(d.at) : '—'}
          {d.ok && d.size ? ` · 크기 ${d.size}` : ''}
          {!d.ok && d.error ? ` · ${d.error}` : ''}
        </p>
      )}
    </div>
  )
}

/** 문서 내용 검색 인덱스 — 추출 상태·큐·실패 목록 */
function ContentIndexSection() {
  const queryClient = useQueryClient()
  const { showNotice } = useOverlays()
  const [busy, setBusy] = useState(false)
  const q = useQuery({
    queryKey: ['admin-content-index'],
    queryFn: () => api<ContentIndexStatusResponse>('/api/admin/content-index'),
    // 추출이 돌고 있으면 잠깐씩 따라가며 갱신
    refetchInterval: (query) => (query.state.data?.pending ? 3000 : false),
  })
  if (!q.data) return null
  const d = q.data

  const retry = async () => {
    setBusy(true)
    try {
      const res = await apiJson<{ retried: number }>('/api/admin/content-index/retry', 'POST', {})
      showNotice(res.retried > 0 ? `${res.retried}건 재추출을 시작했습니다` : '재시도할 실패 항목이 없습니다')
      queryClient.invalidateQueries({ queryKey: ['admin-content-index'] })
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '재시도 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-section">
      <h3 className="page-h">내용 검색 인덱스</h3>
      {!d.enabled ? (
        <p style={{ color: 'var(--slate)', fontSize: '.85rem', margin: 0 }}>
          내용 검색이 꺼져 있습니다 (CONTENT_SEARCH_DISABLED 또는 INDEX_DISABLED)
        </p>
      ) : (
        <>
          <p className="tight" style={{ color: 'var(--slate)', fontSize: '.85rem', margin: '0 0 10px' }}>
            추출 완료 <b>{d.counts.ok}</b>건 · 크기 초과 생략 {d.counts.skipped}건 · 실패{' '}
            {d.counts.error}건
            {d.pending > 0 && <> · <b>추출 대기 {d.pending}건…</b></>}
          </p>
          {d.errors.length > 0 && (
            <>
              <table className="lv">
                <thead>
                  <tr><th>실패 파일</th><th className="hidem">사유</th><th>시각</th></tr>
                </thead>
                <tbody>
                  {d.errors.map((e) => (
                    <tr key={e.path}>
                      <td className="nm mono">{e.path}</td>
                      <td className="hidem mono">{e.error ?? '—'}</td>
                      <td className="mono">{formatMtime(e.indexedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="form-row" style={{ marginTop: 10 }}>
                <button className="btn primary sm" disabled={busy} onClick={retry}>
                  실패 전부 재시도
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function AuditSection() {
  const [action, setAction] = useState('')
  const audit = useQuery({
    queryKey: ['admin-activity', action],
    queryFn: () =>
      api<AdminActivityResponse>(`/api/admin/activity?limit=100${action ? `&action=${action}` : ''}`),
  })
  return (
    <div className="admin-section">
      <h3 className="page-h">감사 로그</h3>
      <div className="form-row" style={{ marginBottom: 10 }}>
        <select className="txt sm" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">모든 액션</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <table className="lv">
        <thead><tr><th>시간</th><th>유저</th><th>액션</th><th className="hidem">경로</th></tr></thead>
        <tbody>
          {audit.data?.items.map((item) => (
            <tr key={item.id}>
              <td className="mono">{formatMtime(item.createdAt)}</td>
              <td><span className="who"><i />@{item.actorName}</span></td>
              <td>{ACTION_LABELS[item.action] ?? item.action}</td>
              <td className="hidem mono">{item.path}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
