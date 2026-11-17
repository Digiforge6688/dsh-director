#!/usr/bin/env node
/**
 * Generate a DSH plugin-market index (format 1) for this package.
 *
 * 为什么只有 npm / git 两种 source：DSH 的市场格式（packages/util/plugin-market-index）
 * 只接受这两种安装来源——**没有 "tarball URL" 这种 source**。所以"内网市场指向一个 tgz"
 * 这条路在格式上不存在；要么发布到 npm registry，要么给一个公开仓库的 commit sha。
 *
 * 用法：
 *   node scripts/make-market-index.mjs --source npm --base-url https://cdn.example.com/zipx
 *   node scripts/make-market-index.mjs --source git --commit <40-hex> --base-url https://example.com/zipx
 * 产物：market/index.json（base-url 决定 icon/homepage 这类绝对地址）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : fallback
}

const source = String(arg('source', 'npm'))
const baseUrl = String(arg('base-url', '')).replace(/\/+$/, '')
const commit = String(arg('commit', ''))
const homepage = pkg.homepage || ''
const repoUrl = String(pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '')
const repoDir = pkg.repository?.directory

if (source === 'git' && !/^[0-9a-f]{40}$/.test(commit)) {
  console.error('--source git 需要 --commit <40 位小写 hex 的提交号>（格式 1 只接受精确 commit）')
  process.exit(2)
}

const index = {
  format: 1,
  title: { en: 'ZipX Creator', zh: 'ZipX 创作' },
  description: {
    en: 'ZipX film-making inside DSH: project library, step advance, quality gates, artifacts and delivery.',
    zh: '在 DSH 里做影视创作：项目库、步骤推进、门禁、产物与交付。',
  },
  metadata: {
    categories: { creation: { title: { en: 'Creation', zh: '创作' } } },
    labels: {},
    sortKeys: { updated: { title: { en: 'Updated', zh: '最近更新' }, order: 'desc' } },
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: 'ZipX Creator', zh: 'ZipX 创作' },
      description: {
        en: 'Chat in DSH, create in ZipX: 35 zipx_* tools, a creator panel and a zipx-creator skill. Sign up at www.zipx.ai (global) or www.zipx.vip (China).',
        zh: '在 DSH 里对话、在 ZipX 里创作：35 个 zipx_* 工具、创作者面板与 zipx-creator 技能。注册：www.zipx.ai（国际）/ www.zipx.vip（中国）。',
      },
      icon: baseUrl ? baseUrl + '/icon.svg' : pkg.icon,
      author: 'ZipX',
      homepage: baseUrl || homepage || undefined,
      repository: repoUrl ? { url: repoUrl, directory: repoDir } : undefined,
      metadata: {
        category: 'creation',
        keywords: pkg.keywords || [],
        labels: [],
        sortKeys: { updated: Math.floor(Date.now() / 1000) },
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source: source === 'git'
            ? { type: 'git', url: repoUrl, commit, path: repoDir }
            : { type: 'npm', registry: 'https://registry.npmjs.org' },
          engines: { dsh: pkg.engines?.dsh },
        },
      ],
    },
  ],
}

const out = join(root, 'market', 'index.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(index, null, 2) + '\n')
console.log('[zipx] market index -> ' + out + ' (source=' + source + ', version=' + pkg.version + ')')
