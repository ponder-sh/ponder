#!/usr/bin/env bash

set -eoux pipefail

echo "Removing all node_modules directories..."
find . -name 'node_modules' -exec rm -rf {} \;

echo "Removing all dist directories..."
find . -name 'dist' -exec rm -rf {} \;

echo "Removing all .ponder directories..."
find . -name '.ponder' -exec rm -rf {} \;

echo "Removing all generated directories (except ones inside './benchmarks')..."
find . -path './benchmarks' -prune -o -name 'generated' -exec rm -rf {} \;

echo "Removing all .eslintcache directories..."
find . -name '.eslintcache' -exec rm -rf {} \;

echo "Removing all .next files..."
find . -name '.next' -exec rm -rf {} \;

echo "Done."
