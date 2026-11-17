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
