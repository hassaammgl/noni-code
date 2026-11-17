// Turn assistant output into speakable prose.
// Strips markdown, code, tool/JSON payloads, and internal labels.

const TOOLISH_JSON =
  /"(?:tool_calls?|tool_call|function_call|name|arguments|tool)"\s*:/

const INTERNAL_LINE =
  /^\s*(?:system|internal|tool[_ ]?(?:call|result)|function[_ ]?call)\s*:\s*.*$/gim

export function preprocessSpeechText(text, { maxChars = 2000 } = {}) {
  if (text == null) return ''

  let s = String(text).replace(/\r\n/g, '\n')
  const trimmed = s.trim()
  if (!trimmed) return ''

  if (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    TOOLISH_JSON.test(trimmed)
  ) {
    return ''
  }

  s = s.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/`[^`]*`/g, ' ')
  s = s.replace(INTERNAL_LINE, ' ')
  s = s.replace(/<(think|reasoning|tool_call|tool_result|internal)[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
  s = s.replace(/(?:see\s+)?\bhttps?:\/\/\S+/gi, ' ')
  s = s.replace(/\bwww\.\S+/gi, ' ')
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')
  s = s.replace(/&amp;/g, ' and ')
  s = s.replace(/&/g, ' and ')
  s = s.replace(/^#{1,6}\s+/gm, '')
  s = s.replace(/^\s*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2')
  s = s.replace(/(\*|_)(.*?)\1/g, '$2')
  s = s.replace(/~~(.*?)~~/g, '$1')
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  s = s.replace(/[ \t]{2,}/g, ' ').trim()

  if (!s) return ''
  if (s.length > maxChars) s = s.slice(0, maxChars).trim()
  return s
}
