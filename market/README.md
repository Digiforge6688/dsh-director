# 发布到 DSH 插件市场（P4）

市场条目**不是手写的**，是 `apps/plugin-market-generator` 从已发布的包**生成**的。
生成器会拒掉：`private: true`、`engines.dsh` 为空或写 `workspace:`、拿不到图标、没有 `dsh.bundle` 的包。
那些理由在构建、单测、装包里都不会红——所以在本地先跑一道门禁：

```powershell
node scripts/check-market-ready.mjs   # 21 条断言，全过才谈发布
```

## 一、本地分发（现在就能用，不需要发布）

```powershell
pnpm --dir integrations/dsh-plugin pack          # zipx-dsh-plugin-0.2.0.tgz
pnpm dsh plugin --profile web add ./zipx-dsh-plugin-0.2.0.tgz
```

tarball 里已经带了 `lib/`、`cordis.patch.yml`、`locale/`、`skills/`、`docs/`、`screenshots/`、`icon.svg`、`CHANGELOG.md`——
**装包即运行，不需要构建授权**（对比 git 源安装会要求用户允许 `prepare` 脚本执行）。

## 二、发布到 npm

```powershell
cd integrations/dsh-plugin
node scripts/build.mjs
node scripts/check-market-ready.mjs
npm publish --access public        # 或 pnpm publish
```

发布后，在生成器的输入列表里写一行包名：

```text
@zipx/dsh-plugin
```

```powershell
cd D:\DHS\deepseek-harness
pnpm --filter @deepseek-ai/dsh-plugin-market-generator exec dsh-plugin-market-index `
  --input packages.txt --output dist/index.json --title 'ZipX 影视创作' --description '在 DSH 里做影视创作'
```

`--inline-icon-bytes` 控制多大的图标内联成 data URL（默认 16 KiB，上限 32 KiB）；更大的图标会被写到 `icons/` 旁边并引用。

托管 `dist/index.json` 到 HTTPS，然后：

```powershell
# $DSH_HOME/cordis.patch.yml
- id: plugin-market
  config:
    indexes:
      - https://<你的域名>/dsh/index.json
```

## 三、从 Git 源发布（不想发 npm 时）

```text
github:zipx/zipx-pro#v0.2.0
```

但要注意：git 源拉的是**源码**，没有任何环节跑 `build`，所以包必须自带 `prepare` 脚本（本包有：`node scripts/build.mjs`），
且用户需要在 profile 的 `pnpm-workspace.yaml` 里显式授权该包的构建脚本执行。**优先发 tarball 或 npm**。

## 四、市场条目会用到的东西（都已就位）

| 字段 | 来源 |
|---|---|
| 标题 / 描述 | `locale/zh.json`、`locale/en.json` 的 `meta.title` / `meta.description` |
| 图标 | `icon.svg`（`--inline-icon-bytes` 以内直接内联） |
| 版本与兼容 | `package.json` 的 `version` 与 `engines.dsh` |
| 详情页 | `README.md` + `docs/DETAIL.zh.md` |
| 截图 | `screenshots/*.png`（面板真机截图） |
| 搜索 | `keywords` 里的 `zipx` / `film` / `storyboard` / `director` / `video` |

## 五、验收（发布后）

1. 市场里搜 `zipx` 命中，卡片有图标与中英标题；
2. 详情页有截图与工具清单；
3. 点安装 → `dsh plugin --profile <name> add @zipx/dsh-plugin` → `--dump-config` 出现 `# == @zipx/dsh-plugin`；
4. 新会话里 34 个 `zipx_*` 工具可见，侧栏出现「ZipX 创作」。
