# 会话收藏夹 — 代码级规格 v2

> 取代 v1（v1 用 `@Remote`+`build:lib`+改核心，已废弃）。v2 全部走**运行时 seam**，参考实现：
> [`@michengai/dsh-archive-manager`](https://github.com/MichengAI/dsh-archive-manager)（`src/workspace.js` 宿主远程注册、`src/client.js` 客户端 `$mount`、`cordis.patch.yml` 增量 insert）。
> 语言用 **纯 JS + esbuild**（与参考一致，避免接入 DSH 的 tsdown 类型管线）；TS 可选（esbuild 剥类型即可）。

---

## 1. 包结构与构建

```
dsh-session-favorites/
  package.json
  cordis.patch.yml
  scripts/build.mjs          # esbuild 打包 src/*.js -> lib/*
  src/
    index.js                 # 宿主：FavoritesService + 运行时远程
    favorites-domain.js      # storageDomain 存储域
    client.js                # 客户端 bundle
  test/
    host.test.mjs
    client.test.mjs
    version-matrix.test.mjs
```

### 1.1 `package.json` 关键片段

```jsonc
{
  "name": "dsh-session-favorites",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md", "LICENSE"],
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "pnpm build && node --test test/*.test.mjs"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-ui-workspace",
        "@deepseek-ai/dsh-client-ui-input-trigger",
        "@deepseek-ai/dsh-typert-registry",
        "@deepseek-ai/dsh-client-connection"
      ],
      "platform": "web"
    }
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-client-locale": "0.1.x-range",
    "@deepseek-ai/dsh-client-ui-conversation": "0.1.x-range",
    "@deepseek-ai/dsh-client-ui-sidebar": "0.1.x-range",
    "@deepseek-ai/dsh-client-ui-workspace": "0.1.x-range",
    "@deepseek-ai/dsh-client-ui-input-trigger": "0.1.x-range",
    "@deepseek-ai/dsh-client-ui-primitives": "0.1.x-range",
    "@deepseek-ai/dsh-storage-domain": "0.1.x-range",
    "@deepseek-ai/dsh-typert-protocol": "0.1.x-range",
    "@deepseek-ai/dsh-typert-registry": "0.1.x-range",
    "@deepseek-ai/dsh-session": "0.1.x-range",
    "@deepseek-ai/dsh-workspace": "0.1.x-range",
    "@deepseek-ai/dsh-session-reference": "0.1.x-range"
  }
}
```

### 1.2 `cordis.patch.yml`（纯增量，无 `disabled: true`）

```yaml
# 只新增宿主服务，不关闭任何官方服务：收藏是全新数据，不需要接管 workspace。
# 浏览器 bundle 由 package.json 的 dsh.client 声明发现（exports["./client"]），不进 patch。
- insert:
    - id: session-favorites
      name: 'dsh-session-favorites'
```

---

## 2. 宿主半部（`src/index.js` + `src/favorites-domain.js`）

### 2.1 存储域

```js
// src/favorites-domain.js
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const favoriteRecordSchema = {
  parse(v) {
    if (typeof v !== 'object' || v === null) throw new TypeError('record must be object')
    if (typeof v.title !== 'string') throw new TypeError('title must be string')
    if (v.workspaceId !== undefined && typeof v.workspaceId !== 'string') throw new TypeError('workspaceId must be string')
    if (!Number.isFinite(v.favoritedAt)) throw new TypeError('favoritedAt must be number')
    return v
  },
}

export const favoritesSpec = defineDomain({
  name: 'favorites',
  version: 1,
  tables: { favorites: domainTable(favoriteRecordSchema) },
})
```

### 2.2 运行时远程注册（替代 `@Remote` + `build:lib`）

```js
// src/index.js
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { favoritesSpec } from './favorites-domain.js'

const PKG = 'dsh-session-favorites'

// 手写 codec shim（参考 archive-manager：客户端网关要 mode:'strict' 且 schema 有 parse()）
function strictCodec(typeSymbol, schema) {
  return { mode: 'strict', typeSymbol, create: () => schema, schema }
}

const listCodec = strictCodec('favorites/List', {
  parse(v) {
    if (!Array.isArray(v)) throw new TypeError('rows must be array')
    return v
  },
})

const FAVORITES_INVOCATIONS = [
  { id: `${PKG}#favorites/list`, service: 'favorites', namespace: 'favorites', method: 'list',
    invocation: { kind: 'direct' }, parameters: [], result: listCodec,
    sourceLocation: { file: `${PKG}/lib/index.js`, line: 1, column: 1 } },
  { id: `${PKG}#favorites/add`, service: 'favorites', namespace: 'favorites', method: 'add',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: strictCodec('SessionId', { parse: s => { if (typeof s !== 'string' || !s) throw new TypeError('sessionId'); return s } }) },
      { name: 'title', wire: 'title', source: 'json', codec: strictCodec('String', { parse: s => { if (typeof s !== 'string') throw new TypeError('title'); return s } }) },
      { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: strictCodec('String?', { parse: s => s === undefined || typeof s === 'string' ? s : (() => { throw new TypeError('workspaceId') })() }) },
    ],
    result: listCodec, sourceLocation: { file: `${PKG}/lib/index.js`, line: 1, column: 1 } },
  { id: `${PKG}#favorites/unfavorite`, service: 'favorites', namespace: 'favorites', method: 'unfavorite',
    invocation: { kind: 'direct' },
    parameters: [ { name: 'sessionId', wire: 'sessionId', source: 'json', codec: strictCodec('SessionId', { parse: s => { if (typeof s !== 'string' || !s) throw new TypeError('sessionId'); return s } }) } ],
    result: listCodec, sourceLocation: { file: `${PKG}/lib/index.js`, line: 1, column: 1 } },
  { id: `${PKG}#favorites/rename`, service: 'favorites', namespace: 'favorites', method: 'rename',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: sessionIdCodec },
      { name: 'title', wire: 'title', source: 'json', codec: titleCodec },
    ],
    result: listCodec, sourceLocation: { file: `${PKG}/lib/index.js`, line: 1, column: 1 } },
]

