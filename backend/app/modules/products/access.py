"""Product Management on the central authorization framework
(docs/02-modules/platform/authorization-architecture.md).

No approvals in this module. Data scope only: the product master's records
are limited by the user's Products data scope (Organization › Role &
Permissions, "Data access") — "own" = products they created; products have no
plant or department column, so plant / department scopes go through the
creator's user row. Product applications are a shared lookup master (the
picker on every product), so they are not scoped.
"""
from app.core.data_scope import register_scoped
from app.modules.products.models.product import FinishedProduct

register_scoped(FinishedProduct, "sales", owner=("created_by_id",), label="product")
