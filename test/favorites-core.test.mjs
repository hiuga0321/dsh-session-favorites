import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addFavorite,
  createTimestampSource,
  removeFavorite,
  removeFavorites,
  rows,
} from '../src/favorites-core.js'

/**
 * 忠实复刻 KvTable 语义的内存表。
 *
 * 与旧 mock 的关键差异（正是这些差异掩盖了真实缺陷）：
 *   - update() 对不存在的 key **抛 DomainError('missing-key')**，而不是静默写入；
 *     storage-domain 的 update 在队列槽位发现 records 无此 key 时即抛错。
 *   - delete() 返回 boolean，且记录不存在时返回 false、不产生任何事件。
 *   - put/delete/update 全部「入队执行」：这里用一个微任务模拟写链，
 *     使「调用」与「落地」之间真实存在窗口。
 * @param initial - 初始记录。
 * @returns KvTable 鸭子类型 + 便于断言的可观测字段。
 */
function mockTable(initial = {}) {
  const data = new Map(Object.entries(initial))
  const calls = { put: [], delete: [], update: [] }
  // 写链：串行化所有写操作，模拟 domain 的 enqueue。
  let chain = Promise.resolve()
  const enqueue = (fn) => {
    const next = chain.then(fn, fn)
    chain = next.then(() => {}, () => {})
    return next
  }
  return {
    data,
    calls,
    entries: () => data.entries(),
    get: (k) => data.get(k),
    put: (k, v) => enqueue(async () => {
      calls.put.push(k)
      data.set(k, v)
    }),
    delete: (k) => enqueue(async () => {
      calls.delete.push(k)
      if (!data.has(k)) return false
      data.delete(k)
      return true
    }),
    update: (k, fn) => enqueue(async () => {
      calls.update.push(k)
      if (!data.has(k)) {
        const error = new Error(`no record '${k}' to update`)
        error.code = 'missing-key'
        throw error
      }
      const next = fn(data.get(k))
      data.set(k, next)
      return next
    }),
  }
}

test('add / remove / list roundtrip with favoritedAt ordering', async () => {
  const table = mockTable()
  await addFavorite(table, 's1', 'A', 'w1')
  await addFavorite(table, 's2', 'B', undefined)

  const list = await rows(table)
  assert.equal(list.length, 2)
  // 后添加的 s2 favoritedAt 更大 → 排在前
  assert.equal(list[0].sessionId, 's2')
  assert.equal(list[1].sessionId, 's1')
  assert.equal(list[1].workspaceId, 'w1')
  assert.equal(list[0].workspaceId, undefined)
})

test('addFavorite creates a record on a truly empty table (no silent update path)', async () => {
  const table = mockTable()
  const list = await addFavorite(table, 's1', 'A', 'w1')

  // 必须真的写了盘，且带上 favoritedAt；否则记录存在却没有时间戳。
  assert.equal(table.calls.put.length, 1, 'first add must go through put')
  assert.equal(table.data.get('s1').favoritedAt > 0, true, 'favoritedAt must be stamped')
  assert.deepEqual(list.map(r => r.sessionId), ['s1'])
})

test('add is idempotent: refreshes title but keeps favoritedAt', async () => {
  const table = mockTable()
  await addFavorite(table, 's1', 'A', 'w1')
  const before = (await rows(table)).find(r => r.sessionId === 's1')

  await addFavorite(table, 's1', 'A2', 'w2')
  const after = (await rows(table)).find(r => r.sessionId === 's1')

  assert.equal(after.title, 'A2')
  assert.equal(after.workspaceId, 'w2')
  assert.equal(after.favoritedAt, before.favoritedAt, 'repeat add must not move sort position')
  assert.equal(table.calls.put.length, 1, 'repeat add must not re-put')
})

test('addFavorite updates workspaceId away when the favorite moves out of a workspace', async () => {
  const table = mockTable()
  await addFavorite(table, 's1', 'A', 'w1')
  // 会话被移出工作区：workspaceId 变为 undefined，行上不应残留旧分组。
  const list = await addFavorite(table, 's1', 'A', undefined)
  assert.equal(list[0].workspaceId, undefined)
  assert.equal('workspaceId' in table.data.get('s1'), false)
})

