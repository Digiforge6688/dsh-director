#!/usr/bin/env node
/**
 * Generate a DSH plugin-market index (format 1) for this package.
 *
 * 为什么只有 npm / git 两种 source：DSH 的市场格式（packages/util/plugin-market-index）
 * 只接受这两种安装来源——**没有 "tarball URL" 这种 source**。所以"内网市场指向一个 tgz"
 * 这条路在格式上不存在；要么发布到 npm registry，要么给一个公开仓库的 commit sha。
 *
 * 名称与介绍只有一个来源：locale/<lang>.json 的 meta.title / meta.description。
 * 插件市场卡片、插件管理器、README 与这里都读同一份，避免"市场叫 A、装完叫 B"。
 *
 * 用法：
 *   node scripts/make-market-index.mjs --source npm
 *   node scripts/make-market-index.mjs --source git --commit <40-hex> --base-url https://cdn.example.com/zipx
 * 产物：market/index.json（base-url 决定 icon 这类绝对地址）。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
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

function localeMeta(lang) {
  try {
    return JSON.parse(readFileSync(join(root, 'locale', lang + '.json'), 'utf8')).meta || {}
  } catch {
    return {}
  }
}

const zhMeta = localeMeta('zh')
const enMeta = localeMeta('en')
const title = {
  en: String(enMeta.title || 'DSH Director'),
  zh: String(zhMeta.title || 'DSH导演'),
}
const description = {
  en: String(enMeta.description || 'Direct films, short dramas and product videos inside DSH.'),
  zh: String(zhMeta.description || '在 DSH 里做精品影视、多集短剧、创意视频与带货视频。'),
}

const source = String(arg('source', 'npm'))
const baseUrl = String(arg('base-url', '')).replace(/\/+$/, '')
const commit = String(arg('commit', ''))
const repoUrl = String(pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '')
const repoDir = pkg.repository?.directory
const now = Math.floor(Date.now() / 1000)

if (source === 'git' && !/^[0-9a-f]{40}$/.test(commit)) {
  console.error('--source git 需要 --commit <40 位小写 hex 的提交号>（格式 1 只接受精确 commit）')
  process.exit(2)
}

// 标签是市场里的筛选项；id 只能是声明过的 key，标题保持中英双语。
const labels = {
  film: { title: { en: 'Film', zh: '精品影视' } },
  'short-drama': { title: { en: 'Short drama', zh: '多集短剧' } },
  'creative-video': { title: { en: 'Creative video', zh: '创意视频' } },
  'commercial-video': { title: { en: 'Product video', zh: '带货视频' } },
}

const index = {
  format: 1,
  title,
  description,
  metadata: {
    categories: { creation: { title: { en: 'Creation', zh: '创作' } } },
    labels,
    sortKeys: { updated: { title: { en: 'Updated', zh: '最近更新' }, order: 'desc' } },
  },
  plugins: [
    {
      name: pkg.name,
      title,
      description,
      icon: baseUrl ? baseUrl + '/icon.svg' : pkg.icon,
      author: 'ZipX',
      homepage: pkg.homepage || undefined,
      repository: repoUrl ? { url: repoUrl, directory: repoDir } : undefined,
      metadata: {
        category: 'creation',
        keywords: pkg.keywords || [],
        labels: ['film', 'short-drama', 'creative-video', 'commercial-video'],
        sortKeys: { updated: now },
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: now,
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
// 索引里的 icon 是相对 market/ 的路径；顺手复制一份，避免 404。
if (baseUrl) {
  try {
    copyFileSync(join(root, 'icon.svg'), join(root, 'market', 'icon.svg'))
  } catch (error) {
    console.warn('[zipx] icon copy skipped: ' + String(error && error.message ? error.message : error))
  }
}
console.log('[zipx] market index -> ' + out + ' (source=' + source + ', version=' + pkg.version + ')')
