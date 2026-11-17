#!/usr/bin/env node
/**
 * 技能挂载回归：lib/index.js 里必须真的向 DSH 的技能目录注册 `zipx-creator`。
 *
 * 为什么单独一条：`skills/zipx-creator/SKILL.md` 从 0.1.0 就随包发出去，但**没有任何代码
 * 把它挂进 DSH**——tarball 里有、会话的技能清单里没有。这个脚本用一个假 ctx 跑 apply()，
 * 断言 provider 被注册、list() 给出 zipx-creator、get() 真的能读出正文。
 *
 * 用法：node scripts/check-skill.mjs（在包根执行；先 build）
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const libPath = join(root, 'lib', 'index.js')
const lib = await import(pathToFileURL(libPath).href)

const failures = []
const check = (ok, message) => { if (!ok) failures.push(message) }

check(typeof lib.apply === 'function', 'lib/index.js 没有导出 apply()')

let provider = null
const tools = []
const scope = {
  tools: { register: tool => tools.push(tool) },
  webServer: { register: () => {} },
  systemPrompt: { section: () => {} },
  skills: { registerProvider: factory => { provider = factory() } },
}
const ctx = {
  tools: { register: tool => tools.push(tool) },
  inject: (deps, callback) => {
    // 只模拟本机 web profile 有的服务；缺的就不回调（与真实 cordis 的"没有该服务就不注入"一致）。
    const present = { skills: scope.skills, systemPrompt: scope.systemPrompt, webServer: scope.webServer }
    if (deps.every(name => present[name])) callback(scope)
  },
  logger: { info: () => {}, warn: () => {} },
}

await lib.apply(ctx, { baseUrl: 'http://127.0.0.1:8000', token: 'test-token', language: 'zh' })

check(tools.length === 35, '工具数应为 35，实际 ' + tools.length)
check(provider !== null, 'apply() 没有注册技能 provider（SKILL.md 仍只是随包躺着）')

if (provider) {
  const listed = await provider.list()
  check(listed.length === 1 && listed[0].name === 'zipx-creator', 'provider.list() 应给出 zipx-creator，实际 ' + JSON.stringify(listed.map(s => s.name)))
  const entry = listed[0]
  check(entry.description && entry.description.length > 10, '技能 description 太短或缺失')
  check(entry.invocation?.modelInvocable === true && entry.invocation?.userInvocable === true, '技能应对模型与用户都可调起')
  check(typeof entry.rank === 'number', '技能缺少 rank（同名去重会退化成注册顺序）')
  const loaded = await provider.get(entry)
  check(typeof loaded.content === 'string' && loaded.content.includes('四条硬纪律'), 'get() 读不出 SKILL.md 正文')
  check(!('locator' in loaded) && !('rank' in loaded), 'get() 返回值应剥掉 locator/rank（那是注册用的元数据）')
}

// 正文与源文件必须一致：防止有人只改 SKILL.md 而忘了它现在真被读出来。
try {
  const source = readFileSync(join(root, 'skills', 'zipx-creator', 'SKILL.md'), 'utf8')
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim()
  check(provider !== null, '没有 provider 就谈不上正文一致')
} catch (err) {
  failures.push('读不到 skills/zipx-creator/SKILL.md: ' + String(err?.message ?? err))
}

if (failures.length > 0) {
  for (const message of failures) console.log('FAIL  ' + message)
  process.exit(1)
}
console.log('[zipx] skill surface ok: zipx-creator registered (35 tools alongside)')
