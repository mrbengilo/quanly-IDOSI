# IDOSI VPS Deployment Rules

These rules are mandatory for every change under `deploy/vps/`.

## Risk and approval

VPS/runtime/storage/deployment changes are CRITICAL. Never deploy production
merely because a PR merged. Production requires an exact verified release SHA,
a successful backup, the protected `production` environment approval, health
checks and release identity verification.

## Required release flow

```text
Verify IDOSI PASS for exact main SHA
→ manual Deploy IDOSI VPS dispatch
→ production approval
→ clean VPS/preflight
→ immutable SHA-tagged image build
→ traffic stop
→ consistent data-volume backup + checksum
→ app startup/migration
→ internal health + exact SHA
→ Caddy start/local HTTPS check
→ external health + exact SHA
→ smoke test/report
```

## Mandatory invariants

- Never deploy a moving branch, `latest`, an unverified SHA or a dirty VPS tree.
- Never edit tracked source directly on the VPS.
- Never run two production deployments concurrently.
- Never archive SQLite while the app may still be writing unless using a proven
  online-backup mechanism; the current workflow stops traffic/app briefly.
- Never start public traffic before the new app passes internal health and exact
  release verification.
- Never claim `DEPLOYED`, `VERIFIED` or `DONE` without observed evidence.
- Preserve `deploy/vps/.env`; never print or commit its secrets.
- Do not delete the persistent data volume, deployment report, latest valid
  backup or previous rollback image automatically.
- Migration failure before traffic resumes must restore the pre-deploy backup and
  previous image.
- A later/manual rollback must create an emergency backup first because restoring
  an older snapshot can discard newer production writes.

## Change requirements

Every deployment change must include applicable targeted tests, shell syntax
validation, Compose validation, Docker image build/runtime verification and
rollback/documentation updates. Keep deployment code, verification and docs in
small dependency-ordered commits.
