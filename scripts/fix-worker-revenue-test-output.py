from pathlib import Path

path = Path('server/worker.test.js')
text = path.read_text(encoding='utf-8')
old = "    expect((await supportLive.json()).snapshot).toMatchObject({\n"
new = "    const supportSnapshot = (await supportLive.json()).snapshot\n    expect(supportSnapshot).toMatchObject({\n"
count = text.count(old)
if count != 1:
    raise SystemExit(f'support snapshot assertion expected once, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Worker support snapshot bound for follow-up assertions.')
