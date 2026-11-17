# ZipX 导演 · DSH 插件

> **在 DSH 里当导演，ZipX 负责拍。**
> 一句话说清要什么，ZipX 把它拆成项目、剧本、分镜、关键帧、镜头与成片；每一步花多少、能不能过、交付什么，都在对话里看得见。
>
> 源码/发布：<https://github.com/Digiforge6688/zipx-dsh-plugin> · Release v0.3.0 带 tgz 资产

这是一个标准 DSH 组合包（`dsh.bundle`），不是网页的第二个壳。装好后：

- 会话标题栏出现 **项目 Chip**（当前项目/切换），输入区上方出现 **步骤状态条**；
- 每一类 `zipx_*` 调用有 **原生卡片**（状态/预检/批准/进度/产物/交付/四锁/成本）；
- 付费动作走 **DSH 原生批准卡**，不再由模型自证 `confirm: true`；
- 长任务变成 **DSH 后台任务**，完成会通知，不阻塞对话；
- 右侧栏有 **工作台 / 产物 / 交付 / legacy Studio** 四个 Tab；
- 设置页有 **连接 / 账号 / 积分 / 预算 / 诊断**；
- token 存进 **DSH Credentials**，换设备/重启仍连接；项目绑定按会话持久化，**没有全局兜底**。

---

## 1. 5 分钟开始

### 安装（本机路径）

~~~powershell
cd D:\DHS\deepseek-harness
pnpm dsh plugin --profile web add E:\zipx\zipx-pro\integrations\dsh-plugin
pnpm dsh --profile web --dump-config | findstr /c:"zipx" /c:"=="
~~~

应当看到：

~~~yaml
# == @zipx/dsh-plugin
- id: zipx-tools
  name: '@zipx/dsh-plugin'
  config:
    baseUrl: http://localhost:8000
    language: zh
~~~

重启 DSH Web，新会话里应当出现 `zipx_*` 工具与 `zipx-creator` 技能。

不分发 npm 也可以装 tarball：

~~~powershell
cd integrations/dsh-plugin
npm pack                     # zipx-dsh-plugin-0.3.0.tgz
dsh plugin --profile web add .\zipx-dsh-plugin-0.3.0.tgz
~~~

> npm 包名目前仍是 `@zipx/dsh-plugin`（升级兼容）。市场搜索名/标题是 **dsh-zipx / ZipX 导演**；发布别名包的步骤见 `docs/DSH_插件公网发布_操作手册_20261113.md`。

### 连接 ZipX

1. 打开 **设置 → ZipX**；
2. 点「连接 ZipX」，用邮箱/密码登录，或从 ZipX 网页 Studio 点「用 DSH 创作」走配对码；
3. 看到账号、积分、令牌来源即成功。token 不再回显，也不会进浏览器。

ZipX 侧需要打开 DSH 渠道（否则读写端点会 403 `channel_disabled`）：

~~~yaml
# docker-compose.yml → backend.environment
- DIALOGUE_CHANNELS=dsh
- DIALOGUE_DSH_PROJECT_ALLOWLIST=<project_id>,<project_id>
~~~

改完必须重建容器（`docker restart` 不重载 env）：

~~~powershell
docker compose up -d --no-deps backend
docker exec zipx-backend printenv DIALOGUE_CHANNELS
~~~

### 选项目

- 新会话首屏点 **「从 ZipX 项目开始」**，或侧栏 **ZipX 项目**；
- 选一个项目 → 自动绑定到**当前会话**；
- 标题栏 Chip 显示项目与当前步骤；点它可切换/新建。

绑定只属于这个会话：换会话不会继承，重启后第一次调用会从 ZipX `external_sessions` 恢复。

---

## 2. 一次创作长什么样

~~~text
你：把第 6 步「分镜设计」推进一下
  → 状态卡：第 6 步 · 分镜设计 · 门禁未过 · 产出 18/24
  → 预检卡：可以执行 · 预计 10 credits · 下游 关键帧/镜头/声音/合成
  → 批准卡：允许一次 / 拒绝
  → 后台任务：zipx-step-… · 进度在标题栏
  → 完成通知 → 产物卡：24 镜、缩略图、[看工作台]
  → 右侧栏「工作台」：点某镜 → 详情 / 重做这一镜
~~~

要点：

