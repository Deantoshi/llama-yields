#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/home/ddean/llama-yields"
NODE_BIN="/home/ddean/.nvm/versions/node/v20.5.0/bin/node"

cd "$REPO_ROOT"
"$NODE_BIN" backend/src/cli.js sync
