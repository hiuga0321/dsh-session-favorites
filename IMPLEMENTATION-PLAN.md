# 会话收藏夹 — 实施步骤（可执行清单）

> 目标环境：插件项目目录 `D:\projects\dsh-session-favorites`；DSH 检出 `D:\deepseek-harness`（`dsh` CLI 从这里可用）。
> 原则：**先搭骨架打通“远程安装 + 远程接口”最小闭环，再往上堆 UI**。每步都可独立验收。

---

## 阶段 0 · 环境自检

| 检查 | 命令/方式 | 通过标准 |
|---|---|---|
| Node/pnpm | `node -v && pnpm -v` | Node `^22.19 || >=24`，pnpm ≥ 9 |
| `dsh` CLI 与 `plugin` 子命令 | `dsh plugin --help` | 出现 `add` 子命令 |
| 目标 profile | `dsh --profile web --dump-config` | 能输出配置 |

> 参考命令来自 archive-manager README；若 `dsh` 不是全局命令，改用你 DSH 检出内的等价入口（如 `pnpm dsh`）。

---

## 阶段 1 · 包骨架（让 `dsh plugin add .` 先装得上）

**产出文件**：`package.json`、`cordis.patch.yml`、`scripts/build.mjs`、空 `src/index.js`、`src/client.js`、`src/favorites-domain.js`。

1. 写 `package.json`（见 spec §1.1）：`exports["./client"]`、`dsh.bundle.patch` → `cordis.patch.yml`、`dsh.client.inject`、`peerDependencies` 版本区间。
2. 写 `cordis.patch.yml`：仅 `insert` 两条（`session-favorites` / `ui-session-favorites`），**不含 `disabled: true`**。
3. 写 `scripts/build.mjs`：esbuild 把 `src/*.js` 打进 `lib/index.js`、`lib/client.js`。
4. 宿主 `src/index.js` 先写空 `export const inject=[]; export function apply(){}`；客户端 `src/client.js` 写空 `window.__ModuleLoader__.load({ id, factory: () => ({ inject: [], apply(){} }) })`。

**命令**：`pnpm install && pnpm build`

**验收**：
- `lib/index.js`、`lib/client.js` 生成。
- `dsh plugin --profile web add .` 执行成功。
- `dsh --profile web --dump-config` 能看到 `session-favorites` 与 `ui-session-favorites` 两行。

---

## 阶段 2 · 宿主：存储域 + 收藏服务 + 运行时远程

**产出文件**：`src/favorites-domain.js`（完整）、`src/index.js`（完整）。

1. `favorites-domain.js`：`defineDomain({ name:'favorites', version:1, tables:{ favorites: domainTable(schema) } })`。
2. `index.js`：
   - `FavoritesService`，`static inject = ['storageDomain','typert']`；
   - 构造里 `bindTypertRemote(this,'favorites')` + `markRemoteMethod`（`list/add/remove`）+ `ctx.typert.register(FAVORITES_TYPERT)`；
   - `list/add/remove` 实现（幂等、按 `favoritedAt` 降序返回完整列表）。

**验收（单测，mock ctx）**：
- `list` 空 → `[]`；`add` 两次幂等（title 刷新、`favoritedAt` 不变）；`remove` 幂等。
- `ctx.typert.register` 被调用，且描述符里 3 个 invocation 的 `service/namespace/method` 正确。
- 存储域 reopen 后数据仍在（用真实 json/sqlite 后端或 mock 断言 `put` 落盘）。

---

## 阶段 3 · 客户端骨架：`$mount` + 镜像，打通端到端

**产出文件**：`src/client.js`（骨架 + store）。

1. `window.__ModuleLoader__.load({ id, factory })` 包裹。
2. 内联 `FAVORITES_REMOTE` 描述符（与宿主 invocations 一一对应），`ctx.remote.$mount(FAVORITES_REMOTE)`。
3. `createFavoritesStore`：本地可观察镜像（`getSnapshot/subscribe` + `refresh/add/remove`），可选 `localStorage` 预热缓存。
4. `apply` 里 `inject: ['slots','locale','sessions','layout','inputTriggers','remote']`，`void store.refresh()`，临时 `console.log` 拉取结果。

**验收（浏览器）**：
- 重启 DSH Web + 硬刷新后，插件加载无报错。
- 控制台能看到 `favorites.list()` 返回的空列表（证明 `$mount` → 宿主 `typert.register` 链路通了）。

---

