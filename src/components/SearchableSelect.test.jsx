import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchableSelect } from './SearchableSelect'

const occupationOptions = [
  { value: 'engineer', label: 'Kỹ sư' },
  { value: 'nurse', label: 'Điều dưỡng' },
  { value: 'chef', label: 'Đầu bếp' },
]

afterEach(cleanup)

function ControlledSelect({ onChange = () => {}, ...props }) {
  const [value, setValue] = useState(props.value || '')
  const handleChange = (event) => {
    onChange(event)
    setValue(event.target.value)
  }

  return (
    <SearchableSelect
      {...props}
      value={value}
      onChange={handleChange}
    />
  )
}

describe('SearchableSelect', () => {
  it('opens from focus with accessible combobox and listbox semantics', async () => {
    render(
      <SearchableSelect
        aria-label="Nghề nghiệp"
        name="occupation"
        value=""
        onChange={() => {}}
        options={occupationOptions}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Nghề nghiệp' })
    expect(trigger.textContent).toContain('Chọn')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.focus(trigger)

    const search = await screen.findByRole('searchbox', { name: 'Tìm Nghề nghiệp' })
    const listbox = screen.getByRole('listbox', { name: 'Nghề nghiệp - danh sách' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(search)
    expect(search.compareDocumentPosition(listbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
    expect(document.querySelector('input[type="hidden"][name="occupation"]').value).toBe('')
  })

  it('filters labels case-insensitively and without Vietnamese diacritics', async () => {
    render(
      <SearchableSelect
        aria-label="Nghề nghiệp"
        value=""
        onChange={() => {}}
        options={occupationOptions}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Nghề nghiệp' }))
    const search = await screen.findByRole('searchbox')

    fireEvent.change(search, { target: { value: 'KY SU' } })
    expect(screen.getByRole('option', { name: 'Kỹ sư' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Điều dưỡng' })).toBeNull()

    fireEvent.change(search, { target: { value: 'dau bep' } })
    expect(screen.getByRole('option', { name: 'Đầu bếp' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Kỹ sư' })).toBeNull()
  })

  it('emits a native-like change event only after selecting a real option', async () => {
    const onChange = vi.fn()
    render(
      <ControlledSelect
        aria-label="Nghề nghiệp"
        name="occupation"
        value=""
        onChange={onChange}
        options={occupationOptions}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Nghề nghiệp' }))
    const search = await screen.findByRole('searchbox')

    fireEvent.change(search, { target: { value: 'nghe tu do' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox').textContent).toContain('Chọn')

    fireEvent.change(search, { target: { value: 'dieu duong' } })
    fireEvent.click(screen.getByRole('option', { name: 'Điều dưỡng' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const changeEvent = onChange.mock.calls[0][0]
    expect(changeEvent.target).toEqual({ name: 'occupation', value: 'nurse' })
    expect(changeEvent.currentTarget).toEqual({ name: 'occupation', value: 'nurse' })
    expect(changeEvent.type).toBe('change')
    expect(screen.getByRole('combobox').textContent).toContain('Điều dưỡng')
    expect(document.querySelector('input[type="hidden"][name="occupation"]').value).toBe('nurse')
  })

  it('closes on outside pointer or Escape and stays closed after restoring trigger focus', async () => {
    render(
      <SearchableSelect
        aria-label="Nghề nghiệp"
        value=""
        onChange={() => {}}
        options={occupationOptions}
      />,
    )
    const trigger = screen.getByRole('combobox')

    fireEvent.click(trigger)
    expect(await screen.findByRole('listbox')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(trigger)
    expect(await screen.findByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('shows loading, empty, and error states without enabling selection', async () => {
    const { rerender } = render(
      <SearchableSelect
        aria-label="Nghề nghiệp"
        value=""
        onChange={() => {}}
        options={occupationOptions}
        loading
      />,
    )
    fireEvent.click(screen.getByRole('combobox'))
    expect((await screen.findByRole('status')).textContent).toContain('Đang tải...')
    expect(screen.getByRole('searchbox').disabled).toBe(true)

    rerender(
      <SearchableSelect aria-label="Nghề nghiệp" value="" onChange={() => {}} options={[]} />,
    )
    expect(screen.getByRole('status').textContent).toContain('Không có lựa chọn.')

    rerender(
      <SearchableSelect
        aria-label="Nghề nghiệp"
        value=""
        onChange={() => {}}
        options={occupationOptions}
        error="Không tải được nghề nghiệp."
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain('Không tải được nghề nghiệp.')
    expect(screen.getByRole('combobox').getAttribute('aria-invalid')).toBe('true')
  })

  it('supports Arrow and Enter selection while skipping disabled options', async () => {
    const onChange = vi.fn()
    render(
      <SearchableSelect
        aria-label="Nghề nghiệp"
        name="occupation"
        value=""
        onChange={onChange}
        options={[
          { value: 'blocked', label: 'Không áp dụng', disabled: true },
          { value: 'engineer', label: 'Kỹ sư' },
        ]}
      />,
    )
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const search = await screen.findByRole('searchbox')
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].target.value).toBe('engineer')
  })

  it('does not open when disabled', () => {
    render(
      <SearchableSelect
        aria-label="Nghề nghiệp"
        value=""
        onChange={() => {}}
        options={occupationOptions}
        disabled
      />,
    )
    const trigger = screen.getByRole('combobox')
    expect(trigger.disabled).toBe(true)
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
