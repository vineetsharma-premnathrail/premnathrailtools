"""Feature declarations (the third permission level: module › tab › feature),
one file per module. Each file calls permission_registry.register_features
at import time; this package imports them all. See permission_registry.FEATURES."""
import importlib
import pkgutil

for _m in pkgutil.iter_modules(__path__):
    importlib.import_module(f"{__name__}.{_m.name}")
