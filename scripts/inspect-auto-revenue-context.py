from pathlib import Path

FILES = [
    'server/worker.js',
    'src/state/AppContext.jsx',
    'src/pages/compensation/RevenueBonusPage.jsx',
]
PATTERNS = [
    'revenueBonusDaily',
    'revenueBonusAllocations',
    'liveRevenueBonusSnapshot',
    'revenueBonusCommand',
    'compensationTotalsForEmployee',
    'PAYROLL_COMMAND_COLLECTIONS',
    'handleRevenueBonusLive',
    "'/api/revenue-bonus/live'",
    'calculateRevenueBonusDay',
    'approveRevenueBonusMilestone',
]

for file_name in FILES:
    lines = Path(file_name).read_text(encoding='utf-8').splitlines()
    print(f'===== {file_name} ({len(lines)} lines) =====')
    seen = set()
    for pattern in PATTERNS:
        for index, line in enumerate(lines):
            if pattern not in line:
                continue
            start = max(0, index - 8)
            end = min(len(lines), index + 12)
            key = (start, end)
            if key in seen:
                continue
            seen.add(key)
            print(f'--- {pattern!r} at line {index + 1} ---')
            for row in range(start, end):
                print(f'{row + 1:06d}: {lines[row]}')
