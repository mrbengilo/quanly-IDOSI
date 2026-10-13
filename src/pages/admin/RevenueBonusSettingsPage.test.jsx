import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueBonusSettingsPage } from './RevenueBonusSettingsPage'
import { REVENUE_BONUS_PROGRAMS } from '../../domain/compensationPolicies'

const mocked = vi.hoisted(() => ({
  role: 'admin',
  save: vi.fn(),
  load: vi.fn(),
}))

vi.mock('../../state/AppContext', () => ({
  useApp: () => ({ session: { role: mocked.role }, saveRevenueBonusConfig: mocked.save }),
}))

vi.mock('../../services/idosiApi', () => ({
  apiGetRevenueBonusConfigs: (...args) => mocked.load(...args),
}))

const legacyGroup = (storePolicy, programId) => ({
  storePolicy,
  label: storePolicy === 'DOSII' ? 'Dosii' : 'SM TNV',
  programId,
  headVersion: 0,
  legacyThresholds: REVENUE_BONUS_PROGRAMS[programId].tiers.map((tier) => ({ thresholdVnd: tier.minimumRevenueVnd, rateBasisPoints: tier.rateBasisPoints })),
  current: {
    source: 'LEGACY', configId: null, version: null, storePolicy, programId, effectiveFrom: null,
    tiers: REVENUE_BONUS_PROGRAMS[programId].tiers.map((tier) => ({ ...tier, thresholdVnd: tier.minimumRevenueVnd })),
  },
  currentRecord: null,
  pending: [],
  history: [],
})

const payload = (overrides = {}) => ({
  version: 7,
  today: '2026-10-13',
  minimumEffectiveFrom: '2026-10-14',
  groups: [
    legacyGroup('DOSII', 'revenue-bonus.store-dosii-daily.v1'),
    legacyGroup('SM_TNV', 'revenue-bonus.store-sm-daily.v1'),
  ],
  ...overrides,
})

const apiError = (code, message, details) => Object.assign(new Error(message), { code, details })
const row = (index) => ({
  threshold: screen.getByLabelText(`Mốc doanh thu dòng ${index}`),
  rate: screen.getByLabelText(`Tỷ lệ thưởng dòng ${index} (%)`),
})

