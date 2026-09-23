# 会话收藏夹（Session Favorites）— 设计方案 v2

> **本方案取代 v1。** v1 按“DSH 仓库内静态包 + `@Remote` + `build:lib` + 改 `api-remotes` 装配 + 改 `ui-workspace`”设计，与“不改 DSH 源码、发布插件市场、远程安装”冲突。
> v2 改为**独立第三方 npm 插件**，全部走公开扩展点 + 运行时 seam。
> **参考实现（已逐条核对源码）**：[`@michengai/dsh-archive-manager`](https://github.com/MichengAI/dsh-archive-manager) —— 它证明了：不改源码也能给会话行加按钮、拿主机持久化、加远程接口、上 npm 远程安装。

---

## 0. 定位与分发模型

- **形态**：独立 npm 包（如 `dsh-session-favorites`），不在 DSH 仓库内。
- **安装**：`dsh plugin --profile web add dsh-session-favorites`（npm registry 远程安装）。
- **约束**：不修改任何 `@deepseek-ai/dsh-*` 源码；只依赖公开扩展点与运行时 seam。
- **两期交付**：一期零 fork（零风险）；二期可选 fork（解锁“每行星标”）。

---

## 1. 关键架构决策（相对 v1 的变化）

| 项 | v1（废弃） | v2（本方案） |
|---|---|---|
| 远程接口 | `@Remote` 装饰器 + `build:lib` 生成 `./remote` + 改 `api-remotes` | **运行时注册**：宿主 `ctx.typert.register(descriptor)` + `bindTypertRemote`；客户端 `ctx.remote.$mount(descriptor)` |
| 持久化 | 宿主 `storageDomain`（但客户端拿不到，因 api-remotes 锁死） | 宿主 `storageDomain`，自有服务，`insert` 进组合，**不动官方服务** |
| 需求 4 每行星标 | 改 `ui-workspace` 加槽位 | 一期：会话头部星标；二期：最小 fork 侧栏 |
| 分发 | DSH 仓库内包 | 独立 npm 包 + `dsh plugin add` |

> 核心认知：`api-remotes` 的“显式 build 期 import 列表”限制只约束**一方（first-party）装配路径**；第三方插件走 **SRC 运行时路径**（`ctx.typert.register` + `ctx.remote.$mount`），无需改装配、无需 `build:lib`。

---

## 2. 需求 → 机制映射（两期）

| 需求 | 一期（零 fork） | 二期（可选 fork） |
|---|---|---|
| 1. 按钮在设置上方 | `sidebar.footer.action`（公开 list 槽位，渲染在 `sidebar.settings` 之上） | 同 |
| 2. 冒泡层仅关闭按钮关 | footer 入口自绘 `position:fixed` 面板，不挂 outside-click/Esc，仅显式关闭按钮 | 同 |
| 3. 列表分组/搜索/打开/删除 | 弹出层自绘 + `sessions.open`+`layout.selectPanel` + 运行时远程 `favorites/*` | 同 |
| 4. 收藏会话按钮 | 会话头部 `conversation.session.header.actions`（session 作用域，收藏“当前会话”） | 每行 `SessionNodeItem` 加星标（最小 fork） |
| 5. `@` 搜索并引入 | `inputTriggers` + `remote.sessionReferenceResolver`（均为公开 seam） | 同 |
| 持久化（多设备一致） | 宿主 `storageDomain` | 同 |

---

## 3. 一期详细设计（零 fork）

### 3.1 包结构

```
dsh-session-favorites/
  package.json          # dsh.bundle.patch -> cordis.patch.yml；exports ./client；dsh.client.inject
  cordis.patch.yml      # 纯增量 insert（不 disable 任何官方服务）
  src/
    index.js            # 宿主：FavoritesService（storageDomain + 运行时远程注册）
    favorites-domain.js # defineDomain 存储域声明
    client.js           # 客户端 bundle：槽位 + @ 源 + $mount + 弹出层
  test/ …               # 版本矩阵 + 单元测试
```

### 3.2 持久化与远程（运行时，核心变化点）

**存储域**（`src/favorites-domain.js`）：

```js
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

export const favoritesSpec = defineDomain({
  name: 'favorites',
  version: 1,
  tables: {
    // key = SessionId；value = { title, workspaceId?, favoritedAt }
    favorites: domainTable(favoriteRecordSchema),
  },
})
```

**宿主服务**（`src/index.js`，参考 archive-manager 的 `src/workspace.js`）：

```js
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { favoritesSpec } from './favorites-domain.js'

const FAVORITES_INVOCATIONS = [
  { id: '…#favorites/list',   service: 'favorites', namespace: 'favorites', method: 'list',   invocation: { kind: 'direct' }, parameters: [], result: listCodec, sourceLocation },
  { id: '…#favorites/add',    service: 'favorites', namespace: 'favorites', method: 'add',    invocation: { kind: 'direct' }, parameters: [/* sessionId,title,workspaceId */], result: listCodec, sourceLocation },
  { id: '…#favorites/unfavorite', service: 'favorites', namespace: 'favorites', method: 'unfavorite', invocation: { kind: 'direct' }, parameters: [/* sessionId */], result: listCodec, sourceLocation },
]
const FAVORITES_TYPERT = { package: PKG, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: FAVORITES_INVOCATIONS }

export class FavoritesService {
  static inject = ['storageDomain', 'typert']
  constructor(ctx) {
    this.ctx = ctx
    this.domain = ctx.storageDomain.open(favoritesSpec)   // async；方法内 await
    this.typertRemote = bindTypertRemote(this, 'favorites')
    for (const m of ['list', 'add', 'remove']) markRemoteMethod(this, m)
    ctx.get('typert').register(FAVORITES_TYPERT)          // 运行时注册，替代 build:lib 装配
  }
  async list() { /* 按 favoritedAt 降序返回 rows */ }
  async add(sessionId, title, workspaceId) { /* 幂等；返回完整列表 */ }
  async remove(sessionId) { /* 幂等；返回完整列表 */ }
}
```

**客户端挂载**（`src/client.js`，参考 archive-manager 的 `src/client.js`）：

```js
// 内联描述符（手写 codec shim，与宿主 invocations 一一对应）
const FAVORITES_REMOTE = { package: PKG, descriptors: [ /* list/add/remove */ ] }
ctx.remote.$mount(FAVORITES_REMOTE)          // 运行时挂载，绕过 api-remotes
const list = await ctx.remote.favorites.list()
```

> 关键：**不碰 `api-remotes`、不 `build:lib`、不 disable 任何官方服务**。新远程方法在宿主运行时注册、在客户端运行时挂载，走 typert SRC 路径。

### 3.3 客户端槽位

- **需求 1/2/3**：注册进 `sidebar.footer.action`（`id: 'favorites'`），组件自绘入口按钮 + `position:fixed` 弹出层：
  - 弹出层：标题 + 关闭按钮（**唯一关闭途径**）+ 搜索框 + 列表；
  - 列表按 `workspaceId` 分组（组顺序=实时 `useWorkspaces` 顺序，缺失/已删工作区归“未分组”），组内按 `favoritedAt` 降序；
  - 行尾删除按钮（`stopPropagation`），点击行 `sessions.open(id)` + `layout.selectPanel(null)`；
  - 搜索时切换扁平过滤，清空恢复分组。
- **需求 4（一期替代）**：注册进 `conversation.session.header.actions`（`id: 'favorites'`），星标收藏/取消收藏**当前会话**。
- **需求 5**：注册 `@` 源 `favorites`，候选 = `ctx.remote.sessionReferenceResolver.candidates(...)` ∩ 收藏 id；`onPick` 插入 Session 引用（`appearance: 'session'`）。

---

## 4. 二期设计（可选 fork：解锁“每行星标”）

> 仅当产品需要“工作区每一行都有星标”时启用。目标是**把 fork 脆弱面压到最小**。

1. **只 fork 两个组件**：`WorkspaceBrowser` + `SessionNodeItem`（分组推导、store、拖拽逻辑复用官方）。
2. **星标按钮用自己的样式**：`styles.insert()` + 主题 token（`--dsw-alias-*`），不依赖官方 hash 类名；仅“行容器”一个 hash class 是版本相关的。
3. **降级开关**：fork 加载/渲染失败（缺 class、API 变化）时自动回退到一期“头部星标”，footer 入口始终可用。
4. **版本矩阵 CI**：`peerDependencies` 用版本区间 + 多版本测试（archive-manager 的 `test-version-matrix` / `test-latest-compatibility` / `test-legacy-compatibility` 模式）。

---

## 5. 成本 / 风险与规避

| 风险 | 规避 |
|---|---|
| fork 侧栏重且脆、锁版本 | 一期不 fork；二期最小 fork + 降级开关 + 版本矩阵 |
| `cordis.patch.yml` 接管核心服务导致升级冲突 | **收藏夹是全新数据，不 `disable` 任何官方服务**，仅 `insert` 自有服务 |
| 远程接口需改 `api-remotes` | 运行时 `ctx.typert.register` + `ctx.remote.$mount`，零装配改动 |
| DSH 升级破坏插件 | 锁版本区间 + 矩阵 CI + 能力级降级 |
| 依赖面过大 | 只依赖稳定公开 seam（`storageDomain` / `typert` / slots / `sessionReferenceResolver` / `inputTriggers`） |

### `cordis.patch.yml`（纯增量，无 `disabled: true`）

```yaml
# 只 insert 宿主服务；浏览器 bundle 由 package.json 的 dsh.client 声明发现，不进 patch。
- insert:
    - id: session-favorites
      name: 'dsh-session-favorites'          # 宿主：storageDomain + 远程
```

---

## 6. 发布与验证

1. `package.json`：`dsh.bundle.patch` → `cordis.patch.yml`；`exports["./client"]`；`dsh.client.inject`（`dsh-client-ui-sidebar` / `dsh-client-ui-conversation` / `dsh-client-ui-workspace` / `dsh-typert-registry` / `dsh-client-connection` …）；`peerDependencies` 版本区间。
2. 本地远程安装自测：`dsh plugin --profile web add .`（源码）或 `add dsh-session-favorites@latest`（registry）。
3. `pnpm test`（单元 + 版本矩阵）+ `pnpm verify`。

---

## 7. 决策记录（相对 v1 的变更）

- **持久化事实源**：仍为宿主 `storageDomain`（满足“多设备一致”），但通过**运行时远程**暴露，不再改 `api-remotes`。
- **需求 4**：一期用“会话头部星标”替代“每行星标”；每行星标降为二期可选项（最小 fork）。
- **分发**：从“DSH 仓库内包”改为“独立 npm 包 + `dsh plugin add`”。
- **远程接口**：从“`@Remote` + `build:lib` + 装配”改为“运行时 `ctx.typert.register` + `ctx.remote.$mount`”。
