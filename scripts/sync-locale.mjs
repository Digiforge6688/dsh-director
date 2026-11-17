#!/usr/bin/env node
/**
 * locale/<lang>.json 与面板字典的唯一同步点。
 *
 * 面板在浏览器里 ctx.locale.register(NS, {zh, en})，而 DSH 的市场/侧栏也会读包里的
 * locale/*.json。两处手写必然漂移，所以这里以 lib/client.js 里的字典为准生成 json；
 * --check 只比对不写，不同就 exit 1。
 *
 * 用法：
 *   node scripts/sync-locale.mjs          # 生成 locale/zh.json、locale/en.json
 *   node scripts/sync-locale.mjs --check  # 只校验（verify 用）
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundlePath = join(root, 'lib', 'client.js')
const NL = String.fromCharCode(10)

const code = await readFile(bundlePath, 'utf8')
let handoff = null
const win = {
  __ModuleLoader__: { load(h) { handoff = h } },
  location: { search: '', pathname: '/', hash: '' },
  history: { replaceState() {} },
  requestAnimationFrame() { return 0 },
  setTimeout() { return 0 },
}
const doc = {
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
  createElement() { return { setAttribute() {}, textContent: '' } },
}
// 只跑注册路径（不渲染），React 只需要形状正确。
const reactStub = {
  createElement() { return null },
  useState(v) { return [typeof v === "function" ? v() : v, function () {}] },
  useEffect() {},
  useMemo(f) { return f() },
  useRef(v) { return { current: v } },
  useCallback(f) { return f },
}
new Function('window', 'document', 'navigator', 'URLSearchParams', code)(win, doc, { clipboard: null }, URLSearchParams)
if (!handoff || typeof handoff.factory !== 'function') throw new Error('client bundle did not register a factory')

const mod = handoff.factory(function (name) { return name === 'react' ? reactStub : {} })
const captured = {}
const ctx = {
  locale: {
    bind() { return function (key) { return key } },
    register(ns, dicts) { captured[ns] = dicts; return function () {} },
  },
  effect(fn) { fn(); return function () {} },
  slots: {
    inject(name, cb) { try { cb() } catch (e) { throw new Error('slot inject failed (' + name + '): ' + e.message) } },
    register() { return { dispose() {} } },
  },
  get() { return undefined },
}
mod.apply(ctx)
const dicts = captured['zipx']
if (!dicts || !dicts.zh || !dicts.en) throw new Error('panel did not register zh/en dictionaries')

const zhKeys = Object.keys(dicts.zh).sort()
const enKeys = Object.keys(dicts.en).sort()
const missingEn = zhKeys.filter(k => !(k in dicts.en))
const missingZh = enKeys.filter(k => !(k in dicts.zh))
if (missingEn.length || missingZh.length) {
  console.error('[zipx] locale key mismatch - zh missing: ' + (missingZh.join(', ') || 'none') + ' | en missing: ' + (missingEn.join(', ') || 'none'))
  process.exit(1)
}

const check = process.argv.includes('--check')
let dirty = 0
for (const lang of ['zh', 'en']) {
  const file = join(root, 'locale', lang + '.json')
  let existing = {}
  try { existing = JSON.parse(await readFile(file, 'utf8')) } catch { existing = {} }
  const merged = { meta: existing.meta || {} }
  for (const key of Object.keys(dicts[lang]).sort()) merged[key] = dicts[lang][key]
  const text = JSON.stringify(merged, null, 2) + NL
  if (check) {
    const current = JSON.stringify(existing, null, 2) + NL
    if (current !== text) { console.error('[zipx] locale/' + lang + '.json is stale - run: node scripts/sync-locale.mjs'); dirty += 1 }
  } else {
    await writeFile(file, text, 'utf8')
  }
}
if (check) {
  if (dirty) process.exit(1)
  console.log('[zipx] locale files in sync (' + zhKeys.length + ' keys, zh=en)')
} else {
  console.log('[zipx] locale files written (' + zhKeys.length + ' keys, zh=en)')
}
