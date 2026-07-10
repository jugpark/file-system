import { config } from '../config'

const API = 'https://discord.com/api/v10'

export interface DiscordUser {
  id: string
  username: string
  avatarUrl: string | null
}

export function authorizeUrl(state: string): string {
  const u = new URL('https://discord.com/oauth2/authorize')
  u.searchParams.set('client_id', config.discord.clientId)
  u.searchParams.set('redirect_uri', `${config.baseUrl}/api/auth/callback`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'identify')
  u.searchParams.set('state', state)
  return u.toString()
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${config.baseUrl}/api/auth/callback`,
    }),
  })
  if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status}`)
  const body = (await res.json()) as { access_token: string }
  return body.access_token
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Discord /users/@me failed: ${res.status}`)
  const u = (await res.json()) as { id: string; username: string; avatar: string | null }
  return {
    id: u.id,
    username: u.username,
    avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null,
  }
}

/**
 * 길드 멤버의 role ID 목록. 비멤버면 null.
 * 유저 OAuth 토큰으로는 서버 내 role을 조회할 수 없어 봇 토큰을 쓴다.
 */
export async function fetchMemberRoles(userId: string): Promise<string[] | null> {
  const res = await fetch(`${API}/guilds/${config.discord.guildId}/members/${userId}`, {
    headers: { authorization: `Bot ${config.discord.botToken}` },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Discord guild member fetch failed: ${res.status}`)
  const m = (await res.json()) as { roles: string[] }
  return m.roles
}
