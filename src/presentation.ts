/**
 * Presentation projections for the native DSH tool cards.
 *
 * Every projection here is a PURE function of (args, canonical value): no clock,
 * no network, no React. The executor stores the result next to the call, so a
 * replayed session renders the same card offline. Keep each projection small —
 * the model still reads output.render, and only the card reads this.
 */

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : []
}

function text(value: any, max = 240): string {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'string' ? value : String(value)
  return raw.length > max ? raw.slice(0, max) + '…' : raw
}

/** Rewrite a backend media URL through the Host Range proxy so phones can play it. */
export function mediaProxyUrl(url: any): string {
  const raw = String(url || '')
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/')) return raw
  return '/zipx-media?u=' + encodeURIComponent(raw)
}

function mediaKind(path: string): 'video' | 'image' | 'audio' | 'other' {
  const lower = path.toLowerCase()
  if (/\.(mp4|webm|mov|mkv)$/.test(lower)) return 'video'
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(lower)) return 'image'
  if (/\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/.test(lower)) return 'audio'
  return 'other'
}

/** Default projection: enough for the generic card to show a compact fact sheet. */
export function metaGeneric(name: string) {
  return (_args: any, value: any) => {
    const bag = value && typeof value === 'object' ? value : {}
    const keys = Object.keys(bag).slice(0, 8)
    const facts: Record<string, string> = {}
    for (const key of keys) {
      const item = bag[key]
      if (item === null || item === undefined) continue
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') facts[key] = text(item, 160)
    }
    return { kind: 'generic', tool: name, keys, facts }
  }
}

export function metaState(_args: any, value: any) {
  const cur = value?.current ?? {}
  const gate = value?.gates?.overall ?? 'unchecked'
  const counts = value?.gates?.counts ?? {}
  return {
    kind: 'state',
    project_id: value?.project?.id ?? '',
    title: value?.project?.title ?? '',
    workflow_type: value?.project?.workflow_type ?? '',
    current: {
      step: cur.step ?? '',
      label: cur.label ?? '',
      lifecycle: cur.lifecycle ?? '',
      produced: cur.produced ?? null,
      expected: cur.expected ?? null,
      complete: cur.is_complete === true,
      gaps: cur.has_gaps === true,
      locked: cur.is_locked === true,
      gate_stale: cur.gate_stale === true,
      gate_unverified: cur.gate_unverified === true,
    },
    next_step: value?.next_step ?? '',
    gate,
    gate_counts: counts,
    legal_actions: asArray(value?.legal_actions).slice(0, 12),
    legal_actions_human: asArray(value?.legal_actions_human).slice(0, 12),
    next_suggestion: value?.next_suggestion ?? null,
    recent_events: asArray(value?.recent_events).slice(-8).map((e: any) => ({
      type: e?.type ?? e?.event_type ?? '',
      summary: text(e?.summary ?? e?.title ?? '', 160),
      step: e?.step ?? '',
      at: e?.at ?? e?.created_at ?? '',
    })),
  }
}

export function metaPreview(args: any, value: any) {
  const cost = value?.cost_estimate ?? {}
  return {
    kind: 'preview',
    project_id: args?.project_id ?? '',
    action: args?.action ?? '',
    allowed: value?.allowed === true ? true : value?.allowed === false ? false : null,
    reason: text(value?.reason_human ?? value?.reason ?? '', 400),
    gate: value?.gate ?? '',
    paid: cost?.paid === true,
    credits: cost?.credits ?? cost?.estimated_credits ?? cost?.amount ?? null,
    currency: cost?.currency ?? 'credits',
    note: text(cost?.note ?? '', 240),
    downstream: asArray(value?.downstream_impact).slice(0, 12),
    alternatives: asArray(value?.alternatives).slice(0, 6).map((a: any) => ({
      action: a?.action ?? '',
      label: text(a?.label ?? a?.human ?? '', 80),
    })),
    blockers: asArray(value?.blockers).slice(0, 6).map((b: any) => text(b?.message ?? b?.reason ?? b, 200)),
  }
}

export function metaDispatch(tool: string) {
  return (args: any, value: any) => ({
    kind: 'dispatch',
    tool,
    project_id: args?.project_id ?? value?.project_id ?? '',
    action: args?.action ?? args?.step ?? args?.step_type ?? '',
    state: value?.state ?? value?.status ?? (value?.advanced === true ? 'advanced' : ''),
    pipeline_fired: value?.pipeline_fired === true,
    advanced: value?.advanced === true ? true : value?.advanced === false ? false : null,
    current_step: value?.current_step ?? '',
    lifecycle: value?.lifecycle ?? '',
    job_id: value?.job_id ?? '',
    reply: text(value?.reply ?? value?.message ?? value?.reason ?? '', 400),
  })
}

