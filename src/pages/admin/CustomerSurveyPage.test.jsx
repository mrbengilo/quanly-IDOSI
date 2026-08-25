import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerSurveyPage } from './CustomerSurveyPage'
import { DEFAULT_ORDER_INFORMATION_OPTIONS } from '../../domain/orderInformationSettings'

vi.mock('../../state/AppContext', () => ({
  useApp: () => ({
    stores: [{ id: 'S01', name: 'Dosii KVC' }, { id: 'S02', name: 'Dosii TNV' }],
    orderInformationOptions: DEFAULT_ORDER_INFORMATION_OPTIONS,
    orders: [
      { id: '1', storeId: 'S01', createdAt: '2026-08-01T08:00:00+07:00', gender: 'Nữ', customerAge: 22, acquisitionChannel: 'TikTok', occupation: 'Sinh viên' },
      { id: '2', storeId: 'S01', createdAt: '2026-08-02T08:00:00+07:00', gender: 'Nam', customerAge: 31, acquisitionChannel: 'Facebook', occupation: 'Nhân viên' },
      { id: '3', storeId: 'S02', createdAt: '2026-08-03T08:00:00+07:00', gender: 'Nữ', customerAge: 24, acquisitionChannel: 'TikTok', occupation: 'Sinh viên' },
    ],
  }),
}))

describe('CustomerSurveyPage', () => {
  afterEach(cleanup)

  it('shows system metrics and filters detailed statistics by store', () => {
    render(<CustomerSurveyPage />)
    const overview = screen.getByLabelText('Tổng quan khảo sát khách hàng')
    expect(overview.querySelectorAll('.metric--compact')).toHaveLength(9)
    expect(overview.querySelector('.survey-brand-icon--tiktok')).toBeTruthy()
    expect(overview.querySelector('.survey-brand-icon--facebook')).toBeTruthy()
    expect(overview.querySelector('.survey-brand-icon--zalo')).toBeTruthy()
    expect(within(overview).getByText('3')).toBeTruthy()
    expect(screen.getAllByText('18–24').length).toBeGreaterThan(0)
    expect(screen.getAllByText('TikTok').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Chọn cửa hàng'), { target: { value: 'S01' } })
    expect(screen.getByText(/Đang xem chi tiết Dosii KVC/)).toBeTruthy()
    expect(screen.getByText(/2 lượt khách/)).toBeTruthy()
  })
})
