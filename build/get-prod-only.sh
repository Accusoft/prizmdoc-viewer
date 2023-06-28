#!/bin/bash
set -e

echo "Linux Prizmdoc-Viewer Get Prod Only"

rm -rf node_modules/
rm -f package-lock.json

npm install
