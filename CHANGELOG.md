# CHANGELOG

## 0.3.0（2026-11-16，P0–P3：对话优先 + 原生卡片 + 批准 + 后台任务 + 右侧栏）

以 `docs/ZipX_DSH_融合体验重构与增长可行性方案_20261116.md` 为唯一方案，替换 0.2.x 的
「main 全屏面板 + 假聊天 + 内嵌 Studio 主路径」。旧模块能用的搬进新壳，不能用的直接删除，
不留第二套实现。

### P0 可发现 / 可连接 / 不绑错

* `package.json`：`dsh.client.inject` 17 个客户端包；宿主 credentials/jobs/webserver/session/
  user-approval 为可选 peer；license 改 MIT；版本 0.3.0；keywords 加 `dsh-zipx`/`ai-film`。
* **token 迁进 DSH Credentials**（`zipx/account`）：优先 credentials，旧
  `~/.zipx/account-token.json` 首次启动一次性迁移为 `.migrated`；无 credentials 服务时显式降级文件。
* **删除全局 `fallbackBinding`**：新会话不再继承上一个项目；缓存缺失时
  `GET /session/{dsh_session_id}` 恢复，恢复不到就报「未绑定」。
* `zipx_create_project` / `zipx_bind_project` 只绑当前会话，并写 `external_sessions`；
  没有会话 id 时拒绝写全局绑定。
* 新设置页：连接 / 账号 / 积分 / 预算 / 诊断；新增 `/zipx-auth/status`、`/zipx-budget`、`/zipx-doctor`。
* 新增 `/zipx-media` Range 代理（只放行 ZipX 文件路径，支持 206/HEAD），手机可拖进度条。

### P1 对话优先 + 卡片 + 批准 + 后台任务

* `conversation.session.header.actions` 项目 Chip；`conversation.composer.dock` 状态条；
  `conversation.hero.options` 首屏入口。
* `tool.call.toolview` 注册 **35 个 keyed 卡片**，其中 18 个专属：
  状态 / 预检 / 执行 / 进度 / 产物 / 成本 / 交付 / 四锁 / 项目库 / 绑定 / 连接 / 开始 / 切换。
* 每个工具都有 `output.presentationMeta`（纯函数、可回放、JSON-safe）；默认投影覆盖长尾工具。
* **原生批准**：`tools/pre-execute` 对 7 个付费工具 + 会触发付费的 `zipx_chat` 返回 `ask`；
  无批准通道时拒绝（`ZIPX_ALLOW_UNCONFIRMED=1` 仅显式放行）。`confirm: true` 不再被信任。
* **预算拦截**：每步/每日上限，超出时在批准前 deny；批准后在 `tools/result` 记账。
* **后台任务**：`zipx_watch_step` 用 `ctx.jobs.start` 立即返回 job id；完成由 ui-jobs 通知；
  无 jobs 服务时退回阻塞等待。取消只停跟踪，如实说明后端可能仍在生成。
* `zipx_confirm_step` 不再阻塞 90 秒：只回「已受理」，真实进度交给 `zipx_watch_step`。

### P2 右侧栏工作台 + 产物 + 交付

* 四个 Tab 类型：`zipx-workbench` / `zipx-artifact` / `zipx-delivery` / `zipx-studio`，
  通过 `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab`（按类型 id keyed）接线。
* 工作台：步骤列表、当前步骤产物、推进/重做/交付/legacy 按钮；按钮只发用户消息。
* 产物 Tab：图片/视频/音频/文本，视频走 `/zipx-media`；交付 Tab：检查单 + 成片播放。
* **main 面板降级为项目库**：列表/搜索/新建/绑定；不再有假聊天与三栏 Studio。
* `?zipx_shell=legacy` 保留回退：项目库 + 内嵌 Studio；右侧栏也有 legacy Tab。

### P3 命令 / 引用 / 移动端 / 发布素材

