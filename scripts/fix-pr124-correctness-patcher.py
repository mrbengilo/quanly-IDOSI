from pathlib import Path

path = Path('scripts/apply-pr124-correctness.py')
text = path.read_text(encoding='utf-8')
old = '''page = replace_once(
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
'''
new = '''page = replace_once(
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
'''
if text.count(old) != 1:
    raise SystemExit(f'patcher repair expected one match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Repaired the local snapshot dependency matcher.')
