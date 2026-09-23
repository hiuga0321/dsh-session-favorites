/**
 * 会话收藏夹宿主半部：FavoritesService。
 *
 * - 自有 storageDomain 域（favorites）做持久化，多标签/多浏览器一致。
 * - 运行时注册 Typert 远程方法 list/add/unfavorite（参考 @michengai/dsh-archive-manager），
 *   不依赖 build:lib 生成的 ./remote、不改 api-remotes 装配。
 */
import { Service } from '@deepseek-ai/cordis'
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { favoritesSpec } from './favorites-domain.js'
import { addFavorite, createTimestampSource, removeFavorite, renameFavorite, rows } from './favorites-core.js'
import { PACKAGE_NAME as PKG } from './package-identity.js'

/** 手写 codec shim：客户端网关要 mode:'strict' 且 schema 有 parse()。 */
function strictCodec(typeSymbol, schema) {
  return { mode: 'strict', typeSymbol, create: () => schema, schema }
}

const sessionIdCodec = strictCodec('@deepseek-ai/dsh-session/types#SessionId', {
  parse(value) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError('sessionId must be a non-empty string')
    return value
  },
})

/**
 * 标题 codec。
 * 注意 parse 只在字段**存在**时被调用：字段整体缺失时网关直接返回 undefined
 * （见 gateway resolveParameter 的 `if (!Object.hasOwn(args, parameter.wire)) return undefined`），
 * 因此这里只负责校验「传了就得好」。
 *
 * 非空校验必须在这里做：storage-domain 的 schema.parse **只在 load 路径**调用，
 * 写路径不校验。若放行空标题，坏记录会落盘，下次打开该域时 schema 校验失败——
 * 而本域未声明 invalidRecords: 'backup-and-skip'，会直接让整个域打不开。
 * 在边界拦住，坏数据就进不去。
 */
const titleCodec = strictCodec('String', {
  parse(value) {
    if (typeof value !== 'string') throw new TypeError('title must be a string')
    if (value.trim().length === 0) throw new TypeError('title must be a non-empty string')
    return value
  },
})

/**
 * 工作区 id codec（可缺省）。
 *
 * 两个边界必须分清：
 *   - 字段缺失 / 显式 undefined：由描述符的 acceptsUndefined + 网关放行，parse 根本不会被调用，
 *     这里的 undefined/null 分支只是让直接单测调用也成立。
 *   - 字段存在但类型不对：必须抛错，否则非法值会直接落盘。
 * 旧实现在 null 上返回 undefined，等于把「显式传 null」也当合法缺省静默吞掉。
 */
const workspaceIdCodec = strictCodec('String?', {
  parse(value) {
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw new TypeError('workspaceId must be a string')
    return value
  },
})
const listCodec = strictCodec(`${PKG}/types#FavoriteRowList`, {
  parse(value) {
    if (!Array.isArray(value)) throw new TypeError('rows must be an array')
    return value
  },
})

const FAVORITES_INVOCATIONS = [
  {
    id: `${PKG}#favorites/list`,
    service: 'favorites',
    namespace: 'favorites',
    method: 'list',
    invocation: { kind: 'direct' },
    parameters: [],
    result: listCodec,
    sourceLocation: { file: `${PKG}/src/index.js`, line: 1, column: 1 },
  },
  {
    id: `${PKG}#favorites/add`,
    service: 'favorites',
    namespace: 'favorites',
    method: 'add',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: sessionIdCodec },
      { name: 'title', wire: 'title', source: 'json', codec: titleCodec },
      { name: 'workspaceId', wire: 'workspaceId', source: 'json', codec: workspaceIdCodec, acceptsUndefined: true },
    ],
    result: listCodec,
    sourceLocation: { file: `${PKG}/src/index.js`, line: 1, column: 1 },
  },
  {
    id: `${PKG}#favorites/unfavorite`,
    service: 'favorites',
    namespace: 'favorites',
    method: 'unfavorite',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: sessionIdCodec },
    ],
    result: listCodec,
    sourceLocation: { file: `${PKG}/src/index.js`, line: 1, column: 1 },
  },
  {
    id: `${PKG}#favorites/rename`,
    service: 'favorites',
    namespace: 'favorites',
    method: 'rename',
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: sessionIdCodec },
      { name: 'title', wire: 'title', source: 'json', codec: titleCodec },
    ],
    result: listCodec,
    sourceLocation: { file: `${PKG}/src/index.js`, line: 1, column: 1 },
  },
]

