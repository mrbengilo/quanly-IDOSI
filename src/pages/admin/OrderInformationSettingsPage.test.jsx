import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../../domain/orderInformationSettings'
import { OrderInformationSettingsPage } from './OrderInformationSettingsPage'

const createOrderInformationOption = vi.fn(async () => ({ ok: true }))
const deleteOrderInformationOption = vi.fn(async () => ({ ok: true }))

vi.mock('../../state/AppContext', () => ({
  useApp: () => ({
    apiStatus: 'connected',
    orderInformationOptions: DEFAULT_ORDER_INFORMATION_OPTIONS,
    createOrderInformationOption,
    updateOrderInformationOption: vi.fn(async () => ({ ok: true })),
    deleteOrderInformationOption,
    restoreOrderInformationOption: vi.fn(async () => ({ ok: true })),
    reorderOrderInformationOptions: vi.fn(async () => ({ ok: true })),
    notify: vi.fn(),
  }),
}))

describe('OrderInformationSettingsPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows protected payment methods and active occupation data', () => {
    render(<OrderInformationSettingsPage />)
    expect(screen.getByText('Tiền mặt')).toBeTruthy()
    expect(screen.getByText('Chuyển khoản')).toBeTruthy()
    expect(screen.getByText('Nhân viên VP')).toBeTruthy()
  })

  it('creates an occupation and confirms soft deletion', async () => {
    render(<OrderInformationSettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'THÊM NGHỀ NGHIỆP' }))
    const dialog = screen.getByRole('dialog', { name: 'Thêm nghề nghiệp' })
    fireEvent.change(within(dialog).getByLabelText(/Tên hiển thị/u), { target: { value: 'Kiến trúc sư' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'LƯU' }))
    await waitFor(() => {
      expect(createOrderInformationOption).toHaveBeenCalledWith(expect.objectContaining({ label: 'Kiến trúc sư' }))
      expect(screen.queryByRole('dialog', { name: 'Thêm nghề nghiệp' })).toBeNull()
    })

    const occupationRow = screen.getByText('Nhân viên VP').closest('tr')
    fireEvent.click(within(occupationRow).getByRole('button', { name: 'Vô hiệu hóa' }))
    fireEvent.click(screen.getByRole('button', { name: 'VÔ HIỆU HÓA' }))
    await waitFor(() => expect(deleteOrderInformationOption).toHaveBeenCalledWith(DEFAULT_ORDER_INFORMATION_OPTIONS[0].id, expect.any(String)))
  })
})
