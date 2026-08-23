const DEFAULT_RECOGNIZED_STATUSES = [
  'confirmed',
  'completed',
  'paid',
  'posted',
  'hoàn tất',
  'đã chi',
  'đã xác nhận',
]

const normalizeText = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')

const normalizedStatusSet = (statuses) => new Set(statuses.map(normalizeText))

const directionOf = (value) => {
  const normalized = normalizeText(value)
  if (['in', 'income', 'credit', 'revenue', 'thu'].includes(normalized)) return 'in'
  if (['out', 'expense', 'debit', 'cost', 'chi'].includes(normalized)) return 'out'
  return ''
}

const isoDateFrom = (value) => {
  const businessValue = businessDate(value)
  if (businessValue) return businessValue

  const source = String(value ?? '').trim()
  const local = source.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (local) return `${local[3]}-${String(local[2]).padStart(2, '0')}-${String(local[1]).padStart(2, '0')}`
  return ''
}

const periodFrom = (filters = {}) => {
  const provided = filters.period || filters
  if (typeof provided === 'string') {
    const dates = provided.match(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/g) || []
    return { from: isoDateFrom(dates[0]), to: isoDateFrom(dates[1] || dates[0]) }
  }
  return {
    from: isoDateFrom(provided.from || provided.start || provided.dateFrom),
    to: isoDateFrom(provided.to || provided.end || provided.dateTo),
  }
}

const amountFrom = (value, field = 'amount', { allowZero = true } = {}) => {
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new TypeError(`${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer amount in VND.`)
  }
  return amount
}

export const FINANCE_DIRECTION = Object.freeze({ IN: 'in', OUT: 'out' })

export const FINANCE_STATUS = Object.freeze({
  CONFIRMED: 'confirmed',
  PENDING: 'pending',
  VOIDED: 'voided',
})

export const normalizeVnd = (value, options) => amountFrom(value, 'amount', options)

export const financeTransactionKey = (transaction = {}) => {
  const storeScope = String(transaction.storeId || '')
  if (transaction.idempotencyKey) return `idempotency:${storeScope}:${String(transaction.idempotencyKey)}`
  if (transaction.sourceType && transaction.sourceId) {
    return `source:${storeScope}:${transaction.sourceType}:${transaction.sourceId}:${transaction.type || transaction.category || ''}:${directionOf(transaction.direction)}`
  }
  if (transaction.id) return `id:${storeScope}:${String(transaction.id)}`
  return ''
}

export function createFinanceTransaction(payload = {}) {
  const direction = directionOf(payload.direction)
  if (!direction) throw new TypeError('direction must be either "in" or "out".')
  const amount = amountFrom(payload.amount, 'amount')
  const occurredAt = payload.occurredAt || payload.confirmedAt || payload.createdAt
  if (!isoDateFrom(occurredAt)) throw new TypeError('occurredAt must contain a valid calendar date.')
  if (!payload.storeId) throw new TypeError('storeId is required.')
  if (!payload.type && !payload.category) throw new TypeError('type is required.')

  const transaction = {
    ...payload,
    id: payload.id ? String(payload.id) : '',
    storeId: String(payload.storeId),
    direction,
    type: String(payload.type || payload.category),
    category: String(payload.category || payload.type),
    amount,
    status: payload.status || FINANCE_STATUS.CONFIRMED,
    occurredAt,
  }
  if (!financeTransactionKey(transaction)) {
    throw new TypeError('A transaction needs id, idempotencyKey, or sourceType/sourceId for deduplication.')
  }
  return transaction
}

export function dedupeFinanceTransactions(transactions = []) {
  const keyed = new Map()
  const unkeyed = []
  for (const transaction of Array.isArray(transactions) ? transactions : []) {
    if (!transaction || typeof transaction !== 'object') continue
    const key = financeTransactionKey(transaction)
    if (key) keyed.set(key, transaction)
    else unkeyed.push(transaction)
  }
  return [...unkeyed, ...keyed.values()]
}

