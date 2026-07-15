'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { messages } = require('./claim-messages.js')
const {
  NUDGE_MARKER, NUDGE_AFTER_DAYS, RELEASE_AFTER_DAYS
} = require('./claim-logic.js')

test('claimed: names the user and states both thresholds', () => {
  const m = messages.claimed('faizmullaa')
  assert.match(m, /@faizmullaa/)
  assert.match(m, /5 days/)
  assert.match(m, /Quiet for 7/)
  assert.match(m, /\/unclaim/)
})

test('nudge: carries the idempotency marker', () => {
  assert.ok(messages.nudge('faizmullaa').includes(NUDGE_MARKER))
})

test('nudge: no other message carries the marker', () => {
  assert.ok(!messages.claimed('a').includes(NUDGE_MARKER))
  assert.ok(!messages.released(4, 'a', 7).includes(NUDGE_MARKER))
})

test('held: names the holder and the issue', () => {
  const m = messages.held('faizmullaa', 8, 'tarun2684')
  assert.match(m, /@faizmullaa/)
  assert.match(m, /#8/)
  assert.match(m, /@tarun2684/)
})

test('capReached: lists every held issue', () => {
  const m = messages.capReached('faizmullaa', [2, 3])
  assert.match(m, /#2/)
  assert.match(m, /#3/)
})

test('assignFailed: admits the failure and pulls in the maintainer', () => {
  const m = messages.assignFailed('faizmullaa')
  assert.match(m, /@baptistecristo/)
  assert.match(m, /Nothing you did wrong/)
})

// The bot warns before it releases, so a claim already stale on the first sweep
// is released later than day 7. Quoting the threshold there would have the bot
// stating a number its own tests prove wrong.
test('released: reports the real quiet days, not the threshold', () => {
  assert.match(messages.released(8, 'faizmullaa', 12), /after 12 quiet days/)
  assert.doesNotMatch(messages.released(8, 'faizmullaa', 12), /after 7 quiet days/)
})

test('exempt: refuses without inventing a holder', () => {
  const m = messages.exempt('griefer', 8)
  assert.match(m, /@griefer/)
  assert.match(m, /#8/)
  assert.match(m, /spoken for/)
  // An exempt issue usually has nobody assigned. Naming one would be a lie.
  assert.doesNotMatch(m, /is with @/)
})

test('every message is non-empty', () => {
  assert.ok(messages.alreadyYours('a').length > 0)
  assert.ok(messages.unclaimed(4).length > 0)
  assert.ok(messages.notHolder('a', 4).length > 0)
  assert.ok(messages.released(4, 'a', 7).length > 0)
})

// Each of these is addressed TO a person. Emptying the body or dropping the
// @-mention used to pass the whole suite, which is a poor guard on text the bot
// posts publicly at a named stranger.
test('nudge: says something to the user, not just the marker', () => {
  const m = messages.nudge('faizmullaa')
  assert.match(m, /@faizmullaa/)
  assert.match(m, /\/unclaim/)
  assert.ok(m.replace(NUDGE_MARKER, '').trim().length > 40)
})

test('every message that addresses someone names them', () => {
  assert.match(messages.alreadyYours('faizmullaa'), /@faizmullaa/)
  assert.match(messages.capReached('faizmullaa', [2, 3]), /@faizmullaa/)
  assert.match(messages.assignFailed('faizmullaa'), /@faizmullaa/)
  assert.match(messages.notHolder('faizmullaa', 4), /@faizmullaa/)
  assert.match(messages.released(4, 'faizmullaa', 7), /@faizmullaa/)
})

test('every message about an issue names the number', () => {
  assert.match(messages.held('a', 8, 'b'), /#8/)
  assert.match(messages.unclaimed(4), /#4/)
  assert.match(messages.notHolder('a', 4), /#4/)
  assert.match(messages.released(4, 'a', 7), /#4/)
})

// The nudge promises release "in 2 days". Nothing derives that from the
// constants, so retuning either threshold would have the bot lying publicly.
// Locking the arithmetic here fails the build instead, and leaves the approved
// copy untouched.
test('nudge copy still matches the thresholds it quotes', () => {
  assert.equal(RELEASE_AFTER_DAYS - NUDGE_AFTER_DAYS, 2)
  assert.match(messages.nudge('a'), /in 2 days/)
  assert.match(messages.claimed('a'), new RegExp(`Quiet for ${NUDGE_AFTER_DAYS} days`))
  assert.match(messages.claimed('a'), new RegExp(`Quiet for ${RELEASE_AFTER_DAYS}`))
  assert.match(messages.released(4, 'a', RELEASE_AFTER_DAYS), new RegExp(`after ${RELEASE_AFTER_DAYS} quiet days`))
})
