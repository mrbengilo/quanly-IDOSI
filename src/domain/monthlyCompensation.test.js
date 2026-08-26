import { describe, expect, it } from 'vitest'
import {
  assertMonthlyCompensationTransition,
  assertNoSelfApproval,
  canTransitionMonthlyCompensation,
  evaluateMonthlyCompensationTransition,
  isMonthlyCompensationSnapshotFrozen,
  MONTHLY_COMPENSATION_ACTOR_ROLE,
  MONTHLY_COMPENSATION_STATUS,
  MONTHLY_COMPENSATION_TRANSITIONS,
} from './monthlyCompensation'

const STATUS = MONTHLY_COMPENSATION_STATUS
const admin = { id: 'ADMIN-1', role: 'admin' }
const system = { id: 'MONTHLY-JOB', role: 'system' }
const businessSupport = { id: 'HTKD-1', role: 'business_support' }
const managerS1 = { id: 'QL-S1', role: 'store_manager', storeId: 'S1' }
const period = { id: 'COMP-S1-2026-08', storeId: 'S1', version: 7, paymentCount: 0 }

const evaluate = (fromStatus, toStatus, actor, overrides = {}) => evaluateMonthlyCompensationTransition({
  fromStatus,
  toStatus,
  actor,
  period,
  ...overrides,
})

