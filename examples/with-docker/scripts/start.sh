#!/usr/bin/env bash

#DATABASE_URL is set in docker-compose.yml
DIR="$(cd "$(dirname "$0")" && pwd)"
echo '🟡 - Waiting for database to be ready...'
$DIR/wait-for-it.sh "${DATABASE_URL}" -t 5 -- echo '🟢 - Database is ready!'
npx ponder start
