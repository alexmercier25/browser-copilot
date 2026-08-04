#!/bin/bash
# Lance (ou relance) Dia avec le flag qui autorise l'exécution de JS via AppleScript.
#
# Conçu pour remplacer l'icône Dia dans le Dock : dans le cas normal il n'y a
# AUCUNE friction. Trois cas seulement :
#   - Dia pas lancé          -> lancement direct avec le flag, rien à cliquer
#   - Dia lancé AVEC le flag -> on l'active, c'est tout
#   - Dia lancé SANS le flag -> seul cas qui demande un redémarrage
set -uo pipefail

APP="${CC_BROWSER_APP:-/Applications/Dia.app}"
PROC="$(basename "$APP" .app)"
FLAG="--enable-applescript-javascript"
QUIET="${CC_QUIET:-0}"
say() { [ "$QUIET" = "1" ] || echo "$@"; }

# Sonde du pont. On vise `tab 1 of window 1` et JAMAIS `active tab` : ce dernier
# renvoie `missing value` dès que le navigateur n'est pas au premier plan, donc
# la sonde échouait alors que le pont était parfaitement actif.
#
# Règle : on ne redémarre QUE sur preuve positive que le flag manque. Un échec
# de sonde pour n'importe quelle autre raison (pas de fenêtre, app occupée) ne
# doit jamais fermer le navigateur de quelqu'un.
#   0 = pont actif · 1 = flag absent, confirmé · 2 = indéterminé
bridge_probe() {
  local out
  out="$(osascript -e "tell application \"$PROC\" to execute tab 1 of window 1 javascript \"1\"" 2>&1)"
  if [ $? -eq 0 ]; then return 0; fi
  case "$out" in
    *enable-applescript-javascript*) return 1 ;;
    *) BRIDGE_ERR="$out"; return 2 ;;
  esac
}

activate() { osascript -e "tell application \"$PROC\" to activate" >/dev/null 2>&1; }

# --- cas 1 : pas lancé -> lancement direct, zéro interaction ----------------
if ! pgrep -x "$PROC" >/dev/null; then
  open -na "$APP" --args "$FLAG"
  for _ in $(seq 1 60); do
    sleep 0.5
    bridge_probe && { say "✅ $PROC lancé, pont JS actif"; exit 0; }
  done
  say "⚠️  $PROC lancé mais pont pas encore actif (ouvre un onglet)"
  exit 1
fi

BRIDGE_ERR=""
bridge_probe
case $? in
  # --- cas 2 : lancé et déjà flaggé -> on active et on sort ----------------
  0) activate; say "✅ pont JS déjà actif"; exit 0 ;;
  # --- cas 3 : flag absent, CONFIRMÉ -> seul cas qui justifie un redémarrage
  1) ;;
  # --- cas 4 : indéterminé -> on ne ferme surtout pas le navigateur ---------
  *)
    echo "❌ sonde du pont indéterminée, aucun redémarrage." >&2
    echo "   $BRIDGE_ERR" >&2
    echo "   (fenêtre fermée ? relance la commande une fois un onglet ouvert)" >&2
    exit 3
    ;;
esac

say "→ $PROC tourne sans le flag. Il va demander confirmation : clique **Quit**."
say "  (tes onglets sont persistés dans son store, ils reviennent tous)"
osascript -e "tell application \"$PROC\" to quit" >/dev/null 2>&1 &
for _ in $(seq 1 120); do
  pgrep -x "$PROC" >/dev/null || break
  sleep 0.5
done
if pgrep -x "$PROC" >/dev/null; then
  say "→ toujours ouvert, arrêt propre (SIGTERM)..."
  pkill -x -TERM "$PROC"
  for _ in $(seq 1 40); do
    pgrep -x "$PROC" >/dev/null || break
    sleep 0.25
  done
fi
if pgrep -x "$PROC" >/dev/null; then
  echo "❌ $PROC refuse de se fermer" >&2
  exit 1
fi

open -na "$APP" --args "$FLAG"
for _ in $(seq 1 60); do
  sleep 0.5
  bridge_probe && { say "✅ pont JS actif"; exit 0; }
done
echo "⚠️  pont pas actif - ouvre un onglet dans $PROC puis relance ce script" >&2
exit 1
