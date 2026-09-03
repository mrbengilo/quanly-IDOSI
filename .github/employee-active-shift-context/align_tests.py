from __future__ import annotations

from pathlib import Path


def patch_section(
    text: str,
    start_marker: str,
    end_marker: str,
    replacements: list[tuple[str, str, str]],
    label: str,
) -> str:
    start = text.find(start_marker)
    end = text.find(end_marker, start + len(start_marker))
    if start < 0 or end < 0:
        raise SystemExit(f'{label}: section bounds missing')
    section = text[start:end]
    for old, new, replacement_label in replacements:
        count = section.count(old)
        if count != 1:
            raise SystemExit(
                f'{label}/{replacement_label}: expected exactly one anchor, found {count}'
            )
        section = section.replace(old, new, 1)
    return text[:start] + section + text[end:]


def align_employee_orders_tests() -> None:
    path = Path('src/pages/employee/EmployeeV2Pages.test.js')
    text = path.read_text(encoding='utf-8')
    text = patch_section(
        text,
        "  it('uses the exact signed-in employee id and does not mix a case-colliding order owner', () => {",
        "\n  it('uses the active support store for order history, attendance and new orders', async () => {",
        [
            (
                "        id: 'ORDER-UPPER', code: 'ORDER-UPPER', storeId: 'S01', employeeId: 'E01', createdByEmployeeId: 'E01',\n        customerName: 'Khách đúng nhân viên',",
                "        id: 'ORDER-UPPER', code: 'ORDER-UPPER', storeId: 'S01', employeeId: 'E01', createdByEmployeeId: 'E01',\n        attendanceId: 'ATT-UPPER', shiftId: 'CA-UPPER', customerName: 'Khách đúng nhân viên',",
                'link exact employee order to open attendance',
            ),
            (
                "      attendance: [],",
                """      attendance: [{
        id: 'ATT-UPPER', employeeId: 'E01', storeId: 'S01', shiftId: 'CA-UPPER',
        shiftName: 'Ca hiện tại', checkInAt: '2026-08-20T08:00:00+07:00',
      }],""",
                'add exact employee open attendance',
            ),
        ],
        'exact employee current-shift test',
    )
    text = patch_section(
        text,
        "  it('uses the active support store for order history, attendance and new orders', async () => {",
        "\n  it('reconciles checkout only with orders created by the signed-in employee', () => {",
        [
            (
                "          id: 'ORDER-HOME', code: 'S01-HOME', storeId: 'S01', employeeId: 'E01', createdByEmployeeId: 'E01',\n          customerName: 'Khách cửa hàng chính',",
                "          id: 'ORDER-HOME', code: 'S01-HOME', storeId: 'S01', employeeId: 'E01', createdByEmployeeId: 'E01',\n          attendanceId: 'ATT-HOME', shiftId: 'CA-HOME', customerName: 'Khách cửa hàng chính',",
                'link home order to closed home attendance',
            ),
            (
                "          id: 'ORDER-SUPPORT', code: 'S02-OWN', storeId: 'S02', employeeId: 'E01', createdByEmployeeId: 'E01',\n          customerName: 'Khách cửa hàng hỗ trợ',",
                "          id: 'ORDER-SUPPORT', code: 'S02-OWN', storeId: 'S02', employeeId: 'E01', createdByEmployeeId: 'E01',\n          attendanceId: 'ATT-SUPPORT', shiftId: 'CA-SUPPORT', customerName: 'Khách cửa hàng hỗ trợ',",
                'link support order to open destination attendance',
            ),
            (
                "        { id: 'ATT-HOME', employeeId: 'E01', storeId: 'S01', shiftId: 'CA-HOME', shiftName: 'Ca cửa hàng chính', checkInAt: '2026-08-20T08:00:00+07:00' },",
                "        { id: 'ATT-HOME', employeeId: 'E01', storeId: 'S01', shiftId: 'CA-HOME', shiftName: 'Ca cửa hàng chính', checkInAt: '2026-08-20T08:00:00+07:00', checkOutAt: '2026-08-20T12:00:00+07:00' },",
                'close prior home attendance',
            ),
            (
                "    expect(screen.getByText(/Mọi đơn hàng và doanh thu được ghi nhận cho Dosii KVC/u)).toBeTruthy()",
                "    expect(screen.getByText(/Chỉ hiển thị đơn hàng thuộc ca đang làm tại Dosii KVC/u)).toBeTruthy()",
                'update current-shift copy expectation',
            ),
        ],
        'active support current-shift test',
    )
    path.write_text(text, encoding='utf-8')


def align_employee_deep_link_test() -> None:
    path = Path('src/pages/store/OrderDeepLink.test.jsx')
    text = path.read_text(encoding='utf-8')
    text = patch_section(
        text,
        "  it('highlights the requested own order in the employee view', () => {",
        "\n  it('blocks employee order creation until an attendance shift is open', () => {",
        [
            (
                "      orders: [targetOrder],\n      attendance: [],",
                """      orders: [{
        ...targetOrder,
        attendanceId: 'ATT-E01-OPEN',
        shiftId: 'CA-E01-OPEN',
      }],
      attendance: [{
        id: 'ATT-E01-OPEN', employeeId: 'E01', storeId: 'S01',
        shiftId: 'CA-E01-OPEN', shiftName: 'Ca hiện tại',
        checkInAt: '2026-08-14T08:00:00+07:00',
      }],""",
                'link deep-linked order to open attendance',
            ),
        ],
        'employee order deep-link test',
    )
    path.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    align_employee_orders_tests()
    align_employee_deep_link_test()
    print('Aligned existing employee-order tests with open-attendance-only behavior.')
