#!/usr/bin/env node
/**
 * Host-side wiring regression for P0/P1.
 *
 * Covers the four safety contracts the plan turns on:
 *   1. no global project fallback; binding recovers from ZipX external_sessions
 *   2. paid tools always go through the DSH approval seam (or are denied)
 *   3. watch_step starts a background job instead of blocking the conversation
 *   4. every tool carries a replayable presentationMeta
 * Plus the /zipx-media Range allowlist.
 */
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

const failures = []
function check(ok, message, detail) {
  if (!ok) failures.push(message + (detail ? ' :: ' + String(detail).slice(0, 240) : ''))
}

const seen = []
let createBody = null
const backend = createServer((req, res) => {
  const url = new URL(String(req.url || '/'), 'http://x')
  seen.push(req.method + ' ' + url.pathname + url.search + ' auth=' + String(req.headers.authorization || '-'))
  function json(status, body) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (url.pathname === '/api/v3/director/capabilities') return json(200, { contract_version: 'v5', channel_state: 'enabled', channels: ['dsh'], account: 'tester', dsh_tools: 34 })
  if ((url.pathname === '/api/v3/director/projects' || url.pathname === '/api/v3/director/setup') && req.method === 'POST') {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { createBody = JSON.parse(raw) } catch { createBody = null }
      json(200, { project_id: 'p3' })
    })
    return
  }
  if (url.pathname === '/api/v3/director/session/s1') return json(200, { session_id: 's1', project_id: 'p1', bound: true, revoked: false })
  if (url.pathname === '/api/v3/director/session/s2') return json(404, { detail: { code: 'not_bound', message: 'no binding' } })
  if (url.pathname.startsWith('/api/v3/director/project/p3') && req.method === 'PATCH') {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { createBody = JSON.parse(raw) } catch { createBody = null }
      json(200, { ok: true, id: 'p3', title: '改名后', status: createBody && createBody.archived ? 'archived' : 'draft', archived: Boolean(createBody && createBody.archived), changed: createBody && 'archived' in createBody ? ['archived'] : ['title'] })
    })
    return
  }
  if (url.pathname === '/api/v3/verticals/templates') return json(200, { enabled: true, templates: [{ template_id: 'binge_drama', display_zh: '短剧' }] })
  if (url.pathname.startsWith('/api/v4/collab/projects/')) return json(200, { members: [{ id: 'u1', name: 'owner' }] })
  if (url.pathname === '/api/v3/creator/knowledge/links' && req.method === 'POST') return json(200, { id: 'doc-1', source_type: 'link' })
  if (url.pathname === '/api/v3/creator/knowledge/documents' && req.method === 'GET') return json(200, { documents: [{ id: 'doc-1', analysis_title: '示例', parsed_status: 'ready', enabled: true, recall_hits: 2 }] })
  if (url.pathname === '/api/v1/credits/history') return json(200, { data: [{ id: 't1', amount: -10, description: '故事生成', created_at: '2026-11-17T12:00:00Z', balance_after: 90 }], total: 1, page: 1, page_size: 8 })
  if (url.pathname === '/api/v3/director/project/p3/export') {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="zipx-p3.zip"' })
    res.end('PK\u0003\u0004fakezip')
    return
  }
  if (url.pathname === '/api/v3/creator/knowledge/documents' && req.method === 'POST') {
    let size = 0
    req.on('data', chunk => { size += chunk.length })
    req.on('end', () => {
      uploadedBytes = size
      uploadedType = String(req.headers['content-type'] || '')
      json(200, { id: 'doc-2', parsed_status: 'pending' })
    })
    return
  }
  if (url.pathname === '/api/v3/director/session/bind' && req.method === 'POST') return json(200, { session_id: 's2', project_id: 'p2', bound: true })
  if (url.pathname === '/api/v2/team/members' && req.method === 'GET') return json(200, { members: [{ id: 3, member_id: 5, email: 'mate@example.com', name: '剪辑师', role: 'editor' }], pending_invitations: [] })
  if (url.pathname === '/api/v2/team/invite' && req.method === 'POST') return json(200, { invitation_id: 'inv-1' })
  if (url.pathname === '/api/v2/team/members/5/role' && req.method === 'PATCH') return json(200, { ok: true })
  if (url.pathname === '/api/v2/team/members/5' && req.method === 'DELETE') return json(200, { ok: true })
  if (url.pathname === '/api/v3/verticals/project/p3/product-images' && req.method === 'POST') {
    let size = 0
    req.on('data', chunk => { size += chunk.length })
    req.on('end', () => {
      productBytes = size
      productType = String(req.headers['content-type'] || '')
      json(200, { ok: true, brand_product: { product_images: [] } })
    })
    return
  }
  if (url.pathname === '/api/v3/creator/knowledge/media/upload' && req.method === 'POST') {
    let size = 0
    req.on('data', chunk => { size += chunk.length })
    req.on('end', () => {
      mediaBytes = size
      mediaType = String(req.headers['content-type'] || '')
      json(200, { id: 'doc-video', parsed_status: 'pending' })
    })
    return
  }
  if (url.pathname === '/api/v3/director/project/p1/artifacts') return json(200, { project_id: 'p1', output: { story: { status: 'ready', media_urls: {} } } })
  if (url.pathname === '/api/v3/director/state/p9') return json(200, { project: { id: 'p9', title: '夜航灯塔', current_step: 'script' }, current: { step: 'script', label: '剧本', lifecycle: 'awaiting_confirm', produced: 1, expected: 1, is_complete: true, is_locked: false }, gates: { overall: 'pass' }, legal_actions_human: [] })
  if (url.pathname === '/api/v3/director/project/p9/result') {
    return json(200, {
      project_id: 'p9', step: 'script', label: '剧本', status: 'confirmed',
      summary: '3 场 / 12 镜', excerpt: '第一场 内景 夜', media_count: 0, media: [],
      gate: { overall: 'pass', score: 8.2, threshold: 7.5 }, truncated: false, next_tool: 'zipx_step_result',
    })
  }
  // 真机：story/script 完成后 lifecycle=awaiting_confirm，但 is_complete 仍是 false。
  // watch 必须把这种状态当终态，否则会白等到 max_seconds。
  if (url.pathname === '/api/v3/director/state/p10') return json(200, {
    project: { id: 'p10', title: '等待确认', current_step: 'script' },
    current: { step: 'script', label: '剧本', lifecycle: 'awaiting_confirm', produced: 1, expected: 1, is_complete: false, is_locked: false },
    gates: { overall: 'fail' },
    legal_actions_human: ['修改'],
  })
  if (url.pathname === '/api/v3/director/project/p10/result') return json(200, {
    project_id: 'p10', step: 'script', label: '剧本', status: 'waiting_confirmation',
    summary: '12 章 / 16084 字', excerpt: '第1章', media_count: 0, media: [],
    gate: { overall: 'fail', score: 7.9, threshold: 7.5 }, truncated: false, next_tool: 'zipx_step_result',
  })
  if (url.pathname === '/api/v3/director/project/p1/result') {
    return json(200, {
      project_id: 'p1', step: 'script', label: '剧本', status: 'confirmed',
      updated_at: '2026-11-17T12:00:00Z', summary: '3 场 / 12 镜', has_content: true,
      text: '第一场 内景 夜\n沈砚坐在光幕下，手里捏着一枚黑子。', text_source: 'script_text',
      text_chars: 42, truncated: false, counts: { scenes: 3, shots: 12 },
      media: [{ path: 'scene_0/first_frame.png', url: '/api/v3/director/project/p1/media?path=scene_0/first_frame.png', kind: 'image', label: '场景0 图（first_frame.png）' }],
      media_total: 1, gate: { overall: 'pass', score: 8.2, threshold: 7.5 }, empty_reason: '',
    })
  }
  if (url.pathname === '/api/v3/director/project/p1/cost' || url.pathname === '/api/v3/director/project/p2/cost') return json(200, { estimate_calls: 10, balance: 100, currency: 'credits', affordable: true })
  if (url.pathname === '/api/v3/director/state/p1') return json(200, { project: { id: 'p1', title: '夜航灯塔', current_step: 'script' }, current: { step: 'script', label: '剧本', produced: 1, expected: 2, is_complete: false, is_locked: false }, gates: { overall: 'warn' }, legal_actions_human: ['推进'] })
  if (url.pathname === '/api/v3/director/project/p1/start' && req.method === 'POST') return json(200, { status: 'started', project_id: 'p1' })
  if (url.pathname === '/api/v3/director/project/p1/abort' && req.method === 'POST') return json(200, { ok: true, aborted: true, project_id: 'p1', step: 'script', status: 'aborted', note: '已登记中止；正在返回的付费调用可能仍会完成，但后续步骤不会再继续。' })
  if (url.pathname === '/api/v3/director/project/p1/media' || url.pathname === '/api/v1/files/demo.mp4') {
    const range = String(req.headers.range || '')
    if (range) {
      res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': 'bytes 0-3/10', 'content-length': '4' })
      res.end('abcd')
      return
    }
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '10' })
    res.end('abcdefghij')
    return
  }
  json(404, { detail: 'not found' })
})
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + backend.address().port

