import { useSearchParams } from 'react-router-dom'
import { IconDiscord, IconFolder } from '../../components/icons'

/** UI 명세 §3.1 — 단일 액션 로그인 */
export default function LoginPage() {
  const [params] = useSearchParams()
  const error = params.get('error')

  return (
    <div className="login-stage">
      <div className="login-card">
        <div className="lo" aria-hidden="true">
          <IconFolder width={20} height={20} />
        </div>
        <h5>사내 스토리지</h5>
        <p>팀의 파일에 접근하려면 로그인하세요.</p>
        <button
          className="discord-btn"
          type="button"
          onClick={() => {
            window.location.href = '/api/auth/login'
          }}
        >
          <IconDiscord />
          Discord로 로그인
        </button>
        {error === 'not_member' && (
          <div className="login-error">사내 디스코드 서버 멤버만 접근할 수 있습니다.</div>
        )}
        {error === 'oauth' && (
          <div className="login-error">로그인에 실패했습니다. 다시 시도해 주세요.</div>
        )}
        {!error && <p className="login-note">사내 디스코드 서버 멤버만 접근할 수 있습니다.</p>}
      </div>
    </div>
  )
}
