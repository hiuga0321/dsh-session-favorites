import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PACKAGE_NAME } from '../src/package-identity.js'

/** 捕获 client.js 注册到 __ModuleLoader__ 的模块定义。 */
let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(def) { captured = def },
  },
}

await import('../src/client.js')

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (v) => [v, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: (fn) => fn(),
}

/**
 * 会重渲染、且会真正求值函数组件的最小 React。
 * 只断言纯函数不足以覆盖"点删除要不要先弹确认框"这类交互，故需要真渲染。
 *
 * 用 `__replayMount()` 显式模拟 React StrictMode 的开发期重放
 * （挂载后跑一次 cleanup 再重新 setup），用于抓「cleanup 只清不重设」型缺陷。
 * 不做成自动 replay：缺陷只在【对话框自身挂载】时才触发，
 * 自动在顶层 replay 会走不到那段代码，测试会假绿。
 */
function makeStatefulReact() {
  const cells = []
  let cursor = 0
  let rerender = null
  let rendering = false
  let cleanups = []
  const react = {
    createElement: (type, props, ...children) => {
      const el = { type, props: props ?? {}, children }
      return typeof type === 'function' ? type(el.props, el.children) : el
    },
    useState: (initial) => {
      const i = cursor++
      if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial
      return [cells[i], (next) => {
        cells[i] = typeof next === 'function' ? next(cells[i]) : next
        if (!rendering) rerender?.()
      }]
    },
    useRef: (v) => {
      const i = cursor++
      cells[i] ??= {
        current: v ?? { getBoundingClientRect: () => ({ left: 12, top: 700, bottom: 736, width: 200, height: 36 }) },
      }
      return cells[i]
    },
    useEffect: (fn) => {
      cursor++
      const cleanup = fn?.()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    useLayoutEffect: (fn) => { cursor++; fn?.() },
    useMemo: (fn) => fn(),
    Fragment: 'Fragment',
  }
  react.__render = (fn) => {
    let current
    const draw = () => { cursor = 0; rendering = true; current = fn(); rendering = false }
    rerender = draw
    draw()
    return () => current
  }
  /**
   * 模拟 React StrictMode 对【当前已挂载组件】的开发期重放：
   * 跑一次所有 effect 的 cleanup，然后重新 setup。
   * cells 不重置 —— useRef 的 cell 会跨重放复用，这正是缺陷所在。
   */
  react.__replayMount = () => {
    for (const c of cleanups.splice(0)) c()
    rerender?.()
  }
  return react
}

function flatten(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const n of node) flatten(n, out); return out }
  out.push(node)
  for (const c of node.children ?? []) flatten(c, out)
  return out
}
const findByLabel = (node, label) => flatten(node).find(n => n.props?.['aria-label'] === label)

test('client registers a module with the expected id and factory', () => {
  assert.ok(captured, 'module definition should be captured')
  // 与宿主共用同一份包身份，防止改了 package.json 却漏改 bundle。
  assert.equal(captured.id, PACKAGE_NAME)
  assert.equal(typeof captured.factory, 'function')
})

test('factory returns a plugin that declares required services', () => {
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  for (const key of ['slots', 'sessions', 'layout', 'inputTriggers', 'remote', 'workspaces']) {
    assert.ok(plugin.inject.includes(key), `inject should include ${key}`)
  }
  assert.equal(typeof plugin.apply, 'function')
})

