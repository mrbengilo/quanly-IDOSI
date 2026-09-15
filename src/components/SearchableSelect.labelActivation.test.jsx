import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SearchableSelect } from './SearchableSelect'

afterEach(cleanup)

function LabeledOccupation() {
  const [value, setValue] = useState('')
  return <label>Nghề nghiệp<SearchableSelect aria-label="Nghề nghiệp" value={value}
    options={[{ value: 'engineer', label: 'Kỹ sư' }]}
    onChange={(event) => setValue(event.target.value)} /></label>
}

it('cancels label activation so a selected option cannot reopen and cover following controls', () => {
  render(<LabeledOccupation />)
  const trigger = screen.getByRole('combobox', { name: 'Nghề nghiệp' })
  fireEvent.click(trigger)
  const option = screen.getByRole('option', { name: 'Kỹ sư' })
  const browserDefaultAllowed = fireEvent.click(option)
  expect(browserDefaultAllowed).toBe(false)
  expect(trigger.textContent).toContain('Kỹ sư')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
