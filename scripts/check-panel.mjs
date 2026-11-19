#!/usr/bin/env node
/**
 * P1/P2 panel guard: the conversation-first shell really renders.
 *
 * This is a structural render test, not a browser test: it runs the factory
 * bundle with a tiny React stub and asserts that every surface the plan
 * promises is registered and produces human-visible text.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = await readFile(join(root, 'lib', 'client.js'), 'utf8')

let failures = 0
function check(name, ok, detail) {
  if (ok) console.log('[ok] ' + name)
  else { failures += 1; console.error('[FAIL] ' + name + (detail ? ' - ' + String(detail).slice(0, 300) : '')) }
}

function makeReact() {
  const cells = []
  let cursor = 0
  const next = () => cursor++
  return {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity) }
    },
    useState(init) {
      const at = next()
      if (!(at in cells)) cells[at] = typeof init === 'function' ? init() : init
      return [cells[at], function (v) { cells[at] = typeof v === 'function' ? v(cells[at]) : v }]
    },
    useEffect() { next() },
    useMemo(fn) { next(); return fn() },
    useRef(value) {
      const at = next()
      if (!(at in cells)) cells[at] = { current: value }
      return cells[at]
    },
    useCallback(fn) { next(); return fn },
  }
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node.type === 'function') return textOf(node.type(Object.assign({}, node.props, { children: node.children })))
  if (!node.children) return ''
  return node.children.map(textOf).join('')
}

function load(search) {
  let handoff = null
  const win = {
    __ModuleLoader__: { load(h) { handoff = h } },
    location: { search: search || '', pathname: '/', href: 'http://127.0.0.1:3080/' + (search || ''), hash: '' },
    history: { replaceState() {} },
    requestAnimationFrame() { return 0 },
    setTimeout() { return 0 },
  }
  const doc = {
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
    createElement() { return { setAttribute() {}, textContent: '' } },
  }
  new Function('window', 'document', 'navigator', 'URLSearchParams', code)(win, doc, { clipboard: null }, URLSearchParams)
  if (!handoff) throw new Error('client bundle did not call __ModuleLoader__.load')
  const components = []
  const dicts = {}
  const ctx = {
    locale: {
      bind() { return function (key, params) { return key } },
      register(ns, d) { dicts[ns] = d; return function () {} },
    },
    effect(fn) { fn(); return function () {} },
    get() { return undefined },
    inject() {},
    slots: {
      inject(name, cb) { try { cb() } catch (e) { throw new Error('slot inject failed (' + name + '): ' + e.message) } },
      register(def, comp) { components.push({ def, comp }); return { dispose() {} } },
    },
  }
  const mod = handoff.factory(function (name) { return name === 'react' ? makeReact() : {} })
  mod.apply(ctx)
  return { components, dicts }
}

function render(components, slotName, key, props) {
  const entry = components.find(c => c.def && c.def.name === slotName && (key === undefined || c.def.key === key))
  if (!entry) throw new Error('missing slot ' + slotName + (key ? '/' + key : ''))
  const zh = DICTS.zipx && DICTS.zipx.zh ? DICTS.zipx.zh : {}
  const t = (k, params) => String(zh[k] !== undefined ? zh[k] : k).replace(/\{(\w+)\}/g, (m, p) => (params && params[p] !== undefined ? String(params[p]) : m))
  const React = makeReact()
  const tree = (function expand(node) {
    if (node === null || node === undefined) return node
    if (Array.isArray(node)) return node.map(expand)
    if (typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(Object.assign({}, node.props, { children: node.children })))
    return { type: node.type, props: node.props, children: (node.children || []).map(expand) }
  })(React.createElement(entry.comp, Object.assign({ t, sessionId: 'sess-1', inputActions: { setDraft() {}, submit() {} } }, props || {})))
  return { text: textOf(tree), tree }
}

const loaded = load()
const DICTS = loaded.dicts
const components = loaded.components
check('factory id/package', code.includes("id: '@zipx/dsh-plugin'"), '')
check('dictionary parity', DICTS.zipx && Object.keys(DICTS.zipx.zh).length === Object.keys(DICTS.zipx.en).length, JSON.stringify({ zh: Object.keys(DICTS.zipx.zh).length, en: Object.keys(DICTS.zipx.en).length }))

const MAIN_TEXT = render(components, 'main', 'zipx').text
check('main = project library', MAIN_TEXT.includes('项目库'), MAIN_TEXT.slice(0, 120))
check('main has new project', render(components, 'main', 'zipx').text.includes('新建项目'), '')
check('header chip when unbound', render(components, 'conversation.session.header.actions').text.includes('选择 ZipX 项目'), '')
check('composer dock registered', components.some(c => c.def.name === 'conversation.composer.dock'), '')
check('hero entry registered', components.some(c => c.def.name === 'conversation.hero.options'), '')
check('settings section', render(components, 'settings.section').text.includes('ZipX 连接与账号'), render(components, 'settings.section').text.slice(0, 160))

const cards = components.filter(c => c.def.name === 'tool.call.toolview')
check('43 keyed tool cards', cards.length === 43, cards.length)
const WB_TEXT = render(components, 'sidebar.right.pane.tab', '@zipx/dsh-plugin/workbench').text
check('workbench tab body', WB_TEXT.includes('还没有绑定项目'), WB_TEXT.slice(0, 200))
check('artifact tab body', render(components, 'sidebar.right.pane.tab', '@zipx/dsh-plugin/artifact').text.includes('产物预览'), '')
check('delivery tab body', render(components, 'sidebar.right.pane.tab', '@zipx/dsh-plugin/delivery').text.includes('交付检查单'), '')
check('legacy studio tab body', render(components, 'sidebar.right.pane.tab', '@zipx/dsh-plugin/studio').text.includes('Studio'), '')
const legacy = load('?zipx_shell=legacy')
check('legacy shell still boots', render(legacy.components, 'main', 'zipx').text.includes('Studio（legacy）'), render(legacy.components, 'main', 'zipx').text.slice(0, 160))

const sampleState = { kind: 'state', project_id: 'p1', title: '夜航灯塔', current: { step: 'script', label: '剧本', produced: 2, expected: 4 }, gate: 'warn', next_suggestion: { label: '重做剧本' }, legal_actions_human: ['重做'], recent_events: [] }
const samplePreview = { kind: 'preview', project_id: 'p1', action: 'advance_step', allowed: true, reason: '可以推进', paid: true, credits: 10, currency: 'credits', downstream: ['script'] }
const sampleArtifacts = { kind: 'artifacts', project_id: 'p1', steps: [{ step: 'keyframes', status: 'ready', media: [{ path: 'a.png', kind: 'image', url: '/x.png' }] }] }
const sampleCost = { kind: 'cost', project_id: 'p1', balance: 120, estimate: 10, currency: 'credits', affordable: true }
const sampleResult = { kind: 'result', project_id: 'p1', step: 'story', label: '故事创作', status: 'confirmed', summary: '12 章 / 16,268 字', has_content: true, text: '第1章 光幕上的零\n金色的光幕是从云里垂下来的。', text_source: 'story_text', text_chars: 16290, truncated: true, counts: { chapters: 12 }, gate: { overall: 'fail', score: 7.6, threshold: 7.5 }, media: [{ path: 'scene_0/first_frame.png', kind: 'image', url: '/x.png', label: '场景0 图' }], media_total: 1, empty_reason: '' }
const sampleWatch = { kind: 'watch', project_id: 'p1', step: 'script', job_id: 'zipx-step-1', complete: false, current_step: 'script', lifecycle: 'processing' }
const sampleDelivery = { kind: 'delivery', project_id: 'p1', has_compose: true, release_ok: true, counts: { pass: 3, warn: 0, fail: 0, pending: 0 }, checklist: [], media_url: '/m.mp4' }
const sampleLocks = { kind: 'locks', project_id: 'p1', all_signed: false, locks: [{ key: 'story', signed: false, available: true }] }
const sampleProjects = { kind: 'projects', items: [{ id: 'p1', title: '夜航灯塔', current_step: 'script', gates: 'pass' }], total: 1 }
const sampleBind = { kind: 'bind', project_id: 'p1', session_id: 'sess-1', rebound: false }
const sampleDispatch = { kind: 'dispatch', tool: 'zipx_confirm_step', project_id: 'p1', state: 'dispatched', current_step: 'script' }

function cardText(key, meta) {
  return render(components, 'tool.call.toolview', key, { phase: 'result', block: { kind: 'tool-result', meta, content: [{ type: 'text', text: 'ok' }] } }).text
}
const STATE_TEXT = cardText('zipx_project_state', sampleState)
check('state card', STATE_TEXT.includes('项目状态') && STATE_TEXT.includes('夜航灯塔'), STATE_TEXT.slice(0, 200))
const PREVIEW_TEXT = cardText('zipx_preview_action', samplePreview)
check('preview card', PREVIEW_TEXT.includes('可以执行'), PREVIEW_TEXT.slice(0, 200))
check('artifacts card', cardText('zipx_artifacts', sampleArtifacts).includes('产物'), '')
const RESULT_TEXT = cardText('zipx_step_result', sampleResult)
check('result card', RESULT_TEXT.includes('故事创作') && RESULT_TEXT.includes('光幕上的零'), RESULT_TEXT.slice(0, 200))
check('result card truncation is explicit', RESULT_TEXT.includes('16290'), RESULT_TEXT.slice(0, 200))
check('cost card', cardText('zipx_cost', sampleCost).includes('余额'), '')
check('watch card', cardText('zipx_watch_step', sampleWatch).includes('进度'), '')
check('delivery card', cardText('zipx_delivery', sampleDelivery).includes('可以交付'), '')
check('locks card', cardText('zipx_get_locks', sampleLocks).includes('四锁'), '')
check('projects card', cardText('zipx_list_projects', sampleProjects).includes('夜航灯塔'), '')
check('bind card', cardText('zipx_bind_project', sampleBind).includes('项目绑定'), '')
check('dispatch card', cardText('zipx_confirm_step', sampleDispatch).includes('执行回执'), '')

check('no fake chat placeholder', !code.includes('对话在 DSH 里进行'), '')
// 唯一允许的 textarea 是创建向导的母本输入框（其余输入都是单行 Field）。
check('exactly one textarea (create wizard)', (code.match(/textarea/g) || []).length === 1, (code.match(/textarea/g) || []).length)
check('textarea is the creation content box', code.includes("'data-zipx-create': 'content'"), '')

const CREATE = render(load('?zipx_new=novel').components, 'main', 'zipx')
check('create wizard title', CREATE.text.includes('新建项目') && CREATE.text.includes('创建并绑定'), CREATE.text.slice(0, 200))
check('create wizard three modes', CREATE.text.includes('创意 → 视频') && CREATE.text.includes('小说 → 视频') && CREATE.text.includes('剧本 → 视频'), '')
const hasTextarea = (function find(node) {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(find)
  if (node.type === 'textarea') return true
  return (node.children || []).some(find)
})(CREATE.tree)
check('create wizard renders its textarea', hasTextarea, '')

const ASSETS = render(components, 'sidebar.right.pane.tab', '@zipx/dsh-plugin/assets')
check('assets tab body', ASSETS.text.includes('资产库'), ASSETS.text.slice(0, 160))
const KB = render(components, 'sidebar.right.pane.tab', '@zipx/dsh-plugin/knowledge')
check('knowledge tab body', KB.text.includes('知识库') && KB.text.includes('加一个链接'), KB.text.slice(0, 200))
check('knowledge tab uploads files', KB.text.includes('上传文档'), KB.text.slice(0, 240))
check('knowledge tab uploads media', KB.text.includes('上传文档 / 图片 / 音视频') && KB.text.includes('角色参考'), KB.text.slice(0, 280))
check('knowledge media routes wired', code.includes('knowledge/media/upload') && code.includes("'/zipx-kb/assets/upload'"), '')
check('project detail manages team and product', code.includes('/zipx-team/members') && code.includes('/product-images') && code.includes('/campaign-brief'), '')
const REVIEW = render(components, 'sidebar.right.pane.tab', '@zipx/dsh-plugin/review')
check('review tab body', REVIEW.text.includes('复盘与发布'), REVIEW.text.slice(0, 160))
const ASSET_TEXT2 = render(components, 'sidebar.right.pane.tab', '@zipx/dsh-plugin/assets').text
// 导出链接要带 projectId 才渲染（空状态没有项目）；这里钉住实现里真的拼了导出端点。
check('assets tab exports a zip', ASSET_TEXT2.includes('资产库') && code.includes("'/export?scope=final'") && code.includes("'/export?scope=all'"), ASSET_TEXT2.slice(0, 200))
check('media proxy route used', code.includes('/zipx-media'), '')
check('header action slot', code.includes('conversation.session.header.actions'), '')
check('composer dock slot', code.includes('conversation.composer.dock'), '')
check('right tab slot', code.includes('sidebar.right.pane.tab'), '')
check('budget route', code.includes('/zipx-budget'), '')
check('doctor route', code.includes('/zipx-doctor'), '')
check('commands registered', code.includes('commandUi') && code.includes("add('zipx'"), '')
check('@project trigger registered', code.includes("trigger: '@'") && code.includes('zipx-projects'), '')

if (failures > 0) {
  console.error('[zipx] panel check failed: ' + failures)
  process.exit(1)
}
console.log('[zipx] panel check ok: chip + cards + workbench + settings')
