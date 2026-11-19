# DSH导演（dsh-director）· DSH 影视创作插件

> **在 DSH 里当导演，ZipX 负责拍。**
> 精品影视、多集短剧、创意视频、带货商品视频 —— 一句话 / 小说 / 剧本进，剧本、分镜、关键帧、配音、成片出；每一步花多少、能不能过、交付什么，都在对话里看得见。
>
> 源码/发布：<https://github.com/Digiforge6688/zipx-dsh-plugin> · 插件市场索引：<https://cdn.jsdelivr.net/gh/Digiforge6688/zipx-dsh-plugin@main/market/index.json>

这是一个标准 DSH 组合包（`dsh.bundle`），不是网页的第二个壳。装好后：

- 会话标题栏出现 **项目 Chip**（当前项目/切换），输入区上方出现 **步骤状态条**；
- 每一类 `zipx_*` 调用有 **原生卡片**（状态/预检/批准/进度/产物/交付/四锁/成本）；
- 付费动作走 **DSH 原生批准卡**，不再由模型自证 `confirm: true`；
- 长任务变成 **DSH 后台任务**，完成会通知，不阻塞对话；
- 右侧栏有 **工作台 / 产物 / 交付 / legacy Studio** 四个 Tab；
- 设置页有 **连接 / 账号 / 积分 / 预算 / 诊断**；
- token 存进 **DSH Credentials**，换设备/重启仍连接；项目绑定按会话持久化，**没有全局兜底**。

## 交付什么

| 创作类型 | 你给它 | 它交付 |
|---|---|---|
| **精品影视** | 一句创意、故事大纲或参考片方向 | 有电影感的短片/品牌片：剧本、分镜、关键帧、镜头、声音、母版与交付检查单 |
| **多集短剧** | 小说原文 / 剧本 / 分集与时长要求 | 按集推进的竖屏短剧：章节、分集、人物、场景契约、逐集成片，可继续下一集 |
| **创意视频** | 一句话、概念或情绪板 | 15–90 秒创意短片：钩子、分镜、关键帧、配音、剪辑与字幕 |
| **带货视频** | 商品卖点、品牌/产品、产品图、CTA | 商品/品牌视频：营销简报、卖点结构、产品一致性、镜头与成片，可导出发布包 |
| **小说 / 剧本改编** | 原文 | 按章/按场拆解，直接进入分镜与生成，不重复写一遍故事 |

---

## 0. 注册 ZipX

插件需要 ZipX 账号。没有账号先注册：

- **国际站**：<https://www.zipx.ai>
- **中国站**：<https://www.zipx.vip>

注册后回到 DSH，在 **设置 → ZipX** 里用这个账号登录。

## 1. 5 分钟开始

### 前置条件

