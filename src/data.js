const storeSeed = (id, name, short, revenue, expense, employees = 1) => ({
  id,
  name,
  short,
  location: short,
  address: '',
  employees,
  revenue,
  expense,
  status: 'Hoạt động',
  accent: '#075fba',
})

export const storesSeed = [
  storeSeed('CH001', 'SecondMall SM234', 'SM234', 518000000, 286000000, 2),
  storeSeed('CH002', 'Idosi Tô Ngọc Vân', 'Tô Ngọc Vân', 476000000, 249000000),
  storeSeed('CH003', 'Idosi Dĩ An', 'Dĩ An', 442000000, 231000000),
  storeSeed('CH004', 'Idosi Kha Vạn Cân', 'Kha Vạn Cân', 421000000, 225000000),
  storeSeed('CH005', 'Idosi Tây Hòa', 'Tây Hòa', 405000000, 214000000),
  storeSeed('CH006', 'Idosi Nguyễn Văn Thương', 'Nguyễn Văn Thương', 397000000, 207000000),
  storeSeed('CH007', 'Idosi Nơ Trang Long', 'Nơ Trang Long', 382000000, 198000000),
  storeSeed('CH008', 'Idosi Lê Văn Thọ', 'Lê Văn Thọ', 369000000, 193000000),
  storeSeed('CH009', 'Idosi Buôn Ma Thuộc', 'Buôn Ma Thuộc', 351000000, 184000000),
]

const address = (province, ward, street) => ({ province, ward, street })

const employeeSeed = ({
  id,
  name,
  cccd,
  phone,
  province,
  ward,
  street,
  salary,
  position,
  age,
  username,
  storeId,
  employmentType = 'Full-time',
  unit = 'store',
  status = 'Đang làm việc',
  color = '#d9c2b6',
}) => ({
  id,
  code: id,
  employeeCode: id,
  name,
  cccd,
  citizenId: cccd,
  phone,
  province,
  ward,
  street,
  addressDetails: address(province, ward, street),
  address: [street, ward, province].filter(Boolean).join(', '),
  salary,
  payBasis: employmentType === 'Part-time' ? 'hourly' : 'monthly',
  salaryBasis: employmentType === 'Part-time' ? 'hourly' : 'monthly',
  salaryUnit: employmentType === 'Part-time' ? 'hour' : 'month',
  monthlySalary: employmentType === 'Part-time' ? null : salary,
  hourlyRate: employmentType === 'Part-time' ? salary : null,
  compensationVersion: 2,
  standardWorkDays: 26,
  currency: 'VND',
  position,
  workPosition: position,
  role: position,
  shortRole: position.replace(/^Nhân viên\s*/i, ''),
  age,
  cccdImage: '',
  cccdImageName: '',
  cccdImages: [],
  username,
  password: 'idosi123',
  status,
  unit,
  unitType: unit,
  department: unit,
  isOffice: unit === 'office',
  storeId,
  employmentType,
  color,
  roleType: 'employee',
  workStart: unit === 'office' ? '08:00' : '07:00',
  workEnd: unit === 'office' ? '17:00' : '12:00',
})

