const normalizeIdentifier = (value) => String(value || '').trim().toLocaleLowerCase('vi-VN')

const profileIdentifiers = (profile = {}) => [
  profile.id,
  profile.code,
  profile.employeeId,
  profile.employeeCode,
].map(normalizeIdentifier).filter(Boolean)

const hasIdentifier = (profile, identifier) => {
  const normalized = normalizeIdentifier(identifier)
  return Boolean(normalized) && profileIdentifiers(profile).includes(normalized)
}

/**
 * Returns true only when persisted profile metadata proves that two personnel
 * profiles use one login account. Request payload auth fields are deliberately
 * excluded because callers must not be able to bypass username uniqueness.
 */
export const employeeProfilesShareAccount = (left = {}, right = {}) => {
  if (!left || !right) return false

  const leftAuthUserId = String(left.authUserId || '').trim()
  const rightAuthUserId = String(right.authUserId || '').trim()
  if (leftAuthUserId && rightAuthUserId) return leftAuthUserId === rightAuthUserId

  const leftLinkedEmployeeId = normalizeIdentifier(left.linkedEmployeeId)
  const rightLinkedEmployeeId = normalizeIdentifier(right.linkedEmployeeId)
  return Boolean(
    (leftLinkedEmployeeId && hasIdentifier(right, leftLinkedEmployeeId))
    || (rightLinkedEmployeeId && hasIdentifier(left, rightLinkedEmployeeId))
    || (leftLinkedEmployeeId && leftLinkedEmployeeId === rightLinkedEmployeeId),
  )
}

export const employeeProfileKey = (profile = {}) => String(
  profile.id || profile.code || profile.employeeId || profile.employeeCode || '',
)