export function metaWatch(args: any, value: any) {
  const preview = value?.preview && typeof value.preview === 'object' ? value.preview : null
  return {
    kind: 'watch',
    project_id: args?.project_id ?? '',
    step: args?.step ?? '',
    mode: value?.mode ?? (value?.job_id ? 'background' : 'blocking'),
    job_id: value?.job_id ?? '',
    note: text(value?.note ?? '', 300),
    timed_out: value?.timed_out === true,
    current_step: value?.current_step ?? '',
    lifecycle: value?.lifecycle ?? '',
    produced: value?.produced ?? null,
    expected: value?.expected ?? null,
    complete: value?.is_complete === true,
    locked: value?.is_locked === true,
    gate: value?.gates ?? 'unchecked',
    // 2026-11-17：完成时的产物预览（阻塞模式 / job_output 里读到的结果）。
    preview: preview ? {
      label: preview.label ?? '',
      summary: text(preview.summary ?? '', 200),
      gate: preview.gate ?? 'unchecked',
      score: preview.score ?? null,
      threshold: preview.threshold ?? null,
      excerpt: text(preview.excerpt ?? '', 600),
      media_count: preview.media_count ?? 0,
      media: asArray(preview.media).slice(0, 4).map((m: any) => ({
        label: text(m?.label ?? '', 80),
        kind: m?.kind || mediaKind(String(m?.url ?? '')),
        url: mediaProxyUrl(m?.url ?? ''),
      })),
    } : null,
  }
}

export function metaArtifacts(args: any, value: any) {
  const out = value?.output && typeof value.output === 'object' ? value.output : {}
  const steps = Object.keys(out).map((step) => {
    const item = out[step] ?? {}
    const urls = item.media_urls && typeof item.media_urls === 'object' ? item.media_urls : {}
    return {
      step,
      status: item.status ?? '',
      summary: text(item.summary ?? item.note ?? '', 220),
      media: Object.keys(urls).slice(0, 24).map((path) => ({
        path,
        kind: mediaKind(path),
        url: mediaProxyUrl(urls[path]),
      })),
    }
  })
  return {
    kind: 'artifacts',
    project_id: args?.project_id ?? value?.project_id ?? '',
    steps_filter: args?.steps ?? '',
    steps,
  }
}

export function metaResult(args: any, value: any) {
  const counts = value?.counts && typeof value.counts === 'object' ? value.counts : {}
  const gate = value?.gate && typeof value.gate === 'object' ? value.gate : null
  return {
    kind: 'result',
    project_id: value?.project_id ?? args?.project_id ?? '',
    step: value?.step ?? args?.step ?? '',
    label: value?.label ?? '',
    status: value?.status ?? '',
    updated_at: value?.updated_at ?? '',
    summary: text(value?.summary ?? '', 300),
    has_content: value?.has_content === true,
    text: text(value?.text ?? '', 2600),
    text_source: value?.text_source ?? '',
    text_chars: value?.text_chars ?? null,
    truncated: value?.truncated === true,
    counts,
    gate: gate ? {
      overall: gate.overall ?? 'unchecked',
      score: gate.score ?? null,
      threshold: gate.threshold ?? null,
      note: text(gate.note ?? '', 160),
      summary: text(gate.summary ?? '', 320),
      reasons: asArray(gate.reasons).slice(0, 3).map((r: any) => text(r, 200)),
    } : null,
    media_total: value?.media_total ?? 0,
    media: asArray(value?.media).slice(0, 8).map((item: any) => ({
      path: item?.path ?? '',
      kind: item?.kind || mediaKind(String(item?.path ?? '')),
      label: text(item?.label ?? '', 90),
      url: mediaProxyUrl(item?.url ?? ''),
    })),
    empty_reason: text(value?.empty_reason ?? '', 200),
  }
}

