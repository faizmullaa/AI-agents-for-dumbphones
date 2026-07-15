'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { parseCommand } = require('./claim-logic.js')

test('parseCommand: a bare /claim is a claim', () => {
  assert.equal(parseCommand('/claim'), 'claim')
})

test('parseCommand: a bare /unclaim is an unclaim', () => {
  assert.equal(parseCommand('/unclaim'), 'unclaim')
})

test('parseCommand: surrounding whitespace and case do not matter', () => {
  assert.equal(parseCommand('  /Claim  '), 'claim')
  assert.equal(parseCommand('\n\n/UNCLAIM\n'), 'unclaim')
})

test('parseCommand: the command may sit on its own line among prose', () => {
  assert.equal(parseCommand('I have time this weekend.\n\n/claim\n\nThanks!'), 'claim')
})

test('parseCommand: prose mentioning the command inline does not fire', () => {
  assert.equal(parseCommand("I'll /claim this next week"), null)
  assert.equal(parseCommand('use /claim to take an issue'), null)
})

test('parseCommand: trailing prose on an otherwise-bare line does not fire', () => {
  assert.equal(parseCommand('/claim this issue please'), null)
  assert.equal(parseCommand('/claim #4'), null)
  assert.equal(parseCommand('/unclaim it'), null)
})

test('parseCommand: a quoted or code-fenced command does not fire', () => {
  assert.equal(parseCommand('> /claim'), null)
  assert.equal(parseCommand('`/claim`'), null)
})

test('parseCommand: unrelated bodies are null', () => {
  assert.equal(parseCommand('looks good to me'), null)
  assert.equal(parseCommand(''), null)
})

test('parseCommand: non-string input is null, never a throw', () => {
  assert.equal(parseCommand(undefined), null)
  assert.equal(parseCommand(null), null)
  assert.equal(parseCommand(42), null)
})

test('parseCommand: the first command wins when both appear', () => {
  assert.equal(parseCommand('/unclaim\n/claim'), 'unclaim')
})

const {
  issuesOnly,
  decideClaim,
  decideUnclaim,
  assignLanded,
  quietDays,
  nudgeSentAt,
  sweepSkipReason,
  decideSweep,
  NUDGE_MARKER
} = require('./claim-logic.js')

test('issuesOnly: drops pull requests from an issues listing', () => {
  const items = [
    { number: 1 },
    { number: 2, pull_request: { url: 'https://api.github.com/...' } },
    { number: 3 }
  ]
  assert.deepEqual(issuesOnly(items).map((i) => i.number), [1, 3])
})

test('decideClaim: an unassigned issue under the cap is assigned', () => {
  const out = decideClaim({ assignees: [], commenter: 'faizmullaa', openClaims: [], issueNumber: 4 })
  assert.deepEqual(out, { action: 'assign' })
})

test('decideClaim: claiming what you already hold is a no-op', () => {
  const out = decideClaim({
    assignees: [{ login: 'faizmullaa' }],
    commenter: 'faizmullaa',
    openClaims: [{ number: 4 }],
    issueNumber: 4
  })
  assert.equal(out.action, 'noop')
  assert.equal(out.reason, 'already-yours')
})

test('decideClaim: an issue held by someone else is refused, naming the holder', () => {
  const out = decideClaim({
    assignees: [{ login: 'tarun2684' }],
    commenter: 'faizmullaa',
    openClaims: [],
    issueNumber: 8
  })
  assert.equal(out.action, 'refuse')
  assert.equal(out.reason, 'held')
  assert.equal(out.holder, 'tarun2684')
})

test('decideClaim: at the cap, refused and the held issues are reported', () => {
  const out = decideClaim({
    assignees: [],
    commenter: 'faizmullaa',
    openClaims: [{ number: 2 }, { number: 3 }],
    issueNumber: 4
  })
  assert.equal(out.action, 'refuse')
  assert.equal(out.reason, 'cap')
  assert.deepEqual(out.held, [2, 3])
})

test('decideClaim: one below the cap still assigns', () => {
  const out = decideClaim({
    assignees: [],
    commenter: 'faizmullaa',
    openClaims: [{ number: 2 }],
    issueNumber: 4
  })
  assert.deepEqual(out, { action: 'assign' })
})

test('decideClaim: the issue being claimed never counts toward its own cap', () => {
  const out = decideClaim({
    assignees: [],
    commenter: 'faizmullaa',
    openClaims: [{ number: 2 }, { number: 4 }],
    issueNumber: 4
  })
  assert.deepEqual(out, { action: 'assign' })
})

// #8 is why this exists. It is open and unassigned, so without this a stranger
// could /claim it the day the bot shipped and be handed a contributor's
// in-progress work. A label that only stopped the sweep would not have helped.
test('decideClaim: claim-exempt blocks the claim, not just the sweep', () => {
  const out = decideClaim({
    assignees: [],
    commenter: 'griefer',
    openClaims: [],
    issueNumber: 8,
    labels: [{ name: 'claim-exempt' }, { name: 'help wanted' }]
  })
  assert.equal(out.action, 'refuse')
  assert.equal(out.reason, 'exempt')
})

