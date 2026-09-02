import { useState } from 'react'
import { BriefcaseBusiness, LoaderCircle, ShieldCheck, Store, UserRound } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Avatar, Brand, Button } from '../components/UI'
import { useApp } from '../state/AppContext'

const destinations = {
  admin: '/admin/overview',
  business_support: '/support/overview',
  store_manager: '/store/overview',
  employee: '/employee/home',
}

const rolePresentation = {
  admin: { label: 'Admin', description: 'Quản trị toàn bộ hệ thống', icon: ShieldCheck },
  business_support: { label: 'Hỗ trợ KD', description: 'Không gian Nhân viên hỗ trợ kinh doanh', icon: BriefcaseBusiness },
  store_manager: { label: 'Quản lý CH', description: 'Quản lý cửa hàng được phân quyền', icon: Store },
  employee: { label: 'Nhân viên', description: 'Điểm danh, đơn hàng và công việc cá nhân', icon: UserRound },
}

const roleOptionKey = (option = {}) => [
  option.role || '',
  option.storeId || '',
  option.employeeId || '',
].join(':')

export default function RoleSelectionPage() {
  const { session, settings, selectSessionRole } = useApp()
  const navigate = useNavigate()
  const [pendingRoleKey, setPendingRoleKey] = useState('')
  const options = Array.isArray(session?.availableRoles) ? session.availableRoles : []
  if (!session) return <Navigate to="/login" replace />
  if (options.length <= 1 && !session.needsRoleSelection) return <Navigate to={destinations[session.role] || '/login'} replace />

  const choose = async (option, optionKey) => {
    if (pendingRoleKey) return
    setPendingRoleKey(optionKey)
    try {
      const result = await selectSessionRole(option)
      if (result?.ok) {
        navigate(destinations[result.account?.role] || '/login', { replace: true })
        return
      }
    } finally {
      setPendingRoleKey('')
    }
  }

  const currentRoleKey = roleOptionKey(session)

  return <main className="role-selection-page">
    <section className="role-selection-card">
      <div className="role-selection-account">
        <Brand blue />
        <div className="role-selection-account__profile">
          <Avatar name={session.name} src={settings?.avatar} size={52} />
          <span><strong>{session.name || session.username}</strong><small>Chọn không gian làm việc</small></span>
        </div>
      </div>
      <div>
        <p className="eyebrow">IDOSI · TÀI KHOẢN ĐA VAI TRÒ</p>
        <h1>Chọn vai trò đăng nhập</h1>
        <p>Mỗi vai trò mở đúng không gian và quyền hạn tương ứng. Bạn có thể đổi lại vai trò bất cứ lúc nào.</p>
      </div>
      <div
        className="role-selection-grid"
        role="group"
        aria-label="Vai trò có thể chọn"
        style={{ '--role-option-count': Math.max(options.length, 1) }}
      >
        {options.map((option) => {
          const presentation = rolePresentation[option.role] || rolePresentation.employee
          const Icon = presentation.icon
          const optionKey = roleOptionKey(option)
          const isCurrent = optionKey === currentRoleKey
          const isPending = optionKey === pendingRoleKey
          return <Button
            key={optionKey}
            type="button"
            variant="outline"
            className={`role-selection-option${isCurrent ? ' is-selected' : ''}${isPending ? ' is-pending' : ''}`}
            aria-pressed={isCurrent || isPending}
            aria-busy={isPending}
            disabled={Boolean(pendingRoleKey)}
            onClick={() => choose(option, optionKey)}
          >
            <span className="role-selection-option__icon">
              {isPending ? <LoaderCircle className="spin" size={28} /> : <Icon size={28} />}
            </span>
            <span className="role-selection-option__copy">
              <strong>{option.label || presentation.label}</strong>
              <small>{option.profileName || presentation.description}</small>
              {(isPending || isCurrent) && <em>{isPending ? 'Đang mở...' : 'Vai trò hiện tại'}</em>}
            </span>
          </Button>
        })}
      </div>
    </section>
  </main>
}
