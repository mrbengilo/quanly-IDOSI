import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'

// Queue descriptors contain SQL/bindings, not result sets. Keep a bounded
// burst of store requests while still executing only one memory-heavy read.
const MAX_QUEUED_READS = 64

// One read-only connection at a time keeps large history SELECTs off the HTTP
// event loop without allowing concurrent readers to exhaust the VPS memory.
export class SnapshotReader {
  constructor(databasePath) {
    this.databasePath = databasePath
    this.queue = []
    this.active = null
    this.closed = false
  }

  query(sql, bindings, projection = null) {
    if (this.closed) return Promise.reject(new Error('Snapshot reader is closed.'))
    if (this.queue.length >= MAX_QUEUED_READS) return Promise.reject(new Error('Snapshot read queue is full.'))
    return new Promise((resolve, reject) => {
      this.queue.push({ sql, bindings, projection, resolve, reject })
      this.startNext()
    })
  }

  startNext() {
    if (this.active || this.closed || !this.queue.length) return
    const job = this.queue.shift()
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { idosiSnapshotReader: true, databasePath: this.databasePath, sql: job.sql, bindings: job.bindings, projection: job.projection },
      resourceLimits: { maxOldGenerationSizeMb: 768 },
    })
    this.active = { worker, job }
    let result
    let failure
    worker.once('message', (message) => { result = message })
    worker.once('error', (error) => { failure = error })
    worker.once('exit', (code) => {
      this.active = null
      if (failure || code !== 0 || !result?.ok) {
        const detail = result?.error
        const error = new Error(detail?.message || (typeof detail === 'string' ? detail : `Snapshot worker exited with code ${code}.`))
        if (detail && typeof detail === 'object') {
          Object.assign(error, { code: detail.code, status: detail.status, details: detail.details })
        }
        job.reject(failure || error)
      } else {
        job.resolve(result.rows)
      }
      setImmediate(() => this.startNext())
    })
  }

  close() {
    this.closed = true
    const error = new Error('Snapshot reader is closed.')
    for (const job of this.queue.splice(0)) job.reject(error)
    if (this.active) void this.active.worker.terminate()
  }
}

if (!isMainThread && workerData?.idosiSnapshotReader === true) {
  let database
  try {
    database = new DatabaseSync(workerData.databasePath, { readOnly: true })
    database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;')
    let rows = database.prepare(workerData.sql).all(...workerData.bindings)
    if (workerData.projection) {
      if (workerData.projection.type !== 'sales-overview') throw new Error('Unsupported snapshot projection.')
      const { aggregateSalesOverviewRows } = await import('../worker.js')
      rows = aggregateSalesOverviewRows(rows, workerData.projection.scope)
    }
    parentPort.postMessage({ ok: true, rows })
  } catch (error) {
    parentPort.postMessage({ ok: false, error: { message: error.message, code: error.code, status: error.status, details: error.details } })
  } finally {
    database?.close()
    parentPort.close()
  }
}