describe('monthly compensation state machine', () => {
  it('exposes the exact lifecycle states and an immutable explicit transition register', () => {
    expect(Object.values(STATUS)).toEqual([
      'OPEN',
      'DRAFT',
      'UNDER_MANAGER_REVIEW',
      'READY_TO_CLOSE',
      'BOOKS_CLOSED',
      'PAYMENT_IN_PROGRESS',
      'PARTIALLY_PAID',
      'PAID',
      'LOCKED',
    ])
    expect(MONTHLY_COMPENSATION_ACTOR_ROLE).toEqual({
      SYSTEM: 'system', ADMIN: 'admin', BUSINESS_SUPPORT: 'business_support', STORE_MANAGER: 'store_manager',
    })
    expect(Object.isFrozen(MONTHLY_COMPENSATION_TRANSITIONS)).toBe(true)
    expect(Object.isFrozen(MONTHLY_COMPENSATION_TRANSITIONS[0].roles)).toBe(true)
  })

  it('allows only the system job or Admin orchestration to move OPEN to DRAFT', () => {
    expect(evaluate(STATUS.OPEN, STATUS.DRAFT, system).allowed).toBe(true)
    expect(evaluate(STATUS.OPEN, STATUS.DRAFT, admin).allowed).toBe(true)
    expect(evaluate(STATUS.OPEN, STATUS.DRAFT, managerS1)).toMatchObject({
      allowed: false, code: 'MONTHLY_COMPENSATION_ROLE_FORBIDDEN',
    })
  })

  it('allows Admin or all-store business support to submit DRAFT for manager review', () => {
    expect(evaluate(STATUS.DRAFT, STATUS.UNDER_MANAGER_REVIEW, admin).allowed).toBe(true)
    expect(evaluate(STATUS.DRAFT, STATUS.UNDER_MANAGER_REVIEW, businessSupport).allowed).toBe(true)
    expect(evaluateMonthlyCompensationTransition({
      fromStatus: STATUS.DRAFT,
      toStatus: STATUS.UNDER_MANAGER_REVIEW,
      actor: businessSupport,
      period: { ...period, storeId: 'S2' },
    }).allowed).toBe(true)
    expect(evaluate(STATUS.DRAFT, STATUS.UNDER_MANAGER_REVIEW, managerS1).allowed).toBe(false)
  })

  it('lets the own-store manager confirm or report a discrepancy with a reason', () => {
    expect(evaluate(STATUS.UNDER_MANAGER_REVIEW, STATUS.READY_TO_CLOSE, managerS1).allowed).toBe(true)
    expect(evaluate(STATUS.UNDER_MANAGER_REVIEW, STATUS.READY_TO_CLOSE, {
      ...managerS1, storeId: 'S2',
    })).toMatchObject({ allowed: false, code: 'MONTHLY_COMPENSATION_STORE_SCOPE_FORBIDDEN' })
    expect(evaluate(STATUS.UNDER_MANAGER_REVIEW, STATUS.DRAFT, managerS1)).toMatchObject({
      allowed: false, code: 'MONTHLY_COMPENSATION_REASON_REQUIRED',
    })
    expect(evaluate(STATUS.UNDER_MANAGER_REVIEW, STATUS.DRAFT, managerS1, {
      reason: 'Sai số giờ công của nhân viên.',
    }).allowed).toBe(true)
  })

  it('requires an audit reason for Admin or business-support review override', () => {
    expect(evaluate(STATUS.UNDER_MANAGER_REVIEW, STATUS.READY_TO_CLOSE, admin)).toMatchObject({
      allowed: false, code: 'MONTHLY_COMPENSATION_REASON_REQUIRED',
    })
    expect(evaluate(STATUS.UNDER_MANAGER_REVIEW, STATUS.READY_TO_CLOSE, admin, {
      reason: 'Admin override theo biên bản đối soát.',
    }).allowed).toBe(true)
    expect(evaluate(STATUS.UNDER_MANAGER_REVIEW, STATUS.READY_TO_CLOSE, businessSupport, {
      reason: 'HTKD đã xử lý chênh lệch của cửa hàng.',
    }).allowed).toBe(true)
  })

  it('allows Admin/all-store business support to close books and operate payment states', () => {
    expect(evaluate(STATUS.READY_TO_CLOSE, STATUS.BOOKS_CLOSED, businessSupport).allowed).toBe(true)
    expect(evaluate(STATUS.BOOKS_CLOSED, STATUS.PAYMENT_IN_PROGRESS, businessSupport).allowed).toBe(true)
    expect(evaluate(STATUS.PAYMENT_IN_PROGRESS, STATUS.PARTIALLY_PAID, businessSupport).allowed).toBe(true)
    expect(evaluate(STATUS.PARTIALLY_PAID, STATUS.PAID, businessSupport).allowed).toBe(true)
    expect(evaluate(STATUS.PAYMENT_IN_PROGRESS, STATUS.PAID, admin).allowed).toBe(true)
    expect(evaluate(STATUS.READY_TO_CLOSE, STATUS.PAID, admin)).toMatchObject({
      allowed: false, code: 'MONTHLY_COMPENSATION_TRANSITION_NOT_ALLOWED',
    })
  })

  it('never lets a store manager close books, operate payments, or lock a period', () => {
    for (const [fromStatus, toStatus] of [
      [STATUS.READY_TO_CLOSE, STATUS.BOOKS_CLOSED],
      [STATUS.BOOKS_CLOSED, STATUS.PAYMENT_IN_PROGRESS],
      [STATUS.PAYMENT_IN_PROGRESS, STATUS.PARTIALLY_PAID],
      [STATUS.PAYMENT_IN_PROGRESS, STATUS.PAID],
      [STATUS.PARTIALLY_PAID, STATUS.PAID],
      [STATUS.PAID, STATUS.LOCKED],
    ]) {
      expect(evaluate(fromStatus, toStatus, managerS1), `${fromStatus} -> ${toStatus}`).toMatchObject({
        allowed: false,
        code: 'MONTHLY_COMPENSATION_ROLE_FORBIDDEN',
      })
    }
  })

  it('lets only Admin void closed books before any payment, with reason and matching version', () => {
    const input = {
      reason: 'Hủy chốt do phát hiện chứng từ thiếu.',
      expectedVersion: 7,
    }
    expect(evaluate(STATUS.BOOKS_CLOSED, STATUS.UNDER_MANAGER_REVIEW, admin, input).allowed).toBe(true)
    expect(evaluate(STATUS.BOOKS_CLOSED, STATUS.UNDER_MANAGER_REVIEW, businessSupport, input)).toMatchObject({
      allowed: false, code: 'MONTHLY_COMPENSATION_ROLE_FORBIDDEN',
    })
    expect(evaluate(STATUS.BOOKS_CLOSED, STATUS.UNDER_MANAGER_REVIEW, admin, {
      expectedVersion: 7,
    })).toMatchObject({ allowed: false, code: 'MONTHLY_COMPENSATION_REASON_REQUIRED' })
    expect(evaluate(STATUS.BOOKS_CLOSED, STATUS.UNDER_MANAGER_REVIEW, admin, {
      ...input,
      expectedVersion: 6,
    })).toMatchObject({ allowed: false, code: 'MONTHLY_COMPENSATION_VERSION_CONFLICT' })
    expect(evaluateMonthlyCompensationTransition({
      fromStatus: STATUS.BOOKS_CLOSED,
      toStatus: STATUS.UNDER_MANAGER_REVIEW,
      actor: admin,
      period: { ...period, paymentCount: 1 },
      ...input,
    })).toMatchObject({ allowed: false, code: 'MONTHLY_COMPENSATION_PAYMENT_EXISTS' })
  })

  it('marks the books-closed snapshot and every later payment state as frozen', () => {
    expect(isMonthlyCompensationSnapshotFrozen(STATUS.READY_TO_CLOSE)).toBe(false)
    for (const status of [
      STATUS.BOOKS_CLOSED,
      STATUS.PAYMENT_IN_PROGRESS,
      STATUS.PARTIALLY_PAID,
      STATUS.PAID,
      STATUS.LOCKED,
    ]) {
      expect(isMonthlyCompensationSnapshotFrozen(status), status).toBe(true)
    }
  })

  it('allows only Admin to lock PAID and never reopens LOCKED', () => {
    expect(evaluate(STATUS.PAID, STATUS.LOCKED, businessSupport)).toMatchObject({
      allowed: false, code: 'MONTHLY_COMPENSATION_ROLE_FORBIDDEN',
    })
    expect(evaluate(STATUS.PAID, STATUS.LOCKED, managerS1).allowed).toBe(false)
    expect(evaluate(STATUS.PAID, STATUS.LOCKED, admin).allowed).toBe(true)
    expect(evaluate(STATUS.LOCKED, STATUS.DRAFT, admin)).toMatchObject({
      allowed: false, code: 'MONTHLY_COMPENSATION_LOCKED',
    })
  })

  it('offers boolean and asserting APIs without changing the period object', () => {
    const before = structuredClone(period)
    expect(canTransitionMonthlyCompensation({
      fromStatus: STATUS.READY_TO_CLOSE,
      toStatus: STATUS.BOOKS_CLOSED,
      actor: admin,
      period,
    })).toBe(true)
    expect(assertMonthlyCompensationTransition({
      fromStatus: STATUS.PAID,
      toStatus: STATUS.LOCKED,
      actor: admin,
      period,
    })).toMatchObject({ from: STATUS.PAID, to: STATUS.LOCKED })
    expect(() => assertMonthlyCompensationTransition({
      fromStatus: STATUS.DRAFT,
      toStatus: STATUS.PAID,
      actor: admin,
      period,
    })).toThrow(/MONTHLY_COMPENSATION_TRANSITION_NOT_ALLOWED/)
    expect(period).toEqual(before)
  })

  it('rejects self-approval by stable actor id', () => {
    expect(() => assertNoSelfApproval({
      submittedById: 'HTKD-001', approverId: ' htkd-001 ',
    })).toThrow(/SELF_APPROVAL_FORBIDDEN/)
    expect(assertNoSelfApproval({ submittedById: 'NV-001', approverId: 'QL-001' })).toBe(true)
    expect(() => assertNoSelfApproval({ submittedById: '', approverId: 'QL-001' })).toThrow(TypeError)
  })
})