* `/zipx`、`/zipx-status`、`/zipx-doctor`（`ctx.commandUi`）。
* `@项目` 引用（`ctx.inputTriggers`）：插入 `<zipx_project id="…"/>` 并绑定本会话。
* 卡片/列表/状态条响应式（auto-fill grid、flex-wrap），右侧栏走 DSH 全屏规则。
* README 第一屏改成「结果 + 5 分钟 + 成本 + 原生能力」；market index 0.3.0 结果导向。
* 新增 `scripts/check-host.mjs`（绑定/批准/后台任务/卡片/media）、重写 `scripts/check-panel.mjs`。

### 2026-11-17 边界补强（仍属 0.3.0）

* **真取消**：新增 `zipx_abort` 工具 + 后端 `POST /api/v3/director/project/{id}/abort`，复用唯一实现
  `WorkflowV2Manager.abort_step`（置 abort 标志、强制释放执行锁、项目置 failed、写活动日志）。
  `zipx_watch_step` 的后台任务 `cancel()` 现在**同时请求后端中止**，不再只停轮询；文案如实写
  「已发出的付费调用可能仍完成，后续步骤不会继续」。
* **成本口径可见**：成本卡显示 `estimate_kind`；`precheck_threshold` 明确写「开拍前余额预检门槛，
  不是最终报价」。
* **产物签名可刷新**：产物卡新增刷新按钮，重新调 `/artifacts?media=1` 换新签名 URL（过期不再只能重开面板）。
* **LAN/手机**：Host 代理从「仅回环」放宽到「回环或同一个 DSH 页面」，手机经 LAN 打开 DSH 也能用
  `/zipx-api`、账户、诊断与媒体代理。

### 删除 / 替换

* 删除 `src/client.js` 单文件大 bundle（194KB）与其中的假聊天、内嵌 Studio 主路径、
  旧三栏 `ZipxPanel`；客户端拆成 `src/client/*.js` 由 `scripts/build.mjs` 顺序拼接。
* 删除 `fallbackBinding`、对 `confirm` 的信任、阻塞式 watch 主路径。
* 旧 `ZipX × DSH：插件生态接入 + 对话系统替代` 的 DSH 面板实现不再作为入口；本版以
  《融合体验重构与增长可行性方案》为唯一方案。


业主裁定「按 B1 执行」——预览要与 zipx studio 前端界面**每个工作流的设计显示一致**。
0.2.6 只做到"数据源与字段对齐"（同一份产物、同样的场景字段拆法），富交互（分镜编辑器、
候选帧、EDL 时间轴）仍只在 Studio 里有。这一版改成**不复制设计**：

* **iframe 直接跑 Studio**：产物区新增两档「Studio 视图 / 对话卡片」，**默认 Studio 视图**。
  iframe 打开的是 `{studioUrl}/studio/{projectId}/embed/{step}` —— Studio 里那一步的原界面，
  不是重画的一版。切到「对话卡片」是原来的精简视图（窄、纯文本、不依赖 Studio 起没起）。
  偏好记在 `zipx.wbView`。
* **凭证不进浏览器（除了一次性码）**：面板 → Host `/zipx-embed/url`（Host 侧带令牌）→
  ZipX `POST /api/v3/director/project/{id}/embed-code` 发**一次性、120 秒**的兑换码 →
  Host 把码拼进 iframe 地址 `?vc=…` → iframe 兑换出一条 **15 分钟**令牌存
  `sessionStorage`。诚实边界：换到的仍是**完整用户令牌**，只是寿命 15 分钟；它不写
  `localStorage`（那会覆盖用户自己在 Studio 标签页的登录态），也不进 URL。
* **码是一次性 ⇒「重新载入」必须重新签发**：iframe 里的重载通过 `postMessage` 回到面板，
  面板重新申请一次再换 `src`；地址栏里的 `?vc=` 兑换后立刻 `replaceState` 抹掉。
* **凭证过期如实可见**：15 分钟后 iframe 顶部出现一条「预览凭证已过期，点重新载入」，
  不假装还能用。
* **回归**：`check-panel.mjs` 新增 5 项（文案中英齐全 / 走 `/zipx-embed/url` /
  `StudioEmbed` 存在 / 默认 Studio 视图 / 切换会写回偏好）；locale 274 键中英一致。

## 0.2.6（2026-11-16，对话入口交给「属于这个项目的 DSH 会话」＋回执诚实＋预览人话化）

