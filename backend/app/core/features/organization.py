"""Organization features (module › tab › feature). See permission_registry.FEATURES.

`inherit` names the tab action that guarded each feature action before
features existed, so roles that were never customised keep exactly the
access they had."""
from app.core.permission_registry import _feature, register_features

register_features(
    "organization", "info",
    _feature("statutory", "Legal, registration & tax", "section", {
        "view": "view", "edit": "edit",
    }, "The Legal & Registration and Tax Configuration tabs of Company Info (CIN, PAN, TAN, GSTIN, "
       "registrations, capital, tax set-up). Without View they are blanked for this role."),
    _feature("partners", "Partners", "section", {
        "view": "view", "edit": "edit",
    }, "The Partners tab of Company Info — who is a Partner (the top approval level). Edit changes the list "
       "(nobody but an admin can add or remove themselves)."),
    _feature("financial_years", "Financial years", "section", {
        "view": "view", "edit": "edit",
    }, "The Financial Year tab of Company Info: see, add, change and remove financial years."),
    _feature("documents", "Company documents", "subtab", {
        "view": "view", "create": "edit", "delete": "edit", "export": "view",
    }, "The Documents tab of Company Info: see the list, upload, delete and download / open documents."),
)

register_features(
    "organization", "branches",
    _feature("user_assignments", "Plant › Users", "subtab", {
        "view": "view", "edit": "edit",
    }, "The Branch Users tab of a plant: who works at the plant, and adding / changing / removing them "
       "(a user's own Assignments tab is granted under Users)."),
    _feature("documents", "Plant › Documents", "subtab", {
        "view": "view", "create": "edit", "delete": "edit", "export": "view",
    }, "The Branch Documents tab of a plant: see the list, upload, delete and download documents."),
)

register_features(
    "organization", "users",
    _feature("assignments", "User › Assignments", "subtab", {
        "view": "view", "edit": "edit",
    }, "The Assignments tab of a user: the plants / departments they work in, and changing them."),
    _feature("documents", "User › Documents", "subtab", {
        "view": "view", "create": "edit", "delete": "edit", "export": "view",
    }, "The User Documents tab: see the list, upload, delete and download a user's documents."),
    _feature("login_history", "User › Login history", "subtab", {
        "view": "view",
    }, "The Login History tab of a user: their sessions, devices and sign-ins."),
    _feature("activity", "User › Activity & permission history", "subtab", {
        "view": "view",
    }, "The User Activity and Permission History tabs of a user."),
)

register_features(
    "organization", "roles",
    _feature("members", "Role users / user roles", "subtab", {
        "view": "view", "edit": "edit",
    }, "The Users tab of a role and the Roles part of a user's Roles & Permissions tab: see who holds a role, "
       "and add / remove holders (self-changes and admins stay protected)."),
    _feature("extra_permissions", "Extra permissions of a user", "section", {
        "view": "view", "edit": "edit",
    }, "The Extra permissions block of a user's Roles & Permissions tab: grants given to one person on top of their roles."),
    _feature("data_access", "Data access (scope)", "subtab", {
        "view": "view", "edit": "edit",
    }, "The Data access tab of a role and of a user: how much data (own / department / plant / all) they see per module."),
    _feature("notifications", "Notifications", "subtab", {
        "view": "view", "edit": "edit",
    }, "The Notifications tab of a role: which events its holders are told about, and on which channels."),
)

register_features(
    "organization", "workflows",
    _feature("simulate", "Preview & check a workflow", "action", {
        "view": "view",
    }, "Run a workflow as a chosen requester (Preview) and dry-run an edited workflow (Check)."),
    _feature("reset", "Reset to default", "action", {
        "view": "view", "edit": "edit",
    }, "Throw away a workflow's customisation and go back to the built-in stages."),
    _feature("history", "Change history", "subtab", {
        "view": "view",
    }, "Who changed a workflow, when, and what changed."),
)
