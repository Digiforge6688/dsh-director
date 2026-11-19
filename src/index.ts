/**
 * ZipX Director —— DSH 会话插件（M1-b：只读工具）
 *
 * 把 ZipX 的只读契约（/api/v3/director/{state,preview,turn}）注册成 DSH 工具：
 *   zipx_project_state    一轮开场的权威状态卡
 *   zipx_preview_action   零成本预检（能不能做/缺什么/影响谁/替代）
 *   zipx_turn_receipt     一轮的回执 + 活动轨迹 + 报告
 *
 * 设计边界：
 * * 只读：这三个工具都不写 ZipX；写路径（dispatch）在 M2 单独加，且必须走唯一派发口。
 * * 配置来自 cordis.yml：baseUrl / token（每用户委托 token，见 v3 §2.2）/ language。
 * * 工具输出保持结构化（JSON），render 给模型一段紧凑人话，UI 卡片留给 M2 的 present。
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  metaArtifacts, metaAsset, metaBind, metaConnect, metaCost, metaDelivery, metaDispatch, metaGeneric,
  metaLocks, metaPreview, metaProjects, metaResult, metaState, metaWatch,
} from './presentation.js'

export const name = 'zipx-director'
// webServer 是 /zipx-api 同源代理的宿主：客户端面板永远拿不到 token。
// 但不做成硬依赖——headless / tui 这类没有 webServer 的 profile 仍要能拿到 23 个工具。
export const inject = ['tools']

export interface ZipxConfig {
  baseUrl?: string
  token?: string
  language?: string
  /** Headless profiles without an approval channel may opt in explicitly (never silent). */
  allowUnconfirmed?: boolean
}

interface ZipxApi {
  get(path: string): Promise<unknown>
  post(path: string, body: unknown): Promise<unknown>
  put(path: string, body: unknown): Promise<unknown>
  patch(path: string, body: unknown): Promise<unknown>
}

/** 进程内活令牌：配对成功后立刻生效，**不需要重启 DSH**（工具有的请求读一次）。 */
let liveToken = ''

/**
 * 账号令牌（2026-11-13 / P0 迁移）：内存缓存 + DSH Credentials 唯一真相。
 * 旧文件 ~/.zipx/account-token.json 只作为无 credentials 服务的降级与一次性迁移源。
 */
let accountToken = ''

/** DSH Credentials 记录（<scope>/<id>）。没有该服务时保持 null，走文件降级。 */
const CREDENTIAL_ACCOUNT_KEY = 'zipx/account'
const CREDENTIAL_BUDGET_KEY = 'zipx/budget'
let credentialService: any = null
let credentialAccountLoaded = false
let credentialToken = ''
let credentialIdentity = ''
let credentialExpiresAt = ''
let budgetCache: any = null

/** 会话 → 项目绑定（进程内缓存；唯一持久化在 ZipX 的 external_sessions）。 */
const sessionBindings = new Map<string, string>()

export type TokenSource = 'account' | 'credentials' | 'config' | 'pair' | 'env' | 'none'
export interface TokenInfo {
  token: string
  source: TokenSource
  identity?: string
  expires_at?: string
}

function tokenFile(): string {
  return process.env.ZIPX_TOKEN_FILE || join(homedir(), '.zipx', 'dialogue-token.json')
}

function accountFile(): string {
  return join(homedir(), '.zipx', 'account-token.json')
}

function readJsonFile(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 配对凭证：~/.zipx/dialogue-token.json（scripts/pair.ts 或面板配对写入）。读不到就返回空串。 */
function readPairedToken(): string {
  return String(readJsonFile(tokenFile())?.token || '')
}

/** 写入凭证（0600）。配对成功时由 /zipx-pair/connect 调用。 */
function writePairedToken(token: string, deviceId: string): void {
  const file = tokenFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ token, device_id: deviceId, saved_at: new Date().toISOString() }, null, 2), { mode: 0o600 })
}

/** JWT exp（秒）→ ISO；读不出来就是空串，不猜。 */
function jwtExpiry(token: string): string {
  try {
    const part = String(token || '').split('.')[1] || ''
    if (!part) return ''
    const raw = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const exp = Number(JSON.parse(raw)?.exp)
    return Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : ''
  } catch {
    return ''
  }
}

function setCredentialService(service: any): void {
  credentialService = service || null
}

/** 读 DSH Credentials 里的账号记录。读不到/不可用一律 null（不抛）。 */
async function readCredentialAccount(force = false): Promise<{ token: string; identity: string; expires_at: string } | null> {
  if (!credentialService) return null
  if (credentialAccountLoaded && !force) {
    return credentialToken ? { token: credentialToken, identity: credentialIdentity, expires_at: credentialExpiresAt } : null
  }
  credentialAccountLoaded = true
  try {
    const record = await credentialService.readRecord(CREDENTIAL_ACCOUNT_KEY)
    const payload = record && record.kind === 'grant' ? record.payload : null
    const token = String(payload?.token || '')
    if (!token) {
      credentialToken = ''
      credentialIdentity = ''
      credentialExpiresAt = ''
      return null
    }
    credentialToken = token
    credentialIdentity = String(payload?.identity || '')
    credentialExpiresAt = String(payload?.expires_at || jwtExpiry(token))
    return { token, identity: credentialIdentity, expires_at: credentialExpiresAt }
  } catch (error) {
    console.warn('[zipx-director] credentials read failed (falling back to file): ' + String((error as any)?.message || error))
    return null
  }
}

/** 写账号记录：唯一写路径是 modifyRecord。失败要可见，但不能拖垮登录本身。 */
async function writeCredentialAccount(token: string, identity: string): Promise<boolean> {
  if (!credentialService) return false
  const payload = { token, identity, expires_at: jwtExpiry(token), saved_at: new Date().toISOString() }
  try {
    await credentialService.modifyRecord(CREDENTIAL_ACCOUNT_KEY, () => Promise.resolve({ kind: 'grant', payload }))
    credentialToken = token
    credentialIdentity = identity
    credentialExpiresAt = String(payload.expires_at || '')
    credentialAccountLoaded = true
    return true
  } catch (error) {
    console.warn('[zipx-director] credentials write failed (file fallback kept): ' + String((error as any)?.message || error))
    return false
  }
}

/**
 * 一次性迁移：旧文件里有令牌、credentials 里没有 → 写进 credentials，再把文件改名 .migrated。
 * 失败保留文件并打 warning（下次启动再试）；没有 credentials 服务时什么都不做。
 */
async function migrateLegacyToken(): Promise<void> {
  if (!credentialService) return
  const existing = await readCredentialAccount(true)
  if (existing) return
  const legacy = readJsonFile(accountFile())
  const token = String(legacy?.token || '')
  if (!token) return
  const ok = await writeCredentialAccount(token, String(legacy?.identity || ''))
  if (!ok) return
  try {
    renameSync(accountFile(), accountFile() + '.migrated')
    console.log('[zipx-director] migrated account token to DSH credentials')
  } catch (error) {
    console.warn('[zipx-director] credentials written, but legacy file rename failed: ' + String((error as any)?.message || error))
  }
}

/** 令牌解析顺序：内存登录 → DSH Credentials → 显式配置 → 刚配对 → 环境变量 → 旧文件。 */
async function resolveTokenInfo(config: ZipxConfig): Promise<TokenInfo> {
  if (accountToken) return { token: accountToken, source: 'account', expires_at: jwtExpiry(accountToken) }
  const cred = await readCredentialAccount()
  if (cred) return { token: cred.token, source: 'credentials', identity: cred.identity, expires_at: cred.expires_at }
  if (config?.token) return { token: String(config.token), source: 'config', expires_at: jwtExpiry(String(config.token)) }
  if (liveToken) return { token: liveToken, source: 'pair', expires_at: jwtExpiry(liveToken) }
  const env = String(process.env.ZIPX_DIALOGUE_TOKEN || '')
  if (env) return { token: env, source: 'env', expires_at: jwtExpiry(env) }
  const paired = readPairedToken()
  if (paired) return { token: paired, source: 'pair', expires_at: jwtExpiry(paired) }
  return { token: '', source: 'none' }
}

async function resolveToken(config: ZipxConfig): Promise<string> {
  return (await resolveTokenInfo(config)).token
}

/** 写账号令牌：内存 → 文件（降级）→ DSH Credentials（唯一持久真相）。 */
function writeAccountToken(token: string, identity: string): void {
  accountToken = token
  const file = accountFile()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ token, identity, saved_at: new Date().toISOString() }, null, 2), { mode: 0o600 })
  } catch (error) {
    console.warn('[zipx-director] account token file write failed: ' + String((error as any)?.message || error))
  }
  void writeCredentialAccount(token, identity)
}

/** 退出登录：内存 + 两个凭证文件 + credentials 记录一起清，否则"退出"后仍能用旧令牌。 */
function clearAccountToken(): void {
  accountToken = ''
  liveToken = ''
  credentialToken = ''
  credentialIdentity = ''
  credentialExpiresAt = ''
  credentialAccountLoaded = true
  for (const file of [accountFile(), tokenFile()]) {
    try {
      rmSync(file, { force: true })
    } catch {
      /* 文件本来就不存在 */
    }
  }
  if (credentialService) {
    try {
      void credentialService.deleteRecord(CREDENTIAL_ACCOUNT_KEY).catch(() => {})
    } catch {
      /* deleteRecord 不可用不影响退出 */
    }
  }
}

/** 预算记录：perStep / daily（credits）。0 或缺失 = 不限额。 */
async function readBudget(): Promise<{ per_step: number; daily: number; spent_today: number; day: string }> {
  if (budgetCache) return budgetCache
  let payload: any = null
  if (credentialService) {
    try {
      const record = await credentialService.readRecord(CREDENTIAL_BUDGET_KEY)
      payload = record && record.kind === 'grant' ? record.payload : null
    } catch { /* 读不到就是没设预算 */ }
  }
  const today = new Date().toISOString().slice(0, 10)
  const spent = payload?.day === today ? Number(payload?.spent_today || 0) : 0
  budgetCache = {
    per_step: Math.max(0, Number(payload?.per_step || 0)),
    daily: Math.max(0, Number(payload?.daily || 0)),
    spent_today: Number.isFinite(spent) ? spent : 0,
    day: today,
  }
  return budgetCache
}

async function writeBudget(next: { per_step?: number; daily?: number }): Promise<any> {
  const current = await readBudget()
  const nextRecord = {
    per_step: Math.max(0, Number(next.per_step ?? current.per_step) || 0),
    daily: Math.max(0, Number(next.daily ?? current.daily) || 0),
    spent_today: current.day === new Date().toISOString().slice(0, 10) ? current.spent_today : 0,
    day: new Date().toISOString().slice(0, 10),
  }
  budgetCache = nextRecord
  if (credentialService) {
    try {
      await credentialService.modifyRecord(CREDENTIAL_BUDGET_KEY, () => Promise.resolve({ kind: 'grant', payload: nextRecord }))
    } catch (error) {
      console.warn('[zipx-director] budget write failed: ' + String((error as any)?.message || error))
    }
  }
  return nextRecord
}

async function chargeBudget(credits: number): Promise<void> {
  const current = await readBudget()
  const today = new Date().toISOString().slice(0, 10)
  const spent = current.day === today ? current.spent_today : 0
  budgetCache = { ...current, day: today, spent_today: spent + Math.max(0, Number(credits) || 0) }
  if (credentialService) {
    try {
      await credentialService.modifyRecord(CREDENTIAL_BUDGET_KEY, () => Promise.resolve({ kind: 'grant', payload: budgetCache }))
    } catch { /* 记账失败不影响已批准的执行 */ }
  }
}

/** 连接级失败（不是 HTTP 错误）：后端重启/端口转发抖动时 fetch 只给一句 "fetch failed"。 */
function isConnectionError(err: any): boolean {
  const msg = String(err?.message ?? '')
  const code = String(err?.cause?.code ?? err?.code ?? '')
  // 已经有 HTTP 状态的错误（后端真的回了话）不重试。
  if (err?.zipxHttp === true) return false
  if (!/fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|UND_ERR|socket hang up/i.test(msg + ' ' + code)) return false
  return !/-> HTTP \d{3}/.test(msg)
}

function client(config: ZipxConfig): ZipxApi {
  const baseUrl = String(config?.baseUrl || 'http://localhost:8000')
  async function once(path: string, init: RequestInit): Promise<unknown> {
    const token = await resolveToken(config)
    const url = new URL(path, baseUrl).toString()
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const text = await res.text()
    if (!res.ok) {
      // 2026-11-13：后端 409/403 的 detail 里本来就是**人话**（step_mismatch / advance_blocked /
      // confirm_required / channel_disabled）。此前整段 JSON 被塞进 Error，模型只能照抄一坨括
      // 号；现在优先取 detail.message（或 detail 字符串），保留 status/code 供调用方判断。
      let human = ''
      let code = ''
      try {
        const body: any = JSON.parse(text)
        const detail = body?.detail ?? body
        if (typeof detail === 'string') human = detail
        else if (detail && typeof detail === 'object') {
          human = String(detail.message ?? '')
          code = String(detail.code ?? '')
        }
      } catch { /* 非 JSON 错误体：保留原文 */ }
      const err: any = new Error(human || `ZipX ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`)
      err.zipxHttp = true
      err.status = res.status
      err.code = code
      err.bodyText = text.slice(0, 800)
      throw err
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`ZipX ${path} 返回的不是 JSON: ${text.slice(0, 200)}`)
    }
  }
  /**
   * GET 遇到连接级失败时重试：长驻 Host 进程的 keep-alive 池会在后端容器重启后
   * 留着一批死 socket，字节级错误会以「fetch failed」冒到模型面前，读不到 ≠ 后端坏了。
   * 写请求一律不重试（付费动作不能因为一次 socket 抖动被执行两遍）。
   */
  async function call(path: string, init: RequestInit): Promise<unknown> {
    const method = String(init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET') return once(path, init)
    let last: any
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await once(path, init)
      } catch (err: any) {
        last = err
        if (!isConnectionError(err) || attempt === 2) throw err
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
      }
    }
    throw last
  }
  return {
    get: path => call(path, { method: 'GET' }),
    post: (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) }),
    put: (path, body) => call(path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (path, body) => call(path, { method: 'PATCH', body: JSON.stringify(body) }),
  }
}

/** 状态卡的模型可读摘要：只搬事实，不评价。 */
function renderState(v: any): string {
  const cur = v?.current ?? {}
  const legal = Array.isArray(v?.legal_actions_human) ? v.legal_actions_human.join('、') : ''
  const gates = v?.gates?.overall ?? 'unchecked'
  // 运行锁是"正在生成"的权威信号：confirm_step 推进指针后，下一阶段在跑但还没落库时，
  // WorkState 会显示 never_started/0-1——不能据此说"没在跑"。把 is_locked 显式翻成状态。
  const running = cur?.is_locked ? '（生成中，产物尚未落库）' : ''
  const lines = [
    `项目「${v?.project?.title ?? ''}」（${v?.project?.id ?? ''}）`,
    `当前步骤：${cur.label ?? cur.step ?? ''}（${cur.step ?? ''}）— ${cur.lifecycle ?? ''}，产出 ${cur.produced ?? '?'}/${cur.expected ?? '?'}${running}`,
    `门禁总体：${gates}${cur?.gate_stale ? '（旧判决：产物在判决之后被改过，需要重新质检）' : (cur?.gate_unverified ? '（旧门禁没有内容指纹，未确认；可重新质检）' : '')}`,
    `本轮可做：${legal}`,
    v?.next_suggestion ? `建议下一步：${v.next_suggestion.label}（${v.next_suggestion.action}）` : '',
  ]
  return lines.filter(Boolean).join('\n')
}


/* ────────────────────────────────────────────────────────────────
 * /zipx-api 同源代理
 *
 * 浏览器只跟 DSH 同源说话，令牌只在 Host 侧注入：
 *   GET|POST|PUT /zipx-api/<rest>  →  <baseUrl>/api/v3/director/<rest>
 * 唯一例外是媒体字节：
 *   GET /zipx-api/files/download?file_path=…  →  <baseUrl>/api/v1/files/download?file_path=…
 * 因为 ZipX 把成片/关键帧挂在 /api/v1/files/download（支持 Range），
 * 而 /api/v3/director 下没有对应的字节路由（实测 404）。不 buffer 整包：
 * 几十 MB 的成片必须流式透传。
 * ──────────────────────────────────────────────────────────────── */

const PROXY_PATH = '/zipx-api'
/** 媒体字节白名单前缀（其余路径一律走 /api/v3/director）。 */
const MEDIA_PATH = '/files/download'
/** 请求体上限：代理只承载 JSON 指令，不承载上传。 */
const MAX_BODY_BYTES = 2 * 1024 * 1024
/** 透传的请求头（Range 是成片拖进度条的关键）。 */
const FORWARD_REQUEST_HEADERS = ['accept', 'content-type', 'range', 'if-range', 'if-none-match']
/** 透传的响应头：206/Content-Range/Accept-Ranges 原样给浏览器。 */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'accept-ranges', 'content-range', 'cache-control', 'etag', 'last-modified', 'content-disposition']

function requestIsSameOrigin(req: IncomingMessage): boolean {
  const host = String(req.headers.host || '')
  if (!host) return false
  const origin = String(req.headers.origin || '')
  const referer = String(req.headers.referer || '')
  try {
    if (origin && new URL(origin).host === host) return true
    if (referer && new URL(referer).host === host) return true
  } catch { /* malformed header */ }
  return String(req.headers['sec-fetch-site'] || '') === 'same-origin'
}

/** The Host proxy serves the local browser and the same-origin DSH page (phones on a LAN). */
function requestIsTrusted(req: IncomingMessage): boolean {
  const remote = String(req.socket?.remoteAddress || '')
  const loopback = remote === '::1' || remote === '::ffff:127.0.0.1' || remote.startsWith('127.')
  return loopback || requestIsSameOrigin(req)
}

class ProxyBodyTooLarge extends Error {}

function sendProxyJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readProxyBody(req: IncomingMessage, limit: number = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
    if (Number.isFinite(declared) && declared > limit) {
      reject(new ProxyBodyTooLarge())
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new ProxyBodyTooLarge())
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks, size)) })
    req.on('error', reject)
  })
}

/**
 * 建一条前缀路由：把 /zipx-api/* 转成 ZipX 的 API，注入配对 token。
 * @param options - 后端地址与 token 的读取函数（每次请求都重读，配对后无需重启）。
 * @returns 可交给 ctx.webServer.register 的路由。
 */
export interface ProxyRouteOptions {
  baseUrl: () => string
  token: () => string | Promise<string>
  /** 浏览器里的前缀（默认 /zipx-api）。 */
  path?: string
  /** 后端上游路径前缀（默认 /api/v3/director）。 */
  apiPath?: string
  /** 是否放行 /files/download 媒体字节（只有 director 那一条需要）。 */
  media?: boolean
  /** 只读代理：非 GET 一律 405（协作/模板这类只读面，写入口留在 Studio）。 */
  readOnly?: boolean
  /** 请求体上限（字节）。知识库上传要放行 multipart，默认仍只承载 JSON。 */
  maxBodyBytes?: number
  /** 大文件上传：不把请求体读进内存，边读边转给上游（maxBodyBytes 仍是硬上限）。 */
  streamBody?: boolean
  /** 放行 DELETE（只有团队管理需要；其余代理保持只读语义之外的最小方法集）。 */
  allowDelete?: boolean
}