test('decideClaim: an ordinary label does not block a claim', () => {
  const out = decideClaim({
    assignees: [],
    commenter: 'faizmullaa',
    openClaims: [],
    issueNumber: 4,
    labels: [{ name: 'good first issue' }]
  })
  assert.equal(out.action, 'assign')
})

test('decideUnclaim: the holder can release', () => {
  const out = decideUnclaim({ assignees: [{ login: 'faizmullaa' }], commenter: 'faizmullaa' })
  assert.deepEqual(out, { action: 'unassign' })
})

test('decideUnclaim: a non-holder cannot release', () => {
  const out = decideUnclaim({ assignees: [{ login: 'tarun2684' }], commenter: 'faizmullaa' })
  assert.equal(out.action, 'refuse')
  assert.equal(out.reason, 'not-holder')
})

test('decideUnclaim: releasing an unassigned issue is refused', () => {
  const out = decideUnclaim({ assignees: [], commenter: 'faizmullaa' })
  assert.equal(out.action, 'refuse')
})

// GitHub returns 201 and silently drops an ineligible assignee.
// See https://docs.github.com/en/rest/issues/assignees
test('assignLanded: true only when the login is actually in the response', () => {
  assert.equal(assignLanded([{ login: 'faizmullaa' }], 'faizmullaa'), true)
  assert.equal(assignLanded([{ login: 'someone-else' }], 'faizmullaa'), false)
  assert.equal(assignLanded([], 'faizmullaa'), false)
  assert.equal(assignLanded(undefined, 'faizmullaa'), false)
})

const T0 = '2026-07-01T00:00:00Z'

test('quietDays: counts whole elapsed days', () => {
  assert.equal(quietDays(T0, '2026-07-01T00:00:00Z'), 0)
  assert.equal(quietDays(T0, '2026-07-01T23:59:00Z'), 0)
  assert.equal(quietDays(T0, '2026-07-06T00:00:00Z'), 5)
  assert.equal(quietDays(T0, '2026-07-08T12:00:00Z'), 7)
})

test('quietDays: an unparseable timestamp throws rather than returning NaN', () => {
  assert.throws(() => quietDays('not-a-date', T0), TypeError)
})

test('sweepSkipReason: collaborators are never swept', () => {
  assert.equal(sweepSkipReason({ hasPushAccess: true, labels: [] }), 'collaborator')
})

test('sweepSkipReason: claim-exempt is never swept', () => {
  assert.equal(
    sweepSkipReason({ hasPushAccess: false, labels: [{ name: 'claim-exempt' }] }),
    'claim-exempt'
  )
})

test('sweepSkipReason: an ordinary outside claim is sweepable', () => {
  assert.equal(
    sweepSkipReason({ hasPushAccess: false, labels: [{ name: 'good first issue' }] }),
    null
  )
})

test('decideSweep: a fresh claim is left alone', () => {
  const out = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: false,
    nudgedAt: null, now: '2026-07-04T00:00:00Z'
  })
  assert.equal(out.action, 'none')
  assert.equal(out.reason, 'fresh')
  assert.equal(out.days, 3)
})

test('decideSweep: 5 quiet days earns exactly one nudge', () => {
  const out = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: false,
    nudgedAt: null, now: '2026-07-06T00:00:00Z'
  })
  assert.equal(out.action, 'nudge')
  assert.equal(out.days, 5)
})

test('decideSweep: an existing nudge is not repeated', () => {
  const out = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: false,
    nudgedAt: '2026-07-06T00:00:00Z', now: '2026-07-06T12:00:00Z'
  })
  assert.equal(out.action, 'none')
  assert.equal(out.reason, 'already-nudged')
})

test('decideSweep: 7 quiet days releases', () => {
  const out = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: false,
    nudgedAt: '2026-07-06T00:00:00Z', now: '2026-07-08T00:00:00Z'
  })
  assert.equal(out.action, 'release')
  assert.equal(out.days, 7)
})

test('decideSweep: an open linked PR exempts the claim entirely', () => {
  const out = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: true,
    nudgedAt: null, now: '2026-08-01T00:00:00Z'
  })
  assert.equal(out.action, 'none')
  assert.equal(out.reason, 'open-pr')
})

test('decideSweep: a comment from the assignee restarts the clock', () => {
  const out = decideSweep({
    assignedAt: T0,
    assigneeComments: ['2026-07-05T00:00:00Z'],
    hasOpenLinkedPr: false,
    nudgedAt: null,
    now: '2026-07-08T00:00:00Z'
  })
  assert.equal(out.action, 'none')
  assert.equal(out.days, 3)
  assert.equal(out.lastActivity, '2026-07-05T00:00:00Z')
})

