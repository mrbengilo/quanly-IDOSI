import { readFileSync } from 'node:fs'

const workflowPath = '.github/workflows/deploy-vps.yml'
const workflow = readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')

const requiredFragments = [
  'workflow_dispatch:',
  'workflow_run:',
  '- Verify IDOSI',
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_branch == 'main'",
  "if: github.event_name == 'workflow_dispatch'",
  'environment:',
  'name: production',
  'cancel-in-progress: false',
  'StrictHostKeyChecking=yes',
  'verify-public-release.mjs',
  "PUBLIC_VERIFY_ATTEMPTS: '30'",
  "PUBLIC_VERIFY_DELAY_SECONDS: '5'",
  'attempt<=PUBLIC_VERIFY_ATTEMPTS',
  'sleep "$PUBLIC_VERIFY_DELAY_SECONDS"',
  'id: external_verification',
  'steps.external_verification.outputs.verified_at',
  'steps.external_verification.outputs.verified_origin',
  'steps.external_verification.outputs.verified_sha',
  'EXTERNAL_VERIFY_RUN_ID: ${{ github.run_id }}',
]

const missing = requiredFragments.filter((fragment) => !workflow.includes(fragment))
if (missing.length) {
  throw new Error(`Deploy workflow is missing required automatic-delivery guards: ${missing.join(', ')}`)
}

const triggerStart = workflow.indexOf('\non:\n')
const permissionsStart = workflow.indexOf('\npermissions:\n')
if (triggerStart < 0 || permissionsStart <= triggerStart) {
  throw new Error('Unable to isolate the deploy workflow trigger block.')
}

const triggerBlock = workflow.slice(triggerStart, permissionsStart)
if (/^  (push|pull_request):/m.test(triggerBlock)) {
  throw new Error('Production deployment must not trigger directly from push or pull_request.')
}

if (!/^  workflow_run:/m.test(triggerBlock) || !/^  workflow_dispatch:/m.test(triggerBlock)) {
  throw new Error('Deploy workflow must keep both automatic workflow_run and manual fallback triggers.')
}

const publicVerification = workflow.indexOf('node server/vps/verify-public-release.mjs')
const attestationOutput = workflow.indexOf('echo "verified_at=$(date -u +%Y%m%dT%H%M%SZ)"')
const verifiedShaOutput = workflow.indexOf('echo "verified_sha=$RELEASE_SHA"')
const finalizer = workflow.indexOf("bash '$REMOTE_FINALIZER_SCRIPT'")
if (publicVerification < 0
  || attestationOutput <= publicVerification
  || verifiedShaOutput <= attestationOutput
  || finalizer <= verifiedShaOutput) {
  throw new Error('External verification must pass before attestation output and remote finalization.')
}

console.log('Verified automatic exact-SHA VPS deployment trigger and safety guards.')
