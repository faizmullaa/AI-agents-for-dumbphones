'use strict'

const { NUDGE_MARKER } = require('./claim-logic.js')

const GOOD_FIRST_ISSUES =
  'https://github.com/baptistecristo/AI-agents-for-dumbphones/issues' +
  '?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22'

const messages = {
  claimed: (user) =>
    `Yours, @${user}. Assigned, so nobody else picks it up.\n\n` +
    "Quiet for 5 days and I'll check in. Quiet for 7 and I'll release it, so it " +
    'doesn\'t sit parked. A comment or a draft PR keeps it. Need longer than a week? ' +
    'Say so here and it stays yours.\n\n' +
    'Stuck, ask right here. `/unclaim` gives it back.',

  alreadyYours: (user) => `You already have this one, @${user}.`,

  // Deliberately does not name a holder: an exempt issue often has no assignee,
  // and inventing one would be the bot stating something it does not know.
  exempt: (user, issueNumber) =>
    `@${user}, #${issueNumber} is already spoken for. Other open ones here:\n` +
    GOOD_FIRST_ISSUES,

  held: (user, issueNumber, holder) =>
    `@${user}, #${issueNumber} is with @${holder} right now. Other open ones here:\n` +
    GOOD_FIRST_ISSUES,

  capReached: (user, heldNumbers) =>
    `@${user}, you're holding ${heldNumbers.map((n) => `#${n}`).join(' and ')} already. ` +
    'Ship or `/unclaim` one of those and this is yours.',

  assignFailed: (user) =>
    `@${user}, GitHub refused the assignment and I don't know why. Nothing you did wrong.\n` +
    '@baptistecristo will sort it by hand.',

  unclaimed: (issueNumber) =>
    `Released, #${issueNumber} is open again. Thanks for saying so instead of going quiet.`,

  notHolder: (user, issueNumber) =>
    `@${user}, you're not holding #${issueNumber}, so there's nothing to give back.`,

  nudge: (user) =>
    `${NUDGE_MARKER}\n` +
    `@${user}, still on this? A comment or a draft PR keeps it yours. If it's gone cold, ` +
    "`/unclaim` hands it to someone else. Otherwise I'll release it in 2 days.",

  // The number is the real count, not the threshold. The bot warns before it
  // releases, so a claim that was already stale when the sweep first ran gets
  // its warning then and is released later than day 7. Quoting "7" there would
  // be the bot stating a fact it can see is wrong.
  released: (issueNumber, user, days) =>
    `Released #${issueNumber} after ${days} quiet days. @${user} if you're still on it, ` +
    '`/claim` takes it back.'
}

module.exports = { messages, GOOD_FIRST_ISSUES }
