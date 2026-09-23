// 冒烟自检：直接运行（不 spawn 子进程），验证纯逻辑 + 客户端装载。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// ---- schema ----
const { favoriteRecordSchema } = await import('../src/schema.js')
assert.deepEqual(favoriteRecordSchema.parse({ title: 'A', workspaceId: 'w', favoritedAt: 1 }), { title: 'A', workspaceId: 'w', favoritedAt: 1 })
assert.throws(() => favoriteRecordSchema.parse({ title: '' }))

// ---- favorites-core ----
const { addFavorite, removeFavorite, removeFavorites, renameFavorite, rows } = await import('../src/favorites-core.js')

/** 忠实复刻 KvTable：update 对缺失 key 抛 missing-key，delete 返回 boolean。 */
function mockTable() {
  const data = new Map()
  let chain = Promise.resolve()
  const enqueue = (fn) => {
    const next = chain.then(fn, fn)
    chain = next.then(() => {}, () => {})
    return next
  }
  return {
    entries: () => data.entries(),
    get: (k) => data.get(k),
    put: (k, v) => enqueue(async () => { data.set(k, v) }),
    delete: (k) => enqueue(async () => { if (!data.has(k)) return false; data.delete(k); return true }),
    update: (k, fn) => enqueue(async () => {
      if (!data.has(k)) { const e = new Error(`no record '${k}'`); e.code = 'missing-key'; throw e }
      const next = fn(data.get(k)); data.set(k, next); return next
    }),
  }
}
const table = mockTable()
await addFavorite(table, 's1', 'A', 'w1')
await addFavorite(table, 's2', 'B')
let list = await rows(table)
assert.equal(list.length, 2)
assert.equal(list[0].sessionId, 's2')
// 首次收藏必须真的写入 favoritedAt（旧 mock 会掩盖 update 静默成功的问题）
assert.equal(table.get('s1').favoritedAt > 0, true)

const removed = await removeFavorite(table, 's1')
assert.equal(removed.existed, true, 'removeFavorite 必须报告记录确实存在')
list = await rows(table)
assert.equal(list.length, 1)
// 重复删除必须报告 no-op，而不是静默成功
assert.equal((await removeFavorite(table, 's1')).existed, false)
// 批量删除只统计真实删除数
assert.equal(await removeFavorites(table, ['s2', 'ghost'], () => {}), 1)

// ---- renameFavorite：只改标题副本，保留 favoritedAt 与 workspaceId ----
await addFavorite(table, 'r1', 'Old', 'w1')
const before = table.get('r1')
const renamed = await renameFavorite(table, 'r1', 'New')
assert.equal(renamed.existed, true)
assert.equal(table.get('r1').title, 'New')
assert.equal(table.get('r1').favoritedAt, before.favoritedAt, '改名不得重置收藏时间（否则排序会跳）')
assert.equal(table.get('r1').workspaceId, 'w1', '改名不得丢失工作区归属')
// 记录不存在：no-op，且绝不能凭 put 复活一条被删除的收藏
const miss = await renameFavorite(table, 'never-favorited', 'X')
assert.equal(miss.existed, false)
assert.equal(table.get('never-favorited'), undefined, '不存在的记录不得被改名操作创建出来')

// ---- 包名单一来源：client bundle 的字面量必须与 package-identity 对齐 ----
const { PACKAGE_NAME } = await import('../src/package-identity.js')
assert.equal(typeof PACKAGE_NAME, 'string')
// npm 包名：可选 scope + 全小写裸名（npm 拒绝大写）。
assert.match(PACKAGE_NAME, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, 'PACKAGE_NAME 必须是一个合法的 npm 包名')
// 真正的发布身份在 package.json：三者不一致会导致 typert face 注册键与安装名对不上。
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(PACKAGE_NAME, manifest.name, 'package.json 的 name 必须与 PACKAGE_NAME 一致')
assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch 必须指向随包发布的 patch')

// ---- client 装载 ----
let captured = null
globalThis.window = { __ModuleLoader__: { load(def) { captured = def } } }
await import('../src/client.js')
assert.ok(captured, 'client module captured')
assert.equal(captured.id, PACKAGE_NAME, 'client bundle id 必须与 PACKAGE_NAME 一致')

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (v) => [v, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: (fn) => fn(),
}
const plugin = captured.factory((name) => { if (name === 'react') return React; throw new Error(name) })
assert.ok(plugin.inject.includes('remote'))
assert.ok(plugin.inject.includes('slots'))
assert.ok(plugin.inject.includes('workspaces'), '归档判定需要 workspaces')
assert.ok(!plugin.inject.includes('remote.sessionReferenceResolver'), 'resolver no longer needed')

