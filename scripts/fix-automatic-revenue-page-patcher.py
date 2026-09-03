from pathlib import Path

path = Path('scripts/apply-automatic-revenue-page.py')
text = path.read_text(encoding='utf-8')
old = """    print(f'apply: {label}')
    return text[:start] + replacement + text[end:]
"""
new = """    print(f'apply: {label}')
    tail_start = end + len(end_marker) if replacement.endswith(end_marker) else end
    return text[:start] + replacement + text[tail_start:]
"""
if text.count(old) != 1:
    raise SystemExit(f'replace_section helper expected once, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Automatic revenue page patcher hardened.')