let approval = {}
let uploadedBytes = 0
let uploadedType = ''
let productBytes = 0
let productType = ''
let mediaBytes = 0
let mediaType = ''
let userQuestions = undefined
let jobs = null
const pre = []
const resultHooks = []
const routes = []
const tools = new Map()
const credentials = {
  records: new Map(),
  async readRecord(key) { return this.records.get(key) },
  async modifyRecord(key, fn) { const next = await fn(this.records.get(key)); if (next !== undefined) this.records.set(key, next); return next },
  async deleteRecord(key) { this.records.delete(key) },
  async describeRecord(key) { return { configured: this.records.has(key), writable: true } },
}

const ctx = {
  tools: { register: tool => tools.set(tool.name, tool) },
  inject(deps, cb) {
    const scope = {}
    if (deps.includes('webServer')) scope.webServer = { register: route => { routes.push(route); return { dispose() {} } } }
    if (deps.includes('skills')) scope.skills = { registerProvider() {} }
    if (deps.includes('systemPrompt')) scope.systemPrompt = { section() {} }
    if (deps.includes('credentials')) scope.credentials = credentials
    if (deps.includes('sidebarRightTabs')) scope.sidebarRightTabs = { register() { return { dispose() {} } } }
    cb(scope)
  },
  get(name) {
    if (name === 'approval') return approval
    if (name === 'userQuestions') return userQuestions
    if (name === 'jobs') return jobs
    return undefined
  },
  on(event, fn) {
    if (event === 'tools/pre-execute') pre.push(fn)
    if (event === 'tools/result') resultHooks.push(fn)
  },
  effect() {},
  logger: { info() {}, warn() {} },
}

