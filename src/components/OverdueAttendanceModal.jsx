import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { overdueAttendanceDate } from '../domain/overdueAttendance'
import { shortDate } from '../utils'
import { Button, Modal } from './UI'

const attendanceKey = (records = []) => records
  .map((record) => `${record.id || record.attendanceId || 'attendance'}:${overdueAttendanceDate(record)}`)
  .sort()
  .join('|')

export function OverdueAttendanceModal({ records = [], audience = 'employee', actionLabel = 'Kết ca' }) {
  const source = Array.isArray(records) ? records : []
  const currentKey = attendanceKey(source)
  const [dismissedKey, setDismissedKey] = useState('')
  const open = Boolean(source.length && currentKey && dismissedKey !== currentKey)
  const dismiss = () => setDismissedKey(currentKey)
  const storeAudience = audience === 'store'

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title={storeAudience ? 'CẢNH BÁO NHÂN VIÊN CHƯA KẾT CA' : 'CẢNH BÁO CHẤM CÔNG QUÁ HẠN'}
      footer={<Button variant="danger" onClick={dismiss}>ĐÃ HIỂU</Button>}
    >
      <div className="overdue-attendance-alert" role="alert">
        <AlertTriangle aria-hidden="true" />
        {storeAudience ? <div>
          <h3>{source.length} nhân viên còn ca làm việc chưa kết thúc</h3>
          <p>Quản lý cần kiểm tra và kết thúc các ca quá hạn trước khi tiếp tục đối soát.</p>
          <ul>
            {source.map((record) => <li key={record.id || `${record.employeeId}-${overdueAttendanceDate(record)}`}>
              <strong>{record.employeeName || record.employeeId || 'Nhân viên'}</strong>
              <span>chưa kết ca ngày {shortDate(overdueAttendanceDate(record)) || 'trước đó'}{record.shiftName ? ` · ${record.shiftName}` : ''}</span>
            </li>)}
          </ul>
        </div> : <div>
          <h3>Bạn chưa bấm “{actionLabel}” ngày hôm qua</h3>
          <p>Ca ngày {shortDate(overdueAttendanceDate(source[0])) || 'trước đó'} vẫn đang mở. Hãy bấm “{actionLabel}” cho ca này trước khi điểm danh ca mới.</p>
        </div>}
      </div>
    </Modal>
  )
}

export default OverdueAttendanceModal
