import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8')
const scheduleCss = readFileSync(new URL('./supportSchedule.css', import.meta.url), 'utf8')

describe('support schedule preset styles', () => {
  it('loads the input visibility override after the global stylesheet', () => {
    const globalImport = mainSource.indexOf("import './styles.css'")
    const scheduleImport = mainSource.indexOf("import './supportSchedule.css'")

    expect(globalImport).toBeGreaterThanOrEqual(0)
    expect(scheduleImport).toBeGreaterThan(globalImport)
    expect(scheduleCss).toMatch(
      /\.support-schedule-preset-config__time-field\s*>\s*\.input-wrap\s*\{[^}]*display:\s*flex;/u,
    )
  })
})
