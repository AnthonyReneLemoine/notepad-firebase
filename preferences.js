// Preferences are optional: private browsing or full storage must not block notes.
export function readPreference(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(`notepad:${key}`)) ?? fallback; }
  catch { return fallback; }
}

export function writePreference(key, value) {
  try { localStorage.setItem(`notepad:${key}`, JSON.stringify(value)); }
  catch { /* The current session can still use the selected preference. */ }
}
