import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'

// One read-only connection at a time keeps large history SELECTs off the HTTP
// event loop without allowing concurrent readers to exhaust the VPS memory.
export class SnapshotReader {
  constructor(databasePath) {
    this.databasePath = databasePath
    this.queue = []
    this.active = null
    this.closed = false
  }

  query(sql, bindings) {
    if (this.closed) return Promise.reject(new Error('Snapshot reader is closed.'))
    if (this.queue.length >= 8) return Promise.reject(new Error('Snapshot read queue is full.'))
    return new Promise((resolve, reject) => {
      this.queue.push({ sql, bindings, resolve, reject })
      this.startNext()
    })
  }

  startNext() {
    if (this.active || this.closed || !this.queue.length) return
    const job = this.queue.shift()
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { idosiSnapshotReader: true, databasePath: this.databasePath, sql: job.sql, bindings: job.bindings },
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
        job.reject(failure || new Error(result?.error || `Snapshot worker exited with code ${code}.`))
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
    const rows = database.prepare(workerData.sql).all(...workerData.bindings)
    parentPort.postMessage({ ok: true, rows })
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message })
  } finally {
    database?.close()
    parentPort.close()
  }
}
