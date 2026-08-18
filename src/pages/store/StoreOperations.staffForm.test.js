import { describe, expect, it } from 'vitest'
import {
  buildStoreEmployeePayload,
  freshIdentityImages,
  generateStoreEmployeeCredentials,
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
  username: '',
  password: '',
  status: 'Đang làm việc',
  storeId: store.id,
  ...overrides,
})

describe('Business Support store employee form', () => {
  it('previews the required store-based username and last-six-CCCD password', () => {
    expect(generateStoreEmployeeCredentials(store, 'Nguyễn Ben', '079203147852')).toEqual({
      username: 'sm234-ben',
      password: '147852ben@',
    })
    expect(generateStoreEmployeeCredentials({ short: 'TH' }, 'Trần Minh Anh', '012345123456')).toEqual({
      username: 'th-anh',
      password: '123456anh@',
    })
  })

  it('accepts server-generated credentials only when date and both CCCD images are present', () => {
    expect(validateStoreEmployee(validForm(), [], '', true, {
      autoCredentials: true,
      requireIdentityImages: true,
    })).toEqual([])

    const errors = validateStoreEmployee(validForm({
      startDate: '',
      identityImages: { front: '', back: '' },
    }), [], '', true, {
      autoCredentials: true,
      requireIdentityImages: true,
    })
    expect(errors).toEqual(expect.arrayContaining([
      'Ngày bắt đầu làm là trường bắt buộc.',
      'Hình ảnh mặt trước CCCD là trường bắt buộc.',
      'Hình ảnh mặt sau CCCD là trường bắt buộc.',
    ]))
    expect(errors).not.toContain('Tên đăng nhập là trường bắt buộc.')
    expect(errors).not.toContain('Mật khẩu là trường bắt buộc để cấp tài khoản đăng nhập.')
  })

  it('omits credentials from the Business Support request and fixes the sales position', () => {
    const payload = buildStoreEmployeePayload(validForm(), {
      storeId: store.id,
      store,
      autoCredentials: true,
    })

    expect(payload).toMatchObject({
      unit: 'store',
      storeId: store.id,
      startDate: '2026-08-18',
      joinDate: '2026-08-18',
      position: 'Nhân viên bán hàng',
      workPosition: 'Nhân viên bán hàng',
      identityImages: {
        front: 'data:image/png;base64,fresh-front',
        back: 'data:image/webp;base64,fresh-back',
      },
    })
    expect(payload).not.toHaveProperty('username')
    expect(payload).not.toHaveProperty('password')
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