业主三条反馈：「点『DSH 导演』跳到了我正在进行的别的会话，不是在这个项目里创作」、
「图三输入内容后系统没法理解和推进」、「预览文本还是 JSON 格式，要和 Studio 每步的设计一致」。

* **对话入口：新开一个本项目的 DSH 会话，不再往当前输入框塞字**。旧实现是
  「把［ZipX 项目］+ 你说的话压进当前挂载的 composer，然后 `layout.selectPanel(null)`」——
  于是话落进了用户上一次开着的会话（真机：落进一个完全无关的任务会话），而递过去的还只是
  一句导航标签。现在走 `uiWorkspace.startSession({ prompt })` 新建会话；桥只把话交给
  **推送之后才挂载**的输入框（旧会话的输入框不接），并在用户本来就点了发送时替他按回车；
  拿不到 `uiWorkspace` 的老版 DSH 退回"塞进当前输入框"，**不再主动把视图切走**。
* **绑定即角色**：交接文本先要求模型调 `zipx_bind_project`；该工具的回执现在是**导演角色卡**
  （先读状态、写前预检、付费先问、一次一个写动作、只说「已派发」、读不到就说读不到）。
  DSH 的 preset 不随第三方插件分发，工具结果是目前唯一能可靠交出身份的时机。
* **预览：场景串拆成人话字段**。后端把场景写成 `【Scene 6】景: 修表铺柜台时: 同日晌午人: 女人、老师傅`，
  Studio 会拆成地点/时间/人物；面板此前原样打印，看起来就像 JSON。现在同一套字段拆出来
  （`景/时/人`），正文单独一行；剧集规划额外给「这部剧已经拆成 N 集」的子项目卡片（集号/状态/场数/打开），
  与 Studio 的 EpisodesView 同一份数据源。
* **不再拿 JSON 当正文**：「最长字符串」兜底会跳过 `{`/`[`/`"` 开头的片段；没有结构化预览时
  如实说「这一步暂时只有统计，全文点『在网页 Studio 看』」；原始 JSON 入口改名为「调试：原始 JSON」。
* **后端回执诚实（P0 真机工单）**：项目 3ebb080f「AI 东方」14:13 那一轮被判
  `blocked / dispatch_not_fired:START_WORKFLOW`，而同一时刻 `creative_events` 是
  `turn.responded(start_workflow) → expert.activated 06:18 → gate.evaluated 06:37 → artifact.saved(story) 06:47`
  —— 创作真的跑完了，回执却说没派发。根因：`_execute_start_workflow` 已经 `create_task` 起跑，
  动作字典却没有 `pipeline_fired`。现在唯一派发判据 `DirectorAgent._spawn_background()`，
  START_WORKFLOW / START_EPISODE（两条入口）/ RESUME 的拒绝分支全部显式写这个字段；
  `PAUSE` 从"异步"改判"同步完成"（置位失败用 `ok=False` 判 `blocked:sync_failed`）；
  `ADVANCE_WORKFLOW` 补进异步名单（原来登记的是没有任何发送方的 `ADVANCE_STEP`，导致
  未起跑的推进落成 done）。
* **回归**：`backend/tests/test_async_action_dispatch_flag_nov2026.py`（9 项，含源码守卫：
  ASYNC_ACTIONS 里任何类型出现时必须带 `pipeline_fired`，第四次复发当场红）；
  `test_advance_refusal_honesty_oct2026.py` 一并 18 项通过；插件 `npm run check` 全绿（locale 265 键中英一致）。

## 未发布（2026-11-13 深夜，工作台 v4：按步骤渲染 / 父项目→子剧集 / 导演方案可见 / 上下分栏）

业主两条反馈：「工作台和预览区的横线做成可以上下拖拽放大的」+「从剧集规划看，内容显示不正确，
剧集设计的内容没能正确显示。请检查全部工作流链路的接线情况……是全部工作流」。

* **上下分栏**：工作台内部（步骤列表 / 产物预览）之间新增可拖拽横线（14%–80%，双击复位，
  比例进 localStorage）。原来步骤区写死 `max-height:44%`，产物区再大也挤不动。
