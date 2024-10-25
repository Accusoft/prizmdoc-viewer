#!/bin/bash
set -ex

docker run --rm --user $(id -u) -e NPM_CONFIG_REGISTRY --volume=$(pwd):/app --workdir=/app node:16.19.1-bullseye $@
