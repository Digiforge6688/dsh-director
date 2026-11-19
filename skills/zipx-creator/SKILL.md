---
name: zipx-creator
description: 用 ZipX 的 zipx_* 工具做影视创作时的纪律：先看状态、先预检、付费必确认、只陈述回执、不编进度。读或写 ZipX 项目（推进步骤、重做、单镜精修、签锁、看交付）之前先读本技能。
---

# ZipX 创作纪律

ZipX 是**执行与质量引擎**，DSH 只负责跟用户对话。你在 DSH 里能做的一切 ZipX 动作，都通过 `zipx_*` 工具完成。

## 四条硬纪律

1. **先看再答。** 任何「这个项目到哪一步了 / 能不能做」的问题，先 `zipx_project_state`（必要时 `zipx_progress`），不要凭记忆或对话上下文猜。
2. **先预检再写。** 任何创作动作先 `zipx_preview_action`。`allowed=false` 时按 `reason_human` 解释或改参数；`allowed=null` 是**判不了**，不是不允许——如实说「没法预判」，不要当成拒绝。
3. **付费必须用户点头。** `zipx_confirm_step` / `zipx_regenerate_step` / `zipx_regenerate_item` / `zipx_resume_step` / `zipx_start` / `zipx_start_episode` 都会真的花钱。先在对话里说清「要做什么、大概多少钱、能不能只改一项更便宜」，用户同意后再调。能用 `zipx_regenerate_item` 定点改一项，就不要整步重做。
4. **只陈述回执。** 派发成功只说「已派发」；完成与否用 `zipx_watch_step`（或 `zipx_progress` / `zipx_timeline`）确认。不要写「已完成」「已生成好了」除非读到终态。用户说「停下/别做了/取消」时调用 `zipx_abort`；已经发出的付费调用可能仍完成，但后续步骤不会继续。

## 生成完必须把结果放回对话（2026-11-17 真机）

- 一次生成结束（`zipx_watch_step` 到终态，或 `zipx_project_state` 显示 `is_complete`）后，**必须调 `zipx_step_result`**：它给正文节选、章/场/镜计数、可播媒体和门禁，DSH 会话里会渲染成一张结果卡（图片/视频可看可播）。
- 只说「已完成」「1/1」不算交付。模板：一句结论（第几步、产出了什么、门禁过没过）+ 正文节选（若短）+ 媒体数量；需要全文再 `zipx_read_asset`，需要全部媒体清单再 `zipx_artifacts`。
- 后台任务的完成通知只带一段紧凑回执；**不要只转述它**，也不要凭它猜产物内容——预览以 `zipx_step_result` 的返回为准。
- 读不到产物（`has_content=false`）就如实说「这一步还没有产物」，不要拿 ProjectState 的计数冒充内容。

## 建项目：创意母本必须进 initial_content（2026-11-17 真机）

- `zipx_create_project` 的 **`initial_content` 必填**：故事步骤只读 `project.input_prompt`，**不读 title/genre/蓝图**。只给 title+genre，作家会按「请创作一个有趣的故事」的占位提示生成一个完全跑题的故事。
- 把用户的故事想法、原文摘录、世界观、硬性要求**逐字**放进 `initial_content`；`story_characters` / `story_worldbuilding` 放人物与禁忌。不要把长篇原文塞进聊天再转述。
- **`episodes` 与 `duration_s` 必须传**：插件把它们映射到 `story_requirements.chapter_count` 与 `target_runtime_s`。只写进 `zipx_update_blueprint` 的 `episodes/chapters` 不会让故事按章生成（真机：蓝图 12 集，故事 0 章、6826 字一篇）。
- 建完再写蓝图（视觉风格/角色/禁忌），然后 `zipx_start`。顺序反了不会自动补上创意母本。
- 如果项目**还没开工**（current_step=init、没有任何产物）但母本写错了：用 `zipx_update_project_input` 改正，**不要新建同名项目**。已开工只能走 `zipx_dispatch(modify)` / `zipx_regenerate_step`。
- **只改剧名/简介/人物表**用 `zipx_update_story_outline`：它只改大纲字段、不重写正文，门禁会标成旧判决；不要为补一个剧名整步重写故事。改完要刷新判决用 `zipx_run_gate`（只判不生成，判官有 provider 成本、不扣用户积分）。
- `director_archetype` 是可选的；不要一律用默认张艺谋。科幻/惊悚/冷峻写实优先 `nolan` / `fincher`，家庭/情感优先 `li_an`，民俗/色彩优先 `zhang_yimou`。不传就由后端默认。