// 归档导航适配用的假 UiWorkspaceService：clearArchivedCurrent 在原型上，
// 与真实实现一致（补丁会以自有属性覆盖它）。
class FakeNavigation {
  constructor() { this.cleared = 0 }
  clearArchivedCurrent() { this.cleared += 1; return true }
}
const makeNavigation = () => new FakeNavigation()

const mounted = []
const registered = []
const sources = []
const favoritesNs = {
  list: () => Promise.resolve({ ok: true, value: [] }),
  add: () => Promise.resolve({ ok: true, value: [] }),
  unfavorite: () => Promise.resolve({ ok: true, value: [] }),
  rename: () => Promise.resolve({ ok: true, value: [] }),
}
let navigation = makeNavigation()
let archivedIds = []
const ctx = {
  get: (key) => (key === 'remote.favorites' ? favoritesNs : key === 'uiWorkspace' ? navigation : undefined),
  remote: { $mount: (c) => mounted.push(c) },
  sessions: { open: () => {}, list: { getSnapshot: () => ({ byId: {}, current: undefined }) } },
  workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: archivedIds }) } },
  layout: { selectPanel: () => {} },
  inputTriggers: { registerSource: (s) => { sources.push(s); return () => {} } },
  slots: { inject: (_k, cb) => cb(), register: (opts, comp) => { registered.push({ opts, comp }); return () => {} } },
  effect: (fn) => fn(),
  inject: (_keys, cb) => { cb(); return () => {} },
}
plugin.apply(ctx)
assert.equal(mounted.length, 1)
assert.deepEqual(mounted[0].descriptors.map(d => d.method), ['list', 'add', 'unfavorite', 'rename'])
assert.deepEqual(registered.map(r => r.opts.name), ['sidebar.footer.action', 'conversation.session.header.actions'])
assert.equal(sources.length, 1)
assert.equal(sources[0].trigger, '@')
assert.equal(sources[0].name, 'favorites')

// ---- footer 注入面：必须提供失效清理入口 ----
const footerFace = registered[0].opts.inject()
assert.equal(typeof footerFace.onOpen, 'function')
assert.equal(typeof footerFace.onRemove, 'function')
assert.equal(typeof footerFace.onRemoveMany, 'function', 'footer 面需提供批量移除（清理失效）')
assert.equal(typeof footerFace.onRename, 'function', 'footer 面需提供重命名')

// ---- openSession 对已删除会话必须静默跳过（sessions.open 会 fail loud） ----
let opened = []
const current = { id: undefined }
const guardCtx = {
  ...ctx,
  sessions: {
    open: (id) => { opened.push(id); current.id = id },
    list: { getSnapshot: () => ({ byId: { alive: {}, archived: {} }, current: current.id }) },
  },
  layout: { selectPanel: () => {} },
  slots: { inject: (_k, cb) => cb(), register: (opts, comp) => { registered.push({ opts, comp }); return () => {} } },
}
registered.length = 0
captured.factory((name) => { if (name === 'react') return React; throw new Error(name) }).apply(guardCtx)
const guardedOpen = registered[0].opts.inject().onOpen
assert.equal(guardedOpen('deleted-session'), '该会话已不存在，可点右侧删除清理', '失效会话应给出原因')
assert.deepEqual(opened, [], '失效会话不应触发 sessions.open')
assert.equal(guardedOpen('alive'), null, '存在的会话应正常打开')

// ---- B：归档会话可通过补丁打开，且只放行本次点击的那一个 id ----
archivedIds = ['archived']
opened = []
current.id = undefined
assert.equal(guardedOpen('archived'), null, '归档收藏应能打开')
assert.deepEqual(opened, ['archived'])
const patched = navigation.clearArchivedCurrent
// 补丁必须落在实例自身上（自有属性），否则 dispose 无法还原、也无法自证生效。
assert.notEqual(patched, FakeNavigation.prototype.clearArchivedCurrent, 'clearArchivedCurrent 应被覆盖')
assert.equal(patched(), false, '当前会话正是被放行的归档会话 → 不清理')
// 一旦当前会话换成别的会话，放行失效，恢复原生清理行为
current.id = 'alive'
navigation.clearArchivedCurrent()
assert.equal(navigation.cleared, 1, '非目标会话时应恢复原生 clearArchivedCurrent')
// 未归档会话不经过补丁放行路径
current.id = undefined
opened = []
assert.equal(guardedOpen('alive'), null)
assert.equal(navigation.cleared, 1, '非归档会话不应触发 clearArchivedCurrent')