await lib.apply(ctx, { baseUrl, token: 'tok', language: 'zh' })
check(tools.size === 43, '43 tools registered', tools.size)
check(pre.length === 1, 'pre-execute approval hook registered', pre.length)
check(routes.some(r => r.path === '/zipx-media'), 'media route registered')
check(routes.some(r => r.path === '/zipx-auth/status'), 'auth status route registered')
check(routes.some(r => r.path === '/zipx-doctor'), 'doctor route registered')
check(routes.some(r => r.path === '/zipx-budget'), 'budget route registered')

// 1) presentationMeta exists, is JSON-safe, and is small.
for (const name of ['zipx_project_state', 'zipx_preview_action', 'zipx_confirm_step', 'zipx_artifacts', 'zipx_step_result', 'zipx_read_asset', 'zipx_cost', 'zipx_watch_step', 'zipx_delivery', 'zipx_get_locks', 'zipx_list_projects', 'zipx_bind_project']) {
  const tool = tools.get(name)
  check(tool && typeof tool.output.presentationMeta === 'function', name + ' has presentationMeta')
  if (tool) {
    let meta
    try { meta = tool.output.presentationMeta({}, { ok: true }) } catch (error) { meta = null }
    let text = ''
    try { text = JSON.stringify(meta) } catch (error) { text = '' }
    check(!!text && text.length < 4000, name + ' presentationMeta is JSON and small', text.length)
  }
}

// 2) approval: paid tool asks; no approval channel denies; explicit opt-in passes.
const next = async () => ({ kind: 'allow' })
const asked = await pre[0]({ name: 'zipx_start', arguments: { project_id: 'p1' } }, next)
check(asked && asked.kind === 'ask', 'paid tool becomes an approval ask', JSON.stringify(asked))
check(asked && asked.displayReason && asked.displayReason.zh && asked.displayReason.en, 'approval has zh/en displayReason')
check(asked && String(asked.reason || '').includes('10'), 'zipx_start approval card shows the story estimate', asked && asked.reason)