* **每一步按它自己的结构渲染**（这是"内容显示不正确"的根因）：以前统一取"最长的那段字符串"当正文，
  剧集规划的 `episodes[].scenes` 是整段剧本，于是屏幕上出现的是某一集的第 9 场，用户看不到
  "几集 / 每集几场 / 每集讲什么"。现在：剧集规划=每集卡片（集/场/时长/角色 + 前 3 场首行）；
  剧集设计=集号/场数/镜头数 + 设计摘要 + 场景列表；导演方案=场数/硬规则/覆盖义务 + 导演简报
  （Markdown）；分镜设计=场数/镜头数 + 前几镜；剧集规划/剧本=场景列表；声音/剪辑/合成/后期各有摘要。
  结构化步骤不再跑"最长字符串"扫描（95 万字符的 episode_design、1.4MB 的 keyframes 不再整树遍历）。
* **父项目的剧集阶段步骤**：以前点「剧集设计」只显示"还没有产物"——那一步是按集生成的，父项目本来就没有。
  现在给出「这一步按集生成」+ 子剧集按钮（第 N 集 · 场数），点进去就是那一集的产物。
* **剧集子项目只显示 episode 阶段步骤**：`/workflow-steps?workflow_type=episode` 回的是 14 步全链
  （API 把未知类型回落到 idea2video），面板按 `is_episode_step` 收敛成 9 步并重新编号 1–9。
* **后端：产物白名单从注册表派生**（真正的接线缺口）。`/project/{id}/artifacts` 以前手写白名单，
  漏了 2026-11-11 新增的 `directing`（导演方案）——库里真有 2 条 directing 资产，网站与面板都显示
  "没有产物"。现在唯一派生点 `artifact_types_for_read()`（注册表步骤 id ∪ 历史别名 ∪ review_stills），
  新增测试 `tests/test_artifact_visibility_wiring_nov2026.py` 扫全仓 `_save_asset(…, "<type>")`，
  任何写得出却读不到的类型当场红。`verify.ps1` 14 → 15 步。
* 顺手：生命周期词条改走字典（`awaiting_confirm` 不再原样吐英文）；场景行不再重复 `[1]` 编号；
  导演方案的 totals 用「场 / 条规则 / 条硬规则 / 条覆盖义务」而不是英文键名。

**真机验收（隔离 t1 :3990）**：剧集规划卡片 ✓、剧集设计→按集提示 ✓、子剧集步骤收敛 ✓、
子剧集剧集设计有产物 ✓、导演方案读到 25.5KB 产物并显示"共 9 场 · 硬规则 7 条 · 覆盖义务 0 条" ✓、
上下分栏拖动 496→586 ✓；v3 那套 18 项回归仍全绿；后端 pytest 3/3 通过。

## 未发布（2026-11-13 晚，面板 v3：可拖拽工作台 / 新建 / 账户 / DSH 对话；发布时 bump 到 0.2.6）

业主三条反馈，逐条落到代码：

