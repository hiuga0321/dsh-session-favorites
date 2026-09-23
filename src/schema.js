/** 收藏记录 schema（纯函数，无 DSH 依赖，便于单测）。 */
export const favoriteRecordSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('favorite record must be an object')
    }
    if (typeof value.title !== 'string' || value.title.length === 0) {
      throw new TypeError('title must be a non-empty string')
    }
    if (value.workspaceId !== undefined && typeof value.workspaceId !== 'string') {
      throw new TypeError('workspaceId must be a string when present')
    }
    if (!Number.isFinite(value.favoritedAt)) {
      throw new TypeError('favoritedAt must be a finite number')
    }
    return value
  },
}
