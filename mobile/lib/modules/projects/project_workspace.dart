import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'history_tabs.dart';
import 'machine_form.dart';
import 'machine_screen.dart';
import 'pm_common.dart';
import 'project_plan.dart';

/// One project - frontend/src/app/dashboard/projects/[id]/ProjectWorkspace.tsx:
/// header (code, stage, lifecycle actions) and the tabs Overview, Milestones,
/// Units, Store Issues, Purchases, Tasks, Documents, History.
class ProjectWorkspaceScreen extends StatefulWidget {
  const ProjectWorkspaceScreen({super.key, required this.projectId, this.title, this.initialTab});
  final int projectId;
  final String? title;
  final String? initialTab;

  @override
  State<ProjectWorkspaceScreen> createState() => _ProjectWorkspaceScreenState();
}

class _ProjectWorkspaceScreenState extends State<ProjectWorkspaceScreen> {
  Json? _p;
  Object? _error;
  late String _tab = widget.initialTab ?? 'Overview';
  bool _busy = false;
  int _reloadKey = 0;

  static const _all = ['Overview', 'Milestones', 'Units', 'Store Issues', 'Purchases', 'Tasks', 'Documents', 'History'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = obj(await Api.get('/projects/${widget.projectId}'));
      if (mounted) {
        setState(() {
          _p = d;
          _error = null;
          _reloadKey++;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  List<String> get _visibleTabs => _all.where((t) {
        switch (t) {
          case 'Milestones':
            return Perm.canFeature('projects', 'overview', 'milestones', 'view');
          case 'Units':
            return Perm.canFeature('projects', 'overview', 'units', 'view');
          case 'Store Issues':
            return Perm.canFeature('projects', 'project_history', 'store_issues', 'view');
          case 'Purchases':
            return Perm.canFeature('projects', 'project_history', 'purchases', 'view');
          case 'Tasks':
            return Perm.canFeature('projects', 'project_history', 'task_history', 'view');
          case 'Documents':
            return Perm.can('projects', 'documents', 'view');
          case 'History':
            return Perm.can('projects', 'project_history', 'view');
          default:
            return Perm.can('projects', 'overview', 'view');
        }
      }).toList();

  Future<void> _transition(String action, String label, String confirm) async {
    final ok = await confirmDialog(context, title: label, message: confirm, confirmLabel: label);
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    await runAction(context, () => Api.post('/projects/${widget.projectId}/transition', data: {'action': action}));
    if (mounted) setState(() => _busy = false);
    _load();
  }

  Future<void> _delete(Json p) async {
    final ok = await confirmDialog(context,
        title: 'Delete this project?',
        message: 'Delete ${p['project_code']}? It has no milestones yet, so nothing else is lost.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/projects/${widget.projectId}'), success: 'Project deleted.') && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    return SubPage(
      title: p == null ? (widget.title ?? 'Project') : txt(p['project_code']),
      body: p == null
          ? (_error == null ? const LoadingView() : ErrorView(_error!, onRetry: _load))
          : RefreshIndicator(onRefresh: _load, child: _body(p)),
    );
  }

  Widget _body(Json p) {
    final tabs = _visibleTabs;
    final tab = tabs.contains(_tab) ? _tab : (tabs.isEmpty ? null : tabs.first);
    final status = s(p['status']) ?? '';
    final canManage = b(p['can_manage']);
    final actions = <(String, String, String)>[
      if (canManage && Perm.can('projects', 'overview', 'edit')) ...[
        if (status == 'planning' && (i(p['milestones_total']) ?? 0) > 0)
          ('activate', 'Release project',
              'Release the project? Every department milestone is sent to its department head, who can then create and assign tasks.'),
        if (status == 'on_hold') ('resume', 'Resume', 'Resume the project? Departments can work on their tasks again.'),
      ],
    ];
    final showDelete = canManage &&
        PmPerm.canDeleteOwn('projects', 'all_projects', p['created_by_id']) &&
        status == 'planning' &&
        (i(p['milestones_total']) ?? 0) == 0;
    return ListView(padding: const EdgeInsets.only(bottom: 40), children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Caps('Project Management'),
          const SizedBox(height: 4),
          Wrap(spacing: 10, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(txt(p['project_code']), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
            StagePills(stage: s(p['lifecycle_stage']), label: s(p['lifecycle_stage_label']), status: status),
          ]),
          if (tab != 'Overview')
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                  '${p['name']}${s(p['client_name']) != null ? ' · ${p['client_name']}' : ''} · Closing ${fmtDate(p['target_handover_date'])}',
                  style: const TextStyle(fontSize: 13, color: Brand.muted)),
            ),
          if (actions.isNotEmpty || showDelete)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Wrap(spacing: 8, runSpacing: 8, children: [
                for (final a in actions)
                  SmallBtn(a.$2, filled: true, onPressed: _busy ? null : () => _transition(a.$1, a.$2, a.$3)),
                if (showDelete) SmallBtn('Delete', color: Brand.danger, onPressed: () => _delete(p)),
              ]),
            ),
          const SizedBox(height: 10),
          if (status == 'technically_complete')
            Notice(
                'Every milestone is achieved. ${canManage ? 'Finish the closure checklist and the Final Project Report' : 'The project manager is closing the project'} — see Project closure on the Overview tab.'),
          if (status == 'on_hold' && s(p['hold_reason']) != null) Notice('On hold: ${p['hold_reason']}', tone: 'warn'),
          if (status == 'cancelled' && s(p['cancel_reason']) != null) Notice('Cancelled: ${p['cancel_reason']}', tone: 'bad'),
        ]),
      ),
      if (tabs.isNotEmpty)
        PmTabChips(labels: tabs, index: tabs.indexOf(tab!), onChanged: (k) => setState(() => _tab = tabs[k])),
      const SizedBox(height: 6),
      if (tab == null)
        const Padding(
          padding: EdgeInsets.all(16),
          child: Notice(
              "You can see this project's header, but none of its tabs (Overview, Milestones, Units, Store Issues, Purchases, Tasks, Documents, History). "
              "Ask an admin to add 'View' on them to one of your roles in Organization › Role & Permissions.",
              tone: 'warn'),
        )
      else
        KeyedSubtree(key: ValueKey('$tab-$_reloadKey'), child: _tabBody(tab, p)),
    ]);
  }

  Widget _tabBody(String tab, Json p) {
    final id = widget.projectId;
    switch (tab) {
      case 'Overview':
        return _OverviewTab(project: p, onChanged: _load);
      case 'Milestones':
        return ProjectPlanView(project: p);
      case 'Units':
        return _UnitsTab(project: p);
      case 'Store Issues':
        return StoreIssuesHistory(base: '/projects/$id');
      case 'Purchases':
        return PurchasesHistory(base: '/projects/$id');
      case 'Tasks':
        return TaskHistory(base: '/projects/$id');
      case 'Documents':
        return _DocumentsTab(projectId: id);
      case 'History':
        return PmBlock<List<Json>>(
          load: () async => rowsOf(await Api.get('/projects/$id/audit')),
          builder: (ctx, rows, _) => rows.isEmpty
              ? const MutedText('No history yet.')
              : Column(children: [
                  for (final e in rows)
                    Builder(builder: (_) {
                      final field = s(e['field_name']) == null
                          ? ''
                          : '${e['field_name']}: ${s(e['old_value']) ?? '—'} → ${s(e['new_value']) ?? '—'}';
                      final main = s(e['summary']) ?? (field.isNotEmpty ? '${e['action']} — $field' : txt(e['action']));
                      return RecordCard(
                        title: txt(e['performed_by']),
                        subtitle: main,
                        trailing: Text(fmtDateTime(e['performed_at']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                        meta: s(e['summary']) != null && field.isNotEmpty ? [('Change', field)] : const [],
                      );
                    }),
                ]),
        );
    }
    return const SizedBox.shrink();
  }
}

// ── Overview ────────────────────────────────────────────────────────────────

class _OverviewTab extends StatelessWidget {
  const _OverviewTab({required this.project, required this.onChanged});
  final Json project;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final p = project;
    final vis = PmVis('projects:all_projects');
    final closed = ['closed', 'cancelled'].contains(s(p['status']));
    final canEdit = b(p['can_manage']) && Perm.can('projects', 'overview', 'edit') && !closed;
    final next = obj(p['next_milestone']);
    final depts = strs(p['current_departments']);
    return Column(children: [
      if (vis.showSection('detail_summary'))
        DetailSection(
          txt(p['name']),
          action: canEdit
              ? SmallBtn('Edit', icon: Icons.edit_outlined, onPressed: () async {
                  if (await _editProject(context, p)) onChanged();
                })
              : null,
          children: [
            if (s(p['description']) != null || canEdit)
              Text(s(p['description']) ?? 'No scope written yet — use Edit to describe what is being delivered.',
                  style: TextStyle(fontSize: 13.5, color: s(p['description']) == null ? Brand.muted : Brand.body)),
            const SizedBox(height: 8),
            InfoLine('Client', p['client_name']),
            InfoLine('Dates', '${fmtDate(p['start_date'])} → ${fmtDate(p['target_handover_date'])}'),
            InfoLine('PM', p['project_manager_name']),
            InfoLine('Progress', ProgressBar(n(p['progress_percent']))),
          ],
        ),
      if (vis.showSection('detail_progress'))
        DetailSection('Progress', children: [
          FieldRow(
              'Stage',
              _StageControl(
                  project: p,
                  canMove: b(p['can_manage']) && Perm.can('projects', 'overview', 'edit') && !closed,
                  onChanged: onChanged)),
          FieldRow(
              'Milestones achieved',
              (i(p['milestones_total']) ?? 0) > 0
                  ? '${p['milestones_achieved']} of ${p['milestones_total']}'
                  : 'No milestones planned yet'),
          FieldRow(
              'Next milestone',
              next == null
                  ? null
                  : Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      Text(
                          '${next['title']}${s(next['department_name']) != null ? ' (${next['department_name']})' : ''} — due ${fmtDate(next['target_date'])}'),
                      if (b(next['is_overdue'])) Pill('Overdue', hx('#dc2626')),
                    ])),
          if (depts.isNotEmpty) FieldRow('Departments working now', depts.join(', ')),
          if (s(p['forecast_date']) != null && s(p['forecast_date']) != s(p['target_handover_date']))
            FieldRow('Forecast finish', fmtDate(p['forecast_date'])),
          if (s(p['health']) != null) FieldRow('Health', Pill.of(s(p['health']), healthLabels, healthHex)),
        ]),
      if (vis.showSection('detail_record'))
        DetailSection('Record', children: [
          if (s(p['customer_po_ref']) != null) FieldRow('Customer PO', p['customer_po_ref']),
          if (s(p['sales_order_ref']) != null) FieldRow('Sales order', p['sales_order_ref']),
          FieldRow(
              'Finance budget',
              s(p['internal_order_code']) != null
                  ? '${p['internal_order_code']} — ${s(p['internal_order_name']) ?? ''}'
                  : (canEdit ? 'Not linked — use Edit to link a budget Finance created.' : null)),
          FieldRow(
              'Created by',
              s(p['created_by_name']) == null
                  ? null
                  : '${p['created_by_name']}${s(p['created_at']) != null ? ' on ${fmtDate(p['created_at'])}' : ''}'),
          if (s(p['released_at']) != null)
            FieldRow('Released',
                '${fmtDate(p['released_at'])}${s(p['released_by_name']) != null ? ' by ${p['released_by_name']}' : ''}'),
          if (s(p['closure_date']) != null)
            FieldRow('Closed',
                '${fmtDate(p['closure_date'])}${s(p['closed_by_name']) != null ? ' by ${p['closed_by_name']}' : ''}'),
        ]),
      if (vis.showSection('detail_budget')) _BudgetCard(projectId: i(p['id'])!),
      if (vis.showSection('detail_machine')) _MachineDetails(project: p),
      if (s(p['status']) == 'closed') _ClosureRecord(project: p),
    ]);
  }
}