export const employeesSeed = [
  employeeSeed({ id: 'NV001', name: 'Nguyễn Minh Anh', cccd: '079203000001', phone: '0901000001', province: 'TP. Hồ Chí Minh', ward: 'Phường Linh Tây', street: '234 Đường số 9', salary: 8000000, position: 'Nhân viên bán hàng', age: 23, username: 'employee', storeId: 'CH001', employmentType: 'Full-time', color: '#b6d2df' }),
  employeeSeed({ id: 'NV002', name: 'Trần Gia Bảo', cccd: '079202000002', phone: '0901000002', province: 'TP. Hồ Chí Minh', ward: 'Phường Tam Phú', street: 'Tô Ngọc Vân', salary: 43000, position: 'Nhân viên bán hàng', age: 24, username: 'nv.tongocvan', storeId: 'CH002', employmentType: 'Part-time', color: '#f1c4ae' }),
  employeeSeed({ id: 'NV003', name: 'Lê Hoàng Chi', cccd: '074204000003', phone: '0901000003', province: 'Bình Dương', ward: 'Phường Dĩ An', street: 'Đường Nguyễn An Ninh', salary: 7800000, position: 'Nhân viên thu ngân', age: 22, username: 'nv.dian', storeId: 'CH003', color: '#f4d0b7' }),
  employeeSeed({ id: 'NV004', name: 'Phạm Đức Duy', cccd: '079201000004', phone: '0901000004', province: 'TP. Hồ Chí Minh', ward: 'Phường Linh Đông', street: 'Kha Vạn Cân', salary: 7600000, position: 'Nhân viên kho', age: 25, username: 'nv.khavan', storeId: 'CH004', color: '#c5d3de' }),
  employeeSeed({ id: 'NV005', name: 'Võ Ngọc Hà', cccd: '079205000005', phone: '0901000005', province: 'TP. Hồ Chí Minh', ward: 'Phường Phước Long A', street: 'Tây Hòa', salary: 41000, position: 'Nhân viên bán hàng', age: 21, username: 'nv.tayhoa', storeId: 'CH005', employmentType: 'Part-time', color: '#f0bda9' }),
  employeeSeed({ id: 'NV006', name: 'Đặng Minh Khang', cccd: '079200000006', phone: '0901000006', province: 'TP. Hồ Chí Minh', ward: 'Phường 25', street: 'Nguyễn Văn Thương', salary: 7900000, position: 'Nhân viên bán hàng', age: 26, username: 'nv.nguyenvanthuong', storeId: 'CH006', color: '#a8cad8' }),
  employeeSeed({ id: 'NV007', name: 'Huỳnh Như Ý', cccd: '079204000007', phone: '0901000007', province: 'TP. Hồ Chí Minh', ward: 'Phường 13', street: 'Nơ Trang Long', salary: 42000, position: 'Nhân viên thu ngân', age: 22, username: 'nv.notranglong', storeId: 'CH007', employmentType: 'Part-time', color: '#edc5b5' }),
  employeeSeed({ id: 'NV008', name: 'Bùi Quang Huy', cccd: '079199000008', phone: '0901000008', province: 'TP. Hồ Chí Minh', ward: 'Phường 11', street: 'Lê Văn Thọ', salary: 7700000, position: 'Nhân viên kho', age: 27, username: 'nv.levantho', storeId: 'CH008', color: '#c5d0d7' }),
  employeeSeed({ id: 'NV009', name: 'Ngô Thanh Lam', cccd: '066203000009', phone: '0901000009', province: 'Đắk Lắk', ward: 'Phường Tân Lợi', street: 'Đường Phan Chu Trinh', salary: 7500000, position: 'Nhân viên bán hàng', age: 23, username: 'nv.buonmathuoc', storeId: 'CH009', color: '#c9d8b6' }),
  employeeSeed({ id: 'VP001', name: 'Đỗ Thu Trang', cccd: '079197000010', phone: '0901000010', province: 'TP. Hồ Chí Minh', ward: 'Phường 25', street: '12 Nguyễn Văn Thương', salary: 12000000, position: 'Nhân viên hành chính', age: 29, username: 'office', storeId: 'OFFICE', unit: 'office', color: '#ccd9ef' }),
  employeeSeed({ id: 'VP002', name: 'Trương Quốc Việt', cccd: '079195000011', phone: '0901000011', province: 'TP. Hồ Chí Minh', ward: 'Phường 25', street: '18 Nguyễn Văn Thương', salary: 15000000, position: 'Kế toán', age: 31, username: 'office.accounting', storeId: 'OFFICE', unit: 'office', color: '#d8cceb' }),
]

export const managerAccountsSeed = [
  {
    id: 'QL001',
    code: 'QL001',
    managerCode: 'QL001',
    name: 'Trần Minh Quân',
    cccd: '079190000101',
    citizenId: '079190000101',
    phone: '0902000001',
    province: 'TP. Hồ Chí Minh',
    ward: 'Phường Linh Tây',
    street: '234 Đường số 9',
    addressDetails: address('TP. Hồ Chí Minh', 'Phường Linh Tây', '234 Đường số 9'),
    address: '234 Đường số 9, Phường Linh Tây, TP. Hồ Chí Minh',
    salary: 18000000,
    age: 36,
    cccdImage: '',
    cccdImageName: '',
    cccdImages: [],
    username: 'manager',
    password: 'idosi123',
    role: 'store',
    accountType: 'manager',
    storeScope: 'global',
    status: 'Đang hoạt động',
    storeId: '',
    assignedStoreId: '',
  },
]

