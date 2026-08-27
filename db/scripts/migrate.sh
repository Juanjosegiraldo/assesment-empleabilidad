#!/usr/bin/env bash
#
# Applies every migration in db/migrations, in filename order.
#
# Migrations are written to be idempotent (create ... if not exists), so rerunning
# this script on an existing database is safe. That keeps the setup to a single
# documented command, which is what the assessment asks for.
#
# Usage: npm run db:migrate
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

if [ -f .env ]; then
    # shellcheck disable=SC1091
    set -a && . ./.env && set +a
fi

: "${DATABASE_ADMIN_URL:?not set. Copy .env.example to .env and fill it in.}"
: "${APP_DB_PASSWORD:?not set. Copy .env.example to .env and fill it in.}"

for migration in db/migrations/*.sql; do
    echo "--> ${migration}"
    # ON_ERROR_STOP makes psql exit non zero on the first failing statement, so a
    # broken migration stops the run instead of leaving a half applied schema.
    psql "$DATABASE_ADMIN_URL" \
        --no-psqlrc \
        --quiet \
        -v ON_ERROR_STOP=1 \
        -v app_password="$APP_DB_PASSWORD" \
        -f "$migration"
done

echo "migrations applied"