test('removeFavorite reports whether the record actually existed', async () => {
  const table = mockTable()
  await addFavorite(table, 's1', 'A')

  const first = await removeFavorite(table, 's1')
  assert.equal(first.existed, true, 'first delete removes a real record')
  assert.deepEqual(first.rows, [])

  // 重复删除：记录已不在，KvTable.delete 返回 false 且不写盘、不发事件。
  const second = await removeFavorite(table, 's1')
  assert.equal(second.existed, false, 'second delete must report the no-op')
  assert.deepEqual(second.rows, [])
  assert.equal(table.calls.delete.length, 2)
})

test('removeMany lands every successful delete even when a later one fails', async () => {
  const table = mockTable()
  await addFavorite(table, 's1', 'A')
  await addFavorite(table, 's2', 'B')

  // 让 s2 的删除失败，模拟网络抖动 / 远程错误。
  const originalDelete = table.delete.bind(table)
  let call = 0
  table.delete = async (k) => {
    call += 1
    if (call === 2) throw new Error('boom')
    return originalDelete(k)
  }

  const snaps = []
  await assert.rejects(
    () => removeFavorites(table, ['s1', 's2'], (snapshot) => snaps.push(snapshot)),
    /boom/,
  )

  // 关键：s1 的删除结果必须已经被交付，而不是随异常一起丢失。
  assert.equal(snaps.length, 1, 'the completed delete must be reported before the failure')
  assert.deepEqual(snaps[0].map(r => r.sessionId), ['s2'], 's1 is gone, s2 remains')
  assert.equal(table.data.has('s1'), false)
  assert.equal(table.data.has('s2'), true)
})

test('removeMany counts only the records that really existed', async () => {
  const table = mockTable()
  await addFavorite(table, 's1', 'A')

  // 'ghost' 从未收藏过 —— 不应被计入删除数。
  const removed = await removeFavorites(table, ['s1', 'ghost'], () => {})
  assert.equal(removed, 1)
})

test('concurrent add of the same session does not throw missing-key', async () => {
  const table = mockTable()
  // 两个「标签页」同时收藏同一会话：两侧都先 update，其中一方会遇到 missing-key。
  const results = await Promise.all([
    addFavorite(table, 's1', 'A'),
    addFavorite(table, 's1', 'B'),
  ])
  assert.equal(table.data.has('s1'), true, 'the record must exist after the race')
  assert.equal(results.length, 2)
  // 两条路径都必须返回权威列表且只有一条记录（幂等）。
  for (const list of results) {
    assert.equal(list.filter(r => r.sessionId === 's1').length, 1)
  }
})

test('add then concurrent delete falls back to put instead of surfacing missing-key', async () => {
  const table = mockTable()
  // 先建立记录，再让 delete 插到 add 的 update 之前，制造原实现会抛 missing-key 的竞态。
  await addFavorite(table, 's1', 'A')
  const deleting = removeFavorite(table, 's1')
  const adding = addFavorite(table, 's1', 'A-again')
  await Promise.all([deleting, adding])

  // 无论最终落在哪个分支，都不得把 missing-key 抛给调用方。
  assert.equal(table.data.has('s1'), true, 're-favoriting after a concurrent delete must re-create the record')
})

test('createTimestampSource is monotonic and isolated per instance', async () => {
  const a = createTimestampSource()
  const b = createTimestampSource()

  // 同毫秒内连续调用必须严格递增，否则排序不稳定。
  const stamps = [a(), a(), a()]
  assert.equal(stamps[0] < stamps[1] && stamps[1] < stamps[2], true)

  // 两个源互不影响：b 的首次调用不得被 a 的历史推高。
  const first = b()
  const second = b()
  assert.equal(second, first + 1, 'a fresh source starts from Date.now(), not global history')
})

test('rows omits workspaceId entirely when absent', async () => {
  const table = mockTable({ s1: { title: 'A', favoritedAt: 1 } })
  const [row] = await rows(table)
  assert.equal('workspaceId' in row, false)
})
