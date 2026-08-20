import { describe, expect, it } from 'vitest'
import {
  nextOfficeEmployeeCode,
  nextOfficeEmployeeCodeFromState,
  OFFICE_EMPLOYEE_TYPES,
  OFFICE_POSITIONS,
  validateOfficeEmployee,
} from './officeEmployeeForm'

const validForm = (overrides = {}) => ({
  code: 'VP-001',
  name: 'Nguyễn Văn Phòng',
  phone: '0901234567',
  cccd: '079123456789',
  province: 'Hồ Chí Minh',
  ward: 'Hiệp Bình',
  street: '12 Phạm Văn Đồng',
  startDate: '2026-08-18',
  employmentType: 'Full-Time',
  position: 'Kế Toán',
  identityImages: { front: { key: 'front' }, back: { key: 'back' } },
  username: 'vanphong.one',
  password: 'password-strong',
  ...overrides,
})

describe('office employee form', () => {
  it('generates the next VP-### code across legacy and current codes', () => {
    expect(nextOfficeEmployeeCode([{ id: 'VP001' }, { id: 'VP-007' }, { id: 'HTKD-008' }])).toBe('VP-008')
  })

  it('never previews a code already retired in deleted employee history', () => {
    expect(nextOfficeEmployeeCodeFromState({
      employees: [{ id: 'VP-001' }],
      deletedEmployees: [{ id: 'VP-009', deletedAt: '2026-08-17T10:00:00+07:00' }],
    })).toBe('VP-010')
  })

  it('uses the requested employee types and positions', () => {
    expect(OFFICE_EMPLOYEE_TYPES).toEqual(['Full-Time', 'Part-Time', 'Thực Tập Sinh'])
    expect(OFFICE_POSITIONS).toEqual(['Kế Toán', 'Marketing'])
  })

  it('accepts a complete profile and rejects invalid contact, CCCD, date and images', () => {
    expect(validateOfficeEmployee(validForm(), [], '', true)).toEqual([])
    const errors = validateOfficeEmployee(validForm({
      phone: '9123',
      cccd: '123',
      startDate: '18/08/26',
      identityImages: { front: '', back: '' },
    }), [], '', true)
    expect(errors).toEqual(expect.arrayContaining([
      'Số CCCD phải gồm đúng 12 chữ số.',
      'Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0.',
      'Ngày bắt đầu làm không hợp lệ.',
      'Hình ảnh mặt trước CCCD là trường bắt buộc.',
      'Hình ảnh mặt sau CCCD là trường bắt buộc.',
    ]))
  })

  it('allows a person to reuse CCCD and phone for a different login and position', () => {
    const existing = [{ id: 'HTKD-001', cccd: validForm().cccd, phone: validForm().phone, username: 'support-role' }]
    expect(validateOfficeEmployee(validForm(), existing, '', true)).toEqual([])
    expect(validateOfficeEmployee(validForm({ username: 'support-role' }), existing, '', true)).toContain('Tên đăng nhập đã tồn tại.')
  })
})
