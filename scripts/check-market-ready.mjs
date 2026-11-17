#!/usr/bin/env node
/**
 * Market-readiness gate: the checks `dsh-plugin-market-generator` performs before it will list a
 * package (npm/Git source, non-private, non-empty engines.dsh, reachable icon, bundle patch).
 *
 * 为什么要有它：市场条目不是手写的，是从已发布包**生成**的。生成器拒绝一个包时，用户看到的是
 * 「搜不到」，而构建、单测、装包全都不会红。这里把那些理由变成可跑的断言。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const problems = []
const ok = []

function expect(condition, message) {
  if (condition) ok.push(message)
  else problems.push(message)
}

expect(typeof pkg.name === 'string' && /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(pkg.name), 'package name is a valid npm name: ' + pkg.name)
expect(/^\d+\.\d+\.\d+/.test(String(pkg.version)), 'version is semver: ' + pkg.version)
expect(pkg.private !== true, 'package is not private (generator skips private packages)')
expect(typeof pkg.description === 'string' && pkg.description.length > 0, 'description is present (market card)')
expect(Array.isArray(pkg.keywords) && pkg.keywords.includes('zipx'), 'keywords contain zipx (search hit)')

const range = pkg.engines?.dsh
expect(typeof range === 'string' && range.trim().length > 0, 'engines.dsh is declared')
expect(typeof range === 'string' && !range.includes('workspace:'), 'engines.dsh is not a workspace: range (installation refuses it)')

const patchRef = pkg.dsh?.bundle?.patch
expect(typeof patchRef === 'string', 'dsh.bundle.patch is declared')
expect(typeof patchRef === 'string' && existsSync(join(root, patchRef)), 'bundle patch file exists: ' + patchRef)

expect(existsSync(join(root, 'lib', 'index.js')), 'lib/index.js exists (run the build before publishing)')
expect(existsSync(join(root, 'icon.svg')), 'icon.svg exists (generator inlines it into the market entry)')
expect(typeof pkg.icon === 'string', 'package.json icon points at the icon')

for (const [locale, mustHave] of [['zh', '影视'], ['en', 'ZipX']]) {
  const file = join(root, 'locale', locale + '.json')
  if (!existsSync(file)) { problems.push('locale/' + locale + '.json exists'); continue }
  const dict = JSON.parse(readFileSync(file, 'utf8'))
  const title = dict?.meta?.title || ''
  const desc = dict?.meta?.description || ''
  expect(String(title).length > 0 && String(desc).length > 0, 'locale/' + locale + '.json has meta.title + meta.description')
  if (locale === 'zh') expect(String(title).includes(mustHave) || String(desc).includes(mustHave), 'zh meta mentions ' + mustHave)
}

const files = Array.isArray(pkg.files) ? pkg.files : []
for (const required of ['cordis.patch.yml', 'lib/**/*.js', 'locale/*.json', 'icon.svg']) {
  expect(files.includes(required), 'files whitelist includes ' + required)
}
expect(existsSync(join(root, 'docs', 'DETAIL.zh.md')), 'docs/DETAIL.zh.md exists (market detail markdown)')
expect(existsSync(join(root, 'screenshots')) || true, 'screenshots directory (optional)')

for (const line of ok) console.log('ok    ' + line)
if (problems.length > 0) {
  for (const line of problems) console.log('MISS  ' + line)
  console.error('[zipx] market readiness FAILED (' + problems.length + ')')
  process.exit(1)
}
console.log('[zipx] market ready: ' + ok.length + ' checks')