export function upsertFinanceTransaction(transactions = [], payload = {}) {
  const transaction = createFinanceTransaction(payload)
  const key = financeTransactionKey(transaction)
  const current = Array.isArray(transactions) ? transactions : []
  const index = current.findIndex((item) => financeTransactionKey(item) === key)
  if (index < 0) return { transactions: [...current, transaction], transaction, inserted: true, updated: false }

  const next = [...current]
  next[index] = { ...current[index], ...transaction }
  return { transactions: next, transaction: next[index], inserted: false, updated: true }
}

export const appendTransactionIdempotently = (transactions, payload) =>
  upsertFinanceTransaction(transactions, payload).transactions

export function isRecognizedFinanceTransaction(transaction = {}, statuses = DEFAULT_RECOGNIZED_STATUSES) {
  if (transaction.voidedAt || transaction.deletedAt || transaction.isDeleted || transaction.active === false) return false
  const status = normalizeText(transaction.status)
  return normalizedStatusSet(statuses).has(status)
}

export function isFinanceTransactionInPeriod(transaction = {}, filters = {}) {
  const { from, to } = periodFrom(filters)
  if (!from && !to) return true
  const date = isoDateFrom(transaction.occurredAt || transaction.confirmedAt || transaction.createdAt)
  if (!date) return false
  return (!from || date >= from) && (!to || date <= to)
}

export function selectFinanceTransactions(transactions = [], filters = {}) {
  const storeIds = filters.storeIds
    ? new Set(filters.storeIds.map(String))
    : filters.storeId != null
      ? new Set([String(filters.storeId)])
      : null
  const directions = filters.directions
    ? new Set(filters.directions.map(directionOf).filter(Boolean))
    : filters.direction
      ? new Set([directionOf(filters.direction)])
      : null
  const types = filters.types
    ? new Set(filters.types.map(String))
    : filters.type
      ? new Set([String(filters.type)])
      : null

  return dedupeFinanceTransactions(transactions).filter((transaction) => {
    if (!isRecognizedFinanceTransaction(transaction, filters.recognizedStatuses || DEFAULT_RECOGNIZED_STATUSES)) return false
    if (!Number.isSafeInteger(Number(transaction.amount)) || Number(transaction.amount) < 0) return false
    if (storeIds && !storeIds.has(String(transaction.storeId))) return false
    if (directions && !directions.has(directionOf(transaction.direction))) return false
    if (types && !types.has(String(transaction.type || transaction.category))) return false
    return isFinanceTransactionInPeriod(transaction, filters.period || filters)
  })
}

const groupAmounts = (transactions, direction) => transactions.reduce((groups, transaction) => {
  if (directionOf(transaction.direction) !== direction) return groups
  const key = String(transaction.type || transaction.category || 'other')
  groups[key] = (groups[key] || 0) + Number(transaction.amount)
  return groups
}, {})

export function selectFinanceSummary(transactions = [], filters = {}) {
  const recognized = selectFinanceTransactions(transactions, filters)
  const revenue = recognized.reduce((total, transaction) =>
    total + (directionOf(transaction.direction) === FINANCE_DIRECTION.IN ? Number(transaction.amount) : 0), 0)
  const expense = recognized.reduce((total, transaction) =>
    total + (directionOf(transaction.direction) === FINANCE_DIRECTION.OUT ? Number(transaction.amount) : 0), 0)
  const profit = revenue - expense
  return {
    transactions: recognized,
    revenue,
    expense,
    profit,
    marginPercent: revenue > 0 ? (profit / revenue) * 100 : 0,
    revenueByType: groupAmounts(recognized, FINANCE_DIRECTION.IN),
    expenseByType: groupAmounts(recognized, FINANCE_DIRECTION.OUT),
  }
}

export const financeDateHelpers = Object.freeze({ isoDateFrom, periodFrom })
import { businessDate } from '../utils'