approval = undefined
userQuestions = undefined
const denied = await pre[0]({ name: 'zipx_start', arguments: { project_id: 'p1' } }, next)
check(denied && denied.kind === 'deny', 'no approval channel and no question card denies paid tools', JSON.stringify(denied))

// 2b) approval policy 'never' (DSH full access): one-time confirmation card, still a human click.
let askedQuestion = null
userQuestions = {
  async ask(request) {
    askedQuestion = request
    return { answers: [{ id: 'zipx-paid-confirm', selected: ['允许本次'] }] }
  },
}
approval = { overrideOf: () => 'never' }
const viaCard = await pre[0]({ name: 'zipx_start', arguments: { project_id: 'p1' }, agent: { id: 's1', session: { id: 's1' } } }, next)
check(viaCard && viaCard.kind === 'allow', 'never policy falls back to one-time confirmation card', JSON.stringify(viaCard))
check(askedQuestion && askedQuestion.questions?.[0]?.intent?.kind === 'approval', 'one-time card uses approval presentation', JSON.stringify(askedQuestion).slice(0, 220))
check(askedQuestion && String(askedQuestion.questions?.[0]?.detail || '').includes('p1'), 'one-time card shows the project context', JSON.stringify(askedQuestion).slice(0, 220))

userQuestions = {
  async ask() { return { answers: [{ id: 'zipx-paid-confirm', selected: ['拒绝'] }] } },
}
const rejectedCard = await pre[0]({ name: 'zipx_start', arguments: { project_id: 'p1' }, agent: { id: 's1', session: { id: 's1' } } }, next)
check(rejectedCard && rejectedCard.kind === 'deny', 'one-time card rejection denies the paid action', JSON.stringify(rejectedCard))

// 2c) no approval service but a question answerer exists: still allow a human click.
approval = undefined
userQuestions = { async ask() { return { answers: [{ id: 'zipx-paid-confirm', selected: ['允许本次'] }] } } }
const noApprovalCard = await pre[0]({ name: 'zipx_start', arguments: { project_id: 'p1' }, agent: { id: 's1', session: { id: 's1' } } }, next)
check(noApprovalCard && noApprovalCard.kind === 'allow', 'no approval service falls back to the question card', JSON.stringify(noApprovalCard))

const free = await pre[0]({ name: 'zipx_project_state', arguments: { project_id: 'p1' } }, next)
check(free && free.kind === 'allow', 'read-only tools skip approval')
approval = {}
userQuestions = undefined

// 2d) create project carries the creative brief and the spec mapping.
const create = tools.get('zipx_create_project')
let missingBrief = null
try { await create.execute({ title: 'x', genre: '科幻' }, { agent: { id: 's9' } }) } catch (error) { missingBrief = String(error.message || error) }
check(missingBrief && missingBrief.includes('initial_content'), 'create refuses a missing creative brief', missingBrief)

const createdProject = await create.execute({
  title: '算力交割', genre: '科幻/政治惊悚', initial_content: '用户的故事母本',
  form: 'series', episodes: 12, duration_s: 90,
}, { agent: { id: 's9' } })
check(createdProject && createdProject.project_id === 'p3', 'create returns the new project id', JSON.stringify(createdProject).slice(0, 160))
check(createBody && createBody.initial_content === '用户的故事母本', 'create sends initial_content (story reads input_prompt)', JSON.stringify(createBody).slice(0, 240))
check(createBody && createBody.story_requirements && createBody.story_requirements.chapter_count === 12, 'episodes map to story_requirements.chapter_count', JSON.stringify(createBody).slice(0, 240))
check(createBody && createBody.story_requirements && createBody.story_requirements.words_per_chapter === 1200, 'series defaults to 1200 words per chapter', JSON.stringify(createBody).slice(0, 240))
check(createBody && createBody.target_runtime_s === 90, 'duration_s maps to target_runtime_s', JSON.stringify(createBody).slice(0, 240))
check(createBody && !('episodes' in createBody) && !('duration_s' in createBody) && !('form' in createBody), 'create no longer sends fields the backend silently drops', JSON.stringify(createBody).slice(0, 240))
check(createBody && createBody.workflow_type === 'idea2video', 'create defaults to idea2video', JSON.stringify(createBody).slice(0, 240))
check(seen.some(line => line.includes('POST /api/v3/director/setup')), 'create goes through /setup (workflow_type capable)')

