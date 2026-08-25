import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { describe, expect, it } from 'vitest'

const appStyles = readFileSync(resolve(cwd(), 'src/styles.css'), 'utf8')
const surveyStyles = readFileSync(resolve(cwd(), 'src/pages/admin/CustomerSurveyPage.css'), 'utf8')
const scheduleStyles = readFileSync(resolve(cwd(), 'src/pages/store/UnifiedSchedule.css'), 'utf8')

function declarationsFor(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] || ''
}

describe('responsive CSS contracts', () => {
  it('keeps shared horizontal tables inside their containing block', () => {
    const declarations = declarationsFor(appStyles, '.table-scroll')

    expect(declarations).toContain('display:block')
    expect(declarations).toContain('width:auto')
    expect(declarations).toContain('min-width:0')
    expect(declarations).toContain('max-width:100%')
  })

  it('defines shared grid, wrapping, popup, and support-history containment', () => {
    expect(declarationsFor(appStyles, '.metrics-grid--3')).toContain('repeat(3,minmax(0,1fr))')
    expect(declarationsFor(appStyles, '.section-heading')).toContain('flex-wrap:wrap')
    expect(declarationsFor(appStyles, '.info-note>div')).toContain('overflow-wrap:anywhere')
    expect(declarationsFor(appStyles, '.store-settings-hero>div')).toContain('min-width:0')
    expect(appStyles).toContain('.support-schedule-history .table-scroll')
    expect(appStyles).not.toContain('.support-schedule-history .table-wrap')
    expect(appStyles).toContain('.task-notification-popup { inset-inline:10px;width:auto; }')
    expect(appStyles).not.toContain('overflow-x:clip')
  })

  it('lets survey distribution tables fit their responsive cards', () => {
    const tableDeclarations = declarationsFor(
      surveyStyles,
      '.customer-survey-distribution .table-scroll table',
    )

    expect(tableDeclarations).toContain('min-width: 100%')
    expect(tableDeclarations).toContain('table-layout: fixed')
    expect(surveyStyles).toMatch(/@media \(max-width: 1100px\)[\s\S]*?\.customer-survey-grid/)
  })

  it('keeps the complete reusable shift time visible instead of truncating it', () => {
    const declarations = declarationsFor(scheduleStyles, '.schedule-shift-card__content b')

    expect(declarations).toContain('white-space: normal')
    expect(declarations).not.toContain('text-overflow: ellipsis')
  })

  it('uses admin work-registration hooks for a compact mobile schedule grid', () => {
    expect(appStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.work-registration-page \{ gap:10px; \}/)
    expect(declarationsFor(appStyles, '.work-registration-grid .my-work-schedule-grid__employee')).toContain('min-width:124px!important')
    expect(declarationsFor(appStyles, '.work-registration-grid th,.work-registration-grid td')).toContain('min-width:116px')
    expect(declarationsFor(appStyles, '.work-registration-grid .my-work-schedule-shift')).toContain('min-height:76px')
    expect(declarationsFor(appStyles, '.work-registration-grid .my-work-schedule-employee .avatar')).toContain('width:30px!important')
  })
})
