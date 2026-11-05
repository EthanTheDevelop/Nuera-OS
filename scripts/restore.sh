#!/bin/sh
# Restaure une sauvegarde de backup.sh. REMPLACE la base et les fichiers de la cible.
# Mode d'emploi : docs/ops/sauvegarde-restauration.md
#
#   restore.sh --from <dossier>        | --from-remote <horodatage|latest>
#              [--verify-only]         contrôle l'archive et s'arrête, cible intacte
#              [--confirm <base>]      nom de la base cible, exigé pour écrire
#
# Mêmes variables que backup.sh : BACKUP_PG_CONTAINER ou DATABASE_URL, BACKUP_STORAGE_DIR,
# et pour --from-remote : BACKUP_REMOTE, BACKUP_NAME.
set -eu
umask 077

SOURCE=""
REMOTE_STAMP=""
VERIFY_ONLY=false
CONFIRM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from) SOURCE="${2:?}"; shift 2 ;;
    --from-remote) REMOTE_STAMP="${2:?}"; shift 2 ;;
    --verify-only) VERIFY_ONLY=true; shift ;;
    --confirm) CONFIRM="${2:?}"; shift 2 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

log() { echo "[$(date -u +%H:%M:%SZ)] $*"; }
die() { echo "ERREUR : $*" >&2; exit 1; }

[ -n "$SOURCE" ] || [ -n "$REMOTE_STAMP" ] || die "--from ou --from-remote requis"
CONTAINER="${BACKUP_PG_CONTAINER:-}"
NAME="${BACKUP_NAME:-nuera-os}"

pg_tool() {
  tool="$1"; shift
  if [ -n "$CONTAINER" ]; then
    docker exec -i "$CONTAINER" sh -c 'tool="$1"; shift; exec "$tool" -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$tool" "$@"
  else
    "$tool" -d "$DATABASE_URL" "$@"
  fi
}

TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
trap 'exit 1' INT TERM

if [ -n "$REMOTE_STAMP" ]; then
  : "${BACKUP_REMOTE:?BACKUP_REMOTE manquant}"
  if [ "$REMOTE_STAMP" = latest ]; then
    REMOTE_STAMP="$(rclone lsf --dirs-only "$BACKUP_REMOTE/$NAME" | tr -d '/' | sort | tail -n 1)"
    [ -n "$REMOTE_STAMP" ] || die "aucune sauvegarde dans $BACKUP_REMOTE/$NAME"
  fi
  log "Récupération : $BACKUP_REMOTE/$NAME/$REMOTE_STAMP"
  SOURCE="$TEMP/source"
  rclone copy "$BACKUP_REMOTE/$NAME/$REMOTE_STAMP" "$SOURCE"
fi

[ -f "$SOURCE/SHA256SUMS" ] || die "pas une sauvegarde : $SOURCE"
# Chemin absolu : plus bas, le contrôle des fichiers se fait depuis un autre dossier.
SOURCE="$(cd "$SOURCE" && pwd)"
log "Contrôle des empreintes"
(cd "$SOURCE" && sha256sum -c SHA256SUMS)
tar -tzf "$SOURCE/storage.tar.gz" > /dev/null
if [ -n "$CONTAINER" ]; then
  docker exec -i "$CONTAINER" pg_restore --list < "$SOURCE/database.dump" > /dev/null
else
  pg_restore --list "$SOURCE/database.dump" > /dev/null
fi
if [ "$VERIFY_ONLY" = true ]; then
  log "Archive saine. Aucune écriture (--verify-only)."
  exit 0
fi

: "${BACKUP_STORAGE_DIR:?BACKUP_STORAGE_DIR manquant}"
[ -d "$BACKUP_STORAGE_DIR" ] || die "dossier de fichiers introuvable : $BACKUP_STORAGE_DIR"
TARGET_DB="$(pg_tool psql -X -A -t -c 'select current_database()' | tr -d '\r')"
[ "$CONFIRM" = "$TARGET_DB" ] || die "écriture refusée : la cible est la base « $TARGET_DB », à confirmer avec --confirm $TARGET_DB"

# Toute la base est rejouée dans une seule transaction : un échec laisse la cible telle quelle.
log "Base : restauration dans $TARGET_DB"
if [ -n "$CONTAINER" ]; then
  docker exec -i "$CONTAINER" pg_restore --no-owner --no-privileges -f - < "$SOURCE/database.dump" > "$TEMP/restore.sql"
else
  pg_restore --no-owner --no-privileges -f - "$SOURCE/database.dump" > "$TEMP/restore.sql"
fi
{
  cat <<'SQL'
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', s);
  END LOOP;
END $$;
CREATE SCHEMA public;
SQL
  cat "$TEMP/restore.sql"
} | pg_tool psql -X -q -v ON_ERROR_STOP=1 --single-transaction > /dev/null

log "Fichiers : restauration dans $BACKUP_STORAGE_DIR"
INCOMING="$BACKUP_STORAGE_DIR/.restore-$$"
mkdir "$INCOMING"
tar -xzpf "$SOURCE/storage.tar.gz" -C "$INCOMING"
# Liste vide (sauvegarde --allow-empty-files) : sha256sum -c la refuserait, rien à contrôler.
check_files() {
  [ ! -s "$SOURCE/files.sha256" ] || (cd "$1" && sha256sum -c "$SOURCE/files.sha256" > /dev/null)
}
check_files "$INCOMING" || {
  rm -rf "$INCOMING"
  die "fichiers extraits non conformes : la base est restaurée, le dossier de fichiers est intact"
}
find "$BACKUP_STORAGE_DIR" -mindepth 1 -maxdepth 1 ! -name ".restore-$$" -exec rm -rf {} +
find "$INCOMING" -mindepth 1 -maxdepth 1 -exec mv {} "$BACKUP_STORAGE_DIR"/ \;
# La racine reprend le propriétaire sauvegardé : sur un volume neuf, l'application n'y écrirait pas.
[ "$(id -u)" != 0 ] || chown "$(stat -c '%u:%g' "$INCOMING")" "$BACKUP_STORAGE_DIR"
rmdir "$INCOMING"
check_files "$BACKUP_STORAGE_DIR"

log "Contrôle des lignes par table"
ROW_COUNTS_SQL="select table_schema || '.' || table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema') order by 1"
pg_tool psql -X -A -t -c "$ROW_COUNTS_SQL" | tr -d '\r' > "$TEMP/row-counts.txt"
if diff "$SOURCE/row-counts.txt" "$TEMP/row-counts.txt" > "$TEMP/row-counts.diff"; then
  log "Lignes conformes : $(wc -l < "$TEMP/row-counts.txt" | tr -d ' ') tables"
else
  log "ATTENTION : écarts de lignes. Normal seulement si des écritures ont croisé la sauvegarde :"
  cat "$TEMP/row-counts.diff"
fi
log "Fichiers conformes : $(wc -l < "$SOURCE/files.sha256" | tr -d ' ')"
log "Restauration terminée. Relancer l'application : les migrations manquantes s'appliqueront."