const FAVORITES_TYPERT = { package: PKG, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: FAVORITES_INVOCATIONS }

function registerHostRemote(ctx) {
  const typert = ctx.get('typert')
  if (typert !== undefined) { typert.register(FAVORITES_TYPERT); return }
  ctx.inject(['typert'], (tc) => { tc.typert.register(FAVORITES_TYPERT) })
}

// 模拟 TS 装饰器 @Remote(method)（参考 archive-manager 的 markRemoteMethod）
function markRemoteMethod(instance, method) {
  const context = { private: false, static: false, name: method, addInitializer(fn) { fn.call(instance) } }
  Remote(method)(undefined, context)
}

export class FavoritesService {
  static inject = ['storageDomain', 'typert']
  constructor(ctx) {
    this.ctx = ctx
    this.domainPromise = ctx.storageDomain.open(favoritesSpec)
    this.typertRemote = bindTypertRemote(this, 'favorites')
    for (const m of ['list', 'add', 'remove']) markRemoteMethod(this, m)
    registerHostRemote(ctx)
    ctx.effect(() => () => { void this.domainPromise.then(d => d.close()) }, 'favorites: domain lifetime')
  }
  async table() { return (await this.domainPromise).table('favorites') }
  async rows() {
    const t = await this.table()
    return [...t.entries()]
      .map(([sessionId, r]) => ({ sessionId, title: r.title, workspaceId: r.workspaceId, favoritedAt: r.favoritedAt }))
      .sort((a, b) => b.favoritedAt - a.favoritedAt)
  }
  async list() { return this.rows() }
  async add(sessionId, title, workspaceId) {
    const t = await this.table()
    const cur = t.get(sessionId)
    if (cur === undefined) await t.put(sessionId, { title, workspaceId, favoritedAt: Date.now() })
    else await t.update(sessionId, prev => ({ ...prev, title, workspaceId }))
    return this.rows()
  }
  async remove(sessionId) {
    await (await this.table()).delete(sessionId)
    return this.rows()
  }
}

