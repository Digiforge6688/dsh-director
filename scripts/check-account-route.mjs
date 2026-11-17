#!/usr/bin/env node
/**
 * 账户代理的确定性回归（2026-11-13 面板 v3）。
 *
 * 面板新增「注册/登录/退出/额度」之后，最危险的两种错法是：
 *  1. access_token 被顺带回给浏览器（令牌本该只在 Host 侧）；
 *  2. 登出只清内存、不清凭证文件（"退出"之后旧令牌还能用）。
 *
 * 用本地假后端把这两条钉死，不碰真 ZipX、不创建任何账号。
 * 用法：node scripts/check-account-route.mjs
 */
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 本地回归：把这个 peer 指到桩（真实运行时由 Host 提供）。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: new URL('./dsh-tools-stub.mjs', import.meta.url).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const lib = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)

let validToken = 'tok-123'
const seen = []
const backend = createServer((req, res) => {
  seen.push(req.method + ' ' + req.url + ' auth=' + String(req.headers.authorization || '-'))
  const url = String(req.url || '')
  const auth = String(req.headers.authorization || '')
  function json(status, body) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (url === '/api/v1/auth/login') {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw) } catch { body = {} }
      if (body.password !== 'good') { json(401, { detail: { code: 'bad_credentials', message: '邮箱或密码错误' } }); return }
      json(200, { access_token: validToken, token_type: 'bearer', user: { id: 7, name: 'tester', email: 'tester@example.com' } })
    })
    return
  }
  if (url === '/api/v1/auth/register') { json(200, { access_token: validToken, user: { id: 8, name: 'newbie', email: 'new@example.com' } }); return }
  if (url === '/api/v1/auth/me') {
    if (auth !== 'Bearer ' + validToken) { json(401, { detail: '未登录' }); return }
    json(200, { id: 7, name: 'tester', email: 'tester@example.com', credits: 42, role: 'user' })
    return
  }
  if (url === '/api/v1/credits/balance') {
    if (auth !== 'Bearer ' + validToken) { json(401, { detail: '未登录' }); return }
    json(200, { balance: 42, total_recharged: 10, total_bonus: 5, total_consumed: 3 })
    return
  }
  if (url === '/api/v1/user/profile') { json(200, { id: 7, name: 'renamed' }); return }
  if (url === '/api/v1/user/change-password') { json(200, { message: '密码已修改' }); return }
  json(404, { detail: 'not found' })
})
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + backend.address().port

let stored = ''
let signedInCalls = 0
let logoutCalls = 0
const route = lib.createZipxAccountRoute({
  baseUrl: () => baseUrl,
  token: () => stored,
  onToken: (token, identity) => { stored = token; signedInCalls += 1; seen.push('onToken ' + identity) },
  onLogout: () => { stored = ''; logoutCalls += 1 },
})

const front = createServer((req, res) => { route.handler(req, res) })
await new Promise(resolve => front.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + front.address().port

const failures = []
function check(ok, message) { if (!ok) failures.push(message) }

async function get(path) {
  const res = await fetch(origin + path)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, text, json }
}
async function send(path, method, body) {
  const res = await fetch(origin + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = null }
  return { status: res.status, text, json }
}

// 1) 未登录
const status0 = await get('/zipx-account/status')
check(status0.status === 200 && status0.json && status0.json.connected === false, '未登录时 status.connected 应为 false：' + status0.text)
const me0 = await get('/zipx-account/me')
check(me0.status === 200 && me0.json && me0.json.ok === false && me0.json.code === 'not_signed_in', '未登录时 /me 应回 ok:false/not_signed_in：' + me0.text)

// 2) 密码错误：401 + 人话；不写入令牌
const bad = await send('/zipx-account/login', 'POST', { email: 'tester@example.com', password: 'wrong' })
check(bad.status === 401, '密码错误应回 401，实际 ' + bad.status)
check(bad.json && String(bad.json.message || '').includes('邮箱或密码错误'), '错误应带人话：' + bad.text)
check(stored === '', '密码错误时不该写入令牌：' + stored)
check(!bad.text.includes('access_token'), '错误响应里不该出现 access_token')

// 3) 登录成功：令牌留在 Host，浏览器只拿 user
const ok = await send('/zipx-account/login', 'POST', { email: 'tester@example.com', password: 'good' })
check(ok.status === 200 && ok.json && ok.json.ok === true, '登录应成功：' + ok.text)
check(!ok.text.includes('access_token'), '登录响应不该把 access_token 回给浏览器：' + ok.text)
check(!ok.text.includes(validToken), '登录响应不该出现令牌明文')
check(stored === validToken, '令牌应写回 Host 侧（onToken）：' + stored)
check(signedInCalls === 1, 'onToken 应被调用一次，实际 ' + signedInCalls)

// 4) 登录后：状态、身份、额度都带 Host 侧令牌
const status1 = await get('/zipx-account/status')
check(status1.json && status1.json.connected === true, '登录后 status.connected 应为 true')
const me1 = await get('/zipx-account/me')
check(me1.status === 200 && me1.json && me1.json.credits === 42, '登录后 /me 应拿到账号信息：' + me1.text)
const credits = await get('/zipx-account/credits')
check(credits.status === 200 && credits.json && credits.json.total_recharged === 10, '额度应透传：' + credits.text)

// 5) 资料与改密
const profile = await send('/zipx-account/profile', 'PUT', { name: 'renamed' })
check(profile.status === 200 && profile.json && profile.json.name === 'renamed', '改资料应透传：' + profile.text)
const pwd = await send('/zipx-account/change-password', 'POST', { old_password: 'good', new_password: 'next' })
check(pwd.status === 200, '改密码应透传：' + pwd.text)

// 6) 退出：Host 侧清令牌，之后 /me 立刻变成未登录
const out = await send('/zipx-account/logout', 'POST', {})
check(out.status === 200 && logoutCalls === 1, '退出应回调 onLogout 一次')
const me2 = await get('/zipx-account/me')
check(me2.json && me2.json.ok === false && me2.json.code === 'not_signed_in', '退出后 /me 应立刻回未登录：' + me2.text)

// 7) 白名单外一律 404（不要把 /api/v1 整段暴露出去）
const unknown = await get('/zipx-account/files/download?file_path=x')
check(unknown.status === 404, '白名单外路径应 404，实际 ' + unknown.status + ' ' + unknown.text)

front.close()
backend.close()

if (failures.length > 0) {
  for (const message of failures) console.log('FAIL  ' + message)
  process.exit(1)
}
console.log('[zipx] account route ok: 令牌不外泄 / 登录态 / 额度 / 退出即失效 / 白名单外 404')
