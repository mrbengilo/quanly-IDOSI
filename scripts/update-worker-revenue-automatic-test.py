from pathlib import Path

path = Path('server/worker.test.js')
text = path.read_text(encoding='utf-8')
start_marker = "  it('keeps hot milestones pending until an authorized cross-store approval and protects coworker allocations', async () => {\n"
end_marker = "  it('charges a support-transfer work reward only to the destination payroll and keeps retries immutable', async () => {\n"
start = text.find(start_marker)
end = text.find(end_marker, start + 1)
if start < 0 or end < 0:
    raise SystemExit('manual revenue integration test markers were not found')
block = text[start:end]
block = block.replace(
    start_marker,
    "  it('automatically applies the highest revenue milestone, protects coworker allocations, and restricts overrides to Admin', async () => {\n    vi.useFakeTimers()\n    try {\n      vi.setSystemTime(new Date('2026-09-03T11:00:00.000Z'))\n",
    1,
)
block = block.replace('2026-08-20', '2026-09-03')
block = block.replace(
    "      storeId: 'S02', businessDate: '2026-09-03', revenueVnd: 16_000_001,\n      percentagePoolVnd: 640_000, totalWorkedSeconds: 28_800, attendanceCount: 2,\n      calculationEligibility: { allowed: true, code: 'READY', finalShiftId: 'shift-day' },\n",
    "      storeId: 'S02', businessDate: '2026-09-03', revenueVnd: 16_000_001,\n      calculationMode: 'AUTOMATIC', editableByAdminOnly: true,\n      percentagePoolVnd: 640_000, milestonePoolVnd: 250_000, totalPoolVnd: 890_000,\n      allocatedVnd: 890_000, totalWorkedSeconds: 28_800, attendanceCount: 2,\n",
    1,
)
block = block.replace('amountVnd: 320_000', 'amountVnd: 445_000')
tail_marker = "    const versionBeforeManagerScopeCheck"
tail_start = block.find(tail_marker)
close_marker = "  }, 60_000)\n\n"
close_start = block.rfind(close_marker)
if tail_start < 0 or close_start < 0:
    raise SystemExit('manual revenue integration tail markers were not found')
new_tail = r'''    expect(supportSnapshot).not.toHaveProperty('calculationEligibility')
    expect(supportSnapshot).not.toHaveProperty('pendingMilestonePoolVnd')

    const currentVersion = () => Number(env.DB.database.prepare(
      'SELECT version FROM app_state WHERE scope_key = ?',
    ).get('global')?.version || 0)
    for (const [role, authorization] of [
      ['business_support', supportAuthorization],
      ['store_manager', managerAuthorization],
      ['employee', employeeAuthorization],
    ]) {
      const denied = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
        type: 'revenue_bonus.override_employee', expectedVersion: currentVersion(),
        payload: {
          storeId: 'S02', businessDate: '2026-09-03', employeeId: 'E-S02',
          amountVnd: 500_000, reason: `Không đủ quyền ${role}`,
        },
      }, { ...authorization, 'idempotency-key': `revenue-auto-denied-${role}` }), env)
      expect(denied.status, role).toBe(403)
      expect(await denied.json()).toMatchObject({ error: { code: 'ROLE_FORBIDDEN' } })
    }

    const retired = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'revenue_bonus.calculate_day', expectedVersion: currentVersion(),
      payload: { storeId: 'S02', businessDate: '2026-09-03' },
    }, { ...adminAuthorization, 'idempotency-key': 'revenue-auto-manual-retired' }), env)
    expect(retired.status).toBe(410)
    expect(await retired.json()).toMatchObject({
      error: { code: 'REVENUE_BONUS_CALCULATION_AUTOMATED' },
    })

    const overridden = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'revenue_bonus.override_employee', expectedVersion: currentVersion(),
      payload: {
        storeId: 'S02', businessDate: '2026-09-03', employeeId: 'E-S02',
        amountVnd: 500_000, reason: 'Admin điều chỉnh sau đối soát doanh thu',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'revenue-auto-admin-override' }), env)
    expect([200, 201]).toContain(overridden.status)
    expect(await overridden.json()).toMatchObject({
      override: {
        employeeId: 'E-S02', mode: 'AMOUNT', amountVnd: 500_000,
        automaticAmountVndSnapshot: 445_000, status: 'ACTIVE', version: 1,
      },
    })
    const adjustedLive = await worker.fetch(new Request(liveUrl, { headers: supportAuthorization }), env)
    const adjustedSnapshot = (await adjustedLive.json()).snapshot
    expect(adjustedSnapshot).toMatchObject({
      automaticAllocatedVnd: 890_000, allocatedVnd: 945_000, adminAdjustmentVnd: 55_000,
      allocations: [
        expect.objectContaining({
          employeeId: 'E-S02', automaticAmountVnd: 445_000, amountVnd: 500_000,
          status: 'ADMIN_ADJUSTED',
        }),
        expect.objectContaining({ employeeId: 'QL-S02', amountVnd: 445_000, status: 'LIVE' }),
      ],
    })

    const deleted = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'revenue_bonus.delete_employee', expectedVersion: currentVersion(),
      payload: {
        storeId: 'S02', businessDate: '2026-09-03', employeeId: 'E-S02', expectedVersion: 1,
        reason: 'Admin xóa sau khi xác minh không đủ điều kiện',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'revenue-auto-admin-delete' }), env)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toMatchObject({
      override: { mode: 'DELETED', amountVnd: 0, status: 'ACTIVE', version: 2 },
    })
    const deletedLive = await worker.fetch(new Request(liveUrl, { headers: employeeAuthorization }), env)
    expect((await deletedLive.json()).snapshot.allocations).toEqual([
      expect.objectContaining({
        employeeId: 'E-S02', automaticAmountVnd: 445_000, amountVnd: 0,
        status: 'ADMIN_DELETED',
      }),
    ])

    const restored = await worker.fetch(jsonRequest('https://idosi.example/api/command', {
      type: 'revenue_bonus.restore_employee', expectedVersion: currentVersion(),
      payload: {
        storeId: 'S02', businessDate: '2026-09-03', employeeId: 'E-S02', expectedVersion: 2,
        reason: 'Admin khôi phục công thức tự động sau xác minh',
      },
    }, { ...adminAuthorization, 'idempotency-key': 'revenue-auto-admin-restore' }), env)
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({
      override: { status: 'VOID', version: 3 },
    })
    const restoredLive = await worker.fetch(new Request(liveUrl, { headers: supportAuthorization }), env)
    expect((await restoredLive.json()).snapshot).toMatchObject({
      allocatedVnd: 890_000, adminAdjustmentVnd: 0, overrideCount: 0,
      allocations: [
        expect.objectContaining({ employeeId: 'E-S02', amountVnd: 445_000, status: 'LIVE' }),
        expect.objectContaining({ employeeId: 'QL-S02', amountVnd: 445_000, status: 'LIVE' }),
      ],
    })

    const finalState = readHydratedState(env.DB.database)
    expect(finalState.revenueBonusDaily).toEqual([])
    expect(finalState.revenueBonusAllocations).toEqual([])
    expect(finalState.teamRewardClaims).toEqual([])
    expect(finalState.revenueBonusOverrides).toEqual([
      expect.objectContaining({ employeeId: 'E-S02', status: 'VOID', version: 3 }),
    ])
    } finally {
      vi.useRealTimers()
    }
  }, 60_000)

'''
block = block[:tail_start] + new_tail
path.write_text(text[:start] + block + text[end:], encoding='utf-8')
print('Worker revenue integration test updated for automatic calculation.')
