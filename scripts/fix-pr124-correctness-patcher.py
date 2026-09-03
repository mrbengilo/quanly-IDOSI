from pathlib import Path

path = Path('scripts/apply-pr124-correctness.py')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        '''page = replace_once(
    page,
    """    app.orders,
    app.revenueBonusOverrides,
""",
    """    app.orders,
    app.revenueBonusOverrides,
    app.supportTransfers,
""",
    'local snapshot support dependency',
)
''',
        '''page = replace_once(
    page,
    """    app.orders,
    app.revenueBonusOverrides,
    automaticMode,
    businessDate,
""",
    """    app.orders,
    app.revenueBonusOverrides,
    app.supportTransfers,
    automaticMode,
    businessDate,
""",
    'local snapshot support dependency',
)
''',
        'local snapshot dependency matcher',
    ),
    (
        '''for test_path in [
    'src/pages/compensation/CompensationPages.test.jsx',
    'src/pages/compensation/RevenueBonusCutoff.test.jsx',
    'src/pages/compensation/RevenueBonusStoreManager.test.jsx',
]:
''',
        '''for test_path in [
    'src/pages/compensation/CompensationPages.test.jsx',
    'src/pages/compensation/RevenueBonusCutoff.test.jsx',
]:
''',
        'store-manager special mock handling',
    ),
    (
        "expect(await screen.findByText('123.456 ₫')).toBeTruthy()",
        "expect((await screen.findAllByText('123,456 đ')).length).toBeGreaterThan(0)",
        'automatic history currency expectation',
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    text = text.replace(old, new, 1)
    print(f'Repaired {label}.')

path.write_text(text, encoding='utf-8')
