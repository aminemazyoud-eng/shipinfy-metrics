import { NextResponse } from 'next/server'
import { deleteSession, COOKIE_NAME, ROLE_COOKIE_NAME } from '@/lib/auth'

export async function POST(req: Request) {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
  const token = match?.[1]

  if (token) await deleteSession(token)

  const response = NextResponse.json({ ok: true })
  response.headers.set('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
  response.headers.append('Set-Cookie', `${ROLE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
  return response
}
