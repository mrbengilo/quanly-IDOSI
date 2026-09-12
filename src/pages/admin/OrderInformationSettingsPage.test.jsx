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

  it('shows and creates configurable products separately from occupations', async () => {
    render(<OrderInformationSettingsPage />)
    fireEvent.change(screen.getByLabelText('Loại danh mục'), { target: { value: 'product' } })
    expect(screen.getByText('Đồ nam')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'THÊM MẶT HÀNG' }))
    const dialog = screen.getByRole('dialog', { name: 'Thêm mặt hàng' })
    fireEvent.change(within(dialog).getByLabelText(/Tên hiển thị/u), { target: { value: 'Phụ kiện' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(createOrderInformationOption).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'product', label: 'Phụ kiện', code: 'PRD-006',
    })))
  })

  it('creates a required select attribute with Admin-managed choices', async () => {
    render(<OrderInformationSettingsPage />)
    fireEvent.change(screen.getByLabelText('Loại danh mục'), { target: { value: 'custom_field' } })
    fireEvent.click(screen.getByRole('button', { name: 'THÊM THUỘC TÍNH' }))
    const dialog = screen.getByRole('dialog', { name: 'Thêm thuộc tính' })
    fireEvent.change(within(dialog).getByLabelText(/Tên hiển thị/u), { target: { value: 'Kích cỡ' } })
    fireEvent.change(within(dialog).getByLabelText(/Kiểu dữ liệu/u), { target: { value: 'select' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Bắt buộc nhập/u }))
    fireEvent.change(within(dialog).getByLabelText(/Các lựa chọn/u), { target: { value: 'S, M, L, XL' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'LƯU' }))
    await waitFor(() => expect(createOrderInformationOption).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'custom_field', label: 'Kích cỡ', code: 'ATTR-001', fieldType: 'select',
      required: true, choices: ['S', 'M', 'L', 'XL'],
    })))
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
