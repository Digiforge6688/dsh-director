#!/usr/bin/env node
/**
 * P2 写路径 E2E（零成本、可重复）：在真后端上建一个**临时项目**，把写路径的守卫逐条打一遍，
 * 最后一定删掉它。为什么不用真项目：确认/重做这类动作会真的花钱，而且会改用户数据。
 *
 * 覆盖：建项目(不自动开工) → 会话绑定(幂等) → 蓝图写入 → 四锁读 → skip 守卫 → confirm 步骤错配守卫
 *      → repair 未知 id → dispatch 付费门禁（4 个动作 × 无 confirm）→ overview/delivery/cost/artifacts 形态 → 删除项目。
 *
 * 用法：node scripts/e2e-write.mjs [--keep]
 *   环境：ZIPX_BACKEND（默认 http://localhost:8000）、ZIPX_TOKEN / ~/.zipx/dialogue-token.json
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BACKEND = process.env.ZIPX_BACKEND || 'http://localhost:8000'
const KEEP = process.argv.includes('--keep')

function token() {
  if (process.env.ZIPX_TOKEN) return process.env.ZIPX_TOKEN
  const file = process.env.ZIPX_TOKEN_FILE || join(homedir(), '.zipx', 'dialogue-token.json')
  return String(JSON.parse(readFileSync(file, 'utf8')).token || '')
}

const auth = { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }
let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail ? ' :: ' + String(detail).slice(0, 200) : '')) }
}
async function call(method, path, body) {
  const res = await fetch(BACKEND + path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON 也要能断言状态码 */ }
  return { status: res.status, json, text }
}

let projectId = ''
try {
  // 1) 建项目：只建，不开工
  const created = await call('POST', '/api/v3/director/projects', {
    title: 'DSH E2E 临时项目（自动删除）', genre: '悬疑', workflow_type: 'idea2video',
  })
  projectId = String(created.json?.project_id || created.json?.project?.id || '')
  check('建项目（不自动开工）', created.status === 200 && projectId && created.json?.auto_started === false, created.status + ' ' + created.text.slice(0, 120))
  if (!projectId) throw new Error('没有 project_id，后续步骤无法进行')

  // 2) 会话绑定：幂等
  const bind1 = await call('POST', '/api/v3/director/session/bind', { dsh_session_id: 'e2e-write-session', project_id: projectId })
  const bind2 = await call('POST', '/api/v3/director/session/bind', { dsh_session_id: 'e2e-write-session', project_id: projectId })
  check('绑定首次 created=true', bind1.json?.created === true, JSON.stringify(bind1.json))
  check('绑定重复 created=false 且 created_at 不变', bind2.json?.created === false && bind2.json?.created_at === bind1.json?.created_at, JSON.stringify(bind2.json))
  const bound = await call('GET', '/api/v3/director/session/e2e-write-session')
  check('读回绑定', bound.json?.bound === true && bound.json?.project_id === projectId, JSON.stringify(bound.json))

  // 3) 蓝图写入（免费写）
  const bp = await call('PUT', '/api/v3/director/blueprint/' + projectId + '/intake', { genre: '悬疑', platform: 'general', notes: 'E2E 写入' })
  check('蓝图写入可用', bp.status === 200, bp.status + ' ' + bp.text.slice(0, 120))

  // 4) 四锁
  const locks = await call('GET', '/api/v3/director/project/' + projectId + '/locks')
  const lockKeys = Object.keys(locks.json?.locks || {})
  check('四锁读得到且未签', locks.status === 200 && lockKeys.length === 4 && lockKeys.every(k => locks.json.locks[k].signed === false), lockKeys.join(','))

  // 5) skip：WorkState 不允许时 409 + 人话
  const skip = await call('POST', '/api/v3/director/project/' + projectId + '/steps/story/skip', {})
  check('skip 被守卫拒绝（409 + 原因）', skip.status === 409 && !!skip.json?.detail?.message, skip.status + ' ' + skip.text.slice(0, 140))

  // 6) confirm：非当前步骤必须 409（防假完成）。先读当前步骤，挑一个不是它的。
  const ov = await call('GET', '/api/v3/director/project/' + projectId + '/overview')
  const current = String(ov.json?.state?.current?.step || '')
  const wrong = current === 'story' ? 'compose' : 'story'
  const confirmWrong = await call('POST', '/api/v3/director/project/' + projectId + '/steps/' + wrong + '/confirm', {})
  check('confirm 非当前步骤被拒（409 step_mismatch，current=' + current + '）',
    confirmWrong.status === 409 && confirmWrong.json?.detail?.code === 'step_mismatch', confirmWrong.status + ' ' + confirmWrong.text.slice(0, 160))

  // 7) repair：未知 id
  const repair = await call('POST', '/api/v3/director/project/' + projectId + '/repair/no-such-repair/adopt', {})
  check('repair 未知 id → 404', repair.status === 404, repair.status)

  // 7b) dispatch：付费动作不带 confirm 必须 409（zipx_dispatch 的唯一后端口，零成本）
  for (const action of ['modify', 'style_adjust', 'batch_modify', 'restart']) {
    const d = await call('POST', '/api/v3/director/dispatch', {
      project_id: projectId, action, message: 'e2e', action_params: {}, confirm: false,
    })
    check('dispatch ' + action + ' 无 confirm → 409 confirm_required',
      d.status === 409 && d.json?.detail?.code === 'confirm_required', d.status + ' ' + d.text.slice(0, 140))
  }

  // 8) 读形态
  check('overview 有 state.current', !!ov.json?.state?.current?.step, JSON.stringify(ov.json).slice(0, 120))
  const delivery = await call('GET', '/api/v3/director/project/' + projectId + '/delivery')
  check('delivery 无成片时如实说', delivery.status === 200 && delivery.json?.has_compose === false && !!delivery.json?.note, JSON.stringify(delivery.json).slice(0, 160))
  const cost = await call('GET', '/api/v3/director/project/' + projectId + '/cost?step=story')
  check('cost 有 balance 字段（null 也要在）', cost.status === 200 && 'balance' in (cost.json || {}), JSON.stringify(cost.json).slice(0, 160))
  const artifacts = await call('GET', '/api/v3/director/project/' + projectId + '/artifacts?slim=1')
  check('artifacts slim 可读', artifacts.status === 200, artifacts.status)
} catch (error) {
  failures += 1
  console.log('FAIL  异常中断 :: ' + String(error && error.message ? error.message : error))
} finally {
  if (projectId && !KEEP) {
    const del = await call('DELETE', '/api/v3/director/project/' + projectId).catch(error => ({ status: 0, text: String(error) }))
    const after = await call('GET', '/api/v3/director/projects?page=1&page_size=100')
    const still = (after.json?.items || []).some(item => item.id === projectId)
    check('临时项目已删除（不留垃圾）', !still, 'delete=' + del.status)
  } else if (projectId) {
    console.log('保留项目（--keep）：' + projectId)
  }
}

console.log(failures === 0 ? '\nP2 写路径 E2E：全绿' : '\nP2 写路径 E2E：' + failures + ' 项失败')
process.exit(failures === 0 ? 0 : 1)