export const adminAccountsSeed = [
  {
    id: 'ADMIN',
    code: 'ADMIN',
    username: 'admin',
    password: 'idosi123',
    role: 'admin',
    accountType: 'admin',
    name: 'Quản trị cấp cao',
    status: 'Đang hoạt động',
  },
]

export const shifts = [
  { id: 'ca1', name: 'Ca 1', time: '07:00 - 12:00', start: '07:00', end: '12:00', color: '#07873d', tint: '#e9f8ee' },
  { id: 'ca2', name: 'Ca 2', time: '12:00 - 17:00', start: '12:00', end: '17:00', color: '#f06b12', tint: '#fff4e9' },
  { id: 'ca3', name: 'Ca 3', time: '17:00 - 23:00', start: '17:00', end: '23:00', color: '#5b37e8', tint: '#f1edff' },
]

export const scheduleSeed = [
  { employeeId: 'NV001', storeId: 'CH001', shiftIds: ['ca1', 'ca3'] },
  { employeeId: 'NV002', storeId: 'CH002', shiftIds: ['ca1', 'ca2'] },
  { employeeId: 'NV003', storeId: 'CH003', shiftIds: ['ca2', 'ca3'] },
  { employeeId: 'NV004', storeId: 'CH004', shiftIds: ['ca2', 'ca3'] },
  { employeeId: 'NV005', storeId: 'CH005', shiftIds: ['ca1', 'ca2'] },
  { employeeId: 'NV006', storeId: 'CH006', shiftIds: ['ca2', 'ca3'] },
  { employeeId: 'NV007', storeId: 'CH007', shiftIds: ['ca3'] },
  { employeeId: 'NV008', storeId: 'CH008', shiftIds: ['ca1'] },
  { employeeId: 'NV009', storeId: 'CH009', shiftIds: ['ca1'] },
  { employeeId: 'VP001', storeId: 'OFFICE', shiftIds: ['ca1'] },
  { employeeId: 'VP002', storeId: 'OFFICE', shiftIds: ['ca1'] },
]

const demoLocation = (label) => ({
  latitude: 10.8506,
  longitude: 106.7719,
  accuracy: 18,
  label,
})

const attendanceRecord = ({
  id,
  date,
  employeeId,
  storeId,
  unit = 'store',
  shift = 'ca1',
  shiftStart = '07:00',
  shiftEnd = '12:00',
  checkIn,
  checkOut,
  arrivalTag = 'Đúng giờ',
  departureTag = 'Đúng giờ',
  hours,
  note = '',
}) => {
  const location = demoLocation(unit === 'office' ? 'Văn phòng IDOSI' : storesSeed.find((store) => store.id === storeId)?.name || 'IDOSI')
  return {
    id,
    date,
    workDate: date,
    employeeId,
    storeId,
    unit,
    unitType: unit,
    department: unit,
    shift,
    shiftStart,
    shiftEnd,
    checkIn,
    checkOut,
    checkInAt: `${date}T${checkIn}:00+07:00`,
    checkOutAt: `${date}T${checkOut}:00+07:00`,
    checkInLocation: location,
    checkOutLocation: location,
    location,
    locationName: location.label,
    arrivalTag,
    departureTag,
    punctuality: arrivalTag,
    status: arrivalTag === 'Đi trễ' ? 'Trễ' : arrivalTag,
    hours,
    note,
  }
}