## DSH 里的付费确认（2026-11-17 真机）

- 付费动作由 DSH 的 `tools/pre-execute` 拦一道：
  - 审批策略是「询问」→ **DSH 批准卡**；
  - 审批策略是「从不询问」（DSH 的 full access 预设就是它）→ 插件降级为**一次性确认卡**（同一个用户问题，带「允许本次 / 拒绝」）。
  两种都是人点，模型不能自证；`zipx_connect` 会报 `付费确认` 当前走哪条。
- **把付费动作单独放在一次 `run_code` 里，并传 `timeoutMs: 600000`**。默认 120 秒的 `run_code` 预算**包含等待批准/确认的时间**；用户多看几秒，整个程序就会被判超时。
- **不要在同一段 `run_code` 里既 `ask_user_question` 又发起付费动作**：问题本身也会吃掉那 120 秒。问用户单独一次 `run_code`，同样传 `timeoutMs: 600000`。
- 被拒绝或超时后只说事实（「未执行、没有扣费」），不要连续重试同一动作；先 `zipx_connect` 看确认通道，或让用户把会话权限切到「询问」。

## 常见误用（都被真机事故验证过）

| 误用 | 后果 | 正确做法 |
|---|---|---|
| 一句话里塞多个镜头修改 | 单轮十几分钟，用户以为卡死 | 一次一个动作；多镜拆成多轮，每轮先 preview |
| 直接 `zipx_confirm_step` 不看门禁 | 被拦后报「已确认」但状态没动 | 先 `zipx_advance_preflight` 拿原因 |
| 用 `zipx_regenerate_step` 改一个镜头 | 白花钱重做整步 | `zipx_regenerate_item`（item_index 取自 refine targets，不要自己推算） |
| 把 `zipx_review_project` 的分数当成「这次改动有没有更好」 | 分数属于交付的那一轮 | 分数只在同一步同一轮内可比，跨轮看 `zipx_timeline` |
| `unchecked` 门禁说成通过 | 用户以为质量已保证 | `unchecked` = 没检查，不是绿灯 |
| 用 `zipx_chat` 触发「改一下这步 / 换个风格 / 批量改 / 重跑」 | 要过意图分类，分类错了就变成改了别的东西 | 用 `zipx_dispatch`（`modify` / `style_adjust` / `batch_modify` / `restart`），动作和参数原样交出 |

## 该说什么、不该说什么

* 说人话：`zipx_create_step` 的失败原因用 `reason_human` 原话；不要漏出 `rejected_no_improvement` 这类内部码。
* 不确定就说「不确定」。读不到余额、读不到预估，就说读不到，不要填 0。
* 用户问「为什么是这个结果」，用 `zipx_timeline` 找因果，不要编故事。

## 不要做的事

* 不要用 shell/文件工具去绕过 ZipX 改产物——产物只能经 `zipx_*` 写。
* 不要替用户编造题材/集数/风格；这些是 `zipx_update_blueprint` 的输入（genre 必填）。
* 不要把 `zipx_chat` 当默认通道：它是旧对话系统的 fallback。改当前这步/调风格/批量改/重跑走 `zipx_dispatch`；只有真的需要它听懂一句人话时才用 `zipx_chat`。
