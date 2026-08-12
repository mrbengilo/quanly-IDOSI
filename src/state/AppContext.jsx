/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react'
import {
  adminAccountsSeed,
  attendanceSeed,
  employeesSeed,
  importsSeed,
  managerAccountsSeed,
  managerPayrollSeed,
  officeAdjustmentsSeed,
  scheduleSeed,
  shifts,
  storesSeed,
  tasksSeed,
} from '../data'
import {
  buildAddress,
  calculateWorkedHours,
  getEmployeeType,
  getPayBasis,
  getHourlyRate,
  getMonthlySalary,
  getArrivalTag,
  getDepartureTag,
  normalizeLocation,
  normalizePhone,
  today,
  uid,
} from '../utils'

const AppContext = createContext(null)
export const STORAGE_KEY = 'idosi-manager-state-v1'

const clone = (value) => JSON.parse(JSON.stringify(value))
const normalizeText = (value) => String(value ?? '').trim().toLowerCase()
const isOfficeUnit = (value) => ['office', 'văn phòng', 'van phong', 'khối văn phòng', 'khoi van phong', 'vp'].includes(normalizeText(value))
const isActiveAccount = (status) => !['tạm ngưng', 'tạm nghỉ', 'đã nghỉ việc', 'inactive', 'disabled'].includes(normalizeText(status))

const addressDetailsFrom = (payload = {}) => {
  const nested = payload.addressDetails || (typeof payload.address === 'object' ? payload.address : {}) || {}
  return {
    province: String(payload.province ?? payload.addressProvince ?? nested.province ?? nested.provinceCity ?? '').trim(),
    ward: String(payload.ward ?? payload.addressWard ?? nested.ward ?? '').trim(),
    street: String(payload.street ?? payload.addressStreet ?? nested.street ?? (typeof payload.address === 'string' ? payload.address : '')).trim(),
  }
}

const normalizeCccdImages = (payload = {}) => {
  if (Array.isArray(payload.cccdImages)) return payload.cccdImages
  const image = payload.cccdImage || payload.identityImage || ''
  return image ? [image] : []
}

const normalizeEmployee = (payload = {}, fallbackStoreId = storesSeed[0]?.id) => {
  const details = addressDetailsFrom(payload)
  const proposedUnit = payload.unit ?? payload.unitType ?? payload.department ?? payload.employeeGroup
  const unit = payload.isOffice || isOfficeUnit(proposedUnit) || isOfficeUnit(payload.storeId) ? 'office' : 'store'
  const position = String(payload.position ?? payload.workPosition ?? payload.role ?? 'Nhân viên bán hàng').trim()
  const id = String(payload.id || payload.code || payload.employeeCode || uid(unit === 'office' ? 'VP' : 'NV')).trim()
  const cccdImage = payload.cccdImage || payload.identityImage || ''
  const cccdImageName = payload.cccdImageName || payload.identityImageName || ''
  const phone = normalizePhone(payload.phone)
  const storeId = unit === 'office' ? 'OFFICE' : String(payload.storeId || fallbackStoreId || '').trim()
  const employmentType = getEmployeeType(payload)
  const rawSalary = Math.max(0, Number(payload.salary) || 0)
  const hasExplicitBasis = Boolean(payload.payBasis || payload.salaryBasis || payload.salaryType || payload.salaryUnit || payload.compensationVersion >= 2)
  let payBasis = getPayBasis({ ...payload, employmentType })
  if (employmentType === 'Part-time' && !hasExplicitBasis && !Number(payload.hourlyRate) && rawSalary > 500000) {
    payBasis = 'legacy'
  }
  const monthlySalary = payBasis === 'monthly' ? getMonthlySalary({ ...payload, salary: rawSalary, payBasis }) : 0
  const hourlyRate = payBasis === 'hourly' ? getHourlyRate({ ...payload, salary: rawSalary, payBasis }) : 0
  const normalizedSalary = payBasis === 'monthly' ? monthlySalary : payBasis === 'hourly' ? hourlyRate : rawSalary

  return {
    ...payload,
    id,
    code: String(payload.code || payload.employeeCode || id).trim(),
    employeeCode: String(payload.employeeCode || payload.code || id).trim(),
    name: String(payload.name || '').trim(),
    cccd: String(payload.cccd ?? payload.citizenId ?? '').trim(),
    citizenId: String(payload.cccd ?? payload.citizenId ?? '').trim(),
    phone,
    province: details.province,
    ward: details.ward,
    street: details.street,
    addressDetails: details,
    address: buildAddress(details),
    salary: normalizedSalary,
    payBasis,
    salaryBasis: payBasis,
    salaryUnit: payBasis === 'monthly' ? 'month' : payBasis === 'hourly' ? 'hour' : 'legacy',
    monthlySalary: monthlySalary || null,
    hourlyRate: hourlyRate || null,
    legacySalary: payBasis === 'legacy' ? rawSalary : null,
    compensationVersion: payBasis === 'legacy' ? 1 : 2,
    standardWorkDays: Math.max(1, Number(payload.standardWorkDays) || 26),
    currency: payload.currency || 'VND',
    position,
    workPosition: position,
    role: position,
    shortRole: String(payload.shortRole || position.replace(/^Nhân viên\s*/i, '')).trim(),
    age: Number(payload.age) || 0,
    cccdImage,
    cccdImageName,
    cccdImages: normalizeCccdImages(payload),
    username: String(payload.username || '').trim(),
    password: String(payload.password || ''),
    status: payload.status || 'Đang làm việc',
    unit,
    unitType: unit,
    department: unit,
    isOffice: unit === 'office',
    storeId,
    employmentType,
    employeeType: employmentType,
    color: payload.color || '#d9c2b6',
    roleType: 'employee',
    workStart: payload.workStart || (unit === 'office' ? '08:00' : '07:00'),
    workEnd: payload.workEnd || (unit === 'office' ? '17:00' : '12:00'),
  }
}

