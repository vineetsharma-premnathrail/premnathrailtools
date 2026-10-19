"""Design records on the central data scope (core/data_scope.py).

Registered: drawings/documents, BOMs, change requests (ECR), change notices
(ECN), customer submissions and design requests. "Assigned" covers the
people working a record — checker / approver / author of any of its
revisions, change-board members, the lead designer… The library, settings
and lookups are masters and stay organization-wide. Design "My Work" tasks
are Project Management tasks (PM's own records), so they aren't registered
here.

Imported by every Design route module, so registration happens at app
start-up."""
from __future__ import annotations

from sqlalchemy import false, or_, select
from sqlalchemy.orm import object_session

from app.core.data_scope import apply_scope, ensure_in_scope, register_scoped  # noqa: F401  (re-exported for routes)
from app.modules.design.models.bom import DesignBom, DesignBomRevision
from app.modules.design.models.change_notice import DesignChangeNotice
from app.modules.design.models.change_request import DesignChangeRequest, DesignEcrVote
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.models.request import DesignRequest
from app.modules.design.models.submission import DesignCustomerSubmission, DesignSubmissionComment


def _doc_signatory(user):
    """Documents where the user wrote, checks or approves a revision."""
    revs = select(DesignDocumentRevision.document_id).where(
        DesignDocumentRevision.is_deleted == False,  # noqa: E712
        or_(DesignDocumentRevision.created_by_id == user.id, DesignDocumentRevision.reviewer_id == user.id,
            DesignDocumentRevision.approver_id == user.id, DesignDocumentRevision.reviewed_by_id == user.id,
            DesignDocumentRevision.approved_by_id == user.id),
    )
    return DesignDocument.id.in_(revs)


def _bom_signatory(user):
    revs = select(DesignBomRevision.bom_id).where(
        DesignBomRevision.is_deleted == False,  # noqa: E712
        or_(DesignBomRevision.created_by_id == user.id, DesignBomRevision.reviewer_id == user.id,
            DesignBomRevision.approver_id == user.id, DesignBomRevision.reviewed_by_id == user.id,
            DesignBomRevision.approved_by_id == user.id),
    )
    return DesignBom.id.in_(revs)


def _ecr_board(user):
    """ECRs the user sits on the change board of (JSON id list — resolved in
    Python, the table is small) or has voted on."""
    session = object_session(user)
    ids: set[int] = set()
    if session is not None:
        for rid, members in session.query(DesignChangeRequest.id, DesignChangeRequest.board_member_ids).filter(
            DesignChangeRequest.is_deleted == False  # noqa: E712
        ).all():
            if user.id in (members or []):
                ids.add(rid)
    voted = select(DesignEcrVote.ecr_id).where(DesignEcrVote.user_id == user.id)
    return or_(DesignChangeRequest.id.in_(ids) if ids else false(), DesignChangeRequest.id.in_(voted))


def _ecn_acknowledger(user):
    """Released ECNs a user named in Settings as a department acknowledger
    must acknowledge (Production / Purchase / Store / Quality people who
    usually see nothing else in Design)."""
    from app.modules.design.models.setting import DesignSetting

    session = object_session(user)
    row = session.get(DesignSetting, 1) if session is not None else None
    named = row.ecn_acknowledger_ids if row is not None else None
    if not any(user.id in (ids or []) for ids in (named or {}).values()):
        return false()
    return DesignChangeNotice.status.in_(("implemented", "closed"))


def _submission_comment(user):
    """Submissions with a customer comment assigned to the user."""
    return DesignCustomerSubmission.id.in_(
        select(DesignSubmissionComment.submission_id).where(DesignSubmissionComment.assigned_to_id == user.id)
    )


register_scoped(
    DesignDocument, "design", entity_type="design_document", label="drawing / document",
    owner=("owner_id", "created_by_id"), assigned=(_doc_signatory,),
)
register_scoped(
    DesignBom, "design", entity_type="design_bom", label="BOM",
    owner=("owner_id", "created_by_id"), assigned=(_bom_signatory,),
)
register_scoped(
    DesignChangeNotice, "design", entity_type="design_ecn", label="change notice (ECN)",
    owner=("created_by_id",), assigned=("approver_id", "decided_by_id", "implemented_by_id", _ecn_acknowledger),
)
register_scoped(
    DesignChangeRequest, "design", label="change request (ECR)",
    owner=("raised_by_id",), assigned=("impact_checked_by_id", "decided_by_id", _ecr_board),
)
register_scoped(
    DesignCustomerSubmission, "design", label="customer submission",
    owner=("created_by_id",), assigned=("sent_by_id", "recorded_by_id", _submission_comment),
)
register_scoped(
    DesignRequest, "design", label="design request",
    owner=("requested_by_id",), assigned=("lead_designer_id",),
)