// 2e) three modes map to workflow_type; script never gets chapter specs.
await create.execute({ title: '小说', genre: '悬疑', mode: 'novel', initial_content: '第一章…', episodes: 6, duration_s: 120 }, { agent: { id: 's9' } })
check(createBody && createBody.workflow_type === 'novel2video', 'novel mode -> novel2video', JSON.stringify(createBody).slice(0, 200))
check(createBody && createBody.story_requirements && createBody.story_requirements.chapter_count === 6, 'novel mode keeps chapter specs', JSON.stringify(createBody).slice(0, 240))
await create.execute({ title: '剧本', genre: '悬疑', mode: 'script', initial_content: '第1场 夜 内 车', episodes: 6 }, { agent: { id: 's9' } })
check(createBody && createBody.workflow_type === 'script2video', 'script mode -> script2video', JSON.stringify(createBody).slice(0, 200))
check(createBody && !createBody.story_requirements, 'script mode drops chapter specs (script2video parses scenes)', JSON.stringify(createBody).slice(0, 240))

// 2f) rename / archive through the single PATCH endpoint.
const updateProject = tools.get('zipx_update_project')
const patched = await updateProject.execute({ project_id: 'p3', title: '改名后' }, {})
check(patched && patched.ok && createBody && createBody.title === '改名后', 'update_project renames via PATCH', JSON.stringify(patched).slice(0, 200))
const archived = await updateProject.execute({ project_id: 'p3', archived: true }, {})
check(archived && archived.archived === true, 'update_project archives', JSON.stringify(archived).slice(0, 200))
let emptyPatch = null
try { await updateProject.execute({ project_id: 'p3' }, {}) } catch (error) { emptyPatch = String(error.message || error) }
check(emptyPatch && emptyPatch.includes('title') && emptyPatch.includes('archived'), 'update_project refuses an empty patch', emptyPatch)

// 3) binding: no global fallback; backend recovery works.
const artifacts = tools.get('zipx_artifacts')
const recovered = await artifacts.execute({}, { agent: { id: 's1' } })
check(recovered && recovered.output && recovered.output.story, 'session binding recovered from backend', JSON.stringify(recovered).slice(0, 160))
check(seen.some(line => line.includes('/api/v3/director/session/s1')), 'backend session lookup happened')

let unbound = null
try { await artifacts.execute({}, { agent: { id: 's3' } }) } catch (error) { unbound = String(error.message || error) }
check(unbound && unbound.includes('还没有绑定项目'), 'unbound session is refused (no fallback)', unbound)

// 3b) step result: the model gets正文节选 + counts, the card gets media.
const stepResult = tools.get('zipx_step_result')
const resultValue = await stepResult.execute({ project_id: 'p1', step: 'script' }, { agent: { id: 's1' } })
check(resultValue && resultValue.summary === '3 场 / 12 镜' && resultValue.media_total === 1, 'step_result returns the preview payload', JSON.stringify(resultValue).slice(0, 200))
const resultText = stepResult.output.render({}, resultValue).map(b => b.text).join('\n')
check(resultText.includes('3 场 / 12 镜') && resultText.includes('第一场'), 'step_result render carries summary + text', resultText.slice(0, 200))
const resultMeta = stepResult.output.presentationMeta({}, resultValue)
check(resultMeta.kind === 'result' && resultMeta.media[0].url.startsWith('/zipx-media?u='), 'step_result card proxies media', JSON.stringify(resultMeta).slice(0, 200))

const bind = tools.get('zipx_bind_project')
const P2 = '22222222-2222-2222-2222-222222222222'
const bound = await bind.execute({ project_id: P2 }, { agent: { id: 's2' } })
check(bound && bound.project_id === P2 && bound.session_id === 's2', 'bind writes the current session', JSON.stringify(bound))
check(seen.some(line => line.includes('POST /api/v3/director/session/bind')), 'bind persisted to external_sessions')

