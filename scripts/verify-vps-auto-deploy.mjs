import { readFileSync } from 'node:fs'

const workflowPath = '.github/workflows/deploy-vps.yml'
const workflow = readFileSync(workflowPath, 'utf8')

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

console.log('Verified automatic exact-SHA VPS deployment trigger and safety guards.')
