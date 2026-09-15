export const formatKg = (value) => value === null || value === undefined ? '—' : `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} kg`
export const weightTotalText = (weight) => !weight ? '—' : !weight.isComplete ? 'Chưa đủ dữ liệu' : `${weight.estimatedKg > 0 ? '≈ ' : ''}${formatKg(weight.totalKg)}`
export const weightRuleText = (rule) => rule.kgPerPiece !== null && rule.kgPerPiece !== undefined
  ? `1 cái = ${formatKg(rule.kgPerPiece)}`
  : `${Number(rule.piecesPerKg).toLocaleString('vi-VN')} cái = 1 kg`