// 4) watch_step starts a background job.
jobs = {
  started: null,
  start(spec) { this.started = spec; return 'job-9' },
}
const watch = tools.get('zipx_watch_step')
const watched = await watch.execute({ project_id: 'p1', step: 'script', max_seconds: 30 }, { agent: { id: 's1' } })
check(watched && watched.mode === 'background' && watched.job_id === 'job-9', 'watch_step returns a background job', JSON.stringify(watched))
check(jobs.started && jobs.started.label.includes('script') && typeof jobs.started.run === 'function', 'job spec has label and run')

// 4b) cancelling the DSH job must abort the real generation.
const hooks = jobs.started.run({ updateProgress() {}, append() {} })
hooks.cancel()
await new Promise(resolve => setTimeout(resolve, 100))
check(seen.filter(line => line.includes('POST /api/v3/director/project/p1/abort')).length >= 1, 'job cancel calls backend abort')

// 4b2) a completed step comes back WITH its result, not just "1/1".
jobs = null
const finished = await watch.execute({ project_id: 'p9', step: 'script', max_seconds: 15 }, { agent: { id: 's9' } })
check(finished && finished.preview && finished.preview.summary === '3 场 / 12 镜', 'watch_step attaches the produced result', JSON.stringify(finished).slice(0, 240))
const finishedText = watch.output.render({}, finished).map(b => b.text).join('\n')
check(finishedText.includes('剧本 完成') && finishedText.includes('第一场'), 'watch_step render leads with the result', finishedText.slice(0, 200))
const awaiting = await watch.execute({ project_id: 'p10', step: 'script', max_seconds: 15 }, { agent: { id: 's10' } })
check(awaiting && awaiting.timed_out === false && awaiting.lifecycle === 'awaiting_confirm' && awaiting.is_done === true, 'watch_step treats awaiting_confirm as terminal', JSON.stringify(awaiting).slice(0, 240))
check(awaiting && awaiting.preview && awaiting.preview.summary === '12 章 / 16084 字', 'awaiting_confirm still attaches the result preview', JSON.stringify(awaiting?.preview || {}).slice(0, 200))

// 4c) the explicit abort tool returns an honest receipt.
const abortTool = tools.get('zipx_abort')
const aborted = await abortTool.execute({ project_id: 'p1', reason: 'test' }, {})
check(aborted && aborted.aborted === true && aborted.step === 'script', 'zipx_abort returns aborted receipt', JSON.stringify(aborted))

// 5) media Range proxy: allowlisted backend only, Range preserved.
const mediaRoute = routes.find(r => r.path === '/zipx-media')
const front = createServer((req, res) => { void mediaRoute.handler(req, res) })
await new Promise(resolve => front.listen(0, '127.0.0.1', resolve))
const mediaOrigin = 'http://127.0.0.1:' + front.address().port
const target = baseUrl + '/api/v1/files/demo.mp4'
const ranged = await fetch(mediaOrigin + '/zipx-media?u=' + encodeURIComponent(target), { headers: { Range: 'bytes=0-3' } })
check(ranged.status === 206, 'media proxy forwards 206', ranged.status)
check(String(ranged.headers.get('content-range') || '').includes('bytes 0-3/10'), 'media proxy preserves Content-Range', ranged.headers.get('content-range'))
check((await ranged.text()) === 'abcd', 'media proxy streams bytes')
const foreign = await fetch(mediaOrigin + '/zipx-media?u=' + encodeURIComponent('http://evil.example/api/v1/files/x'))
check(foreign.status === 403, 'media proxy rejects foreign hosts', foreign.status)
// 2026-11-17：契约 v5 的签名媒体（/api/v3/director/project/{id}/media）此前被路径白名单
// 拒掉 —— 所有产物预览都 403。这条钉住「放行 + 只对后端 origin 补 Bearer」。
const signed = baseUrl + '/api/v3/director/project/p1/media?path=scene_0%2Ffirst_frame.png&exp=1&sig=x'
const signedRes = await fetch(mediaOrigin + '/zipx-media?u=' + encodeURIComponent(signed))
check(signedRes.status === 200, 'media proxy allows v5 signed paths', signedRes.status)
check(seen.some(line => line.includes('/api/v3/director/project/p1/media') && line.includes('auth=Bearer tok')),
  'media proxy injects the host token for backend media only')