const normalizeManager = (payload = {}, fallbackStoreId = '') => {
  const details = addressDetailsFrom(payload)
  const id = String(payload.id || payload.code || payload.managerCode || uid('QL')).trim()
  const cccdImage = payload.cccdImage || payload.identityImage || ''
  const cccdImageName = payload.cccdImageName || payload.identityImageName || ''
  const storeScope = payload.storeScope || 'global'
  const scopedStoreId = storeScope === 'global'
    ? ''
    : String(payload.storeId || payload.assignedStoreId || fallbackStoreId || '').trim()
  return {
    ...payload,
    id,
    code: String(payload.code || payload.managerCode || id).trim(),
    managerCode: String(payload.managerCode || payload.code || id).trim(),
    name: String(payload.name || payload.managerName || '').trim(),
    cccd: String(payload.cccd ?? payload.citizenId ?? '').trim(),
    citizenId: String(payload.cccd ?? payload.citizenId ?? '').trim(),
    phone: normalizePhone(payload.phone),
    province: details.province,
    ward: details.ward,
    street: details.street,
    addressDetails: details,
    address: buildAddress(details),
    salary: Number(payload.salary) || 0,
    age: Number(payload.age) || 0,
    cccdImage,
    cccdImageName,
    cccdImages: normalizeCccdImages(payload),
    username: String(payload.username || '').trim(),
    password: String(payload.password || ''),
    status: payload.status || 'Đang hoạt động',
    storeId: scopedStoreId,
    assignedStoreId: scopedStoreId,
    storeScope,
    role: 'store',
    accountType: 'manager',
  }
}

const countStoreEmployees = (stores, employees) => stores.map((store) => ({
  ...store,
  employees: employees.filter((employee) => employee.unit === 'store' && employee.storeId === store.id && employee.status !== 'Đã nghỉ việc').length,
}))

const normalizeTask = (task = {}, fallbackStoreId = storesSeed[0]?.id) => ({
  ...task,
  id: task.id || uid('CV'),
  storeId: task.storeId || fallbackStoreId,
  shiftId: task.shiftId || task.shift || 'ca1',
  date: task.date || task.workDate || today(),
  title: String(task.title || '').trim(),
  detail: String(task.detail || '').trim(),
  done: Boolean(task.done),
})

