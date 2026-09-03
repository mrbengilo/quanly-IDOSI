from pathlib import Path

path = Path('src/domain/automaticRevenueBonus.js')
text = path.read_text(encoding='utf-8')
old = """  for (const override of activeOverrides.records.values()) {
    canonicalIdByKey.set(identifierKey(override.employeeId), override.employeeId)
  }
"""
new = """  for (const override of activeOverrides.records.values()) {
    const key = identifierKey(override.employeeId)
    if (!canonicalIdByKey.has(key)) canonicalIdByKey.set(key, override.employeeId)
  }
"""
if text.count(old) != 1:
    raise SystemExit(f'canonical override marker expected once, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
