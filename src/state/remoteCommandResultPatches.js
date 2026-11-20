export const remoteCommandResultPatches = (type, result) => {
  const patches = new Map()
  const replacements = new Map()
  const add = (collection, value) => {
    const updates = (Array.isArray(value) ? value : [value]).filter(Boolean)
    if (updates.length) patches.set(collection, [...(patches.get(collection) || []), ...updates])
  }
  if (type.startsWith('store.')) add(type === 'store.delete' ? 'deletedStores' : 'stores', result.store)
  if (type.startsWith('employee.')) add(type === 'employee.delete' ? 'deletedEmployees' : 'employees', result.employee)
  if (type.startsWith('order.')) add('orders', result.order)
  if (type.startsWith('fixed_expense.')) {
    add('fixedExpenses', result.expense)
    add('expenseEntries', result.expenseEntry)
  } else if (type.startsWith('expense.')) add('expenseEntries', result.expense || result.expenseEntry)
  if (type.startsWith('import.') || type.startsWith('import_voucher.')) {
    add('importVouchers', result.voucher)
    add('expenseEntries', result.expenseEntry)
  }
  if (type.startsWith('compensation_entry.')) add('compensationEntries', result.entry)
  if (type.startsWith('salary_adjustment.')) add('salaryAdjustments', result.adjustment)
  if (type.startsWith('salary_advance.')) add('salaryAdvances', result.advance)
  if (type.startsWith('store_salary_config.')) add('storeEmployeeSalaryConfigs', result.salaryConfig)
  if (type.startsWith('work_catalog.')) add('workCatalogItems', result.item)
  if (type === 'work_reward.set' || type === 'work_reward.set_batch') {
    add('workCatalogProgress', result.reward || result.rewards)
    add('compensationEntries', result.entry || result.entries)
    add('teamRewardClaims', result.teamClaim || result.teamClaims)
  }
  if (type.startsWith('violation.')) {
    add('violations', result.violation || result.violations)
    add('violationPointSummaries', (result.pointAssessments || []).map((assessment) => ({ ...assessment, id: `${assessment.employeeId}:${assessment.period}` })))
    add('compensationEntries', result.entry || result.entries)
  }
  if (type.startsWith('revenue_bonus.')) {
    add('revenueBonusDaily', result.daily || result.bonus || result.bonuses)
    add('revenueBonusAllocations', result.allocation || result.allocations)
    add('revenueBonusOverrides', result.override || result.overrides)
    add('salaryAdjustments', result.adjustment || result.adjustments)
    add('teamRewardClaims', result.teamClaim || result.teamClaims)
    add('teamRewardParticipants', result.teamParticipant || result.teamParticipants)
  }
  if (type.startsWith('payroll.')) {
    add('payrollPeriods', result.period)
    add('payrollPayments', result.payment || result.payments)
    add('expenseEntries', result.expenseEntry || result.expenseEntries)
  }
  if (type.startsWith('attendance.')) {
    add('attendance', result.attendance)
    add('tasks', result.tasks)
  }
  if (type.startsWith('shift_definition.')) add('shiftDefinitions', result.shift)
  if (type.startsWith('support_transfer.')) {
    add('supportTransfers', result.transfer)
    add('schedule', result.schedule)
  }
  if (Array.isArray(result.notifications)) add('notifications', result.notifications)
  if (type === 'order_information.reorder' && Array.isArray(result.options)) {
    replacements.set('orderInformationOptions', result.options)
  } else if (type.startsWith('order_information.')) {
    add('orderInformationOptions', result.option || result.options)
  }
  if (type.startsWith('schedule.')) add('schedule', result.assignment || result.assignments)
  if (type.startsWith('support_work.')) add('supportWorkAssignments', result.assignment || result.assignments)
  if (type === 'support_schedule.presets.update') {
    if (Array.isArray(result.presets)) replacements.set('supportSchedulePresets', result.presets)
    add('supportSchedulePresetHistory', result.history)
  } else if (type.startsWith('support_schedule.')) add('supportWorkSchedules', result.schedule || result.schedules)
  if (type === 'task.done' || type === 'task.set_done') add('tasks', result.task)
  if (type === 'task.progress.save' || type === 'task.shift.select') {
    add('tasks', result.tasks)
    add('attendance', result.attendance)
  }
  return { patches, replacements }
}
