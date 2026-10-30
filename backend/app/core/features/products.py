"""CRM › Products (the finished-product master) features (module › tab › feature).
See permission_registry.FEATURES. Products moved from Sales into CRM on
2026-10-30 as one tab, `crm:products`; Pricing (country prices inside a
product) is a feature of that tab. `inherit` names the tab action that guards
each feature action, so a role that holds the tab action keeps the access.

Needs the CRM module to declare the "products" tab in permission_registry
(("products", "Products", CRUD)) — register_features asserts it."""
from app.core.permission_registry import _feature, register_features

register_features(
    "crm", "products",
    _feature("specifications", "Technical specifications", "section", {
        "view": "view",
    }, "The Technical specifications table on a product (parameter / value / unit)."),
    _feature("prices", "Prices & sales values", "sensitive", {
        "view": "view",
    }, "Prices on a product page: its country prices. Without it the Pricing section is hidden."),
    _feature("pricing", "Pricing", "section", {
        "view": "view", "create": "create", "edit": "edit", "delete": "delete",
    }, "Country prices inside a product: see them, add (create), change (edit) and remove (delete) a price."),
)
