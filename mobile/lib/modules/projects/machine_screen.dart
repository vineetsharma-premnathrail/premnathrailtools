import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'approval_panel.dart';
import 'history_tabs.dart';
import 'machine_form.dart';
import 'pm_common.dart';

/// A machine record (past project / machine of a project) -
/// frontend/src/app/dashboard/projects/service-projects/[id]/page.tsx.

const _machineStatusHex = {
  'active': '#047857', 'under_service': '#B45309', 'manufacturing_under_progress': '#2563EB',
  'work_in_progress': '#2563EB', 'standby': '#78716c', 'inactive': '#64748b', 'decommissioned': '#78716c',
  'cancel': '#78716c',
};
const _woHex = {
  'draft': '#78716c', 'released': '#2563EB', 'in_progress': '#F59E0B', 'completed': '#16A34A', 'closed': '#0f766e',
  'cancelled': '#DC2626',
};

class MachineScreen extends StatefulWidget {
  const MachineScreen({super.key, required this.machineId, this.title});
  final int machineId;
  final String? title;

  @override
  State<MachineScreen> createState() => _MachineScreenState();
}

class _MachineScreenState extends State<MachineScreen> {
  Json? _m;
  Object? _error;
  int _tab = 0;
  int _activeTickets = 0;
  bool? _legacyApproval;


  bool _feat(String k, [String action = 'view']) => Perm.canFeature('projects', 'all_projects', k, action);

  @override
  void initState() {
    super.initState();
    _load();
    Api.list('/erp/service-requests', query: {'project_id': widget.machineId, 'limit': 1000}).then((p) {
      if (!mounted) return;
      setState(() => _activeTickets =
          p.rows.where((r) => !['closed', 'cancelled'].contains(s(r['status']))).length);
    }).catchError((Object _) {});
  }