// 6) auth status never returns the token.
const authRoute = routes.find(r => r.path === '/zipx-auth/status')
const authFront = createServer((req, res) => { void authRoute.handler(req, res) })
await new Promise(resolve => authFront.listen(0, '127.0.0.1', resolve))
const authRes = await fetch('http://127.0.0.1:' + authFront.address().port + '/zipx-auth/status')
const authText = await authRes.text()
check(authRes.status === 200 && authText.includes('"connected":true'), 'auth status reports connected', authText.slice(0, 160))
check(!authText.includes('tok') || !authText.includes('"token"'), 'auth status never returns the token')

// 7) 新代理面：知识库可写 / 模板与协作只读 / 面板能发 PATCH。
const kbRoute = routes.find(r => r.path === '/zipx-kb')
const metaRoute = routes.find(r => r.path === '/zipx-meta')
const collabRoute = routes.find(r => r.path === '/zipx-collab')
const apiRoute = routes.find(r => r.path === '/zipx-api')
const teamRoute = routes.find(r => r.path === '/zipx-team')
const vertRoute = routes.find(r => r.path === '/zipx-verticals')
check(Boolean(kbRoute && metaRoute && collabRoute && apiRoute), 'kb/meta/collab/api routes registered')
check(Boolean(teamRoute && vertRoute), 'team / verticals routes registered')
async function serve(route) {
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { origin: 'http://127.0.0.1:' + server.address().port, server }
}
const kb = await serve(kbRoute)
const kbDocs = await fetch(kb.origin + '/zipx-kb/knowledge/documents')
check(kbDocs.status === 200 && (await kbDocs.json()).documents.length === 1, 'kb proxy reads documents')
const kbAdd = await fetch(kb.origin + '/zipx-kb/knowledge/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com' }) })
check(kbAdd.status === 200, 'kb proxy allows adding a link', kbAdd.status)
const meta = await serve(metaRoute)
const metaGet = await fetch(meta.origin + '/zipx-meta/templates')
check(metaGet.status === 200 && (await metaGet.json()).templates.length === 1, 'meta proxy reads templates')
const metaPost = await fetch(meta.origin + '/zipx-meta/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
check(metaPost.status === 405 && (await metaPost.json()).error === 'read_only', 'meta proxy is read-only', metaPost.status)
const collab = await serve(collabRoute)
const collabGet = await fetch(collab.origin + '/zipx-collab/projects/p3/members')
check(collabGet.status === 200, 'collab proxy reads members', collabGet.status)
const collabPost = await fetch(collab.origin + '/zipx-collab/projects/p3/members', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
check(collabPost.status === 405, 'collab proxy refuses writes', collabPost.status)
const apiFront = await serve(apiRoute)
const patchRes = await fetch(apiFront.origin + '/zipx-api/project/p3', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })
check(patchRes.status === 200, 'api proxy forwards PATCH (rename/archive from the panel)', patchRes.status)
kb.server.close(); meta.server.close(); collab.server.close(); apiFront.server.close()

// 8) 用量明细：面板只走 /zipx-account/history，不直连 /api/v1。
const accountRoute = routes.find(r => r.path === '/zipx-account')
const account = await serve(accountRoute)
const usage = await fetch(account.origin + '/zipx-account/history?page=1&page_size=8')
const usageBody = await usage.json()
check(usage.status === 200 && usageBody.data && usageBody.data[0].amount === -10, 'account history returns the ledger', JSON.stringify(usageBody).slice(0, 160))
const usageCapped = await fetch(account.origin + '/zipx-account/history?page_size=999')
check(usageCapped.status === 200, 'account history clamps page size instead of failing', usageCapped.status)
account.server.close()

// 9) 知识库 multipart 上传：代理必须原样转发边界与字节，不能被 JSON 化。
const kb2 = await serve(kbRoute)
const form = new FormData()
form.append('file', new Blob([new Uint8Array(2048)], { type: 'text/plain' }), 'notes.md')
const uploadRes = await fetch(kb2.origin + '/zipx-kb/knowledge/documents', { method: 'POST', body: form })
check(uploadRes.status === 200, 'kb proxy accepts multipart upload', uploadRes.status)
check(uploadedBytes > 2048, 'kb proxy forwards the uploaded bytes', uploadedBytes)
check(uploadedType.startsWith('multipart/form-data; boundary='), 'kb proxy preserves the multipart boundary', uploadedType)
kb2.server.close()

// 9b) 团队协作：成员 / 邀请 / 角色 / 移除（DELETE 也要透传）。
const team = await serve(teamRoute)
const teamList = await fetch(team.origin + '/zipx-team/members?project_id=p3')
const teamListBody = await teamList.json()
check(teamList.status === 200 && teamListBody.members[0].role === 'editor', 'team proxy lists members', JSON.stringify(teamListBody).slice(0, 160))
const teamInvite = await fetch(team.origin + '/zipx-team/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'mate@example.com', role: 'editor', project_id: 'p3' }) })
check(teamInvite.status === 200, 'team proxy sends invitations', teamInvite.status)
const teamRole = await fetch(team.origin + '/zipx-team/members/5/role', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'viewer', project_id: 'p3' }) })
check(teamRole.status === 200, 'team proxy updates a role', teamRole.status)
const teamDel = await fetch(team.origin + '/zipx-team/members/5?project_id=p3', { method: 'DELETE' })
check(teamDel.status === 200, 'team proxy removes a member', teamDel.status)
check(seen.some(line => line.includes('DELETE /api/v2/team/members/5') && line.includes('auth=Bearer tok')), 'team DELETE carries the host token')
team.server.close()
const apiForDelete = await serve(apiRoute)
const apiDel = await fetch(apiForDelete.origin + '/zipx-api/project/p3', { method: 'DELETE' })
check(apiDel.status === 405, 'DELETE stays scoped to the team proxy', apiDel.status)
apiForDelete.server.close()

