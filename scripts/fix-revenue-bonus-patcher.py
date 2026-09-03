from pathlib import Path

path = Path('scripts/apply-revenue-bonus-21h-v2.py')
text = path.read_text(encoding='utf-8')
old = """    print(f'apply: {label}')
    return text[:start] + replacement + text[end:]
"""
new = """    print(f'apply: {label}')
    tail_start = end + len(end_marker) if replacement.endswith(end_marker) else end
    return text[:start] + replacement + text[tail_start:]
"""
if text.count(old) != 1:
    raise SystemExit('replace_section helper did not match exactly once')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Patched replace_section to avoid duplicated end markers.')
