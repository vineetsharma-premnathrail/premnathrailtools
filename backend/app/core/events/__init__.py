"""Notifiable events, one file per module: each calls
notification_events.register_event(...) at import time. Admins subscribe
roles to them in Organization › Roles › Notifications."""
import importlib
import pkgutil

for _m in pkgutil.iter_modules(__path__):
    importlib.import_module(f"{__name__}.{_m.name}")
