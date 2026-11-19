# DSH导演（dsh-director）· 详情与设计说明

> 面向：想评估/二次开发这个插件的人。安装与快速上手看 [README](../README.md)。
>
> 注册 ZipX：国际站 <https://www.zipx.ai> · 中国站 <https://www.zipx.vip>。
>
> **1.0.2（2026-11-19）**：仓库更名为 **`dsh-director`**，README/索引/包元数据里的地址统一到新仓库
> （旧 GitHub 链接 301 重定向）。**1.0.1（2026-11-19）**：包名迁移为 **`dsh-director`**（旧包 `@zipx/dsh-plugin` 停在 0.3.0）；
> 统一显示名为 **DSH导演 / DSH Director**；43 个工具全部带
> `presentationMeta`，43 张 keyed 原生卡；付费走 `tools/pre-execute` 原生批准；长任务走
> `ctx.jobs.start`；右侧栏工作台/产物/知识/复盘/交付；token 进 DSH Credentials；
> 项目库、分集、团队、产品图、导出包与知识库都在 DSH 内可用。

## 0. 它交付什么

| 创作类型 | 输入 | 交付 |
|---|---|---|
| 精品影视 | 一句创意 / 大纲 / 参考片方向 | 电影感短片或品牌片：剧本、分镜、关键帧、镜头、声音、母版、交付检查单 |
| 多集短剧 | 小说 / 剧本 / 分集与时长 | 按集推进的竖屏短剧：章节、分集、人物、场景契约、逐集成片 |
| 创意视频 | 一句话 / 概念 | 15–90 秒创意短片：钩子、分镜、关键帧、配音、剪辑、字幕 |
| 带货视频 | 卖点 / 品牌产品 / 产品图 / CTA | 商品或品牌视频：营销简报、卖点结构、产品一致性、成片与发布包 |
| 小说 / 剧本改编 | 原文 | 按章/按场拆解后直接进入分镜与生成 |

插件本身不生成内容：它把 DSH 的对话、审批、任务与卡片接到 ZipX 的工作流、门禁、计费与产物上。

## 1. 它在架构里的位置

```
用户 ⇄ DSH 会话（会说）           ← 意图、澄清、计划、确认、回执呈现
        │ zipx_* 工具（结构化直呼，绕开旧对话系统）
        ▼
ZipX FastAPI（会做）              ← 工作流执行、门禁、打磨、计费、幂等
        │
        ▼
ZipX 产物（剧本/分镜/关键帧/成片）
```

插件只做三件事：**URL/凭证/错误语义的封装**、**把结构化事实翻成模型可读的人话（`output.render`）**、
**长任务的状态判定（不假完成）**。它不实现任何创作能力，也不缓存业务状态。

## 2. 工具 → 端点对照

| 工具 | 端点 | 读写 | 付费 |
|---|---|---|---|
| `zipx_project_state` | GET /state/{pid} | 读 | |
| `zipx_preview_action` | POST /preview | 读 | |
| `zipx_advance_preflight` | GET /advance-status/{pid} | 读 | |
| `zipx_read_asset` | GET /asset/{pid}?step= | 读 | |
| `zipx_timeline` | GET /timeline | 读 | |
| `zipx_progress` | GET /progress/{pid} | 读 | |
| `zipx_review_project` | GET /api/v3/creative-os/overview/{pid} | 读 | |
| `zipx_get_locks` | GET /locks | 读 | |
| `zipx_get_blueprint` | GET /blueprint/{pid}/intake | 读 | |
| `zipx_list_episodes` | GET /episodes | 读 | |
| `zipx_turn_receipt` | GET /turn/{pid}/{tid} | 读 | |
| `zipx_confirm_step` | POST …/steps/{s}/confirm | 写 | ✔ |
| `zipx_regenerate_step` | POST …/steps/{s}/regenerate | 写 | ✔ |
| `zipx_regenerate_item` | POST …/refine/item | 写 | ✔ |
| `zipx_resume_step` | POST …/steps/{s}/resume | 写 | ✔ |
| `zipx_start` | POST /project/{pid}/start | 写 | ✔ |
| `zipx_start_episode` | POST …/episodes/{e}/start | 写 | ✔ |
| `zipx_rollback_step` | POST …/steps/{s}/rollback | 写 | |
| `zipx_update_blueprint` | PUT /blueprint/{pid}/intake | 写 | |
| `zipx_sign_lock` | POST /locks/{lock}/sign | 写 | |
| `zipx_abort` | POST /project/{id}/abort | 写 | |
| `zipx_watch_step` | 轮询 /state（后台任务） | 读 | |
| `zipx_watch_turn` | 轮询 /turn | 读 | |
| `zipx_chat` | POST /chat | 写 | ✔ |

