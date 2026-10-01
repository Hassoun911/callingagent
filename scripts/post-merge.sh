#!/bin/bash
set -e
pnpm install
pnpm --filter @workspace/db run push
node scripts/apply-phone-rec-bridge.mjs