- **卡片只读**。卡片上的「推进 / 重做 / 签收」按钮只把一句用户消息放进输入框，再走工具流水线；不会直接写后端，也不会绕过批准与审计。
- **模型看短的，人看全的**。`output.render` 只给 3–5 行结论；完整结构化数据进 `presentationMeta`，回放/断网也能还原卡片。
- **付费 100% 批准**。`zipx_start / confirm_step / regenerate_step / regenerate_item / resume_step / start_episode / dispatch` 以及会触发付费的 `zipx_chat`，都在 `tools/pre-execute` 返回 `ask`；没有批准通道时**拒绝执行**（可用 `ZIPX_ALLOW_UNCONFIRMED=1` 显式放行，仅限 headless）。
- **预算先行**。设置页可设每步/每日上限；超过上限的付费动作在批准前被拒。
- **长任务不阻塞**。`zipx_watch_step` 默认 `ctx.jobs.start`，立即返回 job id；取消只停止跟踪，**ZipX 后端可能仍在生成**（如实写在文案里）。

---

## 3. 成本（以 `zipx_cost` 为准）

| 步骤 | 大致成本 | 说明 |
|---|---|---|
| 故事 / 分析 / 剧本 / 分镜设计 | 10 credits / 步 | 文本生成 |
| 关键帧 / 镜头视频 | 按实际用量 | `shots_hitl` 的价目表数字是**开拍前余额预检门槛**，不是最终报价 |
| 声音 / 合成 / 后期 | 按实际用量 | 见 `zipx_cost` 的 `estimate_kind` |
| 失败/重试 | 以后端计费为准 | 批准卡会显示「费用未知」而不是编一个 0 |

---

## 4. 该用哪些 DSH 能力（这套体验为什么是原生的）

| 体验 | DSH 包/插槽 |
|---|---|
| 项目 Chip | `conversation.session.header.actions` |
| 输入区状态条 | `conversation.composer.dock` |
| 首屏入口 | `conversation.hero.options` |
| 工具卡片 | `tool.call.toolview`（按工具名 keyed，35 个） |
| 右侧工作台/产物/交付 | `ctx.sidebarRightTabs` + `sidebar.right.pane.tab` + `ctx.sidebarRight.openTab` |
| 设置页 | `settings.section` |
| 原生批准 | `tools/pre-execute` + `ui-approval` |
| 后台任务 | `ctx.jobs.start` + `ui-jobs` |
| 凭据 | `ctx.credentials`（`zipx/account`、`zipx/budget`） |
| 命令/引用 | `ctx.commandUi`、`ctx.inputTriggers` |

客户端半在 `package.json` 里声明了 `dsh.client.inject`（17 个包），保证插槽先声明再注册；宿主侧 credentials/jobs/webserver/approval 都是**可选 peer**，缺失时显式降级。

---

## 5. 命令与引用

- `/zipx`：打开项目库
- `/zipx-status`：打开右侧工作台
- `/zipx-doctor`：打开诊断（后端、令牌、凭据、工具数）
- `@项目`：输入 `@` 选一个 ZipX 项目，插入引用并绑定本会话；模型看到的是 `<zipx_project id="…"/>`
- `/skill zipx-creator`：创作纪律（先看状态、先预检、付费必确认、只陈述回执）

---

## 6. 诊断与回滚

- 设置页「诊断」或 `/zipx-doctor`：后端可达性、HTTP 状态/耗时、令牌来源、凭据是否可用、插件版本与工具数。
- 后端读不到：先确认 `baseUrl` 与 `DIALOGUE_CHANNELS`；`/zipx-api` 只服务本机/同源页面。
- 旧版整页 Studio：在主面板 URL 加 `?zipx_shell=legacy`（或在宿主设 `window.__ZIPX_DSH_SHELL__='legacy'`），恢复「项目库 + 内嵌 Studio」；右侧栏也保留 `Studio (legacy)` Tab。
- 退出登录：设置页「退出登录」会清内存、旧文件与 DSH Credentials 记录。

---

## 7. 已知边界

- 视频签名 URL 由 Host `/zipx-media` 代理并保留 Range；**只转发 ZipX 后端的文件路径**，不是开放代理。
- 项目绑定按会话；**没有全局 fallback**。主面板在没有任何会话时选项目，会把选择交给下一次会话 Chip 挂载时绑定。
- 取消后台任务只停止跟踪；ZipX 目前没有公开的 cancel 端点。
- `?zipx_shell=legacy` 是回滚通道，不是主路径；日常创作以对话 + 卡片 + 右侧栏为准。

---

## 8. 开发与校验

~~~powershell
cd integrations/dsh-plugin
npm run build
npm run check          # 工具面/技能/网络/账户/宿主接线/面板/locale
npm run verify:bundle  # 无浏览器跑一遍工厂 bundle
npm run audit:plan     # P0–P3 逐项审计
~~~

- 客户端源码在 `src/client/*.js`，按文件名顺序拼成 `lib/client.js`；不要再写单文件大 bundle。
- 宿主源码 `src/index.ts` + `src/presentation.ts`，零依赖构建（Node 自带类型擦除）。
- 全量中英词条在 `src/client/10-locale-zh.js` / `11-locale-en.js`，`locale/*.json` 由 `sync-locale` 生成，不要手改。

许可证：MIT。