// ---- B 降级：拿不到 uiWorkspace 时不得静默，必须回传原因 ----
// 原生语义：watchNavigation 会把归档的"当前会话"立刻清掉，所以未打补丁时
// 打开归档收藏必然留不住 —— 降级路径必须把这件事报出来。
const noNavCtx = {
  ...guardCtx,
  get: (key) => (key === 'remote.favorites' ? favoritesNs : undefined),
  sessions: {
    open: (id) => { opened.push(id); current.id = archivedIds.includes(id) ? undefined : id },
    list: { getSnapshot: () => ({ byId: { alive: {}, archived: {} }, current: current.id }) },
  },
}
registered.length = 0
opened = []
captured.factory((name) => { if (name === 'react') return React; throw new Error(name) }).apply(noNavCtx)
const degradedOpen = registered[0].opts.inject().onOpen
const failure = degradedOpen('archived')
assert.equal(typeof failure, 'string', '降级时必须给出可见原因而不是静默失败')
assert.equal(failure, '该会话已归档，当前 DSH 版本无法直接打开')
assert.equal(degradedOpen('alive'), null, '降级只影响归档会话，普通会话照常打开')

// ---- 启动竞态：uiWorkspace 在 apply 时可能还不存在（与 ui-workspace 无 inject 依赖） ----
// 这是「装了别的插件才打得开、不装就打不开」的真正原因：探测一次就永久降级。
// 服务稍后由 ui-workspace 的 apply 创建，插件必须等到它出现并补上补丁。
{
  const live = { current: undefined, byId: { alive: {}, arch: {} } }
  const liveSessions = {
    open: (id) => { live.current = id },
    clear: () => { live.current = undefined },
    list: { getSnapshot: () => ({ byId: live.byId, current: live.current }) },
  }
  const liveWorkspaces = { list: { getSnapshot: () => ({ archivedSessionIds: ['arch'] }) } }
  // 真实语义的 UiWorkspaceService：watchNavigation 会清掉归档的 current
  class LiveNavigation {
    clearArchivedCurrent() {
      const cur = liveSessions.list.getSnapshot().current
      if (cur === undefined || !liveWorkspaces.list.getSnapshot().archivedSessionIds.includes(cur)) return false
      liveSessions.clear()
      return true
    }
  }
  const liveNav = new LiveNavigation()
  let ready = false
  let lateInject = null
  const lateRegistered = []
  const lateCtx = {
    ...ctx,
    get: (key) => (key === 'remote.favorites' ? favoritesNs
      : key === 'uiWorkspace' ? (ready ? liveNav : undefined) : undefined),
    sessions: liveSessions,
    workspaces: liveWorkspaces,
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, comp) => { lateRegistered.push({ opts, comp }); return () => {} },
    },
    // Cordis 语义：服务首次可用时回调一次
    inject: (_keys, cb) => { lateInject = cb; return () => {} },
  }
  captured.factory((name) => { if (name === 'react') return React; throw new Error(name) }).apply(lateCtx)
  assert.equal(typeof lateInject, 'function', '应等待 uiWorkspace 服务出现')
  const lateOpen = lateRegistered[0].opts.inject().onOpen

  // 服务还没出现：归档会话必须明确报错，绝不能假装成功（否则就是"点了打不开还没提示"）
  assert.equal(lateOpen('arch'), '该会话已归档，当前 DSH 版本无法直接打开', '服务未就绪时应如实报错')
  assert.equal(live.current, undefined, '报错路径不得留下半开状态')
  // 普通会话不受影响
  assert.equal(lateOpen('alive'), null)

  // ui-workspace 的 apply 跑到了，服务出现 → 补丁必须补上
  ready = true
  lateInject()
  live.current = undefined
  assert.equal(lateOpen('arch'), null, '服务就绪后归档会话必须能打开')
  assert.equal(live.current, 'arch')
  // 随后的 watchNavigation 清理必须被拦下，否则归档会话会被立刻踢走
  assert.equal(liveNav.clearArchivedCurrent(), false, '放行的归档会话不得被清理')
  assert.equal(live.current, 'arch', '归档会话必须保持打开')
  // 非本次放行的归档会话仍应被原生清理（补丁不能永久失效）
  live.current = 'arch'
  lateOpen('alive')
  live.current = 'arch'
  assert.equal(liveNav.clearArchivedCurrent(), true, '非放行会话应恢复原生清理')
  assert.equal(live.current, undefined)
}

