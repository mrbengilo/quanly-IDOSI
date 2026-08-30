# IDOSI VPS Deployment Rules

These rules are mandatory for every change under `deploy/vps/`.

## Risk and delivery mode

VPS/runtime/storage/deployment changes are CRITICAL. A merge is not production
proof. Production is delivered automatically only after the authoritative
`Verify IDOSI` workflow succeeds for a `push` to `main`.

`workflow_dispatch` remains available only as a controlled manual re-deploy or
recovery fallback. Both automatic and manual paths must deploy one exact verified
40-character SHA.

## Required release flow

```text
PR + review findings resolved
→ Verify IDOSI PASS
→ merge main
→ Verify IDOSI PASS for exact merge SHA
→ automatic Deploy IDOSI VPS workflow_run
→ production environment + SSH secrets
→ durable detached VPS operation
→ immutable SHA image build
→ traffic stop
→ consistent data-volume backup + checksum
→ app startup/migration
→ internal health + exact SHA
→ Caddy start/local HTTPS check
→ external health + exact SHA
→ finalize report SUCCESS
→ smoke test + observation
```

## Mandatory invariants

- Never deploy a moving branch, `latest`, an unverified SHA or a dirty VPS tree.
- Never deploy from a pull-request verify run or a manually dispatched verify run.
- Never edit tracked source directly on the VPS.
- Never run two production deployments concurrently.
- Never archive SQLite while the app may still be writing; stop traffic/app or
  use a separately proven online-backup mechanism.
- Never start public traffic before the new app passes internal health and exact
  release verification.
- Never mark a report `SUCCESS` before external verification and finalization.
- Never claim `DEPLOYED`, `VERIFIED` or `DONE` without observed evidence.
- Preserve `deploy/vps/.env`; never print or commit its secrets.
- Do not delete the persistent data volume, latest valid backup, deployment
  report or previous rollback image automatically.
- Migration failure before traffic resumes must restore the pre-deploy backup and
  previous image; recovery failure must fail closed.
- A later/manual rollback must create an emergency backup first because restoring
  an older snapshot can discard newer production writes.

## Change requirements

Every deployment change must include applicable targeted tests, shell syntax
validation, workflow guard verification, Compose validation, Docker image
build/runtime verification and rollback/documentation updates. Keep deployment
code, verification and docs in small dependency-ordered commits.
