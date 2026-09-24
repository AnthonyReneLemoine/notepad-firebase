import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import * as model from '../notes.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const code = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/^\s*import .*?;\s*$/gm, '');
const fixture = (id, extras={}) => ({id, title:`Note ${id}`, body:`Texte ${id}`, tags:'a-gmva-expo', color:'default', revision:0, ...extras});
const tick = () => new Promise(resolve => setImmediate(resolve));

async function boot(initial = [fixture('a')]) {
  const dom = new JSDOM(html, {url:'https://notepad.example/', runScripts:'outside-only', pretendToBeVisual:true});
  const w = dom.window;
  const data = Object.fromEntries(initial.map(n => [n.id, structuredClone(n)]));
  let subscriber;
  let failWrites = false;
  const auth = {currentUser:{uid:'test-user',email:'test@example.invalid'}};
  const snapshot = value => ({val:() => structuredClone(value)});
  const emit = () => subscriber?.(snapshot(data));
  const get = path => data[path.split('/')[1]] ?? null;
  const put = (path, value) => {
    const id = path.split('/')[1];
    if (value === null) delete data[id]; else data[id] = structuredClone(value);
    emit();
  };
  w.confirm = () => true;
  w.Blob = Blob;
  let exported;
  w.URL.createObjectURL = blob => {exported=blob;return 'blob:export';};
  w.URL.revokeObjectURL = () => {};
  w.document.addEventListener('click', e => {if(e.target.tagName === 'A') e.preventDefault();});
  w.HTMLDialogElement.prototype.showModal = function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close = function(value=''){this.returnValue=value;this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  w.__deps = {
    ...model,
    readPreference:(key,fallback=null) => JSON.parse(w.localStorage.getItem(`notepad:${key}`)) ?? fallback,
    writePreference:(key,value) => w.localStorage.setItem(`notepad:${key}`,JSON.stringify(value)),
    initializeApp:()=>({}),getDatabase:()=>({}),getAuth:()=>auth,
    signInWithEmailAndPassword:async()=>{},signOut:async()=>{},
    onAuthStateChanged:(_, callback)=>queueMicrotask(()=>callback(auth.currentUser)),
    ref:(_,path='')=>path,
    onValue:(_,callback)=>{subscriber=callback;emit();return ()=>{subscriber=null;};},
    set:async(path,value)=>{if(failWrites)throw Error('offline');put(path,value);},
    update:async(_,updates)=>{if(failWrites)throw Error('offline');for(const [path,value] of Object.entries(updates)){const [,id,key]=path.split('/');data[id][key]=value;}emit();},
    runTransaction:async(path,updater)=>{
      if(failWrites)throw Error('offline');
      const next=updater(structuredClone(get(path)));
      if(next===undefined)return {committed:false,snapshot:snapshot(get(path))};
      put(path,next);return {committed:true,snapshot:snapshot(next)};
    }
  };
  w.eval(`(function(){const {${Object.keys(w.__deps).join(',')}}=window.__deps;\n${code}\n})();`);
  await tick();
  return {w,data,emit,close:()=>w.close(),failWrites:()=>{failWrites=true;},exported:()=>exported};
}

test('history keeps 20 previous content snapshots without nesting',()=>{
  let note=fixture('a');
  for(let i=1;i<=25;i++) note=model.savedNote(note,{...model.contentOf(note),id:'a',body:`Version ${i}`},i*1000);
  assert.equal(note.history.length,20);
  assert.equal(note.history.at(-1).body,'Version 24');
  assert.equal(note.history[0].body,'Version 5');
  assert(note.history.every(entry=>!('history' in entry)));
  const same=model.savedNote(note,{...model.contentOf(note),id:'a'},26000);
  assert.equal(same.history.length,20);
});

test('export retains active, archived and deleted notes and history',()=>{
  const notes=[fixture('a'),fixture('b',{archived:true}),fixture('c',{deletedAt:1000,history:[{body:'ancien'}]})];
  const parsed=JSON.parse(model.exportNotebook(notes));
  assert.equal(parsed.format,'notepad-backup');
  assert.deepEqual(parsed.notes,notes);
});

test('cards show safe previews; keyboard resizing, full screen and Ctrl+S work',async()=>{
  const app=await boot([fixture('a',{title:'<b>Titre</b>',body:'Aperçu lisible'})]);
  const {w}=app;
  try {
    assert.equal(w.document.querySelector('.ni-t').textContent,'<b>Titre</b>');
    assert.equal(w.document.querySelector('.ni-t b'),null);
    assert.equal(w.document.querySelector('.ni-preview').textContent,'Aperçu lisible');
    w.document.querySelector('.ni').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();
    assert(!w.document.getElementById('editor').classList.contains('hide'));
    const divider=w.document.getElementById('editorResize');
    divider.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(divider.getAttribute('aria-valuenow'),'35');
    w.toggleEditorExpanded();
    assert(w.document.querySelector('.app').classList.contains('editor-expanded'));
    const body=w.document.getElementById('body');body.value='Version clavier';body.dispatchEvent(new w.Event('input'));
    w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'s',ctrlKey:true,cancelable:true}));await tick();
    assert.equal(app.data.a.body,'Version clavier');
    assert.equal(app.data.a.history[0].body,'Aperçu lisible');
  } finally {app.close();}
});

