from __future__ import annotations

import argparse
from pathlib import Path


BASE_SHA = "5550461dd20c2f8f879514f5964da8382006065c"


class PatchError(RuntimeError):
    pass


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise PatchError(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def transform_employee_orders_page(text: str) -> str:
    old_scope = """  const employeeId = employeeKey(employee)
  const effectiveStoreId = effectiveEmployeeStoreId(session, employee)
  const store = storeForReference(stores, effectiveStoreId)
  const rows = employeeCreatedOrders(orders, employeeId, effectiveStoreId, {
    employees: app.employees,
    stores,
  })
  const total = rows.reduce((sum, order) => sum + Number(order.amount || 0), 0)
  const requestedOrderId = String(searchParams.get('order') || '')
  const requestedOrderMatch = operationalIdentifierRecordMatch(rows, requestedOrderId, (order) => [order.id, order.code])
  const requestedOrder = requestedOrderMatch.ambiguous ? null : requestedOrderMatch.record
  const requestedOrderKey = String(requestedOrder?.id || '')
  const openAttendance = employeeAttendance(attendance, employee, {
    employees: app.employees,
    stores,
    storeId: effectiveStoreId,
  }).find((record) => !record.checkOutAt && !record.checkOut)
"""
    new_scope = """  const employeeId = employeeKey(employee)
  // The currently open attendance is the source of truth for the employee's
  // operational store. This deliberately wins over a stale/home session after
  // a support-transfer window has ended but before the employee checks out.
  const openAttendance = employeeAttendance(attendance, employee, {
    employees: app.employees,
    stores,
  }).find((record) => !record.checkOutAt && !record.checkOut)
  const effectiveStoreId = effectiveEmployeeStoreId(session, employee)
  const workingStoreId = String(openAttendance?.storeId || effectiveStoreId)
  const store = storeForReference(stores, workingStoreId)
  const rows = ordersForOpenAttendance(orders, employeeId, openAttendance, attendance, {
    employees: app.employees,
    stores,
    shiftDefinitions: app.shiftDefinitions,
  })
  const total = rows.reduce((sum, order) => sum + Number(order.amount || 0), 0)
  const requestedOrderId = String(searchParams.get('order') || '')
  const requestedOrderMatch = operationalIdentifierRecordMatch(rows, requestedOrderId, (order) => [order.id, order.code])
  const requestedOrder = requestedOrderMatch.ambiguous ? null : requestedOrderMatch.record
  const requestedOrderKey = String(requestedOrder?.id || '')
"""
    text = replace_once(text, old_scope, new_scope, "employee orders active attendance scope")

    store_assignment = "      storeId: effectiveStoreId,"
    if text.count(store_assignment) != 2:
        raise PatchError(
            f"employee orders create store anchors: expected 2, found {text.count(store_assignment)}"
        )
    text = text.replace(store_assignment, "      storeId: workingStoreId,")

    text = replace_once(
        text,
        "        subtitle={`Mọi đơn hàng và doanh thu được ghi nhận cho ${store?.name || 'cửa hàng trực thuộc'}.`}",
        """        subtitle={openAttendance
          ? `Chỉ hiển thị đơn hàng thuộc ca đang làm tại ${store?.name || 'cửa hàng hiện tại'}.`
          : 'Chỉ hiển thị đơn hàng khi bạn đang có một ca làm việc mở.'}""",
        "employee orders page subtitle",
    )
    text = replace_once(
        text,
        """        <MetricCard label="TỔNG ĐƠN" value={rows.length} helper="Đơn chưa bị xóa" icon={ShoppingCart} tone="blue" />
        <MetricCard label="TỔNG DOANH THU" value={money(total)} helper="Từ đơn hàng thực tế" icon={Banknote} tone="green" />
        <MetricCard label="CA HIỆN TẠI" value={openAttendance?.shiftName || 'Chưa vào ca'} helper={openAttendance ? `${openAttendance.shiftStart || '—'} – ${openAttendance.shiftEnd || '—'}` : 'Điểm danh trước khi tạo đơn để gắn đúng ca'} icon={Clock3} tone="orange" />""",
        """        <MetricCard label="ĐƠN TRONG CA" value={rows.length} helper="Chỉ tính ca đang mở" icon={ShoppingCart} tone="blue" />
        <MetricCard label="DOANH THU TRONG CA" value={money(total)} helper="Từ đơn hàng đúng ca" icon={Banknote} tone="green" />
        <MetricCard label="CA HIỆN TẠI" value={openAttendance?.shiftName || 'Chưa vào ca'} helper={openAttendance ? `${openAttendance.shiftStart || '—'} – ${openAttendance.shiftEnd || '—'}` : 'Điểm danh trước khi tạo đơn để gắn đúng ca'} icon={Clock3} tone="orange" />""",
        "employee orders current-shift metrics",
    )
    text = replace_once(
        text,
        '      <Card title="Lịch sử đơn hàng">',
        '      <Card title="Đơn hàng trong ca đang làm">',
        "employee orders card title",
    )
    text = replace_once(
        text,
        '        ) : <EmptyState title="Chưa có đơn hàng" description="Nhấn Tạo đơn hàng để ghi nhận đơn đầu tiên." />}',
        """        ) : <EmptyState
          title={openAttendance ? 'Chưa có đơn hàng trong ca' : 'Chưa có ca đang mở'}
          description={openAttendance
            ? 'Đơn hàng bạn tạo trong ca sẽ tự động hiển thị tại đây.'
            : 'Hãy điểm danh vào ca trước khi xem và tạo đơn hàng.'}
        />}""",
        "employee orders empty state",
    )
    return text


def transform_assigned_tasks_page(text: str) -> str:
    start = text.find("export function EmployeeAssignedTasksPage()")
    end = text.find("\nexport default EmployeeShiftExpensePage", start)
    if start < 0 or end < 0:
        raise PatchError("employee assigned tasks component bounds missing")
    prefix, component, suffix = text[:start], text[start:end], text[end:]

    component = replace_once(
        component,
        "  const selectedShiftIsOpen = Boolean(attendance && attendanceShiftKey && selectedShiftKey === attendanceShiftKey)",
        """  // A legacy/custom attendance can be valid and open even when its shift name or
  // interval does not map to one of the three display templates. The default
  // tab already resolves from the attendance first and then from its tasks, so
  // keep that tab editable until checkout instead of leaving Save disabled.
  const selectedShiftIsOpen = Boolean(attendance && selectedShiftKey === defaultShiftKey)""",
        "assigned tasks open-shift fallback",
    )

    component = replace_once(
        component,
        """        requestRef.current = null
      }
    } finally {
      setSaving(false)
    }
  }

  return (""",
        """        requestRef.current = null
      } else {
        app.notify?.(result?.message || 'Không thể lưu kết quả công việc. Vui lòng tải lại trang và thử lại.', 'info')
      }
    } finally {
      setSaving(false)
    }
  }

  return (""",
        "assigned tasks failed-save feedback",
    )
    return prefix + component + suffix


TEST_CONTENT = """import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmployeeOrdersPage } from './EmployeeV2Pages'
import { EmployeeAssignedTasksPage } from './EmployeeShiftOperations'

const mocked = vi.hoisted(() => ({ app: {} }))
vi.mock('../../state/AppContext', () => ({ useApp: () => mocked.app }))

const employee = {
  id: 'E01', code: 'E01', employeeCode: 'E01', name: 'Nhân viên A',
  storeId: 'STORE-B', unit: 'store',
}

const openSupportAttendance = {
  id: 'ATT-SUPPORT-OPEN', employeeId: 'E01', storeId: 'STORE-C',
  supportTransferId: 'TRANSFER-BC-01', date: '2026-09-03',
  shiftId: 'SUPPORT_TRANSFER_TRANSFER-BC-01', shiftName: 'Ca hỗ trợ cửa hàng',
  shiftStart: '08:00', shiftEnd: '12:00', checkIn: '08:05',
  checkInAt: '2026-09-03T01:05:00.000Z', checkOut: null, checkOutAt: null,
}

const baseApp = () => ({
  apiStatus: 'connected',
  session: {
    role: 'employee', employeeId: 'E01', code: 'E01',
    // Simulate a stale/home session after the configured transfer window.
    storeId: 'STORE-B', homeStoreId: 'STORE-B',
  },
  currentEmployee: employee,
  employees: [employee],
  stores: [
    { id: 'STORE-B', name: 'Cửa hàng B' },
    { id: 'STORE-C', name: 'Cửa hàng C' },
  ],
  attendance: [openSupportAttendance, {
    ...openSupportAttendance,
    id: 'ATT-SUPPORT-CLOSED',
    date: '2026-09-02',
    checkInAt: '2026-09-02T01:00:00.000Z',
    checkOut: '12:00',
    checkOutAt: '2026-09-02T05:00:00.000Z',
  }],
  orders: [{
    id: 'ORDER-CURRENT', code: 'DH-CURRENT', employeeId: 'E01',
    storeId: 'STORE-C', attendanceId: 'ATT-SUPPORT-OPEN',
    customerName: 'Khách trong ca', amount: 120_000, paymentMethod: 'Tiền mặt',
    createdAt: '2026-09-03T02:00:00.000Z', status: 'Hoàn tất',
  }, {
    id: 'ORDER-OLD-SUPPORT', code: 'DH-OLD-SUPPORT', employeeId: 'E01',
    storeId: 'STORE-C', attendanceId: 'ATT-SUPPORT-CLOSED',
    customerName: 'Khách ca cũ', amount: 90_000, paymentMethod: 'Chuyển khoản',
    createdAt: '2026-09-02T02:00:00.000Z', status: 'Hoàn tất',
  }, {
    id: 'ORDER-HOME', code: 'DH-HOME', employeeId: 'E01',
    storeId: 'STORE-B', attendanceId: 'ATT-HOME-CLOSED',
    customerName: 'Khách cửa hàng chính', amount: 80_000, paymentMethod: 'Tiền mặt',
    createdAt: '2026-09-01T02:00:00.000Z', status: 'Hoàn tất',
  }],
  orderInformationOptions: [],
  shiftDefinitions: [],
  tasks: [],
  taskAssignmentHistory: [],
  createOrder: vi.fn().mockResolvedValue({ ok: true }),
  saveStoreTaskProgress: vi.fn().mockResolvedValue({ ok: true, completionRate: 100 }),
  notify: vi.fn(),
})

const renderOrders = () => render(
  <MemoryRouter initialEntries={['/employee/orders']}><EmployeeOrdersPage /></MemoryRouter>,
)

const renderTasks = () => render(
  <MemoryRouter initialEntries={['/employee/tasks']}><EmployeeAssignedTasksPage /></MemoryRouter>,
)

describe('employee active-shift context', () => {
  beforeEach(() => {
    mocked.app = baseApp()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows only orders from the open support attendance and keeps order entry at the destination store', () => {
    renderOrders()

    expect(screen.getByText('DH-CURRENT')).toBeTruthy()
    expect(screen.queryByText('DH-OLD-SUPPORT')).toBeNull()
    expect(screen.queryByText('DH-HOME')).toBeNull()
    expect(screen.getByText('Đơn hàng trong ca đang làm')).toBeTruthy()
    expect(screen.getByText('ĐƠN TRONG CA')).toBeTruthy()
    expect(screen.getByText('DOANH THU TRONG CA')).toBeTruthy()

    const createButton = screen.getByRole('button', { name: 'TẠO ĐƠN HÀNG' })
    expect(createButton.disabled).toBe(false)
    fireEvent.click(createButton)
    expect(screen.getByText('Tạo đơn hàng • Cửa hàng C')).toBeTruthy()
  })

  it('keeps Save usable for a valid open custom/support shift that has no canonical display template', async () => {
    mocked.app.attendance = [{
      ...openSupportAttendance,
      shiftName: 'Ca hỗ trợ linh hoạt',
      shiftStart: '08:15',
      shiftEnd: '12:15',
      checkIn: undefined,
    }]
    mocked.app.tasks = [{
      id: 'TASK-SUPPORT-CUSTOM', checklistAttendanceId: 'ATT-SUPPORT-OPEN',
      storeId: 'STORE-C', date: '2026-09-03',
      shiftId: 'SUPPORT_TRANSFER_TRANSFER-BC-01', employeeIds: ['E01'],
      title: 'Hoàn tất công việc tại cửa hàng C', required: true,
      catalogKind: 'FIXED_TASK', completedBy: {},
    }]

    renderTasks()

    const checkbox = screen.getByRole('checkbox', { name: /Hoàn tất công việc tại cửa hàng C/u })
    expect(checkbox.disabled).toBe(false)
    fireEvent.click(checkbox)

    const saveButton = screen.getByRole('button', { name: 'LƯU KẾT QUẢ' })
    expect(saveButton.disabled).toBe(false)
    fireEvent.click(saveButton)

    await waitFor(() => expect(mocked.app.saveStoreTaskProgress).toHaveBeenCalledWith(expect.objectContaining({
      attendanceId: 'ATT-SUPPORT-OPEN',
      tasks: [{ id: 'TASK-SUPPORT-CUSTOM', completed: true }],
      incompleteReason: '',
      idempotencyKey: expect.stringMatching(/^task-progress:/u),
    })))
  })
})
"""


def patch(root: Path, write: bool) -> None:
    targets = {
        Path("src/pages/employee/EmployeeV2Pages.jsx"): transform_employee_orders_page,
        Path("src/pages/employee/EmployeeShiftOperations.jsx"): transform_assigned_tasks_page,
    }
    updates: dict[Path, str] = {}
    for relative, transform in targets.items():
        path = root / relative
        if not path.exists():
            raise PatchError(f"missing source file: {relative}")
        original = path.read_text(encoding="utf-8")
        updated = transform(original)
        if updated == original:
            raise PatchError(f"no changes produced for {relative}")
        updates[path] = updated

    test_path = root / "src/pages/employee/EmployeeActiveShiftContext.test.jsx"
    if test_path.exists() and test_path.read_text(encoding="utf-8") != TEST_CONTENT:
        raise PatchError(f"unexpected existing test file: {test_path.relative_to(root)}")

    if not write:
        print(
            f"All reviewed anchors match base {BASE_SHA}. "
            f"{len(updates)} files would be updated and one regression test would be created."
        )
        return

    for path, content in updates.items():
        path.write_text(content, encoding="utf-8")
    test_path.write_text(TEST_CONTENT, encoding="utf-8")
    print(f"Updated {len(updates)} files and created {test_path.relative_to(root)}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    if args.check == args.write:
        parser.error("choose exactly one of --check or --write")
    patch(Path(args.root).resolve(), write=args.write)


if __name__ == "__main__":
    try:
        main()
    except PatchError as error:
        raise SystemExit(f"ERROR: {error}") from error
