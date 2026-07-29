from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.models.inquiry import Inquiry, InquiryTask, InquiryApproval, Quotation
from app.modules.crm.models.tender import Tender, TenderTask, TenderCompetitor
from app.modules.crm.models.purchase_order import PurchaseOrder
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.note import Note
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.discussion import CrmDiscussion
from app.modules.crm.models.stage_log import CrmStageLog

__all__ = [
    "Organization",
    "OrgContact",
    "Inquiry",
    "InquiryTask",
    "InquiryApproval",
    "Quotation",
    "Tender",
    "TenderTask",
    "TenderCompetitor",
    "PurchaseOrder",
    "Activity",
    "Note",
    "CrmDocument",
    "CrmDiscussion",
    "CrmStageLog",
]
