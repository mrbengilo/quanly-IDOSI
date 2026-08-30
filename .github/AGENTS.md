# IDOSI GitHub Actions Rules

These rules apply to `.github/`.

- `Verify IDOSI` is the authoritative repository gate for the exact commit SHA.
- Production deployment must remain manually dispatched and reference the
  protected `production` environment.
- The deployment gate must prove the requested full SHA belongs to `main` and has
  a successful `Verify IDOSI` workflow run.
- Production SSH secrets are environment secrets; never echo them or weaken host
  verification. `StrictHostKeyChecking=yes` is mandatory.
- Production deployments use a non-canceling concurrency group so an in-progress
  backup/migration is never interrupted by another run.
- Do not add direct push-to-production behavior on ordinary `push` or
  `pull_request` events.
- External verification must check both `/api/health` and `/api/release`, and the
  release SHA must match exactly.
