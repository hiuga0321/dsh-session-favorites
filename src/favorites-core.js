/**
 * 收藏 CRUD 纯逻辑（无 DSH 依赖，便于单测）。
 * 入参 `table` 只需满足 KvTable 鸭子类型：entries/get/put/delete/update。
 *
 * KvTable 的关键语义（决定了本文件的写法）：
 *   - get()/entries() 是同步立即读；put()/delete()/update() 是**入队执行**，
 *     调用与真正落地之间隔着域写链。
 *   - delete() 返回 Promise<boolean>：记录本就不存在时返回 false，且不写盘、不发事件。
 *   - update() 在队列槽位发现 key 不存在时抛 DomainError('missing-key')。
 * 因此「先 get 再决定 put/update」天然有竞态，本文件一律用原子操作兜住。
 */

/**
 * 单调时间戳工厂：避免同毫秒多次收藏时 favoritedAt 撞车导致排序不稳定。
 * 刻意做成每实例一份状态（不再用模块级变量）——模块级单例会跨
 * FavoritesService 实例共享，多 fiber / 热重载下排序语义未定义。
 * @returns 严格递增的时间戳生成器。
 */
export function createTimestampSource() {
  let last = 0
  return function nextFavoritedAt() {
    last = Math.max(Date.now(), last + 1)
    return last
  }
}

/** 进程内默认实例，供不关心多实例隔离的调用方（单测/冒烟）使用。 */
const defaultTimestampSource = createTimestampSource()

export function rows(table) {
  return [...table.entries()]
    .map(([sessionId, record]) => ({
      sessionId,
      title: record.title,
      ...(record.workspaceId === undefined ? {} : { workspaceId: record.workspaceId }),
      favoritedAt: record.favoritedAt,
    }))
    .sort((a, b) => b.favoritedAt - a.favoritedAt)
}

/**
 * 收藏（或更新）一个会话。
 *
 * 不用「先 get 再分支」：get 是同步立即读而 put/update 入队执行，两者之间有窗口，
 * 并发收藏同一会话会得到错误的分支（甚至 update 撞上并发的 delete 而抛 missing-key）。
 * 这里先尝试原子 update（命中则保留原 favoritedAt，维持排序位置），
 * 仅在 missing-key 时退回 put 建档，两条路径都保证最终存在。
 * @param table - KvTable 鸭子类型。
 * @param sessionId - 会话 id。
 * @param title - 会话标题。
 * @param workspaceId - 归属工作区，缺省表示不属于任何工作区。
 * @param nextFavoritedAt - 可选时间戳生成器（多实例隔离用）。
 * @returns 权威全量列表。
 */
export async function addFavorite(table, sessionId, title, workspaceId, nextFavoritedAt = defaultTimestampSource) {
  const next = { title, ...(workspaceId === undefined ? {} : { workspaceId }) }
  // 关键：会话被移出工作区时必须显式**删除** workspaceId 键。
  // 若只靠「next 里没有这个键」，展开合并会保留 prev.workspaceId，
  // 该行就会永久分错组（schema 允许 undefined 值，但 rows() 判的是键的值，
  // 留着 undefined 虽不报错却会让记录里残留无意义的键）。
  const merge = (prev) => {
    const merged = { ...prev, ...next }
    if (workspaceId === undefined) delete merged.workspaceId
    return merged
  }
  try {
    await table.update(sessionId, merge)
  } catch (error) {
    // 记录不存在（首次收藏），或在入队后被并发删除：退回新建。
    if (error?.code !== 'missing-key') throw error
    await table.put(sessionId, { ...next, favoritedAt: nextFavoritedAt() })
  }
  return rows(table)
}

/**
 * 取消收藏一个会话。
 * @param table - KvTable 鸭子类型。
 * @param sessionId - 会话 id。
 * @returns 权威全量列表，以及该记录此前是否真的存在。
 */
export async function removeFavorite(table, sessionId) {
  // delete 返回 boolean：false 表示记录本就不存在（不写盘、不发事件）。
  // 把事实返回给调用方，而不是丢弃——否则「已清干净」与「删除静默失败」无法区分。
  const existed = await table.delete(sessionId)
  return { rows: rows(table), existed: existed === true }
}

/**
 * 重命名一个收藏记录的标题副本。
 *
 * 只改本地存储的 title，不动会话本身（会话名由 DSH 的 session.rename 负责，
 * 调用方先改 DSH 再同步到这里）。
 *
 * 用原子 update 而非「先 get 再 put」：get 是同步立即读、update 入队执行，
 * 两者之间的窗口会让并发 remove 后的 put 把记录**复活**。这里保留
 * missing-key 的原始语义 —— 记录本就不存在时什么都不做，交给调用方判断。
 * @param table - KvTable 鸭子类型。
 * @param sessionId - 会话 id。
 * @param title - 新的标题。
 * @returns 权威全量列表，以及该记录是否存在。
 */
export async function renameFavorite(table, sessionId, title) {
  try {
    await table.update(sessionId, prev => ({ ...prev, title }))
  } catch (error) {
    if (error?.code !== 'missing-key') throw error
    return { rows: rows(table), existed: false }
  }
  return { rows: rows(table), existed: true }
}

/**
 * 批量取消收藏，逐个落地。
 *
 * 每次 delete 后立即把权威列表交给 onProgress，保证中途失败时
 * 已完成的删除不会因为整体抛出而丢失（旧实现只取最后一次结果，
 * 任一 reject 都会让最后一次 apply 永不执行，UI 停在旧快照）。
 * @param table - KvTable 鸭子类型。
 * @param sessionIds - 待取消的会话 id 序列。
 * @param onProgress - 每次成功删除后的权威列表回调。
 * @returns 实际删除成功的数量（不含本就不存在的）。
 */
export async function removeFavorites(table, sessionIds, onProgress) {
  let removed = 0
  for (const sessionId of sessionIds) {
    const { rows: latest, existed } = await removeFavorite(table, sessionId)
    if (existed) removed += 1
    onProgress?.(latest)
  }
  return removed
}
