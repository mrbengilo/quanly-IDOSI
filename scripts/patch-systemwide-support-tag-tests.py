from pathlib import Path


def replace_exact(path, old, new, expected_count, label):
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected_count:
        raise SystemExit(f'{label}: expected {expected_count} matches, found {count}')
    target.write_text(text.replace(old, new), encoding='utf-8')
    print(f'test-patch: {label}')


def insert_once(path, marker, addition, label):
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    count = text.count(marker)
    if count != 1:
        raise SystemExit(f'{label}: expected one marker, found {count}')
    target.write_text(text.replace(marker, marker + addition, 1), encoding='utf-8')
    print(f'test-patch: {label}')


replace_exact(
    'src/pages/store/StoreV2Pages.metrics.test.jsx',
    "'Nhân viên hỗ trợ • Dosii TNV'",
    "'Nhân viên hỗ trợ • Từ Dosii TNV'",
    2,
    'standardize payroll tag expectations',
)

insert_once(
    'src/pages/compensation/ViolationRefundPage.test.jsx',
    "    expect(screen.getAllByText('Nhân viên hỗ trợ').length).toBeGreaterThan(0)\n",
    "    expect(screen.getByText('Nhân viên hỗ trợ • Từ SM TNV')).toBeTruthy()\n",
    'verify standardized violation-refund tag',
)

insert_once(
    'src/pages/compensation/RevenueBonusStoreManager.test.jsx',
    "    expect(within(rowC).getByText('Hỗ trợ cửa hàng – không nhận thưởng')).toBeTruthy()\n",
    "    expect(within(rowC).getByText('Nhân viên hỗ trợ • Từ Dosii cửa hàng chính')).toBeTruthy()\n",
    'verify standardized revenue-bonus tag',
)

print('System-wide support tag test expectations patched successfully.')
