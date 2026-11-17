#!/usr/bin/env node
/**
 * 网络边界的确定性回归（2026-11-13）：这两条以前只能靠"真机偶发"观察。
 *
 * 1. **后端的 409 是人话**：`detail.message` 必须原样冒到调用方，不能把整段 JSON
 *    塞进 Error（真机：`zipx_dispatch` 被拦时模型只看到一坨括号）。
 * 2. **连接级失败**：GET 重试（后端重启后 keep-alive 池里的死 socket），
 *    **写请求不重试**（付费动作不能被重放）。
 *
 * 用一个本地 http 服务模拟三种后端状态，不碰真 ZipX、不花钱。
 * 用法：node --import ./scripts/register-stub.mjs scripts/check-net.mjs
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const lib = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)

const HUMAN = '这个动作可能触发付费生成调用。先确认（confirm=true），或先 preview 看成本。'
let mode = 'ok'
const hits = { get: 0, post: 0 }

const server = createServer((req, res) => {
  const isGet = req.method === 'GET'
  if (isGet) hits.get += 1
  else hits.post += 1

  if (mode === 'drop-first-get' && isGet && hits.get === 1) { req.socket.destroy(); return }
  if (mode === 'drop-post' && !isGet) { req.socket.destroy(); return }
  if (mode === 'http-409') {
    res.writeHead(409, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ detail: { code: 'confirm_required', message: HUMAN } }))
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ contract_version: 'v5', channel_state: 'enabled', current: { step: 'compose' } }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + server.address().port

const handlers = new Map()
const ctx = {
  tools: { register: tool => handlers.set(tool.name, tool) },
  inject: (deps, callback) => {
    const present = { skills: { registerProvider: () => {} }, systemPrompt: { section: () => {} }, webServer: { register: () => {} } }
    if (deps.every(name => present[name])) callback(present)
  },
}
await lib.apply(ctx, { baseUrl, token: 'test-token', language: 'zh' })

const failures = []
const check = (ok, message) => { if (!ok) failures.push(message) }
const reset = next => { mode = next; hits.get = 0; hits.post = 0 }

// 1) 409 的人话必须原样冒出来
reset('http-409')
try {
  await handlers.get('zipx_dispatch').execute({ project_id: 'p', action: 'modify', instruction: 'x', confirm: false })
  check(false, '409 应该抛错，却成功返回了')
} catch (error) {
  check(error.message === HUMAN, '409 的 detail.message 没有原样透出：' + error.message)
  check(error.status === 409, '错误上应带 status=409，实际 ' + error.status)
  check(error.code === 'confirm_required', '错误上应带 code=confirm_required，实际 ' + error.code)
  check(hits.post === 1, 'HTTP 错误不该重试，实际打了 ' + hits.post + ' 次')
}

// 2) GET 连接被掐断 -> 重试并成功
reset('drop-first-get')
try {
  const out = await handlers.get('zipx_connect').execute({}, {})
  check(out && out.contract_version === 'v5', 'GET 重试后应拿到正常响应，实际 ' + JSON.stringify(out))
  check(hits.get === 2, 'GET 应重试一次（共 2 次请求），实际 ' + hits.get)
} catch (error) {
  check(false, 'GET 重试没有生效：' + error.message)
}

// 3) 写请求连接被掐断 -> 不重试，直接如实报错
reset('drop-post')
try {
  await handlers.get('zipx_confirm_step').execute({ project_id: 'p', step: 'compose' }, {})
  check(false, '写请求连接失败应该抛错，却成功返回了')
} catch {
  check(hits.post === 1, '写请求不该重试，实际打了 ' + hits.post + ' 次（付费动作不能重放）')
}

server.close()

if (failures.length > 0) {
  for (const message of failures) console.log('FAIL  ' + message)
  process.exit(1)
}
console.log('[zipx] network edge ok: 409 人话透出 / GET 重试 / 写不重试')
