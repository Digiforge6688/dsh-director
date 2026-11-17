/**
 * DSH 设备配对：把"手工造 token"换成"用户在浏览器点确认"。
 *
 * 用法：pnpm tsx integrations/zipx-plugin/pair.ts
 * 产物：~/.zipx/dialogue-token.json（0600），插件在 execute 时读取。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'

const baseUrl = (process.env.ZIPX_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')
const webUrl = (process.env.ZIPX_WEB_URL || 'http://localhost:3000').replace(/\/$/, '')
const tokenFile = process.env.ZIPX_TOKEN_FILE || join(homedir(), '.zipx', 'dialogue-token.json')

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

const started = await post('/api/v1/auth/dialogue/pair/start', {
  device_id: '',
  label: hostname(),
  client: 'dsh',
})

console.log('配对码:', started.code)
console.log('在已登录 ZipX 的浏览器中打开:')
console.log('  ' + webUrl + started.approve_path)
console.log('（10 分钟内有效，确认后本脚本自动取回凭证）')

const deadline = Date.now() + (started.expires_in ?? 600) * 1000
let token = ''
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 2000))
  const polled = await post('/api/v1/auth/dialogue/pair/poll', {
    code: started.code,
    device_id: started.device_id,
  })
  if (polled.status === 'approved' && polled.token) {
    token = polled.token
    break
  }
  if (polled.status === 'expired' || polled.status === 'revoked') {
    throw new Error(`配对失败: ${polled.status}`)
  }
}

if (!token) throw new Error('配对超时，请重新运行')

mkdirSync(dirname(tokenFile), { recursive: true })
writeFileSync(tokenFile, JSON.stringify({
  token,
  device_id: started.device_id,
  baseUrl,
  paired_at: new Date().toISOString(),
}, null, 2), { mode: 0o600 })

console.log('已保存凭证:', tokenFile)
console.log('现在可以启动 DSH:', 'pnpm dsh web --patch ./integrations/zipx-plugin/cordis.yml')
