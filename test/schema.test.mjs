import { test } from 'node:test'
import assert from 'node:assert/strict'
import { favoriteRecordSchema } from '../src/schema.js'

test('accepts a valid record and returns it', () => {
  const rec = { title: '会话 A', workspaceId: 'w1', favoritedAt: 123 }
  assert.deepEqual(favoriteRecordSchema.parse(rec), rec)
})

test('accepts a record without workspaceId', () => {
  const rec = { title: '会话 B', favoritedAt: 0 }
  assert.deepEqual(favoriteRecordSchema.parse(rec), rec)
})

test('rejects non-object / array / null', () => {
  assert.throws(() => favoriteRecordSchema.parse(null))
  assert.throws(() => favoriteRecordSchema.parse([]))
  assert.throws(() => favoriteRecordSchema.parse('x'))
})

test('rejects bad fields', () => {
  assert.throws(() => favoriteRecordSchema.parse({ title: '' }))
  assert.throws(() => favoriteRecordSchema.parse({ title: 't', favoritedAt: NaN }))
  assert.throws(() => favoriteRecordSchema.parse({ title: 't', workspaceId: 1, favoritedAt: 0 }))
})
