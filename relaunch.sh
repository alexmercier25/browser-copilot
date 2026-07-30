#!/bin/bash
# Relance Dia avec le flag qui autorise l'exécution de JS via AppleScript.
# Dia affiche un dialogue de confirmation à la fermeture -> clique "Quit".
# Les onglets sont persistés dans son propre store (StorableProfileContainers.json),
# ils reviennent après le redémarrage.
set -uo pipefail

APP="${CC_BROWSER_APP:-/Applications/Dia.app}"
PROC="$(basename "$APP" .app)"
FLAG="--enable-applescript-javascript"

# Déjà en place ? on ne touche à rien.
if osascript -e "tell application \"$PROC\" to execute active tab of front window javascript \"1\"" >/dev/null 2>&1; then
  echo "✅ pont JS déjà actif, rien à faire"
  exit 0
fi

if pgrep -x "$PROC" >/dev/null; then
  echo "→ $PROC va demander confirmation : clique **Quit** (tes onglets reviennent)."
  osascript -e "tell application \"$PROC\" to quit" >/dev/null 2>&1 &
  for _ in $(seq 1 120); do   # 60 s pour répondre au dialogue
    pgrep -x "$PROC" >/dev/null || break
    sleep 0.5
  done
  if pgrep -x "$PROC" >/dev/null; then
    echo "→ toujours ouvert, arrêt propre (SIGTERM)..."
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
fi

open -na "$APP" --args "$FLAG"
echo "→ relancé avec $FLAG"

for _ in $(seq 1 60); do
  sleep 0.5
  if osascript -e "tell application \"$PROC\" to execute active tab of front window javascript \"1\"" >/dev/null 2>&1; then
    echo "✅ pont JS actif"
    exit 0
  fi
done
echo "⚠️  pont pas actif - ouvre un onglet dans $PROC puis relance ce script" >&2
exit 1