/// Edit Project (components/projects/ProjectForm.tsx in edit mode).
Future<bool> _editProject(BuildContext context, Json p) async {
  final f = <String, String>{
    for (final k in [
      'project_code', 'name', 'client_name', 'customer_po_ref', 'sales_order_ref', 'description', 'start_date',
      'target_handover_date',
    ])
      k: s(p[k]) ?? '',
  };
  int? pmId = i(p['project_manager_id']);
  String? pmName = s(p['project_manager_name']);
  int? budgetId = i(p['internal_order_id']);
  String? budgetLabel = s(p['internal_order_code']) == null ? null : '${p['internal_order_code']} — ${s(p['internal_order_name']) ?? ''}';
  final codeLocked = s(p['status']) != 'planning';
  final people = await PmPeople.directory().catchError((Object _) => <Json>[]);
  if (!context.mounted) return false;

  Widget text(String k, String label, {bool req = false, int lines = 1, String? hint, bool enabled = true, bool upper = false}) =>
      AppTextField(
        key: ValueKey('pe-$k'),
        label: label,
        required: req,
        initialValue: f[k],
        maxLines: lines,
        hint: hint,
        enabled: enabled,
        onChanged: (v) => f[k] = upper ? v.toUpperCase() : v,
      );

  return showFormSheet(
    context,
    title: 'Edit Project',
    saveLabel: 'Save',
    builder: (ctx, setS) => [
      Text('${p['project_code']} · ${p['name']}', style: const TextStyle(color: Brand.muted)),
      const SheetTitle('Basic Information', icon: Icons.list_alt_rounded),
      text('name', 'Project name', req: true, hint: 'e.g. CAM Injection Car for IRCON MAHSR-T2'),
      text('client_name', 'Client', req: true, hint: 'e.g. IRCON International Limited'),
      text('customer_po_ref', 'Customer PO number', req: true, hint: 'e.g. 4500123456'),
      text('sales_order_ref', 'Sales order (SO) number', req: true, hint: 'e.g. SO-2026-0042'),
      const SheetTitle('Timeline', icon: Icons.calendar_today_outlined),
      DateField(
          label: 'Start date',
          required: true,
          value: dateOnly(f['start_date']),
          onChanged: (d) => setS(() => f['start_date'] = d == null ? '' : apiDate(d))),
      DateField(
          label: 'Closing date',
          required: true,
          value: dateOnly(f['target_handover_date']),
          onChanged: (d) => setS(() => f['target_handover_date'] = d == null ? '' : apiDate(d))),
      const SheetTitle('Budget', icon: Icons.account_balance_wallet_outlined, optional: true),
      AppSelect<int>(
        label: 'Finance budget',
        value: budgetId,
        valueLabel: budgetLabel,
        loadOptions: (q) async {
          final rows = rowsOf(await Api.get('/projects/budget-options', query: {'project_id': p['id']}));
          final t = q.toLowerCase();
          return [
            for (final r in rows)
              if (t.isEmpty || '${r['code']} ${r['name']}'.toLowerCase().contains(t))
                Option(i(r['id'])!, '${r['code']} — ${r['name']}',
                    subtitle: [
                      humanize(r['order_type']),
                      if (r['available_amount'] != null) 'Available ${fmtMoney(r['available_amount'])}',
                    ].join(' · ')),
          ];
        },
        onChanged: (o) => setS(() {
          budgetId = o?.value;
          budgetLabel = o?.label;
        }),
      ),
      const Hint('Purchases and expenses booked on this budget show on the project as committed and actual spend.'),
      const SheetTitle('Ownership & Scope', icon: Icons.person_outline_rounded),
      text('project_code', 'Project number', req: true, hint: 'e.g. PEW-78 or PEW-64A', enabled: !codeLocked, upper: true),
      if (codeLocked) const Hint('Fixed once the project is released — departments know it by this code.'),
      AppSelect<int>(
        label: 'Project manager',
        required: true,
        value: pmId,
        valueLabel: pmName,
        options: [
          for (final u in people)
            Option(i(u['id'])!, '${u['name']}${s(u['designation']) != null ? ' — ${u['designation']}' : ''}'),
        ],
        onChanged: (o) => setS(() {
          pmId = o?.value;
          pmName = o?.label;
        }),
      ),
      text('description', 'Description / scope', lines: 3, hint: 'What is being delivered'),
    ],
    onSave: () async {
      final missing = <String>[];
      if (f['project_code']!.trim().isEmpty) missing.add('Project number is required, e.g. PEW-78 or PEW-64A.');
      if (f['name']!.trim().isEmpty) missing.add('Project name is required.');
      if (f['client_name']!.trim().isEmpty) missing.add('Client is required.');
      if (f['customer_po_ref']!.trim().isEmpty) {
        missing.add("Customer PO number is required. Enter the customer's purchase order number for this project.");
      } else if (f['customer_po_ref']!.trim().length > 100) {
        missing.add('Customer PO number can be at most 100 characters.');
      }
      if (f['sales_order_ref']!.trim().isEmpty) {
        missing.add('Sales order (SO) number is required. Enter the SO number this project is delivered under.');
      } else if (f['sales_order_ref']!.trim().length > 100) {
        missing.add('Sales order (SO) number can be at most 100 characters.');
      }
      if (pmId == null) missing.add('Project manager is required — one person owns the project.');
      if (f['start_date']!.isEmpty) missing.add('Start date is required.');
      if (f['target_handover_date']!.isEmpty) missing.add('Closing date is required.');
      if (f['start_date']!.isNotEmpty &&
          f['target_handover_date']!.isNotEmpty &&
          f['target_handover_date']!.compareTo(f['start_date']!) < 0) {
        missing.add('Closing date is before the start date.');
      }
      if (missing.isNotEmpty) throw missing.join(' ');
      await Api.patch('/projects/${p['id']}', data: {
        'project_code': f['project_code']!.trim().isEmpty ? null : f['project_code']!.trim(),
        'name': f['name']!.trim(),
        'client_name': f['client_name']!.trim(),
        'customer_po_ref': f['customer_po_ref']!.trim(),
        'sales_order_ref': f['sales_order_ref']!.trim(),
        'description': f['description']!.trim().isEmpty ? null : f['description']!.trim(),
        'project_manager_id': pmId,
        'start_date': f['start_date'],
        'target_handover_date': f['target_handover_date'],
        'internal_order_id': budgetId,
      });
    },
  );
}