`zipx_chat` 是**旧对话系统**的 fallback：它会把一句话交给 ZipX 的意图分类 → Guard → 派发链。
新路径（其余 42 个工具）直接打后端步骤端点，**不经过** `DirectorAgent.chat()`。P3 起 `zipx_chat` 下线。

## 2.5 `capabilities.endpoints` 只是 **v5 增量**清单（别当成全量 API）

它列的是契约 v5 新增的 16 条（capabilities / projects / overview / artifacts / media / delivery / cost / skip /
locks / repair / bind / handoff / events）。插件同时还用着一批 **v4 既有端点**（state / preview / advance-status /
asset / blueprint / chat / progress / turn / episodes / start / refine/item / confirm / regenerate / resume / rollback /
workflow-steps）以及 `creative-os/{overview,timeline}`。

所以「读 capabilities 就知道全部可调用面」不成立——要知道一个工具打哪个端点，看工具描述或 `src/index.ts`。
## 3. 为什么这些工具要自己写 `render`

DSH 里模型只读工具结果的 `output.render` 文本，读不到 canonical JSON。所以每个工具都必须把
**结论**（能不能做、为什么不能、现在到哪一步、几分属于哪一轮、有没有真的派发）写进 render，
而不是把 JSON 丢给模型自己猜。这也是「假完成/假失败 = 0」的实现前提。

## 4. 身份与凭证

```
config.token  →  ZIPX_DIALOGUE_TOKEN  →  ZIPX_TOKEN_FILE  →  ~/.zipx/dialogue-token.json
```

token 是**每用户委托 token**（`channel=dsh` + `device_id`，30 天）。它只在 Host 进程里存在，
浏览器侧永远拿不到：客户端面板要走 `/zipx-api` 同源代理（P1 落地）。

安全边界：
* 撤销设备后**读路径不 500、写路径 403**（与 ZipX 侧语义一致）。
* 渠道关闭时后端返回 `403 {code:"channel_disabled"}`，与「项目不存在」的 404 区分开（契约 v5 加固项）。

## 5. 分发与市场（P4 用）

已具备市场生成器要求的字段：`dsh.bundle`、`engines.dsh`、`icon`、`keywords`、
`locale/{zh,en}.json` 的 `meta.title/description`、非 private。缺的是：
1. `meta.detail` 指向本文件（详情 Markdown）；
2. `screenshots/`（面板截图，随 P1 产出）；
3. 一个可被生成器读取的发布源（npm 或 Git tag）——本地阶段用 `pnpm pack` 的 tarball。

## 6. 为什么没有专属 preset（实测结论，不是没做）

方案 §4.3 想要一个 `zipx-director` preset：新会话选它，就只挂 ZipX 工具 + 导演 persona，不挂 fs/bash。
实测**第三方包做不成**，原因在解析规则：

* patch 里的行**相对声明它的那个包**解析。`standard`/`cordis` 这些内置 preset 的行来自 `@deepseek-ai/dsh-web-app` 的 patch，
  而 `dsh-agent-preset` 是 web-app 自己的依赖，所以在那里能解析到。
* 本包在自己的 `cordis.patch.yml` 里声明同一行时，要从**本包位置**解析 `@deepseek-ai/dsh-agent-preset`。实测：

```
OK   @deepseek-ai/dsh-tools
OK   @deepseek-ai/dsh-persona
OK   @deepseek-ai/dsh-tool-goal
MISS @deepseek-ai/dsh-agent-preset      ← profile 的 node_modules 里根本没有它
```

  把它加成 peerDependency 也不会被装上（link 安装的 peer 只从 profile 现有依赖里找，缺席就是缺席）。
* 换成绝对路径可以跑，但那就不是可分发的包了。

**所以本期的等价物是两条**：
1. `zipx-tools` 行**全局注册** 43 个工具——任何会话都能看到（比“选对 preset”更不容易漏）；
2. `systemPrompt` 段落 `zipx:creator-bridge` 承载「这套工具是什么 + 四条纪律」，不依赖任何额外包。

要做真正的专属 preset，正确路径是**由已经依赖 `dsh-agent-preset` 的宿主 bundle 来声明这一行**（例如企业自己的组合包），
插件这边只提供工具与 persona 文案——不是本包能单方面解决的。
## 7. 构建约束（为什么是零依赖）

DSH 的 `packages/client/tsdown.client.ts` 不对外发布，本机也没有可用的 esbuild，所以：

* Host 半侧：`src/**/*.ts` → Node 自带 `module.stripTypeScriptTypes` → `lib/**/*.js`。
  约束：只能写**可擦除语法**（无 `enum`/`namespace`/参数属性），相对导入必须带 `.js`。
* 客户端半侧（P1）：手写成 DSH 的工厂格式 `window.__ModuleLoader__.load({id, factory})`，
  UI 用 `React.createElement`，平台模块走 `require(...)`。

好处：`pnpm pack` 出来的 tarball 直接可运行，不需要任何构建授权（对比 git 源安装要跑 `prepare`）。
