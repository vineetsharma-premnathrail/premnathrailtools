from app.modules.crm.models.organization import Organization, OrgContact, OrgAddress
from app.modules.crm.models.inquiry import Inquiry, InquiryLineItem, Quotation, QuotationLineItem
from app.modules.crm.models.tender import Tender
from app.modules.crm.models.activity import Activity
from app.modules.crm.models.activity_attachment import ActivityAttachment
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.stage_log import CrmStageLog
from app.modules.crm.models.product import Product
from app.modules.crm.models.payment_term import PaymentTerm
from app.modules.crm.models.document_category import CrmDocumentCategory
from app.modules.crm.models.rnd_request import CrmRndRequest
from app.modules.crm.models.requirement_comment import CrmRequirementComment

__all__ = [
    "Organization",
    "OrgContact",
    "OrgAddress",
    "Inquiry",
    "InquiryLineItem",
    "Quotation",
    "QuotationLineItem",
    "Tender",
    "Activity",
    "ActivityAttachment",
    "CrmDocument",
    "CrmStageLog",
    "Product",
    "PaymentTerm",
    "CrmDocumentCategory",
    "CrmRndRequest",
    "CrmRequirementComment",
]