// ---- 重命名：走 DSH 官方 session.rename，成功后同步本地标题副本 ----
let renameCalls = []
let renameResult = { ok: true, value: { title: 'New', seq: 1 } }
const renameCtx = {
  ...guardCtx,
  sessions: {
    open: () => {},
    binding: (id) => (id === 'ghost' ? undefined : {
      session: {
        rename: (title) => { renameCalls.push([id, title]); return Promise.resolve(renameResult) },
      },
    }),
    list: { getSnapshot: () => ({ byId: { alive: {} }, current: undefined }) },
  },
}
let syncedTitles = []
renameCtx.get = (key) => (key === 'remote.favorites'
  ? { ...favoritesNs, rename: (id, title) => { syncedTitles.push([id, title]); return Promise.resolve({ ok: true, value: [] }) } }
  : key === 'uiWorkspace' ? navigation : undefined)
registered.length = 0
captured.factory((name) => { if (name === 'react') return React; throw new Error(name) }).apply(renameCtx)
const rename = registered[0].opts.inject().onRename

// 成功：先改 DSH 会话名，再同步本地副本（顺序不能反）
await rename('alive', '新标题')
assert.deepEqual(renameCalls, [['alive', '新标题']], '必须调用官方 session.rename')
assert.deepEqual(syncedTitles, [['alive', '新标题']], '成功后必须同步收藏标题副本')

// DSH 改名失败：整个操作必须失败，且**不得**同步本地副本（否则两边对不上）
renameCalls = []
syncedTitles = []
renameResult = { ok: false, error: { message: '标题被拒绝' } }
await assert.rejects(() => rename('alive', 'X'), /标题被拒绝/, '宿主拒绝时必须抛出原始原因')
assert.deepEqual(renameCalls, [['alive', 'X']])
assert.deepEqual(syncedTitles, [], 'DSH 改名失败时不得留下本地副本')

// 未知会话：与原生同样抛错
await assert.rejects(() => rename('ghost', 'X'), /unknown session/, '未知会话应抛错')

// 半失败：DSH 改名成功、本地副本同步失败 —— 不得把整体报成失败
// （DSH 才是事实来源；抛错会让用户以为没改成，而对话框还会停在打开态显示误导性错误）
renameCalls = []
syncedTitles = []
renameResult = { ok: true, value: { title: 'New', seq: 1 } }
const failingSyncCtx = {
  ...renameCtx,
  get: (key) => (key === 'remote.favorites'
    ? { ...favoritesNs, rename: () => Promise.resolve({ ok: false, error: new Error('network down') }) }
    : key === 'uiWorkspace' ? navigation : undefined),
}
registered.length = 0
captured.factory((name) => { if (name === 'react') return React; throw new Error(name) }).apply(failingSyncCtx)
const renameWithFailingSync = registered[0].opts.inject().onRename
await renameWithFailingSync('alive', '新标题')   // 不得抛错
assert.deepEqual(renameCalls, [['alive', '新标题']], 'DSH 侧仍应完成改名')

// ---- A：收藏行状态（正常 / 选中 / 已归档 / 已失效） ----
const { rowState, groupRows, GONE_HINT, ARCHIVED_HINT } = plugin.testing
const opts = { listReady: true, sessionsById: { alive: {}, arch: {} }, archivedIds: ['arch'], currentId: undefined }
assert.deepEqual(rowState({ sessionId: 'alive' }, opts), { gone: false, archived: false, selected: false, hint: undefined })
assert.deepEqual(rowState({ sessionId: 'arch' }, opts), { gone: false, archived: true, selected: false, hint: ARCHIVED_HINT })
assert.deepEqual(rowState({ sessionId: 'ghost' }, opts), { gone: true, archived: false, selected: false, hint: GONE_HINT })
// 已失效优先于已归档：会话都没了就不该再显示归档标记
assert.deepEqual(
  rowState({ sessionId: 'ghost' }, { ...opts, archivedIds: ['ghost'] }),
  { gone: true, archived: false, selected: false, hint: GONE_HINT },
)
// 列表未就绪时不得误判为失效（否则启动瞬间整列标灰）
assert.equal(rowState({ sessionId: 'ghost' }, { ...opts, listReady: false }).gone, false)

