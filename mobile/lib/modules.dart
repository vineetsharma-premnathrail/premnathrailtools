import 'package:flutter/material.dart';

/// One ERP module, as the portal shows it in the sidebar (menu) and on the
/// Dashboard cards. Titles, descriptions, colours and order come from
/// frontend/src/components/Sidebar.tsx and frontend/src/app/dashboard/page.tsx -
/// keep them in step.
class ErpModule {
  const ErpModule({
    required this.key,
    required this.menuLabel,
    required this.title,
    required this.description,
    required this.icon,
    required this.color,
    required this.visibleFor,
    this.upcoming = false,
  });

  /// Same key as the portal route: `/dashboard/<key>`.
  final String key;

  /// Name in the menu (sidebar).
  final String menuLabel;

  /// Name on the Dashboard card.
  final String title;
  final String description;
  final IconData icon;

  /// Card icon colour; its 12% tint is the icon background.
  final Color color;

  /// Portal's "upcoming modules" group (planned roll-out).
  final bool upcoming;

  /// Who sees it: the portal sidebar rule, fed by /auth/me.
  final bool Function(Map<String, dynamic> user) visibleFor;
}

List<String> _strings(Object? v) => v is List ? v.whereType<String>().toList() : const [];

bool Function(Map<String, dynamic>) _app(String app) => (u) => _strings(u['apps']).contains(app);

bool _isAdmin(Map<String, dynamic> u) => u['role'] == 'admin';

/// Every module in portal order: live modules first, then the upcoming ones.
final erpModules = <ErpModule>[
  ErpModule(
    key: 'erp',
    menuLabel: 'Service Module',
    title: 'Service Module',
    description: 'Machines at customer sites, service requests, engineer visits, service contracts and warranty tracking.',
    icon: Icons.work_outline_rounded,
    color: Color(0xFFE85A1F),
    visibleFor: _app('erp'),
  ),
  ErpModule(
    key: 'rnd',
    menuLabel: 'R&D',
    title: 'R&D',
    description: 'R&D projects, experiments & test data, prototypes, feasibility, and railway engineering calculators.',
    icon: Icons.science_outlined,
    color: Color(0xFF2563EB),
    visibleFor: _app('rnd'),
  ),
  ErpModule(
    key: 'crm',
    menuLabel: 'CRM',
    title: 'CRM',
    description: 'Customer relationship management, leads, contacts, deals, and organizations.',
    icon: Icons.group_outlined,
    color: Color(0xFF059669),
    visibleFor: _app('crm'),
  ),
  ErpModule(
    key: 'p2p',
    menuLabel: 'Procurement',
    title: 'Procurement',
    description: 'Purchase requisitions, vendors, RFQs and purchase orders — raise, approve and track every buy.',
    icon: Icons.description_outlined,
    color: Color(0xFF0284C7),
    visibleFor: _app('p2p'),
  ),
  ErpModule(
    key: 'store',
    menuLabel: 'Store & Inventory',
    title: 'Store & Inventory',
    description: 'Item master, stores, stock ledger, issues, returns, transfers, and reservations.',
    icon: Icons.storefront_outlined,
    color: Color(0xFF9333EA),
    visibleFor: _app('store'),
  ),
  ErpModule(
    key: 'projects',
    menuLabel: 'Project Management',
    title: 'Project Management',
    description: 'Project workspaces — scope, planning, tasks, budget, risks, and closure.',
    icon: Icons.view_kanban_outlined,
    color: Color(0xFF4F46E5),
    visibleFor: _app('projects'),
  ),
  ErpModule(
    key: 'finance',
    menuLabel: 'Finance & Accounting',
    title: 'Finance & Accounting',
    description: 'GL, journal entries, accounts payable/receivable, period close, banking, and financial reports.',
    icon: Icons.currency_rupee_rounded,
    color: Color(0xFFD97706),
    visibleFor: _app('accounts'),
  ),
  // Not an app: admins and anyone who can view one of its tabs.
  ErpModule(
    key: 'organization',
    menuLabel: 'Organization',
    title: 'Organization',
    description: 'Company info, branches and departments, users, roles & permissions, approval workflows and audit logs.',
    icon: Icons.apartment_outlined,
    color: Color(0xFF475569),
    visibleFor: (u) =>
        _isAdmin(u) ||
        _strings(u['permissions']).any((p) => p.startsWith('organization:') && p.endsWith(':view')),
  ),
  ErpModule(
    key: 'production',
    menuLabel: 'Production',
    title: 'Production',
    description: 'BOM & routing, work orders, shop-floor bookings, material planning, and production cost.',
    icon: Icons.factory_outlined,
    color: Color(0xFF475569),
    visibleFor: _app('production'),
    upcoming: true,
  ),
  // Production supervisors raise breakdowns without holding the maintenance app.
  ErpModule(
    key: 'maintenance',
    menuLabel: 'Maintenance',
    title: 'Maintenance',
    description: 'Plant equipment register, breakdown requests, maintenance work orders, spares issue and downtime tracking.',
    icon: Icons.build_outlined,
    color: Color(0xFFB45309),
    visibleFor: (u) => _app('maintenance')(u) || _app('production')(u),
    upcoming: true,
  ),
  ErpModule(
    key: 'electrical',
    menuLabel: 'Electrical',
    title: 'Electrical',
    description: 'RRV electrical creation — requirement, design, BOM, wiring, panels, testing, QC, commissioning and handover.',
    icon: Icons.bolt_outlined,
    color: Color(0xFFCA8A04),
    visibleFor: _app('electrical'),
    upcoming: true,
  ),
  ErpModule(
    key: 'hydraulic',
    menuLabel: 'Hydraulic & Pneumatic',
    title: 'Hydraulic & Pneumatic',
    description: 'Hydraulic and pneumatic systems — component master, circuits, BOM, calculations, testing, maintenance and spares.',
    icon: Icons.water_drop_outlined,
    color: Color(0xFF0369A1),
    visibleFor: _app('hydraulic'),
    upcoming: true,
  ),
  ErpModule(
    key: 'hr',
    menuLabel: 'HR & Admin',
    title: 'HR & Administration',
    description: 'My HR self-service, approvals, employees, lifecycle, leave, attendance, assets, visitors, travel & claims.',
    icon: Icons.badge_outlined,
    color: Color(0xFFDB2777),
    visibleFor: _app('hr'),
    upcoming: true,
  ),
  ErpModule(
    key: 'quality',
    menuLabel: 'Quality',
    title: 'Quality',
    description: 'Standards, checklists, inspection plans, and incoming/in-process/final inspections.',
    icon: Icons.verified_user_outlined,
    color: Color(0xFF0D9488),
    visibleFor: _app('quality'),
    upcoming: true,
  ),
  ErpModule(
    key: 'design',
    menuLabel: 'Design',
    title: 'Design',
    description: 'Controlled engineering drawings and documents — revisions, check & approval sign-off, and change notices.',
    icon: Icons.edit_outlined,
    color: Color(0xFF4F46E5),
    visibleFor: _app('design'),
    upcoming: true,
  ),
];

List<ErpModule> modulesFor(Map<String, dynamic> user) =>
    erpModules.where((m) => m.visibleFor(user)).toList();