export const inject = ['storageDomain', 'typert']
export function apply(ctx) { new FavoritesService(ctx) }
```

> 说明：宿主服务**不继承任何官方服务、不覆盖任何官方服务**；`storageDomain` 是纯增量持久化，`typert` 只用来运行时注册远程描述符。

---

## 3. 客户端半部（`src/client.js`）

### 3.1 模块装载 + 运行时 `$mount`

```js
window.__ModuleLoader__.load({
  id: 'dsh-session-favorites',
  factory: (require) => {
    const react = require('react')
    const jsxRuntime = require('react/jsx-runtime')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    // 与宿主 invocations 一一对应的客户端描述符
    const FAVORITES_REMOTE = { package: 'dsh-session-favorites', descriptors: [ /* list/add/unfavorite */ ] }

    // 自家 favorites 命名空间是运行时 $mount 的，不进 inject（用 ctx.get）。
    // workspaces 用于归档判定与归档导航适配。
    const inject = ['slots', 'sessions', 'layout', 'inputTriggers', 'remote', 'workspaces']
    function apply(ctx) {
      const mounted = ctx.remote.$mount(FAVORITES_REMOTE)   // 运行时挂载命名空间（注册为服务键 remote.favorites）
      // 该服务键在 apply 期间才诞生，无法写进 inject（会自锁），用非门控的 ctx.get 查找。
      const namespace = () => {
        const service = ctx.get('remote.favorites')
        if (service === undefined) throw new Error('favorites namespace is not mounted yet')
        return service
      }
      const favorites = {
        list: () => namespace().list(),
        add: (sessionId, title, workspaceId) => namespace().add(sessionId, title, workspaceId),
        unfavorite: sessionId => namespace().unfavorite(sessionId),
      }
      const store = createFavoritesStore(favorites)      // 本地可观察镜像 + localStorage 预热缓存
      Promise.resolve(mounted).then(() => store.refresh())

      // 需求 1/2/3：footer 入口 + 弹出层
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action', id: 'favorites', locale: NS,
        inject: () => ({ hooks: { favorites: store }, onOpen: openSession, onRemove: id => store.remove(id) }),
      }, FavoritesFooterButton))

      // 需求 4（一期）：会话头部星标
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions', id: 'favorites', locale: NS,
        inject: () => ({ hooks: { favorites: store }, onAdd: store.add, onRemove: store.remove }),
      }, HeaderFavoriteToggle))

      // 需求 5：@ 源
      ctx.effect(() => ctx.inputTriggers.registerSource(favoritesSource(ctx, store)), 'favorites: @ source')
    }
    return { inject, apply }
  },
})
```

### 3.2 弹出层（需求 1/2/3）

- `sidebar.footer.action`（list/root，owner `{ wide }`）：入口星标按钮 + 数量徽标。
- 弹出层 `position:fixed`，锚定按钮上方（`useLayoutEffect` + `getBoundingClientRect`）。
- **仅关闭按钮关闭**：不挂 `useDismissOnOutsidePointer`、不监听 Esc；点击会话行**也不关闭**（打开会话与关闭弹层解耦，便于连续查看多个收藏）。
- 分组：按 `workspaceId` + 实时 `useWorkspaces` 顺序；缺失/已删工作区 → “未分组”；组内 `favoritedAt` 降序；搜索时扁平过滤。
- **选中态**：`useSessions(s => s.current)` 取当前正在查看的会话（与原生侧边栏同源 `list.current`），命中行加 `.dsf_rowSelected` + `aria-selected="true"`，标题加粗。原生 `.sessionRow.selected` 用的是 hover 一档底色，与 `:hover` 无法区分，故这里取更重的 `--dsw-alias-interactive-bg-active`（带 `--dsw-alias-interactive-bg-hover` 回退，与 `DirectoryBrowser.module.css` 同款写法）。归档会话经补丁打开后同样进入选中态。
- **行尾操作**：与原生 `.rowActions`（`Rows.module.css`）一致 —— `display:none` 悬停才出现（不是改 opacity，图标不占位也不吃点击）、裸 16px 图标、`gap 12`、tertiary 灰；失效行整组隐藏。
- **移除收藏必须二次确认**：行尾垃圾桶按钮只打开确认框（`DeleteConfirmDialog`），确认框里点「移除收藏」才真正删除。顶部「清理 N 个失效收藏」横幅同理，走同一个确认组件（批量时文案换成条数）。取消 / Esc / 点遮罩 / 关闭按钮都**不产生任何删除**。
- **重命名**：行尾铅笔按钮（与原生 `IconEditOutline16` 同一条 path）打开「重命名会话」对话框。对齐原生 Modal 的全部行为：打开即聚焦并全选、空标题禁用提交、Enter 提交、**输入法组合期间 Enter 不提交**、Esc / 点遮罩取消、进行中不允许关闭、失败以 `role="alert"` 内联显示且不关闭、成功才关闭。
  - 提交走 DSH 官方的 `sessions.binding(id).session.rename(title)`，与原生侧边栏完全同一条路径（连 `unknown session` 与 `result.error.message` 的抛出方式都一致）。该方法成功后会自动更新 title projection，所以弹出层标题立刻刷新，无需等推送。
  - **成功之后**再同步收藏里的标题副本（`favorites/rename`）——顺序不可颠倒：会话名才是事实来源，反序会在 DSH 改名失败时留下对不上的副本，而 `@` 搜索正是按这份副本匹配的。
  - 失效行不提供重命名入口（会话已不存在）。

#### 3.2.2 对话框外观对齐 DSH

`Dialog` 外壳逐项复刻 `ui-primitives/Modal.tsx` + `Modal.module.css`：

| 原生 | 本插件 |
|---|---|
| `.root` flex 居中 + `padding:24px` + `z-index:1000` | `.dsf_modalLayer` |
| `.mask` 独立一层、`bg-mask-1` + `backdrop-filter: var(--dsw-mask-blur)`、点击关闭 | `.dsf_modalMask` |
| `.dialog` `r24` / `bg-layer-2` / `elevation-prominent` / `width min(380px,100%)` / `padding 0 0 24px` | `.dsf_modal` |
| `.header` `22px 14px 12px 24px`，标题 16px/500 + 独立关闭按钮 | `.dsf_modalHeader` |
| `.description` `padding 0 24px`、14px/22px | `.dsf_modalDesc` |
| `.body` `padding 0 24px`、`margin-top 20px` | `.dsf_modalBody` |
| `.footer` 右对齐 `gap 8` | `.dsf_modalFooter` |
| `createPortal(..., document.body)` | 同（拿不到 react-dom 时退化为就地渲染） |
| `Button`：胶囊 `r18` / `h36` / `pad 0 14px` / 14px，`outline` 用 `0.5px border-l3`，`primary` 用 `button-primary-fill` | `.dsf_modalButton*` |
| 输入框 `.renameInput`：`h44` / `r22` / `0.5px border-l4` | `.dsf_modalInput` |
| 破坏性操作仅文字变红（`.deleteAction`） | `.dsf_modalButtonDanger` |

全部 27 个 `--dsw-*` 变量均已核对存在于 `ui-theme` 的 `design-platform.css` / `gradient-shadow-text.css`，无自造变量。
- **失效收藏**（会话已被删除）：`listReady` 后才判定（避免启动瞬间全灰）；标 `已失效` 徽标 + 弱化样式，点击**不触发** `sessions.open`（其对未知 id fail loud）；顶部出现「N 个收藏的会话已不存在 / 清理」横幅，一键逐个取消收藏。
- `openSession` 自身也做存在性校验，失效 id 只告警并跳过。
- **归档收藏**（会话在 `archivedSessionIds` 中）：行尾标「已归档」中性徽标 + `title` 提示；点击**仍可打开**（见 3.2.1）；打开失败时弹出层顶部显示红色提示条，绝不再"点了没反应"。
- 行状态判据抽成纯函数 `rowState(row, {listReady, sessionsById, archivedIds, currentId})`：已失效优先于已归档；列表未就绪时不判失效；选中态只认 `currentId`。

#### 3.2.1 归档会话导航适配（A + B）

**问题**：`UiWorkspaceService.watchNavigation()` 在每次会话/工作区列表变化时调用 `clearArchivedCurrent()`；只要当前会话落在 `workspaces.list.getSnapshot().archivedSessionIds` 里，就立刻 `sessions.clear()`。因此对归档会话 `sessions.open()` 会被马上撤销，表现为"点了打不开"。官方恢复入口 `workspaces.unarchiveSession` 仅 0.1.6+ 提供，本仓库目标版本 0.1.5-rc.2 没有。

**做法**：**本插件自带这套适配，不依赖任何其它插件**（`@michengai/dsh-archive-manager` 装不装都一样）。思路与它的 `allowArchivedNavigation` 同构，但补齐了它没有处理的启动竞态与"诚实降级"：

1. 取 `ctx.get('uiWorkspace')`（非 inject 门控），保存原型上的 `clearArchivedCurrent`。
2. 以自有属性覆盖为 `wrapped`：仅当"放行目标 === 当前会话 && 该会话已归档"时返回 `false`（不清理）；否则清空放行目标并调用原方法。给补丁打 `__sessionFavoritesPatch` 标记（不能用函数名 —— 打包压缩会改 `name`）。
3. **自证补丁生效**：`Object.getOwnPropertyDescriptor(navigation, 'clearArchivedCurrent')?.value === wrapped`。Cordis 读取服务方法会绑定代理，必须用自有描述符核对；核对失败即判定未接纳。
4. **等待服务出现（关键）**：`uiWorkspace` 由 `ui-workspace` 插件在**自己的 apply 里** `new UiWorkspaceService(...)` 创建，与本插件之间**没有 inject 依赖，先后顺序无保证**。旧实现只在 apply 时探测一次，一旦跑在前面就永久降级 —— 这正是「装了 archive-manager 才打得开、不装就打不开」的根因。现在：
   - `install()` 是幂等的，`open()` 时按需重试；
   - 另外用 `ctx.inject(['uiWorkspace'], …)` 在服务首次可用时补装一次（拿不到 `ctx.inject` 也无妨）。
5. 打开流程 `open(id)`：确认补丁在位（不在位则重装）→ 设置放行目标 → `sessions.open(id)` → 校验宿主确实保留了该会话（优先 `byId[id].retainedBy.mainView > 0`，回退 `list.current === id`），否则回滚放行目标并抛错。
6. **降级必须诚实**：补丁不在位时，**不调用 `sessions.open`**，直接抛成品文案。因为原生清理发生在 `open` 返回之后的微任务里 —— 此刻立刻读 `current` 一定是"还在"，据此返回成功就是撒谎，用户随后会看到会话自己跳走。普通会话不受影响，照常打开。
7. `ctx.effect` 注册 `dispose`：清空放行目标并 `delete` 自有属性，还原原型方法。

放行目标是**单次、单 id**的：当前会话一旦切换到别的会话，放行自动失效，原生归档清理行为立即恢复（补丁不会永久失效）。

### 3.3 会话头部星标（需求 4 一期）

- `conversation.session.header.actions`（list/session）：标准 props 提供 `sessionId`、`useSession`、`useSessions`。
- 星标收藏/取消收藏当前会话；标题取 `useSessions(s => s.byId[sessionId]?.displayTitle)`。

### 3.4 `@` 源（需求 5）

```js
// 候选完全来自本地收藏镜像：输入 @ 即列出全部收藏，继续输入按标题过滤。
// 不把查询词交给 sessionReferenceResolver（那会把分组名当会话标题去匹配 → 空结果）；
// section 提供自己的分组标题，菜单会因此隐藏 t(source.name) 的来源标题行。
// order 升序（越低越靠前）：reference=0、cordis=1，故用 -1 让 favorites 置顶。
function base64UrlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}
// 与 @deepseek-ai/dsh-session-reference/uri 的 formatSessionReferenceMention 等价
function sessionMention(sessionId, label) {
  const text = String(label ?? sessionId).replace(/[\\\]]/gu, match => `\\${match}`)
  return `@[${text}](dsh-session:${base64UrlJson(sessionId)})`
}