/// Lifecycle stage: pill, a stage picker and "Move to next stage" for the PM /
/// management. Moving back is for an admin or Partner and needs a reason.
class _StageControl extends StatefulWidget {
  const _StageControl({required this.project, required this.canMove, required this.onChanged});
  final Json project;
  final bool canMove;
  final VoidCallback onChanged;

  @override
  State<_StageControl> createState() => _StageControlState();
}

class _StageControlState extends State<_StageControl> {
  bool _busy = false;

  Future<void> _move(String stage, {String? reason}) async {
    setState(() => _busy = true);
    final p = widget.project;
    try {
      await Api.post('/projects/${p['id']}/stage', data: {'stage': stage, 'reason': ?reason});
      widget.onChanged();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pick(String stage, String current) async {
    if (stage == current) return;
    if (lifecycleOrder.indexOf(stage) < lifecycleOrder.indexOf(current)) {
      if (!PmPerm.isPartnerOrAdmin) {
        showSnack(context, 'Only an admin or a Partner can move a project back to an earlier stage.', error: true);
        return;
      }
      final reason = await promptDialog(context,
          title: 'Move back to ${lifecycleLabels[stage]}?',
          message:
              'Stages normally only move forward. Say why this project is going back — the reason is saved in its history and the machines linked to it follow the new stage.',
          confirmLabel: 'Move back');
      if (reason == null) return;
      _move(stage, reason: reason);
    } else {
      _move(stage);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.project;
    final current = s(p['lifecycle_stage']) ?? 'planned';
    final idx = lifecycleOrder.indexOf(current);
    final next = idx >= 0 && idx < lifecycleOrder.length - 1 ? lifecycleOrder[idx + 1] : null;
    final mayBack = PmPerm.isPartnerOrAdmin;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      StagePills(stage: s(p['lifecycle_stage']), label: s(p['lifecycle_stage_label']), status: s(p['status'])),
      if (widget.canMove) ...[
        const SizedBox(height: 8),
        AppSelect<String>(
          label: 'Set the project stage',
          value: current,
          clearable: false,
          enabled: !_busy,
          options: [
            for (var k = 0; k < lifecycleOrder.length; k++)
              Option(lifecycleOrder[k],
                  '${lifecycleLabels[lifecycleOrder[k]]}${k < idx && !mayBack ? ' (admin / Partner only)' : ''}'),
          ],
          onChanged: (o) {
            if (o != null) _pick(o.value, current);
          },
        ),
        if (next != null) ...[
          const SizedBox(height: 8),
          SmallBtn(_busy ? 'Moving…' : 'Move to ${lifecycleLabels[next]}', filled: true, onPressed: _busy ? null : () => _move(next)),
        ],
      ],
    ]);
  }
}

/// Finance budget vs spend (components/finance/ProjectBudget.tsx ProjectBudgetCard).
class _BudgetCard extends StatelessWidget {
  const _BudgetCard({required this.projectId});
  final int projectId;

