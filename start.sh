#!/bin/sh
set -e

echo "=== Shipinfy Metrics — démarrage ==="

echo "[1/3] Création/mise à jour des tables..."
./node_modules/.bin/prisma db execute --file prisma/init-tables.sql --schema prisma/schema.prisma
echo "      Tables OK"

echo "[2/3] Démarrage de l'app..."
echo "      Port : $PORT"
echo "      NODE_ENV : $NODE_ENV"

echo "[3/3] Lancement du serveur Next.js..."
node server.js
