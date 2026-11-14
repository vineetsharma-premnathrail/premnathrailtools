"""Direct-notification catalog for CRM › Knowledge Hub (see direct_rnd_crm_projects.py).

A share names its recipients in the code; a role's Notifications tab only
picks the channels. Information-type, so bell by default.
"""
from app.core.notification_events import register_direct

register_direct(
    "crm", "crm_library_share", "Knowledge Hub file shared with you",
    "The colleague the file is shared with",
    "someone shares a Knowledge Hub file with you",
    default_channels=("bell",), kind="info",
)