export const attendanceSeed = [
  attendanceRecord({ id: 'CC001', date: '2026-08-10', employeeId: 'NV001', storeId: 'CH001', checkIn: '06:50', checkOut: '12:03', arrivalTag: 'Đi sớm', hours: 5.22 }),
  attendanceRecord({ id: 'CC002', date: '2026-08-09', employeeId: 'NV001', storeId: 'CH001', checkIn: '07:02', checkOut: '12:05', hours: 5.05 }),
  attendanceRecord({ id: 'CC003', date: '2026-08-08', employeeId: 'NV002', storeId: 'CH002', shift: 'ca2', shiftStart: '12:00', shiftEnd: '17:00', checkIn: '12:11', checkOut: '16:52', arrivalTag: 'Đi trễ', departureTag: 'Về sớm', hours: 4.68, note: 'Đi trễ 11 phút' }),
  attendanceRecord({ id: 'CC004', date: '2026-08-08', employeeId: 'NV003', storeId: 'CH003', shift: 'ca2', shiftStart: '12:00', shiftEnd: '17:00', checkIn: '12:00', checkOut: '17:04', hours: 5.07 }),
  attendanceRecord({ id: 'CC005', date: '2026-08-07', employeeId: 'NV004', storeId: 'CH004', shift: 'ca3', shiftStart: '17:00', shiftEnd: '23:00', checkIn: '16:53', checkOut: '23:08', arrivalTag: 'Đi sớm', departureTag: 'Về trễ', hours: 6.25 }),
  attendanceRecord({ id: 'CC006', date: '2026-08-11', employeeId: 'VP001', storeId: 'OFFICE', unit: 'office', shiftStart: '08:00', shiftEnd: '17:00', checkIn: '07:51', checkOut: '17:03', arrivalTag: 'Đi sớm', hours: 9.2 }),
  attendanceRecord({ id: 'CC007', date: '2026-08-10', employeeId: 'VP001', storeId: 'OFFICE', unit: 'office', shiftStart: '08:00', shiftEnd: '17:00', checkIn: '08:03', checkOut: '17:01', hours: 8.97 }),
  attendanceRecord({ id: 'CC008', date: '2026-08-11', employeeId: 'VP002', storeId: 'OFFICE', unit: 'office', shiftStart: '08:00', shiftEnd: '17:00', checkIn: '08:12', checkOut: '16:48', arrivalTag: 'Đi trễ', departureTag: 'Về sớm', hours: 8.6, note: 'Đi trễ 12 phút' }),
]

export const officeAdjustmentsSeed = [
  { id: 'DCH001', type: 'Thưởng', kind: 'Thưởng', adjustmentType: 'Thưởng', date: '2026-08-10', employeeId: 'VP001', employeeName: 'Đỗ Thu Trang', amount: 500000, content: 'Hoàn thành tốt công việc tháng' },
  { id: 'DCH002', type: 'Phụ cấp', kind: 'Phụ cấp', adjustmentType: 'Phụ cấp', date: '2026-08-10', employeeId: 'VP002', employeeName: 'Trương Quốc Việt', amount: 300000, content: 'Phụ cấp điện thoại' },
]

export const tasksSeed = [
  { id: 1, title: 'Mở cửa hàng, kiểm tra vệ sinh', detail: 'Mở cửa đúng giờ, bật đèn, kiểm tra khu vực trưng bày', done: false },
  { id: 2, title: 'Sắp xếp, trưng bày sản phẩm', detail: 'Sắp xếp quần áo, phụ kiện gọn gàng, đẹp mắt', done: false },
  { id: 3, title: 'Tư vấn & hỗ trợ khách hàng', detail: 'Tư vấn sản phẩm, hỗ trợ khách thử đồ', done: false },
  { id: 4, title: 'Báo cáo doanh thu đầu ca', detail: 'Báo cáo doanh thu đầu ca cho quản lý', done: false },
  { id: 5, title: 'Kiểm tra & báo cáo tồn kho', detail: 'Kiểm tra hàng hóa, báo cáo sản phẩm sắp hết', done: false },
  { id: 6, title: 'Vệ sinh & dọn dẹp cuối ca', detail: 'Dọn dẹp khu vực làm việc, sản phẩm gọn gàng', done: false },
]

export const importsSeed = [
  { id: 'NH001', storeId: 'CH001', name: 'Chân váy', category: 'Thời trang nữ', quantity: 15, unit: 'Bao', weight: 120, price: 120000, shipping: 15000, createdAt: '2026-08-10 09:30', creator: 'Nguyễn Minh Anh' },
  { id: 'NH002', storeId: 'CH001', name: 'Đồ nam', category: 'Thời trang nam', quantity: 20, unit: 'Bao', weight: 210.5, price: 150000, shipping: 20000, createdAt: '2026-08-09 09:25', creator: 'Nguyễn Minh Anh' },
  { id: 'NH003', storeId: 'CH002', name: 'Áo dài', category: 'Thời trang nữ', quantity: 10, unit: 'Bao', weight: 80, price: 200000, shipping: 15000, createdAt: '2026-08-08 16:45', creator: 'Trần Gia Bảo' },
  { id: 'NH004', storeId: 'CH003', name: 'Đồ bộ', category: 'Đồ mặc nhà', quantity: 18, unit: 'Bao', weight: 150.3, price: 130000, shipping: 18000, createdAt: '2026-08-08 16:20', creator: 'Lê Hoàng Chi' },
  { id: 'NH005', storeId: 'CH004', name: 'Phụ kiện', category: 'Phụ kiện', quantity: 25, unit: 'Bao', weight: 45, price: 60000, shipping: 10000, createdAt: '2026-08-07 11:10', creator: 'Phạm Đức Duy' },
]

