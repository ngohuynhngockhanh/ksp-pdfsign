import test from 'node:test'
import assert from 'node:assert/strict'

import { getToolDefinition, toolDefinitions, toolNames } from '../src/catalog.js'

test('catalog exposes the complete typed KSP surface without duplicate names', () => {
  assert.ok(toolDefinitions.length >= 50)
  assert.equal(new Set(toolNames).size, toolNames.length)
  assert.ok(toolNames.includes('inut_crm_health'))
  assert.ok(toolNames.includes('crm_customers_search'))
  assert.ok(toolNames.includes('bidding_search'))
  assert.ok(toolNames.includes('inventory_stock'))
  assert.ok(toolNames.includes('tax_sync'))
  assert.ok(toolNames.includes('spx'))

  for (const definition of toolDefinitions) {
    assert.match(definition.name, /^[a-z][a-z0-9_]+$/)
    assert.ok(definition.description.length >= 20)
    assert.ok(definition.inputSchema)
    assert.ok(['read', 'write', 'high_risk'].includes(definition.access))
    assert.ok(['read', 'prepare_execute'].includes(definition.execution))
  }

  assert.equal(getToolDefinition('missing_tool'), undefined)
})
