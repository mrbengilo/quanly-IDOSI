import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

// Online SQLite snapshot for the running VPS app. VACUUM INTO reads the
// database inside one read transaction, so in WAL mode it produces a
// transactionally consistent, self-contained copy while the app keeps
// serving writes. The copy is verified before it is reported as usable.
export const createOnlineBackup = ({ databasePath, outputPath, busyTimeoutMs = 15_000 } = {}) => {
  if (!databasePath) throw new Error('Thiếu đường dẫn SQLite nguồn.')
  if (!outputPath) throw new Error('Thiếu đường dẫn file backup.')
  // Opening a missing path would silently create an empty database and
  // "back up" nothing.
  if (!existsSync(databasePath)) throw new Error(`Không tìm thấy SQLite nguồn: ${databasePath}`)
  const target = resolve(outputPath)
  mkdirSync(dirname(target), { recursive: true })
  rmSync(target, { force: true })
  const source = new DatabaseSync(databasePath)
  try {
    source.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.trunc(Number(busyTimeoutMs) || 0))}`)
    source.prepare('VACUUM INTO ?').run(target)
  } finally {
    source.close()
  }
  const copy = new DatabaseSync(target, { readOnly: true })
  let verified = null
  try {
    const integrity = Object.values(copy.prepare('PRAGMA integrity_check').get() || {})[0]
    if (integrity !== 'ok') throw new Error(`Backup không qua integrity_check: ${integrity}`)
    const foreignKeyViolations = copy.prepare('PRAGMA foreign_key_check').all().length
    if (foreignKeyViolations) throw new Error(`Backup có ${foreignKeyViolations} lỗi khóa ngoại.`)
    const state = copy.prepare("SELECT version FROM app_state WHERE scope_key = 'global'").get()
    if (!state) throw new Error('Backup không có trạng thái global; từ chối file rỗng.')
    const entities = copy.prepare('SELECT COUNT(*) AS count FROM state_entities').get()
    verified = {
      integrity,
      stateVersion: Number(state.version || 0),
      entityCount: Number(entities?.count || 0),
    }
  } finally {
    copy.close()
    // Close before deleting so a rejected copy is also removed on Windows.
    if (!verified) rmSync(target, { force: true })
  }
  return { outputPath: target, bytes: statSync(target).size, ...verified }
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMainModule) {
  try {
    const result = createOnlineBackup({
      databasePath: process.env.IDOSI_DB_PATH || resolve(process.cwd(), 'data', 'idosi.sqlite'),
      outputPath: process.argv[2],
    })
    console.log(JSON.stringify({ event: 'idosi.online_backup', status: 'ok', ...result }))
  } catch (error) {
    console.error(JSON.stringify({ event: 'idosi.online_backup', status: 'failed', error: String(error?.message || error) }))
    process.exitCode = 1
  }
}