export const cashSeries = [
  { day: '01/08', revenue: 21, expense: 11, profit: 10 },
  { day: '02/08', revenue: 16, expense: 9, profit: 7 },
  { day: '03/08', revenue: 13, expense: 8, profit: 5 },
  { day: '04/08', revenue: 27, expense: 12, profit: 15 },
  { day: '05/08', revenue: 26, expense: 13, profit: 13 },
  { day: '06/08', revenue: 21, expense: 10, profit: 11 },
  { day: '07/08', revenue: 29, expense: 11, profit: 18 },
  { day: '08/08', revenue: 28, expense: 12, profit: 16 },
  { day: '09/08', revenue: 21, expense: 9, profit: 12 },
  { day: '10/08', revenue: 30, expense: 13, profit: 17 },
  { day: '11/08', revenue: 34, expense: 14, profit: 20 },
  { day: '12/08', revenue: 20, expense: 12, profit: 8 },
  { day: '13/08', revenue: 44, expense: 16, profit: 28 },
  { day: '14/08', revenue: 23, expense: 11, profit: 12 },
  { day: '15/08', revenue: 14, expense: 8, profit: 6 },
]

export const adminSeries = [
  { day: '06/08', revenue: 90, expense: 49, profit: 41 },
  { day: '07/08', revenue: 86, expense: 42, profit: 44 },
  { day: '08/08', revenue: 92, expense: 52, profit: 40 },
  { day: '09/08', revenue: 91, expense: 54, profit: 37 },
  { day: '10/08', revenue: 108, expense: 72, profit: 36 },
  { day: '11/08', revenue: 101, expense: 61, profit: 40 },
  { day: '12/08', revenue: 97, expense: 56, profit: 41 },
]

export const payRows = [
  { employeeId: 'NV001', hours: 208.5, base: 8000000, tiktokAllowance: 500000, tiktokBonus: 1000000, other: 300000, bonus: 500000 },
  { employeeId: 'NV002', hours: 104, base: 4472000, tiktokAllowance: 200000, tiktokBonus: 500000, other: 200000, bonus: 250000 },
  { employeeId: 'NV003', hours: 202, base: 7800000, tiktokAllowance: 300000, tiktokBonus: 700000, other: 250000, bonus: 400000 },
]

export const managerPayrollSeed = [
  { id: 1, managerId: 'QL001', month: '08/2026', store: 'SecondMall SM234', salary: 18000000, bonus: 3000000, allowance: 1500000, updatedAt: '12/08/2026 14:30' },
  { id: 2, managerId: 'QL001', month: '07/2026', store: 'SecondMall SM234', salary: 18000000, bonus: 2500000, allowance: 1000000, updatedAt: '20/07/2026 10:15' },
]

export const demoAccounts = [
  { username: 'admin', password: 'idosi123', role: 'admin', accountType: 'admin', name: 'Quản trị cấp cao', code: 'ADMIN' },
  { username: 'manager', password: 'idosi123', role: 'store', accountType: 'manager', storeScope: 'global', name: 'Trần Minh Quân', code: 'QL001', storeId: '' },
  { username: 'office', password: 'idosi123', role: 'employee', accountType: 'employee', unit: 'office', name: 'Đỗ Thu Trang', code: 'VP001', employeeId: 'VP001', storeId: 'OFFICE' },
  { username: 'employee', password: 'idosi123', role: 'employee', accountType: 'employee', unit: 'store', name: 'Nguyễn Minh Anh', code: 'NV001', employeeId: 'NV001', storeId: 'CH001', employmentType: 'Full-time' },
]