export function createZipxApiRoute(options: ProxyRouteOptions) {
  const prefix = String(options.path || PROXY_PATH)
  const apiPath = String(options.apiPath || '/api/v3/director')
  const allowMedia = options.media !== false
  return {
    kind: 'prefix' as const,
    path: prefix,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const method = String(req.method ?? 'GET').toUpperCase()
      // DELETE 只服务团队管理（移除成员/撤销邀请）；别的代理不放行，避免扩大写面。
      if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
        sendProxyJson(res, 405, { ok: false, error: 'method_not_allowed' })
        return
      }
      if (method === 'DELETE' && options.allowDelete !== true) {
        sendProxyJson(res, 405, { ok: false, error: 'method_not_allowed' })
        return
      }
      if (options.readOnly === true && method !== 'GET') {
        sendProxyJson(res, 405, { ok: false, error: 'read_only', message: '这条代理只读：写操作请在 Studio 里做。' })
        return
      }
      // 2026-11-13：这个代理会替调用方带上配对令牌，所以它只服务本机浏览器。
      // 实测 3080 只监听 127.0.0.1（安全）；但一旦把 DSH 暴露到局域网，任何来访者
      // 都能借 /zipx-api 用你的 ZipX 账号。反向代理后 remoteAddress 同样是回环，
      // 那一层仍需要 DSH 自己的鉴权——本条只挡直连。
      if (!requestIsTrusted(req)) {
        sendProxyJson(res, 403, {
          code: 'not_trusted',
          message: '/zipx-api 只服务本机或同一个 DSH 页面：它替你注入 ZipX 令牌。',
        })
        return
      }
      let url: URL
      try {
        url = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
      } catch {
        sendProxyJson(res, 400, { ok: false, error: 'bad_url' })
        return
      }
      const pathname = url.pathname
      if (pathname !== prefix && !pathname.startsWith(prefix + '/')) {
        sendProxyJson(res, 404, { ok: false, error: 'not_zipx_api' })
        return
      }
      const rest = pathname.slice(prefix.length) || '/'
      let decoded: string
      try {
        decoded = decodeURIComponent(rest)
      } catch {
        sendProxyJson(res, 400, { ok: false, error: 'bad_path_encoding' })
        return
      }
      // 只允许 /zipx-api/ 下的路径，且禁止目录穿越（%2e%2e 解码后同样被拦）。
      if (!decoded.startsWith('/') || decoded.includes('..') || decoded.includes('\\') || decoded.includes('\u0000')) {
        sendProxyJson(res, 400, { ok: false, error: 'bad_path' })
        return
      }
      const isMedia = allowMedia && (decoded === MEDIA_PATH || decoded.startsWith(MEDIA_PATH + '/'))
      // 契约别名：外部（面板/工具）按"项目下的状态卡"写成 /project/<id>/state，
      // 而 ZipX 的真实路由是 /state/<id>（director_external_api）。只此一处别名，
      // 其余路径一律按原样转发，不掩盖真正的 404。
      const STATE_ALIAS = /^\/project\/([A-Za-z0-9_.-]+)\/state$/
      const upstreamRest = !isMedia && method === 'GET' ? rest.replace(STATE_ALIAS, '/state/$1') : rest
      const base = String(options.baseUrl() || 'http://localhost:8000').replace(/\/+$/, '')
      const target = base + (isMedia ? '/api/v1' : apiPath) + upstreamRest + url.search

      const headers: Record<string, string> = {}
      for (const name of FORWARD_REQUEST_HEADERS) {
        const value = req.headers[name]
        const flat = Array.isArray(value) ? value[0] : value
        if (typeof flat === 'string' && flat !== '') headers[name] = flat
      }
      const token = String((await options.token()) || '')
      // 客户端不必也不该带 token：这里统一覆盖，前端拿不到凭证。
      if (token !== '') headers.Authorization = 'Bearer ' + token

      const bodyLimit = Number(options.maxBodyBytes) > 0 ? Number(options.maxBodyBytes) : MAX_BODY_BYTES
      let body: any
      let bodyTooLarge = false
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        if (options.streamBody === true) {
          // 500MB 的视频不能一次读进内存：声明长度先挡，再边读边数（chunked 也挡得住）。
          const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
          if (Number.isFinite(declared) && declared > bodyLimit) {
            sendProxyJson(res, 413, { ok: false, error: 'payload_too_large', limit: bodyLimit })
            return
          }
          let seen = 0
          const counter = new Transform({
            transform(chunk: Buffer, _encoding: string, done: (error?: Error | null, data?: Buffer) => void): void {
              seen += chunk.length
              if (seen > bodyLimit) {
                bodyTooLarge = true
                done(new ProxyBodyTooLarge())
                return
              }
              done(null, chunk)
            },
          })
          req.on('error', (error: unknown) => {
            counter.destroy(error instanceof Error ? error : new Error(String(error)))
          })
          req.pipe(counter)
          body = Readable.toWeb(counter) as unknown as ReadableStream
        } else {
          try {
            body = await readProxyBody(req, bodyLimit)
          } catch (error) {
            if (error instanceof ProxyBodyTooLarge) {
              sendProxyJson(res, 413, { ok: false, error: 'payload_too_large', limit: bodyLimit })
              return
            }
            sendProxyJson(res, 400, { ok: false, error: 'body_read_failed' })
            return
          }
        }
      }

      const controller = new AbortController()
      const onClose = (): void => { controller.abort() }
      res.once('close', onClose)
      let upstream: Response
      // 2026-11-13（真机）：后端容器重启后，Host 侧 keep-alive 池里会留一批死 socket，
      // 第一个请求会直接 502 upstream_unreachable —— 面板上就是「读取失败」，
      // 而 ZipX 其实好好的。GET 重试一次；写请求不重试（付费动作不能被重放），
      // 但把话说清楚：这是连接级失败，请求可能没送达。
      const sendUpstreamFailed = (error: unknown): void => {
        res.off('close', onClose)
        if (options.streamBody === true && !req.destroyed) req.destroy()
        if (bodyTooLarge) {
          sendProxyJson(res, 413, { ok: false, error: 'payload_too_large', limit: bodyLimit })
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        ctxLoggerWarn('zipx api proxy upstream failed: ' + target + ' — ' + message)
        sendProxyJson(res, 502, {
          ok: false,
          error: 'upstream_unreachable',
          detail: message.slice(0, 200),
          upstream: String(options.baseUrl()),
          retryable: method === 'GET',
          hint: method === 'GET'
            ? '连接级失败（后端重启后常见），刷新即可；这不代表 ZipX 没有数据。'
            : '写请求没有自动重试：请求可能没有送达。付费动作请带 idempotency_key 再试一次。',
        })
      }
      const init: RequestInit & { duplex?: 'half' } = { method, headers, body, signal: controller.signal }
      if (options.streamBody === true) init.duplex = 'half'
      try {
        upstream = await fetch(target, init)
      } catch (error) {
        if (method !== 'GET') { sendUpstreamFailed(error); return }
        try {
          upstream = await fetch(target, init)
        } catch (retryError) {
          sendUpstreamFailed(retryError)
          return
        }
      }

      const outHeaders: Record<string, string> = {}
      for (const name of FORWARD_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name)
        if (value !== null && value !== '') outHeaders[name] = value
      }
      // fetch 会自动解压，Content-Encoding 存在时不能再透传原长度（否则客户端等不到字节）。
      if (upstream.headers.get('content-encoding') === null) {
        const length = upstream.headers.get('content-length')
        if (length !== null) outHeaders['content-length'] = length
      }
      outHeaders['x-zipx-proxy'] = 'dsh'
      // 状态码原样透传：前端据此区分 404（接口未就绪）/403 channel_disabled/401。
      res.writeHead(upstream.status, outHeaders)
      if (upstream.body === null) {
        res.end()
        res.off('close', onClose)
        return
      }
      try {
        await pipeline(Readable.fromWeb(upstream.body as never), res)
      } catch (error) {
        // 客户端中途关掉（拖进度条）是常态，不当故障。
        if (!res.writableEnded) res.destroy()
      } finally {
        res.off('close', onClose)
      }
    },
  }
}

/**
 * 创作对话的**只读侧**代理：/zipx-os/* → /api/v3/creative-os/*。
 *
 * 面板要画出一段真实的对话记录（用户说了什么、导演回了什么、这轮停在哪），这是
 * `GET /api/v3/creative-os/dialogue/{project_id}` 的职责。它不在 director 前缀下，
 * 所以单独一条前缀路由，而不是把 creative-os 塞进 /zipx-api 的语义里。
 * 与 /zipx-api 同样：只服务本机浏览器、令牌在 Host 侧注入、写方法一律不经过这里
 * （creative-os 的写端点只会给面板带来风险，面要不到）。
 */
export function createZipxOsRoute(options: ProxyRouteOptions) {
  // 只读是这条路由的契约（见上方注释）：creative-os 的写端点不经过浏览器。
  return createZipxApiRoute({ ...options, path: '/zipx-os', apiPath: '/api/v3/creative-os', media: false, readOnly: true })
}

function ctxLoggerWarn(message: string): void {
  try {
    console.warn('[zipx-api] ' + message)
  } catch {
    /* 日志失败不影响代理 */
  }
}

/**
 * 配对落地：浏览器把 URL 上的一次性配对码交给 Host，Host 去 ZipX 换 30 天委托 token，
 * 落盘 + 立即生效。**令牌永远不返回浏览器**——前端只拿到 {ok, status}。
 */
export function createPairRoute(options: {
  baseUrl: () => string
  onToken: (token: string, deviceId: string) => void
}) {
  return {
    kind: 'exact',
    path: '/zipx-pair/connect',
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (String(req.method || '').toUpperCase() !== 'POST') {
        sendProxyJson(res, 405, { ok: false, code: 'method_not_allowed' })
        return
      }
      let body: any = {}
      try {
        body = JSON.parse(String((await readProxyBody(req)) || '{}'))
      } catch (error) {
        sendProxyJson(res, error instanceof ProxyBodyTooLarge ? 413 : 400, { ok: false, code: 'invalid_body' })
        return
      }
      const code = String(body?.code || '').trim().toUpperCase()
      const deviceId = String(body?.device_id || '').trim()
      if (!code || !deviceId) {
        sendProxyJson(res, 400, { ok: false, code: 'code_required' })
        return
      }
      try {
        const upstream = await fetch(String(options.baseUrl()) + '/api/v1/auth/dialogue/pair/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, device_id: deviceId }),
        })
        const json: any = await upstream.json().catch(() => ({}))
        if (upstream.ok && json?.status === 'approved' && json?.token) {
          options.onToken(String(json.token), deviceId)
          console.log('[zipx-director] paired device=' + deviceId)
          sendProxyJson(res, 200, { ok: true, status: 'approved', device_id: deviceId })
          return
        }
        // pending / expired / consumed / revoked / unknown 都是「没连上」，如实回给面板。
        sendProxyJson(res, 200, { ok: false, status: String(json?.status || 'unknown') })
      } catch (error) {
        sendProxyJson(res, 502, { ok: false, code: 'backend_unreachable', message: String((error as any)?.message || error).slice(0, 200) })
      }
    },
  }
}

/**
 * 账户代理：/zipx-account/*
 *
 * 为什么单独一条：注册/登录/额度/资料都在 /api/v1/{auth,user,credits} 下，
 * 而 /zipx-api 的契约是 /api/v3/director。把 /api/v1 整段暴露给浏览器等于把
 * 所有 v1 端点（含 files 下载）也交出去，所以这里只放**明确列出的六个动作**。
 *
 * 令牌纪律与配对一致：access_token 只落在 Host 进程 + ~/.zipx/account-token.json，
 * 浏览器拿到的是 {ok, user}，永远不是 token 本身。
 */
export function createZipxAccountRoute(options: {
  baseUrl: () => string
  token: () => string | Promise<string>
  onToken: (token: string, identity: string) => void
  onLogout: () => void
}) {
  const prefix = '/zipx-account'
  return {
    kind: 'prefix' as const,
    path: prefix,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const method = String(req.method ?? 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'POST' && method !== 'PUT') {
        sendProxyJson(res, 405, { ok: false, error: 'method_not_allowed' })
        return
      }
      if (!requestIsTrusted(req)) {
        sendProxyJson(res, 403, { ok: false, code: 'not_trusted', message: '/zipx-account 只服务本机或同一个 DSH 页面。' })
        return
      }
      let url: URL
      try {
        url = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
      } catch {
        sendProxyJson(res, 400, { ok: false, error: 'bad_url' })
        return
      }
      const suffix = url.pathname.slice(prefix.length) || '/'
      const base = String(options.baseUrl() || 'http://localhost:8000').replace(/\/+$/, '')

      let body: any = {}
      if (method === 'POST' || method === 'PUT') {
        try {
          const raw = String((await readProxyBody(req)) || '')
          body = raw ? JSON.parse(raw) : {}
        } catch (error) {
          sendProxyJson(res, error instanceof ProxyBodyTooLarge ? 413 : 400, { ok: false, code: 'invalid_body' })
          return
        }
      }

      const token = String((await options.token()) || '')
      async function upstream(path: string, init: { method: string; body?: string; auth: boolean }) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (init.auth && token !== '') headers.Authorization = 'Bearer ' + token
        const started = Date.now()
        try {
          const response = await fetch(base + path, { method: init.method, headers, body: init.body })
          const text = await response.text()
          let json: any = null
          try { json = JSON.parse(text) } catch { json = null }
          return { ok: response.ok, status: response.status, json, text, ms: Date.now() - started }
        } catch (error) {
          const message = String((error as any)?.message || error)
          return { ok: false, status: 0, json: null, text: message, ms: Date.now() - started, network: true }
        }
      }

      function human(result: { json: any; text: string; status: number }): string {
        const detail = result.json?.detail ?? result.json?.message ?? result.text
        if (typeof detail === 'string') return detail.slice(0, 300)
        if (detail && typeof detail === 'object') return String(detail.message ?? detail.code ?? '').slice(0, 300)
        return ''
      }

      try {
        if (suffix === '/status') {
          sendProxyJson(res, 200, { ok: true, connected: token !== '', source: 'host' })
          return
        }
        if (suffix === '/me') {
          if (token === '') {
            sendProxyJson(res, 200, { ok: false, code: 'not_signed_in', message: '还没有登录。' })
            return
          }
          const result = await upstream('/api/v1/auth/me', { method: 'GET', auth: true })
          if (!result.ok) {
            sendProxyJson(res, result.status || 502, { ok: false, code: result.status === 401 ? 'not_signed_in' : 'account_failed', message: human(result) || ('HTTP ' + result.status) })
            return
          }
          sendProxyJson(res, 200, result.json ?? {})
          return
        }
        if (suffix === '/credits') {
          if (token === '') {
            sendProxyJson(res, 200, { ok: false, code: 'not_signed_in' })
            return
          }
          const result = await upstream('/api/v1/credits/balance', { method: 'GET', auth: true })
          sendProxyJson(res, result.ok ? 200 : (result.status || 502), result.json ?? { ok: false, message: human(result) })
          return
        }
        if (suffix === '/history') {
          if (token === '') {
            sendProxyJson(res, 200, { ok: false, code: 'not_signed_in' })
            return
          }
          const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1)
          const size = Math.min(50, Math.max(1, Number(url.searchParams.get('page_size') || 10) || 10))
          const result = await upstream('/api/v1/credits/history?page=' + page + '&page_size=' + size, { method: 'GET', auth: true })
          sendProxyJson(res, result.ok ? 200 : (result.status || 502), result.json ?? { ok: false, message: human(result) })
          return
        }
        if (suffix === '/login' || suffix === '/register') {
          const target = suffix === '/login' ? '/api/v1/auth/login' : '/api/v1/auth/register'
          const result = await upstream(target, { method: 'POST', body: JSON.stringify(body), auth: false })
          if (!result.ok || !result.json || !result.json.access_token) {
            sendProxyJson(res, result.ok ? 502 : (result.status || 502), {
              ok: false,
              code: result.json?.code || 'auth_failed',
              message: human(result) || (result.ok ? '上游没有返回令牌' : 'HTTP ' + result.status),
            })
            return
          }
          const identity = String(result.json?.user?.email || result.json?.user?.phone || result.json?.user?.name || '')
          options.onToken(String(result.json.access_token), identity)
          console.log('[zipx-account] signed in as ' + (identity || '(unknown)') + ' via ' + suffix)
          sendProxyJson(res, 200, { ok: true, user: result.json.user ?? null })
          return
        }
        if (suffix === '/logout') {
          options.onLogout()
          console.log('[zipx-account] signed out (token cleared)')
          sendProxyJson(res, 200, { ok: true })
          return
        }
        if (suffix === '/profile') {
          if (token === '') {
            sendProxyJson(res, 401, { ok: false, code: 'not_signed_in' })
            return
          }
          const result = await upstream('/api/v1/user/profile', { method: 'PUT', body: JSON.stringify(body), auth: true })
          sendProxyJson(res, result.ok ? 200 : (result.status || 502), result.json ?? { ok: false, message: human(result) })
          return
        }
        if (suffix === '/change-password') {
          if (token === '') {
            sendProxyJson(res, 401, { ok: false, code: 'not_signed_in' })
            return
          }
          const result = await upstream('/api/v1/user/change-password', { method: 'POST', body: JSON.stringify(body), auth: true })
          sendProxyJson(res, result.ok ? 200 : (result.status || 502), result.json ?? { ok: false, message: human(result) })
          return
        }
        sendProxyJson(res, 404, { ok: false, code: 'not_found', message: '未知的账户动作：' + suffix })
      } catch (error) {
        sendProxyJson(res, 502, { ok: false, code: 'account_proxy_failed', message: String((error as any)?.message || error).slice(0, 200) })
      }
    },
  }
}

/**
 * 内嵌预览凭证：/zipx-embed/url
 *
 * 面板要用 iframe 打开 Studio 的某一步（B1：与网页 Studio 完全一致），而 iframe 里
 * 跑的是**真 Studio 前端**，它必须自己带 Bearer 调后端 —— 与「令牌只留在 Host 进程」
 * 的纪律冲突。折中：这一条端点用 Host 侧令牌向 ZipX 换一枚**一次性、120 秒**的兑换码，
 * 把码拼进 iframe 地址（`/studio/{id}/embed/{step}?vc=…`）。浏览器拿到的是**一次性的码**，
 * 不是长期令牌；iframe 兑换出的 15 分钟令牌只存在它自己的 sessionStorage 里。
 *
 * 为什么自己做 URL 而不是把 code 回给面板拼：studioUrl 是用户配置（默认
 * http://localhost:3000，也可能经 nginx）。拼错一个斜杠，用户看到的是 404 —— 让
 * 一条路径只有一个拼装点。
 *
 * 与 /zipx-account 同一条卫生纪律：**只服务本机浏览器**（它下发的是凭证）。
 */
