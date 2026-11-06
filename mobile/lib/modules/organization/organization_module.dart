import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import '../../ui/perms.dart';
import 'access_reviews_tab.dart';
import 'access_risk_tab.dart';
import 'audit_logs_tab.dart';
import 'branches_tab.dart';
import 'cockpit_tab.dart';
import 'delegations_tab.dart';
import 'department_tab.dart';
import 'info_tab.dart';
import 'monitor_tab.dart';
import 'org_common.dart';
import 'roles_tab.dart';
import 'security_tab.dart';
import 'users_tab.dart';
import 'workflows_tab.dart';

/// Organization - native copy of frontend/src/app/dashboard/organization/
/// (OrganizationNav tabs, same order and labels). My Approvals is its own
/// menu entry in the portal (/dashboard/approvals), not a tab here.
class OrganizationModuleHome extends StatelessWidget {
  const OrganizationModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  Widget build(BuildContext context) => ModuleScaffold(module: module, tabs: [
        ModuleTab(
            label: 'Info',
            icon: Icons.business_outlined,
            visible: orgTabVisible('info'),
            builder: (_) => const OrgInfoTab()),
        ModuleTab(
            label: 'Branches',
            icon: Icons.map_outlined,
            visible: orgTabVisible('branches'),
            builder: (_) => const OrgBranchesTab()),
        ModuleTab(
            label: 'Department',
            icon: Icons.grid_view_outlined,
            visible: orgTabVisible('department'),
            builder: (_) => const OrgDepartmentTab()),
        ModuleTab(
            label: 'Users',
            icon: Icons.people_outline_rounded,
            visible: orgTabVisible('users'),
            builder: (_) => const OrgUsersTab()),
        ModuleTab(
            label: 'Role & Permissions',
            icon: Icons.verified_user_outlined,
            visible: orgTabVisible('roles'),
            builder: (_) => const OrgRolesTab()),
        ModuleTab(
            label: 'Approval Workflows',
            icon: Icons.account_tree_outlined,
            visible: orgTabVisible('workflows'),
            builder: (_) => const OrgWorkflowsTab()),
        ModuleTab(
            label: 'Delegations',
            icon: Icons.swap_horiz_rounded,
            visible: orgTabVisible('delegations'),
            builder: (_) => const OrgDelegationsTab()),
        ModuleTab(
            label: 'Security & Sessions',
            icon: Icons.lock_outline_rounded,
            visible: orgTabVisible('security'),
            builder: (_) => const OrgSecurityTab()),
        ModuleTab(
            label: 'Audit Logs',
            icon: Icons.history_rounded,
            visible: orgTabVisible('audit_logs'),
            builder: (_) => const OrgAuditLogsTab()),
        ModuleTab(
            label: 'Access Reviews',
            icon: Icons.check_box_outlined,
            visible: orgTabVisible('access_reviews'),
            builder: (_) => const OrgAccessReviewsTab()),
        ModuleTab(
            label: 'Access Risk (SoD)',
            icon: Icons.warning_amber_rounded,
            visible: orgTabVisible('grc'),
            builder: (_) => const OrgAccessRiskTab()),
        ModuleTab(
            label: 'System Monitor',
            icon: Icons.monitor_heart_outlined,
            visible: orgTabVisible('monitor'),
            builder: (_) => const OrgMonitorTab()),
        ModuleTab(
            label: 'Cockpit',
            icon: Icons.speed_rounded,
            // Partners open Cockpit without the permission, as on the portal page.
            visible: orgTabVisible('cockpit') || Perm.user['is_partner'] == true,
            builder: (_) => const OrgCockpitTab()),
      ]);
}
