"""Modules that register reports. Each rollout adds one line here (no main.py edit).
The list is a code constant: nothing here is ever built from user input."""
from __future__ import annotations

import importlib
import logging

PROVIDERS = ["app.modules.erp.reporting", "app.modules.crm.reporting"]

_loaded = False
log = logging.getLogger(__name__)


def load_providers() -> None:
    """Import every provider once (lazily, on the first request)."""
    global _loaded
    if _loaded:
        return
    for name in PROVIDERS:
        try:
            importlib.import_module(name)
        except ModuleNotFoundError as exc:
            if exc.name != name:  # a missing import INSIDE the provider is a real bug
                raise
            log.warning("Reports provider %s is not installed yet; skipped.", name)
    _loaded = True
