import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Field, Input, MoneyInput } from './UI'

afterEach(cleanup)

const temporalCases = [
  ['date', '2026-08-20'],
  ['time', '08:30'],
  ['month', '2026-08'],
  ['datetime-local', '2026-08-20T08:30'],
]

describe('Input native temporal picker', () => {
  it.each(temporalCases)('opens the native %s picker from anywhere in the visible box', (type, value) => {
    const { container } = render(<Input type={type} value={value} readOnly={false} onChange={() => {}} />)
    const wrapper = container.querySelector('.input-wrap')
    const input = container.querySelector('input')
    const showPicker = vi.fn()
    input.showPicker = showPicker

    fireEvent.click(wrapper)

    expect(showPicker).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(input)
    expect(wrapper.classList.contains('input-wrap--temporal')).toBe(true)
    expect(container.querySelector('.input-wrap__temporal-icon')).toBeTruthy()
  })

  it('does not request the picker twice when the input itself is clicked', () => {
    const { container } = render(<Input type="date" defaultValue="2026-08-20" />)
    const input = container.querySelector('input')
    const showPicker = vi.fn()
    input.showPicker = showPicker

    fireEvent.click(input)

    expect(showPicker).toHaveBeenCalledTimes(1)
  })

  it('keeps controlled value editing intact', () => {
    let changedValue = ''
    const onChange = vi.fn((event) => {
      changedValue = event.target.value
    })
    const { container } = render(<Input type="date" value="2026-08-20" onChange={onChange} />)
    const input = container.querySelector('input')

    fireEvent.change(input, { target: { value: '2026-08-21' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(changedValue).toBe('2026-08-21')
  })

  it.each(['Enter', ' '])('supports the %s keyboard shortcut and preserves the consumer handler', (key) => {
    const onKeyDown = vi.fn()
    const { container } = render(<Input type="month" onKeyDown={onKeyDown} />)
    const input = container.querySelector('input')
    const showPicker = vi.fn()
    input.showPicker = showPicker

    fireEvent.keyDown(input, { key })

    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(showPicker).toHaveBeenCalledTimes(1)
  })

  it('supports the native Alt+ArrowDown keyboard shortcut', () => {
    const { container } = render(<Input type="datetime-local" />)
    const input = container.querySelector('input')
    const showPicker = vi.fn()
    input.showPicker = showPicker

    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true })

    expect(showPicker).toHaveBeenCalledTimes(1)
  })

  it('uses a safe click fallback when showPicker is unavailable', () => {
    const onClick = vi.fn()
    const { container } = render(<Field label="Giờ bắt đầu"><Input type="time" onClick={onClick} /></Field>)
    const wrapper = container.querySelector('.input-wrap')
    const input = container.querySelector('input')
    const focus = vi.spyOn(input, 'focus')
    input.showPicker = undefined

    fireEvent.click(wrapper)

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('respects prevented keyboard events and immutable fields', () => {
    const onKeyDown = vi.fn((event) => event.preventDefault())
    const { container, rerender } = render(<Input type="date" onKeyDown={onKeyDown} />)
    let input = container.querySelector('input')
    const showPicker = vi.fn()
    input.showPicker = showPicker

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(showPicker).not.toHaveBeenCalled()

    rerender(<Input type="date" readOnly />)
    input = container.querySelector('input')
    input.showPicker = showPicker
    fireEvent.click(input)
    expect(showPicker).not.toHaveBeenCalled()

    rerender(<Input type="date" disabled />)
    input = container.querySelector('input')
    input.showPicker = showPicker
    fireEvent.click(input)
    expect(showPicker).not.toHaveBeenCalled()
  })

  it('keeps ordinary text inputs unchanged', () => {
    const { container } = render(<Input type="text" defaultValue="IDOSI" />)

    expect(container.querySelector('.input-wrap--temporal')).toBeNull()
    expect(container.querySelector('.input-wrap__temporal-icon')).toBeNull()
  })
})

describe('MoneyInput VND value preservation', () => {
  it('stays visually empty until typing and preserves 35 as 35 VND', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<MoneyInput aria-label="Số tiền" value="" onChange={onChange} />)

    expect(container.querySelector('input').value).toBe('')
    expect(container.querySelector('.money-input__suffix')).toBeNull()

    fireEvent.change(container.querySelector('input'), { target: { value: '35' } })
    expect(onChange.mock.calls[0][0].target.value).toBe('35')

    rerender(<MoneyInput aria-label="Số tiền" value="35000" onChange={onChange} />)
    expect(container.querySelector('input').value).toBe('35,000')
    expect(container.querySelector('.money-input__suffix').textContent).toBe('đ')
  })

  it('formats an existing VND amount without changing the stored value', () => {
    const { container } = render(<MoneyInput aria-label="Lương" value="8,000,000" onChange={() => {}} />)

    expect(container.querySelector('input').value).toBe('8,000,000')
    expect(container.querySelector('.money-input__suffix').textContent).toBe('đ')
  })

  it('keeps zero and an allowed negative value exact', () => {
    const { container, rerender } = render(<MoneyInput aria-label="Điều chỉnh" value="0" onChange={() => {}} />)
    expect(container.querySelector('input').value).toBe('0')

    rerender(<MoneyInput aria-label="Điều chỉnh" value="-35" onChange={() => {}} />)
    expect(container.querySelector('input').value).toBe('-35')
  })

  it('does not round or scale a large integer string while editing', () => {
    const onChange = vi.fn()
    const { container } = render(<MoneyInput aria-label="Số tiền lớn" value="90071992547409931234" onChange={onChange} />)

    expect(container.querySelector('input').value).toBe('90,071,992,547,409,931,234')
    fireEvent.change(container.querySelector('input'), { target: { value: '00035' } })
    expect(onChange.mock.calls[0][0].target.value).toBe('35')
  })
})