describe('RevenueBonusSettingsPage', () => {
  beforeEach(() => {
    mocked.role = 'admin'
    mocked.load.mockResolvedValue(payload())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    mocked.save.mockReset()
    mocked.load.mockReset()
  })

  it('shows a loading state, then the table in force for each group with the exact boundary wording', async () => {
    let resolve
    mocked.load.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<RevenueBonusSettingsPage />)
    expect(screen.getByRole('status').textContent).toMatch(/Đang tải/u)
    resolve(payload())
    expect(await screen.findByText('Đang áp dụng hôm nay (13/10/2026)')).toBeTruthy()
    const current = screen.getByRole('table', { name: 'Cấu hình Dosii đang áp dụng' })
    expect(within(current).getByText('Từ 1.500.000 đ đến 2.000.000 đ')).toBeTruthy()
    expect(within(current).getByText('Trên 2.000.000 đ đến 4.000.000 đ')).toBeTruthy()
    expect(within(current).getByText('Trên 4.000.000 đ')).toBeTruthy()
    expect(screen.getByText('Bảng mặc định hệ thống')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'SM TNV' }))
    expect(screen.getByRole('tab', { name: 'SM TNV' }).getAttribute('aria-selected')).toBe('true')
    const sm = screen.getByRole('table', { name: 'Cấu hình SM TNV đang áp dụng' })
    expect(within(sm).getByText('Từ 2.500.000 đ đến 6.000.000 đ')).toBeTruthy()
    expect(within(sm).getByText('7%')).toBeTruthy()
  })

  it('keeps unsaved drafts per group, validates the exact row and never saves invalid data', async () => {
    render(<RevenueBonusSettingsPage />)
    await screen.findByText('Đang áp dụng hôm nay (13/10/2026)')
    fireEvent.change(row(2).threshold, { target: { value: '1500000' } })
    fireEvent.change(row(3).rate, { target: { value: '1,255' } })
    expect(screen.getByText('Chưa lưu')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'SM TNV' }))
    fireEvent.click(screen.getByRole('tab', { name: /^Dosii/u }))
    expect(row(2).threshold.value).toBe('1,500,000')

    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }))
    expect(await screen.findByText('Mốc doanh thu trùng với dòng 1.')).toBeTruthy()
    expect(screen.getByText('Tỷ lệ thưởng chỉ hỗ trợ tối đa 2 chữ số thập phân.')).toBeTruthy()
    expect(mocked.save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Hủy chỉnh sửa' }))
    expect(row(2).threshold.value).toBe('2,000,000')
    expect(screen.queryByText('Chưa lưu')).toBeNull()
  })

  it('adds, removes and sorts draft rows and previews only the percentage bonus without saving', async () => {
    render(<RevenueBonusSettingsPage />)
    await screen.findByText('Đang áp dụng hôm nay (13/10/2026)')
    fireEvent.click(screen.getByRole('button', { name: 'Xóa dòng 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Xóa dòng 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Thêm mốc' }))
    fireEvent.change(row(2).threshold, { target: { value: '1000000' } })
    fireEvent.change(row(2).rate, { target: { value: '1,25' } })
    fireEvent.change(row(1).threshold, { target: { value: '3000000' } })
    fireEvent.change(row(1).rate, { target: { value: '2,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sắp xếp tăng dần' }))
    expect(row(1).threshold.value).toBe('1,000,000')
    expect(row(2).rate.value).toBe('2,5')
    const editor = screen.getByRole('table', { name: 'Bản nháp mốc thưởng Dosii' })
    expect(within(editor).getByText('Từ 1.000.000 đ đến 3.000.000 đ')).toBeTruthy()
    expect(within(editor).getByText('Trên 3.000.000 đ')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Doanh thu ngày giả định'), { target: { value: '3000000' } })
    const preview = screen.getByText('Thưởng theo %').closest('dl')
    expect(within(preview).getByText('1,25%')).toBeTruthy()
    expect(within(preview).getByText('37,500 đ')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Doanh thu ngày giả định'), { target: { value: '3000001' } })
    expect(within(preview).getByText('2,5%')).toBeTruthy()
    expect(within(preview).getByText('75,000 đ')).toBeTruthy()
    expect(screen.getByText(/chưa gồm thưởng mốc đội nhóm/u)).toBeTruthy()
    expect(mocked.save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Xóa dòng 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Xóa dòng 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }))
    expect(await screen.findByText('Cần ít nhất một mốc thưởng.')).toBeTruthy()
    expect(mocked.save).not.toHaveBeenCalled()
  })

  it('reports success only after the server confirms and shows the saved version', async () => {
    let finish
    mocked.save.mockReturnValue(new Promise((done) => { finish = done }))
    render(<RevenueBonusSettingsPage />)
    await screen.findByText('Đang áp dụng hôm nay (13/10/2026)')
    fireEvent.change(row(1).rate, { target: { value: '1,25' } })
    fireEvent.change(screen.getByLabelText('Ngày bắt đầu áp dụng'), { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }))
    await waitFor(() => expect(mocked.save).toHaveBeenCalledWith({
      storePolicy: 'DOSII',
      effectiveFrom: '2026-10-20',
      tiers: [
        { thresholdVnd: 1_500_000, rateBasisPoints: 125 },
        { thresholdVnd: 2_000_000, rateBasisPoints: 200 },
        { thresholdVnd: 4_000_000, rateBasisPoints: 400 },
      ],
      baseVersion: 0,
    }))
    expect(screen.getByRole('button', { name: 'Đang lưu…' })).toBeTruthy()
    expect(screen.queryByText(/Đã lưu phiên bản/u)).toBeNull()

    const saved = { id: 'rbc_1', storePolicy: 'DOSII', version: 1, effectiveFrom: '2026-10-20', status: 'ACTIVE',
      tiers: [{ thresholdVnd: 1_500_000, rateBasisPoints: 125 }], createdAt: '2026-10-13T03:00:00.000Z', createdBy: { name: 'Admin IDOSI' } }
    const next = payload()
    next.groups[0] = { ...next.groups[0], headVersion: 1, pending: [saved], history: [saved] }
    finish({ revenueBonusConfig: saved, ...next })
    expect(await screen.findByText('Đã lưu phiên bản 1 cho Dosii, áp dụng từ 20/10/2026.')).toBeTruthy()
    expect(screen.getByText(/Cấu hình phiên bản 1 sẽ áp dụng từ 20\/10\/2026/u)).toBeTruthy()
    expect(screen.getByText('Chờ áp dụng')).toBeTruthy()
    expect(screen.queryByText('Chưa lưu')).toBeNull()
  })

  it('keeps the draft and offers a reload on a version conflict, and maps server row errors', async () => {
    mocked.save.mockRejectedValueOnce(apiError('REVENUE_BONUS_CONFIG_CONFLICT', 'Cấu hình Dosii vừa được người khác cập nhật.'))
    render(<RevenueBonusSettingsPage />)
    await screen.findByText('Đang áp dụng hôm nay (13/10/2026)')
    fireEvent.change(row(1).rate, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }))
    expect(await screen.findByText('Cấu hình Dosii vừa được người khác cập nhật.')).toBeTruthy()
    expect(row(1).rate.value).toBe('3')
    expect(mocked.save).toHaveBeenCalledTimes(1)

    mocked.save.mockRejectedValueOnce(apiError('REVENUE_BONUS_CONFIG_VALIDATION', 'Cấu hình chưa hợp lệ.', {
      fieldErrors: { effectiveFrom: 'Cấu hình chỉ áp dụng từ ngày mai.' },
      formErrors: [],
      rowErrors: [{ index: 1, thresholdVnd: 'Mốc lỗi từ máy chủ.' }],
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }))
    expect(await screen.findByText('Mốc lỗi từ máy chủ.')).toBeTruthy()
    expect(screen.getByText('Cấu hình chỉ áp dụng từ ngày mai.')).toBeTruthy()

    mocked.load.mockResolvedValueOnce(payload({ version: 8 }))
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }))
    await waitFor(() => expect(mocked.load).toHaveBeenCalledTimes(2))
    expect(row(1).rate.value).toBe('3')
  })

  it('does not save when the Admin cancels the confirmation', async () => {
    window.confirm.mockReturnValue(false)
    render(<RevenueBonusSettingsPage />)
    await screen.findByText('Đang áp dụng hôm nay (13/10/2026)')
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cấu hình' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(mocked.save).not.toHaveBeenCalled()
  })

  it('shows error and unauthorized states', async () => {
    mocked.load.mockRejectedValueOnce(apiError('NETWORK_ERROR', 'Không thể kết nối máy chủ IDOSI.'))
    render(<RevenueBonusSettingsPage />)
    expect(await screen.findByText('Không thể kết nối máy chủ IDOSI.')).toBeTruthy()
    mocked.load.mockResolvedValueOnce(payload())
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('Đang áp dụng hôm nay (13/10/2026)')).toBeTruthy()
    cleanup()

    mocked.load.mockRejectedValueOnce(Object.assign(apiError('ROLE_FORBIDDEN', 'Không có quyền.'), { status: 403 }))
    render(<RevenueBonusSettingsPage />)
    expect(await screen.findByText('Không có quyền truy cập')).toBeTruthy()
    cleanup()

    mocked.role = 'business_support'
    render(<RevenueBonusSettingsPage />)
    expect(screen.getByText('Không có quyền truy cập')).toBeTruthy()
    expect(mocked.load).toHaveBeenCalledTimes(3)
  })
})
