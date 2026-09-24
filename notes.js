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
      savedAt: previous.modifiedAt || null,
      replacedAt: now
    });
  }
  return {
    ...(previous || {}), ...draft, ...contentOf(draft),
    revision: (Number(previous?.revision) || 0) + 1,
    history: history.slice(-HISTORY_LIMIT),
    createdAt: previous ? previous.createdAt || null : now,
    modifiedAt: now,
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

export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').trim();
}

export function filterNotes(notes, {tab='notes', tag=null, query=''} = {}) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  return notes.filter(note => {
    const content = contentOf(note);
    const haystack = normalizeSearch(`${content.title} ${content.body} ${content.tags}`);
    return matchesTab(note, tab)
      && (!tag || content.tags.split(',').map(t => t.trim()).includes(tag))
      && terms.every(term => haystack.includes(term));
  });
}

export function sortNotes(notes, mode='manual') {
  return [...notes].sort((a,b) => {
    const alphabetical = () => String(a.title || '').localeCompare(String(b.title || ''), 'fr', {sensitivity:'base'}) || a.id.localeCompare(b.id);
    if (mode === 'title') return alphabetical();
    if (mode === 'manual') {
      const ao = Number.isFinite(a.order) ? a.order : Infinity;
      const bo = Number.isFinite(b.order) ? b.order : Infinity;
      if (ao !== bo) return ao - bo;
    }
    return (b.modifiedAt || b.createdAt || 0) - (a.modifiedAt || a.createdAt || 0) || alphabetical();
  });
}

export function noteDateLabel(note) {
  if (note.deletedAt) return `Corbeille · ${formatDate(note.deletedAt)}`;
  if (note.modifiedAt) return `Modifiée · ${formatDate(note.modifiedAt)}`;
  // Legacy updatedAt was also changed on viewing, so it is not a reliable edit date.
  return note.date ? `Date historique · ${note.date}` : 'Date de modification inconnue';
}

export function formatDate(timestamp) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('fr-FR', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'})
    : 'Date inconnue';
}
