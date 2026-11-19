#!/usr/bin/env node
/**
 * 无浏览器验证 lib/client.js：真跑一遍 DSH 的工厂 bundle 形状。
 *
 *  1. 造一个假的 window.__ModuleLoader__，捕获 load({ id, factory })
 *  2. 用真 React（从 DSH 检出解析）当 require('react')
 *  3. 断言 exports.inject / exports.apply 存在
 *  4. 用假 ctx 调 apply()，记录 slots.register 与 locale.register 的实参
 *  5. 用 react-dom/server 真渲染一次面板与图标，证明 render 路径不抛错
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const PNPM = 'D:/DHS/deepseek-harness/node_modules/.pnpm'
const reactRequire = createRequire(PNPM + '/react@18.3.1/node_modules/react/package.json')
const reactDomRequire = createRequire(PNPM + '/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/package.json')
const React = reactRequire('react')
const { renderToStaticMarkup } = reactDomRequire('react-dom/server')

const captured = []
const sandbox = {
  window: { __ModuleLoader__: { load: registration => { captured.push(registration) } }, location: { search: '' }, history: { replaceState() {} }, setTimeout: () => 0 },
  console,
}
const context = vm.createContext(sandbox)
vm.runInContext(bundle, context, { filename: 'lib/client.js' })

const report = { id: captured[0]?.id ?? null, registered: captured.length }
const registration = captured[0]
report.idMatchesPackage = registration.id === 'dsh-director'

const requireStub = id => {
  if (id === 'react') return React
  throw new Error('unexpected require: ' + id)
}
const exportsObject = registration.factory(requireStub)
report.hasApply = typeof exportsObject.apply === 'function'
report.inject = exportsObject.inject

const slots = []
const locales = []
const ctx = {
  effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  locale: {
    register(ns, dicts) { locales.push({ ns, locales: Object.keys(dicts), keys: Object.keys(dicts.zh || {}).length }); return () => {} },
    bind(ns) { return (key, params) => key },
  },
  slots: {
    inject(name, fn) { fn(); return () => {} },
    register(options, component) { slots.push({ name: options.name, id: options.id ?? null, key: options.key ?? null, order: options.order ?? null, locale: options.locale ?? null, component: typeof component }); return () => {} },
  },
}
exportsObject.apply(ctx)
report.slots = slots
report.locales = locales

const Panel = slots.find(entry => entry.name === 'main')?.component
// 取回组件引用重新渲染（register 收到的是函数本身，上面只记了 typeof）
const registrations = []
const recordingCtx = Object.assign({}, ctx, {
  slots: {
    inject(name, fn) { fn(); return () => {} },
    register(options, component) { registrations.push({ name: options.name, id: options.id, key: options.key, component }); return () => {} },
  },
})
exportsObject.apply(recordingCtx)
const panelComponent = registrations.find(entry => entry.name === 'main').component
const iconComponent = registrations.find(entry => entry.name === 'sidebar.panellist').component
report.panelName = panelComponent.name
report.iconName = iconComponent.name

const t = (key, params) => {
  const dict = { panel: 'ZipX 创作', 'panel.hint': 'hint', 'connection.title': '连接 ZipX', 'projects.title': '项目库', 'projects.manualPlaceholder': 'paste id', 'projects.open': '打开', 'workbench.empty': '左侧选一个项目', 'gate.unknown': '未知' }
  const value = dict[key] ?? key
  return params ? String(value).replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k]))) : value
}
const markup = renderToStaticMarkup(React.createElement(panelComponent, { t }))
const iconMarkup = renderToStaticMarkup(React.createElement(iconComponent, { size: 18, active: false }))
report.panelRenders = markup.length > 0
report.panelMarkupBytes = markup.length
report.iconRenders = iconMarkup.startsWith('<svg')
report.panelHasTitle = markup.includes('ZipX 创作')
report.panelHasLibrary = markup.includes('项目库')
report.consoleText = 'synthetic render only (no network in this harness)'
console.log(JSON.stringify(report, null, 2))
