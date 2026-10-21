import test from 'node:test'
import assert from 'node:assert/strict'
import { databaseSearch, databaseGet } from '../tools/lib/databases.mjs'

const live = process.env.DSH_SCI_LIVE_TESTS === '1'

test('live public DB contract smoke', { skip: live ? false : 'set DSH_SCI_LIVE_TESTS=1 to run' }, async () => {
  const chebi = await databaseSearch('chebi', 'aspirin', { limit: 2 })
  assert.equal(chebi.ok, true)
  assert.ok(chebi.total > 0)
  assert.ok(chebi.items.some((x) => String(x.name).toLowerCase().includes('aspirin') || x.id === 'CHEBI:15365'))

  const aspirin = await databaseGet('chebi', 'CHEBI:15365')
  assert.equal(aspirin.ok, true)
  assert.equal(aspirin.items[0].id, 'CHEBI:15365')

  const pgx = await databaseSearch('clinpgx', 'CYP2D6', { limit: 2 })
  assert.equal(pgx.ok, true)
  assert.ok(pgx.items.some((x) => x.symbol === 'CYP2D6'))

  const label = await databaseSearch('dailymed', 'metformin', { limit: 2 })
  assert.equal(label.ok, true)
  assert.ok(label.total > 0)
  assert.ok(label.items[0].setid)
})