- DSH 0.2.x（`engines.dsh` 为 `>=0.2.0 <0.3.0`）。
- 一个可访问的 **ZipX 后端**（默认 `http://localhost:8000`）和 **ZipX 账号**（[国际站](https://www.zipx.ai) / [中国站](https://www.zipx.vip)）。
- 插件是 ZipX 的 DSH 前端，不自带模型或后端。没有 ZipX 后端时**安装能成功**，也能看到连接与诊断，但创建/推进项目不可用。

### 从 DSH 插件市场安装（推荐，1.0.1）

DSH 的市场是一个 format 1 索引；本项目自带索引，安装源是 npm 上已发布的 **`dsh-director@1.0.1`**：

1. 打开 **插件 → 发现（Discover）→ 添加索引源**；
2. 填入：`https://cdn.jsdelivr.net/gh/Digiforge6688/zipx-dsh-plugin@main/market/index.json`
   （备用：`https://raw.githubusercontent.com/Digiforge6688/zipx-dsh-plugin/main/market/index.json`）；
3. 搜索 **DSH导演 / dsh导演 / dsh director / 短剧 / 带货视频 / 分镜**，在卡片上点安装。

> 索引里的版本与 npm 上的 `dsh-director` 同版本；升级时索引会先更新。

### 从 npm 安装（已发布 1.0.1）

~~~powershell
dsh plugin --profile web add dsh-director@1.0.1
~~~

> npm 上还有一个 `0.0.0-stage` 占位版本，已 deprecate，不要安装它。

### 从 GitHub tag 安装（1.0.1，无需 npm）

~~~powershell
dsh plugin --profile web add github:Digiforge6688/zipx-dsh-plugin#v1.0.1
~~~

> 普通安装的 DSH 直接用 `dsh`。如果你是在 DSH 源码 checkout 里运行（没有全局 `dsh`），把 `dsh` 换成 `pnpm dsh`，并在 checkout 根目录执行。

旧包 `@zipx/dsh-plugin` 停在 **0.3.0**，只作历史兼容，不再更新；旧装法仍可运行，但不要指望它带 1.0 的名称、面板与工具。

### 从本地 tgz / 源码安装（开发者）

~~~powershell
cd <ZipX 仓库>\integrations\dsh-plugin
npm pack
dsh plugin --profile web add .\dsh-director-1.0.1.tgz
~~~

从源码目录安装（pnpm 会跑 prepare 构建）：

~~~powershell
cd <DSH checkout>
pnpm dsh plugin --profile web add <ZipX 仓库>\integrations\dsh-plugin
~~~

验证安装：

~~~powershell
dsh plugin --profile web list
~~~

市场/GitHub tag 安装后应当看到 `dsh-director@1.0.1`。

> 为什么改名：`@zipx/dsh-plugin` 是组织 scope，普通用户在 npm 和插件市场里不容易一眼认出；`dsh-director` 与显示名 **DSH导演 / DSH Director** 同义，搜索 `dsh director` 直接命中。显示名仍由 `locale/*.json` 的 `meta.title` 决定，包名只负责安装与识别。别名包 `dsh-zipx` 升到 1.0.1，依赖 `dsh-director@1.0.1`，装任意一个即可。

### 连接 ZipX

1. 打开 **设置 → ZipX**；没有账号先到 [国际站](https://www.zipx.ai) 或 [中国站](https://www.zipx.vip) 注册；
2. 点「连接 ZipX」，用邮箱/密码登录，或从 ZipX 网页 Studio 点「用 DSH 创作」走配对码；
3. 看到账号、积分、令牌来源即成功。token 不再回显，也不会进浏览器。

> ZipX 不在本机时，先在设置里把 `baseUrl` 改成你的实例地址（例如 `https://zipx.example.com`），再登录。

自部署 ZipX 时，ZipX 侧需要打开 DSH 渠道（否则读写端点会 403 `channel_disabled`）：

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

- 新会话首屏点 **「从 DSH导演开始」**，或侧栏 **DSH导演**；
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
- **长任务不阻塞**。`zipx_watch_step` 默认 `ctx.jobs.start`，立即返回 job id；要停就调 `zipx_abort`，它会请求 ZipX 后端中止当前步骤并释放执行锁。**已经发出的付费调用可能仍会完成**，后续步骤不再继续（如实写在文案里）。

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
| 工具卡片 | `tool.call.toolview`（按工具名 keyed，43 个） |
| 右侧工作台/产物/交付 | `ctx.sidebarRightTabs` + `sidebar.right.pane.tab` + `ctx.sidebarRight.openTab` |
| 设置页 | `settings.section` |
| 原生批准 | `tools/pre-execute` + `ui-approval` |
| 后台任务 | `ctx.jobs.start` + `ui-jobs` |
| 凭据 | `ctx.credentials`（`zipx/account`、`zipx/budget`） |
| 命令/引用 | `ctx.commandUi`、`ctx.inputTriggers` |

客户端半在 `package.json` 里声明了 `dsh.client.inject`（17 个包），保证插槽先声明再注册；宿主侧 credentials/jobs/webserver/approval 都是**可选 peer**，缺失时显式降级。

---

## 5. 命令与引用

- `/zipx`：打开 DSH导演项目库
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
- 取消：`zipx_abort` 会请求 ZipX 后端中止当前步骤并释放执行锁；**已经发出的付费调用可能仍会完成**，后续步骤不再继续，DSH 侧的后台任务也会停止跟踪。
- `?zipx_shell=legacy` 是回滚通道，不是主路径；日常创作以对话 + 卡片 + 右侧栏为准。

---

## 8. 开发与校验

~~~powershell
cd <你的 ZipX 仓库>\integrations\dsh-plugin
npm run build
npm run check          # 工具面/技能/网络/账户/宿主接线/面板/locale
npm run verify:bundle  # 无浏览器跑一遍工厂 bundle
npm run audit:plan     # P0–P3 逐项审计
~~~

> 不要在 `D:\DHS\deepseek-harness` 里找 `integrations/dsh-plugin`：那是 DSH 源码 checkout；插件源码在 ZipX 仓库的 `integrations/dsh-plugin`。

- 客户端源码在 `src/client/*.js`，按文件名顺序拼成 `lib/client.js`；不要再写单文件大 bundle。
- 宿主源码 `src/index.ts` + `src/presentation.ts`，零依赖构建（Node 自带类型擦除）。
- 全量中英词条在 `src/client/10-locale-zh.js` / `11-locale-en.js`，`locale/*.json` 由 `sync-locale` 生成，不要手改。

许可证：MIT。

