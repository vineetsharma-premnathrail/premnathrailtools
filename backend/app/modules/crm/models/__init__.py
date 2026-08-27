from app.modules.crm.models.organization import Organization, OrgContact
from app.modules.crm.models.inquiry import Inquiry, InquiryTask, InquiryApproval, Quotation, QuotationLineItem
from app.modules.crm.models.tender import Tender, TenderTask, TenderCompetitor
from app.modules.crm.models.purchase_order import PurchaseOrder
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.activity_attachment import ActivityAttachment
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.discussion import CrmDiscussion
from app.modules.crm.models.stage_log import CrmStageLog
from app.modules.crm.models.product import Product
from app.modules.crm.models.payment_term import PaymentTerm

__all__ = [
    "Organization",
    "OrgContact",
    "Inquiry",
    "InquiryTask",
    "InquiryApproval",
    "Quotation",
    "QuotationLineItem",
    "Tender",
    "TenderTask",
    "TenderCompetitor",
    "PurchaseOrder",
    "Activity",
    "ActivityAttachment",
    "CrmDocument",
    "CrmDiscussion",
    "CrmStageLog",
    "Product",
    "PaymentTerm",
]