const createInitialState = () => {
  const employees = employeesSeed.map((employee) => normalizeEmployee(clone(employee)))
  return {
    stores: countStoreEmployees(clone(storesSeed), employees),
    adminAccounts: clone(adminAccountsSeed),
    managerAccounts: managerAccountsSeed.map((manager) => normalizeManager(clone(manager))),
    employees,
    imports: clone(importsSeed),
    attendance: clone(attendanceSeed),
    schedule: clone(scheduleSeed),
    tasks: clone(tasksSeed).map((task) => normalizeTask(task)),
    managerPayroll: clone(managerPayrollSeed),
    officeAdjustments: clone(officeAdjustmentsSeed),
    activeStoreId: storesSeed[0]?.id || null,
    activeAttendanceId: null,
    session: null,
    checkedInAt: null,
    finishedShift: false,
    settings: {
      name: 'Quản trị cấp cao',
      email: 'admin@idosi.vn',
      phone: '0901000000',
      birthday: '1990-05-15',
      gender: 'Nam',
      address: 'TP. Hồ Chí Minh',
      bio: 'Quản trị HỆ THỐNG QUẢN LÝ IDOSI.',
    },
  }
}

const hydrateState = (stored) => {
  const base = createInitialState()
  if (!stored || typeof stored !== 'object') return base
  const employees = Array.isArray(stored.employees)
    ? stored.employees.map((employee) => normalizeEmployee(employee, stored.activeStoreId || base.activeStoreId))
    : base.employees
  const stores = Array.isArray(stored.stores) && stored.stores.length ? stored.stores : base.stores
  return {
    ...base,
    ...stored,
    stores: countStoreEmployees(stores, employees),
    employees,
    adminAccounts: Array.isArray(stored.adminAccounts) ? stored.adminAccounts : base.adminAccounts,
    managerAccounts: Array.isArray(stored.managerAccounts)
      ? stored.managerAccounts.map((manager) => normalizeManager(manager, stored.activeStoreId || base.activeStoreId))
      : base.managerAccounts,
    officeAdjustments: Array.isArray(stored.officeAdjustments) ? stored.officeAdjustments : base.officeAdjustments,
    tasks: Array.isArray(stored.tasks)
      ? stored.tasks.map((task) => normalizeTask(task, stored.activeStoreId || base.activeStoreId))
      : base.tasks,
    activeStoreId: stores.some((store) => store.id === stored.activeStoreId) ? stored.activeStoreId : stores[0]?.id || null,
  }
}

const readState = () => {
  try {
    if (typeof localStorage === 'undefined') return createInitialState()
    return hydrateState(JSON.parse(localStorage.getItem(STORAGE_KEY)))
  } catch {
    return createInitialState()
  }
}

const accountKey = (account = {}) => String(account.id || account.code || account.employeeCode || account.managerCode || '')

const toSession = (account, source) => {
  const common = {
    id: account.id || account.code,
    code: account.code || account.employeeCode || account.managerCode || account.id,
    name: account.name,
    username: account.username,
    storeId: account.storeId,
    accountType: source,
  }
  if (source === 'admin') return { ...common, role: 'admin' }
  if (source === 'manager') return { ...common, role: 'store', managerId: account.id || account.code, storeScope: account.storeScope || 'global' }
  return {
    ...common,
    role: 'employee',
    employeeId: account.id || account.code,
    unit: account.unit || 'store',
    unitType: account.unit || 'store',
    employmentType: account.employmentType,
    payBasis: account.payBasis,
    monthlySalary: account.monthlySalary,
    hourlyRate: account.hourlyRate,
    position: account.position,
  }
}

