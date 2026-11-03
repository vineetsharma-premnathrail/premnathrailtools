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

# UI visibility per role (core/visibility.py): what a member of a role sees on the
# New / Edit Product form (applications use the same form), the product page and the
# products list. Type and status values are the coded ones (PRODUCT_TYPE_LABELS /
# PRODUCT_STATUS_LABELS); a value a role does not allow is also refused by the server
# (products/routes/products.py) and /products/meta marks every value with `allowed`.
# Prices are not offered here: they stay behind the "Prices & sales values" switch.
from app.core.visibility import register_visibility  # noqa: E402
from app.modules.products.models.product import PRODUCT_STATUS_LABELS, PRODUCT_TYPE_LABELS  # noqa: E402

register_visibility(
    "crm", "products",
    label="Products — form, page & list",
    screens=(("form", "Product form"), ("detail", "Product page"), ("list", "Products list")),
    sections=(
        # New / Edit Product form (components/products/ProductForm.tsx)
        ("product", "Product", "Product or application, code, name, type, model number and status.", True, "form"),
        ("description", "Description", "Short description (for quotations) and the detailed description.", False, "form"),
        ("technical_specifications", "Technical specifications", "The free-text specification lines.", False, "form"),
        ("pricing", "Pricing",
         "The list price typed on a new product / the price table on an edited one. Who may open it is still set by the Pricing feature; this only hides the section on screen.",
         False, "form"),
        ("sales_defaults", "Sales & service defaults", "Unit, HSN code, warranty months and the finished-good store item.", False, "form"),
        # Product page (dashboard/products/[id])
        ("detail_summary", "Product summary", "Name, short description, status, code, type and who created it.", True, "detail"),
        ("detail_master_data", "Master data", "Model number, unit, HSN code, warranty and the linked store item.", False, "detail"),
        ("detail_description", "Description", "The detailed description.", False, "detail"),
        ("detail_specifications", "Technical specifications",
         "The specification lines. Access is still set by the Technical specifications feature; this only hides the block on screen.",
         False, "detail"),
    ),
    options=(
        ("product_type", "Type", dict(PRODUCT_TYPE_LABELS),
         "Rail-road vehicle / Machine / Equipment / Attachment / Paid service / Application. Leaving out Application removes the "
         "'Application' choice on the form. A value not allowed here is also refused by the server.", "form"),
        ("status", "Status", dict(PRODUCT_STATUS_LABELS),
         "Lifecycle status offered on the form (In development / Active / Phased out / Discontinued). A saved product keeps its status "
         "when edited; a new product must take an allowed value.", "form"),
    ),
    tables=(
        ("products", "Products list", {"type": "Type", "model": "Model"}, "list"),
    ),
)