## 阶段 4 · 需求 1/2/3：footer 入口 + 弹出层

**产出文件**：`src/client.js` 增加 `FavoritesFooterButton`。

1. `ctx.slots.inject('sidebar.footer.action', …)` 注册 `id:'favorites'` 的入口（星标图标 + 数量徽标；`wide` rail/展开两态）。
2. 弹出层 `position:fixed` 锚定按钮上方（`useLayoutEffect` + `getBoundingClientRect`）。
3. 交互：
   - **仅关闭按钮关闭**（不挂 outside-click/Esc）；点击行打开会话时 `setOpen(false)`；
   - 按 `workspaceId` 分组（实时 `useWorkspaces` 顺序，缺失/已删 → 未分组），组内 `favoritedAt` 降序；
   - 搜索框：非空切扁平过滤，清空恢复分组；
   - 行尾删除按钮 `stopPropagation` → `store.remove(id)`；
   - 点击行 → `sessions.open(id)` + `layout.selectPanel(null)`。

**验收**：按钮出现在设置按钮上方；弹出层分组正确；搜索/打开/删除全通；点空白或 Esc 不关，只有关闭按钮关。

---

## 阶段 5 · 需求 4（一期）：会话头部星标

**产出文件**：`src/client.js` 增加 `HeaderFavoriteToggle`。

1. `ctx.slots.inject('conversation.session.header.actions', …)` 注册 `id:'favorites'`。
2. 星标按 `useFavorites(s => s.byId.has(sessionId))` 亮/灭；`aria-pressed` 同步；点击 `add/remove` 当前会话。

**验收**：会话头部出现星标；切换收藏即时反映到 footer 弹出层列表。

---

## 阶段 6 · 需求 5：`@` 触发源

**产出文件**：`src/client.js` 增加 `favoritesSource`。

1. `ctx.inputTriggers.registerSource({ trigger:'@', name:'favorites', order:2, candidates, onPick, lexicon, subscribeLexicon, codec })`。
2. `candidates` = `ctx.remote.sessionReferenceResolver.candidates(...)` ∩ 收藏 id；`onPick` 插入 `{ source:'reference', ref:mention, appearance:'session' }`。

**验收**：输入 `@` 出现“会话收藏夹”分组；输入关键词过滤；选中后插入 `@[标题](dsh-session:…)` 引用，模型上下文含该会话。

---

## 阶段 7 · 测试 + 版本矩阵 + 发布准备

1. `test/host.test.mjs`、`test/client.test.mjs`、`test/version-matrix.test.mjs`（参考 archive-manager 的 test 目录）。
2. `peerDependencies` 覆盖多个 DSH 版本；矩阵 CI 逐版本跑。
3. `pnpm pack --dry-run` 校验 `files`（lib、cordis.patch.yml、README、LICENSE）。

**验收**：`pnpm test` + `pnpm verify`（或自定义 verify）全绿；`dsh plugin add dsh-session-favorites@latest` 从 registry 安装成功。

---

## 阶段 8（可选 · 二期）· 最小 fork：每行星标

1. fork `WorkspaceBrowser` + `SessionNodeItem`（复用官方 CSS/store/拖拽），`rowActions` 加星标。
2. 星标用 `styles.insert` + 主题 token（不依赖官方 hash 类名）。
3. 降级开关：fork 注册/渲染失败 → 回退阶段 5 头部星标；footer 入口永在。
4. 注册进 `sidebar.workspaces`（single 槽位覆盖官方浏览器）。

**验收**：每个工作区会话行出现星标；fork 崩溃时自动退到头部星标，功能不丢。

---

## 关键陷阱速查（实现时对照）

| 陷阱 | 正确做法 |
|---|---|
| `$mount` 与 `typert.register` 描述符不一致 | 宿主 `invocations` 与客户端 `descriptors` 的 `service/namespace/method/codec` 一一对应 |
| 客户端 bundle 装载 | 必须用 `window.__ModuleLoader__.load({ id, factory })`，不能 ES import |
| 弹出层误关 | 不挂 `useDismissOnOutsidePointer`、不监听 Esc |
| footer 槽 owner | 只有 `{ wide }`；`useSessions/useWorkspaces` 等是框架标准 props |
| 头部槽 owner | session 作用域提供 `sessionId`、`useSession`、`useSessions` |
| 远程方法未出现在 typed `ClientRemote` | 用本地薄封装 `favorites = { list: () => ctx.remote.favorites.list(), … }`，配本地 TS 类型 |
