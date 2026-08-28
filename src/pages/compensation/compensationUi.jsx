/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import { InfoNote, PageHeader } from '../../components/UI'
import { entityId, safeErrorMessage } from './compensationViewModel'

export const displayDate = (value) => {
  const source = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(source)) return '—'
  return source.split('-').reverse().join('/')
}

export const displayDateTime = (value) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return displayDate(value)
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed)
}

export const vietnamToday = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export const employeeName = (employees, employeeId, fallback = '') => (
  employees.find((employee) => entityId(employee) === String(employeeId || ''))?.name
  || fallback
  || employeeId
  || '—'
)

export const storeName = (stores, storeId, fallback = '') => (
  stores.find((store) => entityId(store) === String(storeId || ''))?.name
  || fallback
  || storeId
  || '—'
)

export function AccessDenied({ subtitle = 'Tài khoản này không có quyền truy cập dữ liệu lương thưởng.' }) {
  return (
    <div className="page compensation-page">
      <PageHeader title="KHÔNG CÓ QUYỀN TRUY CẬP" subtitle={subtitle} icon={LockKeyhole} />
    </div>
  )
}

export function ActionError({ message }) {
  return message ? <InfoNote tone="red">{message}</InfoNote> : null
}

export function useCompensationAction(app) {
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')

  const run = async ({ key, action, payload, success, unavailable }) => {
    if (typeof action !== 'function') {
      setError(unavailable || 'Chức năng đang được đồng bộ với máy chủ. Dữ liệu hiện tại vẫn được giữ nguyên.')
      return false
    }
    setBusyKey(key)
    setError('')
    try {
      const result = await action(payload)
      if (success !== false) {
        const message = typeof success === 'function' ? success(result) : success
        app?.notify?.(message || 'Đã lưu thay đổi.', 'success')
      }
      return result ?? true
    } catch (actionError) {
      setError(safeErrorMessage(actionError))
      return false
    } finally {
      setBusyKey('')
    }
  }

  return { busyKey, error, setError, run }
}