export function createZipxEmbedRoute(options: {
  baseUrl: () => string
  token: () => string | Promise<string>
}) {
  const prefix = '/zipx-embed'

  /** Studio 基地址：默认 http://localhost:3000；只接受 http(s)，去掉尾斜杠。 */
  function studioBase(raw: unknown): string {
    const text = String(raw ?? '').trim() || 'http://localhost:3000'
    if (!/^https?:\/\/[^\s?#]+$/i.test(text)) return ''
    return text.replace(/\/+$/, '')
  }

  return {
    kind: 'prefix' as const,
    path: prefix,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const method = String(req.method ?? 'GET').toUpperCase()
      if (method !== 'GET') {
        sendProxyJson(res, 405, { ok: false, error: 'method_not_allowed' })
        return
      }
      if (!requestIsTrusted(req)) {
        sendProxyJson(res, 403, { ok: false, code: 'not_trusted', message: '/zipx-embed 只服务本机或同一个 DSH 页面。' })
        return
      }
      let url: URL
      try {
        url = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
      } catch {
        sendProxyJson(res, 400, { ok: false, error: 'bad_url' })
        return
      }
      const suffix = url.pathname.slice(prefix.length) || '/'
      if (suffix !== '/url') {
        sendProxyJson(res, 404, { ok: false, code: 'not_found', message: '未知的内嵌预览动作：' + suffix })
        return
      }

      const projectId = String(url.searchParams.get('project_id') ?? '').trim()
      const step = String(url.searchParams.get('step') ?? '').trim()
      const studio = studioBase(url.searchParams.get('studio'))
      // 两道形状校验：这两个值会被拼进 URL 路径，绝不能带分隔符
      if (!/^[0-9a-fA-F-]{8,40}$/.test(projectId)) {
        sendProxyJson(res, 400, { ok: false, code: 'project_id_invalid', message: '项目 id 形状不对：' + projectId.slice(0, 40) })
        return
      }
      if (!/^[a-z0-9_]{1,40}$/.test(step)) {
        sendProxyJson(res, 400, { ok: false, code: 'step_invalid', message: '步骤 id 形状不对：' + step.slice(0, 40) })
        return
      }
      if (!studio) {
        sendProxyJson(res, 400, { ok: false, code: 'studio_url_invalid', message: 'Studio 地址必须是 http(s) 开头且不含查询串。' })
        return
      }

      const token = String((await options.token()) || '')
      if (token === '') {
        sendProxyJson(res, 401, { ok: false, code: 'not_signed_in', message: '还没有登录 ZipX，换不到预览凭证。' })
        return
      }

      const base = String(options.baseUrl() || 'http://localhost:8000').replace(/\/+$/, '')
      try {
        const response = await fetch(base + '/api/v3/director/project/' + encodeURIComponent(projectId) + '/embed-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ step }),
        })
        const text = await response.text()
        let json: any = null
        try { json = JSON.parse(text) } catch { json = null }
        if (!response.ok || !json || !json.code) {
          const detail = json?.detail
          const message = typeof detail === 'string'
            ? detail
            : String(detail?.message ?? detail?.code ?? text ?? '').slice(0, 300)
          const code = String(detail?.code ?? (response.status === 401 ? 'not_signed_in' : 'embed_code_failed'))
          sendProxyJson(res, response.status || 502, { ok: false, code, message: message || ('HTTP ' + response.status) })
          return
        }
        const frameUrl = studio + '/studio/' + projectId + '/embed/' + step + '?vc=' + encodeURIComponent(String(json.code))
        sendProxyJson(res, 200, {
          ok: true,
          url: frameUrl,
          project_id: projectId,
          step,
          expires_in: Number(json.expires_in) || 0,
        })
      } catch (error) {
        sendProxyJson(res, 502, {
          ok: false,
          code: 'embed_unreachable',
          message: 'ZipX 后端读不到：' + String((error as any)?.message ?? error).slice(0, 200),
        })
      }
    },
  }
}

/**
 * /zipx-media —— 产物字节的 Range 代理。
 *
 * Signed URLs from /artifacts?media=1 point at the backend origin (often
 * localhost), which a phone cannot reach. The browser only ever sees this
 * same-origin route; the Host resolves the original URL against its own
 * baseUrl and streams the bytes, preserving Range so video seeking works.
 *
 * Safety: only the backend's file paths (or an explicit ZIPX_MEDIA_HOSTS list)
 * are accepted — never an open proxy.
 */
export function createZipxMediaRoute(options: {
  baseUrl: () => string
  /**
   * Host 侧令牌：v5 签名媒体端点同时要求登录态（签名只证明"这条链接是这个项目签的"）。
   * 浏览器 <img>/<video> 带不了 Authorization，所以由这条同源代理补上；**只发给配置的
   * 后端 origin**，绝不发给外站。
   */
  token?: () => string | Promise<string>
}) {
  const prefix = '/zipx-media'

  function allowedHost(host: string, base: URL): boolean {
    if (host === base.host) return true
    const extra = String(process.env.ZIPX_MEDIA_HOSTS || '')
      .split(',').map(item => item.trim()).filter(Boolean)
    if (extra.includes(host)) return true
    // A backend URL written as localhost/127.0.0.1 must follow the configured base host.
    const loopback = host === 'localhost' || host.startsWith('127.') || host === '[::1]' || host === '::1'
    return loopback && (base.hostname === 'localhost' || base.hostname.startsWith('127.') || base.hostname === '::1')
  }

  function allowedPath(pathname: string): boolean {
    return pathname.startsWith('/api/v1/files/')
      || pathname.startsWith('/files/')
      || pathname.startsWith('/api/v1/media/')
      // 契约 v5 的签名媒体入口（/artifacts?media=1 与交付 media_url 都指到这里）。
      // 2026-11-17 真机：缺这一条时所有产物预览都 403 media_target_rejected。
      || pathname.startsWith('/api/v3/director/project/')
  }

  function target(raw: string): URL | null {
    try {
      const base = new URL(String(options.baseUrl() || 'http://localhost:8000'))
      const url = new URL(raw, base)
      if (!/^https?:$/.test(url.protocol)) return null
      if (!allowedHost(url.host, base)) return null
      if (!allowedPath(url.pathname)) return null
      const loopbackHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]'
      if (loopbackHost && url.host !== base.host) {
        // A signed URL written as localhost must follow the configured backend origin.
        const rewritten = new URL(base.origin)
        rewritten.pathname = url.pathname
        rewritten.search = url.search
        return rewritten
      }
      return url
    } catch {
      return null
    }
  }

  function sameOrigin(req: IncomingMessage): boolean {
    const remote = String(req.socket?.remoteAddress || '')
    if (remote === '::1' || remote === '::ffff:127.0.0.1' || remote.startsWith('127.')) return true
    const host = String(req.headers.host || '')
    const origin = String(req.headers.origin || '')
    const referer = String(req.headers.referer || '')
    try {
      if (origin && new URL(origin).host === host) return true
      if (referer && new URL(referer).host === host) return true
    } catch { /* malformed header */ }
    return String(req.headers['sec-fetch-site'] || '') === 'same-origin'
  }

  return {
    kind: 'prefix' as const,
    path: prefix,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const method = String(req.method || 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') {
        sendProxyJson(res, 405, { ok: false, error: 'method_not_allowed' })
        return
      }
      if (!sameOrigin(req)) {
        sendProxyJson(res, 403, { ok: false, code: 'not_same_origin', message: '/zipx-media 只服务同一个 DSH 页面（它只转发 ZipX 后端的签名媒体）。' })
        return
      }
      let url: URL
      try {
        url = new URL(String(req.url || '/'), 'http://127.0.0.1')
      } catch {
        sendProxyJson(res, 400, { ok: false, error: 'bad_url' })
        return
      }
      const raw = String(url.searchParams.get('u') || '').trim()
      if (!raw) {
        sendProxyJson(res, 400, { ok: false, code: 'media_url_required', message: '缺少 u（要转发的签名媒体地址）。' })
        return
      }
      const upstream = target(raw)
      if (!upstream) {
        sendProxyJson(res, 403, { ok: false, code: 'media_target_rejected', message: '这个媒体地址不在允许范围内（只转发 ZipX 后端的文件路径）。' })
        return
      }
      const headers: Record<string, string> = {}
      for (const name of ['range', 'if-range', 'if-none-match']) {
        const value = req.headers[name]
        const flat = Array.isArray(value) ? value[0] : value
        if (typeof flat === 'string' && flat) headers[name] = flat
      }
      // v5 签名 URL 仍然要登录态；只有发往配置后端的请求补 Bearer，外站永远拿不到令牌。
      try {
        const backendOrigin = new URL(String(options.baseUrl() || 'http://localhost:8000'))
        if (upstream.host === backendOrigin.host && options.token) {
          const token = String((await options.token()) || '')
          if (token) headers.authorization = 'Bearer ' + token
        }
      } catch (error) {
        console.warn('[zipx-director] media token injection skipped: ' + String((error as any)?.message || error))
      }
      const controller = new AbortController()
      const onClose = () => controller.abort()
      res.once('close', onClose)
      let response: Response
      try {
        response = await fetch(upstream.toString(), { method, headers, signal: controller.signal, redirect: 'follow' })
      } catch (error) {
        res.off('close', onClose)
        sendProxyJson(res, 502, { ok: false, code: 'media_unreachable', message: '媒体读不到：' + String((error as any)?.message || error).slice(0, 200) })
        return
      }
      const out: Record<string, string> = {}
      for (const name of ['content-type', 'accept-ranges', 'content-range', 'etag', 'last-modified', 'content-length']) {
        const value = response.headers.get(name)
        if (value) out[name] = value
      }
      out['cache-control'] = 'private, max-age=300'
      out['x-zipx-media'] = 'dsh'
      res.writeHead(response.status, out)
      if (method === 'HEAD' || response.body === null) {
        res.end()
        res.off('close', onClose)
        return
      }
      try {
        await pipeline(Readable.fromWeb(response.body as never), res)
      } catch (error) {
        if (!res.writableEnded) res.destroy()
      } finally {
        res.off('close', onClose)
      }
    },
  }
}

/** /zipx-auth/status —— settings/diagnostics reads connection facts, never the token. */
export function createZipxAuthStatusRoute(options: {
  baseUrl: () => string
  tokenInfo: () => Promise<TokenInfo>
  credentialsAvailable: () => boolean
  tools: () => number
}) {
  return {
    kind: 'exact' as const,
    path: '/zipx-auth/status',
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (String(req.method || 'GET').toUpperCase() !== 'GET') {
        sendProxyJson(res, 405, { ok: false, code: 'method_not_allowed' })
        return
      }
      if (!requestIsTrusted(req)) {
        sendProxyJson(res, 403, { ok: false, code: 'not_loopback', message: '/zipx-auth/status 只服务本机浏览器。' })
        return
      }
      const info = await options.tokenInfo()
      sendProxyJson(res, 200, {
        ok: true,
        connected: info.token !== '',
        source: info.source,
        identity: info.identity || '',
        expires_at: info.expires_at || '',
        credentials: options.credentialsAvailable(),
        tools: options.tools(),
        base_url: String(options.baseUrl() || ''),
      })
    },
  }
}

/** /zipx-budget —— per-step / daily credit limits (stored in DSH Credentials). */
export function createZipxBudgetRoute() {
  return {
    kind: 'exact' as const,
    path: '/zipx-budget',
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const method = String(req.method || 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'PUT') {
        sendProxyJson(res, 405, { ok: false, code: 'method_not_allowed' })
        return
      }
      if (!requestIsTrusted(req)) {
        sendProxyJson(res, 403, { ok: false, code: 'not_loopback', message: '/zipx-budget 只服务本机浏览器。' })
        return
      }
      if (method === 'GET') {
        sendProxyJson(res, 200, { ok: true, budget: await readBudget() })
        return
      }
      let body: any = {}
      try {
        const raw = String((await readProxyBody(req)) || '')
        body = raw ? JSON.parse(raw) : {}
      } catch (error) {
        sendProxyJson(res, error instanceof ProxyBodyTooLarge ? 413 : 400, { ok: false, code: 'invalid_body' })
        return
      }
      const next = await writeBudget({ per_step: Number(body?.per_step), daily: Number(body?.daily) })
      sendProxyJson(res, 200, { ok: true, budget: next })
    },
  }
}

/** /zipx-doctor —— one read-only diagnosis for the settings page and /zipx-doctor. */
export function createZipxDoctorRoute(options: {
  baseUrl: () => string
  tokenInfo: () => Promise<TokenInfo>
  credentialsAvailable: () => boolean
  tools: () => number
}) {
  return {
    kind: 'exact' as const,
    path: '/zipx-doctor',
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (String(req.method || 'GET').toUpperCase() !== 'GET') {
        sendProxyJson(res, 405, { ok: false, code: 'method_not_allowed' })
        return
      }
      if (!requestIsTrusted(req)) {
        sendProxyJson(res, 403, { ok: false, code: 'not_loopback', message: '/zipx-doctor 只服务本机浏览器。' })
        return
      }
      const info = await options.tokenInfo()
      const base = String(options.baseUrl() || 'http://localhost:8000')
      const started = Date.now()
      let backend: any = { ok: false, status: 0, ms: 0, url: base }
      try {
        const response = await fetch(base.replace(/\/+$/, '') + '/api/v3/director/capabilities', {
          headers: info.token ? { Authorization: 'Bearer ' + info.token } : {},
        })
        const text = await response.text()
        let json: any = null
        try { json = JSON.parse(text) } catch { /* non-JSON */ }
        backend = {
          ok: response.ok,
          status: response.status,
          ms: Date.now() - started,
          url: base,
          channel_state: json?.channel_state ?? 'unknown',
          contract_version: json?.contract_version ?? '',
          error: response.ok ? '' : text.slice(0, 200),
        }
      } catch (error) {
        backend = { ok: false, status: 0, ms: Date.now() - started, url: base, error: String((error as any)?.message || error).slice(0, 200) }
      }
      let version = ''
      try {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
        version = String(pkg?.version || '')
      } catch { /* version is nice-to-have */ }
      sendProxyJson(res, 200, {
        ok: backend.ok,
        version,
        tools: options.tools(),
        base_url: base,
        backend,
        token: {
          present: info.token !== '',
          source: info.source,
          expires_at: info.expires_at || '',
        },
        credentials: {
          available: options.credentialsAvailable(),
          account: Boolean(info.token),
        },
      })
    },
  }
}

