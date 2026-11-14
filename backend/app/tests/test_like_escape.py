"""Search boxes: `%` and `_` typed by a user match those characters, not "anything"."""
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, select

from app.core.like import like_escape


def test_like_escape_escapes_wildcards_and_backslash():
    assert like_escape("a_b%c\\d") == "a\\_b\\%c\\\\d"
    assert like_escape(None) == ""
    assert like_escape("plain text") == "plain text"


def test_escaped_search_matches_literally():
    engine = create_engine("sqlite://")
    md = MetaData()
    t = Table("t", md, Column("id", Integer, primary_key=True), Column("name", String))
    md.create_all(engine)
    with engine.begin() as conn:
        conn.execute(t.insert(), [{"name": "Ram Kumar"}, {"name": "PEW_40"}, {"name": "50% advance"}, {"name": "PEWX40"}])

        def search(text):
            q = f"%{like_escape(text)}%"
            return sorted(r.name for r in conn.execute(select(t.c.name).where(t.c.name.ilike(q, escape="\\"))))

        assert search("_") == ["PEW_40"]
        assert search("%") == ["50% advance"]
        assert search("pew_") == ["PEW_40"]  # "_" no longer matches the X in PEWX40
        assert search("ram") == ["Ram Kumar"]
