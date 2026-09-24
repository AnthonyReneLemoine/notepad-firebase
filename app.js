import { readPreference, writePreference } from "./preferences.js";
import { initializeApp } from "firebase/app";
  import { getDatabase, ref, onValue, set, update, remove } from "firebase/database";
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
  let currentId = null;
  let currentTab = "notes";
  let selectedTag = "a-gmva-expo";
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
      init();
    } else {
      // User is signed out
      if (dbUnsubscribe) { dbUnsubscribe(); dbUnsubscribe = null; }
      notes = [];
      currentId = null;
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
      btn.onclick = () => { currentTags = currentTags.filter(t => t !== tag); renderTagChips(); };
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
      };
      wrap.appendChild(sw);
    });
  }

  function init() {
    document.getElementById("overlay").style.display = "flex";
    dbUnsubscribe = onValue(ref(db, 'notes'), (snapshot) => {
      const data = snapshot.val();
      notes = data ? Object.values(data) : [];
      renderTagFilter();
      renderList();
      updateCounts();
      document.getElementById("overlay").style.display = "none";
      setStatus("Prêt", "saved");
    });
  }

  window.switchTab = (tab) => {
    currentTab = tab;
    selectedTag = (tab === "notes") ? "a-gmva-expo" : null;
    document.getElementById("tabNotes").classList.toggle("active", tab === "notes");
    document.getElementById("tabNotes").setAttribute("aria-pressed", String(tab === "notes"));
    document.getElementById("tabArch").classList.toggle("active", tab === "archived");
    document.getElementById("tabArch").setAttribute("aria-pressed", String(tab === "archived"));
    renderTagFilter();
    renderList();
    if (currentId) hideEditor();
  };

  window.renderTagFilter = () => {
    const $tf = document.getElementById("tagFilter");
    $tf.innerHTML = "";
    const allTags = new Set();
    notes.filter(n => !!n.archived === (currentTab === "archived")).forEach(n => {
      if (n.tags) n.tags.split(',').forEach(t => {
        const clean = t.trim();
        if (clean) allTags.add(clean);
      });
    });

    if (allTags.size === 0) { $tf.style.display = "none"; return; }
    $tf.style.display = "flex";

    const btnAll = document.createElement("button");
    btnAll.type = "button";
    btnAll.setAttribute("aria-pressed", String(!selectedTag));
    btnAll.className = "tf-tag" + (!selectedTag ? " active" : "");
    btnAll.textContent = "Tous";
    btnAll.onclick = () => { selectedTag = null; renderTagFilter(); renderList(); };
    $tf.appendChild(btnAll);

    Array.from(allTags).sort().forEach(tag => {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-pressed", String(selectedTag === tag));
      el.className = "tf-tag" + (selectedTag === tag ? " active" : "");
      el.textContent = tag;
      el.onclick = () => {
        selectedTag = (selectedTag === tag) ? null : tag;
        renderTagFilter();
        renderList();
      };
      $tf.appendChild(el);
    });
  };

  function getFilteredNotes(query) {
    return notes.filter(n => {
      const matchTab = !!n.archived === (currentTab === "archived");
      const matchSearch = (n.title + n.body + n.tags).toLowerCase().includes(query);
      const matchTag = !selectedTag || (n.tags && n.tags.split(',').map(t=>t.trim()).includes(selectedTag));
      return matchTab && matchSearch && matchTag;
    });
  }

  function sortNotesForDisplay(list) {
    return list.sort((a, b) => {
      const aOrder = Number.isFinite(a.order) ? a.order : null;
      const bOrder = Number.isFinite(b.order) ? b.order : null;
      if (aOrder !== null && bOrder !== null) return aOrder - bOrder;
      if (aOrder !== null) return -1;
      if (bOrder !== null) return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  async function reorderNotes(dragId, targetId, pinnedState) {
    if (!dragId || !targetId || dragId === targetId) return;

    const ordered = sortNotesForDisplay(
      notes.filter(n =>
        !!n.archived === (currentTab === "archived") &&
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
    el.draggable = true;
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
    date.textContent = note.date || "";
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

    bindCardDnD(el, note);

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
  };

  window.openNote = async (id) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    currentId = id;
    
    // Mettre à jour la date de consultation sans changer l'ordre manuel
    await update(ref(db, 'notes/' + id), { updatedAt: Date.now() });

    document.getElementById("title").value = note.title;
    document.getElementById("body").value = note.body;
    currentTags = note.tags ? note.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    currentColor = note.color || "default";
    renderTagChips();
    renderColorSwatches();
    document.getElementById("editor").style.background = getColorBg(currentColor);
    document.getElementById("tagInput").value = "";
    document.getElementById("btnArch").textContent = note.archived ? "Restaurer" : "Archiver";
    document.getElementById("btnPin").textContent = note.pinned ? "Désépingler" : "Épingler";
    document.getElementById("editor").classList.remove("hide");
    document.querySelector(".app").classList.add("editor-open");
    renderList();
  };

  window.duplicateNote = async () => {
    if (!currentId) return;
    const original = notes.find(n => n.id === currentId);
    const newId = "note_" + Date.now();
    const copy = {
      ...original,
      id: newId,
      title: original.title + " (Copie)",
      date: getFrenchDate(),
      updatedAt: Date.now(),
      order: Number.isFinite(original.order) ? original.order + 0.1 : null,
      pinned: !!original.pinned
    };
    await set(ref(db, 'notes/' + newId), copy);
    openNote(newId);
    showToast("Note dupliquée ✓");
  };

  window.createNewNote = () => {
    currentId = "note_" + Date.now();
    document.getElementById("title").value = "";
    document.getElementById("body").value = "";
    currentTags = (selectedTag && selectedTag !== "Tous") ? [selectedTag] : [];
    currentColor = "default";
    renderTagChips();
    renderColorSwatches();
    document.getElementById("editor").style.background = getColorBg("default");
    document.getElementById("tagInput").value = "";
    document.getElementById("btnArch").textContent = "Archiver";
    document.getElementById("btnPin").textContent = "Épingler";
    document.getElementById("editor").classList.remove("hide");
    document.querySelector(".app").classList.add("editor-open");
    document.getElementById("title").focus();
  };

  window.saveCurrentNote = async () => {
    if (!currentId) return;
    const note = notes.find(n => n.id === currentId) || {};
    const updatedNote = {
      id: currentId,
      title: document.getElementById("title").value,
      body: document.getElementById("body").value,
      tags: currentTags.join(', '),
      color: currentColor,
      date: getFrenchDate(),
      updatedAt: Date.now(),
      archived: note.archived || false,
      order: Number.isFinite(note.order) ? note.order : null,
      pinned: note.pinned || false
    };
    setStatus("Sauvegarde...", "saving");
    try {
      await set(ref(db, 'notes/' + currentId), updatedNote);
      setStatus("Prêt", "saved");
      showToast("Enregistré ✓");
    } catch (e) { setStatus("Erreur", "error"); }
  };

  window.togglePin = async () => {
    const note = notes.find(n => n.id === currentId);
    if (!note) return;
    note.pinned = !note.pinned;
    note.updatedAt = Date.now();
    note.order = Number.isFinite(note.order) ? note.order : null;
    await set(ref(db, 'notes/' + currentId), note);
    document.getElementById("btnPin").textContent = note.pinned ? "Désépingler" : "Épingler";
    showToast(note.pinned ? "Note épinglée" : "Note désépinglée");
  };

  window.toggleArchive = async () => {
    const note = notes.find(n => n.id === currentId);
    if (!note) return;
    note.archived = !note.archived;
    note.updatedAt = Date.now();
    note.order = Number.isFinite(note.order) ? note.order : null;
    await set(ref(db, 'notes/' + currentId), note);
    hideEditor();
    showToast(note.archived ? "Note archivée" : "Note restaurée");
  };

  window.deleteNote = async () => {
    if (!confirm("Supprimer cette note ?")) return;
    await remove(ref(db, 'notes/' + currentId));
    hideEditor();
    showToast("Supprimé");
  };

  window.hideEditor = function hideEditor() {
    document.getElementById("editor").classList.add("hide");
    document.querySelector(".app").classList.remove("editor-open", "editor-expanded");
    document.getElementById("btnExpand").setAttribute("aria-pressed", "false");
    document.getElementById("btnExpand").textContent = "Plein écran";
    document.getElementById("editor").style.background = "";
    currentId = null;
    renderList();
  }

  function updateCounts() {
    document.getElementById("countNotes").textContent = notes.filter(x => !x.archived).length;
    document.getElementById("countArch").textContent = notes.filter(x => x.archived).length;
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
