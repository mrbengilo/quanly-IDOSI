from pathlib import Path

path = Path('scripts/apply-support-bonus-payroll-tag.py')
text = path.read_text(encoding='utf-8')
old = "      weightPercent: 100 / 3,\n"
count = text.count(old)
if count != 1:
    raise SystemExit(f'weightPercent assertion repair expected one match, found {count}')
path.write_text(text.replace(old, '', 1), encoding='utf-8')
print('Removed exact repeating-decimal comparison; monetary assertions remain exact.')