  @override
  Widget build(BuildContext context) {
    return PmBlock<Json>(
      load: () async => obj(await Api.get('/projects/$projectId/budget')) ?? {},
      builder: (ctx, d, _) {
        final children = <Widget>[];
        final sm = obj(d['summary']);
        if (b(d['hidden'])) {
          children.add(const Text(
              'Costs are hidden for your role (R&D › Prototypes › BOM costs). Ask an admin if you need to see the budget.',
              style: TextStyle(color: Brand.muted)));
        } else if (sm == null) {
          children.add(const Text(
              'No Finance budget linked. Finance creates the budget; the project manager links it with Edit.',
              style: TextStyle(color: Brand.muted)));
        } else {
          final used = n(sm['actual_amount']) + n(sm['commitment_amount']);
          final budget = sm['budgeted_amount'] == null ? null : n(sm['budgeted_amount']);
          final pct = budget != null && budget > 0 ? (used / budget * 100).clamp(0, 100) : 0;
          final over = sm['available_amount'] != null && n(sm['available_amount']) < 0;
          if (s(sm['code']) != null) children.add(Text('Finance budget ${sm['code']}${s(sm['name']) != null ? ' — ${sm['name']}' : ''}'));
          if (!b(d['linked'])) {
            children.add(const Text('Nothing charged yet — Finance opens the budget with the first purchase charged to this project.',
                style: TextStyle(color: Brand.muted)));
          }
          children.addAll([
            FieldRow('Budget', fmtMoney(sm['budgeted_amount'])),
            FieldRow('Committed (purchase orders not yet invoiced)', fmtMoney(sm['commitment_amount'])),
            FieldRow('Actual spent (posted invoices, expenses, journals)', fmtMoney(sm['actual_amount'])),
            FieldRow(
                'Available',
                Text('${fmtMoney(sm['available_amount'])}${over ? ' · Over budget' : ''}',
                    style: TextStyle(fontWeight: FontWeight.w700, color: hx(over ? '#b91c1c' : '#15803d')))),
          ]);
          if (budget != null && budget > 0) {
            children.addAll([
              const SizedBox(height: 6),
              ProgressBar(pct, color: hx(over ? '#dc2626' : pct > 85 ? '#d97706' : '#2563eb'), height: 8, showText: false),
              const SizedBox(height: 4),
              Text('${sm['consumed_pct'] ?? pct.round()}% of the budget used (committed + actual)',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]);
          }
          final commitments = rowsOf(d['commitments']);
          if (commitments.isNotEmpty) {
            children.add(const Padding(
                padding: EdgeInsets.only(top: 12, bottom: 4),
                child: Text('Open purchase orders', style: TextStyle(fontWeight: FontWeight.w600))));
            for (final c in commitments) {
              children.add(InfoLine(
                  '${c['po_number']}',
                  '${s(c['vendor_name']) ?? '—'} · ${fmtDate(c['po_date'])}\nPO ${fmtMoney(c['po_value'])} · invoiced ${fmtMoney(c['invoiced_value'])} · committed ${fmtMoney(c['open_value'])}'));
            }
          }
          if (b(d['ledger_hidden']) && (i(d['line_count']) ?? 0) > 0) {
            children.add(Text(
                '${d['line_count']} posted voucher line(s) make up the actual spend — Finance users see them here and in Finance › Controlling.',
                style: const TextStyle(fontSize: 12, color: Brand.muted)));
          }
          final lines = rowsOf(d['recent_lines']);
          if (lines.isNotEmpty) {
            children.add(Padding(
                padding: const EdgeInsets.only(top: 12, bottom: 4),
                child: Text(
                    'Spend booked${(i(d['line_count']) ?? 0) > lines.length ? ' (latest ${lines.length} of ${d['line_count']})' : ''}',
                    style: const TextStyle(fontWeight: FontWeight.w600))));
            for (final l in lines) {
              children.add(InfoLine(
                  fmtDate(l['posting_date']),
                  '${l['entry_number']} · ${[s(l['gl_account_code']), s(l['gl_account_name'])].whereType<String>().join(' ')}\n'
                  '${s(l['party_name']) ?? s(l['description']) ?? '—'} · ${fmtMoney(n(l['debit_amount']) - n(l['credit_amount']))}'));
            }
          }
        }
        return DetailSection('Budget & spend', children: children);
      },
    );
  }
}

/// Machine details of a project (tabs/MachineTab.tsx).
class _MachineDetails extends StatelessWidget {
  const _MachineDetails({required this.project});
  final Json project;

