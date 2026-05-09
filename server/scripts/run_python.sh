#!/usr/bin/env bash
# AdGuru AI — Python runner wrapper
# Unsets PYTHONHOME and PYTHONPATH so python3.11 uses its own clean stdlib
# and is not hijacked by the uv-managed Python 3.13 environment.
unset PYTHONHOME
unset PYTHONPATH
exec /usr/bin/python3.11 "$@"
