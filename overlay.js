// Curseur Claude visible dans la vraie page. Injecté dans un shadow root
// pour ne rien casser du CSS de l'app hôte. Idempotent.
(function () {
  if (window.__cc) return 'already';

  var host = document.createElement('div');
  host.id = '__cc_host';
  host.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
  var sr = host.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    '.cur{position:fixed;top:0;left:0;transform:translate3d(-100px,-100px,0);',
    'transition:transform .45s cubic-bezier(.22,.61,.36,1);will-change:transform;',
    'pointer-events:none;display:flex;align-items:flex-start;gap:6px;}',
    '.cur svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));display:block}',
    '.lbl{margin-top:14px;background:#D97757;color:#fff;font:600 11px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;',
    'padding:3px 7px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3);letter-spacing:.02em}',
    '.ripple{position:fixed;top:0;left:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;',
    'border:2px solid #D97757;opacity:0;pointer-events:none}',
    '@keyframes ccpop{0%{transform:scale(.2);opacity:.95}100%{transform:scale(1.5);opacity:0}}',
    '.ripple.go{animation:ccpop .45s ease-out forwards}',
    '.hl{position:fixed;pointer-events:none;border:2px solid #D97757;border-radius:5px;',
    'background:rgba(217,119,87,.12);opacity:0;transition:opacity .18s}',
    '.hl.on{opacity:1}',
  ].join('');

  var cur = document.createElement('div');
  cur.className = 'cur';
  cur.innerHTML =
    '<svg width="18" height="24" viewBox="0 0 18 24" fill="none">' +
    '<path d="M2 1.5 L2 19 L6.6 14.6 L9.6 21.6 L12.6 20.3 L9.7 13.6 L15.8 13.4 Z" ' +
    'fill="#D97757" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>' +
    '<span class="lbl">Claude</span>';

  var ripple = document.createElement('div');
  ripple.className = 'ripple';
  var hl = document.createElement('div');
  hl.className = 'hl';

  sr.appendChild(style);
  sr.appendChild(hl);
  sr.appendChild(ripple);
  sr.appendChild(cur);
  (document.body || document.documentElement).appendChild(host);

  var pos = { x: -100, y: -100 };

  function moveTo(x, y) {
    pos.x = x;
    pos.y = y;
    cur.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    return [x, y];
  }

  function pop() {
    ripple.style.transform = 'translate3d(' + pos.x + 'px,' + pos.y + 'px,0)';
    ripple.classList.remove('go');
    void ripple.offsetWidth;
    ripple.classList.add('go');
  }

  function highlight(el) {
    if (!el) {
      hl.classList.remove('on');
      return;
    }
    var r = el.getBoundingClientRect();
    hl.style.left = r.left - 3 + 'px';
    hl.style.top = r.top - 3 + 'px';
    hl.style.width = r.width + 6 + 'px';
    hl.style.height = r.height + 6 + 'px';
    hl.classList.add('on');
  }

  function label(t) {
    cur.querySelector('.lbl').textContent = t || 'Claude';
  }

  // Le host peut être retiré par un re-render agressif : on se recolle.
  var mo = new MutationObserver(function () {
    if (!document.getElementById('__cc_host')) {
      (document.body || document.documentElement).appendChild(host);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: false });

  window.__cc = {
    moveTo: moveTo,
    pop: pop,
    highlight: highlight,
    label: label,
    pos: pos,
    host: host,
  };
  return 'installed';
})();
