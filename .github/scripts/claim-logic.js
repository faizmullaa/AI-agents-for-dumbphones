'use strict'

const MAX_OPEN_CLAIMS = 2
const NUDGE_AFTER_DAYS = 5
const RELEASE_AFTER_DAYS = 7
const NUDGE_MARKER = '<!-- claim-bot:nudge -->'
const EXEMPT_LABEL = 'claim-exempt'

// The command must be alone on its own line. Without this, "I'll /claim this
// next week" would assign the issue.
function parseCommand (body) {
  if (typeof body !== 'string') return null
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase()
    if (line === '/claim') return 'claim'
    if (line === '/unclaim') return 'unclaim'
  }
  return null
}

// GET /issues?assignee= returns pull requests mixed in with issues.
// https://docs.github.com/en/rest/issues/issues
function issuesOnly (items) {
  return (items || []).filter((i) => !i.pull_request)
}

function hasExemptLabel (labels) {
  return (labels || []).some((l) => l.name === EXEMPT_LABEL)
}

function decideClaim ({ assignees, commenter, openClaims, issueNumber, labels }) {
  // The label means hands off, not merely "do not release". Stopping only the
  // sweep would have left #8 claimable by a stranger the day this shipped, which
  // is the exact thing the label exists to prevent.
  if (hasExemptLabel(labels)) return { action: 'refuse', reason: 'exempt' }

  const current = assignees || []
  if (current.some((a) => a.login === commenter)) {
    return { action: 'noop', reason: 'already-yours' }
  }
  if (current.length > 0) {
    return { action: 'refuse', reason: 'held', holder: current[0].login }
  }
  const others = issuesOnly(openClaims).filter((i) => i.number !== issueNumber)
  if (others.length >= MAX_OPEN_CLAIMS) {
    return { action: 'refuse', reason: 'cap', held: others.map((i) => i.number) }
  }
  return { action: 'assign' }
}

function decideUnclaim ({ assignees, commenter }) {
  if ((assignees || []).some((a) => a.login === commenter)) {
    return { action: 'unassign' }
  }
  return { action: 'refuse', reason: 'not-holder' }
}

// A 201 does not mean the assignment happened: "Assignees are silently
// ignored otherwise." Read the response back and check.
function assignLanded (responseAssignees, login) {
  return Array.isArray(responseAssignees) &&
    responseAssignees.some((a) => a.login === login)
}

const MS_PER_DAY = 86400000

// Every timestamp here decides whether someone keeps their issue. NaN compares
// false against everything, so a bad one flowing onward would not error: it
// would quietly lose a comparison and hand back the wrong date. It stops here.
function parseTime (iso) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new TypeError(`unparseable timestamp: ${iso}`)
  return t
}

function quietDays (lastActivityIso, nowIso) {
  return Math.floor((parseTime(nowIso) - parseTime(lastActivityIso)) / MS_PER_DAY)
}

// Without the push-access skip the bot unassigns @baptistecristo from his own
// issues on day 8. claim-exempt is the hatch for long-running work.
function sweepSkipReason ({ hasPushAccess, labels }) {
  if (hasPushAccess) return 'collaborator'
  if (hasExemptLabel(labels)) return EXEMPT_LABEL
  return null
}

// Only the bot's own comment counts as the bot's warning. The marker is an HTML
// comment — invisible once rendered — and a literal in a public file, so anyone
// can paste it into a reply. Without the author check that forged marker reads as
// "already warned", which both silences the real nudge and satisfies the guard
// that release checks: a stranger could get someone released with one invisible
// comment and no warning ever sent.
function nudgeSentAt (comments) {
  return (comments || [])
    .filter((c) => c.user && c.user.type === 'Bot' && c.body && c.body.includes(NUDGE_MARKER))
    .map((c) => c.created_at)
    .sort()
    .pop() || null
}

function decideSweep ({ assignedAt, assigneeComments, hasOpenLinkedPr, nudgedAt, now }) {
  if (hasOpenLinkedPr) return { action: 'none', reason: 'open-pr', days: 0 }

  const lastActivity = (assigneeComments || []).reduce(
    (latest, c) => (parseTime(c) > parseTime(latest) ? c : latest),
    assignedAt
  )
  const days = quietDays(lastActivity, now)

  // A nudge older than the last activity is stale: the assignee has spoken
  // since, so they have earned a fresh nudge before any release.
  const warned = Boolean(nudgedAt) && parseTime(nudgedAt) >= parseTime(lastActivity)

  if (days >= RELEASE_AFTER_DAYS) {
    // The nudge is a promise — "Otherwise I'll release it in 2 days" — so it has
    // to be kept before the release, not just before the deadline. A claim that
    // was already stale the first time the sweep ran has been warned exactly
    // never, and releasing it here would be the bot breaking its own word.
    if (!warned) return { action: 'nudge', days, lastActivity, reason: 'unwarned' }
    if (quietDays(nudgedAt, now) < RELEASE_AFTER_DAYS - NUDGE_AFTER_DAYS) {
      return { action: 'none', reason: 'grace', days, lastActivity }
    }
    return { action: 'release', days, lastActivity }
  }

  if (days >= NUDGE_AFTER_DAYS) {
    if (warned) return { action: 'none', reason: 'already-nudged', days }
    return { action: 'nudge', days, lastActivity }
  }

  return { action: 'none', reason: 'fresh', days, lastActivity }
}

module.exports = {
  MAX_OPEN_CLAIMS,
  NUDGE_AFTER_DAYS,
  RELEASE_AFTER_DAYS,
  NUDGE_MARKER,
  parseCommand,
  issuesOnly,
  decideClaim,
  decideUnclaim,
  assignLanded,
  quietDays,
  nudgeSentAt,
  sweepSkipReason,
  decideSweep
}