const FAVORITES_TYPERT = {
  package: PKG,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: FAVORITES_INVOCATIONS,
}

/**
 * 模拟 TS 装饰器 @Remote(method)：把 Remote 标记写到原型上。
 *
 * 装饰器的第一个参数是**被装饰的方法**，官方重载靠 `typeof arg === 'string'`
 * 区分「带导出名的形式」与「普通装饰器调用」。旧实现传 undefined，虽因
 * protocol 内部只用 context.name 而侥幸能跑，却依赖了实现细节；
 * 这里从原型上取真实方法传入，走正常装饰器路径。
 * @param instance - 已构造的服务实例。
 * @param method - 要标记的方法名。
 */
function markRemoteMethod(instance, method) {
  const target = Object.getPrototypeOf(instance)?.[method]
  if (typeof target !== 'function') {
    throw new TypeError(`[session-favorites] cannot mark Remote method "${method}": not found on prototype`)
  }
  const context = {
    private: false,
    static: false,
    name: method,
    addInitializer(fn) { fn.call(instance) },
  }
  Remote(target, context)
}

/** 运行时注册 Typert 描述符（typert.local），替代 build:lib 装配。 */
function registerHostRemote(ctx) {
  const typert = ctx.get('typert')
  if (typert !== undefined) {
    typert.register(FAVORITES_TYPERT)
    return
  }
  ctx.inject(['typert'], (typertCtx) => { typertCtx.typert.register(FAVORITES_TYPERT) })
}

export class FavoritesService extends Service {
  static inject = ['storageDomain', 'typert']

  constructor(ctx) {
    super(ctx, 'favorites')
    // 每实例一份时间戳源：模块级单例会跨实例共享，多 fiber/热重载下排序语义未定义。
    this.nextFavoritedAt = createTimestampSource()
    this.domainPromise = ctx.storageDomain.open(favoritesSpec)
    this.typertRemote = bindTypertRemote(this, 'favorites', { namespace: 'favorites' })
    for (const method of ['list', 'add', 'unfavorite', 'rename']) markRemoteMethod(this, method)
    registerHostRemote(ctx)
    ctx.effect(() => async () => {
      try {
        await (await this.domainPromise).close()
      } catch (error) {
        this.ctx.logger?.warn?.(`[session-favorites] domain close failed: ${String(error)}`)
      }
    }, 'session-favorites: domain lifetime')
  }

  async table() {
    return (await this.domainPromise).table('favorites')
  }

  async list() {
    return rows(await this.table())
  }

  async add(sessionId, title, workspaceId) {
    return addFavorite(await this.table(), sessionId, title, workspaceId, this.nextFavoritedAt)
  }

  /**
   * 取消一个收藏。仍返回权威全量列表，保持既有远程契约不变；
   * 「记录本就不存在」这一事实不再被丢弃，而是记录到日志便于排查多端不同步。
   * @param sessionId - 会话 id。
   * @returns 权威全量列表。
   */
  async unfavorite(sessionId) {
    const { rows: latest, existed } = await removeFavorite(await this.table(), sessionId)
    if (!existed) {
      this.ctx.logger?.debug?.(`[session-favorites] unfavorite no-op: "${sessionId}" was not favorited`)
    }
    return latest
  }

  /**
   * 同步收藏记录的标题副本（会话在 DSH 侧改名后调用）。
   * 记录不存在时不是错误：可能刚被取消收藏，静默保持无操作。
   * @param sessionId - 会话 id。
   * @param title - 新的标题。
   * @returns 权威全量列表。
   */
  async rename(sessionId, title) {
    const { rows: latest, existed } = await renameFavorite(await this.table(), sessionId, title)
    if (!existed) {
      this.ctx.logger?.debug?.(`[session-favorites] rename no-op: "${sessionId}" was not favorited`)
    }
    return latest
  }
}

export const name = 'session-favorites'
export const inject = ['storageDomain', 'typert']

export function apply(ctx) {
  return new FavoritesService(ctx)
}
