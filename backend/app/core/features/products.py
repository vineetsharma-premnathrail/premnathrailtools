"""Sales › Products (Product Management) features (module › tab › feature). See
permission_registry.FEATURES. `inherit` names the tab action that guarded
each feature before features existed (keep current access)."""
from app.core.permission_registry import _feature, register_features

register_features(
    "sales", "products",
    _feature("specifications", "Technical specifications", "section", {
        "view": "view",
    }, "The Technical specifications table on a product (parameter / value / unit)."),
    _feature("prices", "Prices & sales values", "sensitive", {
        "view": "view",
    }, "Prices on a product page: its country prices. Without it the Pricing section is hidden."),
)
