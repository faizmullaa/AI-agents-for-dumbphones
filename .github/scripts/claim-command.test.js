'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const run = require('./claim-command.js')

// run() takes { github, context, core } as arguments, so the I/O is injectable
// and the one property worth proving needs no mocking library: the bot must
// never tell a contributor an issue is theirs, or released, unless GitHub
// actually said so. Everything else here is glue and stays untested by design.

const OWNER = { owner: 'baptistecristo', repo: 'AI-agents-for-dumbphones' }

function harness ({ body, assignees = [], addAssignees, removeAssignees, state = 'open' }) {
  const said = []
  const logged = { warnings: [], failed: null }

  const github = {
    rest: {
      issues: {
        get: async () => ({ data: { state, assignees } }),
        listForRepo: async () => ({ data: [] }),
        createComment: async ({ body }) => { said.push(body); return { data: {} } },
        addAssignees: addAssignees || (async () => ({ data: { assignees: [] } })),
        removeAssignees: removeAssignees || (async () => ({ data: { assignees: [] } }))
      }
    }
  }

  const context = {
    repo: OWNER,
    payload: { issue: { number: 4 }, comment: { body, user: { login: 'faizmullaa' } } }
  }

  const core = {
    info: () => {},
    warning: (m) => logged.warnings.push(m),
    setFailed: (m) => { logged.failed = m }
  }

  return { github, context, core, said, logged }
}

test('claim: a silently dropped assignee is never reported as success', async () => {
  // 201 with the assignee absent. This is GitHub's documented behaviour for an
  // ineligible user, and the whole reason the read-back exists.
  const h = harness({
    body: '/claim',
    addAssignees: async () => ({ data: { assignees: [] } })
  })
  await run(h)
  assert.equal(h.said.length, 1)
  assert.match(h.said[0], /GitHub refused the assignment/)
  assert.doesNotMatch(h.said[0], /Yours, @faizmullaa/)
})

test('claim: a thrown assign is never reported as success', async () => {
  const h = harness({
    body: '/claim',
    addAssignees: async () => { throw new Error('403 rate limited') }
  })
  await run(h)
  assert.equal(h.said.length, 1)
  assert.match(h.said[0], /GitHub refused the assignment/)
  assert.equal(h.logged.warnings.length, 2)
})

test('claim: a landed assign is confirmed', async () => {
  const h = harness({
    body: '/claim',
    addAssignees: async () => ({ data: { assignees: [{ login: 'faizmullaa' }] } })
  })
  await run(h)
  assert.equal(h.said.length, 1)
  assert.match(h.said[0], /Yours, @faizmullaa/)
})

test('unclaim: a release that did not land is never announced', async () => {
  const h = harness({
    body: '/unclaim',
    assignees: [{ login: 'faizmullaa' }],
    // GitHub hands back an issue the commenter still holds.
    removeAssignees: async () => ({ data: { assignees: [{ login: 'faizmullaa' }] } })
  })
  await run(h)
  assert.deepEqual(h.said, [])
  assert.match(h.logged.failed, /did not land/)
})

test('unclaim: a release that landed is announced', async () => {
  const h = harness({
    body: '/unclaim',
    assignees: [{ login: 'faizmullaa' }],
    removeAssignees: async () => ({ data: { assignees: [] } })
  })
  await run(h)
  assert.equal(h.said.length, 1)
  assert.match(h.said[0], /Released, #4 is open again/)
  assert.equal(h.logged.failed, null)
})

test('a closed issue is left alone entirely', async () => {
  const h = harness({ body: '/claim', state: 'closed' })
  await run(h)
  assert.deepEqual(h.said, [])
})

test('prose is not a command', async () => {
  const h = harness({ body: "I'll /claim this next week" })
  await run(h)
  assert.deepEqual(h.said, [])
})
