"""Product Management features (module › tab › feature). See
permission_registry.FEATURES. `inherit` names the tab action that guarded
each feature before features existed (keep current access)."""
from app.core.permission_registry import _feature, register_features

register_features(
    "products", "products",
    _feature("specifications", "Technical specifications", "section", {
        "view": "view",
    }, "The Technical specifications table on a product (parameter / value / unit)."),
    _feature("order_book", "Order book", "section", {
        "view": "view",
    }, "The product-wise order book on a product: the Sales order lines of this product (also needs the Sales module)."),
    _feature("quotation_history", "Quotation history", "section", {
        "view": "view",
    }, "The Quotation history on a product: CRM quotations that quoted this product (also needs the CRM module)."),
    _feature("prices", "Prices & sales values", "sensitive", {
        "view": "view",
    }, "Prices on a product page: its price conditions, the order book's unit prices / values and the quoted / list prices "
       "in its quotation history. Without it those columns are blanked."),
)