// ---- 选中态：与原生侧边栏同源（list.current），逐行精确匹配 ----
const sel = { ...opts, currentId: 'alive' }
assert.equal(rowState({ sessionId: 'alive' }, sel).selected, true, '当前会话应选中')
assert.equal(rowState({ sessionId: 'arch' }, sel).selected, false, '非当前会话不应选中')
assert.equal(rowState({ sessionId: 'ghost' }, sel).selected, false)
// 打开收藏夹里的会话后，该行立即变为选中
current.id = undefined
assert.equal(guardedOpen('alive'), null)
assert.equal(rowState({ sessionId: 'alive' }, { ...opts, currentId: current.id }).selected, true, '打开后该行应选中')
// 归档会话经补丁打开后同样标记选中
current.id = undefined
assert.equal(guardedOpen('archived'), null)
assert.equal(rowState({ sessionId: 'archived' }, { ...opts, currentId: current.id }).selected, true, '归档会话打开后也应选中')

// ---- 按工作区分组 ----
const grouped = groupRows(
  [{ sessionId: 'a', workspaceId: 'w1' }, { sessionId: 'b', workspaceId: 'gone' }, { sessionId: 'c' }],
  [{ workspaceId: 'w1', title: 'W1' }],
)
assert.deepEqual(grouped.map(g => [g.title, g.rows.map(r => r.sessionId)]), [['W1', ['a']], ['未分组', ['b', 'c']]])

// ---- A：归档行需要「已归档」标记的数据通路 ----
const footerComp = registered[0].comp
assert.equal(typeof footerComp, 'function')

// ---- 移除收藏必须经过确认对话框（防误删），而不是一次点击就生效 ----
// 用一个最小的"会重渲染"的 React：记录 hook 单元，setState 后同步重跑组件，
// 从而真的走到"点行内按钮 → 弹出确认框 → 点确认才删除"这条路径。
function makeStatefulReact() {
  const cells = []
  let cursor = 0
  let rerender = null
  let rendering = false
  const react = {
    // 函数组件必须真正求值，否则 flatten 只能看到 {type: Dialog} 元素描述、
    // 看不到对话框内部 —— 那样"有没有弹确认框"就断言不出来。
    createElement: (type, props, ...children) => {
      const el = { type, props: props ?? {}, children }
      if (typeof type === 'function') return type(el.props, el.children)
      return el
    },
    useState: (initial) => {
      const i = cursor++
      if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial
      return [cells[i], (next) => {
        cells[i] = typeof next === 'function' ? next(cells[i]) : next
        if (!rendering) rerender?.()
      }]
    },
    // 弹出层打开前要量入口按钮的位置；给 ref 一个假的 DOM 节点。
    useRef: (v) => {
      const i = cursor++
      cells[i] ??= {
        current: v ?? { getBoundingClientRect: () => ({ left: 12, top: 700, bottom: 736, width: 200, height: 36 }) },
      }
      return cells[i]
    },
    // 必须真的执行：弹出层依赖 useLayoutEffect 测位置后才锚定渲染。
    useEffect: (fn) => { cursor++; fn?.() },
    useLayoutEffect: (fn) => { cursor++; fn?.() },
    useMemo: (fn) => fn(),
    Fragment: 'Fragment',
  }
  // 返回一个渲染器：调用它渲染并返回当前树；setState 后会同步重渲染。
  react.__render = (fn) => {
    let current
    const draw = () => {
      cursor = 0
      rendering = true
      current = fn()
      rendering = false
    }
    rerender = draw
    draw()
    return () => current
  }
  return react
}

// 收集渲染树里所有节点（含嵌套 children），用于按 aria-label 定位按钮。
function flatten(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const n of node) flatten(n, out); return out }
  out.push(node)
  for (const c of node.children ?? []) flatten(c, out)
  return out
}
const findByLabel = (node, label) => flatten(node).find(n => n.props?.['aria-label'] === label)

const removedViaUi = []
const store = { rows: [{ sessionId: 'alive', title: 'A' }], byId: new Map([['alive', {}]]), ready: true, error: null }
const rowCtx = {
  ...ctx,
  sessions: { open: () => {}, list: { getSnapshot: () => ({ byId: { alive: {} }, current: undefined }) } },
  slots: { inject: (_k, cb) => cb(), register: (opts, comp) => { registered.push({ opts, comp }); return () => {} } },
}
registered.length = 0
const stateful = makeStatefulReact()
captured.factory((name) => {
  if (name === 'react' || name === 'react-dom') return stateful
  throw new Error(name)
}).apply(rowCtx)
const rowComp = registered[0].comp