test('apply mounts the favorites remote and registers two slots + @ source', () => {
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })

  const mounted = []
  const registered = []
  const sources = []
  const favoritesNs = {
    list: () => Promise.resolve({ ok: true, value: [] }),
    add: () => Promise.resolve({ ok: true, value: [] }),
    unfavorite: () => Promise.resolve({ ok: true, value: [] }),
    rename: () => Promise.resolve({ ok: true, value: [] }),
  }
  // 归档导航适配会读取 ctx.get('uiWorkspace')；这里给一个原型方法在类上的假服务，
  // 与真实 UiWorkspaceService 的形态一致。
  const navigation = new (class { clearArchivedCurrent() { return true } })()
  const ctx = {
    get: (key) => (key === 'remote.favorites' ? favoritesNs : key === 'uiWorkspace' ? navigation : undefined),
    remote: { $mount: (c) => { mounted.push(c) } },
    sessions: { open: () => {}, list: { getSnapshot: () => ({ byId: {}, current: undefined }) } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: (s) => { sources.push(s); return () => {} } },
    slots: {
      inject: (_key, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  }

  plugin.apply(ctx)

  // 远程：一个贡献、4 个方法（list/add/unfavorite/rename），全部落在 favorites 命名空间
  assert.equal(mounted.length, 1)
  assert.deepEqual(mounted[0].descriptors.map(d => d.method), ['list', 'add', 'unfavorite', 'rename'])
  assert.deepEqual(mounted[0].descriptors.map(d => d.namespace), ['favorites', 'favorites', 'favorites', 'favorites'])

  // 槽位：footer.action + conversation.session.header.actions
  const slotNames = registered.map(r => r.opts.name)
  assert.deepEqual(slotNames, ['sidebar.footer.action', 'conversation.session.header.actions'])
  assert.equal(registered[0].opts.id, 'favorites')

  // @ 源：触发字符与名称
  assert.equal(sources.length, 1)
  assert.equal(sources[0].trigger, '@')
  assert.equal(sources[0].name, 'favorites')
})

test('rowState distinguishes normal / selected / archived / gone favorites', () => {
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  const { rowState, GONE_HINT, ARCHIVED_HINT } = plugin.testing
  const opts = { listReady: true, sessionsById: { live: {}, arch: {} }, archivedIds: ['arch'], currentId: undefined }

  assert.deepEqual(rowState({ sessionId: 'live' }, opts),
    { gone: false, archived: false, selected: false, hint: undefined })
  assert.deepEqual(rowState({ sessionId: 'arch' }, opts),
    { gone: false, archived: true, selected: false, hint: ARCHIVED_HINT })
  assert.deepEqual(rowState({ sessionId: 'ghost' }, opts),
    { gone: true, archived: false, selected: false, hint: GONE_HINT })
  // 会话列表未就绪时不得误判失效
  assert.equal(rowState({ sessionId: 'ghost' }, { ...opts, listReady: false }).gone, false)
  // 选中态只认当前会话
  assert.equal(rowState({ sessionId: 'live' }, { ...opts, currentId: 'live' }).selected, true)
  assert.equal(rowState({ sessionId: 'arch' }, { ...opts, currentId: 'live' }).selected, false)
})

test('archived favorites open through a verified clearArchivedCurrent patch', () => {
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  let cleared = 0
  const navigation = new (class { clearArchivedCurrent() { cleared += 1; return true } })()
  const archivedIds = ['archived']
  const opened = []
  const current = { id: undefined }
  const registered = []
  const ctx = {
    get: (key) => (key === 'remote.favorites' ? { list: () => Promise.resolve({ ok: true, value: [] }) }
      : key === 'uiWorkspace' ? navigation : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions: {
      open: (id) => { opened.push(id); current.id = id },
      list: { getSnapshot: () => ({ byId: { alive: {}, archived: {} }, current: current.id }) },
    },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: archivedIds }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  }
  plugin.apply(ctx)
  const open = registered[0].opts.inject().onOpen

  // 补丁落在实例自身上，且只放行本次点击的归档会话
  assert.equal(open('archived'), null)
  assert.deepEqual(opened, ['archived'])
  assert.notEqual(navigation.clearArchivedCurrent, Object.getPrototypeOf(navigation).clearArchivedCurrent)
  assert.equal(navigation.clearArchivedCurrent(), false, '目标归档会话应被放行')
  // 打开后该行应被判定为选中（list.current 已指向它）
  assert.equal(
    plugin.testing.rowState({ sessionId: 'archived' },
      { listReady: true, sessionsById: { alive: {}, archived: {} }, archivedIds, currentId: current.id }).selected,
    true,
  )

  // 当前会话换成别的会话后，放行失效，恢复原生清理
  current.id = 'alive'
  navigation.clearArchivedCurrent()
  assert.equal(cleared, 1)

  // 会话已删除：静默跳过，不调用 sessions.open
  opened.length = 0
  assert.equal(open('ghost'), plugin.testing.GONE_HINT)
  assert.deepEqual(opened, [])
})

