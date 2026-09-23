# 会话收藏夹（Session Favorites）

DeepSeek Harness（DSH）Web 插件：收藏会话、按工作区分组浏览、`@` 引入收藏会话、多设备一致（主机持久化）。

- **不改 DSH 源码**：独立 npm 包，走公开扩展点 + 运行时 seam。
- **远程安装**：`dsh plugin --profile web add dsh-session-favorites`。
- **零插件依赖**：归档会话导航适配等功能均由本插件自带，不要求安装其它插件。
- **参考实现**：[`@michengai/dsh-archive-manager`](https://github.com/MichengAI/dsh-archive-manager)（仅借鉴其运行时 Typert 远程注册与 `cordis.patch.yml` 增量 insert 的做法，无运行时依赖）。

## 功能

1. 侧边栏底部、设置按钮上方显示「收藏夹」入口。
2. 点击入口弹出冒泡层，**仅关闭按钮可关闭**。
3. 弹出层按**工作区分组**展示收藏会话，顶部搜索，点击打开会话；行尾悬停出现**重命名 / 移除**操作。
   正在查看的会话会**高亮为选中态**（与侧边栏同源判定）。
4. 会话头部提供「收藏/取消收藏当前会话」星标（一期）。
5. 输入框 `@` 搜索并引入已收藏会话。

对话框（重命名 / 移除确认）在结构与样式上逐项对齐 DSH 原生 `Modal` 与 `Button` 原语：胶囊按钮、24px 圆角卡片、模糊遮罩、Esc / 点遮罩关闭。重命名走 DSH 官方 `session.rename`，与原生侧边栏同一条路径。**移除收藏一律二次确认**（单条与批量清理都走同一个确认框），避免误删。

收藏行会显示状态徽标：**已归档**（仍可点击打开）、**已失效**（会话已删除，不可点击，可一键清理）。归档会话原本会被 DSH 的 `clearArchivedCurrent()` 立刻踢出当前视图，表现为"点了打不开"；插件**自带**受限适配（只放行本次显式点击的归档会话），补丁确实装不上时如实报错，不会静默失败。**该适配不依赖任何其它插件** —— 无需安装 `@michengai/dsh-archive-manager` 也能打开归档收藏。

## 安装

```powershell
dsh plugin --profile web add dsh-session-favorites@latest --registry=https://registry.npmjs.org/
```

重启 DSH Web 并硬刷新浏览器。

本地源码安装（开发自测）：

```powershell
Set-Location D:\projects\dsh-session-favorites
dsh plugin --profile web add .
```

## 开发

```sh
pnpm test           # 纯逻辑单测（无需 DSH 依赖）
node scripts/smoke.mjs   # 冒烟自检：包名一致性 + 客户端装载 + 关键交互路径
```

`scripts/smoke.mjs` 强制校验 `src/package-identity.js`、`package.json` 的 `name`、`cordis.patch.yml`
的 `name` 与 client bundle 的 `id` 四处一致 —— 改包名时只要漏改一处就会在这里失败。

## 发布

DSH 没有插件市场或注册表：`dsh plugin --profile web add <pkg>` 是一个 pnpm 转发器，
"发布"就是普通的 `npm publish`（或分发 `pnpm pack` 的 tarball / git spec）。
本仓库的发现入口是 GitHub 的 `dsh-plugin` topic。

```sh
npm login                                   # 仅首次，需要 npm 账号
node --test test/*.test.mjs && node scripts/smoke.mjs   # 全绿再发
npm publish --access public
```

发布后验证：

```sh
npm view dsh-session-favorites version
dsh plugin --profile web add dsh-session-favorites@0.1.0
```

发布前确认：

1. `package.json` 的 `name` 为全小写（npm 拒绝大写），且与 `src/package-identity.js` 一致。
2. `dsh.bundle.patch` 指向随包发布的 `cordis.patch.yml`（缺失该声明只会装成普通依赖，不激活任何层）。
3. `dsh.client.platform` 为 `"web"` 且 `exports["./client"]` 存在（否则 DSH 加载时报
   `declares dsh.client but exports no "./client" bundle`）。
4. `files` 覆盖 `src`、`cordis.patch.yml`、`README.md`、`LICENSE`。

版本已发布过之后不能再发同一个号：改 `package.json` 的 `version` 再发（`npm version patch|minor|major`）。

## 结构

- `src/index.js` — 宿主 FavoritesService（storageDomain 持久化 + 运行时 Typert 远程）
- `src/favorites-domain.js` / `src/schema.js` — 存储域声明与记录 schema
- `src/favorites-core.js` — 收藏 CRUD 纯逻辑
- `src/client.js` — 浏览器 bundle（footer 入口/弹出层、头部星标、`@` 源）
- `cordis.patch.yml` — 纯增量 `insert` 宿主服务
