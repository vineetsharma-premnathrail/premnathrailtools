"""Shared reports framework (see registry.py for the interface)."""
from __future__ import annotations

from app.core.reporting.features import management_feature
from app.core.reporting.registry import (
    NONE_TOKEN, DashboardDef, DashboardPage, DateField, DetailColumn, Dimension, FilterDef, Measure, ReportChart, ReportColumn,
    VisualSpec, module_dashboards, register_dashboard,
    ReportCtx, ReportDataset, ReportDef, ReportFilter, ReportKpi, ReportResult,
    get_dataset, get_report, module_reports, register_dataset, register_report, token,
)

__all__ = [
    "NONE_TOKEN", "DashboardDef", "DashboardPage", "VisualSpec", "module_dashboards", "register_dashboard", "DateField", "DetailColumn", "Dimension", "FilterDef", "Measure", "ReportChart",
    "ReportColumn", "ReportCtx", "ReportDataset", "ReportDef", "ReportFilter", "ReportKpi",
    "ReportResult", "get_dataset", "get_report", "module_reports", "register_dataset",
    "register_report", "token", "management_feature",
]