  static const _statusLabels = {
    'active': 'Active', 'under_service': 'Under Service', 'manufacturing_under_progress': 'Manufacturing Under Progress',
    'work_in_progress': 'Work in Progress', 'standby': 'Standby', 'inactive': 'Inactive', 'decommissioned': 'Decommissioned',
    'cancel': 'Cancel',
  };

  Future<List<Json>> _load() async {
    final mid = i(project['machine_id']);
    Future<List<Json>> fallback() async => mid == null ? <Json>[] : [obj(await Api.get('/erp/projects/$mid')) ?? {}];
    List<Json> list;
    try {
      list = (await Api.list('/erp/projects', query: {'pm_project_id': project['id'], 'limit': 50})).rows;
      if (list.isEmpty && mid != null) list = await fallback();
    } catch (e) {
      if (e is Exception && ApiClient.describe(e).isNotEmpty && _is403(e)) rethrow;
      list = await fallback();
    }
    list.sort((a, b) => txt(a['serial_number']).compareTo(txt(b['serial_number'])));
    return list;
  }

  static bool _is403(Object e) {
    try {
      return (e as dynamic).response?.statusCode == 403;
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return PmBlock<List<Json>>(
      load: _load,
      builder: (ctx, machines, _) {
        if (machines.isEmpty) {
          return const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Notice(
                'This project was created before projects carried their machine details. Past machines are listed under All Projects › Past.'),
          );
        }
        return Column(children: [for (final m in machines) _card(ctx, m)]);
      },
    );
  }