const props = {
  wide: true,
  useFavorites: (sel) => sel(store),
  useSessions: (sel) => sel({ byId: { alive: { displayTitle: 'A' } }, current: undefined, phase: 'ready' }),
  useWorkspaces: (sel) => sel({ items: [], archivedSessionIds: [] }),
  onOpen: () => null,
  onRemove: (id) => { removedViaUi.push(id); return Promise.resolve() },
  onRemoveMany: (ids) => { removedViaUi.push(`many:${ids.length}`); return Promise.resolve() },
  onRename: () => Promise.resolve(),
}
// 弹出层用 useLayoutEffect 量位置，对话框在 document 上监听 Escape；补最小实现。
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  body: {},
  // 样式注入会先查重；返回 null 表示"尚未注入"。
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: () => {} },
}
globalThis.window = {
  __ModuleLoader__: globalThis.window.__ModuleLoader__,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
}

const read = stateful.__render(() => rowComp(props))
// 弹出层默认关闭：先点入口打开它
findByLabel(read(), '收藏夹').props.onClick()
let view = read()
const removeBtn = findByLabel(view, '移除收藏')
assert.ok(removeBtn, '弹出层打开后行内应有"移除收藏"按钮')

// 第一次点击：只允许打开确认框，绝不能直接删
removeBtn.props.onClick({ stopPropagation: () => {} })
view = read()
assert.deepEqual(removedViaUi, [], '点击移除不得直接删除，必须先弹确认框')
assert.equal(findByLabel(view, '移除收藏') !== undefined, true)
// 确认框必须真的出现，且标题是「移除收藏」
const dialog = flatten(view).find(n => n.props?.role === 'dialog')
assert.ok(dialog, '应弹出确认对话框')
assert.equal(dialog.props['aria-label'], '移除收藏', '确认框标题应为「移除收藏」')
assert.ok(flatten(dialog).some(n => n.children?.[0] === '取消'), '确认框必须有取消按钮')

// 点取消：不得删除任何东西，且确认框关闭
findByLabel(dialog, '关闭').props.onClick()
view = read()
assert.deepEqual(removedViaUi, [], '取消后不得删除')
assert.equal(flatten(view).find(n => n.props?.role === 'dialog'), undefined, '取消后确认框应关闭')

// 再走一遍并点确认：这时才真正删除，且只删这一个 id
findByLabel(view, '移除收藏').props.onClick({ stopPropagation: () => {} })
const dialog2 = flatten(read()).find(n => n.props?.role === 'dialog')
assert.ok(dialog2, '确认框应再次出现')
const danger = flatten(dialog2)
  .find(n => n.type === 'button' && n.children?.[0] === '移除收藏')
assert.ok(danger, '确认框应有「移除收藏」确认按钮')
danger.props.onClick()
await new Promise(r => setTimeout(r, 0))
assert.deepEqual(removedViaUi, ['alive'], '确认后应只移除被确认的那一条')

// ---- @ 源：本地过滤 + 官方等价的 mention 编码 ----
const row = { sessionId: 'source', title: 'Research', favoritedAt: 1 }
// 让 favorites.list 返回该行，重跑一次 apply 以拿到"有数据"的 @ 源
favoritesNs.list = () => Promise.resolve({ ok: true, value: [row] })
const applied = []
const liveCtx = { ...ctx, inputTriggers: { registerSource: (s) => { applied.push(s); return () => {} } } }
captured.factory((name) => { if (name === 'react') return React; throw new Error(name) }).apply(liveCtx)
await new Promise(r => setTimeout(r, 0))   // 等 $mount → refresh 落地
const live = applied[0]
const all = await live.candidates({ sessionId: 's' }, { query: '', signal: new AbortController().signal })
assert.equal(all.length, 1)
assert.equal(all[0].label, 'Research')
assert.equal(all[0].section, 'favorites')
// 分组置顶：order 必须低于已发布的 reference(0) 与 cordis(1)
assert.equal(live.order < 0, true, 'favorites 应排在 reference(0)/cordis(1) 之前')
// 官方样例：id "source" 的 mention 断言
assert.equal(all[0].value.includes('@[Research](dsh-session:InNvdXJjZSI)'), true)
const none = await live.candidates({ sessionId: 's' }, { query: 'zzz', signal: new AbortController().signal })
assert.equal(none.length, 0)
const picked = live.onPick({ candidate: all[0] })
assert.equal(picked.insert.appearance, 'session')
assert.equal(picked.insert.ref, '@[Research](dsh-session:InNvdXJjZSI)')

console.log('SMOKE OK')
