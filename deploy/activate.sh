#!/usr/bin/env bash
set -euo pipefail
APP_ROOT=/www/wwwroot/paper-joy
RELEASE_NAME=${1:?usage: activate.sh RELEASE_NAME}
[[ "$RELEASE_NAME" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,12}$ ]] || { echo 'Invalid release identifier'; exit 2; }
RELEASE="$APP_ROOT/releases/$RELEASE_NAME"
[[ -f "$RELEASE/apps/api/dist/main.js" && -f "$RELEASE/apps/admin/dist/index.html" ]] || { echo 'Release not built'; exit 2; }
cd "$RELEASE"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
export ENV_FILE="$APP_ROOT/shared/.env"
npm run prisma:generate -w @paperjoy/api
bash deploy/backup.sh
npm run db:deploy -w @paperjoy/api
npm run db:seed -w @paperjoy/api
PREVIOUS=$(readlink "$APP_ROOT/current" || true)
ln -sfn "$RELEASE" "$APP_ROOT/current.next"
mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
if pm2 startOrReload "$APP_ROOT/current/deploy/ecosystem.config.cjs" --update-env; then
for i in $(seq 1 30); do
    if curl --fail --silent http://127.0.0.1:4001/health >/dev/null; then
        pm2 save
        echo "$PREVIOUS" > "$APP_ROOT/shared/previous-release"
        echo "Healthy PaperJoy release: $RELEASE_NAME"
        exit 0
    fi
    sleep 1
done
fi
if [[ -n "$PREVIOUS" && "$PREVIOUS" == "$APP_ROOT/releases/"* ]]; then
    ln -sfn "$PREVIOUS" "$APP_ROOT/current.next"
    mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
    pm2 startOrReload "$APP_ROOT/current/deploy/ecosystem.config.cjs" --update-env
else
    pm2 stop paper-joy-api || true
fi
echo 'Health verification failed; application activation rolled back. Database migrations are forward-only.' >&2
exit 1