test('decideSweep: a comment after a nudge re-arms the nudge', () => {
  const out = decideSweep({
    assignedAt: T0,
    assigneeComments: ['2026-07-07T00:00:00Z'],
    hasOpenLinkedPr: false,
    nudgedAt: '2026-07-06T00:00:00Z',
    now: '2026-07-12T00:00:00Z'
  })
  assert.equal(out.action, 'nudge')
  assert.equal(out.days, 5)
})

test('decideSweep: the newest assignee comment wins, whatever the order', () => {
  const out = decideSweep({
    assignedAt: T0,
    assigneeComments: ['2026-07-05T00:00:00Z', '2026-07-02T00:00:00Z'],
    hasOpenLinkedPr: false,
    nudgedAt: null,
    now: '2026-07-08T00:00:00Z'
  })
  assert.equal(out.days, 3)
})

// The marker is invisible once rendered and published in this very file, so a
// stranger can paste it into a reply on someone else's issue. If that counted as
// a warning it would silence the real nudge AND satisfy the guard release checks,
// releasing a working contributor who was never warned. One comment, no trace.
test('nudgeSentAt: a stranger cannot forge the bot warning', () => {
  const forged = [
    { user: { type: 'User', login: 'griefer' }, body: `nice issue ${NUDGE_MARKER}`, created_at: '2026-07-06T00:00:00Z' }
  ]
  assert.equal(nudgeSentAt(forged), null)
})

test('nudgeSentAt: the bot own nudge counts, and the newest wins', () => {
  const comments = [
    { user: { type: 'Bot', login: 'github-actions[bot]' }, body: `${NUDGE_MARKER}\nstill on this?`, created_at: '2026-07-06T00:00:00Z' },
    { user: { type: 'User', login: 'faizmullaa' }, body: 'yes', created_at: '2026-07-07T00:00:00Z' },
    { user: { type: 'Bot', login: 'github-actions[bot]' }, body: `${NUDGE_MARKER}\nstill on this?`, created_at: '2026-07-12T00:00:00Z' }
  ]
  assert.equal(nudgeSentAt(comments), '2026-07-12T00:00:00Z')
})

test('nudgeSentAt: no nudge, no marker, no comments', () => {
  assert.equal(nudgeSentAt([]), null)
  assert.equal(nudgeSentAt(undefined), null)
  assert.equal(nudgeSentAt([
    { user: { type: 'Bot', login: 'github-actions[bot]' }, body: 'unrelated bot noise', created_at: '2026-07-06T00:00:00Z' }
  ]), null)
})

// The whole point of the author check: end to end, a forged marker must not
// convert into a release.
test('decideSweep: a forged marker cannot release an unwarned contributor', () => {
  const forged = [
    { user: { type: 'User', login: 'griefer' }, body: NUDGE_MARKER, created_at: '2026-07-06T00:00:00Z' }
  ]
  const out = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: false,
    nudgedAt: nudgeSentAt(forged), now: '2026-07-08T00:00:00Z'
  })
  assert.equal(out.action, 'nudge')
  assert.equal(out.reason, 'unwarned')
})

// The bot promises a check-in before it takes anything away. The first live
// sweep meets claims that went stale while it did not exist yet: those have been
// warned exactly never, and releasing them on sight would break that promise on
// day one, to real people, in public.
test('decideSweep: a claim already stale on the first sweep is warned, not released', () => {
  const out = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: false,
    nudgedAt: null, now: '2026-07-11T00:00:00Z'
  })
  assert.equal(out.action, 'nudge')
  assert.equal(out.reason, 'unwarned')
  assert.equal(out.days, 10)
})

test('decideSweep: the 2 days the nudge promises are actually given', () => {
  const nudgedNow = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: false,
    nudgedAt: '2026-07-11T00:00:00Z', now: '2026-07-11T00:00:00Z'
  })
  assert.equal(nudgedNow.action, 'none')
  assert.equal(nudgedNow.reason, 'grace')

  const oneDayLater = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: false,
    nudgedAt: '2026-07-11T00:00:00Z', now: '2026-07-12T00:00:00Z'
  })
  assert.equal(oneDayLater.action, 'none')
  assert.equal(oneDayLater.reason, 'grace')

  const twoDaysLater = decideSweep({
    assignedAt: T0, assigneeComments: [], hasOpenLinkedPr: false,
    nudgedAt: '2026-07-11T00:00:00Z', now: '2026-07-13T00:00:00Z'
  })
  assert.equal(twoDaysLater.action, 'release')
})

// The comment that would have saved this claim is the unreadable one. Compared
// with `>`, its NaN loses, lastActivity falls back to the assignment date, and
// the bot releases someone who spoke yesterday. It must fail loudly instead.
test('decideSweep: an unparseable comment timestamp throws, never releases', () => {
  assert.throws(() => decideSweep({
    assignedAt: T0,
    assigneeComments: ['not-a-date'],
    hasOpenLinkedPr: false,
    nudgedAt: null,
    now: '2026-07-08T00:00:00Z'
  }), TypeError)
})