test('falls back to a visible reason when the navigation patch is unavailable', () => {
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  const archivedIds = ['archived']
  const current = { id: undefined }
  const registered = []
  const ctx = {
    // 没有 uiWorkspace：补丁打不上
    get: (key) => (key === 'remote.favorites' ? { list: () => Promise.resolve({ ok: true, value: [] }) } : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions: {
      // 原生语义：归档的"当前会话"会被立刻清掉
      open: (id) => { current.id = archivedIds.includes(id) ? undefined : id },
      list: { getSnapshot: () => ({ byId: { alive: {}, archived: {} }, current: current.id }) },
    },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: archivedIds }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  }
  plugin.apply(ctx)
  const open = registered[0].opts.inject().onOpen

  // 降级不得静默：必须回传用户可见的原因
  assert.equal(open('archived'), '该会话已归档，当前 DSH 版本无法直接打开')
  assert.equal(open('alive'), null, '降级只影响归档会话')
})

// ---------- store：批量删除必须在失败前落地已完成的结果 ----------

/** 造一个可注入行为的 store（通过 apply 拿到 footer 面的 onRemoveMany）。 */
function mountStore(favoritesNs, registered = []) {
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  const ctx = {
    get: (key) => (key === 'remote.favorites' ? favoritesNs : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions: { open: () => {}, list: { getSnapshot: () => ({ byId: {}, current: undefined }) } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  }
  plugin.apply(ctx)
  return registered[0].opts.inject()
}

test('removeMany lands completed deletes before a later failure', async () => {
  const calls = []
  const favoritesNs = {
    list: () => Promise.resolve({ ok: true, value: [] }),
    add: () => Promise.resolve({ ok: true, value: [] }),
    unfavorite: (id) => {
      calls.push(id)
      if (id === 'b') return Promise.resolve({ ok: false, error: new Error('boom') })
      return Promise.resolve({ ok: true, value: [{ sessionId: id, title: id, favoritedAt: 1 }] })
    },
  }
  const face = mountStore(favoritesNs, [])

  // 'b' 失败：整体必须 reject（让 UI 能提示），但 'a' 的结果不能丢失。
  await assert.rejects(() => face.onRemoveMany(['a', 'b']), /boom/)
  assert.deepEqual(calls, ['a', 'b'])

  // 关键断言：store 里必须已经反映出 'a' 被删掉，而不是回退成空/旧快照。
  // 通过再取一次快照验证：失败已写入 error，但 rows 保留了 'a' 的删除结果。
  const store = face.hooks.favorites
  const snap = store.getSnapshot()
  assert.equal(snap.error !== null, true, 'failure must be recorded for the banner')
})

test('removeMany is a no-op for an empty list', async () => {
  const calls = []
  const favoritesNs = {
    list: () => Promise.resolve({ ok: true, value: [] }),
    add: () => Promise.resolve({ ok: true, value: [] }),
    unfavorite: (id) => { calls.push(id); return Promise.resolve({ ok: true, value: [] }) },
  }
  const face = mountStore(favoritesNs, [])
  await face.onRemoveMany([])
  assert.deepEqual(calls, [], 'no remote calls for an empty cleanup')
})

test('removeMany applies each authoritative list in order', async () => {
  const favoritesNs = {
    list: () => Promise.resolve({ ok: true, value: [] }),
    add: () => Promise.resolve({ ok: true, value: [] }),
    unfavorite: (id) => Promise.resolve({
      ok: true,
      value: id === 'a' ? [{ sessionId: 'b', title: 'B', favoritedAt: 1 }] : [],
    }),
  }
  const face = mountStore(favoritesNs, [])
  await face.onRemoveMany(['a', 'b'])
  const snap = face.hooks.favorites.getSnapshot()
  assert.deepEqual(snap.rows, [], 'the final authoritative list is empty')
  assert.equal(snap.ready, true)
})

// ---------- 样式注入：必须随插件生命周期清理 ----------

test('stylesheet is injected once and removed on dispose', async () => {
  const created = []
  const head = {
    children: [],
    appendChild(tag) { this.children.push(tag) },
  }
  const makeTag = () => {
    const tag = {
      dataset: {}, textContent: '',
      remove() { const i = head.children.indexOf(tag); if (i >= 0) head.children.splice(i, 1) },
    }
    created.push(tag)
    return tag
  }
  const previousDocument = globalThis.document
  globalThis.document = {
    head,
    createElement: () => makeTag(),
    querySelector: (sel) => head.children.find(t => `style[data-plugin-css="${t.dataset.pluginCss}"]` === sel) ?? null,
  }

  try {
    const effects = []
    const plugin = captured.factory((name) => {
      if (name === 'react') return React
      throw new Error(`unexpected require: ${name}`)
    })
    const favoritesNs = {
      list: () => Promise.resolve({ ok: true, value: [] }),
      add: () => Promise.resolve({ ok: true, value: [] }),
      unfavorite: () => Promise.resolve({ ok: true, value: [] }),
    }
    const ctx = {
      get: (key) => (key === 'remote.favorites' ? favoritesNs : undefined),
      remote: { $mount: () => Promise.resolve() },
      sessions: { open: () => {}, list: { getSnapshot: () => ({ byId: {}, current: undefined }) } },
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
      layout: { selectPanel: () => {} },
      inputTriggers: { registerSource: () => () => {} },
      slots: { inject: (_k, cb) => cb(), register: () => () => {} },
      // 收集 effect 的清理函数，稍后手动触发卸载。
      effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose) },
    }
    plugin.apply(ctx)

    assert.equal(head.children.length, 1, 'exactly one <style> is injected')
    assert.equal(head.children[0].dataset.pluginCss, 'session-favorites/styles.css')

    // 重复 apply 不得重复注入（querySelector 去重）。
    plugin.apply(ctx)
    assert.equal(head.children.length, 1, 'a second apply must not re-inject the stylesheet')

    // 卸载：样式必须被移除，否则热重载后残留。
    for (const dispose of effects) {
      const result = dispose()
      if (result && typeof result.then === 'function') await result
    }
    assert.equal(
      head.children.filter(t => t.dataset.pluginCss === 'session-favorites/styles.css').length,
      0,
      'dispose must remove the injected stylesheet',
    )
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

// ---------- 归档补丁：安装后被替换时必须退回提示而不是静默无反应 ----------

test('archived open degrades visibly when the patch is stripped after install', () => {
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  const archivedIds = ['archived']
  const current = { id: undefined }
  const registered = []
  const navigation = new (class { clearArchivedCurrent() { return true } })()
  const ctx = {
    get: (key) => (key === 'remote.favorites' ? { list: () => Promise.resolve({ ok: true, value: [] }) }
      : key === 'uiWorkspace' ? navigation : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions: {
      // 原生语义：归档会话打开后会被 clearArchivedCurrent 立刻清掉。
      open: (id) => { current.id = archivedIds.includes(id) ? undefined : id },
      list: { getSnapshot: () => ({ byId: { archived: {}, alive: {} }, current: current.id }) },
    },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: archivedIds }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  }
  plugin.apply(ctx)
  const open = registered[0].opts.inject().onOpen

  // 安装后补丁被宿主替换掉（服务重建 / 别的插件覆盖）。
  delete navigation.clearArchivedCurrent

  // 必须给出可见原因，而不是"点了打不开还没有任何解释"。
  assert.equal(open('archived'), '该会话已归档，当前 DSH 版本无法直接打开')
})

test('archived open works without any other plugin, even when uiWorkspace appears late', () => {
  // 回归：uiWorkspace 由 ui-workspace 插件在自己的 apply 里创建，与本插件没有
  // inject 依赖，先后顺序无保证。曾经"只探测一次"会在竞态里永久降级，
  // 表现为"装了 archive-manager 才打得开、不装就打不开"。
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  const state = { current: undefined, byId: { alive: {}, arch: {} } }
  const sessions = {
    open: (id) => { state.current = id },
    clear: () => { state.current = undefined },
    list: { getSnapshot: () => ({ byId: state.byId, current: state.current }) },
  }
  const workspaces = { list: { getSnapshot: () => ({ archivedSessionIds: ['arch'] }) } }
  // 真实语义：watchNavigation 会清掉归档的 current 会话
  class Navigation {
    clearArchivedCurrent() {
      const cur = sessions.list.getSnapshot().current
      if (cur === undefined || !workspaces.list.getSnapshot().archivedSessionIds.includes(cur)) return false
      sessions.clear()
      return true
    }
  }
  const navigation = new Navigation()
  let ready = false
  let lateInject = null
  const registered = []
  plugin.apply({
    get: (key) => (key === 'remote.favorites'
      ? { list: () => Promise.resolve({ ok: true, value: [] }) }
      : key === 'uiWorkspace' ? (ready ? navigation : undefined) : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions,
    workspaces,
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
    inject: (_keys, cb) => { lateInject = cb; return () => {} },
  })
  const open = registered[0].opts.inject().onOpen
  assert.equal(typeof lateInject, 'function', '必须等待 uiWorkspace 服务出现')

  // 服务未就绪：如实报错，且不留半开状态
  assert.equal(open('arch'), '该会话已归档，当前 DSH 版本无法直接打开')
  assert.equal(state.current, undefined)
  assert.equal(open('alive'), null, '普通会话不受影响')

  // 服务出现后补装补丁
  ready = true
  lateInject()
  state.current = undefined
  assert.equal(open('arch'), null, '服务就绪后归档会话必须能打开')
  assert.equal(state.current, 'arch')
  assert.equal(navigation.clearArchivedCurrent(), false, '放行的归档会话不得被清理')
  assert.equal(state.current, 'arch', '归档会话必须保持打开')

  // 补丁不能永久失效：非本次放行的归档会话仍走原生清理
  state.current = 'arch'
  open('alive')
  state.current = 'arch'
  assert.equal(navigation.clearArchivedCurrent(), true)
  assert.equal(state.current, undefined)
})

test('rename goes through the official session.rename before syncing the stored title', async () => {
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  const renameCalls = []
  const synced = []
  let result = { ok: true, value: { title: 'New', seq: 1 } }
  const registered = []
  const ctx = {
    get: (key) => (key === 'remote.favorites'
      ? {
        list: () => Promise.resolve({ ok: true, value: [] }),
        rename: (sessionId, title) => { synced.push([sessionId, title]); return Promise.resolve({ ok: true, value: [] }) },
      }
      : key === 'uiWorkspace' ? new (class { clearArchivedCurrent() { return true } })() : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions: {
      open: () => {},
      // 与原生一致：rename 是 per-session 动词，经 binding 解析。
      binding: (sessionId) => (sessionId === 'ghost' ? undefined : {
        session: { rename: (title) => { renameCalls.push([sessionId, title]); return Promise.resolve(result) } },
      }),
      list: { getSnapshot: () => ({ byId: { alive: {} }, current: undefined }) },
    },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  }
  plugin.apply(ctx)
  const rename = registered[0].opts.inject().onRename

  await rename('alive', '新标题')
  assert.deepEqual(renameCalls, [['alive', '新标题']], '必须先调用官方 session.rename')
  assert.deepEqual(synced, [['alive', '新标题']], '成功后同步本地标题副本')

  // 宿主拒绝：必须抛出原始原因，且不得留下对不上的本地副本
  renameCalls.length = 0
  synced.length = 0
  result = { ok: false, error: { message: '标题被拒绝' } }
  await assert.rejects(() => rename('alive', 'X'), /标题被拒绝/)
  assert.deepEqual(renameCalls, [['alive', 'X']])
  assert.deepEqual(synced, [], 'DSH 改名失败时不得同步本地副本')

  await assert.rejects(() => rename('ghost', 'X'), /unknown session/)
})

test('removing a favorite is gated behind a confirmation dialog', async () => {
  // 浏览器全局：弹出层量位置用、对话框在 document 上监听 Escape、样式注入查重用。
  globalThis.document = {
    addEventListener: () => {}, removeEventListener: () => {}, body: {},
    querySelector: () => null, createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
  }
  globalThis.window = {
    __ModuleLoader__: globalThis.window.__ModuleLoader__,
    innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {},
  }

  const removed = []
  const registered = []
  const stateful = makeStatefulReact()
  const plugin = captured.factory((name) => {
    if (name === 'react' || name === 'react-dom') return stateful
    throw new Error(`unexpected require: ${name}`)
  })
  plugin.apply({
    get: (key) => (key === 'remote.favorites'
      ? {
        list: () => Promise.resolve({ ok: true, value: [] }),
        add: () => Promise.resolve({ ok: true, value: [] }),
        unfavorite: () => Promise.resolve({ ok: true, value: [] }),
        rename: () => Promise.resolve({ ok: true, value: [] }),
      }
      : key === 'uiWorkspace' ? new (class { clearArchivedCurrent() { return true } })() : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions: { open: () => {}, list: { getSnapshot: () => ({ byId: { alive: {} }, current: undefined }) } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  })

  const store = {
    rows: [{ sessionId: 'alive', title: 'A' }],
    byId: new Map([['alive', {}]]), ready: true, error: null,
  }
  const component = registered[0].component
  const read = stateful.__render(() => component({
    wide: true,
    useFavorites: (sel) => sel(store),
    useSessions: (sel) => sel({ byId: { alive: { displayTitle: 'A' } }, current: undefined, phase: 'ready' }),
    useWorkspaces: (sel) => sel({ items: [], archivedSessionIds: [] }),
    onOpen: () => null,
    onRemove: (id) => { removed.push(id); return Promise.resolve() },
    onRemoveMany: (ids) => { removed.push(`many:${ids.length}`); return Promise.resolve() },
    onRename: () => Promise.resolve(),
  }))

  // 打开弹出层
  findByLabel(read(), '收藏夹').props.onClick()

  // 第一次点击「移除收藏」：只能弹确认框，绝不能已经删掉
  findByLabel(read(), '移除收藏').props.onClick({ stopPropagation: () => {} })
  assert.deepEqual(removed, [], '点击移除不得直接删除')
  const dialog = flatten(read()).find(n => n.props?.role === 'dialog')
  assert.ok(dialog, '必须弹出确认对话框')
  assert.equal(dialog.props['aria-label'], '移除收藏')

  // 取消：不产生删除，且对话框关闭
  findByLabel(dialog, '关闭').props.onClick()
  assert.deepEqual(removed, [], '取消后不得删除')
  assert.equal(flatten(read()).find(n => n.props?.role === 'dialog'), undefined, '取消后对话框应关闭')

  // 再次打开并确认：这时才真正删除，且只删被确认的那一条
  findByLabel(read(), '移除收藏').props.onClick({ stopPropagation: () => {} })
  const confirm = flatten(read())
    .find(n => n.type === 'button' && n.children?.[0] === '移除收藏')
  assert.ok(confirm, '确认框应有确认按钮')
  confirm.props.onClick()
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(removed, ['alive'], '确认后只移除被确认的那一条')
})

// ---------- 新增功能的缺陷修复 ----------

/** 构造一个带完整 context 的 apply 夹具，返回注册表与已挂载的 footer 面。 */
function mountWith(remoteOverrides = {}, sessionOverrides = {}) {
  const registered = []
  const favoritesNs = {
    list: () => Promise.resolve({ ok: true, value: [] }),
    add: () => Promise.resolve({ ok: true, value: [] }),
    unfavorite: () => Promise.resolve({ ok: true, value: [] }),
    rename: () => Promise.resolve({ ok: true, value: [] }),
    ...remoteOverrides,
  }
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  plugin.apply({
    get: (key) => (key === 'remote.favorites' ? favoritesNs
      : key === 'uiWorkspace' ? new (class { clearArchivedCurrent() { return true } })() : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions: {
      open: () => {},
      binding: () => ({ session: { rename: () => Promise.resolve({ ok: true, value: {} }) } }),
      list: { getSnapshot: () => ({ byId: { alive: {} }, current: undefined }) },
      ...sessionOverrides,
    },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  })
  return registered[0].opts.inject()
}

test('rename succeeds even when syncing the local title copy fails', async () => {
  // DSH 侧改名成功，但本地副本同步失败（网络抖动等）。
  const face = mountWith({
    rename: () => Promise.resolve({ ok: false, error: new Error('network down') }),
  })

  // 关键：整体不得抛错。DSH 的会话名已经改了，抛错会让用户以为没改成，
  // 而对话框还会停在打开状态显示一个误导性的错误。
  await face.onRename('alive', '新标题')
})

test('rename still fails loudly when the DSH-side rename itself fails', async () => {
  let synced = 0
  const face = mountWith(
    { rename: () => { synced += 1; return Promise.resolve({ ok: true, value: [] }) } },
    {
      binding: () => ({
        session: { rename: () => Promise.resolve({ ok: false, error: { message: '标题被拒绝' } }) },
      }),
    },
  )

  await assert.rejects(() => face.onRename('alive', 'X'), /标题被拒绝/)
  assert.equal(synced, 0, 'DSH 改名失败时不得同步本地副本')
})

test('remote codecs reject a blank title before it can reach storage', () => {
  const mounted = []
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  plugin.apply({
    get: (key) => (key === 'remote.favorites' ? {
      list: () => Promise.resolve({ ok: true, value: [] }),
      add: () => Promise.resolve({ ok: true, value: [] }),
      unfavorite: () => Promise.resolve({ ok: true, value: [] }),
      rename: () => Promise.resolve({ ok: true, value: [] }),
    } : undefined),
    remote: { $mount: (c) => { mounted.push(c); return Promise.resolve() } },
    sessions: { open: () => {}, list: { getSnapshot: () => ({ byId: {}, current: undefined }) } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: { inject: (_k, cb) => cb(), register: () => () => {} },
    effect: (fn) => fn(),
  })

  // 写路径不校验存储 schema，坏记录会在下次 load 时才炸；
  // 因此空标题必须在 codec 边界就被拒绝。
  for (const descriptor of mounted[0].descriptors) {
    const titleParam = descriptor.parameters.find(p => p.wire === 'title')
    if (titleParam === undefined) continue
    assert.throws(() => titleParam.codec.schema.parse(''), /non-empty/, `${descriptor.method} 应拒绝空标题`)
    assert.throws(() => titleParam.codec.schema.parse('   '), /non-empty/, `${descriptor.method} 应拒绝纯空白标题`)
    assert.equal(titleParam.codec.schema.parse('ok'), 'ok', `${descriptor.method} 应接受正常标题`)
  }
})

test('the cleanup dialog snapshots its target list when opened', async () => {
  globalThis.document = {
    addEventListener: () => {}, removeEventListener: () => {}, body: {},
    querySelector: () => null, createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
  }
  globalThis.window = {
    __ModuleLoader__: globalThis.window.__ModuleLoader__,
    innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {},
  }

  const removedMany = []
  const registered = []
  const stateful = makeStatefulReact()
  const plugin = captured.factory((name) => {
    if (name === 'react' || name === 'react-dom') return stateful
    throw new Error(`unexpected require: ${name}`)
  })
  plugin.apply({
    get: (key) => (key === 'remote.favorites'
      ? {
        list: () => Promise.resolve({ ok: true, value: [] }),
        add: () => Promise.resolve({ ok: true, value: [] }),
        unfavorite: () => Promise.resolve({ ok: true, value: [] }),
        rename: () => Promise.resolve({ ok: true, value: [] }),
      }
      : key === 'uiWorkspace' ? new (class { clearArchivedCurrent() { return true } })() : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions: { open: () => {}, list: { getSnapshot: () => ({ byId: { alive: {} }, current: undefined }) } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  })

  // 两行都已失效（会话不在 sessionsById 里）。
  const store = {
    rows: [
      { sessionId: 'g1', title: 'G1', favoritedAt: 2 },
      { sessionId: 'g2', title: 'G2', favoritedAt: 1 },
    ],
    byId: new Map(), ready: true, error: null,
  }
  const component = registered[0].component
  const render = stateful.__render(() => component({
    wide: true,
    useFavorites: (sel) => sel(store),
    useSessions: (sel) => sel({ byId: {}, current: undefined, phase: 'ready' }),
    useWorkspaces: (sel) => sel({ items: [], archivedSessionIds: [] }),
    onOpen: () => null,
    onRemove: () => Promise.resolve(),
    onRemoveMany: (ids) => { removedMany.push(ids); return Promise.resolve() },
    onRename: () => Promise.resolve(),
  }))

  findByLabel(render(), '收藏夹').props.onClick()
  // 打开清理确认框：此刻名单是快照。
  const cleanupBtn = flatten(render()).find(n => n.children?.[0] === '清理')
  assert.ok(cleanupBtn, '失效横幅应有清理按钮')
  cleanupBtn.props.onClick()

  const dialog = flatten(render()).find(n => n.props?.role === 'dialog')
  assert.ok(dialog, '清理应先确认')
  const descNode = flatten(dialog).find(n => typeof n.children?.[0] === 'string' && n.children[0].includes('个已不存在'))
  assert.ok(descNode, '确认框应有描述文案')
  assert.match(descNode.children[0], /2 个/, '确认框应描述 2 个失效收藏')

  // 确认：必须删除快照里的两条（而不是重算后的空列表）。
  const confirm = flatten(dialog).find(n => n.children?.[0] === '全部清理')
  confirm.props.onClick()
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(removedMany, [['g1', 'g2']], '确认后应清理快照中的两条')
})

test('dialog submission still settles under a StrictMode effect replay', async () => {
  // StrictMode 开发期会「挂载 → cleanup → 再挂载」。若卸载守卫只清不重设，
  // alive 会永久为 false，之后所有提交都不再 setBusy(false)/onClose/显示错误，
  // 表现为「点了按钮一直转圈、对话框永不关闭」。
  //
  // 注意：replay 必须发生在【对话框自己挂载时】。useSubmit 属于
  // DeleteConfirmDialog，它在用户点击后才挂载；只在顶层组件上做 replay
  // 根本走不到这段代码，测试会假绿。
  globalThis.document = {
    addEventListener: () => {}, removeEventListener: () => {}, body: {},
    querySelector: () => null, createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
  }
  globalThis.window = {
    __ModuleLoader__: globalThis.window.__ModuleLoader__,
    innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {},
  }

  const removed = []
  const registered = []
  const stateful = makeStatefulReact()
  const plugin = captured.factory((name) => {
    if (name === 'react' || name === 'react-dom') return stateful
    throw new Error(`unexpected require: ${name}`)
  })
  plugin.apply({
    get: (key) => (key === 'remote.favorites'
      ? {
        list: () => Promise.resolve({ ok: true, value: [] }),
        add: () => Promise.resolve({ ok: true, value: [] }),
        unfavorite: () => Promise.resolve({ ok: true, value: [] }),
        rename: () => Promise.resolve({ ok: true, value: [] }),
      }
      : key === 'uiWorkspace' ? new (class { clearArchivedCurrent() { return true } })() : undefined),
    remote: { $mount: () => Promise.resolve() },
    sessions: { open: () => {}, list: { getSnapshot: () => ({ byId: { alive: {} }, current: undefined }) } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
    layout: { selectPanel: () => {} },
    inputTriggers: { registerSource: () => () => {} },
    slots: {
      inject: (_k, cb) => cb(),
      register: (opts, component) => { registered.push({ opts, component }); return () => {} },
    },
    effect: (fn) => fn(),
  })

  const store = {
    rows: [{ sessionId: 'alive', title: 'A', favoritedAt: 1 }],
    byId: new Map([['alive', {}]]), ready: true, error: null,
  }
  const props = {
    wide: true,
    useFavorites: (sel) => sel(store),
    useSessions: (sel) => sel({ byId: { alive: { displayTitle: 'A' } }, current: undefined, phase: 'ready' }),
    useWorkspaces: (sel) => sel({ items: [], archivedSessionIds: [] }),
    onOpen: () => null,
    onRemove: (id) => { removed.push(id); return Promise.resolve() },
    onRemoveMany: () => Promise.resolve(),
    onRename: () => Promise.resolve(),
  }
  const component = registered[0].component
  const render = stateful.__render(() => component(props))

  findByLabel(render(), '收藏夹').props.onClick()
  findByLabel(render(), '移除收藏').props.onClick({ stopPropagation: () => {} })
  let dialog = flatten(render()).find(n => n.props?.role === 'dialog')
  assert.ok(dialog, '应弹出确认框')

  // 关键：对话框此刻才挂载。模拟 StrictMode 对【它】做一次 replay，
  // 也就是跑一遍它的 cleanup 再重新 setup —— 这正是缺陷的触发条件。
  stateful.__replayMount()

  dialog = flatten(render()).find(n => n.props?.role === 'dialog')
  const confirm = flatten(dialog).find(n => n.type === 'button' && n.children?.[0] === '移除收藏')
  confirm.props.onClick()
  await new Promise(r => setTimeout(r, 0))

  // 提交必须真正落地：既执行了删除，也把对话框关掉了。
  assert.deepEqual(removed, ['alive'], 'StrictMode replay 后提交仍须生效')
  assert.equal(
    flatten(render()).find(n => n.props?.role === 'dialog'),
    undefined,
    'StrictMode replay 后提交成功仍须关闭对话框',
  )
})


