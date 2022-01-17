#! /bin/bash
set -e
. ~/.nvm/nvm.sh

echo "Linux Prizmdoc-Viewer Build"

NVM_VERSION=16.13.2

nvm install $NVM_VERSION
nvm use $NVM_VERSION

npm install
npm run build