  Widget _card(BuildContext context, Json m) {
    final site = [s(m['site_name']), s(m['site_location']), b(m['is_export']) ? s(m['site_country']) : s(m['site_state'])]
        .whereType<String>()
        .join(', ');
    final hasSpecs = [m['specifications'], m['installed_options'], m['software_version'], m['tech_notes']].any((v) => s(v) != null);
    final approval = s(m['approval_status']);
    return DetailSection('Machine ${m['serial_number']}', children: [
      Wrap(spacing: 8, runSpacing: 8, children: [
        SmallBtn('Open machine record', onPressed: () => openScreen(context, MachineScreen(machineId: i(m['id'])!))),
        SmallBtn('Edit machine', icon: Icons.edit_outlined, onPressed: () async {
          if (await openEditMachineForm(context, m) && context.mounted) showSnack(context, 'Machine saved.');
        }),
      ]),
      const SizedBox(height: 8),
      if (approval != null && approval != 'approved')
        Notice(
            approval == 'pending'
                ? 'This machine is waiting for approval.'
                : 'This machine was rejected${s(m['approval_remarks']) != null ? ': ${m['approval_remarks']}' : '.'}',
            tone: approval == 'rejected' ? 'bad' : 'warn'),
      const Caps('Machine identity'),
      FieldRow('Serial number', m['serial_number']),
      FieldRow('Model', m['model_name']),
      FieldRow('Classification', m['machine_type']),
      FieldRow('Application', m['application_type']),
      FieldRow('Status', _statusLabels[s(m['status'])] ?? m['status']),
      FieldRow('Engine / chassis', [s(m['engine_number']), s(m['chassis_number'])].whereType<String>().join(' / ')),
      FieldRow('Year of manufacture', m['year_of_manufacture']),
      FieldRow('Notes', m['notes']),
      const Divider(),
      const Caps('Client & site'),
      FieldRow('Client company', m['client_company']),
      FieldRow('Contact',
          [s(m['client_name']), s(m['client_designation']), s(m['client_phone']), s(m['client_email'])].whereType<String>().join(' · ')),
      FieldRow('GST number', m['client_gst']),
      FieldRow('Address', m['client_address']),
      FieldRow('Site', site),
      FieldRow('Zone', m['zone']),
      FieldRow('Operator', [s(m['operator_name']), s(m['operator_phone'])].whereType<String>().join(' · ')),
      if (hasSpecs) ...[
        const Divider(),
        const Caps('Technical specs'),
        FieldRow('Specifications', m['specifications']),
        FieldRow('Installed options', m['installed_options']),
        FieldRow('Software version', m['software_version']),
        FieldRow('Technical notes', m['tech_notes']),
      ],
      const Divider(),
      const Caps('Timeline & warranty'),
      FieldRow('Customer PO',
          s(m['po_number']) == null ? null : '${m['po_number']}${s(m['po_date']) != null ? ' · ${fmtDate(m['po_date'])}' : ''}'),
      FieldRow('Dispatch date', s(m['delivery_date']) == null ? null : fmtDate(m['delivery_date'])),
      FieldRow('Commissioning date', s(m['commissioning_date']) == null ? null : fmtDate(m['commissioning_date'])),
      FieldRow('Handover date', s(m['handover_date']) == null ? null : fmtDate(m['handover_date'])),
      FieldRow(
          'Warranty',
          s(m['warranty_start_date']) != null
              ? '${fmtDate(m['warranty_start_date'])} to ${s(m['warranty_end_date']) != null ? fmtDate(m['warranty_end_date']) : '—'}'
              : 'No warranty'),
      FieldRow('Extended warranty',
          b(m['extended_warranty']) ? 'Until ${s(m['extended_warranty_end']) != null ? fmtDate(m['extended_warranty_end']) : '—'}' : null),
    ]);
  }
}

/// A closed project keeps its closure record (tabs/ClosurePanel.tsx, read-only).
class _ClosureRecord extends StatelessWidget {
  const _ClosureRecord({required this.project});
  final Json project;

