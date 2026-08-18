import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddressAutocomplete } from './StructuredAddressAutocomplete'

vi.mock('../services/idosiApi', () => ({
  apiAddressSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
}))

function AddressHarness() {
  const [value, setValue] = useState({
    province: 'Hà Nội',
    ward: 'Ba Đình',
    street: '12 Kim Mã',
  })
  return <AddressAutocomplete value={value} onChange={setValue} />
}

afterEach(cleanup)

describe('AddressAutocomplete typing', () => {
  it('keeps trailing and internal spaces without losing focus while typing', () => {
    render(<AddressHarness />)
    const province = screen.getByLabelText(/Tỉnh \/ Thành phố/i)

    province.focus()
    fireEvent.change(province, { target: { value: 'Hồ ' } })
    expect(province.value).toBe('Hồ ')
    expect(document.activeElement).toBe(province)
    expect(screen.getByLabelText(/Phường \/ Xã/i).value).toBe('Ba Đình')

    fireEvent.change(province, { target: { value: 'Hồ Chí Minh' } })
    expect(province.value).toBe('Hồ Chí Minh')
    expect(document.activeElement).toBe(province)

    const ward = screen.getByLabelText(/Phường \/ Xã/i)
    ward.focus()
    fireEvent.change(ward, { target: { value: 'Hiệp Bình ' } })
    expect(ward.value).toBe('Hiệp Bình ')
    expect(document.activeElement).toBe(ward)

    const street = screen.getByLabelText(/Đường, số nhà/i)
    street.focus()
    fireEvent.change(street, { target: { value: '12 Phạm Văn Đồng' } })
    expect(street.value).toBe('12 Phạm Văn Đồng')
    expect(document.activeElement).toBe(street)
  })

  it('only clears dependent fields after the changed parent field is committed', () => {
    render(<AddressHarness />)
    const province = screen.getByLabelText(/Tỉnh \/ Thành phố/i)

    fireEvent.focus(province)
    fireEvent.change(province, { target: { value: 'Hồ Chí Minh ' } })
    expect(screen.getByLabelText(/Phường \/ Xã/i).value).toBe('Ba Đình')

    fireEvent.blur(province)
    expect(province.value).toBe('Hồ Chí Minh')
    expect(screen.getByLabelText(/Phường \/ Xã/i).value).toBe('')
    expect(screen.getByLabelText(/Đường, số nhà/i).value).toBe('')
  })
})