function favoritesSource(ctx, store) {
  return {
    trigger: '@', name: 'favorites', order: -1,
    async candidates(session, { query }) {
      const needle = query.trim().toLowerCase()
      const rows = store.getSnapshot().rows
      const matched = needle === '' ? rows : rows.filter(row => row.title.toLowerCase().includes(needle))
      return matched.slice(0, 50).map(row => ({
        name: row.title, label: row.title, section: 'favorites', icon: 'session',
        value: JSON.stringify({ kind: 'session', label: row.title, mention: sessionMention(row.sessionId, row.title) }),
      }))
    },
    onPick({ candidate }) {
      const v = JSON.parse(candidate.value ?? '{}')
      if (v.kind !== 'session') return undefined
      return { insert: { source: 'reference', ref: v.mention, label: v.label, appearance: 'session', clipboardText: v.mention } }
    },
    lexicon() { return store.getSnapshot().rows.map(r => r.title) },
    subscribeLexicon(_s, l) { return store.subscribe(l) },
    codec: { clipboardText: r => r, serialize: r => Promise.resolve(r) },
  }
}
```

---

## 4. 二期：最小 fork（可选，解锁每行星标）

> 仅当需要“工作区每一行都有星标”时启用；`cordis.patch.yml` 不变，只在 `./client` bundle 内 fork。

- fork `WorkspaceBrowser` + `SessionNodeItem`（复用官方 CSS 模块与 store/拖拽逻辑），在 `rowActions` 里加星标按钮。
- 星标按钮用自己的 `styles.insert(css)` + 主题 token，不依赖官方 hash 类名。
- 降级开关：`try { 注册 fork } catch { 注册头部星标 }`；fork 渲染报错回退头部星标，footer 入口永在。
- 注册进 `sidebar.workspaces`（single 槽位，更高优先级覆盖官方浏览器）。

---

## 5. 测试与版本矩阵

| 面 | 用例 |
|---|---|
| 宿主 | `list/add/remove` 幂等与排序；`favorites/changed`；存储域 reopen 读取 |
| 远程 | 宿主 `ctx.typert.register` 后，客户端 `$mount` 后可调 `favorites.list` |
| 客户端 | 弹出层仅关闭按钮关；分组顺序；搜索扁平；行尾删除 stopPropagation；头部星标切换；`@` 源 pick 产生 session 引用 |
| 版本矩阵 | 对每个支持的 DSH 版本跑 `test/version-matrix.test.mjs`（参考 archive-manager） |
| 降级 | fork 失败 → 头部星标回退仍可用 |

---

## 6. 相对 v1 的代码级差异

- **删除**：`TypertRemoteService` 继承、`@Remote` 装饰器、`./typert`+`./remote` 导出、`build:lib`、`api-remotes` 装配、`ui-workspace` 新槽位核心改动。
- **新增**：`bindTypertRemote` + 手写 `markRemoteMethod` + `ctx.typert.register`（宿主）；`ctx.remote.$mount`（客户端）；`cordis.patch.yml` 增量 `insert`。
- **保持不变**：存储域 schema、弹出层分组/搜索/删除交互、`@` 源逻辑、会话引用引入语义。