* **工作台能点开任何一步的产物**。此前只在选中项目时预拉 `steps=keyframes,compose`，其余步骤的产物永远看不到；现在点哪一步就取哪一步（`GET /project/{id}/artifacts?media=1&steps=<step>`，命中缓存 60 秒）。视频可播、图片可点开大图（灯箱）、长文本给预览、原始 JSON 折叠，并**分开**说「正在读 / 读不到（HTTP x）/ 这一步还没有产物」——「没生成」不等于「生成失败」。
* **对话与工作台之间是可拖拽的分栏**（320–720px，双击复位，宽度记在 localStorage）。产物区默认 420px、图片网格 112px 起，分镜/关键帧不再挤成 88px 缩略图。拖拽用 pointer capture + React 事件，不碰 `window.addEventListener`（动态包的浏览器全局是被收窄的）。
* **面板里能新建项目**：标题 / 题材 / 一句话创意 / 起点 / 画幅 / 平台 / 模式 → `POST /setup`，`auto_start:false`——**建项目不花钱**，要不要开工由接下来的对话决定。
* **账户、登录、创作者中心进入插件**：新增 Host 侧 `/zipx-account` 代理（`/api/v1/{auth,user,credits}` 里**明确列出**的六个动作）。注册/登录/退出/改名/改密码/看积分都在面板里；`access_token` 只落 Host 进程与 `~/.zipx/account-token.json`（0600），浏览器只拿到 `{ok,user}`。**退出登录同时清掉配对令牌**，否则「退出」之后旧令牌仍然可用。新增 `scripts/check-account-route.mjs`（假后端，不创建账号）：令牌不外泄 / 登录态 / 额度 / 退出即失效 / 白名单外 404；`verify.ps1` 13 → 14 步。
* **对话系统默认改用 DSH 的**（回答业主第 3 条）。此前面板里跑的确实是 **ZipX 自己的 DirectorAgent**（`/api/v3/director/chat`：意图分类、守卫、计划模式）——只是被画进了 DSH，这是事实陈述不是设计意图。现在默认「DSH 导演」：面板**不复制对话**，把「［ZipX 项目：标题｜id］+ 你说的话」写进 DSH 的输入框并切到对话视图（`conversation.input.right` 桥：先在光标处 `insertText`，这样 DSH 里已有的草稿不会被顶掉；拿不到光标才退回 `setDraft`），由带 34 个 zipx 工具的 DSH Agent 规划与派发；抓不到输入框时如实降级为剪贴板，不谎称「已发送」。「Studio 引擎」保留原来的 DirectorAgent 对话，标签上直接写明它是 Studio 引擎，用于对照与旧会话。
* **动态包的定时器**：`setTimeout`/`setInterval`/`fetch` 在动态包里会抛（DSH 的 guard 明确拒绝）。面板的"思考中计时 / 提示自动收起 / 交接兜底"改用 `inject:['timer']` 的 `ctx.timer`；深链自动切面板也改用 `ctx.timer.timeout` 重试（此前靠 `window.setTimeout`，在真机里一次都没跑起来）。
* **诚实边界**：DSH 没有「在非对话面板里嵌对话」的公开 API，能拿到的是 composer 的 `setDraft/submit`。所以面板不冒充对话渲染器——它把话交出去，由 DSH 自己显示那一轮；面板里的 DSH 卡片写清了这一点。

## 未发布（2026-11-13，面板重做；发布时 bump 到 0.2.6）

面板从「只读工作台」变成「能对话的工作台」。业主原话：「没有对话创作系统的对话框，对话创作是 zipx 创作的核心入口」+「前端编排混乱，缺乏美感」。

* **对话是主舞台**：面板直接调 `POST /zipx-api/chat`——与 Studio **同一个导演 Agent、同一张 `dialogue_turns` 表**，不是第二套对话引擎。说话就能推进/修改/重做；付费动作仍由导演先问；回执把 `actions` 作为 chip 显示，派发后只说「已派发」，不假装完成。
* **重新编排**：顶部 48px 状态栏（品牌 / 连接态 / 刷新），左侧 264px 项目库（搜索 + 门禁徽章 + 产出），中间对话（气泡、时间、理解成什么、思考中计时、停止等待），右侧可折叠工作台（步骤 / 产物 = 成片播放器 + 关键帧）。原来的「三列挤一屏、11px 字、8 个竖排按钮、把句子复制到会话里让模型执行」全部删掉——动作现在**直接填进输入框**。
* **对话记录**：新增 `/zipx-os` 只读代理（→ `/api/v3/creative-os`）；后端 `runtime.snapshot` 补 `reply` / `intent_type`，`raw_message` 160 → 800 字符。Host 未重启（代理还 404）时退回本机缓存并如实说明，不把「读不到」说成「没有」。
* **Markdown**：导演的回话是 Markdown（`**粗体**`、编号清单），此前原样吐星号。现在只认三种结构：粗体、有序/无序清单、空行分段。
* **意图/生命周期说人话**：`revision_run` → 「整段返工」、`advance_step` → 「推进下一步」；`passed` → 「已通过」。`none` 不再显示成一条 chip。
* **门禁**：新增 `scripts/check-panel.mjs`（最小 React 渲染，断言空舞台/深链/输入框/发送禁用，抓「白屏」这类语法检查抓不到的事故）与 `scripts/sync-locale.mjs`（`locale/*.json` 由面板字典生成，`--check` 不一致就红）；`verify.ps1` 11 → 13 步。
* **实测**：隔离 profile 冷启动 + 无头 Chrome，19 个项目、`pageerror` 0、`failedResponses` 0；截图 `screenshots/02-workbench.png`。

