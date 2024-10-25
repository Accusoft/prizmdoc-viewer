@echo off

call docker run --rm -e NPM_CONFIG_REGISTRY --volume=%cd%:/app --workdir=/app node:16.19.1-bullseye %*