  @override
  Widget build(BuildContext context) {
    final p = project;
    return PmBlock<Json>(
      load: () async => obj(await Api.get('/projects/${p['id']}/closure')) ?? {},
      builder: (ctx, c, _) => DetailSection('Project closure', children: [
        Text(
            'Closed ${fmtDate(p['closure_date'])} by ${txt(p['closed_by_name'])}.'
            '${s(p['technically_completed_on']) != null ? ' Technically complete since ${fmtDate(p['technically_completed_on'])}.' : ''}',
            style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        const SizedBox(height: 8),
        for (final ch in rowsOf(c['checks']))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(b(ch['ok']) ? '✓' : (b(ch['required']) ? '✗' : '!'),
                  style: TextStyle(
                      fontWeight: FontWeight.w800,
                      color: hx(b(ch['ok']) ? '#16a34a' : (b(ch['required']) ? '#dc2626' : '#f59e0b')))),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${ch['label']}${b(ch['required']) ? '' : ' (advisory)'}',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  if (s(ch['key']) == 'documents_archived' && b(ch['ok']) && s(p['documents_archived_at']) != null)
                    Text('Confirmed ${fmtDate(p['documents_archived_at'])} by ${txt(p['documents_archived_by_name'])}',
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  if (!b(ch['ok']) && s(ch['detail']) != null)
                    Text(txt(ch['detail']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ]),
              ),
            ]),
          ),
        const SizedBox(height: 8),
        const Caps('Final Project Report'),
        const SizedBox(height: 6),
        SmallBtn('Open in Word', icon: Icons.description_outlined, onPressed: () => openApiFile(context,
            '/managed-documents/pm_project_closure_report/${p['id']}/docx', 'Final-Project-Report-${p['project_code']}.docx')),
        const SizedBox(height: 8),
        FieldRow('Closure note', p['closure_note']),
        FieldRow('Lessons learned', p['lessons_learned']),
      ]),
    );
  }
}

// ── Units ───────────────────────────────────────────────────────────────────

const _deptColumns = [
  ('design', 'Design'), ('purchase', 'Purchase'), ('store', 'Store'), ('production', 'Production'),
  ('quality', 'Quality'), ('dispatch', 'Dispatch'), ('delivery', 'Delivered'),
];
const _toneHex = {'neutral': '#78716c', 'info': '#2563EB', 'success': '#16A34A', 'warning': '#F59E0B', 'danger': '#DC2626'};
const _elementLabels = {
  'planned': 'Planned', 'in_progress': 'In progress', 'ready': 'Ready', 'dispatched': 'Dispatched', 'delivered': 'Delivered',
  'cancelled': 'Cancelled',
};
const _elementHex = {
  'planned': '#78716c', 'in_progress': '#2563EB', 'ready': '#7C3AED', 'dispatched': '#0891B2', 'delivered': '#16A34A',
  'cancelled': '#DC2626',
};

class _UnitsTab extends StatelessWidget {
  const _UnitsTab({required this.project});
  final Json project;