## 0.2.5 — 2026-11-13

真机验收（DSH Web 重启后）暴露的三条「说了假话」，都与**花钱**或**状态**有关：

* **预检把「会花钱」报成免费**：`zipx_preview_action` 对 `advance_step` 回 `paid:false`，而它实际会起跑下一步生成——实测 `campaign_brief` → `creative_script` 扣 **10 credits**。现在回 `action_paid / triggers_generation / generates_step / note`，render 直接说「推进本身不计费，但它会起跑下一步「创意脚本」的生成」。
* **状态卡把「下一步」说成当前步**：站在「创意简报」上写「你要推进到下一步「创意简报」」——指回自己。现在对着 `next_step_id` 说话；链尾（如父项目的 `compose`）改说「收尾交付（已是最后一步）」，不再让人以为后面还有阶段。
* **`fetch failed` 读成「后端坏了」**：长驻 Host 进程的 keep-alive 池在后端容器重启后会留一批死 socket。GET 现在对连接级失败重试 3 次（写请求一律不重试，付费动作不能被 socket 抖动执行两遍）。
* **新增 `zipx_dispatch`（工具面 33 → 34）**：契约能力清单里的 8 个付费动作，此前有 4 个（`modify` / `style_adjust` / `batch_modify` / `restart`）只能靠 `zipx_chat` 用人话触发——要过意图分类，分类错了就变成「改成了别的东西」。现在有结构化写入口，走同一个唯一派发口 `/dispatch`，动作与参数原样交出。写路径 E2E 从 14 项加到 **18 项**：`modify` / `style_adjust` / `batch_modify` / `restart` 四个动作逐个断言「不带 confirm 必须 409 `confirm_required`」（全部零成本）。真机校验：不带 `confirm` 的 paid 动作 → 409 `confirm_required`（「这个动作可能触发付费生成调用。先确认（confirm=true），或先 preview 看成本。」）。
* **代理侧也修了一次「fetch failed」**：`/zipx-api` 的 GET 现在重试一次；写请求不重试，但 502 里写明「这是连接级失败、请求可能没送达、付费动作请带 idempotency_key」，并带上 `retryable` 与 `upstream`。
* **`zipx-creator` 技能真的挂上了**：`skills/zipx-creator/SKILL.md` 从 0.1.0 就随包发出去，但没有任何代码把它注册进 DSH——技能清单里看不到，等于「文档带了、入口没有」。现在经 `ctx.skills.registerProvider` 注册（模型与用户都可调起，rank=600 与自带包同级）。新增 `scripts/check-skill.mjs`：用假 ctx 跑 `apply()`，断言 provider 被注册、`list()` 给出 `zipx-creator`、`get()` 真能读出正文。
* **验收脚本自己先能红**：`verify.ps1` 此前用 `node xxx.mjs | Out-Null`，脚本 `exit 1` 也照样打 PASS（输出还被吞掉）。现在每个 node/pnpm 调用都检查退出码并抛出（红测：`node -e process.exit(7)` → 当场 FAIL）。步骤 8 → 9。
* **后端的 409 现在直接说人话**：此前 `ZipX /api/v3/director/dispatch -> HTTP 409: {"detail":{"code":...}}` 整段塞给模型，而 `detail.message` 里本来就是「先确认（confirm=true）」这种人话。现在优先取 `detail.message`（或 `detail` 字符串），`status`/`code` 挂在 Error 上；非 JSON 错误体保留原文。
* **验收先等后端真的起来**：`verify.ps1` 新增第 1 步「/health 连续两次 200（最多 90 秒）」。真机教训：容器刚重启时 uvicorn 已绑端口但深链路在初始化，第 7 步照过、后面的 audit/E2E 偶发 `fetch failed`，把「后端在开机」误报成「插件坏了」。超时算失败，不静默继续。（顺带：这个文件必须保持纯 ASCII——PS 5.1 把无 BOM 的 UTF-8 当 ANSI 读，中文注释会让它解析失败。）
* **新增 `scripts/check-net.mjs`（第 10 步验收）**：用本地假服务把三条网络行为钉死——409 人话原样透出且不重试、GET 连接被掐断会重试一次、**写请求连接失败不重试**（付费动作不能重放）。以前这三条只能靠真机偶发观察。
* `/zipx-api` 补回环校验：它替浏览器注入配对令牌，所以只接受本机连接（回环外一律 403 `not_loopback`）。实测 3080 只监听 127.0.0.1，这条挡的是「把 DSH 暴露到局域网」那一步。
* `zipx_connect` 回 `dsh_tools`（本进程真实注册数），「33 个工具」不再靠数提示词；系统提示段里的工具数也改成运行时取值，不再写死（此前写死 23，工具面早已 33）。

