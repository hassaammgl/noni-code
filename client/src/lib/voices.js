// Supertonic TTS voices (ONNX, runs locally through Transformers.js).

export const CHARACTER_VOICES = [
  { id: 'F1', label: 'F1' },
  { id: 'F2', label: 'F2' },
  { id: 'F3', label: 'F3' },
  { id: 'F4', label: 'F4' },
  { id: 'F5', label: 'F5' },
  { id: 'M1', label: 'M1' },
  { id: 'M2', label: 'M2' },
  { id: 'M3', label: 'M3' },
  { id: 'M4', label: 'M4' },
  { id: 'M5', label: 'M5' },
]

export const DEFAULT_VOICE = 'F1'

const STORAGE_KEY = 'waifu-voice'

export function loadSavedVoice() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (CHARACTER_VOICES.some((item) => item.id === v)) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_VOICE
}

export function saveVoice(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}
