"""Read-only display of a line's PM project unit (PR / PO / GRN lines).

Each line model defines its own order_project_id / order_project_element_id
columns and an `order_project_element` view-only relationship; this mixin
turns that into the fields the API returns for the OrderProjectChip
(see p2p/order_project_links.py for how the link is set)."""
from __future__ import annotations


class OrderProjectLineMixin:
    @property
    def order_project_number(self) -> str | None:
        el = getattr(self, "order_project_element", None)
        return el.project.project_code if el is not None and el.project is not None else None

    @property
    def order_project_element_no(self) -> str | None:
        el = getattr(self, "order_project_element", None)
        return el.element_no if el is not None else None

    @property
    def order_project_element_label(self) -> str | None:
        el = getattr(self, "order_project_element", None)
        return el.label if el is not None else None

    @property
    def order_project_display(self) -> str | None:
        el = getattr(self, "order_project_element", None)
        if el is None or el.project is None:
            return None
        from app.modules.projects.so_projects import element_display
        return element_display(el.project, el)
