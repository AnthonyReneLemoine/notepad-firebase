export const HISTORY_LIMIT = 20;

export function contentOf(note = {}) {
  return {
    title: String(note.title ?? ''), body: String(note.body ?? ''),
    tags: String(note.tags ?? ''), color: note.color || 'default'
  };
}

export function sameContent(a, b) {
  return JSON.stringify(contentOf(a)) === JSON.stringify(contentOf(b));
}

export function historyOf(note = {}) {
  const entries = Array.isArray(note.history) ? note.history : Object.values(note.history || {});
  return entries.filter(entry => entry && typeof entry === 'object').slice(-HISTORY_LIMIT);
}

// History contains only content snapshots, never another history array.
export function savedNote(previous, draft, now) {
  const history = historyOf(previous || {});
  if (previous && !sameContent(previous, draft)) {
    history.push({
      ...contentOf(previous),
      version: Number(previous.revision) || 0,
      savedAt: previous.modifiedAt || previous.updatedAt || null,
      replacedAt: now
    });
  }
  return {
    ...(previous || {}), ...draft, ...contentOf(draft),
    revision: (Number(previous?.revision) || 0) + 1,
    history: history.slice(-HISTORY_LIMIT),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    archived: Boolean(previous?.archived),
    pinned: Boolean(previous?.pinned),
    order: Number.isFinite(previous?.order) ? previous.order : null,
    deletedAt: previous?.deletedAt || null
  };
}

export function revisionMatches(current, baseline) {
  if (!baseline) return current === null;
  return current !== null && (Number(current.revision) || 0) === (Number(baseline.revision) || 0)
    && sameContent(current, baseline) && (current.deletedAt || null) === (baseline.deletedAt || null);
}

export function matchesTab(note, tab) {
  if (tab === 'trash') return Boolean(note.deletedAt);
  return !note.deletedAt && Boolean(note.archived) === (tab === 'archived');
}

export function exportNotebook(notes, now = new Date()) {
  return JSON.stringify({format:'notepad-backup', version:1, exportedAt:now.toISOString(), notes}, null, 2);
}
