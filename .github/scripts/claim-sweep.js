'use strict'

const {
  issuesOnly, sweepSkipReason, decideSweep, nudgeSentAt, assignLanded
} = require('./claim-logic.js')
const { messages } = require('./claim-messages.js')

async function hasPushAccess (github, owner, repo, username) {
  try {
    await github.rest.repos.checkCollaborator({ owner, repo, username })
    return true
  } catch (err) {
    if (err.status === 404) return false
    throw err
  }
}

module.exports = async function run ({ github, context, core }) {
  const { owner, repo } = context.repo
  const live = process.env.CLAIM_SWEEP_LIVE === 'true'
  const now = new Date().toISOString()

  if (!live) core.info('CLAIM_SWEEP_LIVE is not "true" — logging only, changing nothing')

  const issues = issuesOnly(
    await github.paginate(github.rest.issues.listForRepo, {
      owner, repo, state: 'open', assignee: '*', per_page: 100
    })
  )

  for (const issue of issues) {
    const assignee = issue.assignees[0]
    if (!assignee) continue

    const skip = sweepSkipReason({
      hasPushAccess: await hasPushAccess(github, owner, repo, assignee.login),
      labels: issue.labels
    })
    if (skip) {
      core.info(`#${issue.number}: skip (${skip})`)
      continue
    }

    const timeline = await github.paginate(github.rest.issues.listEventsForTimeline, {
      owner, repo, issue_number: issue.number, per_page: 100
    })

    const assignedAt = timeline
      .filter((e) => e.event === 'assigned' && e.assignee && e.assignee.login === assignee.login)
      .map((e) => e.created_at)
      .sort()
      .pop()

    if (!assignedAt) {
      core.info(`#${issue.number}: no assigned event for ${assignee.login}, skipping`)
      continue
    }

    const hasOpenLinkedPr = timeline.some(
      (e) => e.event === 'cross-referenced' &&
        e.source && e.source.issue &&
        e.source.issue.pull_request &&
        e.source.issue.state === 'open'
    )

    const comments = await github.paginate(github.rest.issues.listComments, {
      owner, repo, issue_number: issue.number, per_page: 100
    })
    const assigneeComments = comments
      .filter((c) => c.user.login === assignee.login && c.user.type !== 'Bot')
      .map((c) => c.created_at)

    const nudgedAt = nudgeSentAt(comments)

    const out = decideSweep({ assignedAt, assigneeComments, hasOpenLinkedPr, nudgedAt, now })
    core.info(`#${issue.number} (${assignee.login}): ${out.action} after ${out.days}d quiet`)

    if (out.action === 'none') continue
    if (!live) {
      core.info(`#${issue.number}: would ${out.action} (dry run)`)
      continue
    }

    if (out.action === 'nudge') {
      await github.rest.issues.createComment({
        owner, repo, issue_number: issue.number, body: messages.nudge(assignee.login)
      })
    } else if (out.action === 'release') {
      const { data: left } = await github.rest.issues.removeAssignees({
        owner, repo, issue_number: issue.number, assignees: [assignee.login]
      })
      // Same rule as the /unclaim path: "Released" is a claim about the world, so
      // do not make it unless GitHub agrees the assignee is actually gone.
      if (assignLanded(left.assignees, assignee.login)) {
        core.setFailed(`release of ${assignee.login} from #${issue.number} did not land`)
        continue
      }
      await github.rest.issues.createComment({
        owner, repo, issue_number: issue.number,
        body: messages.released(issue.number, assignee.login, out.days)
      })
    }
  }
}
