// Monotonic gate so a stale TTS/chat turn can never become current again.

export function createGenerationGate() {
  let current = 0
  return {
    next() {
      current += 1
      return current
    },
    isCurrent(id) {
      return id === current
    },
    bump() {
      current += 1
      return current
    },
    get current() {
      return current
    },
  }
}
