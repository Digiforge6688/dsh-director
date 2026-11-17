#!/usr/bin/env node
/**
 * Zero-dependency build: strip TypeScript types with Node's own `stripTypeScriptTypes`
 * and emit plain .js files into lib/ next to the source tree.
 *
 * Constraints (deliberate, they keep the build dependency-free):
 *  * src/ uses erasable syntax only — no enum, namespace, parameter properties.
 *  * relative imports must carry the .js extension (nothing rewrites specifiers).
 *
 * `.js` sources are copied verbatim: src/client/index.js is the hand-written
 * browser bundle (window.__ModuleLoader__.load factory) — it has no types to
 * strip and must reach lib/client.js byte-for-byte.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const srcDir = join(root, 'src')
const libDir = join(root, 'lib')

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) files.push(full)
  }
  return files.sort()
}

const clientDir = join(srcDir, 'client')
const files = (await walk(srcDir)).filter(file => !file.startsWith(clientDir + sep))
await rm(libDir, { recursive: true, force: true })
for (const file of files) {
  const code = await readFile(file, 'utf8')
  // .ts → 擦类型；.js 原样拷贝。
  const out = file.endsWith('.ts') ? stripTypeScriptTypes(code, { mode: 'strip', sourceUrl: file }) : code
  const target = join(libDir, relative(srcDir, file).replace(/\.ts$/, '.js'))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, out, 'utf8')
}
// Browser half: ordered plain-JS parts concatenated into one factory bundle.
const clientParts = (await readdir(clientDir)).filter(name => name.endsWith('.js')).sort()
const clientBundle = (await Promise.all(clientParts.map(name => readFile(join(clientDir, name), 'utf8')))).join('\n')
await writeFile(join(libDir, 'client.js'), clientBundle, 'utf8')
console.log('[zipx] built ' + files.length + ' host file(s) + ' + clientParts.length + ' client part(s) into lib/')
