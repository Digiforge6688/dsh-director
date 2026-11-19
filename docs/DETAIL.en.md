# DSH Director (dsh-director) · Detail & design notes

> For people evaluating or extending this plugin. Install and quick start: [README](../README.md).
>
> ZipX sign-up: global <https://www.zipx.ai> · China <https://www.zipx.vip>.
>
> **1.0.2 (2026-11-19)**: canonical URLs moved to the renamed repository **`dsh-director`**
> (the GitHub repo was renamed; old links 301-redirect). **1.0.1 (2026-11-19)**: package renamed to **`dsh-director`** (the old `@zipx/dsh-plugin` stays at 0.3.0);
> display name unified as **DSH Director / DSH导演**; 43 tools with
> `presentationMeta`, 43 keyed native cards; paid actions go through `tools/pre-execute`;
> long tasks use `ctx.jobs.start`; workbench, artifacts, knowledge, review and delivery live in
> the right sidebar; project library, episodes, team, product images, export bundles and the
> creator knowledge base are available inside DSH.

## 0. What it delivers

| Type | Input | Output |
|---|---|---|
| Premium film | One idea, outline or reference direction | Cinematic short/brand film: script, storyboard, keyframes, shots, sound, master, delivery checklist |
| Multi-episode short drama | Novel, script, episode/runtime spec | Vertical drama advanced episode by episode: chapters, episodes, characters, scene contracts, final cuts |
| Creative video | One line or concept | 15–90s creative short: hook, storyboard, keyframes, voice, edit, subtitles |
| Product video | Selling points, brand/product, product images, CTA | Commercial or brand video: campaign brief, selling-point structure, product consistency, final cut and publish package |
| Novel / script adaptation | Source text | Chapter/scene breakdown straight into storyboard and generation |

The plugin does not generate content itself: it connects DSH conversation, approval, jobs and
cards to ZipX workflows, gates, billing and artifacts.

## 1. Where it sits

```text
User ⇄ DSH session (talks)          ← intent, clarification, plan, confirmation, receipts
        │ zipx_* tools (structured calls, bypassing the old chat classifier)
        ▼
ZipX FastAPI (does the work)         ← workflow, gates, repair, billing, idempotency
        │
        ▼
ZipX artifacts (script/storyboard/keyframes/final cut)
```

The plugin does three things only: wrap URL/credential/error semantics, turn structured facts
into human-readable model input (`output.render`), and decide long-task state without pretending
completion. It implements no creative capability and caches no business state.

## 2. Install

~~~powershell
dsh plugin --profile web add dsh-director@1.0.2
~~~

Or add the market index `https://cdn.jsdelivr.net/gh/Digiforge6688/dsh-director@main/market/index.json`
under **Plugins → Discover → Add index source** and search for **DSH Director / 短剧 / 带货视频**.

## 3. Identity and credentials

```text
config.token → ZIPX_DIALOGUE_TOKEN → ZIPX_TOKEN_FILE → ~/.zipx/dialogue-token.json
```

The token is a per-user delegated token (`channel=dsh` + `device_id`, 30 days). It lives only in
the Host process and DSH Credentials; the browser never receives it and talks to `/zipx-api`.

## 4. Paid actions

`zipx_start`, `zipx_confirm_step`, `zipx_regenerate_step`, `zipx_regenerate_item`,
`zipx_resume_step`, `zipx_start_episode`, `zipx_dispatch` and a paid `zipx_chat` return
`ask` from `tools/pre-execute`. Without an approval or a one-time confirmation card the action is
denied. The model's own `confirm: true` is never trusted.
