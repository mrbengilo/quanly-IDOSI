let audioContext = null

const getAudioContext = () => {
  if (audioContext) return audioContext
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext
  if (!AudioContextClass) return null
  audioContext = new AudioContextClass()
  return audioContext
}

export async function unlockNotificationSound() {
  const context = getAudioContext()
  if (context?.state === 'suspended') await context.resume()
  return Boolean(context && context.state !== 'closed')
}

export async function playTaskNotificationSound() {
  try {
    const context = getAudioContext()
    if (!context) return false
    if (context.state === 'suspended') await context.resume()
    if (context.state !== 'running') return false
    const now = context.currentTime
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48)
    gain.connect(context.destination)
    ;[0, 0.2].forEach((offset, index) => {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(index ? 880 : 659.25, now + offset)
      oscillator.connect(gain)
      oscillator.start(now + offset)
      oscillator.stop(now + offset + 0.18)
    })
    return true
  } catch {
    return false
  }
}

export function resetNotificationSoundForTests() {
  audioContext = null
}
