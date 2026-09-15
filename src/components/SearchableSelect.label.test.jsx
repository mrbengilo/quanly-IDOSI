import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SearchableSelect } from './SearchableSelect'
import { Field } from './UI'

afterEach(cleanup)

it('prevents a Field label from activating the trigger again after option selection', () => {
  const changed = vi.fn()
  function Form() {
    const [value, setValue] = useState('')
    return <Field label="Nghề nghiệp"><SearchableSelect aria-label="Nghề nghiệp"
      value={value} options={[{ value: 'office', label: 'Nhân viên VP' }]}
      onChange={(event) => { changed(event.target.value); setValue(event.target.value) }} /></Field>
  }
  render(<Form />)
  const trigger = screen.getByRole('combobox', { name: 'Nghề nghiệp' })
  fireEvent.click(trigger)
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  fireEvent(screen.getByRole('option', { name: 'Nhân viên VP' }), click)
  // Chromium can forward the wrapping label's default click to its first button
  // after React unmounts the option. Cancellation must survive that native phase.
  expect(click.defaultPrevented).toBe(true)
  expect(changed).toHaveBeenCalledExactlyOnceWith('office')
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger)
})
