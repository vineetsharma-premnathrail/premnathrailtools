from __future__ import annotations
from sqlalchemy import Integer, String, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON
from app.db.base import Base
from app.db.mixins import TimestampMixin

# JSONB on Postgres, plain JSON on SQLite (tests).
JSONList = JSON().with_variant(JSONB(), "postgresql")

# designer: drafts, own tasks, raises ECRs. reviewer: can also be named
# checker. head: releases, customer submissions, chairs the change board,
# Settings. Anyone with the Design app who isn't on the team is a viewer
# from another department — released revisions only.
DESIGN_TEAM_ROLES = ("designer", "reviewer", "head")


class DesignSetting(Base, TimestampMixin):
    """Single-row Design configuration (row id 1). Plain values the Design
    head tunes — never field/form/workflow definitions (see the 2026-09-18
    no-metadata decision): those stay in code."""

    __tablename__ = "design_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Days a customer submission may wait for a response before it's overdue.
    customer_response_days: Mapped[int] = mapped_column(Integer, default=14, server_default="14", nullable=False)
    # Days a revision may sit with its checker/approver before it's overdue.
    review_overdue_days: Mapped[int] = mapped_column(Integer, default=7, server_default="7", nullable=False)
    # Default approver pre-filled on new documents/BOMs (normally the Design head).
    default_approver_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # Change board: user ids who vote on every ECR (Production, Quality,
    # Purchase representatives). The Design head chairs and decides.
    change_board_member_ids: Mapped[list[int] | None] = mapped_column(JSONList, nullable=True, default=list)
    # Who gets ECN release notices and must acknowledge them, per department.
    # {"production": [user ids], "purchase": [...], "store": [...], "quality": [...]}
    ecn_acknowledger_ids: Mapped[dict | None] = mapped_column(JSONList, nullable=True, default=dict)
    updated_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class DesignTeamMember(Base, TimestampMixin):
    """Who is on the Design team and in what role. Empty team = not set up
    yet, and then everyone holding the Design app is treated as a designer
    (so the module works before Settings is filled in)."""

    __tablename__ = "design_team_members"
    __table_args__ = (UniqueConstraint("user_id", name="uq_design_team_member_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="designer", nullable=False)
