"""same_value / changed: a form sending "" for an untouched empty field is not a change."""

from datetime import date, datetime
from decimal import Decimal

from app.utils.value_diff import changed, same_value


def test_blank_values_are_equal():
    for a in (None, "", "   ", [], {}):
        for b in (None, "", "  ", [], {}):
            assert same_value(a, b), (a, b)


def test_blank_vs_value_is_a_change():
    assert changed(None, "Bearing")
    assert changed("Bearing", "")
    assert changed(None, 0)
    assert changed(None, False)


def test_numbers_compare_by_amount():
    assert same_value(Decimal("5.00"), 5)
    assert same_value(5.0, "5")
    assert changed(Decimal("5.00"), 5.5)


def test_text_codes_stay_text():
    assert changed("007", "7")


def test_dates_compare_by_iso_text():
    assert same_value(date(2026, 9, 14), "2026-09-14")
    assert same_value(datetime(2026, 9, 14, 10, 0), "2026-09-14T10:00:00")
    assert changed(date(2026, 9, 14), "2026-09-15")


def test_whitespace_and_bools():
    assert same_value(" Open ", "Open")
    assert same_value(True, "True")
    assert changed(True, False)
