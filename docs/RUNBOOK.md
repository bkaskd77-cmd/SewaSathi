# Runbook

What to do when something is stuck. One section per situation, exact steps, exact
destinations. Every procedure here is one a person has actually had to carry out.

---

## The deploy gate has locked production

**Symptom.** Vercel deployments read **CANCELED** seconds after they start, with
`errorLink: .../ignored-build-step` on the deployment record. The build log's last
line is `SKIP — CI is not green: <check> (<conclusion>).` Nothing reaches
production, and every GitHub tick for the commit may look fine.

**Why it happens.** `scripts/vercel-ignore-build.mjs` is fail-closed: a commit
whose CI is not green does not deploy. That is correct, and it creates one
deadlock — **a check that can only pass once something is deployed, failing.**
Then the red check refuses the deploy that would clear it.

It happened on 2026-10-17. `HEALTH_SECRET` was added in Vercel at 11:02; the
deployment answering had been built at 09:46 and had never seen the variable, so
`check:drift` could not read the detailed `/api/health` payload and the
`fingerprints` check went red. From then on the gate skipped every build of that
commit, including the one that would have carried the variable. What escaped it
was the next commit — a different sha the red check had never been reported
against — and that it carried real work was luck. With nothing to commit it would
have had to be a commit whose whole content is "let the gate open".

### 0. The one that has already happened

`after-deploy.yml`'s `fingerprints` job exited 2 on three consecutive commits
because that step was never given `HEALTH_SECRET` when `db.functions` moved
behind the bearer token. Both halves are fixed — the gate no longer counts it,
and the step now carries the token — and `tests/unit/drift-token.test.ts` fails
if any `check-drift.mjs` invocation loses it again. If `fingerprints` is red and
the log ends `exit code 2` with "No HEALTH_SECRET or CRON_SECRET in the
environment", that regression is back and the fix is one `env:` line, not an
override.

### 1. Then check whether the deadlock is still possible

The three checks that are answers *about a deployment* rather than about the
commit — `deploy`, `fingerprints`, `deployed` — are exempt now
(`ABOUT_A_DEPLOYMENT` in that script). If one of those is the red check, the gate
no longer blocks and there is nothing to do here; look for a different cause.

### 2. Decide whether a deploy is genuinely the remedy

Read the failing check's log. There are only two honest answers:

- **A configuration fault outside the repository** — a Vercel environment
  variable that is set but has never reached a build, a rotated credential, a
  dashboard toggle. A deploy is the remedy, because the variable only reaches a
  function through a new build. Go on to step 3.
- **Anything else** — a failing test, a type error, a budget regression, a real
  drift between the migrations and the live database. **Fix it with a commit.**
  The gate is right and the override is not for this.

`verify` is never a configuration fault. It runs entirely inside the repository.

### 3. Set the override

Vercel → the **SewaSathi** project → **Settings** → **Environment Variables** →
**Add New**:

| Field | Value |
| --- | --- |
| Key | `DEPLOY_GATE_OVERRIDE` |
| Value | `<commit-sha>:<check-name>` |
| Environments | **Production** only |

`<commit-sha>` is at least the first 7 characters of the stuck commit —
`git rev-parse --short HEAD` in your clone. `<check-name>` is the GitHub check
exactly as it appears on the commit (`fingerprints`, not "Compare live function
fingerprints"). Several are comma-separated: `a1b2c3d:fingerprints,deployed`.

Example value: `d6899c4:fingerprints`

### 4. Ask for a build

Vercel → the project → **Deployments** → the top entry → the **⋯** menu →
**Redeploy** → leave "Use existing Build Cache" unticked → **Redeploy**.

(The `ignoreCommand` runs on every build and reads the environment at build time,
which is why no new commit is needed.)

### 5. Confirm it was the override that opened the gate

In the new deployment's **Building** log, the first line is from the ignore step
and must read:

```
BUILD — OVERRIDDEN on d6899c4 — DEPLOY_GATE_OVERRIDE forgave fingerprints (failure); passed: verify. Remove the variable once this build has landed.
```

If it instead says `SKIP — … forgiving nothing`, the sha does not match the
commit Vercel is building; correct the value and redeploy. If it says
`name every check you mean to forgive`, the value contained `*`, `all`, `any` or
`everything` — those are refused, deliberately.

### 6. Remove the variable

Vercel → **Settings** → **Environment Variables** → `DEPLOY_GATE_OVERRIDE` →
**⋯** → **Remove**.

It expires on its own — the next commit is a different sha and the override is
inert — so forgetting it does not leave the gate open. Remove it anyway, so the
next reader does not have to work out whether it is live.

### What the override cannot do

Four refusals, each deliberate. None of them is configurable.

1. **It names one commit.** A prefix shorter than 7 characters is refused, and a
   prefix that is not this commit's forgives nothing.
2. **It names the checks.** A failure nobody named still skips, and the log says
   which. "Let this commit through" is not expressible.
3. **No wildcard.** `*`, `all`, `any` and `everything` are refused by name.
4. **It forgives a verdict, never an absence.** A check still running, or one
   that never reported, skips exactly as before. Setting the variable can never
   make "CI has not started yet" deployable.

---

## A new environment variable is not taking effect

**It needs a new build, never a re-run.** Vercel injects environment variables at
build time, so:

- Re-running CI by `workflow_dispatch` changes nothing on its own:
  `scripts/await-deploy.mjs` polls the alias for the commit it is deploying, the
  alias is already serving that commit, so it returns in seconds and every check
  measures the **old** build.
- A deploy hook fired for a commit already serving proves nothing either.

So: commit something, or use the Redeploy button in step 4 above. If the commit
is also red for the reason the variable fixes, that is the deadlock — the section
above is the way through.

**Which of three causes it is, is readable.** `npm run check:drift` prints the
deployment's own refusal hint on failure, which names the variable the
**deployment** holds. A token sent with no detail returned means one of: the
deployment lacks the variable, the two values differ, or the build predates the
variable. The hint separates them.

**Both sides of a token are trimmed.** One value typed once and pasted twice
carries a trailing newline invisibly, and the comparison then fails with the
token looking correct on both screens.
