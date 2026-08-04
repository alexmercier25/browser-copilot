#!/usr/bin/env node
// browser-copilot : pilote LE navigateur d'Alex (sa vraie fenêtre, ses vraies
// sessions) via le pont AppleScript de Dia, avec un curseur Claude visible.
//
// Prérequis : Dia lancé avec --enable-applescript-javascript
//   ./relaunch.sh   (ou l'app "Dia Copilot")
//
// Usage : node copilot.mjs <commande> [args]
//   tabs                       liste les onglets (id + url)
//   attach <motif>             cible un onglet SANS voler le focus (défaut)
//   focus <motif>              cible ET amène au premier plan
//   target                     quel onglet est ciblé
//   nav <url>                  navigue l'onglet ciblé
//   snap [motif]               inventaire des éléments cliquables (refs)
//   read [n]                   texte de la page (n premiers caractères)
//   click <ref>                curseur -> élément -> clic
//   fill <ref> <texte>         curseur -> focus -> saisie (React-safe)
//   press <touche>             Enter, Escape, Tab, ArrowDown...
//   hover <ref>                curseur -> survol
//   scroll <px>                défilement doux
//   move <x> <y>               bouge juste le curseur
//   say <texte>                change l'étiquette du curseur
//   eval <js>                  JS arbitraire dans l'onglet actif
//   shot [chemin]              capture de la fenêtre (par ID, pas par région)
//   marks [off]                badges numérotés sur les refs du dernier snap
//   look [chemin]              snap + badges + screenshot : la carte cliquable

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pexec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.CC_BROWSER || 'Dia';
const OVERLAY = readFileSync(join(HERE, 'overlay.js'), 'utf8');
const GLIDE = Number(process.env.CC_GLIDE || 520); // durée du déplacement curseur

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function osa(lines) {
  const args = [];
  for (const l of [].concat(lines)) args.push('-e', l);
  const { stdout } = await pexec('osascript', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout.replace(/\n$/, '');
}

// --- ciblage de l'onglet ---------------------------------------------------
// On vise un onglet PAR ID, jamais `active tab of front window`. Deux raisons :
// l'humain garde son focus et peut continuer à travailler ailleurs, et l'agent
// ne se fait pas dérouter si l'onglet actif change en cours de route.
// Le JS s'exécute dans un onglet caché sans problème (layout conservé).
const TARGET_FILE = '/tmp/cc-target.json';

function loadTarget() {
  if (process.env.CC_TAB && process.env.CC_WIN) {
    return { id: process.env.CC_TAB, win: process.env.CC_WIN };
  }
  try {
    return JSON.parse(readFileSync(TARGET_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveTarget(t) {
  writeFileSync(TARGET_FILE, JSON.stringify(t));
  return t;
}

function targetSpec() {
  const t = loadTarget();
  if (!t) {
    throw new Error(
      'aucun onglet ciblé. Fais `attach <motif>` (sans voler le focus) ou `focus <motif>`.'
    );
  }
  return `tab id "${t.id}" of window id "${t.win}"`;
}

// --- exécution JS dans l'onglet -------------------------------------------
// Le JS voyage en base64 : zéro problème de guillemets ou d'accents entre
// Node -> AppleScript -> Dia -> moteur JS.
async function runJS(src, target = targetSpec()) {
  const wrapped = `(function(){${src}\n})()`;
  const b64 = Buffer.from(wrapped, 'utf8').toString('base64');
  const payload =
    "eval(new TextDecoder().decode(Uint8Array.from(atob('" +
    b64 +
    "'),function(c){return c.charCodeAt(0)})))";
  try {
    const raw = await osa(
      `tell application "${APP}" to execute ${target} javascript "${payload}"`
    );
    // Dia encode déjà le résultat JS en JSON avant de le rendre à AppleScript.
    // On retire cette couche : le JS de l'outil renvoie ensuite son propre JSON.
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch (e) {
    const msg = String(e.stderr || e.message);
    const noFlag = msg.includes('--enable-applescript-javascript');
    const notRunning = /isn.t running|n.est pas en cours|-600/.test(msg);
    if ((noFlag || notRunning) && !runJS.retried) {
      runJS.retried = true;
      // Si le navigateur est fermé, on peut le lancer flaggé sans rien demander
      // à personne. S'il tourne déjà sans le flag, seul un redémarrage règle ça
      // et ça ferme la fenêtre de travail : c'est à l'humain de décider.
      if (!(await isRunning())) {
        await pexec('bash', [join(HERE, 'relaunch.sh')], {
          env: { ...process.env, CC_QUIET: '1' },
        }).catch(() => {});
        return runJS(src, target);
      }
      console.error(
        `\n${APP} tourne sans le flag requis (${'--enable-applescript-javascript'}).\n` +
          `Relance-le :  ${join(HERE, 'relaunch.sh')}\n` +
          `Pour ne plus jamais avoir à le faire : mets « ${APP} Copilot » dans le Dock\n` +
          `à la place de ${APP}, il lance toujours avec le flag.\n`
      );
      process.exit(2);
    }
    throw e;
  }
}

async function isRunning() {
  try {
    await pexec('pgrep', ['-x', APP]);
    return true;
  } catch {
    return false;
  }
}

const J = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

async function ensureOverlay() {
  await runJS(OVERLAY + '\nreturn "ok";');
}

// --- inventaire ------------------------------------------------------------
const SNAP_JS = `
var SEL = 'a,button,input,textarea,select,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemradio],[role=checkbox],[role=switch],[role=option],[role=combobox],[contenteditable=""],[contenteditable="true"],[onclick]';
var out = [], refs = [];
var seen = new Set();
function name(el){
  var n = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '';
  if (!n && el.getAttribute('aria-labelledby')) {
    var lb = document.getElementById(el.getAttribute('aria-labelledby'));
    if (lb) n = lb.innerText || '';
  }
  if (!n) n = (el.innerText || el.value || '').trim();
  return n.replace(/\\s+/g,' ').trim().slice(0,90);
}
function walk(root){
  var list;
  try { list = root.querySelectorAll(SEL); } catch(e){ return; }
  for (var i=0;i<list.length;i++) collect(list[i]);
  var all = root.querySelectorAll('*');
  for (var j=0;j<all.length;j++) if (all[j].shadowRoot) walk(all[j].shadowRoot);
}
function collect(el){
  if (seen.has(el)) return;
  if (el.closest && el.closest('#__cc_host')) return;
  var r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  var cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
  if (el.disabled) return;
  seen.add(el);
  var inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  refs.push(el);
  out.push({
    r: refs.length - 1,
    tag: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''),
    role: el.getAttribute('role') || undefined,
    name: name(el),
    val: (el.value !== undefined && el.type !== 'password') ? String(el.value).slice(0,60) : undefined,
    box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    vis: inView || undefined
  });
}
walk(document);
window.__ccRefs = refs;
return JSON.stringify({url: location.href, title: document.title, count: out.length, els: out});
`;

async function snapshot() {
  await ensureOverlay();
  return J(await runJS(SNAP_JS));
}

const REF_JS = (r) => `
var el = (window.__ccRefs||[])[${r}];
if (!el) return JSON.stringify({err:'ref ${r} inconnu - refais un snap'});
if (!el.isConnected) return JSON.stringify({err:'ref ${r} détaché du DOM - refais un snap'});
var b = el.getBoundingClientRect();
if (b.bottom < 0 || b.top > innerHeight) { el.scrollIntoView({block:'center', behavior:'instant'}); b = el.getBoundingClientRect(); }
`;

async function moveToRef(r, label) {
  await ensureOverlay();
  const res = J(
    await runJS(
      REF_JS(r) +
        `
var x = Math.round(b.left + b.width/2), y = Math.round(b.top + b.height/2);
${label ? `window.__cc.label(${JSON.stringify(label)});` : ''}
window.__cc.moveTo(x,y); window.__cc.highlight(el);
return JSON.stringify({x:x,y:y,tag:el.tagName.toLowerCase(),name:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().slice(0,60)});
`
    )
  );
  if (res.err) throw new Error(res.err);
  await sleep(GLIDE);
  return res;
}

async function click(r) {
  const info = await moveToRef(r);
  const out = J(
    await runJS(
      REF_JS(r) +
        `
var x = b.left + b.width/2, y = b.top + b.height/2;
window.__cc.pop();
var base = {bubbles:true, cancelable:true, composed:true, view:window, clientX:x, clientY:y, screenX:x, screenY:y, button:0};
var p = Object.assign({pointerId:1, pointerType:'mouse', isPrimary:true}, base);
el.dispatchEvent(new PointerEvent('pointerover', p));
el.dispatchEvent(new MouseEvent('mouseover', base));
el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({buttons:1}, p)));
el.dispatchEvent(new MouseEvent('mousedown', Object.assign({buttons:1}, base)));
try { (el.focus||function(){}).call(el); } catch(e){}
el.dispatchEvent(new PointerEvent('pointerup', p));
el.dispatchEvent(new MouseEvent('mouseup', base));
try { el.click(); } catch(e){}
return JSON.stringify({clicked:true, url:location.href});
`
    )
  );
  await sleep(180);
  await runJS('if(window.__cc) window.__cc.highlight(null); return 1;');
  return { ...info, ...out };
}

async function fill(r, text) {
  await moveToRef(r, 'Claude écrit');
  const out = J(
    await runJS(
      REF_JS(r) +
        `
window.__cc.pop();
var txt = ${JSON.stringify(text)};
try { el.focus(); } catch(e){}
if (el.isContentEditable) {
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, txt);
} else {
  var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, '');
  el.dispatchEvent(new Event('input', {bubbles:true}));
  setter.call(el, txt);
  el.dispatchEvent(new InputEvent('input', {bubbles:true, data:txt, inputType:'insertText'}));
  el.dispatchEvent(new Event('change', {bubbles:true}));
}
return JSON.stringify({filled:true, value:(el.value!==undefined?el.value:el.innerText)});
`
    )
  );
  await runJS('if(window.__cc) window.__cc.label("Claude"); return 1;');
  return out;
}

const KEYMAP = {
  Enter: [13, 'Enter'],
  Escape: [27, 'Escape'],
  Tab: [9, 'Tab'],
  Backspace: [8, 'Backspace'],
  ArrowDown: [40, 'ArrowDown'],
  ArrowUp: [38, 'ArrowUp'],
  ArrowLeft: [37, 'ArrowLeft'],
  ArrowRight: [39, 'ArrowRight'],
};

async function press(key) {
  const [code, k] = KEYMAP[key] || [key.charCodeAt(0), key];
  return J(
    await runJS(`
var el = document.activeElement || document.body;
var o = {key:${JSON.stringify(k)}, code:${JSON.stringify(k)}, keyCode:${code}, which:${code}, bubbles:true, cancelable:true, composed:true};
el.dispatchEvent(new KeyboardEvent('keydown', o));
el.dispatchEvent(new KeyboardEvent('keypress', o));
el.dispatchEvent(new KeyboardEvent('keyup', o));
if (${JSON.stringify(k)} === 'Enter' && el.form && typeof el.form.requestSubmit === 'function') {
  try { el.form.requestSubmit(); } catch(e){}
}
return JSON.stringify({pressed:${JSON.stringify(k)}, on:el.tagName.toLowerCase()});
`)
  );
}

async function hover(r) {
  const info = await moveToRef(r, 'Claude survole');
  await runJS(
    REF_JS(r) +
      `
var x = b.left + b.width/2, y = b.top + b.height/2;
var base = {bubbles:true, cancelable:true, composed:true, view:window, clientX:x, clientY:y, relatedTarget:document.body};
el.dispatchEvent(new PointerEvent('pointerover', Object.assign({pointerId:1,pointerType:'mouse',isPrimary:true}, base)));
el.dispatchEvent(new MouseEvent('mouseover', base));
el.dispatchEvent(new MouseEvent('mouseenter', {bubbles:false, clientX:x, clientY:y, view:window}));
el.dispatchEvent(new MouseEvent('mousemove', base));
return 1;
`
  );
  return info;
}

// --- onglets ---------------------------------------------------------------
async function tabs() {
  const raw = await osa([
    `tell application "${APP}"`,
    `set out to ""`,
    `repeat with w in windows`,
    `repeat with t in tabs of w`,
    `set out to out & (id of w) & "\t" & (id of t) & "\t" & (URL of t) & "\t" & (title of t) & linefeed`,
    `end repeat`,
    `end repeat`,
    `return out`,
    `end tell`,
  ]);
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l, i) => {
      const [win, id, url, ...rest] = l.split('\t');
      return { i, win, id, url, title: rest.join(' ') };
    });
}

async function resolveTab(match) {
  const list = await tabs();
  const m = match.toLowerCase();
  const hit =
    list.find((t) => t.url.toLowerCase().includes(m)) ||
    list.find((t) => (t.title || '').toLowerCase().includes(m));
  if (!hit) throw new Error(`aucun onglet ne matche "${match}"`);
  return hit;
}

// Cible un onglet SANS le mettre au premier plan : l'humain garde son focus.
async function attach(match) {
  const hit = await resolveTab(match);
  saveTarget(hit);
  return { ...hit, focus: 'inchangé' };
}

async function focusTab(match) {
  const hit = await resolveTab(match);
  saveTarget(hit);
  await osa([
    `tell application "${APP}"`,
    `activate`,
    `focus (first tab of windows whose id is "${hit.id}")`,
    `end tell`,
  ]);
  await sleep(350);
  return { ...hit, focus: 'volé' };
}

// Amène la cible devant, exécute, puis rend le focus à l'onglet d'où on vient.
async function withFocus(fn) {
  const t = loadTarget();
  const before = await osa(
    `tell application "${APP}" to get id of active tab of window id "${t.win}"`
  ).catch(() => null);
  const restore = before && before !== t.id;
  if (restore) {
    await osa(`tell application "${APP}" to focus (first tab of windows whose id is "${t.id}")`);
    await sleep(400);
  }
  try {
    return await fn();
  } finally {
    if (restore) {
      await osa(
        `tell application "${APP}" to focus (first tab of windows whose id is "${before}")`
      );
    }
  }
}

async function navigate(url) {
  const t = loadTarget();
  if (!t) throw new Error('aucun onglet ciblé - fais `attach <motif>` d\'abord');
  await osa(
    `tell application "${APP}" to set URL of tab id "${t.id}" of window id "${t.win}" to "${url}"`
  );
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    const loading = await osa(
      `tell application "${APP}" to get loading of tab id "${t.id}" of window id "${t.win}"`
    );
    if (loading === 'false') break;
  }
  await sleep(400);
  await ensureOverlay();
  return J(await runJS('return JSON.stringify({url:location.href, title:document.title});'));
}

// Capture via l'app CC Shot (ScreenCaptureKit) : permission Enregistrement de
// l'écran attribuée au helper lui-même, pas à l'app hôte du shell. Capture la
// fenêtre par ID -> insensible aux écrans à origine négative et à l'occlusion.
const HELPER = join(process.env.HOME, 'Applications', 'CC Shot.app');

// Voie rapide : `screencapture -l <windowID>`. Capture par ID de fenêtre, donc
// insensible aux écrans à origine négative et à l'occlusion, exactement comme
// le helper. La permission utilisée est celle du process appelant : si le
// harness l'a déjà, il n'y a rien à installer ni à autoriser.
async function shotDirect(out) {
  const { stdout } = await pexec(join(HERE, 'ccwin'), [APP]);
  const wid = stdout.trim();
  if (!wid) throw new Error(`aucune fenêtre ${APP}`);
  await pexec('screencapture', ['-x', '-o', '-l', wid, out]);
  return { file: out, window: wid, via: 'screencapture' };
}

async function shot(path) {
  const out = path || `/tmp/cc-shot-${Date.now()}.png`;
  const status = out + '.status';
  await pexec('rm', ['-f', out, status]);
  try {
    return await shotDirect(out);
  } catch {
    // Le harness n'a pas la permission : on passe par CC Shot, qui possède
    // la sienne et reste donc indépendant du runtime appelant.
  }
  await pexec('open', ['-na', HELPER, '--args', '--app', APP, '--out', out]);
  for (let i = 0; i < 48; i++) {
    await sleep(250);
    let st;
    try {
      st = readFileSync(status, 'utf8').trim();
    } catch {
      continue;
    }
    if (st.startsWith('OK')) {
      await pexec('rm', ['-f', status]);
      return { file: out, size: st.slice(3) };
    }
    if (st.startsWith('ERROR')) {
      if (/refus|declin|denied/i.test(st)) {
        throw new Error(
          'Permission Enregistrement de l\'écran manquante pour « CC Shot » :\n' +
            'Réglages > Confidentialité et sécurité > Enregistrement de l\'écran > activer CC Shot.'
        );
      }
      throw new Error(st);
    }
  }
  throw new Error('timeout: CC Shot n\'a pas répondu en 12 s');
}

// Badges numérotés sur chaque ref du dernier snap -> le screenshot devient
// une carte cliquable (le numéro visible EST le ref à passer à click/fill).
async function marks(on) {
  await ensureOverlay();
  return J(
    await runJS(`
var sr = window.__cc.host.shadowRoot;
var old = sr.getElementById('badges');
if (old) old.remove();
if (!${on}) return JSON.stringify({marks:'off'});
var refs = window.__ccRefs || [];
if (!refs.length) return JSON.stringify({err:'aucun ref - fais un snap d\\'abord'});
var box = document.createElement('div');
box.id = 'badges';
var n = 0;
refs.forEach(function(el, i){
  if (!el.isConnected) return;
  var r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
  var b = document.createElement('div');
  b.textContent = i;
  b.style.cssText = 'position:fixed;left:' + Math.max(0, r.left - 4) + 'px;top:' + Math.max(0, r.top - 8) + 'px;' +
    'background:#D97757;color:#fff;font:700 10px/1 -apple-system,sans-serif;padding:2px 4px;' +
    'border-radius:4px;border:1px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);pointer-events:none;z-index:1;';
  box.appendChild(b);
  n++;
});
sr.appendChild(box);
return JSON.stringify({marks:'on', shown:n, total:refs.length});
`)
  );
}

// --- CLI -------------------------------------------------------------------
const [, , cmd, ...rest] = process.argv;
const p = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));

try {
  switch (cmd) {
    case 'tabs':
      p(await tabs());
      break;
    case 'attach':
      p(await attach(rest.join(' ')));
      break;
    case 'focus':
      p(await focusTab(rest.join(' ')));
      break;
    case 'target':
      p(loadTarget() || 'aucun onglet ciblé');
      break;
    case 'nav':
      p(await navigate(rest[0]));
      break;
    case 'snap': {
      const s = await snapshot();
      if (rest.length) {
        const m = rest.join(' ').toLowerCase();
        s.els = s.els.filter(
          (e) =>
            (e.name || '').toLowerCase().includes(m) ||
            (e.tag || '').includes(m) ||
            (e.role || '').includes(m)
        );
        s.count = s.els.length;
      }
      p(s);
      break;
    }
    case 'read':
      p(
        await runJS(
          `return (document.body.innerText||'').replace(/\\n{3,}/g,'\\n\\n').slice(0, ${Number(rest[0]) || 6000});`
        )
      );
      break;
    case 'click':
      p(await click(Number(rest[0])));
      break;
    case 'fill':
      p(await fill(Number(rest[0]), rest.slice(1).join(' ')));
      break;
    case 'press':
      p(await press(rest[0]));
      break;
    case 'hover':
      p(await hover(Number(rest[0])));
      break;
    case 'scroll':
      await ensureOverlay();
      p(
        await runJS(
          `window.scrollBy({top:${Number(rest[0]) || 400}, behavior:'smooth'}); return JSON.stringify({y:Math.round(scrollY)});`
        )
      );
      break;
    case 'move':
      await ensureOverlay();
      p(await runJS(`window.__cc.moveTo(${Number(rest[0])},${Number(rest[1])}); return 'ok';`));
      break;
    case 'say':
      await ensureOverlay();
      p(await runJS(`window.__cc.label(${JSON.stringify(rest.join(' '))}); return 'ok';`));
      break;
    case 'eval':
      p(await runJS(rest.join(' ')));
      break;
    // Un onglet caché n'est pas rendu : toute capture exige que la cible soit
    // devant. On l'amène, on capture, et on rend le focus d'où il venait.
    case 'shot':
      p(await withFocus(() => shot(rest[0])));
      break;
    case 'marks':
      p(await marks(rest[0] !== 'off'));
      break;
    case 'look': {
      // snap + badges + screenshot en un coup : la carte cliquable complète
      const s = await snapshot();
      const f = await withFocus(async () => {
        await marks(true);
        await sleep(150);
        const r = await shot(rest[0]);
        await marks(false);
        return r;
      });
      p({ file: f.file, url: s.url, title: s.title, count: s.count, els: s.els });
      break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 26).join('\n'));
  }
} catch (e) {
  console.error('ERREUR:', String(e.stderr || e.message).trim());
  process.exit(1);
}
