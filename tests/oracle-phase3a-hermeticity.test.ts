import assert from 'node:assert/strict'

import { evaluateHermeticity, runHermeticitySelfTest } from '../tools/oracle-lab/phase3a/hermeticity.js'

console.log('\ntests/oracle-phase3a-hermeticity.test.ts')

assert.equal(evaluateHermeticity(null, null, null).status, 'BLOCKED_DYNAMIC_EGRESS_GUARD')
assert.equal(evaluateHermeticity({
  declared_loopback_reachable: true, alternate_loopback_blocked: true, unix_socket_blocked: true,
  ipv4_external_tcp_blocked: true, ipv6_external_tcp_blocked: true, external_udp_blocked: true, external_socket_budget: 1,
}, 'a'.repeat(64), 'b'.repeat(64)).status, 'BLOCKED_DYNAMIC_EGRESS_GUARD')

const result = await runHermeticitySelfTest()
assert.equal(result.status, 'PASS', JSON.stringify(result))
assert.equal(result.probe?.external_socket_budget, 0)
assert.equal(result.real_cli_executed, false)

console.log(JSON.stringify({ ok: true, guard_type: result.guard_type }))