/** zipx_read_asset 的卡片投影：value 是原始资产（content 可能是任意结构）。 */
export function metaAsset(args: any, value: any) {
  const content = value?.content && typeof value.content === 'object' ? value.content : {}
  const textKeys = ['story_text', 'script_text', 'hook', 'chapter_text', 'scene_text']
  let body = ''
  for (const key of textKeys) {
    const candidate = content[key]
    if (typeof candidate === 'string' && candidate.trim()) { body = candidate; break }
  }
  return {
    kind: 'result',
    project_id: value?.project_id ?? args?.project_id ?? '',
    step: value?.step ?? args?.step ?? '',
    label: '',
    status: value?.status ?? '',
    updated_at: '',
    summary: value?.truncated === true ? ('全文 ' + (value?.raw_len ?? '?') + ' 字符（已截断）') : '',
    has_content: value?.content !== null && value?.content !== undefined,
    text: text(body, 2400),
    text_source: body ? 'content' : '',
    text_chars: value?.raw_len ?? null,
    truncated: value?.truncated === true,
    counts: {},
    gate: null,
    media_total: 0,
    media: [],
    empty_reason: value?.content == null ? '这一步还没有产物。' : '',
  }
}

export function metaCost(args: any, value: any) {
  return {
    kind: 'cost',
    project_id: args?.project_id ?? value?.project_id ?? '',
    step: args?.step ?? '',
    balance: value?.balance ?? null,
    estimate: value?.estimate_calls ?? null,
    estimate_kind: value?.estimate_kind ?? '',
    estimate_source: value?.estimate_source ?? '',
    currency: value?.currency ?? 'credits',
    affordable: value?.affordable === true ? true : value?.affordable === false ? false : null,
    note: text(value?.note ?? '', 240),
    breakdown: asArray(value?.breakdown ?? value?.items).slice(0, 8).map((it: any) => ({
      label: text(it?.label ?? it?.name ?? '', 80),
      credits: it?.credits ?? it?.amount ?? null,
    })),
  }
}

export function metaDelivery(args: any, value: any) {
  const counts = value?.counts ?? {}
  return {
    kind: 'delivery',
    project_id: args?.project_id ?? value?.project_id ?? '',
    has_compose: value?.has_compose === true,
    release_ok: value?.release_ok === true ? true : value?.release_ok === false ? false : null,
    counts: {
      pass: counts.pass ?? 0,
      warn: counts.warn ?? 0,
      fail: counts.fail ?? 0,
      pending: counts.pending ?? 0,
    },
    checklist: asArray(value?.checklist).slice(0, 24).map((it: any) => ({
      key: it?.key ?? '',
      label: text(it?.label ?? it?.key ?? '', 100),
      status: it?.status ?? 'pending',
      note: text(it?.note ?? it?.value ?? '', 260),
    })),
    media_url: mediaProxyUrl(value?.media_url ?? ''),
    video_path: value?.video_path ?? '',
    checked_at: value?.checked_at ?? '',
  }
}

export function metaLocks(args: any, value: any) {
  const locks = value?.locks && typeof value.locks === 'object' ? value.locks : {}
  return {
    kind: 'locks',
    project_id: args?.project_id ?? '',
    all_signed: value?.all_signed === true,
    locks: Object.keys(locks).map((key) => ({
      key,
      signed: locks[key]?.signed === true,
      available: locks[key]?.available === true,
      signed_at: locks[key]?.signed_at ?? '',
      note: text(locks[key]?.note ?? '', 160),
    })),
  }
}

export function metaProjects(_args: any, value: any) {
  const items = asArray(value?.items)
  return {
    kind: 'projects',
    total: value?.total ?? items.length,
    page: value?.page ?? 1,
    items: items.slice(0, 30).map((it: any) => ({
      id: it?.id ?? '',
      title: it?.title ?? '',
      current_step: it?.current_step ?? '',
      gates: it?.gates ?? 'unknown',
      updated_at: it?.updated_at ?? '',
      cover: mediaProxyUrl(it?.cover_url ?? it?.cover ?? ''),
    })),
  }
}

export function metaBind(args: any, value: any) {
  return {
    kind: 'bind',
    project_id: value?.project_id ?? args?.project_id ?? '',
    session_id: value?.session_id ?? '',
    rebound: value?.rebound === true,
    note: text(value?.note ?? '', 260),
  }
}

export function metaConnect(_args: any, value: any) {
  return {
    kind: 'connect',
    channel_state: value?.channel_state ?? 'unknown',
    channels: asArray(value?.channels).slice(0, 8),
    account: value?.account ?? '',
    device: value?.device ?? '',
    expires_at: value?.expires_at ?? '',
    write_mode: value?.write_mode ?? '',
    tools: value?.dsh_tools ?? null,
  }
}
