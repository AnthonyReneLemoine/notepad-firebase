import { contentOf, sameContent, historyOf, savedNote, revisionMatches, matchesTab, exportNotebook, filterNotes, sortNotes, noteDateLabel, formatDate } from "./notes.js";
import { readPreference, writePreference } from "./preferences.js";
import { initializeApp } from "firebase/app";
  import { getDatabase, ref, onValue, set, update, runTransaction } from "firebase/database";
  import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

  const firebaseConfig = {
    apiKey: "AIzaSyBkDCy6sVzVAspfzwwiY7uHogPFy5wezQs",
    authDomain: "notes-2e0b8.firebaseapp.com",
    databaseURL: "https://notes-2e0b8-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "notes-2e0b8",
    storageBucket: "notes-2e0b8.firebasestorage.app",
    messagingSenderId: "922708939920",
    appId: "1:922708939920:web:932594a09e80161c3e7415"
  };

  const app  = initializeApp(firebaseConfig);
  const db   = getDatabase(app);
  const auth = getAuth(app);

  let notes = [];
  let notesLoaded = false;
  let currentId = null;
  let editorBase = null;
  let isSaving = false;
  let navigationToken = 0;
  let currentTab = "notes";
  let selectedTag = null;
  let filterPreferences = {};
  let sortMode = "manual";
  const preferenceKey = () => `filters:${auth.currentUser?.uid || "anonymous"}`;
  let dbUnsubscribe = null;
  let currentTags = [];
  let tagSuggFocused = -1;
  let draggedNoteId = null;
  let justDropped = false;

  // Force le format "jeudi 5 mars" en français
  const getFrenchDate = () => {
    return new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  // ── Auth handlers ──
  window.handleLogin = async () => {
    const email    = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const errEl    = document.getElementById("loginError");
    errEl.textContent = "";
    if (!email || !password) { errEl.textContent = "Veuillez remplir tous les champs."; return; }
    try {
      document.getElementById("btnLogin").disabled = true;
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      const msgs = {
        "auth/invalid-credential":       "Email ou mot de passe incorrect.",
        "auth/user-not-found":           "Aucun compte avec cet email.",
        "auth/wrong-password":           "Mot de passe incorrect.",
        "auth/invalid-email":            "Adresse email invalide.",
        "auth/too-many-requests":        "Trop de tentatives. Réessayez plus tard.",
      };
      errEl.textContent = msgs[e.code] || "Erreur de connexion. Réessayez.";
    } finally {
      document.getElementById("btnLogin").disabled = false;
    }
  };

  window.handleSignOut = async () => {
    if (!await canLeaveEditor()) return;
    if (dbUnsubscribe) { dbUnsubscribe(); dbUnsubscribe = null; }
    await signOut(auth);
  };

  // Login on Enter key
  document.getElementById("loginPassword").addEventListener("keydown", e => {
    if (e.key === "Enter") handleLogin();
  });
  document.getElementById("loginEmail").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("loginPassword").focus();
  });

  // ── Auth state observer ──
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // User is signed in
      document.getElementById("loginScreen").classList.add("hidden");
      document.getElementById("userEmail").textContent = user.email;
      document.getElementById("userInfo").style.display = "flex";
      document.getElementById("loginEmail").value = "";
      document.getElementById("loginPassword").value = "";
      document.getElementById("loginError").textContent = "";
      notesLoaded = false;
      const saved = readPreference(preferenceKey(), {});
      filterPreferences = saved && typeof saved === 'object' ? saved : {};
      sortMode = ['manual','modified','title'].includes(filterPreferences.sort) ? filterPreferences.sort : 'manual';
      document.getElementById('sortMode').value = sortMode;
      currentTab = 'notes';
      selectedTag = typeof filterPreferences.notes === 'string' ? filterPreferences.notes : null;
      setTab('notes');
      document.getElementById("btnExport").disabled = false;
      init();
    } else {
      // User is signed out
      if (dbUnsubscribe) { dbUnsubscribe(); dbUnsubscribe = null; }
      notes = [];
      notesLoaded = false;
      currentId = null;
      editorBase = null;
      document.getElementById("btnExport").disabled = true;
      document.getElementById("loginScreen").classList.remove("hidden");
      document.getElementById("userInfo").style.display = "none";
      document.getElementById("overlay").style.display = "none";
      document.getElementById("editor").classList.add("hide");
    document.querySelector(".app").classList.remove("editor-open", "editor-expanded");
    document.getElementById("btnExpand").setAttribute("aria-pressed", "false");
    document.getElementById("btnExpand").textContent = "Plein écran";
      renderList();
      updateCounts();
    }
  });

  // ── Tag autocomplete ──
  function getAllKnownTags() {
    const set = new Set();
    notes.forEach(n => {
      if (n.tags) n.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => set.add(t));
    });
    return Array.from(set).sort();
  }

  function renderTagChips() {
    const chips = document.getElementById("tagChips");
    chips.innerHTML = "";
    currentTags.forEach(tag => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      const label = document.createTextNode(tag);
      const btn = document.createElement("button");
      btn.className = "tag-chip-del";
      btn.type = "button";
      btn.textContent = "×";
      btn.setAttribute("aria-label", `Retirer l’étiquette ${tag}`);
      btn.onclick = () => { currentTags = currentTags.filter(t => t !== tag); renderTagChips(); refreshSaveStatus(); };
      chip.appendChild(label);
      chip.appendChild(btn);
      chips.appendChild(chip);
    });
  }

  function addTag(raw) {
    const tag = raw.trim();
    if (!tag || currentTags.includes(tag)) return;
    currentTags.push(tag);
    renderTagChips();
    document.getElementById("tagInput").value = "";
    closeTagDropdown();
    refreshSaveStatus();
  }

  function closeTagDropdown() {
    document.getElementById("tagDropdown").classList.remove("open");
    tagSuggFocused = -1;
  }

  function openTagDropdown(query) {
    const dropdown = document.getElementById("tagDropdown");
    const known = getAllKnownTags().filter(t =>
      !currentTags.includes(t) &&
      (query === "" || t.toLowerCase().includes(query.toLowerCase()))
    );
    const showNew = query.trim() && !known.map(t=>t.toLowerCase()).includes(query.trim().toLowerCase()) && !currentTags.map(t=>t.toLowerCase()).includes(query.trim().toLowerCase());

    dropdown.innerHTML = "";
    known.forEach(tag => {
      const el = document.createElement("div");
      el.className = "tag-sugg";
      el.textContent = tag;
      el.onmousedown = e => { e.preventDefault(); addTag(tag); };
      dropdown.appendChild(el);
    });
    if (showNew) {
      const el = document.createElement("div");
      el.className = "tag-sugg new-tag";
      el.textContent = `+ Créer "${query.trim()}"`;
      el.onmousedown = e => { e.preventDefault(); addTag(query.trim()); };
      dropdown.appendChild(el);
    }
    if (dropdown.children.length > 0) {
      dropdown.classList.add("open");
      tagSuggFocused = -1;
    } else {
      closeTagDropdown();
    }
  }

  document.getElementById("tagInput").addEventListener("input", e => {
    const val = e.target.value;
    if (val.endsWith(',')) { addTag(val.slice(0, -1)); }
    else { openTagDropdown(val); }
  });

  document.getElementById("tagInput").addEventListener("focus", e => {
    openTagDropdown(e.target.value);
  });

  document.getElementById("tagInput").addEventListener("blur", () => {
    setTimeout(closeTagDropdown, 150);
  });

  document.getElementById("tagInput").addEventListener("keydown", e => {
    const items = document.getElementById("tagDropdown").querySelectorAll(".tag-sugg");
    if (e.key === "Enter") {
      e.preventDefault();
      if (tagSuggFocused >= 0 && items[tagSuggFocused]) {
        items[tagSuggFocused].onmousedown(e);
      } else {
        addTag(document.getElementById("tagInput").value);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      tagSuggFocused = Math.min(tagSuggFocused + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle("focused", i === tagSuggFocused));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      tagSuggFocused = Math.max(tagSuggFocused - 1, -1);
      items.forEach((el, i) => el.classList.toggle("focused", i === tagSuggFocused));
    } else if (e.key === "Escape") {
      closeTagDropdown();
    } else if (e.key === "Backspace" && !e.target.value && currentTags.length > 0) {
      currentTags.pop();
      renderTagChips();
      refreshSaveStatus();
    }
  });

  // Cliquer sur la zone de tags focus l'input
  document.getElementById("tagZone").addEventListener("click", e => {
    if (e.target === document.getElementById("tagZone") || e.target === document.getElementById("tagChips")) {
      document.getElementById("tagInput").focus();
    }
  });

  // ── Palette couleurs ──
  const NOTE_COLORS = [
    { key: "default", bg: "#ffffff", label: "Défaut" },
    { key: "green",   bg: "#e6f4ea", label: "Vert" },
    { key: "yellow",  bg: "#fef7e0", label: "Jaune" },
    { key: "red",     bg: "#fce8e6", label: "Rouge" },
    { key: "blue",    bg: "#e8f0fe", label: "Bleu" },
    { key: "teal",    bg: "#e0f5f5", label: "Turquoise" },
    { key: "purple",  bg: "#f3e8fd", label: "Violet" },
    { key: "peach",   bg: "#fde8d0", label: "Pêche" },
    { key: "gray",    bg: "#f1f3f4", label: "Gris" },
  ];
  let currentColor = "default";

  function getColorBg(key) {
    const c = NOTE_COLORS.find(c => c.key === key);
    return c ? c.bg : "#ffffff";
  }

  function renderColorSwatches() {
    const wrap = document.getElementById("colorSwatches");
    wrap.innerHTML = "";
    NOTE_COLORS.forEach(c => {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.setAttribute("aria-label", c.label);
      sw.setAttribute("aria-pressed", String(currentColor === c.key));
      sw.className = "cp-swatch" + (currentColor === c.key ? " selected" : "");
      sw.style.background = c.bg;
      sw.title = c.label;
      sw.dataset.color = c.key;
      sw.onclick = () => {
        currentColor = c.key;
        renderColorSwatches();
        document.getElementById("editor").style.background = getColorBg(c.key);
        refreshSaveStatus();
      };
      wrap.appendChild(sw);
    });
  }

  function init() {
    document.getElementById("overlay").style.display = "flex";
    dbUnsubscribe = onValue(ref(db, 'notes'), (snapshot) => {
      const data = snapshot.val();
      notesLoaded = true;
      notes = data ? Object.entries(data).filter(([, value]) => value && typeof value === "object").map(([id, value]) => ({...value, ...contentOf(value), id})) : [];
      renderTagFilter();
      renderList();
      updateCounts();
      document.getElementById("overlay").style.display = "none";
      refreshSaveStatus();
    }, () => {
      document.getElementById("overlay").style.display = "none";
      setStatus("Accès aux notes impossible", "error");
      showToast("Impossible de charger les notes. Vérifiez la connexion et les droits d’accès.");
    });
  }

  function setTab(tab) {
    currentTab = tab;
    selectedTag = typeof filterPreferences[tab] === 'string' ? filterPreferences[tab] : null;
    for (const [id, value] of [['tabNotes','notes'], ['tabArch','archived'], ['tabTrash','trash']]) {
      document.getElementById(id).classList.toggle('active', tab === value);
      document.getElementById(id).setAttribute('aria-pressed', String(tab === value));
    }
    renderTagFilter();
    renderList();
  }
  window.switchTab = async tab => {
    const token = ++navigationToken;
    if (!await canLeaveEditor() || token !== navigationToken) return;
    closeEditor();
    setTab(tab);
  };

  window.renderTagFilter = () => {
    const $tf = document.getElementById("tagFilter");
    $tf.innerHTML = "";
    const allTags = new Set();
    notes.filter(n => matchesTab(n, currentTab)).forEach(n => {
      if (n.tags) n.tags.split(',').forEach(t => {
        const clean = t.trim();
        if (clean) allTags.add(clean);
      });
    });

    if (notesLoaded && selectedTag && !allTags.has(selectedTag)) {
      selectedTag = null;
      filterPreferences[currentTab] = null;
      writePreference(preferenceKey(), filterPreferences);
    }
    if (allTags.size === 0) { $tf.style.display = "none"; return; }
    $tf.style.display = "flex";

    const btnAll = document.createElement("button");
    btnAll.type = "button";
    btnAll.setAttribute("aria-pressed", String(!selectedTag));
    btnAll.className = "tf-tag" + (!selectedTag ? " active" : "");
    btnAll.textContent = "Tous";
    btnAll.onclick = () => chooseTag(null);
    $tf.appendChild(btnAll);

    Array.from(allTags).sort().forEach(tag => {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-pressed", String(selectedTag === tag));
      el.className = "tf-tag" + (selectedTag === tag ? " active" : "");
      el.textContent = tag;
      el.onclick = () => {
        chooseTag(selectedTag === tag ? null : tag);
      };
      $tf.appendChild(el);
    });
  };

  function chooseTag(tag) {
    selectedTag = tag;
    filterPreferences[currentTab] = tag;
    writePreference(preferenceKey(), filterPreferences);
    renderTagFilter();
    renderList();
  }
  window.changeSort = mode => {
    sortMode = ['manual','modified','title'].includes(mode) ? mode : 'manual';
    filterPreferences.sort = sortMode;
    writePreference(preferenceKey(), filterPreferences);
    renderList();
  };
  window.resetFilters = () => {
    document.getElementById('search').value = '';
    chooseTag(null);
  };
  function getFilteredNotes(query) {
    return filterNotes(notes, {tab:currentTab, tag:selectedTag, query});
  }
  function sortNotesForDisplay(list) { return sortNotes(list, sortMode); }

  async function reorderNotes(dragId, targetId, pinnedState) {
    if (sortMode !== "manual" || currentTab === "trash" || !dragId || !targetId || dragId === targetId) return;

    const ordered = sortNotesForDisplay(
      notes.filter(n =>
        matchesTab(n, currentTab) &&
        !!n.pinned === pinnedState
      )
    );
    const fromIndex = ordered.findIndex(n => n.id === dragId);
    const toIndex = ordered.findIndex(n => n.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);

    const updates = {};
    ordered.forEach((n, idx) => {
      const nextOrder = idx + 1;
      n.order = nextOrder;
      updates[`notes/${n.id}/order`] = nextOrder;
    });

    setStatus("Réorganisation...", "saving");
    try {
      await update(ref(db), updates);
      setStatus("Prêt", "saved");
      showToast("Ordre des notes mis à jour ✓");
    } catch (e) {
      setStatus("Erreur", "error");
      showToast("Impossible de réorganiser les notes");
    }
  }

  function bindCardDnD(el, note) {
    el.addEventListener("dragstart", (e) => {
      draggedNoteId = note.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", note.id);
      el.classList.add("dragging");
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      document.querySelectorAll(".ni.drag-over").forEach(x => x.classList.remove("drag-over"));
    });

    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedNoteId && draggedNoteId !== note.id) {
        e.dataTransfer.dropEffect = "move";
        el.classList.add("drag-over");
      }
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("drag-over");
    });

    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const sourceId = e.dataTransfer.getData("text/plain") || draggedNoteId;
      if (!sourceId || sourceId === note.id) return;

      const source = notes.find(n => n.id === sourceId);
      if (!source || !!source.pinned !== !!note.pinned) return;

      justDropped = true;
      await reorderNotes(sourceId, note.id, !!note.pinned);
      draggedNoteId = null;
      setTimeout(() => { justDropped = false; }, 50);
    });
  }

  function createNoteCard(note) {
    const tagList = note.tags ? note.tags.split(',').map(t => t.trim()).filter(t => t !== "") : [];
    const el = document.createElement("div");
    el.className = "ni" + (note.id === currentId ? " active" : "");
    el.draggable = !note.deletedAt && sortMode === "manual";
    el.dataset.noteId = note.id;

    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Ouvrir ${note.title || "Note sans titre"}`);
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNote(note.id); }
    });
    const title = document.createElement("div");
    title.className = "ni-t";
    title.textContent = `${note.pinned ? "📌 " : ""}${note.title || "Note sans titre"}`;
    const preview = document.createElement("div");
    preview.className = "ni-preview";
    preview.textContent = note.body || "Note vide";
    const date = document.createElement("div");
    date.className = "ni-d";
    date.textContent = noteDateLabel(note);
    el.append(title, preview, date);
    if (tagList.length) {
      const tags = document.createElement("div");
      tags.className = "ni-tags";
      tagList.forEach(tag => {
        const label = document.createElement("span");
        label.className = "ni-tag";
        label.textContent = tag;
        tags.appendChild(label);
      });
      el.appendChild(tags);
    }
    // Appliquer la couleur stockée
    const bg = getColorBg(note.color || "default");
    el.style.background = bg;

    if (!note.deletedAt && sortMode === "manual") bindCardDnD(el, note);

    el.onclick = () => {
      if (justDropped) return;
      openNote(note.id);
    };

    return el;
  }

  window.renderList = () => {
    const $list = document.getElementById("list");
    const $pinnedWrap = document.getElementById("pinnedWrap");
    const $pinnedList = document.getElementById("pinnedList");
    $list.innerHTML = "";
    $pinnedList.innerHTML = "";

    const query = document.getElementById("search").value.toLowerCase();
    const filtered = sortNotesForDisplay(getFilteredNotes(query));

    const pinnedNotes = filtered.filter(n => !!n.pinned);
    const regularNotes = filtered.filter(n => !n.pinned);

    if (pinnedNotes.length > 0) {
      $pinnedWrap.classList.remove("hide");
      pinnedNotes.forEach(n => $pinnedList.appendChild(createNoteCard(n)));
    } else {
      $pinnedWrap.classList.add("hide");
    }

    regularNotes.forEach(n => $list.appendChild(createNoteCard(n)));
    const total = notes.filter(n => matchesTab(n, currentTab)).length;
    document.getElementById('resultsStatus').textContent = `${filtered.length} note${filtered.length > 1 ? 's' : ''} affichée${filtered.length > 1 ? 's' : ''} sur ${total}` + (selectedTag ? ` — Étiquette : ${selectedTag}` : '');
    document.getElementById('btnResetFilters').disabled = !selectedTag && !query.trim();
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = total ? 'Aucune note ne correspond à ces filtres.' : currentTab === 'trash' ? 'La corbeille est vide.' : currentTab === 'archived' ? 'Aucune note archivée.' : 'Aucune note. Utilisez le bouton + pour commencer.';
      $list.appendChild(empty);
    }
  };

  function draftFromEditor() {
    const tags = [...currentTags];
    document.getElementById('tagInput').value.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
      if (!tags.includes(t)) tags.push(t);
    });
    return {
      id: currentId,
      title: document.getElementById('title').value,
      body: document.getElementById('body').value,
      tags: tags.join(', '), color: currentColor
    };
  }

  function isDirty() {
    if (!currentId || editorBase?.deletedAt) return false;
    const draft = draftFromEditor();
    if (!editorBase) return Boolean(draft.title || draft.body || draft.tags || draft.color !== 'default');
    return !sameContent(draft, editorBase);
  }

  function refreshSaveStatus() {
    if (isSaving) return;
    setStatus(isDirty() ? 'Modifications non enregistrées' : 'Prêt', isDirty() ? 'saving' : 'saved');
  }

  async function canLeaveEditor() {
    if (isSaving) return false;
    if (!isDirty()) return true;
    const dialog = document.getElementById('unsavedDialog');
    if (dialog.open) return false;
    dialog.returnValue = 'cancel';
    const choice = new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), {once:true}));
    dialog.showModal();
    const answer = await choice;
    return answer === 'discard' || (answer === 'save' && await saveCurrentNote());
  }

  function displayNote(note, isNew = false) {
    currentId = note.id;
    editorBase = isNew ? null : JSON.parse(JSON.stringify(note));
    const content = contentOf(note);
    document.getElementById('title').value = content.title;
    document.getElementById('body').value = content.body;
    currentTags = content.tags.split(',').map(t => t.trim()).filter(Boolean);
    currentColor = content.color;
    renderTagChips();
    renderColorSwatches();
    const editor = document.getElementById('editor');
    editor.style.background = getColorBg(currentColor);
    editor.classList.toggle('is-trash', Boolean(note.deletedAt));
    document.getElementById('tagInput').value = '';
    document.getElementById('title').readOnly = Boolean(note.deletedAt);
    document.getElementById('body').readOnly = Boolean(note.deletedAt);
    for (const id of ['btnSave', 'btnDupl', 'btnPin', 'btnArch']) document.getElementById(id).hidden = Boolean(note.deletedAt);
    document.getElementById('btnRestore').hidden = !note.deletedAt;
    document.getElementById('btnHistory').disabled = isNew || !historyOf(note).length;
    document.getElementById('btnArch').textContent = note.archived ? 'Restaurer des archives' : 'Archiver';
    document.getElementById('btnPin').textContent = note.pinned ? 'Désépingler' : 'Épingler';
    document.getElementById('btnDelete').textContent = note.deletedAt ? 'Supprimer définitivement' : 'Mettre à la corbeille';
    editor.classList.remove('hide');
    document.querySelector('.app').classList.add('editor-open');
    renderList();
    renderNoteDates(note);
    refreshSaveStatus();
  }

  function renderNoteDates(note) {
    document.getElementById('noteDates').textContent = [
      note.createdAt ? `Créée : ${formatDate(note.createdAt)}` : null,
      noteDateLabel(note),
      note.lastViewedAt ? `Consultée : ${formatDate(note.lastViewedAt)}` : null
    ].filter(Boolean).join(' · ');
  }

  window.openNote = async id => {
    const token = ++navigationToken;
    if (!await canLeaveEditor() || token !== navigationToken) return;
    const note = notes.find(n => n.id === id);
    if (!note) return;
    displayNote(note);
    const viewedAt = Date.now();
    renderNoteDates({...note, lastViewedAt:viewedAt});
    // Do not await network before displaying and never recreate a deleted record.
    runTransaction(ref(db, 'notes/' + id), current => current ? {...current, lastViewedAt:viewedAt} : undefined, {applyLocally:false})
      .catch(() => {}); // A failed consultation timestamp must not prevent reading.
  };

  window.createNewNote = async () => {
    const token = ++navigationToken;
    if (!await canLeaveEditor() || token !== navigationToken) return;
    if (currentTab !== 'notes') setTab('notes');
    displayNote({id: 'note_' + crypto.randomUUID(), tags: selectedTag || '', color:'default'}, true);
    document.getElementById('title').focus();
  };

  window.saveCurrentNote = async () => {
    if (!currentId || editorBase?.deletedAt || isSaving) return false;
    const draft = draftFromEditor();
    const id = currentId;
    const baseline = editorBase;
    const now = Date.now();
    if (baseline && sameContent(baseline, draft)) return true;
    isSaving = true;
    document.getElementById('btnSave').disabled = true;
    setStatus('Sauvegarde…', 'saving');
    try {
      const result = await runTransaction(ref(db, 'notes/' + id), current => {
        if (!revisionMatches(current, baseline) || current?.deletedAt) return;
        return savedNote(current, {...draft, date: getFrenchDate()}, now);
      }, {applyLocally:false});
      if (!result.committed) {
        showToast('Cette note a changé ailleurs. Votre texte reste dans l’éditeur : copiez-le avant de recharger la note.');
        setStatus('Conflit : texte non enregistré', 'error');
        return false;
      }
      if (currentId === id) {
        editorBase = {...result.snapshot.val(), id};
        renderNoteDates(editorBase);
        document.getElementById('btnHistory').disabled = !historyOf(editorBase).length;
      }
      setStatus(isDirty() ? 'Modifications non enregistrées' : 'Enregistré', isDirty() ? 'saving' : 'saved');
      showToast('Enregistré ✓');
      return true;
    } catch (error) {
      setStatus('Enregistrement impossible', 'error');
      showToast('Le texte reste dans l’éditeur. Vérifiez la connexion puis réessayez.');
      return false;
    } finally {
      isSaving = false;
      document.getElementById('btnSave').disabled = false;
    }
  };

  async function saveBeforeAction() {
    if (isSaving) return false;
    if (!isDirty()) return true;
    return await saveCurrentNote() && !isDirty();
  }

  window.duplicateNote = async () => {
    const sourceId = currentId;
    if (!sourceId || !await saveBeforeAction() || sourceId !== currentId) return;
    const original = {...(editorBase || {}), ...draftFromEditor()};
    const id = 'note_' + crypto.randomUUID();
    const copy = savedNote(null, {...contentOf(original), id, title:original.title + ' (Copie)', date:getFrenchDate()}, Date.now());
    try {
      await set(ref(db, 'notes/' + id), copy);
      displayNote(copy);
      showToast('Note dupliquée ✓');
    } catch { showToast('Impossible de dupliquer la note.'); }
  };

  async function changeNote(patch, {close = false, message = 'Note mise à jour'} = {}) {
    const id = currentId;
    if (!id || !await saveBeforeAction() || currentId !== id) return false;
    const baseline = editorBase;
    if (!baseline) return false;
    try {
      const result = await runTransaction(ref(db, 'notes/' + id), current => {
        if (!revisionMatches(current, baseline)) return;
        return {...current, ...patch, revision:(Number(current.revision) || 0) + 1};
      }, {applyLocally:false});
      if (!result.committed) { showToast('La note a changé ailleurs. Rouvrez-la avant de réessayer.'); return false; }
      if (currentId === id) {
        if (close) closeEditor();
        else displayNote({...result.snapshot.val(), id});
      }
      showToast(message);
      return true;
    } catch { showToast('Action impossible. Vérifiez la connexion puis réessayez.'); return false; }
  }

  window.togglePin = () => changeNote({pinned:!editorBase?.pinned}, {message:editorBase?.pinned ? 'Note désépinglée' : 'Note épinglée'});
  window.toggleArchive = () => changeNote({archived:!editorBase?.archived}, {close:true, message:editorBase?.archived ? 'Note restaurée des archives' : 'Note archivée'});
  window.restoreNote = () => changeNote({deletedAt:null}, {close:true, message:'Note restaurée'});

  window.deleteNote = async () => {
    if (!currentId) return;
    if (!editorBase?.deletedAt) {
      if (!editorBase && !isDirty()) { closeEditor(); return; }
      await changeNote({deletedAt:Date.now()}, {close:true, message:'Note placée dans la corbeille'});
      return;
    }
    const id = currentId;
    if (!confirm(`Supprimer définitivement « ${editorBase.title || 'Note sans titre'} » et son historique ? Cette action est irréversible.`)) return;
    try {
      const result = await runTransaction(ref(db, 'notes/' + id), current => current?.deletedAt ? null : undefined, {applyLocally:false});
      if (!result.committed) { showToast('La note a déjà été restaurée ou supprimée ailleurs.'); return; }
      if (currentId === id) closeEditor();
      showToast('Note supprimée définitivement');
    } catch { showToast('Suppression impossible. La note reste dans la corbeille.'); }
  };

  function closeEditor() {
    document.getElementById('editor').classList.add('hide');
    document.getElementById('editor').style.background = '';
    document.querySelector('.app').classList.remove('editor-open', 'editor-expanded');
    document.getElementById('btnExpand').setAttribute('aria-pressed', 'false');
    document.getElementById('btnExpand').textContent = 'Plein écran';
    currentId = null;
    editorBase = null;
    renderList();
    refreshSaveStatus();
  }

  window.hideEditor = async () => { if (await canLeaveEditor()) closeEditor(); };

  window.showHistory = () => {
    if (!currentId) return;
    const id = currentId;
    const note = notes.find(n => n.id === id) || editorBase;
    const list = document.getElementById('historyList');
    list.replaceChildren();
    const history = historyOf(note).slice().reverse();
    if (!history.length) list.textContent = 'Aucune version précédente pour cette note.';
    history.forEach(version => {
      const detail = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `Version ${version.version + 1} — ` + (version.savedAt ? formatDate(version.savedAt) : version.replacedAt ? `conservée le ${formatDate(version.replacedAt)}` : 'date inconnue');
      const preview = document.createElement('pre');
      preview.textContent = `${version.title}\n\n${version.body}\n\nÉtiquettes : ${version.tags || 'aucune'}`;
      detail.append(summary, preview);
      const button = document.createElement('button');
      button.className = 'btn primary';
      button.textContent = 'Restaurer cette version';
      button.disabled = Boolean(note.deletedAt);
      button.onclick = async () => {
        if (isSaving || currentId !== id) return;
        if (isDirty() && !confirm('Remplacer les modifications non enregistrées par cette version ?')) return;
        const baseline = notes.find(n => n.id === id) || editorBase;
        const now = Date.now();
        try {
          const result = await runTransaction(ref(db, 'notes/' + id), current => {
            if (!revisionMatches(current, baseline) || current?.deletedAt) return;
            return savedNote(current, {...contentOf(version), id, date:getFrenchDate()}, now);
          }, {applyLocally:false});
          if (!result.committed) { showToast('La note a changé ailleurs. Rouvrez son historique.'); return; }
          displayNote({...result.snapshot.val(), id});
          document.getElementById('historyDialog').close();
          showToast('Version restaurée ; le contenu précédent reste dans l’historique.');
        } catch { showToast('Impossible de restaurer cette version.'); }
      };
      detail.appendChild(button);
      list.appendChild(detail);
    });
    document.getElementById('historyDialog').showModal();
  };

  window.exportNotes = async () => {
    if (!auth.currentUser || !await saveBeforeAction()) return;
    // Include a just-saved editor snapshot even if its subscription event is still pending.
    const snapshot = notes.map(note => note.id === editorBase?.id && (editorBase.revision || 0) > (note.revision || 0) ? editorBase : note);
    if (editorBase && !snapshot.some(note => note.id === editorBase.id)) snapshot.push(editorBase);
    const url = URL.createObjectURL(new Blob([exportNotebook(snapshot)], {type:'application/json;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `notepad-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Export téléchargé : notes, archives, corbeille et historique.');
  };

  for (const id of ['title', 'body', 'tagInput']) document.getElementById(id).addEventListener('input', refreshSaveStatus);
  window.addEventListener('beforeunload', event => {
    if (!isDirty() && !isSaving) return;
    event.preventDefault();
    event.returnValue = '';
  });

  function updateCounts() {
    document.getElementById("countNotes").textContent = notes.filter(x => matchesTab(x, "notes")).length;
    document.getElementById("countArch").textContent = notes.filter(x => matchesTab(x, "archived")).length;
    document.getElementById("countTrash").textContent = notes.filter(x => matchesTab(x, "trash")).length;
  }

  function setStatus(txt, state) {
    document.getElementById("stTxt").textContent = txt;
    document.getElementById("dot").className = state;
  }

  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2000);
  }

  // init() is called by onAuthStateChanged when the user logs in