test('archive saves edits; trash retains content and can restore archived state',async()=>{
  const app=await boot();const {w}=app;
  try {
    await w.openNote('a');w.document.getElementById('body').value='Travail conservé';
    await w.toggleArchive();
    assert.equal(app.data.a.body,'Travail conservé');assert.equal(app.data.a.archived,true);
    await w.openNote('a');await w.deleteNote();
    assert(app.data.a.deletedAt);assert.equal(app.data.a.body,'Travail conservé');
    assert.equal(w.document.getElementById('countTrash').textContent,'1');
    await w.openNote('a');assert(w.document.getElementById('body').readOnly);
    await w.restoreNote();assert.equal(app.data.a.deletedAt,null);assert.equal(app.data.a.archived,true);
  } finally {app.close();}
});

test('history restoration preserves the version it replaces',async()=>{
  const app=await boot();const {w}=app;
  try {
    await w.openNote('a');w.document.getElementById('body').value='Deuxième version';await w.saveCurrentNote();
    w.showHistory();await w.document.querySelector('#historyList button').onclick();
    assert.equal(app.data.a.body,'Texte a');
    assert.equal(app.data.a.history.at(-1).body,'Deuxième version');
  } finally {app.close();}
});

test('closing a dirty note allows cancellation and explicit discard',async()=>{
  const app=await boot();const {w}=app;
  try {
    await w.openNote('a');w.document.getElementById('body').value='Brouillon';
    let closing=w.hideEditor();await tick();w.document.getElementById('unsavedDialog').close('cancel');await closing;
    assert(!w.document.getElementById('editor').classList.contains('hide'));
    closing=w.hideEditor();await tick();w.document.getElementById('unsavedDialog').close('discard');await closing;
    assert(w.document.getElementById('editor').classList.contains('hide'));assert.equal(app.data.a.body,'Texte a');
  } finally {app.close();}
});

test('concurrent edit or network failure cannot silently replace text',async()=>{
  const app=await boot();const {w}=app;
  try {
    await w.openNote('a');w.document.getElementById('body').value='Mon brouillon';
    app.data.a.body='Texte autre appareil';app.data.a.revision=1;app.emit();
    assert.equal(await w.saveCurrentNote(),false);assert.equal(app.data.a.body,'Texte autre appareil');
    assert.equal(w.document.getElementById('body').value,'Mon brouillon');
    app.failWrites();assert.equal(await w.saveCurrentNote(),false);
    assert.equal(w.document.getElementById('body').value,'Mon brouillon');
  } finally {app.close();}
});

test('rapid note selection saves into the final selected note only',async()=>{
  const app=await boot([fixture('a'),fixture('b')]);const {w}=app;
  try {
    await Promise.all([w.openNote('a'),w.openNote('b')]);
    assert.equal(w.document.getElementById('body').value,'Texte b');
    w.document.getElementById('body').value='B modifiée';await w.saveCurrentNote();
    assert.equal(app.data.a.body,'Texte a');assert.equal(app.data.b.body,'B modifiée');
  } finally {app.close();}
});
