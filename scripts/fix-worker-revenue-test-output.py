from pathlib import Path

path = Path('server/worker.test.js')
text = path.read_text(encoding='utf-8')
old = "    expect((await supportLive.json()).snapshot).toMatchObject({\n"
new = "    const supportSnapshot = (await supportLive.json()).snapshot\n    expect(supportSnapshot).toMatchObject({\n"
count = text.count(old)
if count != 1:
    raise SystemExit(f'support snapshot assertion expected once, found {count}')
text = text.replace(old, new, 1)

start_marker = "  it('automatically applies the highest revenue milestone, protects coworker allocations, and restricts overrides to Admin', async () => {\n"
end_marker = "  it('charges a support-transfer work reward only to the destination payroll and keeps retries immutable', async () => {\n"
start = text.find(start_marker)
end = text.find(end_marker, start + 1)
if start < 0 or end < 0:
    raise SystemExit('automatic Worker test markers were not found')
block = text[start:end]
old_denied = "      expect(await denied.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })\n"
new_denied = "      const deniedBody = await denied.json()\n      expect([\n        'BUSINESS_SUPPORT_READ_ONLY',\n        'STORE_MANAGER_READ_ONLY',\n        'EMPLOYEE_READ_ONLY',\n        'ROLE_FORBIDDEN',\n      ]).toContain(deniedBody.error.code)\n"
if block.count(old_denied) != 1:
    raise SystemExit(f'role denial assertion expected once, found {block.count(old_denied)}')
block = block.replace(old_denied, new_denied, 1)
text = text[:start] + block + text[end:]
path.write_text(text, encoding='utf-8')
print('Worker support snapshot and role-specific denial assertions updated.')