// Editor layout: draggable and keyboard-operable divider, remembered on this device.
const appLayout = document.querySelector(".app");
const editorDivider = document.getElementById("editorResize");
function resizeEditor(value) {
  const width = Math.max(25, Math.min(65, Number(value) || 33));
  appLayout.style.setProperty("--editor-width", `${width}%`);
  editorDivider.setAttribute("aria-valuenow", String(Math.round(width)));
  writePreference("editor-width", width);
}
resizeEditor(readPreference("editor-width", 33));
editorDivider.addEventListener("pointerdown", e => {
  editorDivider.setPointerCapture(e.pointerId);
  editorDivider.classList.add("resizing");
});
editorDivider.addEventListener("pointermove", e => {
  if (!editorDivider.hasPointerCapture(e.pointerId)) return;
  const bounds = appLayout.getBoundingClientRect();
  resizeEditor((e.clientX - bounds.left) / bounds.width * 100);
});
for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
  editorDivider.addEventListener(event, e => {
    if (editorDivider.hasPointerCapture(e.pointerId)) editorDivider.releasePointerCapture(e.pointerId);
    editorDivider.classList.remove("resizing");
  });
}
editorDivider.addEventListener("keydown", e => {
  const value = Number(editorDivider.getAttribute("aria-valuenow"));
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    resizeEditor(e.key === "Home" ? 25 : e.key === "End" ? 65 : value + (e.key === "ArrowRight" ? 2 : -2));
  }
});
window.toggleEditorExpanded = () => {
  if (!currentId) return;
  const expanded = appLayout.classList.toggle("editor-expanded");
  document.getElementById("btnExpand").setAttribute("aria-pressed", String(expanded));
  document.getElementById("btnExpand").textContent = expanded ? "Réduire" : "Plein écran";
};
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && currentId) {
    e.preventDefault();
    saveCurrentNote();
  }
  if (e.key === "Escape" && appLayout.classList.contains("editor-expanded")) toggleEditorExpanded();
});
