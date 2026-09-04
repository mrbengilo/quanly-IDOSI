import { AUTOMATIC_REVENUE_BONUS_CUTOFF_HOUR } from '../../src/domain/automaticRevenueBonus.js'

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1_000
const DAY_MS = 24 * 60 * 60 * 1_000

const defaultLogger = process.env.NODE_ENV === 'test'
  ? null
  : (entry) => console.info(JSON.stringify(entry))

const vietnamCutoffFor = (nowMs) => {
  const vietnamDate = new Date(nowMs + VIETNAM_UTC_OFFSET_MS)
  const vietnamMidnightAsUtc = Date.UTC(
    vietnamDate.getUTCFullYear(),
    vietnamDate.getUTCMonth(),
    vietnamDate.getUTCDate(),
  )
  return vietnamMidnightAsUtc
    - VIETNAM_UTC_OFFSET_MS
    + AUTOMATIC_REVENUE_BONUS_CUTOFF_HOUR * 60 * 60 * 1_000
}

export const createAutomaticRevenueBonusRunner = ({
  env,
  finalize,
  enabled = true,
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

  const trigger = (reason = 'manual') => {
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

  const scheduleNextCutoff = () => {
    if (!enabled || stopped || timer) return
    const nowMs = Date.now()
    const todayCutoffMs = vietnamCutoffFor(nowMs)
    const nextCutoffMs = nowMs < todayCutoffMs ? todayCutoffMs : todayCutoffMs + DAY_MS
    timer = setTimeout(() => {
      timer = null
      void trigger('daily-cutoff').finally(scheduleNextCutoff)
    }, Math.max(0, nextCutoffMs - nowMs))
    timer.unref?.()
  }

  const start = () => {
    if (!enabled || stopped || timer || inFlight) return
    const nowMs = Date.now()
    if (nowMs >= vietnamCutoffFor(nowMs)) {
      void trigger('startup-after-cutoff').finally(scheduleNextCutoff)
      return
    }
    scheduleNextCutoff()
  }

  const stop = () => {
    stopped = true
    if (timer) clearTimeout(timer)
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
