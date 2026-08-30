# IDOSI GitHub Actions Rules

These rules apply to `.github/`.

- `Verify IDOSI` is the authoritative repository gate for the exact commit SHA.
- A successful `Verify IDOSI` run may start production automatically only when
  the original event was `push`, the verified branch was `main`, and the
  workflow conclusion was `success`.
- `Deploy IDOSI VPS` must use the exact `workflow_run.head_sha`; it must never
  deploy a moving branch head, an unverified SHA, a pull-request run or a manual
  `Verify IDOSI` run.
- Keep `workflow_dispatch` as a controlled manual re-deploy/fallback path. Manual
  runs must still prove the full SHA belongs to `main` and has a successful
  push/main `Verify IDOSI` run.
- Production deployment must reference the `production` environment. For the
  user's fully automatic delivery mode, that environment is restricted to
  `main`, has no wait timer and no required reviewer; SSH secrets remain scoped
  to the environment.
- Production SSH secrets must never be echoed or committed. Host verification
  may not be weakened; `StrictHostKeyChecking=yes` is mandatory.
- Production deployments use a non-canceling concurrency group so an in-progress
  backup, migration or rollback is never interrupted by another release.
- Do not add direct production triggers on ordinary `push` or `pull_request`.
  Automatic delivery is chained only from the completed authoritative verify
  workflow.
- External verification must check `/api/health`, `/api/release`, the exact
  release SHA and the public root page before the report becomes `SUCCESS`.
- After merging a user-requested change, monitor both the push/main verify run
  and its automatic production deployment. Do not report `DEPLOYED`, `VERIFIED`
  or `DONE` until actual production evidence is observed.
