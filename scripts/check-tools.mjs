#!/usr/bin/env node
/**
 * Structural guard for the built host bundle: the tool surface must survive the
 * build. Catches the classic regression where a bad edit silently drops tools
 * (the live plugin keeps loading, it just knows less).
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const built = await readFile(join(root, 'lib', 'index.js'), 'utf8')

const EXPECTED_TOOLS = 35
const tools = [...built.matchAll(/name: 'zipx_[a-z_]+'/g)].map(m => m[0].slice(7, -1))
const problems = []

if (tools.length !== EXPECTED_TOOLS) problems.push(`expected ${EXPECTED_TOOLS} tools, found ${tools.length}`)
if (new Set(tools).size !== tools.length) problems.push('duplicate tool names: ' + tools.filter((t, i) => tools.indexOf(t) !== i).join(', '))
for (const required of ['zipx_project_state', 'zipx_preview_action', 'zipx_confirm_step', 'zipx_watch_step', 'zipx_abort', 'zipx_list_projects', 'zipx_bind_project', 'zipx_project_overview', 'zipx_artifacts', 'zipx_delivery', 'zipx_cost', 'zipx_repair_action', 'zipx_connect', 'zipx_events', 'zipx_dispatch']) {
  if (!tools.includes(required)) problems.push(`missing required tool ${required}`)
}
if (!built.includes('systemPrompt.section')) problems.push('system prompt section missing (discoverability)')
if (built.includes('fallbackBinding')) problems.push('global fallbackBinding is back (session isolation regression)')
if (!built.includes("'tools/pre-execute'")) problems.push('paid-action approval hook missing')
if (!built.includes('/zipx-media')) problems.push('media Range proxy missing')
if (!built.includes("get('jobs')")) problems.push('background job producer missing')
const metaCount = (built.match(/presentationMeta:/g) || []).length
if (metaCount < 10) problems.push('expected at least 10 tool presentationMeta projections, found ' + metaCount)
if (/\benum\b|\bnamespace\b/.test(built) === false) { /* erasable-only syntax: nothing to assert */ }

if (problems.length > 0) {
  console.error('[zipx] tool surface check FAILED:\n  - ' + problems.join('\n  - '))
  process.exit(1)
}
console.log(`[zipx] tool surface ok: ${tools.length} tools`)
