import { afterEach, describe, expect, it, vi } from 'vitest'
import { playTaskNotificationSound, resetNotificationSoundForTests, unlockNotificationSound } from './notificationSound'

describe('task notification sound', () => {
  afterEach(() => {
    delete globalThis.AudioContext
    resetNotificationSoundForTests()
  })

  it('unlocks audio after a user gesture and plays a short two-tone alert', async () => {
    const oscillator = () => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: vi.fn() }, type: '' })
    const oscillators = [oscillator(), oscillator()]
    const context = {
      state: 'suspended', currentTime: 2, destination: {},
      resume: vi.fn(async () => { context.state = 'running' }),
      createGain: vi.fn(() => ({ connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } })),
      createOscillator: vi.fn(() => oscillators.shift()),
    }
    globalThis.AudioContext = class MockAudioContext {
      constructor() { return context }
    }
    expect(await unlockNotificationSound()).toBe(true)
    expect(await playTaskNotificationSound()).toBe(true)
    expect(context.createOscillator).toHaveBeenCalledTimes(2)
  })
})
