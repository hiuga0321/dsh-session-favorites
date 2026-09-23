/**
 * 会话收藏夹存储域声明。
 * 表 `favorites`：key = SessionId，value = { title, workspaceId?, favoritedAt }。
 *
 * invalidRecords: 'backup-and-skip' —— 收藏是**可再生的派生数据**（丢了重新收藏即可），
 * 没有任何理由让一条坏记录连带整个插件打不开。存储域只在 load 路径校验 schema，
 * 一条历史遗留/被外部改坏的记录若走默认的 fail-loud，会让 open() 直接抛错、
 * 收藏功能整体不可用；backup-and-skip 会把该条移到一边、记日志、按缺失处理。
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { favoriteRecordSchema } from './schema.js'

export const favoritesSpec = defineDomain({
  name: 'favorites',
  version: 1,
  invalidRecords: 'backup-and-skip',
  tables: {
    favorites: domainTable(favoriteRecordSchema),
  },
})
