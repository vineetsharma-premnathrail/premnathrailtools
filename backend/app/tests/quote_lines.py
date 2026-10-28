"""Quotation lines are chosen from the Product master (Product + one of its Applications).
Tests that create quotations seed one product with one application and put
`LINE_REF` on each line. The test DB is rebuilt per test, so the product is id 1 and its application id 2."""
import pytest

from app.modules.products.models.product import FinishedProduct

LINE_REF = {"product_id": 1, "application_id": 2}


def seed_quote_product(db, *, status: str = "active", applications=("Heavy lifting",)) -> FinishedProduct:
    """Product id 1; then one Product-master row of type 'application' per name (first one is id 2).
    An application is a products row with product_type='application'."""
    p = FinishedProduct(code="P-QT-1", name="RRV Mobile Crane", product_type="vehicle", model_number="RRV-MC", status=status)
    db.add(p)
    db.flush()
    for i, name in enumerate(applications, start=1):
        db.add(FinishedProduct(code=f"APP-T{i}", name=name, product_type="application"))
    db.commit()
    return p


@pytest.fixture(autouse=True)
def quote_product(db):
    """Import this fixture into a quotation test module: every test there gets product 1 + application 1."""
    return seed_quote_product(db)
