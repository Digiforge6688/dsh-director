# DSH导演 · 发布到 DSH 插件市场

> 对外注册：国际站 <https://www.zipx.ai> · 中国站 <https://www.zipx.vip>

DSH 没有中心市场：一个市场就是一份 **format 1 JSON 索引**。本项目自带索引，放在
`market/index.json`，并把安装源固定到精确 commit，所以不依赖 npm 发布也能装。

## 一、索引地址

- 主地址（国内快）：`https://cdn.jsdelivr.net/gh/Digiforge6688/zipx-dsh-plugin@main/market/index.json`
- 备用：`https://raw.githubusercontent.com/Digiforge6688/zipx-dsh-plugin/main/market/index.json`

在 DSH 里打开 **插件 → 发现（Discover）→ 添加索引源**，粘贴上面任意一条。搜索
**DSH导演 / dsh导演 / 短剧 / 带货视频 / 分镜** 即可安装。

## 二、生成与校验

索引不是手写的；它从 `package.json` + `locale/<lang>.json` 的 `meta` 生成：

```powershell
cd integrations/dsh-plugin
npm run build
npm run market:check          # 名称/介绍/关键词/图标/engines 等断言
npm run market:index -- --source npm --base-url https://cdn.jsdelivr.net/gh/Digiforge6688/zipx-dsh-plugin@main/market
```

`--source npm` 用于 npm 已发布同版本的情况（当前 1.0.0 已发布）；`--source git` 需要完整 40 位 commit，仅作备用。
生成器会顺手把 `icon.svg` 复制到 `market/icon.svg`，相对索引地址解析。

## 三、发布顺序

1. 改 `package.json` 版本与 `locale/*.json` 的 `meta.title/description`；
2. `npm run check`、`npm run market:check` 全绿；
3. 先发布 npm（tag 触发 `publish-npm.yml`，或本地 `npm publish`）；
4. 用 `--source npm` 生成索引，再提交 `market/index.json`；
5. push 到 GitHub `main`，索引地址即生效。

## 四、npm / 别名

`dsh-director` 是包名（1.0.0 起从 `@zipx/dsh-plugin` 迁移；旧包停在 0.3.0，不再更新）；显示名统一为
**DSH导演 / DSH Director**。别名包 `alias/dsh-zipx` 与主包同版本发布。
npm 发布由 `.github/workflows/publish-npm.yml` 在 `v*` tag 上执行；仓库 secret `NPM_TOKEN`
已于 2026-11-19 配置。首个版本会先出现 `0.0.0-stage` 占位，几秒后真实版本上线；占位版已 deprecate。

## 五、市场条目守则

- 标题：`DSH导演`（zh）/ `DSH Director`（en），与 locale meta 完全一致；
- 介绍必须覆盖交付结果：**精品影视、多集短剧、创意视频、带货视频**；
- 关键词必须含 `dsh导演`、`dsh-director` 与四类交付词，保证搜索命中；
- 版本必须与 `package.json` 一致，安装源必须是精确 commit 或已发布 npm 版本。
