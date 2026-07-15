'use strict'

const {
  parseCommand, issuesOnly, decideClaim, decideUnclaim, assignLanded
} = require('./claim-logic.js')
const { messages } = require('./claim-messages.js')

module.exports = async function run ({ github, context, core }) {
  const { owner, repo } = context.repo
  const issue = context.payload.issue
  const commenter = context.payload.comment.user.login

  // Read the body as a JS string. Never let it near a shell.
  const command = parseCommand(context.payload.comment.body)
  if (!command) {
    core.info('no command in comment, nothing to do')
    return
  }
  core.info(`${commenter} sent /${command} on #${issue.number}`)

  const say = (body) =>
    github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body })

  // Re-read the issue: the payload is a snapshot and may be stale.
  const { data: fresh } = await github.rest.issues.get({
    owner, repo, issue_number: issue.number
  })
  if (fresh.state !== 'open') {
    core.info('issue is closed, ignoring')
    return
  }

  if (command === 'unclaim') {
    const out = decideUnclaim({ assignees: fresh.assignees, commenter })
    if (out.action === 'refuse') {
      await say(messages.notHolder(commenter, issue.number))
      return
    }
    const { data: left } = await github.rest.issues.removeAssignees({
      owner, repo, issue_number: issue.number, assignees: [commenter]
    })
    // The mirror of the claim read-back below: "Released" is a claim about the
    // world, so confirm it. There is no approved copy for a failed release, and
    // inventing public text is not ours to do, so fail the run loudly and say
    // nothing rather than say something false.
    if (assignLanded(left.assignees, commenter)) {
      core.setFailed(`unassign of ${commenter} from #${issue.number} did not land`)
      return
    }
    await say(messages.unclaimed(issue.number))
    return
  }

  const { data: assigned } = await github.rest.issues.listForRepo({
    owner, repo, assignee: commenter, state: 'open', per_page: 100
  })
  const openClaims = issuesOnly(assigned)

  const out = decideClaim({
    assignees: fresh.assignees,
    commenter,
    openClaims,
    issueNumber: issue.number,
    labels: fresh.labels
  })

  if (out.action === 'noop') {
    await say(messages.alreadyYours(commenter))
    return
  }
  if (out.action === 'refuse' && out.reason === 'exempt') {
    await say(messages.exempt(commenter, issue.number))
    return
  }
  if (out.action === 'refuse' && out.reason === 'held') {
    await say(messages.held(commenter, issue.number, out.holder))
    return
  }
  if (out.action === 'refuse' && out.reason === 'cap') {
    await say(messages.capReached(commenter, out.held))
    return
  }

  // Everything above returns. If decideClaim ever grows a refusal this does not
  // know about, falling through would assign the issue — a refusal silently
  // becoming a grant. Say nothing and make the run red instead.
  if (out.action !== 'assign') {
    core.setFailed(`unhandled decideClaim result: ${JSON.stringify(out)}`)
    return
  }

  // Two ways this fails and both end the same: the assignee is not on the issue.
  // A 201 does not mean it landed ("Assignees are silently ignored otherwise"),
  // and a throw means it certainly did not. Never tell someone they hold an
  // issue they do not.
  let after = null
  try {
    ({ data: after } = await github.rest.issues.addAssignees({
      owner, repo, issue_number: issue.number, assignees: [commenter]
    }))
  } catch (err) {
    core.warning(`addAssignees threw for ${commenter} on #${issue.number}: ${err.message}`)
  }

  if (!after || !assignLanded(after.assignees, commenter)) {
    core.warning(`assign of ${commenter} to #${issue.number} did not land`)
    await say(messages.assignFailed(commenter))
    return
  }
  await say(messages.claimed(commenter))
}