  Future<void> _load() async {
    try {
      final d = obj(await Api.get('/erp/projects/${widget.machineId}'));
      if (!mounted) return;
      setState(() {
        _m = d;
        _error = null;
      });
      if (s(d?['approval_status']) == 'pending') {
        try {
          final a = obj(await Api.get('/approvals/entity/erp_machine/${widget.machineId}'));
          if (mounted) setState(() => _legacyApproval = a?['current'] == null);
        } catch (_) {
          if (mounted) setState(() => _legacyApproval = false);
        }
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  List<String> get _tabs {
    const all = ['Overview', 'Technical Specs', 'Maintenance History', 'Store Issues', 'Purchases', 'Tasks', 'Production', 'Documents', 'Audit Trail'];
    const feats = {
      'Technical Specs': ['technical_specs'], 'Maintenance History': ['service_history'], 'Store Issues': ['store_issues'],
      'Purchases': ['purchases'], 'Tasks': ['task_history'], 'Production': ['production'], 'Documents': ['documents', 'letters'],
      'Audit Trail': ['audit_trail'],
    };
    return all.where((t) => feats[t] == null || feats[t]!.any(_feat)).toList();
  }

  @override
  Widget build(BuildContext context) {
    final m = _m;
    return SubPage(
        title: m == null ? (widget.title ?? 'Machine') : txt(m['serial_number']),
        actions: [
          if (m != null && PmPerm.erp('project_edit'))
            IconButton(
              tooltip: 'Edit Machine',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () async {
                if (await openEditMachineForm(context, m)) {
                  _load();
                }
              },
            ),
          if (m != null && PmPerm.canDeleteOwn('projects', 'all_projects', m['created_by_id']))
            IconButton(tooltip: 'Delete', icon: const Icon(Icons.delete_outline_rounded), onPressed: () => _delete(m)),
        ],
        body: m == null
            ? (_error == null ? const LoadingView() : ErrorView(_error!, onRetry: _load))
            : RefreshIndicator(onRefresh: _load, child: _body(m)),
    );
  }

  Future<void> _delete(Json m) async {
    final ok = await confirmDialog(context,
        title: 'Delete this machine?',
        message: 'Delete machine ${m['serial_number']}? It can be restored from the recycle bin for 10 days.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    final done = await runAction(context, () => Api.delete('/erp/projects/${m['id']}'), success: 'Machine deleted.');
    if (done && mounted) Navigator.of(context).pop(true);
  }

  Widget _body(Json m) {
    final tabs = _tabs;
    if (_tab >= tabs.length) _tab = 0;
    final warranty = _warranty(m);
    return ListView(padding: const EdgeInsets.only(bottom: 32), children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Caps('Machine'),
          const SizedBox(height: 4),
          Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(txt(m['serial_number']),
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
            Pill(humanize(m['status']), hx(_machineStatusHex[s(m['status'])] ?? '#78716c')),
          ]),
          const SizedBox(height: 2),
          Text([s(m['model_name']) ?? 'Model not provided', s(m['client_company'])].whereType<String>().join(' · '),
              style: const TextStyle(fontSize: 13, color: Brand.muted)),
          const SizedBox(height: 8),
          _MachineStage(machine: m, canSet: Perm.can('projects', 'all_projects', 'edit'), onChanged: (d) {
            setState(() => _m = d);
          }),
        ]),
      ),
      if (s(m['approval_status']) == 'pending')
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Notice("Pending approval — service requests can't be raised on this machine until it is approved.", tone: 'warn'),
            if (_legacyApproval == true)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Wrap(spacing: 8, children: [
                  SmallBtn('Approve machine', filled: true, color: Brand.primary, onPressed: () async {
                    final r = await promptDialog(context, title: 'Approve machine', label: 'Remarks', required: false, confirmLabel: 'Approve');
                    if (r == null || !mounted) return;
                    if (await runAction(context, () => Api.post('/erp/projects/${m['id']}/approve', data: {'remarks': r}))) _load();
                  }),
                  SmallBtn('Reject', color: Brand.danger, onPressed: () async {
                    final r = await promptDialog(context,
                        title: 'Reject',
                        message: "Say what is wrong with this machine's details — the person who registered it is notified and resubmits by editing it.",
                        confirmLabel: 'Reject');
                    if (r == null || !mounted) return;
                    if (await runAction(context, () => Api.post('/erp/projects/${m['id']}/reject', data: {'remarks': r}))) _load();
                  }),
                ]),
              ),
          ]),
        ),
      if (s(m['approval_status']) == 'rejected')
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Notice(
              'Rejected: ${s(m['approval_remarks']) ?? 'No reason given.'} Edit the machine to correct it — saving sends it back for approval.',
              tone: 'bad'),
        ),
      ApprovalPanel(title: 'Machine approval', entityType: 'erp_machine', entityId: i(m['id'])!, onChanged: _load),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(children: [
          Expanded(
            child: StatTile(
              label: _activeTickets == 0 ? 'Active Tickets · no open repair requests' : 'Active Tickets · $_activeTickets open repair request(s)',
              value: _activeTickets,
            ),
          ),
          if (_feat('warranty')) ...[
            const SizedBox(width: 10),
            Expanded(
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Caps('Warranty Status'),
                    const SizedBox(height: 6),
                    Text(warranty.$1, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
                    Text(warranty.$2, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ]),
                ),
              ),
            ),
          ],
        ]),
      ),
      const SizedBox(height: 8),
      PmTabChips(labels: tabs, index: _tab, onChanged: (k) => setState(() => _tab = k)),
      const SizedBox(height: 4),
      KeyedSubtree(key: ValueKey(tabs[_tab]), child: _tabBody(tabs[_tab], m)),
    ]);
  }

  (String, String) _warranty(Json m) {
    final end = dateOnly(m['warranty_end_date']);
    if (end == null) return ('—', 'No warranty on record');
    final days = daysFromToday(m['warranty_end_date'])!;
    if (days < 0) return ('Expired', 'Expired on ${fmtDate(m['warranty_end_date'])}');
    return ('Active', 'Valid until ${fmtDate(m['warranty_end_date'])} ($days day${days == 1 ? '' : 's'} left)');
  }

  Widget _tabBody(String tab, Json m) {
    final id = i(m['id'])!;
    switch (tab) {
      case 'Overview':
        return _overview(m);
      case 'Technical Specs':
        return DetailSection('Operator', children: [
          FieldRow('Operator name', m['operator_name']),
          FieldRow('Operator phone', m['operator_phone']),
          FieldRow('Operator email', m['operator_email']),
          FieldRow('Qualification', m['operator_qualification']),
          const Divider(),
          const Text('Technical specifications', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
          FieldRow('Software version', m['software_version']),
          FieldRow('Installed options', m['installed_options']),
          FieldRow('Specifications', m['specifications']),
          FieldRow('Engineering notes', m['tech_notes']),
        ]);
      case 'Maintenance History':
        return PmBlock<List<Json>>(
          load: () async => (await Api.list('/erp/service-requests', query: {'project_id': id, 'limit': 1000})).rows,
          builder: (ctx, srs, _) => srs.isEmpty
              ? const MutedText(
                  'No service requests raised for this machine yet — service requests are raised from the Service module when the customer reports a problem.')
              : Column(children: [
                  for (final sr in srs)
                    RecordCard(
                      code: s(sr['request_number']),
                      title: txt(sr['issue_title']),
                      status: sr['status'],
                      meta: [('Priority', humanize(sr['priority'])), ('Created', fmtDate(sr['created_at']))],
                    ),
                ]),
        );
      case 'Store Issues':
        return StoreIssuesHistory(base: '/erp/projects/$id');
      case 'Purchases':
        return PurchasesHistory(base: '/erp/projects/$id');
      case 'Tasks':
        return TaskHistory(base: '/erp/projects/$id');
      case 'Production':
        return PmBlock<List<Json>>(
          load: () async => rowsOf(await Api.get('/production/integrations/projects/$id/work-orders')),
          builder: (ctx, rows, _) => rows.isEmpty
              ? const MutedText('No production work orders are linked to this machine.')
              : Column(children: [
                  for (final o in rows)
                    RecordCard(
                      code: s(o['wo_number']),
                      title: txt(o['product_name']),
                      trailing: Pill(humanize(o['status']), hx(_woHex[s(o['status'])] ?? '#78716c')),
                      meta: [
                        ('Built / Planned', '${fmtNumber(o['quantity_completed'])} / ${fmtNumber(o['quantity_planned'])} (${o['progress_percent']}%)'),
                        ('Planned End', '${fmtDate(o['planned_end_date'])}${b(o['is_overdue']) ? ' · overdue' : ''}'),
                      ],
                    ),
                ]),
        );
      case 'Documents':
        return _MachineDocuments(machine: m);
      case 'Audit Trail':
        return PmBlock<List<Json>>(
          load: () async => rowsOf(await Api.get('/erp/projects/$id/audit')),
          builder: (ctx, rows, _) => rows.isEmpty
              ? const MutedText('No changes recorded yet — every edit to this machine will be listed here.')
              : Column(children: [
                  for (final e in rows)
                    RecordCard(
                      title: txt(e['performed_by']),
                      subtitle: s(e['summary']) ?? s(e['action']),
                      trailing: Text(fmtDateTime(e['performed_at']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                    ),
                ]),
        );
    }
    return const SizedBox.shrink();
  }

  Widget _overview(Json m) {
    final contacts = _feat('client_contacts');
    final what = [s(m['machine_type']), if (s(m['application_type']) != null) 'for ${m['application_type']}'].whereType<String>().join(' ');
    final where = [s(m['site_name']), s(m['site_location']), s(m['site_state'])].whereType<String>().join(', ');
    final sentence = [
      '${s(m['product_name']) ?? s(m['model_name']) ?? 'Machine'}${what.isNotEmpty ? ' — $what' : ''}',
      if (contacts && s(m['client_company']) != null) 'supplied to ${m['client_company']}${where.isNotEmpty ? ' at $where' : ''}',
    ].join(', ');
    String? d(String k) => s(m[k]) == null ? null : fmtDate(m[k]);
    return Column(children: [
      DetailSection(s(m['model_name']) ?? txt(m['serial_number']), children: [
        Text('$sentence.', style: const TextStyle(fontSize: 13.5, color: Brand.body)),
        const SizedBox(height: 6),
        Text(
            [
              'Serial ${m['serial_number']}',
              if (s(m['delivery_date']) != null) 'Dispatched ${fmtDate(m['delivery_date'])}',
              if (s(m['commissioning_date']) != null) 'Commissioned ${fmtDate(m['commissioning_date'])}',
              if (contacts && b(m['is_export'])) 'Export',
            ].join(' · '),
            style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
      ]),
      DetailSection('Machine identity', children: [
        FieldRow('Product', s(m['product_name']) ?? 'Not linked to a product (CRM › Products)'),
        FieldRow('Model', m['model_name']),
        FieldRow('Machine type', m['machine_type']),
        FieldRow('Application type', m['application_type']),
        FieldRow('Engine number', m['engine_number']),
        FieldRow('Chassis number', m['chassis_number']),
        FieldRow('Year of manufacture', m['year_of_manufacture']),
      ]),
      DetailSection('Timeline', children: [
        FieldRow('PO date', d('po_date')),
        FieldRow('Dispatch date', d('delivery_date')),
        FieldRow('Commissioning date', d('commissioning_date')),
        FieldRow('Handover date', d('handover_date')),
      ]),
      if (contacts) ...[
        DetailSection('Customer', children: [
          FieldRow('CRM customer',
              s(m['customer_name']) ?? 'Not linked — edit the machine and pick the Customer (needed for service invoices)'),
          FieldRow('Client company', m['client_company']),
          FieldRow('Client GST', m['client_gst']),
          FieldRow('Contact person', [s(m['client_name']), s(m['client_designation'])].whereType<String>().join(', ')),
          FieldRow('Contact email', m['client_email']),
          FieldRow('Contact phone', [s(m['client_phone']), s(m['client_phone_alt'])].whereType<String>().join(' / ')),
        ]),
        DetailSection('Site', children: [
          FieldRow('Site', m['site_name']),
          FieldRow('Location',
              [s(m['site_location']), s(m['site_state']), s(m['site_pincode']), s(m['site_country'])].whereType<String>().join(', ')),
          FieldRow('Zone', m['zone']),
          FieldRow('Export deployment', b(m['is_export']) ? 'Yes' : 'No'),
        ]),
      ],
      if (_feat('warranty'))
        DetailSection('Warranty & AMC', children: [
          FieldRow(
              'Warranty period',
              s(m['warranty_start_date']) != null || s(m['warranty_end_date']) != null
                  ? '${d('warranty_start_date') ?? '—'} → ${d('warranty_end_date') ?? '—'}'
                  : null),
          FieldRow('Warranty terms', m['warranty_override']),
          FieldRow('Extended warranty',
              b(m['extended_warranty']) ? 'Yes, until ${d('extended_warranty_end') ?? 'date not set'}' : 'No'),
          FieldRow('AMC status', m['amc_status']),
          FieldRow('AMC end date', d('amc_end_date')),
        ]),
      if (s(m['notes']) != null) DetailSection('Production notes', children: [FieldRow('Notes', m['notes'])]),
    ]);
  }

}

/// Stage of a machine: a machine linked to a project follows the project;
/// one without a project (a past machine) is set here.
class _MachineStage extends StatefulWidget {
  const _MachineStage({required this.machine, required this.canSet, required this.onChanged});
  final Json machine;
  final bool canSet;
  final ValueChanged<Json> onChanged;

  @override
  State<_MachineStage> createState() => _MachineStageState();
}

class _MachineStageState extends State<_MachineStage> {
  bool _busy = false;

  Future<void> _set(String next) async {
    final m = widget.machine;
    final stage = s(m['lifecycle_stage']) ?? 'planned';
    if (next == stage) return;
    String? reason;
    if (lifecycleOrder.indexOf(next) < lifecycleOrder.indexOf(stage)) {
      reason = await promptDialog(context,
          title: 'Move ${m['serial_number']} back to ${lifecycleLabels[next] ?? next}?',
          message: "Only an admin or a Partner can move a machine back. The reason is written in the machine's history.",
          label: 'Why is it going back?',
          confirmLabel: 'Move back');
      if (reason == null) return;
    }
    if (!mounted) return;
    setState(() => _busy = true);
    try {
      final d = obj(await Api.patch('/erp/projects/${m['id']}/lifecycle-stage',
          data: {'stage': next, 'reason': ?reason}));
      if (d != null) widget.onChanged(d);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.machine;
    final stage = s(m['lifecycle_stage']) ?? 'planned';
    final linked = m['pm_project_id'] != null;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (widget.canSet && !linked)
        AppSelect<String>(
          label: 'Stage',
          value: stage,
          clearable: false,
          enabled: !_busy,
          options: [for (final k in lifecycleOrder) Option(k, lifecycleLabels[k]!)],
          onChanged: (o) {
            if (o != null) _set(o.value);
          },
        )
      else
        Row(children: [
          const Text('Stage  ', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.muted)),
          Pill(s(m['lifecycle_stage_label']) ?? lifecycleLabels[stage] ?? stage, hx(lifecycleHex[stage] ?? '#64748b')),
        ]),
      if (linked)
        const Padding(
          padding: EdgeInsets.only(top: 4),
          child: Text('Follows its project — change the stage on the project.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        ),
      if (m['serviceable'] == false)
        const Padding(
          padding: EdgeInsets.only(top: 4),
          child: Text('Service requests open once the stage reaches Dispatched.', style: TextStyle(fontSize: 12, color: Color(0xFFB45309))),
        ),
    ]);
  }
}

/// Uploaded files and created letters of a machine.
class _MachineDocuments extends StatefulWidget {
  const _MachineDocuments({required this.machine});
  final Json machine;

  @override
  State<_MachineDocuments> createState() => _MachineDocumentsState();
}

class _MachineDocumentsState extends State<_MachineDocuments> {
  late final bool _seeUploaded = Perm.canFeature('projects', 'all_projects', 'documents', 'view');
  late final bool _seeLetters = Perm.canFeature('projects', 'all_projects', 'letters', 'view');
  late String _view = _seeUploaded ? 'uploaded' : 'created';
  List<Json>? _files;
  List<Json>? _letters;
  String? _error;
  bool _busy = false;

  int get _id => i(widget.machine['id'])!;
  bool get _canEdit => PmPerm.erp('project_edit');

  @override
  void initState() {
    super.initState();
    if (_seeUploaded) _loadFiles();
    if (_seeLetters) _loadLetters();
  }

  Future<void> _loadFiles() async {
    try {
      final r = rowsOf(await Api.get('/erp/projects/$_id/attachments'));
      if (mounted) setState(() => _files = r);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _loadLetters() async {
    try {
      final r = rowsOf(await Api.get('/erp/projects/$_id/letters'));
      if (mounted) setState(() => _letters = r);
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load created documents. ${ApiClient.describe(e)}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final canUpload = _canEdit && Perm.canFeature('projects', 'all_projects', 'documents', 'create');
    final canPrint = Perm.can('projects', 'all_projects', 'print') && Perm.canFeature('projects', 'all_projects', 'letters', 'print');
    final canCreateLetter = _canEdit && Perm.canFeature('projects', 'all_projects', 'letters', 'create');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          if (_seeUploaded)
            CountChip('Uploaded', '(${_files?.length ?? 0})', selected: _view == 'uploaded', onTap: () => setState(() => _view = 'uploaded')),
          if (_seeLetters)
            CountChip('Created', '(${_letters?.length ?? 0})', selected: _view == 'created', onTap: () => setState(() => _view = 'created')),
        ]),
        const SizedBox(height: 10),
        if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 8)],
        if (_view == 'uploaded') ...[
          if (canUpload)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Wrap(spacing: 8, runSpacing: 8, children: [
                SmallBtn(_busy ? 'Uploading…' : 'Upload files', icon: Icons.upload_file_rounded, onPressed: _busy ? null : () => _upload(false)),
                SmallBtn('Take photo', icon: Icons.photo_camera_outlined, onPressed: _busy ? null : () => _upload(true)),
              ]),
            ),
          if (_files == null)
            const LoadingView()
          else if (_files!.isEmpty)
            MutedText('No documents uploaded yet${canUpload ? ' — upload drawings, manuals or photos above.' : '.'}',
                padding: EdgeInsets.zero)
          else
            for (final a in _files!)
              FileRow(
                title: txt(a['filename']),
                sub: [s(a['uploaded_by_name']), if (s(a['created_at']) != null) fmtDate(a['created_at'])].whereType<String>().join(' · '),
                onOpen: () => openApiFile(context, '/erp/projects/$_id/attachments/${a['id']}/content', txt(a['filename'])),
                onDelete: PmPerm.canDeleteOwn('projects', 'all_projects', a['created_by_id']) &&
                        Perm.canFeature('projects', 'all_projects', 'documents', 'delete')
                    ? () => _deleteFile(a)
                    : null,
              ),
        ] else ...[
          if (canCreateLetter)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SmallBtn('+ Create New (opens the portal)', onPressed: () =>
                  runAction(context, () => Files.openInPortal('/dashboard/projects/all'))),
            ),
          if (_letters == null)
            const LoadingView()
          else if (_letters!.isEmpty)
            MutedText(
                'No documents created yet.${canCreateLetter ? ' Use “+ Create New” for a delivery cover letter, delivery confirmation or guarantee certificate.' : ''}',
                padding: EdgeInsets.zero)
          else
            for (final l in _letters!)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(txt(l['subject']), style: const TextStyle(fontWeight: FontWeight.w600, color: Color(0xFF2563EB))),
                    const SizedBox(height: 2),
                    Text(
                        [
                          if (s(l['letter_type']) != null && s(l['letter_type']) != 'general') humanize(l['letter_type']),
                          txt(l['letter_no']),
                          fmtDate(l['letter_date']),
                          if (s(l['created_by_name']) != null) 'by ${l['created_by_name']}',
                        ].join(' · '),
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      if (canPrint)
                        SmallBtn('Open in Word', icon: Icons.description_outlined, onPressed: () => openApiFile(
                            context, '/erp/projects/$_id/letters/${l['id']}/file?format=docx', '${l['letter_no']}.docx')),
                      if (canPrint)
                        SmallBtn('PDF', onPressed: () => openApiFile(
                            context, '/erp/projects/$_id/letters/${l['id']}/file?format=pdf', '${l['letter_no']}.pdf')),
                      if (PmPerm.canDeleteOwn('projects', 'all_projects', l['created_by_id']) &&
                          Perm.canFeature('projects', 'all_projects', 'letters', 'delete'))
                        SmallBtn('Delete', color: Brand.danger, onPressed: () => _deleteLetter(l)),
                    ]),
                  ]),
                ),
              ),
        ],
      ]),
    );
  }

  Future<void> _upload(bool camera) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (camera) {
        final p = await Files.takePhoto();
        if (p != null) await uploadFiles('/erp/projects/$_id/attachments', [p]);
      } else {
        await pickAndUpload('/erp/projects/$_id/attachments');
      }
      await _loadFiles();
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteFile(Json a) async {
    final ok = await confirmDialog(context,
        title: 'Delete this file?', message: 'Delete ${a['filename']}?', confirmLabel: 'Delete', danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/erp/projects/$_id/attachments/${a['id']}'))) _loadFiles();
  }

  Future<void> _deleteLetter(Json l) async {
    final ok = await confirmDialog(context,
        title: 'Delete this letter?',
        message: 'Delete ${l['letter_no']} (“${l['subject']}”)? This cannot be undone; its reference number will not be reused.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/erp/projects/$_id/letters/${l['id']}'))) _loadLetters();
  }
}
