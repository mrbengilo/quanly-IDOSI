import { describe, expect, it } from 'vitest'
import {
  buildStoreEmployeePayload,
  freshIdentityImages,
  nextStoreEmployeeCode,
  storeEmployeePrefix,
  validateStoreEmployee,
} from './storeEmployeeForm'

const store = { id: 'CH001', name: 'SecondMall SM234', short: 'SM234' }

const validForm = (overrides = {}) => ({
  id: 'SM234-002',
  name: 'Nguyễn Minh Anh',
  cccd: '079203147852',
  phone: '0907654321',
  province: 'Hồ Chí Minh',
  ward: 'Hiệp Bình',
  street: '12 Phạm Văn Đồng',
  startDate: '2026-08-18',
  identityImages: {
    front: 'data:image/png;base64,fresh-front',
    back: 'data:image/webp;base64,fresh-back',
  },
  salary: '',
  baseSalary: '8,000,000',
  standardWorkDays: '26',
  requiredMonthlyHours: '208',
  employmentType: 'Full-Time',
  position: 'Nhân viên thu ngân',
  age: '22',
  username: 'sm234-minhanh',
  password: 'MatKhauBaoMat123!',
  status: 'Đang làm việc',
  storeId: store.id,
  ...overrides,
})

describe('Business Support store employee form', () => {
  it('uses the store brand and branch in sequential employee codes', () => {
    expect(storeEmployeePrefix({ name: 'Dossi LVT', short: 'LVT' })).toBe('DOSSI-LVT')
    expect(storeEmployeePrefix({ name: 'Dosii TNV', short: 'TNV' })).toBe('DOSII-TNV')
    expect(storeEmployeePrefix({ name: 'SM TNV', short: 'TNV' })).toBe('SM-TNV')
    expect(nextStoreEmployeeCode({ name: 'Dosii TNV', short: 'TNV' }, [{ id: 'DOSII-TNV-001' }])).toBe('DOSII-TNV-002')
  })

  it('requires manually entered credentials, date and both CCCD images', () => {
    expect(validateStoreEmployee(validForm(), [], '', true, { requireIdentityImages: true })).toEqual([])

    const errors = validateStoreEmployee(validForm({
      startDate: '',
      identityImages: { front: '', back: '' },
      username: '',
      password: '',
    }), [], '', true, { requireIdentityImages: true })
    expect(errors).toEqual(expect.arrayContaining([
      'Ngày bắt đầu làm là trường bắt buộc.',
      'Hình ảnh mặt trước CCCD là trường bắt buộc.',
      'Hình ảnh mặt sau CCCD là trường bắt buộc.',
    ]))
    expect(errors).toContain('Tên đăng nhập là trường bắt buộc.')
    expect(errors).toContain('Mật khẩu là trường bắt buộc để cấp tài khoản đăng nhập.')
  })

  it('includes manual credentials in the request and keeps the chosen store position', () => {
    const payload = buildStoreEmployeePayload(validForm(), {
      storeId: store.id,
      store,
    })

    expect(payload).toMatchObject({
      unit: 'store',
      storeId: store.id,
      startDate: '2026-08-18',
      joinDate: '2026-08-18',
      position: 'Nhân viên thu ngân',
      workPosition: 'Nhân viên thu ngân',
      username: 'sm234-minhanh',
      password: 'MatKhauBaoMat123!',
      identityImages: {
        front: 'data:image/png;base64,fresh-front',
        back: 'data:image/webp;base64,fresh-back',
      },
    })
  })

  it('allows the same CCCD and phone for another job account while keeping usernames unique', () => {
    const existing = [{ id: 'HTKD-001', cccd: validForm().cccd, phone: validForm().phone, username: 'support-role' }]
    expect(validateStoreEmployee(validForm(), existing, '', true, { requireIdentityImages: true })).toEqual([])
    expect(validateStoreEmployee(validForm({ username: 'support-role' }), existing, '', true, { requireIdentityImages: true }))
      .toContain('Tên đăng nhập đã tồn tại.')
  })

  it('links an Office or Business Support profile using only its hourly store rate', () => {
    const linkedForm = validForm({
      linkedEmployeeId: 'VP-001',
      name: 'Nhân viên văn phòng',
      salary: '25,000',
      baseSalary: '',
      startDate: '',
      age: '',
      identityImages: {},
      username: '',
      password: '',
    })
    expect(validateStoreEmployee(linkedForm, [], '', false, { linkedEmployeeId: 'VP-001', requireIdentityImages: true })).toEqual([])
    expect(buildStoreEmployeePayload(linkedForm, { storeId: store.id, store })).toMatchObject({
      unit: 'store',
      storeId: store.id,
      linkedEmployeeId: 'VP-001',
      employmentType: 'Part-Time',
      salaryUnit: 'hour',
      salary: 25_000,
      hourlyRate: 25_000,
      baseSalary: null,
    })
  })

  it('keeps salary inputs in exact VND units without thousands scaling', () => {
    const partTime = buildStoreEmployeePayload(validForm({
      employmentType: 'Part-Time',
      salary: '35',
      baseSalary: '',
    }), { storeId: store.id, store })
    const fullTime = buildStoreEmployeePayload(validForm({ baseSalary: '35' }), { storeId: store.id, store })

    expect(partTime).toMatchObject({ salary: 35, hourlyRate: 35 })
    expect(fullTime).toMatchObject({ salary: 35, monthlySalary: 35, baseSalary: 35 })
  })

  it('never resubmits persisted private image metadata', () => {
    expect(freshIdentityImages({
      front: { key: 'private/front.webp', contentType: 'image/webp' },
      back: 'data:image/png;base64,new-back',
    })).toEqual({ back: 'data:image/png;base64,new-back' })

    const payload = buildStoreEmployeePayload(validForm({
      username: 'admin-created',
      password: 'StrongPass123',
      identityImages: {
        front: { key: 'private/front.webp' },
        back: { key: 'private/back.webp' },
      },
    }), { storeId: store.id, store })
    expect(payload).not.toHaveProperty('identityImages')
    expect(payload).toMatchObject({ username: 'admin-created', password: 'StrongPass123' })
  })
})
