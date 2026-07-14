import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type {
  AclRuleDto,
  AdminActivityResponse,
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
  settings_change: '설정 변경',
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
        <StorageSection />
        <AclSection />
        <UsageSection />
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
