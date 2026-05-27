set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    @just --list

verify:
    npm run ci

doctor:
    npm run check:env

credentials:
    @if [ -x "$HOME/.local/bin/codex-jamarq" ]; then \
        "$HOME/.local/bin/codex-jamarq" --jamarq-env-check; \
    else \
        echo "Missing $HOME/.local/bin/codex-jamarq"; \
        exit 1; \
    fi

actions:
    actionlint

security-audit:
    osv-scanner scan source --allow-no-lockfiles --lockfile 'package-lock.json'

security:
    just actions
    just security-audit