  Widget _cells(Map? cells, {bool cancelled = false}) {
    return Column(children: [
      for (final c in _deptColumns)
        InfoLine(
          c.$2,
          () {
            final cell = cells == null ? null : obj(cells[c.$1]);
            if (cancelled || cell == null) return const Text('—', style: TextStyle(color: Brand.muted));
            return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Pill(txt(cell['label']), hx(_toneHex[s(cell['tone'])] ?? '#78716c')),
              if (s(cell['detail']) != null)
                Text(txt(cell['detail']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
            ]);
          }(),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final p = project;
    return PmBlock<Json>(
      load: () async => obj(await Api.get('/projects/${p['id']}/units')) ?? {},
      builder: (ctx, d, _) {
        final elements = rowsOf(d['elements']);
        final hasUnits = d['has_units'] is bool ? b(d['has_units']) : elements.any((e) => s(e['status']) != 'cancelled');
        final po = s(d['customer_po_number']) ?? s(p['customer_po_ref']);
        final whole = obj(d['whole_project']);
        return Column(children: [
          DetailSection(hasUnits ? 'Order' : 'Project', children: [
            if (hasUnits) FieldRow('Sales order', s(d['so_number']) ?? s(p['so_number'])),
            FieldRow('Machine', p['machine_serial']),
            FieldRow('Customer PO',
                po == null ? null : '$po${s(d['customer_po_date']) != null ? ' dated ${fmtDate(d['customer_po_date'])}' : ''}'),
            if (hasUnits && d['order_value'] != null) FieldRow('Order value (incl. GST)', fmtMoney(d['order_value'])),
            if (hasUnits)
              FieldRow('Delivered',
                  '${d['vehicles_delivered']} of ${d['vehicles_total']} vehicles${(i(d['lots_total']) ?? 0) > 0 ? ' · ${d['lots_total']} spares lot(s)' : ''}'),
          ]),
          if (!hasUnits)
            DetailSection('Whole project — 360 view', children: [
              Text(
                  'One project is one machine, so there is a single row. Each department shows where the project stands; “—” means nothing is linked to ${p['project_code']} yet.',
                  style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              const SizedBox(height: 8),
              Text(s(whole?['label']) ?? 'Whole project${s(p['machine_serial']) != null ? ' · ${p['machine_serial']}' : ''}',
                  style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
              _cells(whole?['departments'] as Map?),
            ]),
          if (elements.isNotEmpty) ...[
            const GroupTitle('Vehicles & lots — 360 view'),
            for (final el in elements)
              DetailSection(txt(el['label']), action: Pill.of(s(el['status']), _elementLabels, _elementHex), children: [
                Text(
                    '${el['element_no']}${s(el['kind']) == 'vehicle' && s(el['rrv_model']) != null ? ' · ${el['rrv_model']}' : ''}'
                    '${s(el['kind']) == 'lot' ? ' · ${el['quantity']} ${s(el['uom']) ?? ''}' : ''}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
                InfoLine(
                    'Contractual date',
                    '${fmtDate(el['contractual_date'])}${s(el['current_delivery_date']) != null && s(el['current_delivery_date']) != s(el['contractual_date']) ? ' (now ${fmtDate(el['current_delivery_date'])})' : ''}'),
                _cells(el['departments'] as Map?, cancelled: s(el['status']) == 'cancelled'),
              ]),
          ],
        ]);
      },
    );
  }
}

// ── Documents ───────────────────────────────────────────────────────────────

class _DocumentsTab extends StatefulWidget {
  const _DocumentsTab({required this.projectId});
  final int projectId;

  @override
  State<_DocumentsTab> createState() => _DocumentsTabState();
}

class _DocumentsTabState extends State<_DocumentsTab> {
  List<Json>? _docs;
  String? _error;
  String? _dept;
  String? _milestone;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = rowsOf(await Api.get('/projects/${widget.projectId}/documents'));
      if (mounted) setState(() => _docs = d);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  String _src(Json d) =>
      s(d['source']) ?? (d['task_id'] != null ? 'task' : d['message_id'] != null ? 'chat' : d['milestone_id'] != null ? 'evidence' : 'project');

  String? _where(Json d) {
    if (s(d['plan_milestone_title']) != null) {
      return [
        'Milestone: ${d['plan_milestone_title']}',
        if (s(d['plan_task_title']) != null) 'Task: ${d['plan_task_title']}',
        if (s(d['title']) != null && s(d['title']) != s(d['file_name'])) s(d['title']),
      ].whereType<String>().join(' › ');
    }
    final parts = [
      s(d['department_name']),
      s(d['milestone_title']) != null
          ? 'Step ${d['milestone_sequence'] ?? '?'} ${d['milestone_title']}${s(d['task_title']) != null ? ' › ${d['task_title']}' : ''}'
          : s(d['task_title']),
      if (s(d['title']) != null && s(d['title']) != s(d['file_name'])) s(d['title']),
    ].whereType<String>().toList();
    return parts.isEmpty ? s(d['title']) : parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final docs = _docs;
    if (docs == null) {
      return _error == null ? const LoadingView() : Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(_error!));
    }
    final depts = docs.map((d) => s(d['department_name'])).whereType<String>().toSet().toList()..sort();
    final ms = <String, String>{};
    for (final d in docs) {
      if (d['plan_milestone_id'] != null) ms['${d['plan_milestone_id']}'] = s(d['plan_milestone_title']) ?? '';
    }
    final shown = docs
        .where((d) => (_dept == null || s(d['department_name']) == _dept) && (_milestone == null || '${d['plan_milestone_id']}' == _milestone))
        .toList();
    final groups = [
      ('task', 'Milestone & task documents', shown.where((d) => _src(d) == 'task').toList()),
      ('project', 'Project documents', _dept != null || _milestone != null ? <Json>[] : shown.where((d) => _src(d) == 'project').toList()),
      ('evidence', 'Milestone evidence', shown.where((d) => _src(d) == 'evidence').toList()),
      ('chat', 'Sent in milestone chats', shown.where((d) => _src(d) == 'chat').toList()),
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (_error != null) ErrorBanner(_error!),
        if (ms.isNotEmpty) ...[
          AppSelect<String>(
            label: 'All milestones',
            value: _milestone,
            valueLabel: ms[_milestone],
            options: [for (final e in ms.entries) Option(e.key, e.value)],
            onChanged: (o) => setState(() => _milestone = o?.value),
          ),
          const SizedBox(height: 8),
        ],
        if (depts.isNotEmpty) ...[
          AppSelect<String>(
            label: 'All departments',
            value: _dept,
            options: [for (final d in depts) Option(d, d)],
            onChanged: (o) => setState(() => _dept = o?.value),
          ),
          const SizedBox(height: 4),
          Text('${shown.length} file(s)', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ],
        for (final g in groups)
          if (g.$1 == 'task' || g.$3.isNotEmpty) ...[
            Padding(padding: const EdgeInsets.only(top: 14, bottom: 6), child: Caps('${g.$2} (${g.$3.length})')),
            if (g.$3.isEmpty)
              const Text('No files yet — files attached on a milestone or task in Project Plan & Milestones show up here.',
                  style: TextStyle(fontSize: 12.5, color: Brand.muted))
            else
              for (final d in g.$3)
                FileRow(
                  title: () {
                    final t = g.$1 == 'project' ? s(d['title']) : _where(d);
                    return t != null && t != s(d['file_name']) ? '$t — ${d['file_name']}' : txt(d['file_name']);
                  }(),
                  tag: s(d['doc_type']) != null && s(d['doc_type']) != 'other' ? docTypeLabels[s(d['doc_type'])] : null,
                  sub: [s(d['uploaded_by_name']), if (s(d['created_at']) != null) fmtDate(d['created_at'])].whereType<String>().join(' · '),
                  onOpen: () => openApiFile(context, '/projects/${widget.projectId}/documents/${d['id']}/content', txt(d['file_name'])),
                  onDelete: g.$1 == 'project' && PmPerm.canDeleteOwn('projects', 'documents', d['uploaded_by_id'])
                      ? () async {
                          final ok = await confirmDialog(context,
                              title: 'Delete this file?',
                              message: 'The file is removed from the project and from SharePoint.',
                              confirmLabel: 'Delete',
                              danger: true);
                          if (!ok || !context.mounted) return;
                          if (await runAction(context, () => Api.delete('/projects/${widget.projectId}/documents/${d['id']}'))) _load();
                        }
                      : null,
                ),
          ],
      ]),
    );
  }
}