const localDateTime = (date) => {
  const pad = (value) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offset)
  return `${today(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
}

const timeLabel = (date) => date.toLocaleTimeString('vi-VN', { hour12: false })

const resolveDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (value) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

export function AppProvider({ children }) {
  const [state, setState] = useState(readState)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const notify = (message, type = 'success') => setToast({ id: Date.now(), message, type })

  const login = (username, password) => {
    const normalizedUsername = normalizeText(username)
    const sources = [
      ...state.adminAccounts.map((account) => ({ account, source: 'admin' })),
      ...state.managerAccounts.map((account) => ({ account, source: 'manager' })),
      ...state.employees.map((account) => ({ account, source: 'employee' })),
    ]
    const matched = sources.find(({ account }) => normalizeText(account.username) === normalizedUsername && account.password === password)
    if (!matched) return { ok: false, message: 'Tên đăng nhập hoặc mật khẩu chưa đúng.' }
    if (!isActiveAccount(matched.account.status)) return { ok: false, message: 'Tài khoản hiện không ở trạng thái hoạt động.' }

    const session = toSession(matched.account, matched.source)
    const workDate = today()
    const recent = matched.source === 'employee'
      ? state.attendance.find((record) => record.employeeId === session.employeeId && (record.date || record.workDate) === workDate)
      : null
    setState((current) => ({
      ...current,
      session,
      activeStoreId: matched.source === 'manager'
        ? current.activeStoreId
        : session.storeId && session.storeId !== 'OFFICE' ? session.storeId : current.activeStoreId,
      activeAttendanceId: recent && !recent.checkOutAt && !recent.checkOut ? recent.id : null,
      checkedInAt: recent?.checkIn || recent?.checkInTime || null,
      finishedShift: Boolean(recent?.checkOutAt || recent?.checkOut),
    }))
    return { ok: true, account: session }
  }

  const quickLogin = (role) => {
    const account = role === 'admin'
      ? state.adminAccounts[0]
      : role === 'store'
        ? state.managerAccounts[0]
        : state.employees.find((employee) => employee.unit === 'store') || state.employees[0]
    if (!account) return null
    const result = login(account.username, account.password)
    return result.ok ? result.account : null
  }

  const logout = () => setState((current) => ({
    ...current,
    session: null,
    activeAttendanceId: null,
    checkedInAt: null,
    finishedShift: false,
  }))

  const updateCollection = (key, updater) =>
    setState((current) => ({ ...current, [key]: updater(Array.isArray(current[key]) ? current[key] : []) }))

  const setActiveStoreId = (id) => {
    if (!state.stores.some((store) => store.id === id)) return false
    setState((current) => ({ ...current, activeStoreId: id }))
    return true
  }

  const addStore = (payload) => {
    const name = String(payload.name || '').trim().replace(/^DORE\s+/i, 'IDOSI ')
    const store = {
      id: payload.id || uid('CH'),
      employees: 0,
      revenue: 0,
      expense: 0,
      status: 'Hoạt động',
      accent: '#075fba',
      ...payload,
      name,
      short: payload.short || name.replace(/^(?:IDOSI|SecondMall)\s*/i, ''),
    }
    updateCollection('stores', (items) => [store, ...items])
    notify('Đã thêm cửa hàng mới.')
    return store
  }

  const updateStore = (id, payload) => {
    updateCollection('stores', (items) => items.map((store) => store.id === id ? { ...store, ...payload } : store))
    notify('Đã cập nhật cửa hàng.')
  }

  const deleteStore = (id) => {
    const inUse = state.employees.some((employee) => employee.storeId === id) || state.managerAccounts.some((manager) => manager.storeId === id)
    if (inUse) {
      notify('Không thể xóa cửa hàng đang có nhân sự phụ trách.', 'info')
      return false
    }
    setState((current) => {
      const stores = current.stores.filter((store) => store.id !== id)
      return { ...current, stores, activeStoreId: current.activeStoreId === id ? stores[0]?.id || null : current.activeStoreId }
    })
    notify('Đã xóa cửa hàng.', 'info')
    return true
  }

  const hasDuplicateAccount = (payload, ignoredKey = '') => {
    const records = [...state.managerAccounts, ...state.employees].filter((account) => accountKey(account) !== String(ignoredKey))
    const username = normalizeText(payload.username)
    const cccd = String(payload.cccd || payload.citizenId || '').trim()
    return records.some((account) =>
      (username && normalizeText(account.username) === username)
      || (cccd && String(account.cccd || account.citizenId || '') === cccd),
    )
  }

  const addManager = (payload) => {
    if (hasDuplicateAccount(payload)) {
      notify('Tên đăng nhập hoặc số CCCD đã tồn tại.', 'info')
      return { ok: false }
    }
    const manager = normalizeManager(payload, '')
    updateCollection('managerAccounts', (items) => [manager, ...items])
    notify('Đã tạo tài khoản quản lý.')
    return { ok: true, manager }
  }

  const updateManager = (id, payload) => {
    if (hasDuplicateAccount(payload, id)) {
      notify('Tên đăng nhập hoặc số CCCD đã tồn tại.', 'info')
      return { ok: false }
    }
    const previous = state.managerAccounts.find((manager) => accountKey(manager) === String(id))
    if (!previous) return { ok: false }
    const manager = normalizeManager({ ...previous, ...payload }, '')
    setState((current) => ({
      ...current,
      managerAccounts: current.managerAccounts.map((item) => accountKey(item) === String(id) ? manager : item),
      session: current.session?.managerId === id ? toSession(manager, 'manager') : current.session,
    }))
    notify('Đã cập nhật tài khoản quản lý.')
    return { ok: true, manager }
  }

  const deleteManager = (id) => {
    updateCollection('managerAccounts', (items) => items.filter((manager) => accountKey(manager) !== String(id)))
    notify('Đã xóa tài khoản quản lý.', 'info')
    return true
  }

  const addEmployee = (payload) => {
    if (hasDuplicateAccount(payload)) {
      notify('Tên đăng nhập hoặc số CCCD đã tồn tại.', 'info')
      return { ok: false }
    }
    const employee = normalizeEmployee(payload, state.activeStoreId)
    setState((current) => {
      const employees = [employee, ...current.employees]
      return { ...current, employees, stores: countStoreEmployees(current.stores, employees) }
    })
    notify('Đã lưu hồ sơ nhân viên.')
    return { ok: true, employee }
  }

  const updateEmployee = (id, payload) => {
    if (hasDuplicateAccount(payload, id)) {
      notify('Tên đăng nhập hoặc số CCCD đã tồn tại.', 'info')
      return { ok: false }
    }
    const previous = state.employees.find((employee) => accountKey(employee) === String(id))
    if (!previous) return { ok: false }
    const employee = normalizeEmployee({ ...previous, ...payload }, previous.storeId || state.activeStoreId)
    setState((current) => {
      const employees = current.employees.map((item) => accountKey(item) === String(id) ? employee : item)
      return {
        ...current,
        employees,
        stores: countStoreEmployees(current.stores, employees),
        session: current.session?.employeeId === id ? toSession(employee, 'employee') : current.session,
      }
    })
    notify('Đã cập nhật nhân viên.')
    return { ok: true, employee }
  }

  const deleteEmployee = (id) => {
    setState((current) => {
      const employees = current.employees.filter((employee) => accountKey(employee) !== String(id))
      return {
        ...current,
        employees,
        stores: countStoreEmployees(current.stores, employees),
        schedule: current.schedule.filter((item) => item.employeeId !== id),
      }
    })
    notify('Đã xóa nhân viên.', 'info')
    return true
  }

  const addOfficeAdjustment = (payload) => {
    const adjustment = {
      id: payload.id || uid('DCH'),
      date: payload.date || today(),
      type: payload.type || payload.kind || payload.adjustmentType || 'Thưởng',
      kind: payload.kind || payload.type || payload.adjustmentType || 'Thưởng',
      adjustmentType: payload.adjustmentType || payload.type || payload.kind || 'Thưởng',
      employeeId: payload.employeeId,
      employeeName: payload.employeeName || state.employees.find((employee) => employee.id === payload.employeeId)?.name || '',
      amount: Number(payload.amount) || 0,
      content: String(payload.content || payload.note || '').trim(),
      createdAt: payload.createdAt || localDateTime(new Date()),
    }
    updateCollection('officeAdjustments', (items) => [adjustment, ...items])
    notify(`Đã lưu khoản ${adjustment.type.toLowerCase()}.`)
    return adjustment
  }

  const updateOfficeAdjustment = (id, payload) => {
    updateCollection('officeAdjustments', (items) => items.map((item) => item.id === id ? { ...item, ...payload, amount: Number(payload.amount ?? item.amount) || 0 } : item))
    notify('Đã cập nhật thưởng/phụ cấp.')
  }

  const deleteOfficeAdjustment = (id) => {
    updateCollection('officeAdjustments', (items) => items.filter((item) => item.id !== id))
    notify('Đã xóa khoản thưởng/phụ cấp.', 'info')
  }

  const addImport = (payload) => {
    const record = {
      id: uid('NH'),
      storeId: payload.storeId || state.session?.storeId || state.activeStoreId,
      createdAt: new Date().toLocaleString('vi-VN'),
      creator: state.session?.name || 'Quản lý',
      ...payload,
    }
    updateCollection('imports', (items) => [record, ...items])
    notify('Đã thêm mặt hàng nhập kho.')
    return record
  }

  const deleteImport = (id) => {
    updateCollection('imports', (items) => items.filter((item) => item.id !== id))
    notify('Đã xóa mặt hàng.', 'info')
  }

  const updateImport = (id, payload) => {
    updateCollection('imports', (items) => items.map((item) => item.id === id ? {
      ...item,
      ...payload,
      quantity: Number(payload.quantity ?? item.quantity) || 0,
      weight: Number(payload.weight ?? item.weight) || 0,
      price: Number(payload.price ?? item.price) || 0,
      shipping: Number(payload.shipping ?? item.shipping) || 0,
      updatedAt: new Date().toLocaleString('vi-VN'),
    } : item))
    notify('Đã cập nhật mặt hàng nhập kho.')
    return true
  }

  const setTaskDone = (id, done, employeeId = state.session?.employeeId || state.session?.code) => {
    updateCollection('tasks', (items) => items.map((item) => item.id === id ? {
      ...item,
      ...(employeeId
        ? { completedBy: { ...(item.completedBy || {}), [employeeId]: Boolean(done) } }
        : { done: Boolean(done) }),
    } : item))
  }

  const replaceTasks = (tasks) => {
    const nextTasks = (Array.isArray(tasks) ? tasks : []).map((task) => normalizeTask(task, state.activeStoreId))
    const scope = nextTasks[0]
    setState((current) => ({
      ...current,
      tasks: scope
        ? [
            ...nextTasks,
            ...current.tasks.filter((task) => !(
              String(task.storeId) === String(scope.storeId)
              && String(task.shiftId || task.shift) === String(scope.shiftId)
              && String(task.date || task.workDate) === String(scope.date)
            )),
          ]
        : current.tasks,
    }))
    notify('Đã lưu và gửi danh sách công việc.')
  }

  const saveSchedule = (employeeIds, shiftId, details = {}) => {
    updateCollection('schedule', (items) => {
      const scheduleDate = details.date || today()
      const schedule = new Map(items.map((item) => [`${item.employeeId}:${item.date || scheduleDate}`, { ...item, shiftIds: [...(item.shiftIds || [])] }]))
      employeeIds.forEach((employeeId) => {
        const employee = state.employees.find((item) => item.id === employeeId)
        const key = `${employeeId}:${scheduleDate}`
        const item = schedule.get(key) || { employeeId, storeId: employee?.storeId || state.activeStoreId, date: scheduleDate, shiftIds: [] }
        if (!item.shiftIds.includes(shiftId)) item.shiftIds.push(shiftId)
        schedule.set(key, { ...item, note: details.note ?? item.note ?? '' })
      })
      return [...schedule.values()]
    })
    notify('Đã lưu lịch phân ca.')
  }

  const saveManagerPayroll = (record) => {
    updateCollection('managerPayroll', (items) => [{ id: Date.now(), updatedAt: new Date().toLocaleString('vi-VN'), ...record }, ...items])
    notify('Đã lưu lương thưởng quản lý.')
  }

  const updateManagerPayroll = (id, record) => {
    updateCollection('managerPayroll', (items) => items.map((item) => item.id === id ? {
      ...item,
      ...record,
      id,
      updatedAt: new Date().toLocaleString('vi-VN'),
    } : item))
    notify('Đã cập nhật lương thưởng quản lý.')
  }

  const deleteManagerPayroll = (id) => {
    updateCollection('managerPayroll', (items) => items.filter((item) => item.id !== id))
    notify('Đã xóa bản ghi lương thưởng.', 'info')
  }

  const changeAdminPassword = (id, password) => {
    const accountExists = state.adminAccounts.some((account) => account.id === id || account.username === id)
    if (!accountExists) {
      notify('Không tìm thấy tài khoản quản trị.', 'info')
      return false
    }
    updateCollection('adminAccounts', (items) => items.map((account) =>
      account.id === id || account.username === id ? { ...account, password } : account,
    ))
    notify('Đã đổi mật khẩu quản trị.')
    return true
  }

  const saveSettings = (settings) => {
    setState((current) => ({ ...current, settings }))
    notify('Đã lưu thay đổi tài khoản.')
  }

  const addAttendanceRecord = (payload) => {
    const record = { id: payload.id || uid('CC'), ...payload }
    updateCollection('attendance', (items) => [record, ...items])
    return record
  }

  const updateAttendance = (id, payload) => {
    updateCollection('attendance', (items) => items.map((record) => record.id === id ? { ...record, ...payload } : record))
  }

  const deleteAttendance = (id) => {
    updateCollection('attendance', (items) => items.filter((record) => record.id !== id))
  }

  const checkIn = (payload = {}) => {
    const employeeId = payload.employeeId || state.session?.employeeId || state.session?.code
    const employee = state.employees.find((item) => item.id === employeeId || item.code === employeeId)
    if (!employee) {
      notify('Không tìm thấy hồ sơ nhân viên để điểm danh.', 'info')
      return { ok: false }
    }

    const at = resolveDate(payload.at || payload.checkInAt)
    const workDate = payload.date || today(at)
    const existing = state.attendance.find((record) => record.employeeId === employee.id && (record.date || record.workDate) === workDate && !record.checkOut && !record.checkOutAt)
    if (existing) {
      setState((current) => ({ ...current, activeAttendanceId: existing.id, checkedInAt: existing.checkIn || existing.checkInTime, finishedShift: false }))
      notify('Bạn đã điểm danh ca làm việc này.', 'info')
      return { ok: true, record: existing, existing: true }
    }

    const scheduled = shifts.find((shift) => shift.id === payload.shiftId)
    const shiftId = payload.shiftId || payload.shift || 'ca1'
    const shiftStart = payload.shiftStart || scheduled?.start || employee.workStart || (employee.unit === 'office' ? '08:00' : '07:00')
    const shiftEnd = payload.shiftEnd || scheduled?.end || employee.workEnd || (employee.unit === 'office' ? '17:00' : '12:00')
    const checkInTime = timeLabel(at)
    const storeName = state.stores.find((store) => store.id === employee.storeId)?.name
    const rawLocation = payload.location || payload.coords || (
      payload.latitude != null || payload.lat != null ? payload : null
    )
    const location = normalizeLocation(rawLocation, employee.unit === 'office' ? 'Văn phòng IDOSI' : storeName || 'IDOSI')
    const arrivalTag = getArrivalTag(checkInTime, shiftStart, payload.toleranceMinutes ?? 5)
    const record = {
      id: uid('CC'),
      date: workDate,
      workDate,
      attendanceDate: workDate,
      employeeId: employee.id,
      employeeName: employee.name,
      storeId: employee.storeId,
      unit: employee.unit,
      unitType: employee.unit,
      department: employee.unit,
      employmentTypeSnapshot: employee.employmentType,
      payBasisSnapshot: employee.payBasis,
      monthlySalarySnapshot: employee.monthlySalary,
      hourlyRateSnapshot: employee.hourlyRate,
      standardWorkDaysSnapshot: employee.standardWorkDays,
      shift: shiftId,
      shiftStart,
      shiftEnd,
      checkIn: checkInTime,
      checkInTime,
      checkInAt: localDateTime(at),
      checkInLocation: location,
      location,
      locationName: location?.label || '',
      checkOut: null,
      checkOutTime: null,
      checkOutAt: null,
      checkOutLocation: null,
      arrivalTag,
      departureTag: 'Chưa ra về',
      punctuality: arrivalTag,
      status: arrivalTag === 'Đi trễ' ? 'Trễ' : arrivalTag,
      hours: 0,
      note: arrivalTag === 'Đi trễ' ? 'Đi trễ so với giờ bắt đầu' : '',
    }
    setState((current) => ({
      ...current,
      attendance: [record, ...current.attendance],
      activeAttendanceId: record.id,
      checkedInAt: checkInTime,
      finishedShift: false,
    }))
    notify(`Điểm danh thành công lúc ${checkInTime}.`)
    return { ok: true, record }
  }

  const closeAttendance = (payload = {}, finishMessage = false) => {
    const employeeId = payload.employeeId || state.session?.employeeId || state.session?.code
    const openRecord = state.attendance.find((record) =>
      (state.activeAttendanceId ? record.id === state.activeAttendanceId : record.employeeId === employeeId)
      && !record.checkOut
      && !record.checkOutAt,
    )
    if (!openRecord) {
      notify('Không tìm thấy lượt điểm danh đang mở.', 'info')
      return { ok: false }
    }

    const at = resolveDate(payload.at || payload.checkOutAt)
    const checkOutTime = timeLabel(at)
    const rawLocation = payload.location || payload.coords || (
      payload.latitude != null || payload.lat != null ? payload : null
    )
    const location = normalizeLocation(rawLocation, openRecord.locationName || 'IDOSI')
    const departureTag = getDepartureTag(checkOutTime, openRecord.shiftEnd, payload.toleranceMinutes ?? 5)
    const checkOutAt = localDateTime(at)
    const hours = calculateWorkedHours(openRecord.checkInAt || openRecord.checkIn, checkOutAt)
    const updated = {
      ...openRecord,
      ...payload.details,
      checkOut: checkOutTime,
      checkOutTime,
      checkOutAt,
      checkOutLocation: location,
      departureTag,
      hours,
      revenue: Number(payload.revenue ?? payload.totalRevenue ?? (Number(payload.cash || 0) + Number(payload.transfer || 0))) || Number(openRecord.revenue) || 0,
      expense: Number(payload.expense) || Number(openRecord.expense) || 0,
      cash: Number(payload.cash) || Number(openRecord.cash) || 0,
      transfer: Number(payload.transfer) || Number(openRecord.transfer) || 0,
      tiktok: Boolean(payload.tiktok ?? openRecord.tiktok),
      note: payload.note ?? openRecord.note,
    }
    setState((current) => ({
      ...current,
      attendance: current.attendance.map((record) => record.id === openRecord.id ? updated : record),
      activeAttendanceId: null,
      checkedInAt: openRecord.checkIn || openRecord.checkInTime,
      finishedShift: true,
    }))
    notify(finishMessage ? 'Đã kết ca và lưu thông tin chấm công.' : `Đã ghi nhận ra về lúc ${checkOutTime}.`)
    return { ok: true, record: updated }
  }

  const checkOut = (payload = {}) => closeAttendance(payload, false)
  const finishShift = (payload = {}) => closeAttendance(payload, true)

  const resetDemo = () => {
    setState(createInitialState())
    notify('Đã khôi phục dữ liệu mẫu IDOSI.', 'info')
  }

  const selectedStoreId = state.session?.role === 'employee'
    ? state.session.storeId
    : state.activeStoreId || state.session?.storeId
  const activeStore = state.stores.find((store) => store.id === selectedStoreId)
    || (state.session?.role === 'employee' ? null : state.stores[0] || null)
  const currentEmployee = state.session?.employeeId ? state.employees.find((employee) => employee.id === state.session.employeeId) || null : null
  const currentManager = state.session?.managerId ? state.managerAccounts.find((manager) => manager.id === state.session.managerId) || null : null

  const value = {
    ...state,
    activeStore,
    currentEmployee,
    currentManager,
    toast,
    notify,
    login,
    quickLogin,
    logout,
    setActiveStoreId,
    setActiveStore: setActiveStoreId,
    addStore,
    updateStore,
    deleteStore,
    addManager,
    updateManager,
    deleteManager,
    addManagerAccount: addManager,
    updateManagerAccount: updateManager,
    deleteManagerAccount: deleteManager,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    addOfficeAdjustment,
    updateOfficeAdjustment,
    deleteOfficeAdjustment,
    addImport,
    updateImport,
    deleteImport,
    setTaskDone,
    replaceTasks,
    saveSchedule,
    saveManagerPayroll,
    updateManagerPayroll,
    deleteManagerPayroll,
    changeAdminPassword,
    saveSettings,
    addAttendanceRecord,
    updateAttendance,
    deleteAttendance,
    checkIn,
    checkOut,
    clockIn: checkIn,
    clockOut: checkOut,
    finishShift,
    resetDemo,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