## 0.2.4 — 2026-11-13

* 新增 `zipx_events`：按游标增量读创作事件（契约 v5 #14）。此前那个端点**没有任何消费者**——等于白实现。真机回执：`count/has_more/next_cursor` + `events[].event_type/summary/step` 与 render 一致。
* 工具面 32 → 33。

## 0.2.3 — 2026-11-13

* 面板不再把「读不到」说成「没有」：500 / 非 JSON 响应此前都掉进「项目库是空的」，现在分别显示「读取失败（HTTP 500）」与「返回的不是 JSON」，并提示先重试。
* 新增 `scripts/ui-resilience.mjs`：真浏览器 + 路由拦截，把后端打到 0 项目 / 500 / 非 JSON / 超长标题 / 渠道关闭，断言「无 pageerror、文案不说谎」。

## 0.2.2 — 2026-11-13

* `zipx_delivery` 的检查项**原因字段读错了**（读 `detail`，实际是 `note`）⇒ 把「为什么不通过」整段丢了。修好后「台词无人声 / 字幕偏差 127s / 色偏」这类结论才真的到模型眼前。
* `zipx_sign_lock` 回执没有 `lock` 字段 ⇒ 改为从入参取，不再输出「已签收 」空尾巴。
* `zipx_list_episodes` 有人话列表，不再把裸 JSON 丢给模型；读不到子项目时如实说明。

## 0.2.1 — 2026-11-13

* `zipx_confirm_step` 只对**当前步骤**有效：传别的步骤会 409 `step_mismatch`（此前会返回 200「已确认」而指针不动 = 假完成）。
* 面板产物请求只拉真正渲染的两步（`keyframes,compose`）：**2.88MB → 1.30MB**。
* 连接卡提示改指向真实入口（Studio「用 DSH 创作」）；入口卡/任务屏的复制按钮改为复制**整条深链**（码与设备成对，单独抄码连不上）。
* 新增 `scripts/check-market-ready.mjs`（市场就绪 21 条断言）与 `scripts/e2e-write.mjs`（零成本写路径 E2E，自动清理）。
## 0.2.0 — 2026-11-13

* **工具面 23 → 32**：新增 `zipx_connect` / `zipx_list_projects` / `zipx_create_project` /
  `zipx_bind_project` / `zipx_project_overview` / `zipx_artifacts` / `zipx_delivery` /
  `zipx_cost` / `zipx_repair_action`，对应契约 v5 的 14 个端点。
* **会话-项目绑定**：`zipx_bind_project` 之后，读类工具可省略 `project_id`（缺省取本会话绑定，
  同时写 ZipX `external_sessions` 做持久化）。
* **配对 handoff**：新增 `POST /zipx-pair/connect` 与面板自动消费 `?zipx_code=`；
  令牌改成一请求一读，配对后**无需重启 DSH**。
* **面板**：项目库带门禁摘要（`gates=1`），连接卡显示账号/设备/过期。

## 0.1.0 — 2026-11-13

* 首个可安装版本：标准 DSH 组合包（`dsh.bundle` + `engines.dsh`），零依赖构建，23 个工具。
