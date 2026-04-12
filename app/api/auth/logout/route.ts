import { NextResponse } from 'next/server'
import { deleteSession } from '@/lib/auth'

const COOKIE_NAME = 'shipinfy_session'

export async function POST(req: Request) {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
  const token = match?.[1]

  if (token) await deleteSession(token)

  return NextResponse.json({ ok: true }, {
    headers: {
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    },
  })
}