export function apply(ctx: Context, config: ZipxConfig = {}) {
  const api = client(config)
  // 运行时回执：到底注册了几个工具。插件「加载成功但少几个工具」是最难查的一类故障，
  // 一行日志把「源码里有」变成「这个进程里真的注册了」。
  const registered: string[] = []
  const reg = (tool: any) => {
    registered.push(String(tool?.name || ''))
    // Every tool gets a replayable projection. Specific tools override this below;
    // the generic card is the honest fallback for the long tail.
    if (tool?.output && typeof tool.output.presentationMeta !== 'function') {
      tool.output.presentationMeta = metaGeneric(String(tool?.name || ''))
    }
    ctx.tools.register(tool)
  }
  const language = String(config?.language || 'zh')
  const baseUrl = String(config?.baseUrl || 'http://localhost:8000')
  console.log('[zipx-director] registering tools (baseUrl=' + baseUrl + ')')

  /**
   * Paid-action gate. The DSH approval card is the only place a human says yes;
   * confirm:true from the model is no longer trusted. Deny is preferable to a
   * silent paid run when the profile has no approval channel.
   */
  const PAID_TOOLS = new Set([
    'zipx_start', 'zipx_confirm_step', 'zipx_regenerate_step', 'zipx_regenerate_item',
    'zipx_resume_step', 'zipx_start_episode', 'zipx_dispatch',
  ])
  const GENERATIVE_CHAT = /(开始|开工|生成|重做|重新|推进|继续|修改|改成|换成|调整|补|加|删|重新生成|start|generate|regenerate|advance|modify|redo)/i
  const pendingCharges = new WeakMap<object, { credits: number; project_id: string }>()

  function approvalChannel(): any {
    try { return (ctx as any).get('approval') } catch { return undefined }
  }

  async function estimateFor(name: string, args: any): Promise<{ credits: number | null; balance: number | null; currency: string; projectId: string; step: string }> {
    let projectId = String(args?.project_id || '')
    let step = String(args?.step || args?.step_type || args?.action_params?.step || '')
    // 2026-11-17：zipx_start 没有 step 参数，旧实现让批准卡显示「费用未知」。
    // idea2video 的第一个生成步固定是 story（约 10 credits）；先给这个预估，
    // 比让用户在「不知道要花多少」的卡上点允许要好。standalone 项目若第一步不是
    // story，预估会落到 null（后端没有该步固定价），仍如实说未知。
    if (!step && (name === 'zipx_start' || name === 'zipx_start_episode')) step = 'story'
    if (!projectId) {
      try { projectId = await resolveProject(args, {}) } catch { projectId = '' }
    }
    if (!projectId) return { credits: null, balance: null, currency: 'credits', projectId: '', step }
    try {
      const q = step ? '?step=' + encodeURIComponent(step) : ''
      const cost: any = await api.get('/api/v3/director/project/' + encodeURIComponent(projectId) + '/cost' + q)
      const raw = cost?.estimate_calls
      return {
        credits: raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw),
        balance: cost?.balance === null || cost?.balance === undefined ? null : Number(cost.balance),
        currency: String(cost?.currency || 'credits'),
        projectId,
        step,
      }
    } catch {
      return { credits: null, balance: null, currency: 'credits', projectId, step }
    }
  }

  function paidLine(zh: boolean, name: string, cost: { credits: number | null; balance: number | null; currency: string }): string {
    const credits = cost.credits === null ? (zh ? '费用未知（后端未返回预估）' : 'cost unknown (backend returned no estimate)') : ('约 ' + cost.credits + ' ' + cost.currency)
    const balance = cost.balance === null ? '' : (zh ? '，余额 ' + cost.balance : ', balance ' + cost.balance)
    return zh
      ? 'ZipX 将执行付费生成（' + name + '），' + credits + balance + '。允许后只执行一次。'
      : 'ZipX will run a paid generation (' + name + '), ' + credits + balance + '. It runs once after you allow it.'
  }

  /**
   * 本会话的付费确认通道。审批策略是 never（DSH 的 full access 预设就是它）时，
   * 原生批准卡会**确定性地拒绝**，所以降级到用户问题的一次性确认卡——仍然是
   * 一个人点「允许本次」，不是模型自证。两者都不可用时拒绝，绝不放行。
   *
   * 2026-11-17 真机：E2E 会话被切到「从不询问」，zipx_start 被
   * the user rejected tool 拒掉，而模型无法区分「人拒绝」与「策略拒绝」。
   */
  function userQuestionsChannel(): any {
    try { return (ctx as any).get('userQuestions') } catch { return undefined }
  }

  function paidConfirmationMode(exec: any): 'native' | 'question' | 'deny' {
    const approval = approvalChannel()
    if (approval) {
      try {
        const session = exec && exec.agent && exec.agent.session
        const override = session && typeof approval.overrideOf === 'function' ? approval.overrideOf(session) : undefined
        const configured = approval && approval.config && approval.config.policy
        const policy = override || configured || 'ask'
        if (policy !== 'never') return 'native'
      } catch { return 'native' }
    }
    return userQuestionsChannel() ? 'question' : 'deny'
  }

  function paidDetail(zh: boolean, name: string, cost: any, projectId: string, step: string): string {
    const credits = cost.credits === null
      ? (zh ? '费用未知（后端未返回预估）' : 'cost unknown (backend returned no estimate)')
      : ('约 ' + cost.credits + ' ' + cost.currency)
    const balance = cost.balance === null ? '' : (zh ? '，余额 ' + cost.balance : ', balance ' + cost.balance)
    const lines = zh
      ? ['动作：' + name, '费用：' + credits + balance, projectId ? '项目：' + projectId : '', step ? '步骤：' + step : '', '允许后只执行一次；拒绝不产生费用。']
      : ['Action: ' + name, 'Cost: ' + credits + balance, projectId ? 'project: ' + projectId : '', step ? 'step: ' + step : '', 'It runs once after you allow it; denying costs nothing.']
    return lines.filter(Boolean).join(String.raw`\n`)
  }

  async function askOneTimeConfirmation(exec: any, name: string, cost: any): Promise<{ ok: boolean; reason?: string }> {
    const questions = userQuestionsChannel()
    if (!questions || typeof questions.ask !== 'function' || !exec || !exec.agent) {
      return { ok: false, reason: '当前会话没有可用的付费确认通道（DSH 批准卡与一次性确认卡都不可用），付费动作被拒绝。请把会话权限切到「询问」后重试。' }
    }
    const zh = language !== 'en'
    const approve = zh ? '允许本次' : 'Allow this time'
    const reject = zh ? '拒绝' : 'Deny'
    const question = zh ? ('允许 ZipX 执行这次付费生成（' + name + '）吗？') : ('Allow ZipX to run this paid generation (' + name + ')?')
    const detail = paidDetail(zh, name, cost, cost.projectId, cost.step)
    let answer: any
    try {
      answer = await questions.ask({
        agent: exec.agent,
        signal: exec.signal,
        questions: [{
          id: 'zipx-paid-confirm',
          question,
          detail,
          options: [{ label: approve }, { label: reject }],
          intent: {
            kind: 'approval',
            approve,
            reject,
            subject: { name: 'ZipX' },
            display: {
              question: { en: 'Allow this ZipX paid generation?', zh: '允许这次 ZipX 付费生成吗？' },
              detail: { en: paidDetail(false, name, cost, cost.projectId, cost.step), zh: detail },
              approve: { en: 'Allow this time', zh: '允许本次' },
            },
          },
        }],
      })
    } catch (error: any) {
      const msg = String(error && error.message ? error.message : error)
      return { ok: false, reason: '确认卡没有完成（' + msg + '），付费动作被拒绝。没有产生费用。' }
    }
    const items = Array.isArray(answer && answer.answers) ? answer.answers : []
    const item = items.find((a: any) => a && a.id === 'zipx-paid-confirm')
    const chosen = item && !item.custom && Array.isArray(item.selected) && item.selected.length === 1 ? item.selected[0] : ''
    if (chosen === approve) return { ok: true }
    return { ok: false, reason: '用户在确认卡上拒绝了这次付费动作。没有产生费用。' }
  }

  if (typeof (ctx as any).on === 'function') {
    (ctx as any).on('tools/pre-execute', async (exec: any, next: () => Promise<any>) => {
      const name = String(exec?.name || '')
      if (!PAID_TOOLS.has(name) && name !== 'zipx_chat') return next()
      if (name === 'zipx_chat') {
        const message = String(exec?.arguments?.message || '')
        if (!GENERATIVE_CHAT.test(message)) return next()
      }
      const cost = await estimateFor(name, exec?.arguments || {})
      const budget = await readBudget()
      if (cost.credits !== null) {
        if (budget.per_step > 0 && cost.credits > budget.per_step) {
          return { kind: 'deny', reason: '超出每步预算：预计 ' + cost.credits + ' credits > 上限 ' + budget.per_step + '。先调高预算或改用更小的动作。' }
        }
        if (budget.daily > 0 && budget.spent_today + cost.credits > budget.daily) {
          return { kind: 'deny', reason: '超出今日预算：已用 ' + budget.spent_today + ' + 本次 ' + cost.credits + ' > 上限 ' + budget.daily + '。' }
        }
      }
      if (cost.credits !== null && cost.projectId) {
        pendingCharges.set(exec, { credits: cost.credits, project_id: cost.projectId })
      }
      const mode = paidConfirmationMode(exec)
      if (mode === 'native') {
        return {
          kind: 'ask',
          reason: paidLine(true, name, cost),
          displayReason: {
            zh: paidLine(true, name, cost),
            en: paidLine(false, name, cost),
          },
        }
      }
      // 显式放行（ZIPX_ALLOW_UNCONFIRMED / allowUnconfirmed）只对「没有原生批准卡」
      // 的会话生效；它不能把交互式 ask 策略降级成静默执行。
      if (config?.allowUnconfirmed === true || String(process.env.ZIPX_ALLOW_UNCONFIRMED || '') === '1') return next()
      if (mode === 'question') {
        const confirmed = await askOneTimeConfirmation(exec, name, cost)
        if (confirmed.ok) return next()
        return { kind: 'deny', reason: confirmed.reason || '付费确认没有完成，动作被拒绝。' }
      }
      return {
        kind: 'deny',
        reason: '当前会话没有批准通道，也没有可用的一次性确认卡；付费动作被拒绝。请把会话权限切到「询问」后重试。',
      }
    })
    ;(ctx as any).on('tools/result', (exec: any, result: any) => {
      const charge = pendingCharges.get(exec)
      if (!charge) return
      pendingCharges.delete(exec)
      if (result?.isError) return
      void chargeBudget(charge.credits)
    })
  }

  // DSH Credentials（可选服务）：token 的唯一持久真相；旧文件只做一次性迁移与降级。
  ctx.inject(['credentials'], (scope: any) => {
    setCredentialService(scope.credentials)
    console.log('[zipx-director] credentials service available (zipx/account, zipx/budget)')
    void migrateLegacyToken()
  })

  // 客户端面板（P1 创作者工作台）靠这条同源代理读 ZipX：浏览器不持有 token。
  // 用 ctx.inject 等 webServer 就绪，而不是把它写进 inject 数组：没有该服务的 profile
  // 照样拿到 23 个工具，只是没有面板可读的代理。
  ctx.inject(['webServer'], (scope: any) => {
    scope.webServer.register(createZipxApiRoute({
      baseUrl: () => baseUrl,
      token: () => resolveToken(config),
    }))
    console.log('[zipx-director] /zipx-api proxy -> ' + baseUrl + '/api/v3/director')
    // 对话记录的只读代理（面板把 turn 画成聊天记录）。没有它，刷新一次就丢掉整段对话。
    scope.webServer.register(createZipxOsRoute({ baseUrl: () => baseUrl, token: () => resolveToken(config) }))
    console.log('[zipx-director] /zipx-os proxy -> ' + baseUrl + '/api/v3/creative-os')
    // 创作者个人知识库（账号级）：/api/v3/creator/*。
    // 文档 25MB / 图片 10MB / 音频 50MB / 视频 500MB（后端各自把关）；视频走流式，
    // 代理不把整包读进内存，只做总量硬上限（560MB 留 multipart 余量）。
    scope.webServer.register(createZipxApiRoute({
      baseUrl: () => baseUrl, token: () => resolveToken(config), path: '/zipx-kb', apiPath: '/api/v3/creator', media: false,
      maxBodyBytes: 560 * 1024 * 1024,
      streamBody: true,
    }))
    console.log('[zipx-director] /zipx-kb proxy -> ' + baseUrl + '/api/v3/creator (stream)')
    // 团队协作：/api/v2/team/*（成员 / 邀请 / 角色 / 移除）。只转发 JSON，不承载上传。
    scope.webServer.register(createZipxApiRoute({
      baseUrl: () => baseUrl, token: () => resolveToken(config), path: '/zipx-team', apiPath: '/api/v2/team', media: false,
      allowDelete: true,
    }))
    console.log('[zipx-director] /zipx-team proxy -> ' + baseUrl + '/api/v2/team')
    // 商业垂直：/api/v3/verticals/*（营销简报 / 产品图 / 产品锁）。产品图 ≤15MB。
    scope.webServer.register(createZipxApiRoute({
      baseUrl: () => baseUrl, token: () => resolveToken(config), path: '/zipx-verticals', apiPath: '/api/v3/verticals', media: false,
      maxBodyBytes: 20 * 1024 * 1024,
    }))
    console.log('[zipx-director] /zipx-verticals proxy -> ' + baseUrl + '/api/v3/verticals')
    // 模板目录（创作模板 = ZipX 的设计系统）：只读。
    scope.webServer.register(createZipxApiRoute({
      baseUrl: () => baseUrl, token: () => resolveToken(config), path: '/zipx-meta', apiPath: '/api/v3/verticals', media: false, readOnly: true,
    }))
    // 协作（剧组）：只读，写操作留在 Studio。
    scope.webServer.register(createZipxApiRoute({
      baseUrl: () => baseUrl, token: () => resolveToken(config), path: '/zipx-collab', apiPath: '/api/v4/collab', media: false, readOnly: true,
    }))
    console.log('[zipx-director] /zipx-meta (verticals) · /zipx-collab (v4 collab) 只读')
    // 账户：注册/登录/退出/额度/资料。密码只过本机代理，令牌留在 Host 侧。
    scope.webServer.register(createZipxAccountRoute({
      baseUrl: () => baseUrl,
      token: () => resolveToken(config),
      onToken: (token: string, identity: string) => {
        writeAccountToken(token, identity)
      },
      onLogout: () => {
        clearAccountToken()
      },
    }))
    console.log('[zipx-director] /zipx-account proxy -> ' + baseUrl + '/api/v1/{auth,user,credits}')
    // 内嵌预览（B1）：面板要 iframe 挂 Studio 的那一步，而浏览器不能拿长期令牌。
    // 这一条用 Host 令牌换一次性码，再把码拼进 Studio 地址回给面板。
    scope.webServer.register(createZipxEmbedRoute({
      baseUrl: () => baseUrl,
      token: () => resolveToken(config),
    }))
    console.log('[zipx-director] /zipx-embed/url -> ' + baseUrl + '/api/v3/director/project/{id}/embed-code')

    // 媒体 Range 代理：签名 URL 的后端 origin 往往只在 Host 可达（手机打不开 localhost）。
    scope.webServer.register(createZipxMediaRoute({ baseUrl: () => baseUrl, token: () => resolveToken(config) }))
    console.log('[zipx-director] /zipx-media?u=… -> Range proxy (same-origin)')

    // 连接/诊断/预算：设置页与 /zipx-doctor 的只读事实源。
    const credentialFacts = () => ({
      baseUrl: () => baseUrl,
      tokenInfo: () => resolveTokenInfo(config),
      credentialsAvailable: () => Boolean(credentialService),
      tools: () => registered.length,
    })
    scope.webServer.register(createZipxAuthStatusRoute(credentialFacts()))
    scope.webServer.register(createZipxDoctorRoute(credentialFacts()))
    scope.webServer.register(createZipxBudgetRoute())
    console.log('[zipx-director] /zipx-auth/status · /zipx-doctor · /zipx-budget')

    // 配对落地：面板收到一次码就来换 token。写文件失败不影响本次进程（活令牌已在内存），
    // 但重启后要重新配对——所以如实打一行 warning，不假装成功。
    scope.webServer.register(createPairRoute({
      baseUrl: () => baseUrl,
      onToken: (token: string, deviceId: string) => {
        liveToken = token
        try {
          writePairedToken(token, deviceId)
        } catch (error) {
          console.warn('[zipx-director] token file write failed (this process still works):', error)
        }
      },
    }))
  })

  reg(defineTool({
    name: 'zipx_project_state',
    description: [
      '读取 ZipX 项目的权威状态卡：当前步骤、真实进度、门禁总体、本轮合法动作（人话）、下一步建议、最近事件。',
      '任何关于「项目现在到哪一步了/能不能做某一步」的问题，先调用它，不要凭记忆猜。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', required: true, description: 'ZipX 项目 id（uuid）' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaState,
      render: (_args: unknown, value: any) => [{ type: 'text', text: renderState(value) }],
    },
    async execute(args: { project_id: string }) {
      return api.get(`/api/v3/director/state/${encodeURIComponent(args.project_id)}?language=${encodeURIComponent(language)}`)
    },
  }))

  reg(defineTool({
    name: 'zipx_preview_action',
    description: [
      '在真正执行前做零成本预检：这个动作现在能不能做、被哪道关卡拦、缺什么、是否付费、会影响哪些下游、有哪些替代动作。',
      '凡是可能被拒绝的创作动作（推进/重做/修改/风格调整/开始整条流程），先 preview 再 dispatch。',
      '返回 allowed=false 时按 reason_human 向用户解释或改参数；allowed=null 表示判不了（不是不允许）。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', required: true, description: 'ZipX 项目 id（uuid）' },
      action: {
        type: 'string',
        required: true,
        enum: ['advance_step', 'regenerate', 'modify', 'style_adjust', 'batch_modify', 'restart', 'pause', 'resume', 'start_workflow'],
      },
      action_params: { type: 'object', additionalProperties: true, description: '动作参数（如 episode/scene/shot/instruction）' },
      message: { type: 'string', description: '用户原话（用于台账与语义判定）' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaPreview,
      render: (_args: unknown, v: any) => [{
        type: 'text',
        text: v?.allowed === true
          // 2026-11-13（真机）：advance_step 报 paid=false，实际起跑下一步生成扣了 10 credits。
          // 「动作免费」不等于「不花钱」——note 由后端给出，说清会不会起跑计费生成。
          ? `可以执行。${v?.cost_estimate?.paid ? '这是付费动作。' : '动作本身不计费。'}${v?.cost_estimate?.note ? v.cost_estimate.note : ''}${(v?.downstream_impact ?? []).length ? `下游：${v.downstream_impact.join('、')}。` : ''}`
          : v?.allowed === null
            ? `预检失败（判不了，不是不允许）：${v?.reason ?? ''}`
            : `不能执行：${v?.reason_human || v?.reason || ''}（关卡 ${v?.gate || ''}）`,
      }],
    },
    async execute(args: { project_id: string; action: string; action_params?: Record<string, unknown>; message?: string }) {
      return api.post('/api/v3/director/preview', {
        project_id: args.project_id,
        action: args.action,
        action_params: args.action_params ?? {},
        message: args.message ?? '',
        language,
      })
    },
  }))

  reg(defineTool({
    name: 'zipx_chat',
    description: [
      '把用户的一句自然语言原话交给 ZipX 导演对话系统（POST /api/v3/director/chat），走它自己的意图识别→派发→执行→回执。',
      '这是唯一会让 ZipX 的**自然语言层**真正跑起来的入口：其余 zipx_* 工具都是结构化直呼，绕过了意图识别。',
      '用户说了一句人话（尤其带条件/带对象/带修改意见）时用它，而不是自己拆成结构化调用。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', required: true },
      message: { type: 'string', required: true, description: '用户原话，逐字转交，不要改写' },
      step: { type: 'string', description: '当前阶段 id（可选，前端当前 tab）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: `意图 ${v?.intent_type ?? '?'}｜动作 ${(Array.isArray(v?.actions) ? v.actions.length : 0)} 个｜回执：${String(v?.reply ?? '').slice(0, 400)}`,
      }],
    },
    async execute(args: { project_id: string; message: string; step?: string }) {
      return api.post('/api/v3/director/chat', {
        project_id: args.project_id,
        message: args.message,
        step: args.step ?? '',
        locale: language,
      })
    },
  }))

  reg(defineTool({
    // 2026-11-13：契约能力清单里的 8 个付费动作，有 4 个（modify / style_adjust /
    // batch_modify / restart）此前只能靠 zipx_chat 用人话去触发——那要经过意图分类，
    // 分类错了就变成"改成了别的东西"。这里补上**结构化**写入口：同一个唯一派发口
    // (/dispatch)，动作与参数原样交出，不经过自然语言层。
    name: 'zipx_dispatch',
    description: [
      '结构化写入口：把 action + 参数直接交给 ZipX 的唯一派发口（/dispatch），走它的判决链→执行→回执，不经过自然语言分类。',
      '用于「修改当前这一步」（modify）、「调整风格」（style_adjust）、「批量修改」（batch_modify）、「重跑」（restart）这些没有专用工具的写动作；能用 zipx_regenerate_item 定点改一项就不要整步来。',
      '这些动作都会真的花钱：DSH 原生批准卡会让用户确认；confirm 参数仅为兼容保留，插件层不再信任它。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', required: true },
      action: {
        type: 'string',
        required: true,
        enum: ['modify', 'style_adjust', 'batch_modify', 'restart'],
      },
      instruction: { type: 'string', description: '用户的要求/意见（原话最好，不要改写）' },
      action_params: { type: 'object', additionalProperties: true, description: '动作参数（如 scene/shot/style/scope）' },
      confirm: { type: 'boolean', description: '兼容字段：付费确认已改由 DSH 原生批准卡负责' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaDispatch('zipx_dispatch'),
      render: (_a: unknown, v: any) => {
        const state = String(v?.state ?? '')
        const actions = Array.isArray(v?.actions) ? v.actions.length : 0
        const fired = v?.pipeline_fired === true
        if (state === 'blocked') {
          return [{ type: 'text', text: '没有执行（被拦下）：' + String(v?.reply ?? v?.reason ?? '').slice(0, 300) }]
        }
        return [{
          type: 'text',
          text: '已派发：' + (state || '?') + '｜动作 ' + actions + ' 个｜执行层' + (fired ? '已起跑' : '没有起跑') + '｜回执：' + String(v?.reply ?? '').slice(0, 300),
        }]
      },
    },
    async execute(args: { project_id: string; action: string; instruction?: string; action_params?: Record<string, unknown>; confirm?: boolean }) {
      return api.post('/api/v3/director/dispatch', {
        project_id: args.project_id,
        action: args.action,
        action_params: args.action_params ?? {},
        message: String(args.instruction ?? ''),
        // The human already allowed this exact call through the approval card; the
        // backend still needs its own confirm flag, but the model's boolean is no longer the gate.
        confirm: true,
        language,
      })
    },
  }))

  reg(defineTool({
    name: 'zipx_start',
    description: '启动项目的创作工作流（只跑第一步，之后等待确认）。走 ZipX 后端 start_workflow，不经过导演对话系统。付费生成，调用前先 zipx_project_state 确认是 never_started。',
    parameters: { project_id: { type: 'string', required: true } },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaDispatch('zipx_start'),
      render: (_a: unknown, v: any) => {
        const est = v?.estimate_calls === null || v?.estimate_calls === undefined ? '费用未知' : ('预估 ' + v.estimate_calls + ' credits')
        const bal = v?.balance === null || v?.balance === undefined ? '' : ('，余额 ' + v.balance)
        return [{ type: 'text', text: `已启动：${v?.status ?? 'ok'}（${v?.project_id ?? ''}）；${est}${bal}。完成与否用 zipx_watch_step 确认；到终态后调 zipx_step_result 把产物放回对话。` }]
      },
    },
    async execute(args: { project_id: string }) {
      return api.post(`/api/v3/director/project/${encodeURIComponent(args.project_id)}/start`)
    },
  }))

  reg(defineTool({
    name: 'zipx_confirm_step',
    description: '确认**当前**步骤的产出并起跑下一步生成（= 推进工作流）。只对当前步骤有效：传别的步骤会 409 step_mismatch（不会假报「已确认」）。直接调后端 confirm_step，不经过对话系统。**会花钱**：确认本身不计费，但它会起跑下一步的生成（实测文本步骤扣 10 credits，其余步骤按实际用量）；下一步是链尾时只收尾、不生成。',
    parameters: {
      project_id: { type: 'string', required: true },
      step: { type: 'string', required: true, description: '要确认的步骤 id（如 story/plot_analysis/script/…）' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaDispatch('zipx_confirm_step'),
      // 2026-11-16（P1）：confirm 端点本身是"受理即返回"，在工具里阻塞 90 秒既占住
      // 一轮对话，也仍然无法证明后台真的推进了。现在只回"已受理"，真实进度交给
      // zipx_watch_step 的后台任务；没推进由状态卡如实显示。
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: v?.advanced === true
          ? `已确认推进：当前步骤 ${v?.current_step ?? '?'}`
          : v?.advanced === false
            ? `**没有推进**（仍停在 ${v?.current_step ?? '?'} / ${v?.lifecycle ?? '?'}）：${v?.reason ?? '后台没有把这一步推出去'}`
            : '确认已受理（后台执行）。是否真的推进，用 zipx_watch_step 看真实状态；下一步跑完后调 zipx_step_result 看产物。',
      }],
    },
    async execute(args: { project_id: string; step: string }) {
      const ack = await api.post(`/api/v3/director/project/${encodeURIComponent(args.project_id)}/steps/${encodeURIComponent(args.step)}/confirm`, {})
      return {
        advanced: null,
        dispatched: true,
        state: 'accepted',
        ack,
        project_id: args.project_id,
        step: args.step,
        current_step: args.step,
        lifecycle: 'accepted',
        note: '确认端点已受理；后台若被门禁/交付检查拦下不会推进。用 zipx_watch_step 看真实状态，不要凭这句话说"已完成"。',
      }
    },
  }))

  reg(defineTool({
    name: 'zipx_regenerate_step',
    description: '重做某个步骤（整步推倒重来，昂贵）。直接调后端 regenerate_step。付费生成；能定点精修就优先用 zipx_regenerate_item。',
    parameters: {
      project_id: { type: 'string', required: true },
      step: { type: 'string', required: true },
      edited_content: { type: 'object', additionalProperties: true, description: '用户对本步的修改意见（可选）' },
      ordered: { type: 'boolean', description: '按场景顺序串行生成（可选）' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaDispatch('zipx_regenerate_step'),
      render: (_a: unknown, v: any) => [{ type: 'text', text: `已派发重做：${v?.message ?? v?.status ?? 'ok'}` }],
    },
    async execute(args: { project_id: string; step: string; edited_content?: Record<string, unknown>; ordered?: boolean }) {
      return api.post(`/api/v3/director/project/${encodeURIComponent(args.project_id)}/steps/${encodeURIComponent(args.step)}/regenerate`, {
        edited_content: args.edited_content ?? {},
        ordered: Boolean(args.ordered),
      })
    },
  }))

  reg(defineTool({
    name: 'zipx_regenerate_item',
    description: '定点精修单个镜头/条目（比整步重做便宜，只动一项）。item_index 必须来自 /refine/targets，不要自己推算。',
    parameters: {
      project_id: { type: 'string', required: true },
      step_type: { type: 'string', required: true },
      item_index: { type: 'integer', description: '来自 /refine/targets 的权威下标（或给 scene+shot）' },
      scene: { type: 'integer' },
      shot: { type: 'integer' },
      instruction: { type: 'string' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaDispatch('zipx_regenerate_item'),
      render: (_a: unknown, v: any) => [{ type: 'text', text: `已派发精修：${v?.message ?? v?.status ?? 'ok'}` }],
    },
    async execute(args: { project_id: string; step_type: string; item_index?: number; scene?: number; shot?: number; instruction?: string }) {
      return api.post(`/api/v3/director/project/${encodeURIComponent(args.project_id)}/refine/item`, {
        step_type: args.step_type,
        item_index: args.item_index,
        scene: args.scene,
        shot: args.shot,
        instruction: args.instruction ?? '',
      })
    },
  }))

  reg(defineTool({
    name: 'zipx_rollback_step',
    description: '把某步恢复到上一版本快照（仅重做后 24 小时内、快照存在时可用）。',
    parameters: { project_id: { type: 'string', required: true }, step: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_a: unknown, v: any) => [{ type: 'text', text: `已回退：${v?.message ?? v?.status ?? 'ok'}` }] },
    async execute(args: { project_id: string; step: string }) {
      return api.post(`/api/v3/director/project/${encodeURIComponent(args.project_id)}/steps/${encodeURIComponent(args.step)}/rollback`, {})
    },
  }))

  reg(defineTool({
    name: 'zipx_resume_step',
    description: '续跑失败/中断的步骤（保留已有中间产物，只重试缺失部分）。',
    parameters: { project_id: { type: 'string', required: true }, step: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, presentationMeta: metaDispatch('zipx_resume_step'), render: (_a: unknown, v: any) => [{ type: 'text', text: `已续跑：${v?.message ?? v?.status ?? 'ok'}` }] },
    async execute(args: { project_id: string; step: string }) {
      return api.post(`/api/v3/director/project/${encodeURIComponent(args.project_id)}/steps/${encodeURIComponent(args.step)}/resume`, {})
    },
  }))

  reg(defineTool({
    name: 'zipx_get_blueprint',
    description: '读取 ZipX 项目的最新创作蓝图（8 项：题材/形态平台/集数时长/章节规格/视觉风格/角色/禁忌/验收偏好）。没有返回 payload=null。',
    parameters: {
      project_id: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: v?.payload
          ? `第 ${v.version} 版蓝图：` + JSON.stringify(v.payload)
          : '还没有创作蓝图。',
      }],
    },
    async execute(args: { project_id: string }) {
      return api.get(`/api/v3/director/blueprint/${encodeURIComponent(args.project_id)}/intake`)
    },
  }))

  reg(defineTool({
    name: 'zipx_update_blueprint',
    description: [
      '写入/更新 ZipX 创作蓝图。genre（作品类型/题材）必填；其余 7 项可后改。',
      '这是创作开始前的规格，不是生成动作——它不产生付费调用。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', required: true },
      blueprint: {
        type: 'object',
        additionalProperties: true,
        description: '8 项字段：genre/form/platform/episodes/duration_s/chapters/words_per_chapter/visual_style/style_refs/characters/taboos/trust_level/budget_cap/notes',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: `蓝图已保存（第 ${v?.version ?? '?'} 版）：${v?.payload?.genre ?? ''}`,
      }],
    },
    async execute(args: { project_id: string; blueprint: Record<string, unknown> }) {
      return api.put(`/api/v3/director/blueprint/${encodeURIComponent(args.project_id)}/intake`,
        args.blueprint ?? {})
    },
  }))

  reg(defineTool({
    name: 'zipx_watch_turn',
    description: [
      '盯住 ZipX 的一轮任务直到终态（done/blocked/failed/indeterminate），返回回执。',
      '派发后用户问「好了吗」时用它，不要凭感觉回答；任务完成时会把任务报告注入回对话。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', required: true },
      turn_id: { type: 'string', required: true },
      max_seconds: { type: 'integer', description: '最长等待秒数，默认 300' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: `${v?.state ?? '?'}（${v?.pipeline_fired ? '已派发' : '未派发'}）${v?.reply ? '：' + v.reply : ''}`,
      }],
    },
    async execute(args: { project_id: string; turn_id: string; max_seconds?: number }, exec: any) {
      const deadline = Date.now() + Math.max(10, Number(args.max_seconds ?? 300)) * 1000
      // dispatched/running 不是终态：计划派发后后台还在跑，必须继续盯。
      const terminal = new Set(['done', 'blocked', 'failed', 'indeterminate', 'needs_user'])
      let last: any = null
      while (Date.now() < deadline) {
        last = await api.get(`/api/v3/director/turn/${encodeURIComponent(args.project_id)}/${encodeURIComponent(args.turn_id)}`)
        if (terminal.has(String(last?.state))) break
        await new Promise(r => setTimeout(r, 3000))
      }
      // M3：任务完成后把报告回注进对话（agent.inject 收的是 UserMessage，必须有 role；
      // 早期版本漏了 role，provider 报 messages[N] missing field role）。
      const report = last?.report?.reports
      if (last && report && exec?.agent?.inject) {
        try {
          exec.agent.inject({
            role: 'user',
            content: [{ type: 'text', text: 'ZipX 任务报告：' + JSON.stringify(report) }],
            source: { kind: 'zipx-report' },
          })
        } catch { /* 回注是增强，失败不影响回执 */ }
      }
      return last ?? { state: 'unknown' }
    },
  }))

  reg(defineTool({
    name: 'zipx_watch_step',
    description: [
      '盯住某个步骤直到真实状态变化（不读旧对话表，直接读 ZipX 后端 WorkState 事实）。',
      '默认启动 DSH 后台任务并立即返回 job id：进度在标题栏任务列表里，完成会通知模型，不阻塞对话。',
      '完成通知会带这一步的产物摘要与正文节选；收到后用 zipx_step_result 把结果卡片显示给用户。',
      '终态：当前步骤已不是该步（= 已推进）／该步 is_complete／lifecycle=awaiting_confirm（等待确认）／lifecycle 失败。',
      '没有 jobs 服务的 profile 会退回阻塞等待（如实说明）。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', required: true },
      step: { type: 'string', required: true, description: '正在执行的步骤 id' },
      max_seconds: { type: 'integer', description: '最长等待秒数，默认 1800（30 分钟）；长步骤可显式加长' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaWatch,
      render: (_a: unknown, v: any) => {
        if (v?.mode === 'background' || v?.job_id) {
          return [{ type: 'text', text: `已派发后台跟踪（job ${v?.job_id ?? '?'}）：完成会通知，不需要轮询。取消只停止跟踪，后端可能仍在生成。` }]
        }
        const base = `当前 ${v?.current_step ?? '?'} / ${v?.lifecycle ?? '?'} / 产出 ${v?.produced ?? '?'}/${v?.expected ?? '?'}${v?.is_locked ? '（生成中）' : ''}，门禁 ${v?.gates ?? 'unchecked'}${v?.timed_out ? '｜已到等待上限，**没等到终态**（不等于完成）' : ''}`
        const p = v?.preview
        if (!p) return [{ type: 'text', text: base }]
        // 终态：把"生成了什么"写进回执（不是只有 1/1）。
        const gate = p.gate && p.gate !== 'unchecked'
          ? '门禁 ' + p.gate + (p.score == null ? '' : '（' + Number(p.score).toFixed(2) + '/' + (p.threshold ?? '?') + '）')
          : '门禁未检查'
        return [{
          type: 'text',
          text: [
            (p.label || v?.current_step || '') + ' 完成 · ' + (p.summary || '已生成') + ' · ' + gate +
              (p.media_count ? (' · 媒体 ' + p.media_count + ' 个') : ''),
            p.excerpt ? ('节选：' + String(p.excerpt).replace(/\s+/g, ' ').slice(0, 240)) : '',
            '（卡片里可看/播放媒体；完整产物用 zipx_step_result）',
          ].filter(Boolean).join('\n'),
        }]
      },
    },
    async execute(args: { project_id: string; step: string; max_seconds?: number }, exec: any) {
      const projectId = String(args.project_id)
      const step = String(args.step)
      const maxSeconds = Number(args.max_seconds ?? 1800)
      const jobs = (() => { try { return (ctx as any).get('jobs') } catch { return undefined } })()
      if (jobs && typeof jobs.start === 'function') {
        const owner = keyOf(exec)
        let jobId = ''
        try {
          jobId = String(jobs.start({
            kind: 'zipx-step',
            label: 'ZipX ' + step + ' · ' + projectId,
            ...(owner ? { owner } : {}),
            run(job: any) {
              let stopped = false
              const done = (async () => {
                const result = await waitStep(projectId, step, maxSeconds, {
                  shouldStop: () => stopped,
                  onProgress: (p: any) => {
                    try {
                      job.updateProgress((p.step || step) + ' · ' + (p.lifecycle || '') + ' ' + (p.produced ?? '?') + '/' + (p.expected ?? '?'))
                    } catch { /* progress is best-effort */ }
                  },
                })
                if (result?.stopped) return { status: 'killed', detail: '已请求中止；已发出的付费调用可能仍完成', result: JSON.stringify(result) }
                const preview = result?.preview
                const stateLine = (result?.current_step || '') + ' · ' + (result?.lifecycle || '') + ' · ' + (result?.produced ?? '?') + '/' + (result?.expected ?? '?')
                const timedOut = Boolean(result?.timed_out)
                // 完成回执先说"产出了什么"，再说状态：用户/模型第一眼要看到结果，不是计数器。
                const detail = (timedOut ? '未到终态（等待上限，不等于完成）· ' : '') + (preview
                  ? (preview.label + ' 完成 · ' + (preview.summary || '已生成')
                     + ' · 门禁 ' + (preview.gate || 'unchecked')
                     + (preview.media_count ? (' · 媒体 ' + preview.media_count + ' 个') : '')
                     + ' · ' + stateLine)
                  : stateLine)
                try {
                  job.append(detail + '\n')
                  if (preview) job.append('看完整产物：zipx_step_result(step="' + String(step) + '")；卡片可看/播放媒体。\n')
                  if (timedOut && !preview) job.append('后台仍在执行；要继续盯请再调 zipx_watch_step(step="' + String(step) + '", max_seconds=...)。\n')
                } catch { /* ring closed */ }
                return { status: 'completed', detail, result: JSON.stringify(result) }
              })().catch((error: any) => ({ status: 'failed', detail: String(error?.message || error) }))
              return {
                cancel() {
                  stopped = true
                  // Cancelling the DSH job must also stop the real generation, not just the polling.
                  void api.post(`/api/v3/director/project/${encodeURIComponent(projectId)}/abort`, { reason: 'dsh_job_cancel' })
                    .catch((error: any) => console.warn('[zipx-director] abort on job cancel failed: ' + String(error?.message || error)))
                },
                done,
              }
            },
          }))
        } catch (error) {
          console.warn('[zipx-director] background job unavailable, falling back to blocking watch: ' + String((error as any)?.message || error))
          jobId = ''
        }
        if (jobId) {
          return {
            mode: 'background',
            job_id: jobId,
            project_id: projectId,
            step,
            note: '已派发后台跟踪；完成会通知。取消只停止跟踪，ZipX 后端可能仍在生成。',
          }
        }
      }
      return waitStep(projectId, step, maxSeconds)
    },
  }))

  reg(defineTool({
    name: 'zipx_abort',
    description: [
      '中止当前步骤的生成任务（用户说「停下/别做了/取消」时用）。',
      '复用 ZipX 既有的 abort 实现：置中止标志、强制释放执行锁、把项目状态置 failed、写活动日志。',
      '诚实边界：已经发出的付费调用可能仍会完成，但后续步骤不会再继续；返回值是「已登记中止」，不是「已退回积分」。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' },
      reason: { type: 'string', description: '中止原因（写入审计，可选）' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaDispatch('zipx_abort'),
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: v?.aborted
          ? '已登记中止：' + (v?.step || '') + '。已发出的付费调用可能仍会完成，但后续步骤不会再继续。'
          : '中止没有生效：' + String(v?.message ?? v?.reason ?? JSON.stringify(v).slice(0, 160)),
      }],
    },
    async execute(args: { project_id?: string; reason?: string }, exec: any) {
      const id = args.project_id || await resolveProject(args, exec)
      return api.post(`/api/v3/director/project/${encodeURIComponent(id)}/abort`, {
        reason: String(args.reason || 'dsh_cancel'),
      })
    },
  }))

  reg(defineTool({
    name: 'zipx_timeline',
    description: '读取项目创作事件时间线（因果链：turn/任务/门禁/产物/专家报告），替代旧对话回执。用户问"刚才发生了什么/为什么是这个结果"时用它。',
    parameters: { project_id: { type: 'string', required: true }, limit: { type: 'integer', description: '最多返回条数，默认 40' } },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: (() => {
          const list = Array.isArray(v) ? v : (v?.events ?? [])
          return list.slice(-12).map((e: any) => `${e.event_type ?? e.type ?? ''} · ${e.summary ?? ''} · ${e.step ?? ''}`).join('\n')
        })(),
      }],
    },
    async execute(args: { project_id: string; limit?: number }) {
      return api.get(`/api/v3/creative-os/timeline/${encodeURIComponent(args.project_id)}?limit=${Number(args.limit ?? 40)}`)
    },
  }))

  reg(defineTool({
    name: 'zipx_list_episodes',
    description: '列出主项目下的剧集子项目（id/集号/状态/当前步骤）。确认整部剧的分集推进时用它。',
    parameters: { project_id: { type: 'string', required: true } },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => {
        const eps = Array.isArray(v?.episodes) ? v.episodes : []
        if (!eps.length) {
          return [{ type: 'text', text: `共 ${v?.total_episodes ?? '?'} 集（父状态 ${v?.parent_status ?? '?'}），但读不到子项目列表——可能是单集项目，或子项目还没建。` }]
        }
        const lines = [`共 ${v?.total_episodes ?? eps.length} 集（父状态 ${v?.parent_status ?? '?'}）：`]
        for (const e of eps) lines.push('- 第' + (e.episode_number ?? '?') + '集 ' + (e.title || '') + '｜' + (e.current_step || '?') + '｜' + (e.status || '') + '｜' + e.id)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: { project_id: string }) {
      return api.get(`/api/v3/director/project/${encodeURIComponent(args.project_id)}/episodes`)
    },
  }))

  reg(defineTool({
    name: 'zipx_start_episode',
    description: '启动某个剧集子项目的工作流（只跑该集第一步）。付费生成。',
    parameters: {
      project_id: { type: 'string', required: true },
      episode_id: { type: 'string', required: true, description: '来自 zipx_list_episodes 的剧集子项目 id' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaDispatch('zipx_start_episode'),
      render: (_a: unknown, v: any) => [{ type: 'text', text: `已启动剧集：${v?.status ?? 'ok'}` }],
    },
    async execute(args: { project_id: string; episode_id: string }) {
      return api.post(`/api/v3/director/project/${encodeURIComponent(args.project_id)}/episodes/${encodeURIComponent(args.episode_id)}/start`, {})
    },
  }))

  reg(defineTool({
    name: 'zipx_read_asset',
    description: '读取某一步产物正文（剧本/创意简报/故事等），按创作者意图打磨时用它看具体内容，而不是只看门禁分数。内容可能很长，render 只给摘要。',
    parameters: {
      project_id: { type: 'string', required: true },
      step: { type: 'string', required: true, description: '步骤 id，如 story/script/campaign_brief/episode_design' },
      max_chars: { type: 'integer', description: '正文显示上限（默认 12000，最大 40000；故事全文约 1.6 万字符）' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaAsset,
      render: (args: any, v: any) => {
        if (v?.content == null) return [{ type: 'text', text: `（${v?.step ?? ''} 无产物）` }]
        // 2026-11-17：以前这里直接 JSON.stringify 前 6000 字 —— 故事 1.6 万字、剧本 5 万字符，
        // 模型看到的是被截断的 JSON 结构而不是正文。先取人能读的正文，取不到才回退 JSON。
        const limit = Math.max(1000, Math.min(Number(args?.max_chars) || 12000, 40000))
        const body = assetMainText(v.content) || JSON.stringify(v.content)
        const note = body.length > limit ? `；正文共 ${body.length} 字符，这里只给前 ${limit} 字符` : ''
        return [{ type: 'text', text: `${v?.step ?? ''} 产物（${v?.raw_len ?? '?'} 字符${note}）：\n` + body.slice(0, limit) }]
      },
    },
    async execute(args: { project_id: string; step: string }) {
      return api.get(`/api/v3/director/asset/${encodeURIComponent(args.project_id)}?step=${encodeURIComponent(args.step)}`)
    },
  }))

  reg(defineTool({
    name: 'zipx_advance_preflight',
    description: '推进前同步预检：读出下一步会被什么门禁拦下（场景契约/四锁签收），以及怎么放行。zipx_confirm_step 报"已确认"却不动时，先用它拿原因，不要盲猜。',
    parameters: {
      project_id: { type: 'string', required: true },
      step: { type: 'string', required: true, description: '要确认/推进的当前步骤 id' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: v?.error
          ? `推进会被拦：${v.error}${v.hint ? '\n' + v.hint : ''}`
          : `可以推进（无阻塞）。`,
      }],
    },
    async execute(args: { project_id: string; step: string }) {
      return api.get(`/api/v3/director/advance-status/${encodeURIComponent(args.project_id)}?step=${encodeURIComponent(args.step)}`)
    },
  }))

  reg(defineTool({
    name: 'zipx_progress',
    description: '读取项目最近的实时进度（report/gate/artifact/knowledge 等活动轨迹，人话标题）。用户问"现在在做什么/做到哪了"时用它，比只读 state 更细。',
    parameters: { project_id: { type: 'string', required: true }, limit: { type: 'integer', description: '最多返回条数，默认 20' } },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: ((v?.activities ?? []).slice(-10).map((e: any) => `${e.kind ?? ''} · ${e.title ?? ''}`).join('\n')),
      }],
    },
    async execute(args: { project_id: string; limit?: number }) {
      return api.get(`/api/v3/director/progress/${encodeURIComponent(args.project_id)}?limit=${Number(args.limit ?? 20)}`)
    },
  }))

  reg(defineTool({
    name: 'zipx_review_project',
    description: [
      '只读评审：汇总项目门禁、专家报告与最近事件，给出"哪里好/哪里还能更好"的事实依据。',
      '不产生付费调用、不写库；需要具体修改时再走 zipx_confirm_step / zipx_regenerate_step / zipx_regenerate_item。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        // 关键：模型只能读到 render 产出的文本，读不到 canonical JSON——
        // 所以评审的每步分数/覆盖度/下一步必须写进 render，否则模型只能看到一句摘要。
        text: [
          `门禁总体：${v?.gates ?? 'unchecked'}`,
          `当前步骤：${v?.current_step ?? ''}`,
          `每步门禁：${JSON.stringify(v?.gate_entries ?? [])}`,
          `专家覆盖：${JSON.stringify(v?.expert_coverage ?? {})}`,
          `下一步：${JSON.stringify(v?.next_action ?? null)}`,
          `最近事件：${JSON.stringify((v?.recent_events ?? []).slice(-5))}`,
        ].join('\n'),
      }],
    },
    async execute(args: { project_id: string }) {
      const overview: any = await api.get(`/api/v3/creative-os/overview/${encodeURIComponent(args.project_id)}`)
      const gates = overview?.gates ?? {}
      const tasks = Array.isArray(overview?.tasks) ? overview.tasks : []
      const events = Array.isArray(overview?.events) ? overview.events : []
      return {
        gates: gates.overall ?? 'unchecked',
        by_tier: gates.by_tier ?? {},
        // 每步的门禁条目（含分数与判词）——这是"质量结论"的事实来源
        gate_entries: (gates.gates ?? []).slice(0, 12),
        current_step: overview?.step ?? '',
        expert_coverage: overview?.expert_coverage ?? {},
        tasks: tasks.slice(0, 5),
        recent_events: events.slice(-8),
        next_action: overview?.next_action ?? null,
      }
    },
  }))

  reg(defineTool({
    name: 'zipx_turn_receipt',
    description: [
      '（旧通道）读取 dialogue_turns 回执——v4 的 DSH 入口走步骤端点、不写这张表，所以一般查不到。',
      '新路径用 zipx_watch_step / zipx_timeline 看真实进度与事件。保留本工具仅为兼容旧前端留下的历史轮次。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', required: true, description: 'ZipX 项目 id（uuid）' },
      turn_id: { type: 'string', required: true, description: 'dialogue_turns.id 或 turn_trace_id' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, v: any) => [{
        type: 'text',
        text: `第 ${v?.turn_id ?? ''} 轮：${v?.state ?? '?'}${v?.pipeline_fired ? '（已真实派发）' : '（未派发）'}，活动 ${(v?.activities ?? []).length} 条。`,
      }],
    },
    async execute(args: { project_id: string; turn_id: string }) {
      return api.get(`/api/v3/director/turn/${encodeURIComponent(args.project_id)}/${encodeURIComponent(args.turn_id)}`)
    },
  }))

  reg(defineTool({
    name: 'zipx_get_locks',
    description: '读取项目四锁状态（Story/Look/Coverage/Picture 的签收情况与可用性）。premium 档剧集推进前若被「Story Lock 未签收」拦住，先用它看哪些锁还差，再用 zipx_sign_lock 签收。',
    parameters: { project_id: { type: 'string', required: true } },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaLocks,
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: v && v.locks
          ? '四锁：' + Object.entries(v.locks).map(function (kv) { var k = kv[0]; var s = kv[1] as any; return k + '=' + ((s && s.signed) ? '已签' : '未签') + ((s && s.available) ? '' : '（无产物）'); }).join('，') + '；全部签收=' + (v.all_signed ? '是' : '否')
          : JSON.stringify(v),
      }],
    },
    async execute(args: { project_id: string }) {
      return api.get('/api/v3/director/project/' + encodeURIComponent(args.project_id) + '/locks')
    },
  }))

  reg(defineTool({
    name: 'zipx_sign_lock',
    description: '签收某一锁（如 story）。调用前先 zipx_get_locks 确认该锁 available（对应阶段有产物）且未签；若场景契约未通过，非 force 签收会 409。note 记录签收理由（审计）。',
    parameters: {
      project_id: { type: 'string', required: true },
      lock: { type: 'string', required: true, enum: ['story', 'look', 'coverage', 'picture'] },
      note: { type: 'string', description: '签收理由（写入审计）' },
    },
    output: {
      schema: { type: 'json' },
      render: (a: any, v: any) => [{ type: 'text', text: (v && v.ok) ? ('已签收 ' + (a?.lock || v.lock || '')) : ('签收失败：' + JSON.stringify(v).slice(0, 200)) }],
    },
    async execute(args: { project_id: string; lock: string; note?: string }) {
      return api.post('/api/v3/director/project/' + encodeURIComponent(args.project_id) + '/locks/' + encodeURIComponent(args.lock) + '/sign', {
        note: args.note || '',
        evidence: { source: 'dsh' },
        force: false,
      })
    },
  }))


  /** 资产正文 -> 人能读的文本（与后端 step_result 的取法同序，缺了就回退 JSON）。 */
  function assetMainText(content: any): string {
    if (!content || typeof content !== 'object') return ''
    const keys = ['story_text', 'script_text', 'creative_script_text', 'treatment_text', 'hook', 'logline', 'synopsis', 'summary']
    for (const key of keys) {
      const value = content[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    if (Array.isArray(content.chapters) && content.chapters.length) {
      return content.chapters.slice(0, 6).map((chapter: any) => {
        const title = String(chapter?.chapter_title ?? '')
        const number = chapter?.chapter_number ?? ''
        const body = String(chapter?.chapter_text ?? '')
        return ('第' + number + '章 ' + title).trim() + '\n' + body
      }).filter(Boolean).join('\n\n')
    }
    if (Array.isArray(content.scene_scripts) && content.scene_scripts.length) {
      return content.scene_scripts.slice(0, 6).join('\n\n')
    }
    return ''
  }

  /* ── P2：会话绑定 + 契约 v5 新工具（项目库/总览/产物/交付/成本/修复/连接） ───────── */

  // 会话-项目绑定：键是 Agent（=DSH 会话）id，进程内有效；同时写 ZipX 的 external_sessions 做持久化。
  function keyOf(exec: any): string {
    const agent = exec && exec.agent
    return String((agent && (agent.id || (agent.session && agent.session.id))) || '')
  }
  /**
   * 解析本会话的项目。**没有全局兜底**：新会话不会继承上一个项目。
   * 顺序：显式 project_id → 进程内缓存 → ZipX external_sessions 后端恢复。
   * 恢复不到就报"未绑定"，让模型先 list_projects / bind_project。
   */
  async function resolveProject(args: any, exec: any): Promise<string> {
    const explicit = String((args && args.project_id) || '')
    const key = keyOf(exec)
    if (explicit) {
      if (key) sessionBindings.set(key, explicit)
      return explicit
    }
    if (!key) throw new Error(noProjectHint())
    const cached = sessionBindings.get(key)
    if (cached) return cached
    try {
      const bound: any = await api.get('/api/v3/director/session/' + encodeURIComponent(key))
      const projectId = String(bound?.project_id || '')
      if (projectId && bound?.revoked !== true) {
        sessionBindings.set(key, projectId)
        return projectId
      }
    } catch (error) {
      // 后端不认识这个会话（404）或暂时连不上：下面统一给"未绑定"提示，不猜项目。
    }
    throw new Error(noProjectHint())
  }
  function noProjectHint(): string {
    return '本会话还没有绑定项目（也不会继承上一个会话的项目）。先 zipx_list_projects 让用户挑，再用 zipx_bind_project 绑定；之后可以省略 project_id。'
  }

  /**
   * One real WorkState wait, shared by the blocking fallback and the background job.
   * It never reports "done" merely because the deadline expired.
   */
  async function waitStep(projectId: string, step: string, maxSeconds: number, opts: { onProgress?: (p: any) => void; shouldStop?: () => boolean } = {}): Promise<any> {
    const startedAt = Date.now()
    const deadline = startedAt + Math.max(10, Number(maxSeconds || 1800)) * 1000
    let last: any = null
    let baselineFailed = false
    let baselineProduced: number | null = null
    let sawLock = false
    let progressed = false
    let failedAfterBaseline = false
    let polls = 0
    while (Date.now() < deadline) {
      if (opts.shouldStop && opts.shouldStop()) {
        return { stopped: true, current_step: last?.project?.current_step ?? step, lifecycle: last?.current?.lifecycle ?? '', note: '已请求中止；已发出的付费调用可能仍完成，但后续步骤不会继续。' }
      }
      last = await api.get('/api/v3/director/state/' + encodeURIComponent(projectId) + '?language=zh')
      const cur = last?.current ?? {}
      const produced = typeof cur?.produced === 'number' ? cur.produced : null
      const isFailed = ['failed', 'processing_failed'].includes(String(cur?.lifecycle ?? ''))
      if (polls === 0) {
        baselineFailed = isFailed
        baselineProduced = produced
      } else {
        if (isFailed && !baselineFailed) failedAfterBaseline = true
        if (produced !== null && baselineProduced !== null && produced !== baselineProduced) progressed = true
      }
      polls += 1
      if (cur?.is_locked) sawLock = true
      if (opts.onProgress) {
        opts.onProgress({
          step: last?.project?.current_step ?? step,
          lifecycle: cur?.lifecycle ?? '',
          produced: cur?.produced ?? null,
          expected: cur?.expected ?? null,
          locked: Boolean(cur?.is_locked),
        })
      }
      const moved = last?.project?.current_step !== step
      const done = Boolean(cur?.is_complete)
      // story/script 等步骤的终态是 awaiting_confirm，而 is_complete 仍为 false；
      // 只认 is_complete 会让 watch 一直等到超时（真机：故事完成后又白等 30 分钟）。
      const awaiting = ['awaiting_confirm', 'awaiting_confirmation', 'waiting_confirmation'].includes(String(cur?.lifecycle ?? ''))
      if (moved || done || awaiting) break
      if (isFailed && (failedAfterBaseline || progressed || sawLock)) break
      if (baselineFailed && !sawLock && !progressed && Date.now() - startedAt > 45000) break
      await new Promise(resolve => setTimeout(resolve, 4000))
    }
    const cur = last?.current ?? {}
    const runDetected = sawLock || progressed || failedAfterBaseline
    const timedOut = Date.now() >= deadline
    const failedNow = ['failed', 'processing_failed'].includes(String(cur?.lifecycle ?? ''))
    const awaitingNow = ['awaiting_confirm', 'awaiting_confirmation', 'waiting_confirmation'].includes(String(cur?.lifecycle ?? ''))
    const finished = !timedOut && (Boolean(cur?.is_complete) || last?.project?.current_step !== step || failedNow || awaitingNow)
    // 2026-11-17：完成通知只有 WorkState 时，用户看不到"生成了什么"。终态时顺手取一步
    // 预览（正文节选 + 前 2 个媒体 + 门禁），让回执自己带上结果，而不是只报 1/1。
    let preview: any = null
    if (finished) {
      try {
        // brief=1：后端同一份预览的紧凑回执（<2KB，整段塞进 DSH 完成通知）。
        const p: any = await api.get('/api/v3/director/project/' + encodeURIComponent(projectId)
          + '/result?step=' + encodeURIComponent(step) + '&brief=1&max_chars=360&max_media=2&language=' + encodeURIComponent(language))
        if (p && (p.summary || p.excerpt || p.media_count)) {
          const media = Array.isArray(p.media) ? p.media.slice(0, 2) : []
          preview = {
            label: p.label || step,
            summary: p.summary || '',
            gate: p.gate?.overall || 'unchecked',
            score: p.gate?.score ?? null,
            threshold: p.gate?.threshold ?? null,
            excerpt: String(p.excerpt || '').slice(0, 360),
            media_count: p.media_count || media.length,
            media: media.map((m: any) => ({ label: m.label, kind: m.kind, url: m.url })),
            next_tool: 'zipx_step_result',
          }
        }
      } catch (error) {
        // 预览读不到不改变"这一步完成没完成"的事实；如实留空。
        console.warn('[zipx-director] step result preview failed: ' + String((error as any)?.message || error))
      }
    }
    return {
      timed_out: timedOut,
      current_step: last?.project?.current_step ?? step,
      lifecycle: cur?.lifecycle ?? '',
      produced: cur?.produced ?? null,
      expected: cur?.expected ?? null,
      is_complete: Boolean(cur?.is_complete),
      is_locked: Boolean(cur?.is_locked),
      gates: last?.gates?.overall ?? 'unchecked',
      legal_actions: last?.legal_actions_human ?? [],
      failed_before_dispatch: baselineFailed,
      new_run_detected: runDetected,
      is_done: (Boolean(cur?.is_complete) || awaitingNow) && !timedOut,
      preview,
      note: !runDetected && baselineFailed && Boolean(cur?.is_complete) === false
        ? '该步骤在本次派发之前就已经是 failed，等待期间没有观察到新的执行迹象（未加锁、产出数未变）——不能据此断定这次派发失败。'
        : '',
    }
  }

  reg(defineTool({
    name: 'zipx_connect',
    description: '查看 DSH 与 ZipX 的连接状态：连的是哪个账号、哪台设备、什么时候过期、渠道是否开放、写模式。用户问「连上了吗/我是哪个账号/还能用多久」时先调它。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      presentationMeta: metaConnect,
      render: (_a: unknown, v: any) => {
        if (!v || v.channel_state === undefined) return [{ type: 'text', text: '读不到连接状态：' + JSON.stringify(v).slice(0, 200) }]
        const lines = [
          '渠道：' + (v.channel_state === 'enabled' ? '已开放' : '未开放') + '（' + (v.channels || []).join('/') + '）',
          '账号：' + (v.account || '未知'),
          '设备：' + (v.device || '未知'),
          '过期：' + (v.expires_at || '未知'),
          '写模式：' + (v.write_mode || '未知'),
          '付费确认：' + (v.dsh_paid_confirmation === 'native-approval'
            ? 'DSH 批准卡'
            : v.dsh_paid_confirmation === 'one-time-card'
              ? '一次性确认卡（本会话审批被关闭，仍需要你点允许）'
              : v.dsh_paid_confirmation === 'unavailable'
                ? '不可用（付费动作会被拒绝；请切到「询问」）'
                : '未知'),
          '本次进程注册的工具：' + (v.dsh_tools ?? '未知') + ' 个',
        ]
        if (v.channel_state !== 'enabled' && v.hint) lines.push(v.hint)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_args: any, exec: any) {
      const caps: any = await api.get('/api/v3/director/capabilities')
      // 工具面由 Host 侧真实注册表给出：「注册了 N 个」不该靠数提示词。
      const mode = paidConfirmationMode(exec)
      return caps && typeof caps === 'object'
        ? {
            ...caps,
            dsh_tools: registered.length,
            dsh_paid_confirmation: mode === 'native' ? 'native-approval' : mode === 'question' ? 'one-time-card' : 'unavailable',
          }
        : caps
    },
  }))

  reg(defineTool({
    name: 'zipx_list_projects',
    description: '列出当前账号的 ZipX 项目库（标题、当前步骤、门禁三态、更新时间），支持搜索与分页。用户问「我有哪些项目/哪部片子卡住了」时用它，不要凭记忆答。',
    parameters: {
      page: { type: 'number', description: '页码，默认 1' },
      page_size: { type: 'number', description: '每页条数，默认 20，上限 100' },
      status: { type: 'string', description: '只列某种状态（可选：draft/generating/completed/failed/archived）' },
      q: { type: 'string', description: '搜索标题与创意母本（可选）' },
      include_archived: { type: 'boolean', description: '是否把已归档项目也算进来（默认不算）' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaProjects,
      render: (_a: unknown, v: any) => {
        const items = (v && v.items) || []
        if (!items.length) return [{ type: 'text', text: '项目库是空的，或读不到（' + JSON.stringify(v).slice(0, 160) + '）' }]
        const gateText: any = { pass: '通过', warn: '有警告', fail: '未通过', unchecked: '未检查', unknown: '未知' }
        const lines = ['共 ' + (v.total || items.length) + ' 个项目（第 ' + (v.page || 1) + ' 页）']
        for (const it of items) {
          lines.push('- ' + (it.title || it.id) + '｜' + (it.current_step || '?') + '｜门禁 ' + (gateText[it.gates] || '未知') + '｜' + it.id)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: any) {
      const q = new URLSearchParams()
      q.set('page', String(args?.page || 1))
      q.set('page_size', String(Math.min(Number(args?.page_size) || 20, 100)))
      q.set('gates', '1')
      if (args?.status) q.set('status', String(args.status))
      if (args?.q) q.set('q', String(args.q))
      if (args?.include_archived === true) q.set('include_archived', '1')
      return api.get('/api/v3/director/projects?' + q.toString())
    },
  }))

  reg(defineTool({
    name: 'zipx_create_project',
    description: '新建一个 ZipX 项目（只建，不开工、不花钱；走 /api/v3/director/setup）。返回 project_id 后建议调用 zipx_bind_project 绑到本会话。**initial_content 必填**：故事步骤只读 project.input_prompt，不读 title/genre/蓝图；不传就会按「请创作一个有趣的故事」的占位提示生成跑题故事（2026-11-17 真机：科幻政治惊悚被写成乡村染坊悬疑）。mode 决定工作流：idea=创意→视频、novel=小说原文→视频、script=剧本→视频（script 不重复生成故事）。',
    parameters: {
      title: { type: 'string', required: true, description: '项目标题' },
      genre: { type: 'string', required: true, description: '题材，如 悬疑/科幻/都市' },
      mode: { type: 'string', description: '创作模式：idea（默认，创意→视频）/ novel（小说原文→视频）/ script（剧本→视频）', enum: ['idea', 'novel', 'script'] },
      initial_content: { type: 'string', required: true, description: '创意母本：用户的故事想法/小说原文/剧本全文（逐字传入，不要概括）。会写入 project.input_prompt，故事/剧本步骤直接读它。' },
      form: { type: 'string', description: '形态：film 短片 / series 剧集（可选）' },
      episodes: { type: 'number', description: '集数（剧集时需要；会写入 story_requirements.chapter_count，故事按章生成）' },
      duration_s: { type: 'number', description: '单集/整片时长秒数（会写入 target_runtime_s，分镜/剪辑/门禁共用这个数）' },
      words_per_chapter: { type: 'number', description: '每章字数（可选；剧集默认 1200）' },
      creation_template: { type: 'string', description: '创作模板 id（binge_drama/cinematic_drama/…；不传用后端默认）' },
      custom_style_notes: { type: 'string', description: '风格补充（可选）' },
      story_characters: { type: 'string', description: '主要人物（可选，写入 story_requirements.characters）' },
      story_worldbuilding: { type: 'string', description: '世界观/禁忌（可选，写入 story_requirements.worldbuilding）' },
      director_archetype: { type: 'string', description: '导演原型 id（zhang_yimou/li_an/hou_xiaoxian/wang_jiawei/spielberg/nolan/fincher/dongman/sweet_romance；不传=后端默认张艺谋）' },
      visual_style: { type: 'string', description: '视觉风格 id（cinematic/noir/…；不传=原型默认）' },
      aspect_ratio: { type: 'string', description: '画幅 9:16 / 16:9 / 1:1（不传=9:16）' },
      platform: { type: 'string', description: '目标平台 honguo/tiktok/bilibili/…（不传=后端默认）' },
      content_language: { type: 'string', description: '内容语言 zh / en（不传=zh）' },
      creator_mode: { type: 'string', description: '创作模式档位 easy（自动巡航）/ director（逐步精制）；不传=账号默认', enum: ['easy', 'director'] },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{ type: 'text', text: v && v.project_id ? ('已创建：' + v.project_id + '（还没有开工，要开始创作请说「开始做第一步」）') : ('建项目失败：' + JSON.stringify(v).slice(0, 200)) }],
    },
    async execute(args: any, exec: any) {
      const initialContent = String(args.initial_content || '').trim()
      if (!initialContent) {
        throw new Error('zipx_create_project 需要 initial_content（创意母本）。故事步骤只读 project.input_prompt；只给 title/genre 会让作家按占位提示写一个跑题故事。先让用户给出故事想法/原文，再建项目。')
      }
      // 三模式 → workflow_type（唯一映射表；/setup 是唯一读它的创建入口）。
      const MODES: any = { idea: 'idea2video', novel: 'novel2video', script: 'script2video' }
      const mode = String(args.mode || 'idea')
      const workflowType = MODES[mode] || 'idea2video'
      const storyRequirements: any = {}
      // 剧本模式不按章生成（script2video 直接解析场次），只有创意/小说模式吃章节规格。
      if (args.episodes && args.form !== 'film' && workflowType !== 'script2video') {
        storyRequirements.chapter_count = Number(args.episodes)
      }
      const wordsPerChapter = args.words_per_chapter ? Number(args.words_per_chapter) : (storyRequirements.chapter_count ? 1200 : 0)
      if (wordsPerChapter > 0) storyRequirements.words_per_chapter = wordsPerChapter
      if (args.story_characters) storyRequirements.characters = String(args.story_characters)
      if (args.story_worldbuilding) storyRequirements.worldbuilding = String(args.story_worldbuilding)
      const body = {
        title: String(args.title || '').trim(),
        genre: String(args.genre || '').trim(),
        initial_content: initialContent,
        workflow_type: workflowType,
        // 后端 DirectorSetupRequest 没有 form/episodes/duration_s 字段；直接发会被 Pydantic 静默丢弃。
        // 唯一正确映射：episodes → story_requirements.chapter_count，duration_s → target_runtime_s。
        story_requirements: Object.keys(storyRequirements).length ? storyRequirements : undefined,
        target_runtime_s: args.duration_s ? Number(args.duration_s) : undefined,
        creation_template: args.creation_template ? String(args.creation_template) : undefined,
        custom_style_notes: args.custom_style_notes ? String(args.custom_style_notes) : undefined,
        director_archetype: args.director_archetype ? String(args.director_archetype) : undefined,
        visual_style: args.visual_style ? String(args.visual_style) : undefined,
        aspect_ratio: args.aspect_ratio ? String(args.aspect_ratio) : undefined,
        platform: args.platform ? String(args.platform) : undefined,
        content_language: args.content_language ? String(args.content_language) : undefined,
        creator_mode: args.creator_mode ? String(args.creator_mode) : undefined,
        auto_start: false,
      }
      const created: any = await api.post('/api/v3/director/setup', body)
      const id = String(created?.project_id || created?.project?.id || '')
      const key = keyOf(exec)
      if (id && key) {
        // 新建是用户显式动作：直接绑到**当前会话**（保留在这一条链路里，不设全局兜底）。
        sessionBindings.set(key, id)
        try {
          await api.post('/api/v3/director/session/bind', { dsh_session_id: key, project_id: id })
        } catch (error) {
          console.warn('[zipx-director] session bind after create failed: ' + String((error as any)?.message || error))
        }
      }
      return { ...(created as any), session_id: key, bound: Boolean(id && key) }
    },
  }))

  reg(defineTool({
    name: 'zipx_update_project_input',
    description: '改正一个**尚未开工**项目的创意母本（写入 project.input_prompt）。只在项目没有产物、current_step=init 时可用；已开工请用 modify/regenerate，不要新建重复项目。故事步骤只读 project.input_prompt。',
    parameters: {
      project_id: { type: 'string', required: true },
      initial_content: { type: 'string', required: true, description: '新的创意母本（逐字传入）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: v && v.ok
          ? ('已更新母本（' + (v.input_prompt_len ?? '?') + ' 字）；当前步骤 ' + (v.current_step ?? 'init') + '。')
          : ('更新失败：' + JSON.stringify(v).slice(0, 200)),
      }],
    },
    async execute(args: any) {
      const pid = String(args.project_id || '')
      if (!pid) throw new Error('需要 project_id')
      const content = String(args.initial_content || '').trim()
      if (!content) throw new Error('initial_content 不能为空')
      return api.post('/api/v3/director/project/' + encodeURIComponent(pid) + '/input', { initial_content: content })
    },
  }))

  reg(defineTool({
    name: 'zipx_bind_project',
    description: '把某个 ZipX 项目绑定到当前 DSH 会话：之后所有 zipx_* 工具都可以省略 project_id。绑定同时写进 ZipX（external_sessions），换会话不丢。绑定即进入「ZipX 导演」身份（返回的说明就是本会话的工作纪律）。',
    parameters: { project_id: { type: 'string', required: true, description: '要绑定的项目 id（uuid）' } },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaBind,
      render: (_a: unknown, v: any) => {
        if (!(v && v.project_id)) return [{ type: 'text', text: '绑定失败：' + JSON.stringify(v).slice(0, 200) }]
        // 2026-11-16：绑定这一次是**唯一**能把导演身份交出去的时机（DSH 的 preset 不随
        // 第三方插件分发），所以纪律必须写在这里 —— 工具结果是模型看得见的一等输入。
        const role = [
          '已绑定到本会话：' + v.project_id + (v.rebound ? '（改绑）' : ''),
          '',
          '你现在以 ZipX 导演身份工作，纪律如下：',
          '1. 先读事实：zipx_project_state（必要时 zipx_project_overview）看项目到哪一步、门禁三态、下一步建议；不要凭记忆回答。',
          '2. 任何创作动作（推进/重做/修改/调风格/开工）先 zipx_preview_action；allowed=false 就按 reason_human 解释，allowed=null 是「判不了」，不是「不允许」。',
          '3. 付费动作（confirm / regenerate / regenerate_item / resume / start / start_episode）先说清做什么、大概多少钱（zipx_cost），用户同意后再调用。',
          '4. 一次只做一个写动作（多镜修改拆成多轮）；派发后只说「已派发」，完成与否用 zipx_watch_step 确认。用户说「停下/别做了」时调用 zipx_abort；取消后台任务也会请求后端中止。',
          '5. 读不到就说读不到，绝不编造进度、分数、路径或完成状态。',
          '6. 结构化工具覆盖不到的长尾，才用 zipx_chat（旧通道）。',
        ]
        return [{ type: 'text', text: role.join('\n') }]
      },
    },
    async execute(args: any, exec: any) {
      const projectId = String(args.project_id || '').trim()
      const key = keyOf(exec)
      if (!key) {
        return {
          project_id: projectId,
          session_id: '',
          rebound: false,
          note: '这次调用没有会话 id，已拒绝写入"全局绑定"（否则会污染其它会话）。请在 DSH 会话里重新调用。',
        }
      }
      if (!/^[0-9a-fA-F-]{8,40}$/.test(projectId)) {
        return { project_id: projectId, session_id: key, rebound: false, note: '项目 id 形状不对，没有绑定。' }
      }
      const previous = sessionBindings.get(key) || ''
      sessionBindings.set(key, projectId)
      try {
        const res: any = await api.post('/api/v3/director/session/bind', {
          dsh_session_id: key,
          project_id: projectId,
        })
        return { ...(res as any), project_id: projectId, session_id: key, rebound: Boolean(previous && previous !== projectId) }
      } catch (error) {
        // 服务端绑定失败不撤销本地绑定：本会话仍可用，只是换设备/重启会丢。
        return { project_id: projectId, session_id: key, rebound: Boolean(previous && previous !== projectId), note: '本地已绑定，服务端没记住：' + String((error as any)?.message || error).slice(0, 160) }
      }
    },
  }))

  // 2026-11-17：绑定一直是单向的（能 bind 不能 unbind），会话被历史项目占住后只能改绑。
  // 解绑只清 external_sessions.project_id 与进程内缓存，不动项目、不动设备、不撤销会话。
  reg(defineTool({
    name: 'zipx_unbind_project',
    description: '解除本会话与 ZipX 项目的绑定（只清会话绑定，不动项目、不撤销设备）。解绑后 zipx_* 工具不再默认指向任何项目；需要时再 zipx_bind_project。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{ type: 'text', text: v && v.unbound ? '已解绑本会话的 ZipX 项目绑定。' : ('解绑失败：' + JSON.stringify(v).slice(0, 200)) }],
    },
    async execute(_args: any, exec: any) {
      const key = keyOf(exec)
      if (!key) return { unbound: false, session_id: '', note: '没有会话 id，未做任何修改。' }
      sessionBindings.delete(key)
      try {
        const res: any = await api.post('/api/v3/director/session/unbind', { dsh_session_id: key })
        return { ...(res as any), session_id: key, unbound: true }
      } catch (error) {
        return { unbound: false, session_id: key, note: '服务端解绑失败：' + String((error as any)?.message || error).slice(0, 160) }
      }
    },
  }))

  // 改名 / 归档 / 恢复：DSH 面板的「整理项目库」唯一写入口（PATCH 一条端点）。
  reg(defineTool({
    name: 'zipx_update_project',
    description: '改名或归档/恢复一个 ZipX 项目。归档 = status 置 archived（不删除任何东西、不占免费版项目配额，项目库默认不再列出）；恢复 = 写回归档前的状态。',
    parameters: {
      project_id: { type: 'string', required: true, description: 'ZipX 项目 id' },
      title: { type: 'string', description: '新标题（不想改名就不传）' },
      archived: { type: 'boolean', description: 'true=归档；false=恢复（不传=不动归档状态）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{
        type: 'text',
        text: v && v.ok
          ? ('已更新：' + (Array.isArray(v.changed) ? v.changed.join('、') : String(v.changed || '')) + '；标题「' + (v.title || '') + '」，状态 ' + (v.status || '') + (v.archived ? '（已归档，项目库默认不显示）' : '') + '。')
          : ('更新失败：' + JSON.stringify(v).slice(0, 200)),
      }],
    },
    async execute(args: any) {
      const pid = String(args.project_id || '')
      if (!pid) throw new Error('需要 project_id')
      const body: any = {}
      if (args.title !== undefined && args.title !== null) body.title = String(args.title)
      if (args.archived === true || args.archived === false) body.archived = args.archived
      if (!Object.keys(body).length) throw new Error('至少给 title 或 archived 之一')
      return api.patch('/api/v3/director/project/' + encodeURIComponent(pid), body)
    },
  }))

  // 创作者个人知识库（账号级）：面板「知识」tab 与对话共用这一条工具，不复制规则。
  reg(defineTool({
    name: 'zipx_creator_kb',
    description: '读/写 ZipX 创作者个人知识库（账号级，跨项目）。action：overview（风格画像+文档统计）、documents（文档列表）、style_profile、add_link（提交 http 链接，视频链接会走创意分析）、add_text（提交一段创意文本）、set_enabled（启用/停用某篇）。上传 PDF/Word/图片请到 Studio（DSH 代理不收 multipart）。',
    parameters: {
      action: { type: 'string', required: true, enum: ['overview', 'documents', 'style_profile', 'add_link', 'add_text', 'set_enabled'] },
      doc_id: { type: 'string', description: 'set_enabled 需要：文档 id' },
      enabled: { type: 'boolean', description: 'set_enabled 需要：true=启用 / false=停用' },
      url: { type: 'string', description: 'add_link 需要：http(s) 链接' },
      text: { type: 'string', description: 'add_text 需要：创意文本（至少 20 字）' },
      title: { type: 'string', description: 'add_text 可选标题' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => {
        if (!v || typeof v !== 'object') return [{ type: 'text', text: '读不到知识库：' + JSON.stringify(v).slice(0, 200) }]
        if (Array.isArray(v.documents)) {
          if (!v.documents.length) return [{ type: 'text', text: '知识库还是空的：可以 add_link / add_text，或到 Studio 上传 PDF/Word。' }]
          const lines = ['知识文档 ' + v.documents.length + ' 篇：']
          for (const d of v.documents.slice(0, 20)) {
            lines.push('- ' + (d.analysis_title || d.source_name || d.id) + '｜' + (d.parsed_status || '?') + '｜' + (d.enabled ? '启用' : '停用') + '｜引用 ' + (d.recall_hits || 0) + ' 次')
          }
          return [{ type: 'text', text: lines.join('\n') }]
        }
        if (v.ok === false) return [{ type: 'text', text: '知识库接口说不行：' + (v.message || v.code || '') }]
        return [{ type: 'text', text: '知识库：' + JSON.stringify(v).slice(0, 400) }]
      },
    },
    async execute(args: any) {
      const action = String(args.action || 'overview')
      if (action === 'overview') return api.get('/api/v3/creator/overview')
      if (action === 'documents') return api.get('/api/v3/creator/knowledge/documents')
      if (action === 'style_profile') return api.get('/api/v3/creator/style-profile')
      if (action === 'add_link') {
        const url = String(args.url || '').trim()
        if (!/^https?:\/\//i.test(url)) throw new Error('add_link 需要 http(s) 链接')
        return api.post('/api/v3/creator/knowledge/links', { url, note: args.title ? String(args.title) : undefined })
      }
      if (action === 'add_text') {
        const text = String(args.text || '').trim()
        if (text.length < 20) throw new Error('add_text 至少 20 字（后端硬校验）')
        return api.post('/api/v3/creator/knowledge/creative-text', { text, title: args.title ? String(args.title) : undefined })
      }
      if (action === 'set_enabled') {
        const docId = String(args.doc_id || '')
        if (!docId) throw new Error('set_enabled 需要 doc_id')
        if (args.enabled !== true && args.enabled !== false) throw new Error('set_enabled 需要 enabled=true/false')
        return api.patch('/api/v3/creator/knowledge/documents/' + encodeURIComponent(docId), { enabled: args.enabled })
      }
      throw new Error('未知的 action：' + action)
    },
  }))

  // 协作（剧组）只读：成员 / 锚点 / 交付 / 审计 / 快照。写操作留在 Studio。
  reg(defineTool({
    name: 'zipx_collab',
    description: '只读查看项目的剧组成员与协作记录（members 成员 / anchors 锚点 / deliveries 交付 / audit 审计 / snapshots 快照）。成员可读这件事本身就是权限：能看到说明你在这部戏里。',
    parameters: {
      project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' },
      view: { type: 'string', required: true, enum: ['members', 'anchors', 'deliveries', 'audit', 'snapshots'] },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => {
        const items = (v && (v.items || v.members || v.anchors || v.deliveries || v.audit || v.snapshots)) || []
        if (!Array.isArray(items) || !items.length) return [{ type: 'text', text: '这一项是空的（或读不到）：' + JSON.stringify(v).slice(0, 160) }]
        return [{ type: 'text', text: '共 ' + items.length + ' 条：' + items.slice(0, 10).map((x: any) => String(x.name || x.title || x.action || x.id || '')).join('、') }]
      },
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      return api.get('/api/v4/collab/projects/' + encodeURIComponent(id) + '/' + encodeURIComponent(String(args.view)))
    },
  }))

  reg(defineTool({
    name: 'zipx_project_overview',
    description: '一次拿齐项目总览：状态 + 门禁 + 剧集子项目 + 交付简报。比分开调 state/episodes/delivery 更省一轮。project_id 省略时用本会话绑定的项目。',
    parameters: { project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' } },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => {
        if (!v || !v.state) return [{ type: 'text', text: '读不到总览：' + JSON.stringify(v).slice(0, 200) }]
        const cur = v.state.current || {}
        const g = v.state.gates || {}
        const lines = [
          (v.project?.title || v.project?.id || '') + '｜当前 ' + (cur.label || cur.step || '?') + '｜门禁 ' + (g.overall || 'unchecked'),
        ]
        if (Array.isArray(v.episodes) && v.episodes.length) lines.push('剧集 ' + v.episodes.length + ' 个')
        if (v.delivery && v.delivery.has_compose !== undefined) lines.push('交付：' + (v.delivery.release_ok === true ? '可以交付' : v.delivery.release_ok === false ? '还不能交付' : '未判'))
        if (v.state.next_suggestion) lines.push('建议：' + v.state.next_suggestion.label)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      return api.get('/api/v3/director/project/' + encodeURIComponent(id) + '/overview')
    },
  }))

  reg(defineTool({
    name: 'zipx_artifacts',
    description: '列某一步的产物（slim：去正文、只留摘要与媒体签名 URL）。看关键帧/成片缩略图时用它；要正文用 zipx_read_asset。project_id 省略=本会话绑定的项目。',
    parameters: {
      project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' },
      steps: { type: 'string', description: '逗号分隔的步骤 id，如 story,script；空=全部' },
      media: { type: 'boolean', description: '是否带签名媒体 URL，默认 true' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaArtifacts,
      render: (_a: unknown, v: any) => {
        const out = (v && v.output) || {}
        const keys = Object.keys(out)
        if (!keys.length) return [{ type: 'text', text: '这些步骤还没有产物。' }]
        const lines = ['产物 ' + keys.length + ' 步：']
        for (const k of keys) {
          const media = out[k] && out[k].media_urls ? Object.keys(out[k].media_urls).length : 0
          lines.push('- ' + k + '｜状态 ' + ((out[k] && out[k].status) || '?') + (media ? '｜媒体 ' + media + ' 个' : ''))
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      const q = new URLSearchParams()
      q.set('slim', '1')
      if (args?.steps) q.set('steps', String(args.steps))
      q.set('media', args?.media === false ? '0' : '1')
      return api.get('/api/v3/director/project/' + encodeURIComponent(id) + '/artifacts?' + q.toString())
    },
  }))


  reg(defineTool({
    // 2026-11-17（session-0f608876）：生成完了但结果没回到 DSH 对话 —— 后台任务完成通知
    // 只有 WorkState（"story · running · 1/1"），没有正文/产物指针/媒体 URL。这个工具是
    // 「一步的产物长什么样」的唯一读入口：正文节选 + 计数 + 可播媒体 + 门禁，一张卡渲染。
    name: 'zipx_step_result',
    description: [
      '读某一步的**产物预览**：正文节选（故事/剧本/钩子）、计数（章/场/镜/条）、可播媒体（关键帧/视频）、这一步的门禁。',
      '任何一次生成结束（zipx_watch_step 到终态，或 state 显示 is_complete）都要调用它，把摘要和正文节选贴给用户；只说「已完成」不算交付。',
      '卡片会渲染正文节选与图片/视频；要完整正文用 zipx_read_asset，要全部媒体清单用 zipx_artifacts。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' },
      step: { type: 'string', required: true, description: '步骤 id，如 story/script/keyframes/shots_hitl/compose' },
      max_chars: { type: 'integer', description: '正文节选上限（默认 900，最大 8000）' },
      max_media: { type: 'integer', description: '媒体数量上限（默认 6，最大 12）' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaResult,
      render: (_a: unknown, v: any) => {
        if (!v || v.has_content !== true) {
          return [{ type: 'text', text: String(v?.empty_reason || '这一步还没有产物。') }]
        }
        const gate = v.gate || {}
        const gateText = gate.overall && gate.overall !== 'unchecked'
          ? '门禁 ' + gate.overall + (gate.score == null ? '' : '（' + Number(gate.score).toFixed(2) + '/' + (gate.threshold ?? '?') + '）')
          : '门禁未检查'
        const lines = [
          (v.label || v.step) + '（' + v.step + '）· ' + (v.summary || '已生成') + ' · ' + gateText,
        ]
        if (gate.summary) lines.push('门禁说明：' + String(gate.summary).slice(0, 300))
        if (Array.isArray(gate.reasons) && gate.reasons.length) lines.push('主要问题：' + gate.reasons.slice(0, 3).join('；'))
        if (v.text) {
          lines.push('正文（' + (v.text_source || 'content') + '，共 ' + (v.text_chars ?? '?') + ' 字符' + (v.truncated ? '，这里是节选' : '') + '）：')
          lines.push(v.text)
        }
        const media = Array.isArray(v.media) ? v.media : []
        if (media.length) {
          lines.push('可播媒体 ' + media.length + (v.media_total > media.length ? ' / 共 ' + v.media_total : '') + ' 个（卡片里可看/播放）：')
          for (const item of media.slice(0, 6)) lines.push('- ' + (item.label || item.path))
        }
        if (!v.text && !media.length) lines.push('（这一步没有正文或媒体，只有结构化产物；用 zipx_artifacts 看字段。）')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      const q = new URLSearchParams()
      q.set('step', String(args.step))
      q.set('max_chars', String(Math.max(200, Math.min(Number(args.max_chars) || 900, 8000))))
      q.set('max_media', String(Math.max(0, Math.min(Number(args.max_media) || 6, 12))))
      q.set('language', language)
      return api.get('/api/v3/director/project/' + encodeURIComponent(id) + '/result?' + q.toString())
    },
  }))


  reg(defineTool({
    // 2026-11-17（session-0f608876）：用户说「给全剧起名、补人物表」，
    // chapter_scope_dispatch 把整句收窄成「只重做 6 章」，全局要求被静默丢掉。
    // 这不是生成动作，只改 outline 字段 + 重算 outline_quality + 把门禁标旧。
    name: 'zipx_update_story_outline',
    description: [
      '只改故事大纲的全局字段：剧名 title、一句话简介 logline、人物表 characters（不重写正文）。',
      '用户要求「给全剧起名 / 补人物表 / 改简介」而正文不需要重做时用它；不要为此整步重做故事。',
      '改完门禁会标成旧判决（gate_stale），需要时用 zipx_run_gate 重判。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' },
      title: { type: 'string', description: '剧名（最多 120 字）' },
      logline: { type: 'string', description: '一句话简介（最多 800 字）' },
      characters: {
        type: 'array',
        description: '人物表：[{name, description?, initial_state?}] 或 ["姓名", ...]（最多 40 人）',
        items: { type: 'object', additionalProperties: true },
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => {
        if (!v || v.ok !== true) return [{ type: 'text', text: '大纲修改失败：' + JSON.stringify(v).slice(0, 240) }]
        const bits = Array.isArray(v.changed) ? v.changed.join('、') : ''
        return [{ type: 'text', text: `已更新故事大纲（${bits}）：剧名「${v.title || '（空）'}」，人物 ${v.characters ?? 0} 人。正文没有重写；旧门禁已标为过期。` }]
      },
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      const body: any = {}
      if (args.title !== undefined) body.title = String(args.title)
      if (args.logline !== undefined) body.logline = String(args.logline)
      if (args.characters !== undefined) body.characters = args.characters
      if (!Object.keys(body).length) throw new Error('至少要给 title / logline / characters 之一')
      return api.post('/api/v3/director/project/' + encodeURIComponent(id) + '/story/outline', body)
    },
  }))

  reg(defineTool({
    // 2026-11-17：章节/大纲在门禁判决之后被改过时，必须能显式重判一次。
    // 走与 execute_step 同一条后处理链；判官有 provider 成本，但不扣用户积分。
    name: 'zipx_run_gate',
    description: [
      '重跑某一步的门禁（story/script/plot_analysis 等）：走与整步生成同一套 story_quality + 判官链。',
      '改了章节或大纲后 state 说 gate_stale、或用户问「这版过没过」时用它；只判不生成正文。',
      '可能跑几分钟（多位判官）；返回 pass/fail/score 与原因。',
    ].join(''),
    parameters: {
      project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' },
      step: { type: 'string', required: true, description: '步骤 id，如 story/script' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaGeneric('zipx_run_gate'),
      render: (_a: unknown, v: any) => {
        if (!v || v.finalized !== true) {
          return [{ type: 'text', text: '门禁没有产出结论：' + String(v?.reason || '未真正质检') }]
        }
        const passed = v.gate_passed === true ? '通过' : v.gate_passed === false ? '未通过' : '未判'
        const score = typeof v.gate_score === 'number' ? `（${v.gate_score.toFixed(2)}/${v.gate_threshold ?? '?'}）` : ''
        return [{ type: 'text', text: `门禁已重判：${passed}${score}${v.gate_unscored ? '（判官未真正计分）' : ''}\n${String(v.gate_summary || '').slice(0, 600)}` }]
      },
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      return api.post('/api/v3/director/project/' + encodeURIComponent(id) + '/steps/' + encodeURIComponent(String(args.step)) + '/regate', {})
    },
  }))

  reg(defineTool({
    name: 'zipx_delivery',
    description: '读交付检查单与发布状态：哪些项 pass/warn/fail、成片路径与签名 URL、能不能交付。用户问「能交付了吗/检查单怎么样」时用它。',
    parameters: { project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' } },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaDelivery,
      render: (_a: unknown, v: any) => {
        if (!v || v.has_compose === undefined) return [{ type: 'text', text: '读不到交付状态：' + JSON.stringify(v).slice(0, 200) }]
        if (v.has_compose === false) return [{ type: 'text', text: '还没有成片，交付检查单为空。' }]
        const c = v.counts || {}
        const lines = ['交付：' + (v.release_ok === true ? '可以交付' : v.release_ok === false ? '还不能交付' : '未判')]
        lines.push('检查项 pass ' + (c.pass || 0) + ' / warn ' + (c.warn || 0) + ' / fail ' + (c.fail || 0) + ' / 待检 ' + (c.pending || 0))
        const bad = (v.checklist || []).filter((x: any) => x && (x.status === 'fail' || x.status === 'warn')).slice(0, 6)
        for (const x of bad) {
          // 契约 v5 的实际字段是 note（为什么没过），旧代码读 detail ⇒ 把最关键的一句话整段丢了。
          const why = x.note || x.detail || x.value
          lines.push('- ' + (x.label || x.key) + '：' + x.status + (why ? '（' + String(why).slice(0, 110) + '）' : ''))
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      return api.get('/api/v3/director/project/' + encodeURIComponent(id) + '/delivery')
    },
  }))

  reg(defineTool({
    name: 'zipx_cost',
    description: '查余额与本步花费预估（未知就是 null，不是 0）。付费动作前用它把「要花多少」说清楚。',
    parameters: {
      project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' },
      step: { type: 'string', description: '要预估的步骤 id（可选）' },
    },
    output: {
      schema: { type: 'json' },
      presentationMeta: metaCost,
      render: (_a: unknown, v: any) => {
        if (!v) return [{ type: 'text', text: '读不到成本。' }]
        const lines = [
          '余额：' + (v.balance === null || v.balance === undefined ? '读不到' : v.balance + ' ' + (v.currency || 'credits')),
          '本步预估：' + (v.estimate_calls === null || v.estimate_calls === undefined ? '读不到' : v.estimate_calls + ' ' + (v.currency || 'credits')),
        ]
        if (v.affordable === false) lines.push('余额不够这一步。')
        if (v.note) lines.push(v.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      const q = args?.step ? '?step=' + encodeURIComponent(String(args.step)) : ''
      return api.get('/api/v3/director/project/' + encodeURIComponent(id) + '/cost' + q)
    },
  }))

  reg(defineTool({
    name: 'zipx_repair_action',
    description: '打磨闭环的写操作：adopt（采纳被退回的那一版）/ rollback（退回上一版）/ resync（把 canonical 写回资产）。repair_id 来自 zipx_review_project 或项目打磨记录，不要自己编。',
    parameters: {
      project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' },
      repair_id: { type: 'string', required: true, description: '打磨记录 id' },
      action: { type: 'string', required: true, enum: ['adopt', 'rollback', 'resync'], description: '要做的动作' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => [{ type: 'text', text: (v && (v.message || v.adopted || v.rolled_back || v.resynced)) ? String(v.message || '已完成') : ('操作失败：' + JSON.stringify(v).slice(0, 200)) }],
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      return api.post('/api/v3/director/project/' + encodeURIComponent(id) + '/repair/' + encodeURIComponent(String(args.repair_id)) + '/' + encodeURIComponent(String(args.action)), {})
    },
  }))
  reg(defineTool({
    name: 'zipx_events',
    description: '按游标增量读项目创作事件（比 zipx_timeline 更省：给上次的 next_cursor，只拿之后发生的事）。用户问「刚才又发生了什么 / 有进展了吗」时用它；长任务等待时配合 zipx_watch_step 一起用。',
    parameters: {
      project_id: { type: 'string', description: 'ZipX 项目 id（省略=本会话绑定的项目）' },
      after: { type: 'string', description: '上次返回的 next_cursor；省略=从最早开始' },
      limit: { type: 'integer', description: '最多返回条数，默认 50，上限 300' },
      types: { type: 'string', description: '逗号分隔的事件类型过滤（可选）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_a: unknown, v: any) => {
        const events = Array.isArray(v?.events) ? v.events : []
        if (!events.length) return [{ type: 'text', text: '自上次游标以来没有新事件。' + (v?.next_cursor ? '（游标 ' + String(v.next_cursor).slice(0, 24) + '）' : '') }]
        const lines = ['新事件 ' + events.length + ' 条' + (v?.has_more ? '（还有更多）' : '') + '：']
        for (const e of events.slice(-12)) lines.push('- ' + (e.created_at || '').slice(11, 19) + ' ' + (e.event_type || '?') + '｜' + (e.summary || '') + (e.step ? '｜' + e.step : ''))
        if (v?.next_cursor) lines.push('下次用 after=' + String(v.next_cursor).slice(0, 40))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: any, exec: any) {
      const id = await resolveProject(args, exec)
      if (!id) throw new Error(noProjectHint())
      const q = new URLSearchParams()
      if (args?.after) q.set('after', String(args.after))
      q.set('limit', String(Math.min(Number(args?.limit) || 50, 300)))
      if (args?.types) q.set('types', String(args.types))
      return api.get('/api/v3/director/project/' + encodeURIComponent(id) + '/events?' + q.toString())
    },
  }))
  console.log('[zipx-director] registered ' + registered.length + ' tools')

  // 发现性：让每个会话都知道这套工具存在。专属 preset 需要先解决 dsh-agent-preset 的包解析，
  // 所以先用 systemPrompt 段落承载「是什么 + 四条纪律」，profile 里没有该服务时静默跳过。
  // 发现性（2026-11-13）：把包里带的 SKILL.md 挂进 DSH 的技能目录。
  // 此前它只躺在 tarball 里——任何会话的技能清单都看不到，等于「文档带了、入口没有」。
  // 技能是模型和用户都能主动调起的那种入口（/skill zipx-creator），比系统提示段更显式。
  ctx.inject(['skills'], (scope: any) => {
    try {
      const locator = fileURLToPath(new URL('../skills/zipx-creator/SKILL.md', import.meta.url))
      const raw = readFileSync(locator, 'utf8')
      const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
      const description = String((front?.[1] ?? '').match(/^description:\s*(.+)$/m)?.[1] ?? '')
        .trim().replace(/^['"]|['"]$/g, '')
      if (!description) throw new Error('SKILL.md 缺少 description')
      const content = raw.slice(front?.[0]?.length ?? 0).trim()
      const candidate = {
        name: 'zipx-creator',
        description,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'zipx-director',
        source: 'bundled',
        // 600 = BUNDLED_SKILL_RANK：与 DSH 自带包同级，同名技能不会被更低优先级的实现顶掉。
        rank: 600,
        resourceBase: { kind: 'directory', path: dirname(locator) },
        locator,
      }
      scope.skills.registerProvider(() => ({
        name: 'zipx-director',
        list: () => Promise.resolve([candidate]),
        get: (entry: any) => {
          const { rank: _rank, locator: _locator, ...summary } = entry ?? candidate
          return Promise.resolve({ ...summary, content })
        },
      }))
      console.log('[zipx-director] skill registered: zipx-creator')
    } catch (err: any) {
      // 技能挂不上不该拖垮工具：如实记一条，工具照常可用。
      console.warn('[zipx-director] skill not registered: ' + String(err?.message ?? err))
    }
  })

  ctx.inject(['systemPrompt'], (scope: any) => {
    scope.systemPrompt.section({
      name: 'zipx:creator-bridge',
      order: 180,
      text: [
        '用户的影视创作在 ZipX 里（工具前缀 zipx_，共 ' + registered.length + ' 个）。',
        '1) 任何「项目到哪一步/能不能做」先 zipx_project_state，不要猜。',
        '2) 任何创作动作先 zipx_preview_action：allowed=false 按 reason_human 解释，allowed=null 是「判不了」。',
        '3) 付费动作（confirm / regenerate / regenerate_item / resume / start / start_episode）必须先让用户确认；DSH 批准卡和一次性确认卡都算用户确认，模型的 confirm=true 不算。',
        '3b) 审批被关闭的会话（full access / approval policy never）会用一次性确认卡；被拒绝或超时就如实说「未执行、没有扣费」，不要连着重试同一动作。',
        '3c) 含付费动作的 run_code 要单独一次，并传 timeoutMs: 600000；默认 120 秒包含等待批准/确认的时间，用户多看几秒就会把整个程序判超时。',
        '4) 派发后只说「已派发」；完成与否用 zipx_watch_step 确认，读不到就说读不到。用户要停就 zipx_abort（已发出的付费调用仍可能完成，后续步骤不再继续）。',
        '4b) 生成一结束（watch_step 到终态，或 state 显示 is_complete），必须调 zipx_step_result：把摘要、正文节选、媒体数量贴给用户，让卡片在会话里显示产物。只说「已完成」不算交付；没有产物/读不到就如实说。',
        '5) 一次只做一个写动作；多镜修改拆成多轮。',
        '6) 只有结构化工具覆盖不到时，才用 zipx_chat（旧对话通道）。',
        '7) 不熟悉的项目先 zipx_project_overview（一次拿齐状态/门禁/剧集/交付）；要某一步的预览（正文节选+媒体卡片）用 zipx_step_result，要完整正文用 zipx_read_asset，要全部媒体清单用 zipx_artifacts（只给签名 URL，不搬字节），要「刚才发生了什么」用 zipx_events，要「现在在做什么」用 zipx_progress。',
        '8) 没绑定项目时先 zipx_list_projects 让用户挑，再用 zipx_bind_project 绑定；之后可省略 project_id。',
        '9) 建项目：zipx_create_project 必须带 initial_content（故事步骤只读 project.input_prompt，不读 title/genre/蓝图）；episodes/duration_s 必须传（映射 story_requirements.chapter_count / target_runtime_s）。只把创意写进蓝图不会进入故事。',
        '10) 未开工（init、无产物）的项目母本写错，用 zipx_update_project_input 改正，不要新建同名项目；已开工才用 modify/regenerate。',
        '10b) 只改剧名/一句话简介/人物表：用 zipx_update_story_outline（不重写正文，门禁会标旧）；改完需要刷新判决时用 zipx_run_gate。不要为了补剧名整步重写故事。',
        '11) 导演原型不要一律用默认张艺谋：科幻/惊悚/冷峻写实优先 nolan / fincher，家庭情感优先 li_an，民俗色彩优先 zhang_yimou。',
      ].join('\n'),
    })
  })

}