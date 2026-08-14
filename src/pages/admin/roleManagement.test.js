import { describe, expect, it } from 'vitest'
import { BusinessSupportManagement, StoreManagerManagement } from './RoleManagement'
import {
  ROLE_KEYS,
  emptyRoleProfile,
  nextRoleCode,
  roleProfilePayload,
  roleProfilesFromApp,
  validateRoleProfile,
} from './roleManagementUtils'

const validForm = (roleKey = ROLE_KEYS.businessSupport) => ({
  ...emptyRoleProfile(roleKey),
  code: roleKey === ROLE_KEYS.storeManager ? 'QL-TNV-001' : 'HTKD001',
  name: 'Nguyễn An',
  cccd: '012345678901',
  phone: '0901234567',
  province: 'TP. Hồ Chí Minh',
  ward: 'Phường 1',
  street: '12 Nguyễn Trãi',
  salary: '12,000,000',
  age: '28',
  username: roleKey === ROLE_KEYS.storeManager ? 'ql_tnv' : 'support_an',
  password: 'SafePass123',
  startDate: '2026-08-14',
  storeId: roleKey === ROLE_KEYS.storeManager ? 'CH001' : '',
})

describe('admin role management helpers', () => {
  it('exports both route-ready Admin screens', () => {
    expect(BusinessSupportManagement).toBeTypeOf('function')
    expect(StoreManagerManagement).toBeTypeOf('function')
  })

  it('selects the two new profile units without mixing office employees', () => {
    const app = {
      employees: [
        { id: 'HTKD001', unit: 'business_support' },
        { id: 'QL-TNV-001', unit: 'store_manager' },
        { id: 'VP001', unit: 'office' },
      ],
    }

    expect(roleProfilesFromApp(app, ROLE_KEYS.businessSupport).map((item) => item.id)).toEqual(['HTKD001'])
    expect(roleProfilesFromApp(app, ROLE_KEYS.storeManager).map((item) => item.id)).toEqual(['QL-TNV-001'])
  })

  it('previews non-reused sequential codes for support and each store manager prefix', () => {
    const profiles = [
      { id: 'HTKD001' },
      { id: 'HTKD004', deletedAt: '2026-08-01' },
      { id: 'QL-TNV-001' },
      { id: 'QL-TNV-003', deletedAt: '2026-08-02' },
      { id: 'QL-CT-008' },
    ]

    expect(nextRoleCode(profiles, ROLE_KEYS.businessSupport)).toBe('HTKD005')
    expect(nextRoleCode(profiles, ROLE_KEYS.storeManager, { short: 'TNV' })).toBe('QL-TNV-004')
    expect(nextRoleCode(profiles, ROLE_KEYS.storeManager, { short: 'CT' })).toBe('QL-CT-009')
  })

  it('requires a start date and assigned store for a store manager', () => {
    const form = { ...validForm(ROLE_KEYS.storeManager), startDate: '', storeId: '' }
    const errors = validateRoleProfile({ form, profiles: [], roleKey: ROLE_KEYS.storeManager })

    expect(errors).toContain('Ngày bắt đầu làm là trường bắt buộc.')
    expect(errors).toContain('Cửa hàng quản lý là trường bắt buộc.')
  })

  it('requires a fresh password when reissuing a purged login for an existing profile', () => {
    const form = { ...validForm(), password: '' }
    const errors = validateRoleProfile({
      form,
      profiles: [],
      editingKey: 'HTKD001',
      requiresPassword: true,
      roleKey: ROLE_KEYS.businessSupport,
    })

    expect(errors).toContain('Mật khẩu phải có ít nhất 8 ký tự.')
  })

  it('builds server-owned identity payloads with the correct role scope', () => {
    const supportPayload = roleProfilePayload(validForm(), ROLE_KEYS.businessSupport)
    const managerPayload = roleProfilePayload(validForm(ROLE_KEYS.storeManager), ROLE_KEYS.storeManager)

    expect(supportPayload).toMatchObject({
      unit: 'business_support',
      storeId: 'BUSINESS_SUPPORT',
      startDate: '2026-08-14',
      salary: 12_000_000,
      employmentType: 'Chính thức',
    })
    expect(managerPayload).toMatchObject({ unit: 'store_manager', storeId: 'CH001' })
    expect(supportPayload).not.toHaveProperty('id')
    expect(supportPayload).not.toHaveProperty('code')
  })
})
