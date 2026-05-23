set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    @just --list

verify:
    npm run ci

doctor:
    npm run check:env

actions:
    actionlint

security-audit:
    osv-scanner scan source --allow-no-lockfiles --lockfile 'package-lock.json'

security:
    just actions
    just security-audit
