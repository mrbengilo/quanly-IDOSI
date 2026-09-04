const DEFAULT_INTERVAL_MS = 30_000

const defaultLogger = process.env.NODE_ENV === 'test'
  ? null
  : (entry) => console.info(JSON.stringify(entry))

export const createAutomaticRevenueBonusRunner = ({
  env,
  finalize,
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
  logger = defaultLogger,
} = {}) => {
  if (typeof finalize !== 'function') throw new TypeError('finalize must be a function.')
  let timer = null
  let inFlight = null
  let stopped = false

  const writeLog = (entry) => {
    if (typeof logger !== 'function') return
    try {
      logger(entry)
    } catch (error) {
      console.error('Unable to log the automatic revenue bonus runner', error)
    }
  }

  const trigger = (reason = 'interval') => {
    if (!enabled || stopped) return Promise.resolve(null)
    if (inFlight) return inFlight
    const startedAt = new Date().toISOString()
    inFlight = Promise.resolve()
      .then(() => finalize(env, { now: startedAt, trigger: reason }))
      .then((summary) => {
        writeLog({ event: 'idosi.revenue_bonus.finalizer', status: 'completed', reason, ...summary })
        return summary
      })
      .catch((error) => {
        writeLog({
          event: 'idosi.revenue_bonus.finalizer',
          status: 'failed',
          reason,
          timestamp: new Date().toISOString(),
          error: String(error?.message || error),
        })
        return null
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  const start = () => {
    if (!enabled || stopped || timer) return
    void trigger('startup')
    const normalizedInterval = Math.max(5_000, Number(intervalMs) || DEFAULT_INTERVAL_MS)
    timer = setInterval(() => void trigger('interval'), normalizedInterval)
    timer.unref?.()
  }

  const stop = () => {
    stopped = true
    if (timer) clearInterval(timer)
    timer = null
    return inFlight || Promise.resolve(null)
  }

  return {
    start,
    stop,
    trigger,
    get running() {
      return Boolean(inFlight)
    },
  }
}