// 9c) 产品图上传：multipart 原样转发到 /api/v3/verticals。
const vert = await serve(vertRoute)
const pform = new FormData()
pform.append('file', new Blob([new Uint8Array(1024)], { type: 'image/png' }), 'product.png')
pform.append('angle', 'front')
const pRes = await fetch(vert.origin + '/zipx-verticals/project/p3/product-images', { method: 'POST', body: pform })
check(pRes.status === 200, 'product image upload passes through', pRes.status)
check(productBytes > 1024, 'product image bytes are forwarded', productBytes)
check(productType.startsWith('multipart/form-data; boundary='), 'product image keeps its multipart boundary', productType)
vert.server.close()

// 9d) 知识库媒体上传：视频 26MB 走流式，不再被 25MB 上限挡住。
const kb3 = await serve(kbRoute)
const big = new Uint8Array(26 * 1024 * 1024)
const vform = new FormData()
vform.append('file', new Blob([big], { type: 'video/mp4' }), 'clip.mp4')
const vRes = await fetch(kb3.origin + '/zipx-kb/knowledge/media/upload', { method: 'POST', body: vform })
check(vRes.status === 200, 'kb proxy accepts a 26MB video upload', vRes.status)
check(mediaBytes > 25 * 1024 * 1024, 'kb proxy streams the 26MB body to the backend', mediaBytes)
check(mediaType.startsWith('multipart/form-data; boundary='), 'kb video keeps its multipart boundary', mediaType)
kb3.server.close()

// 10) 导出 zip：代理透传二进制与 Content-Disposition。
const api2 = await serve(apiRoute)
const zipRes = await fetch(api2.origin + '/zipx-api/project/p3/export?scope=final')
check(zipRes.status === 200, 'export zip passes through the proxy', zipRes.status)
check(zipRes.headers.get('content-type') === 'application/zip', 'export zip keeps its content type', zipRes.headers.get('content-type'))
check(String(zipRes.headers.get('content-disposition') || '').includes('attachment'), 'export zip keeps Content-Disposition', zipRes.headers.get('content-disposition'))
api2.server.close()

front.close(); authFront.close(); backend.close()

if (failures.length > 0) {
  for (const message of failures) console.log('FAIL  ' + message)
  process.exit(1)
}
console.log('[zipx] host wiring ok: binding / approval / jobs / cards / media')