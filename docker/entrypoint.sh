#!/bin/sh
set -eu

node /app/dist/ensure-sqlite-db.mjs
node /app/node_modules/prisma/build/index.js migrate deploy --config /app/prisma.config.ts
exec node /app/.output/server/index.mjs
