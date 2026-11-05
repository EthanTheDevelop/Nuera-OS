#!/bin/sh
# Sauvegarde PostgreSQL + volume de fichiers, copiée hors du serveur par rclone.
# Mode d'emploi : docs/ops/sauvegarde-restauration.md
#
#   backup.sh [--local-only] [--allow-empty-files]
#
# Base (l'une des deux) :
#   BACKUP_PG_CONTAINER   conteneur PostgreSQL local (docker exec, sans mot de passe)
#   DATABASE_URL          sinon, pg_dump et psql du PATH, de version >= à celle du serveur
# Obligatoires :
#   BACKUP_WORK_DIR       dossier local des sauvegardes
#   BACKUP_STORAGE_DIR    dossier des fichiers, chemin vu par ce script
#   BACKUP_REMOTE         destination rclone (sauf --local-only), par exemple nuera-chiffre:sauvegardes
# Facultatives :
#   BACKUP_NAME                   sous-dossier, défaut nuera-os (twenty pour le CRM)
#   BACKUP_REMOTE_RETENTION_DAYS  purge distante, défaut 30, 0 pour ne rien purger
#   BACKUP_LOCAL_KEEP             sauvegardes gardées sur le serveur, défaut 3
#   BACKUP_HEARTBEAT_URL          appelée après un succès complet (sonde « push » d'Uptime Kuma)
set -eu
umask 077

LOCAL_ONLY=false
ALLOW_EMPTY_FILES=false
for argument in "$@"; do
  case "$argument" in
    --local-only) LOCAL_ONLY=true ;;
    --allow-empty-files) ALLOW_EMPTY_FILES=true ;;
    *) echo "Option inconnue : $argument" >&2; exit 2 ;;
  esac
done

log() { echo "[$(date -u +%H:%M:%SZ)] $*"; }
die() { echo "ERREUR : $*" >&2; exit 1; }

: "${BACKUP_WORK_DIR:?BACKUP_WORK_DIR manquant}"
: "${BACKUP_STORAGE_DIR:?BACKUP_STORAGE_DIR manquant}"
NAME="${BACKUP_NAME:-nuera-os}"
RETENTION_DAYS="${BACKUP_REMOTE_RETENTION_DAYS:-30}"
LOCAL_KEEP="${BACKUP_LOCAL_KEEP:-3}"
CONTAINER="${BACKUP_PG_CONTAINER:-}"

[ -n "$CONTAINER" ] || [ -n "${DATABASE_URL:-}" ] || die "BACKUP_PG_CONTAINER ou DATABASE_URL requis"
[ -d "$BACKUP_STORAGE_DIR" ] || die "dossier de fichiers introuvable : $BACKUP_STORAGE_DIR"
if [ "$LOCAL_ONLY" = false ]; then
  [ -n "${BACKUP_REMOTE:-}" ] || die "BACKUP_REMOTE manquant : sans copie distante, utiliser --local-only explicitement"
  command -v rclone >/dev/null 2>&1 || die "rclone introuvable"
fi

pg_tool() {
  # pg_tool <programme> [arguments…] : dans le conteneur ou en local, sur la base configurée.
  tool="$1"; shift
  if [ -n "$CONTAINER" ]; then
    docker exec -i "$CONTAINER" sh -c 'tool="$1"; shift; exec "$tool" -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$tool" "$@"
  else
    "$tool" -d "$DATABASE_URL" "$@"
  fi
}

list_archive() {
  if [ -n "$CONTAINER" ]; then docker exec -i "$CONTAINER" pg_restore --list < "$1"; else pg_restore --list "$1"; fi
}

# Comptage exact par table, relu après restauration par restore.sh.
ROW_COUNTS_SQL="select table_schema || '.' || table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1"

BASE="$BACKUP_WORK_DIR/$NAME"
mkdir -p "$BASE"
LOCK="$BASE/.lock"
mkdir "$LOCK" 2>/dev/null || die "une sauvegarde tourne déjà, ou verrou resté en place : $LOCK"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PARTIAL="$BASE/.partial-$STAMP"
FINAL="$BASE/$STAMP"
cleanup() { rm -rf "$PARTIAL" "$LOCK"; }
trap cleanup EXIT
trap 'exit 1' INT TERM
mkdir "$PARTIAL"

log "Base : pg_dump"
pg_tool pg_dump -Fc > "$PARTIAL/database.dump"
TABLES="$(list_archive "$PARTIAL/database.dump" | grep -c ' TABLE DATA ' || true)"
[ "${TABLES:-0}" -gt 0 ] || die "archive sans aucune table : base vide ou mauvaise cible"
pg_tool psql -X -A -t -c "$ROW_COUNTS_SQL" | tr -d '\r' > "$PARTIAL/row-counts.txt"

log "Fichiers : $BACKUP_STORAGE_DIR"
(
  cd "$BACKUP_STORAGE_DIR"
  # .tmp : dépôts en cours, jamais référencés par la base.
  find . -type f ! -path './.tmp/*' -exec sha256sum {} + > "$PARTIAL/files.sha256"
  tar -czf "$PARTIAL/storage.tar.gz" --exclude=./.tmp .
)
FILES="$(wc -l < "$PARTIAL/files.sha256" | tr -d ' ')"
if [ "$FILES" -eq 0 ] && [ "$ALLOW_EMPTY_FILES" = false ]; then
  die "aucun fichier dans $BACKUP_STORAGE_DIR : volume mal monté ? Sur une installation neuve : --allow-empty-files"
fi
gzip -t "$PARTIAL/storage.tar.gz"

(
  cd "$PARTIAL"
  sha256sum database.dump storage.tar.gz row-counts.txt files.sha256 > SHA256SUMS
)
mv "$PARTIAL" "$FINAL"
log "Archive locale : $FINAL ($TABLES tables, $FILES fichiers)"

if [ "$LOCAL_ONLY" = true ]; then
  log "ATTENTION : --local-only, aucune copie hors du serveur."
else
  TARGET="$BACKUP_REMOTE/$NAME/$STAMP"
  log "Copie distante : $TARGET"
  rclone copy "$FINAL" "$TARGET"
  # --download : relit les octets depuis la destination, y compris sur un distant chiffré.
  rclone check --download --one-way "$FINAL" "$TARGET"
  if [ "$RETENTION_DAYS" -gt 0 ]; then
    rclone delete "$BACKUP_REMOTE/$NAME" --min-age "${RETENTION_DAYS}d"
    rclone rmdirs "$BACKUP_REMOTE/$NAME" --leave-root
  fi
fi

find "$BASE" -mindepth 1 -maxdepth 1 -type d -name '20*Z' | sort -r | tail -n "+$((LOCAL_KEEP + 1))" | while read -r old; do
  rm -rf "$old"
done

if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 20 -o /dev/null "$BACKUP_HEARTBEAT_URL" || die "sauvegarde faite, mais sonde injoignable"
  else
    wget -q -T 20 -O /dev/null "$BACKUP_HEARTBEAT_URL" || die "sauvegarde faite, mais sonde injoignable"
  fi
fi

log "Terminé : $STAMP"
