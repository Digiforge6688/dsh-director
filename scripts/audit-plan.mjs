#!/usr/bin/env node
/**
 * P0–P3 audit against docs/ZipX_DSH_融合体验重构与增长可行性方案_20261116.md.
 *
 * It intentionally checks BOTH the source and the built artifacts, then runs the
 * full check suite once. External actions (npm publish, dshbase submission) are
 * reported as SKIP — never as PASS.
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const host = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
const presentation = readFileSync(join(root, 'src', 'presentation.ts'), 'utf8')
const clientDir = join(root, 'src', 'client')
const client = ['00-header.js', '05-util.js', '10-locale-zh.js', '11-locale-en.js', '20-store.js', '30-ui.js', '40-cards.js', '50-project.js', '60-composer.js', '70-tabs.js', '80-settings.js', '85-commands.js', '90-apply.js', '99-footer.js']
  .map(name => readFileSync(join(clientDir, name), 'utf8')).join('\n')
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const market = JSON.parse(readFileSync(join(root, 'market', 'index.json'), 'utf8'))
const alias = JSON.parse(readFileSync(join(root, '..', 'dsh-zipx', 'package.json'), 'utf8'))

const rows = []
function add(id, phase, item, status, evidence) { rows.push({ id, phase, item, status, evidence }) }
function pass(id, phase, item, ok, evidence) { add(id, phase, item, ok ? 'PASS' : 'FAIL', evidence) }
function skip(id, phase, item, why) { add(id, phase, item, 'SKIP', why) }

// P0
pass('P0-1', 'P0', '包名/仓库/许可证/版本', pkg.version === '0.3.0' && pkg.license === 'MIT' && !!pkg.repository?.url && alias.name === 'dsh-zipx',
  'v' + pkg.version + ' · ' + pkg.license + ' · alias ' + alias.name)
pass('P0-2', 'P0', 'dsh.client.inject + optional peers', Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.length === 17 && !!pkg.peerDependenciesMeta?.['@deepseek-ai/dsh-credentials'],
  pkg.dsh?.client?.inject?.length + ' injects; optional credentials/jobs/webserver/approval')
pass('P0-3', 'P0', 'token 进 DSH Credentials + 旧文件迁移', host.includes('CREDENTIAL_ACCOUNT_KEY') && host.includes('modifyRecord') && host.includes('migrateLegacyToken'),
  'zipx/account · migrateLegacyToken · .migrated')
pass('P0-4', 'P0', '删除 fallbackBinding + 后端按会话恢复', !host.includes('fallbackBinding') && host.includes("'/api/v3/director/session/' + encodeURIComponent(key)"),
  'no fallback; GET /session/{id} recovery')
pass('P0-5', 'P0', '设置页（连接/账号/积分/预算/诊断）', client.includes("settings.section") && client.includes("settings.budget") && client.includes("/zipx-doctor"),
  'settings.section + /zipx-auth/status + /zipx-budget + /zipx-doctor')
skip('P0-6', 'P0', 'dshbase / dshget / dsh.so 收录', '外部提交与审核，本仓库无法代替；market/index.json 已备好')

// P1
pass('P1-1', 'P1', '项目 Chip', client.includes('conversation.session.header.actions') && client.includes('function ProjectChip'), 'ProjectChip → header.actions')
pass('P1-2', 'P1', '输入区状态条', client.includes('conversation.composer.dock') && client.includes('function ComposerStatus'), 'ComposerStatus → composer.dock')
const toolList = (/var ZIPX_TOOLS = \[([\s\S]*?)\]/.exec(client) || [])[1] || ''
const toolCount = (toolList.match(/'zipx_/g) || []).length
pass('P1-3', 'P1', '10+ 原生工具卡 + presentationMeta', (host.match(/presentationMeta:/g) || []).length >= 10 && toolCount >= 10 && presentation.includes('metaState'),
  (host.match(/presentationMeta:/g) || []).length + ' host projections; ' + toolCount + ' keyed cards')
pass('P1-4', 'P1', '付费走 DSH 原生批准', host.includes("'tools/pre-execute'") && host.includes("kind: 'ask'") && !host.includes('confirm: Boolean(args.confirm)'),
  'pre-execute ask; model confirm no longer trusted')
pass('P1-5', 'P1', '长任务后台化 + 完成通知', host.includes("get('jobs')") && host.includes('job.start') === false && host.includes('jobs.start'),
  'ctx.jobs.start; blocking fallback retained')
pass('P1-6', 'P1', '首屏 CTA', client.includes('conversation.hero.options') && client.includes('function HeroOptions'), 'HeroOptions → hero.options')

// P2
pass('P2-1', 'P2', '右侧工作台 Tab', client.includes("kind: 'zipx-workbench'") && client.includes("'@zipx/dsh-plugin/workbench'"), 'tab type + keyed body by id')
pass('P2-2', 'P2', '产物播放器 + Range 代理', host.includes('createZipxMediaRoute') && host.includes('content-range') && client.includes('/zipx-media'),
  '206/HEAD + allowlist')
pass('P2-3', 'P2', '分镜/成片/交付 Tab', ['zipx-workbench', 'zipx-artifact', 'zipx-delivery', 'zipx-studio'].every(kind => client.includes("'" + kind + "'")), '4 tab kinds')
pass('P2-4', 'P2', '交付检查单卡 + Tab', client.includes('function DeliveryCard') && client.includes('function DeliveryTab'), 'pass/warn/fail/pending + film')
pass('P2-5', 'P2', 'legacy Studio 回退', host.includes('/zipx-embed/url') && client.includes('function LegacyStudioTab') && client.includes('function LegacyStudio'),
  'right tab + ?zipx_shell=legacy')
pass('P2-6', 'P2', '旧面板降级为项目库', client.includes('function ProjectLibrary') && !client.includes('对话在 DSH 里进行') && !client.includes('textarea'),
  'main = library; no fake chat')

// P3
pass('P3-1', 'P3', '/zipx /zipx-status /zipx-doctor', client.includes("add('zipx'") && client.includes("add('zipx-status'") && client.includes("add('zipx-doctor'"), 'ctx.commandUi')
pass('P3-2', 'P3', '@项目 引用', client.includes("trigger: '@'") && client.includes('zipx-projects') && client.includes('<zipx_project id='), 'inputTriggers source + serialization')
pass('P3-3', 'P3', '移动端布局', client.includes('auto-fill') && client.includes('flexWrap') && client.includes('overflowX'),
  'auto-fill grid / flex-wrap / horizontal chip row')
pass('P3-4', 'P3', 'README / 市场 / 成本表', readme.includes('在 DSH 里当导演') && readme.includes('成本') && market.plugins[0].versions[0].version === '0.3.0',
  'README first screen + market 0.3.0')
skip('P3-5', 'P3', 'npm 发布 0.3.0 + dshbase Verified', '需要 npm/GitHub 凭据与人工审核；本仓库只能生成 tarball 与索引')

// Tests
let checks = ''
let checksOk = false
try {
  checks = execSync('npm run check', { cwd: root, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] })
  checksOk = true
} catch (error) {
  checks = String(error?.stdout || '') + String(error?.stderr || '')
}
const last = checks.trim().split(/\r?\n/).slice(-6).join(' | ')
add('T-1', 'Tests', 'npm run check（工具面/网络/账户/宿主/面板/locale）', checksOk ? 'PASS' : 'FAIL', last.slice(0, 300))

const width = Math.max(...rows.map(row => row.item.length), 10)
console.log('ID     PHASE  STATUS  ITEM' + ' '.repeat(Math.max(0, width - 10)) + '  EVIDENCE')
for (const row of rows) {
  console.log(row.id.padEnd(6) + ' ' + row.phase.padEnd(6) + ' ' + row.status.padEnd(6) + '  ' + row.item.padEnd(width) + '  ' + row.evidence)
}
const fail = rows.filter(row => row.status === 'FAIL').length
const skipped = rows.filter(row => row.status === 'SKIP').length
console.log('')
console.log(fail === 0 ? 'AUDIT PASS — ' + rows.length + ' items, ' + skipped + ' external SKIP' : 'AUDIT FAIL — ' + fail + ' item(s)')
process.exit(fail === 0 ? 0 : 1)
