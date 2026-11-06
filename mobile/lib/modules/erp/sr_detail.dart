import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'erp_common.dart';
import 'sr_attachments.dart';
import 'sr_form.dart';
import 'sr_materials.dart';
import 'sr_visits.dart';

/// Cancelling, or moving a closed / cancelled SR to any other status, needs a
/// reason (mirrors update_service_request).
bool _needsReason(String from, String to) =>
    to != from && (to == 'cancelled' || from == 'closed' || from == 'cancelled');

const _tabs = ['Overview', 'Visits', 'Diagnostics & RCA', 'Materials', 'Attachments', 'Audit Trail'];
const _tabFeature = {
  'Visits': 'visits',
  'Diagnostics & RCA': 'rca',
  'Materials': 'materials',
  'Attachments': 'attachments',
  'Audit Trail': 'audit_trail',
};

/// One service request (portal: app/dashboard/erp/service-requests/[id]/page.tsx).
class SrDetailScreen extends StatefulWidget {
  const SrDetailScreen({super.key, required this.srId});
  final int srId;

  @override
  State<SrDetailScreen> createState() => _SrDetailScreenState();
}

class _SrDetailScreenState extends State<SrDetailScreen> {
  Json? _sr;
  Json? _project;
  String? _projectError;
  Object? _error;
  bool _loading = true;
  String _tab = 'Overview';
  bool _closeApproval = false;
  bool _legacyApproval = false;
  int _approvalKey = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final d = await Api.get('/erp/service-requests/${widget.srId}');
      if (!mounted) return;
      setState(() {
        _sr = Map<String, dynamic>.from(d as Map);
        _loading = false;
        _approvalKey++;
      });
      _loadProject();
      _loadApprovalState();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _loadProject() async {
    try {
      final p = await Api.get('/erp/projects/${_sr!['project_id']}');
      if (mounted) {
        setState(() {
          _project = Map<String, dynamic>.from(p as Map);
          _projectError = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _project = null;
          _projectError = ApiClient.describe(e);
        });
      }
    }
  }

  /// Closure-approval banner: only while the setting is on; old Approve /
  /// Reject only for an item sent before the approval engine took over.
  Future<void> _loadApprovalState() async {
    if (_sr?['status'] != 'review') return;
    try {
      final s = await Api.get('/erp/settings');
      final on = s is Map && s['values'] is Map && (s['values'] as Map)['sr_close_approval_required'] == true;
      bool legacy = false;
      try {
        final a = await Api.get('/approvals/entity/service_request/${widget.srId}');
        legacy = a is Map && a['current'] == null;
      } catch (_) {
        legacy = false;
      }
      if (mounted) {
        setState(() {
          _closeApproval = on;
          _legacyApproval = legacy;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _closeApproval = true);
    }
  }

  Json get sr => _sr!;
  int? get _me => Perm.userId;
  bool get _isEngineer => sr['assigned_service_person_id'] != null && sr['assigned_service_person_id'] == _me;
  bool get _isCreatorEditor => sr['created_by_id'] == _me && ErpPerm.hasErp('sr_edit');

  /// Backend _can_edit: admins, the assigned engineer, or the creator with sr_edit.
  bool get _canEdit => ErpPerm.isRoleAdmin || _isEngineer || _isCreatorEditor;

  /// The edit form itself is for admins and the creator with sr_edit.
  bool get _canOpenEdit => ErpPerm.isRoleAdmin || _isCreatorEditor;
  bool get _locked => sr['is_locked'] == true;

  /// Saves a partial update; throws with the server's reason.
  Future<void> _patch(Map<String, dynamic> payload) async {
    final d = await Api.patch('/erp/service-requests/${widget.srId}', data: payload);
    if (mounted) {
      setState(() {
        _sr = Map<String, dynamic>.from(d as Map);
        _approvalKey++;
      });
      _loadApprovalState();
    }
  }

  Future<void> _requestStatus(String to) async {
    final from = (sr['status'] ?? '').toString();
    if (to == from) return;
    final num = sr['request_number'];
    final change = 'Change the status from "${stepLabel(from)}" to "${stepLabel(to)}".';
    if (_needsReason(from, to)) {
      final reason = await promptDialog(context,
          title: to == 'cancelled' ? 'Cancel $num' : 'Reopen $num',
          message: '$change Enter the reason — it is kept in the audit trail.',
          confirmLabel: to == 'cancelled' ? 'Cancel SR' : 'Reopen');
      if (reason == null || !mounted) return;
      await runAction(context, () => _patch({'status': to, 'status_reason': reason.trim()}), success: 'Status updated.');
      return;
    }
    final ok = await confirmDialog(context,
        title: 'Update Status',
        confirmLabel: 'Update Status',
        message: 'Change the status of $num from "${stepLabel(from)}" to "${stepLabel(to)}"?'
            '${to == 'closed' ? ' Closing needs the Actual Attended and Actual Completed dates (Execution card), and the client is emailed.' : ''}'
            '${to == 'cancelled' ? ' Cancelling takes it out of the normal workflow.' : ''}');
    if (!ok || !mounted) return;
    await runAction(context, () => _patch({'status': to}), success: 'Status updated.');
  }

  Future<void> _edit() async {
    final saved = await showSrForm(context, initial: sr);
    if (saved != null) _load();
  }

  Future<void> _delete() async {
    final ok = await confirmDialog(context,
        title: 'Delete this service request?',
        message: 'Delete service request ${sr['request_number']}? It can be restored from the recycle bin for 10 days.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    final done = await runAction(context, () => Api.delete('/erp/service-requests/${widget.srId}'),
        success: '${sr['request_number']} moved to the Recycle Bin.');
    if (done && mounted) Navigator.of(context).pop(true);
  }

  Future<void> _legacyDecide(bool approve) async {
    String? remarks;
    if (approve) {
      remarks = await promptDialog(context,
          title: 'Approve & close', label: 'Remarks', required: false, message: 'Add remarks if needed.', confirmLabel: 'Approve & close');
    } else {
      remarks = await promptDialog(context,
          title: 'Send back',
          message: 'Say what still has to be done — the engineer is notified and the SR goes back to In Progress.',
          confirmLabel: 'Send back');
    }
    if (remarks == null || !mounted) return;
    await runAction(context, () async {
      final d = await Api.post('/erp/service-requests/${widget.srId}/${approve ? 'approve-close' : 'reject-close'}',
          data: {'remarks': remarks!.isEmpty && approve ? null : remarks});
      if (mounted) setState(() => _sr = Map<String, dynamic>.from(d as Map));
    }, success: approve ? 'Approved and closed.' : 'Sent back to In Progress.');
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const SubPage(title: 'Service request', body: LoadingView());
    if (_sr == null) {
      return SubPage(
        title: 'Service request',
        body: ErrorView(
            'This service request could not be opened. ${_error == null ? '' : ApiClient.describe(_error!)}',
            onRetry: _load),
      );
    }
    final visibleTabs = _tabs.where((t) => _tabFeature[t] == null || ErpPerm.feat(_tabFeature[t]!)).toList();
    if (!visibleTabs.contains(_tab)) _tab = visibleTabs.first;
    final canDelete = ErpPerm.canDeleteOwn('service_requests', sr['created_by_id']);
    final status = (sr['status'] ?? '').toString();

    return SubPage(
      title: txt(sr['request_number']),
      bottom: (_canOpenEdit || canDelete)
          ? Row(children: [
              if (_canOpenEdit)
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                    onPressed: _edit,
                    icon: const Icon(Icons.edit_outlined, size: 18),
                    label: const Text('Edit'),
                  ),
                ),
              if (_canOpenEdit && canDelete) const SizedBox(width: 10),
              if (canDelete)
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                        foregroundColor: Brand.danger,
                        side: BorderSide(color: Brand.danger.withValues(alpha: 0.4)),
                        minimumSize: const Size.fromHeight(46)),
                    onPressed: _delete,
                    icon: const Icon(Icons.delete_outline_rounded, size: 18),
                    label: const Text('Delete'),
                  ),
                ),
            ])
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(txt(sr['request_number']),
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.primary)),
                const SizedBox(height: 2),
                Text(txt(sr['issue_title']),
                    style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: Brand.heading)),
              ]),
            ),
            if (status == 'review' && _closeApproval)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF59E0B).withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.3)),
                  ),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text.rich(TextSpan(style: const TextStyle(fontSize: 13, color: Color(0xFF92400E)), children: [
                      const TextSpan(text: 'Closure awaiting approval', style: TextStyle(fontWeight: FontWeight.w700)),
                      const TextSpan(
                          text: ' — The work is reported done. An approver closes it or sends it back to In Progress.'),
                      if (_legacyApproval)
                        const TextSpan(
                            text: ' Sent for approval before approvals moved to Organization › Approval Workflows, '
                                'so its original approvers decide it here.'),
                    ])),
                    if (_legacyApproval) ...[
                      const SizedBox(height: 10),
                      Wrap(spacing: 8, children: [
                        SmallButton('Approve & close', primary: true, onPressed: () => _legacyDecide(true)),
                        SmallButton('Send back', danger: true, onPressed: () => _legacyDecide(false)),
                      ]),
                    ],
                  ]),
                ),
              ),
            ApprovalPanel(
                key: ValueKey('ap$_approvalKey'),
                title: 'Closure approval',
                entityType: 'service_request',
                entityId: widget.srId,
                onChanged: _load),
            if (sr['sla_resolution_due_at'] != null && sr['resolution_at'] == null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: Text('Resolve by ${fmtDateTime(sr['sla_resolution_due_at'])}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ),
            _WorkflowSteps(status: status, canModify: _canEdit && !_locked, onTap: _requestStatus),
            SizedBox(
              height: 50,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                itemCount: visibleTabs.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (_, i) {
                  final t = visibleTabs[i];
                  final sel = t == _tab;
                  return ChoiceChip(
                    label: Text(t),
                    selected: sel,
                    showCheckmark: false,
                    selectedColor: Brand.primarySoft,
                    labelStyle: TextStyle(
                        fontWeight: FontWeight.w600, color: sel ? Brand.primaryActive : Brand.muted, fontSize: 13),
                    onSelected: (_) => setState(() => _tab = t),
                  );
                },
              ),
            ),
            const SizedBox(height: 6),
            ..._tabBody(),
          ],
        ),
      ),
    );
  }

  List<Widget> _tabBody() {
    final canModify = _canEdit && !_locked;
    switch (_tab) {
      case 'Visits':
        return [
          SrVisitsTab(
              key: ValueKey('v${sr['updated_at']}'),
              srId: widget.srId,
              srStatus: (sr['status'] ?? '').toString(),
              assignedId: sr['assigned_service_person_id'] as int?,
              onChanged: _load),
        ];
      case 'Diagnostics & RCA':
        return [_rca(canModify && ErpPerm.feat('rca', 'edit'))];
      case 'Materials':
        return [
          SrMaterialsTab(
            srId: widget.srId,
            canEdit: canModify && ErpPerm.feat('materials', 'edit'),
            canAdd: canModify && ErpPerm.feat('materials', 'create'),
            canDelete: canModify && ErpPerm.feat('materials', 'delete'),
            canRaisePr: canModify && ErpPerm.feat('purchase_requisition', 'create'),
            canIssueSpares: ErpPerm.feat('spare_issue', 'create'),
            canReturnSpares: ErpPerm.feat('spare_issue', 'edit'),
            onAttachmentsChanged: _load,
          ),
        ];
      case 'Attachments':
        return [
          SrAttachmentsTab(
            sr: sr,
            canUpload: _canEdit && ErpPerm.feat('attachments', 'create'),
            canDelete: _canEdit && ErpPerm.feat('attachments', 'delete'),
            onChanged: _load,
          ),
        ];
      case 'Audit Trail':
        return [_AuditTab(srId: widget.srId)];
      default:
        return _overview(canModify);
    }
  }

  // ── Overview ───────────────────────────────────────────────────────────────

  List<Widget> _overview(bool canModify) {
    final p = _project;
    final category = (sr['issue_category'] ?? '').toString();
    return [
      DetailSection(category.isNotEmpty ? '$category issue' : 'Reported issue', children: [
        Text(
            (sr['issue_description'] ?? '').toString().isEmpty
                ? 'No description was given when this request was raised.'
                : sr['issue_description'].toString(),
            style: const TextStyle(fontSize: 14, color: Brand.body)),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text(
              'Reported ${fmtDate(sr['created_at'])}${sr['reported_by_name'] != null ? ' by ${sr['reported_by_name']}' : ''}',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
          const Text('·', style: TextStyle(color: Brand.muted)),
          Text(sr['assigned_to_name'] != null ? 'Engineer: ${sr['assigned_to_name']}' : 'No engineer assigned yet',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
          if (_locked) const HexPill('Locked', Color(0xFF64748B)),
        ]),
      ]),
      DetailSection('Machine & site', children: [
        FieldRow(
            'Machine',
            p != null
                ? machineLabel(p)
                : _projectError != null
                    ? Text(_projectError!, style: const TextStyle(color: Brand.danger))
                    : 'Loading…'),
        FieldRow('Customer', p?['client_company']),
        FieldRow(
            'Site / location',
            p == null
                ? null
                : [p['site_name'], p['site_location']].where((v) => v != null && v.toString().isNotEmpty).join(', ')),
      ]),
      DetailSection('Reported by', children: [
        FieldRow('Name', sr['reported_by_name']),
        FieldRow('Phone', sr['reported_by_phone']),
        FieldRow('Email', sr['reported_by_email']),
      ]),
      DetailSection('Assignment & dates', children: [
        FieldRow('Engineer', sr['assigned_to_name']),
        FieldRow('Opened', fmtDate(sr['opened_at'])),
        FieldRow('Expected to attend', fmtDate(sr['expected_date_to_attend'])),
        FieldRow('Expected to close', fmtDate(sr['expected_completion_date'])),
        FieldRow('Closed', fmtDate(sr['closed_at'])),
      ]),
      DetailSection('Service notes', children: [FieldRow("Engineer's report", sr['service_report_notes'])]),
      DetailSection('Status, Type & Priority', children: [
        AppSelect<String>(
          label: 'Status',
          value: sr['status'] as String?,
          clearable: false,
          enabled: canModify,
          options: [
            for (final (k, l) in workflowSteps) Option(k, l),
            const Option('cancelled', 'Cancelled'),
          ],
          onChanged: (o) {
            if (o != null) _requestStatus(o.value);
          },
        ),
        const SizedBox(height: 12),
        AppSelect<String>(
          label: 'Service Type',
          value: sr['service_type'] as String?,
          valueLabel: sr['service_type'] == null ? null : serviceTypeLabel(sr['service_type']),
          clearable: false,
          enabled: canModify,
          options: [for (final (k, l) in serviceTypes) Option(k, l)],
          onChanged: (o) {
            if (o != null && o.value != sr['service_type']) {
              runAction(context, () => _patch({'service_type': o.value}), success: 'Service type saved.');
            }
          },
        ),
        const SizedBox(height: 12),
        AppSelect<String>(
          label: 'Priority',
          value: sr['priority'] as String?,
          clearable: false,
          enabled: canModify,
          options: priorityOptions,
          onChanged: (o) {
            if (o != null && o.value != sr['priority']) {
              runAction(context, () => _patch({'priority': o.value}), success: 'Priority saved.');
            }
          },
        ),
      ]),
      DetailSection('Execution', children: [
        FieldRow('Actual Attended',
            sr['actual_date_attended'] == null ? 'Not recorded' : fmtDate(sr['actual_date_attended'])),
        FieldRow('Actual Completed',
            sr['actual_completion_date'] == null ? 'Not recorded' : fmtDate(sr['actual_completion_date'])),
        const Padding(
          padding: EdgeInsets.only(top: 6),
          child: Row(children: [
            Text('Service charges, tax & invoice  ', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
            UpcomingPill(),
          ]),
        ),
        if (!canModify && _locked)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('This service request is locked — ask an admin to unlock it to change billing.',
                style: TextStyle(fontSize: 12, color: Brand.muted)),
          ),
        if (canModify) ...[
          const SizedBox(height: 10),
          SmallButton('Edit execution dates', icon: Icons.edit_outlined, onPressed: _editExecution),
        ],
      ]),
      if (ErpPerm.feat('invoice'))
        DetailSection('Warranty', children: [
          FieldRow('Machine cover (reported date)',
              warrantyLabels[sr['warranty_status']] ?? (sr['warranty_status'] ?? 'Not checked')),
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Row(children: [
              Text('Service billing & invoice  ', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
              UpcomingPill(),
            ]),
          ),
        ]),
    ];
  }

  Future<void> _editExecution() async {
    var attended = parseDate(sr['actual_date_attended']);
    var completed = parseDate(sr['actual_completion_date']);
    await showFormSheet(
      context,
      title: 'Execution',
      saveLabel: 'Save',
      builder: (ctx, setS) => [
        Text('${sr['request_number']} — when the engineer attended and finished.',
            style: const TextStyle(color: Brand.muted)),
        DateField(label: 'Actual Attended', value: attended, onChanged: (d) => setS(() => attended = d)),
        DateField(label: 'Actual Completed', value: completed, onChanged: (d) => setS(() => completed = d)),
      ],
      onSave: () async {
        if (attended != null && completed != null && completed!.isBefore(attended!)) {
          throw 'Actual Completed date is before the Actual Attended date — correct one of them.';
        }
        await _patch({
          'actual_date_attended': attended == null ? null : apiDate(attended!),
          'actual_completion_date': completed == null ? null : apiDate(completed!),
        });
      },
    );
  }

  // ── Diagnostics & RCA ──────────────────────────────────────────────────────

  Widget _rca(bool canModify) {
    String nr(Object? v) => (v ?? '').toString().isEmpty ? 'Not recorded' : v.toString();
    return DetailSection('Root Cause Analysis', children: [
      FieldRow('Root Cause', nr(sr['root_cause'])),
      FieldRow('Corrective Action', nr(sr['resolution_description'])),
      FieldRow('Preventive Recommendation', nr(sr['preventive_actions'])),
      if (canModify) ...[
        const SizedBox(height: 10),
        SmallButton('Edit RCA', icon: Icons.edit_outlined, onPressed: _editRca),
      ],
    ]);
  }

  Future<void> _editRca() async {
    final root = TextEditingController(text: sr['root_cause'] ?? '');
    final corrective = TextEditingController(text: sr['resolution_description'] ?? '');
    final preventive = TextEditingController(text: sr['preventive_actions'] ?? '');
    await showFormSheet(
      context,
      title: 'Root Cause Analysis',
      saveLabel: 'Save RCA',
      builder: (ctx, setS) => [
        Text('${sr['request_number']} — what really caused the fault and what was done about it.',
            style: const TextStyle(color: Brand.muted)),
        AppTextField(
            label: 'Root Cause',
            controller: root,
            maxLines: 4,
            hint: 'The underlying reason the fault happened, not just the symptom'),
        AppTextField(
            label: 'Corrective Action', controller: corrective, maxLines: 4, hint: 'What was done on this machine to fix it'),
        AppTextField(
            label: 'Preventive Recommendation',
            controller: preventive,
            maxLines: 4,
            hint: 'What should change so it never happens again'),
      ],
      onSave: () => _patch({
        'root_cause': root.text,
        'resolution_description': corrective.text,
        'preventive_actions': preventive.text,
      }),
    );
  }
}

/// The SR stepper (portal WorkflowSteps): tap a step to move the status there.
class _WorkflowSteps extends StatelessWidget {
  const _WorkflowSteps({required this.status, required this.canModify, required this.onTap});
  final String status;
  final bool canModify;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    if (status == 'cancelled') {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Brand.danger.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Brand.danger.withValues(alpha: 0.2)),
          ),
          child: const Text.rich(TextSpan(children: [
            TextSpan(text: 'Cancelled  ', style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFFB91C1C))),
            TextSpan(
                text: 'This service request was cancelled and is no longer moving through the normal workflow.',
                style: TextStyle(fontSize: 12.5, color: Brand.muted)),
          ])),
        ),
      );
    }
    final active = workflowSteps.indexWhere((s) => s.$1 == status);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
      child: Card(
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          child: Row(children: [
            for (var i = 0; i < workflowSteps.length; i++) ...[
              _step(i, active),
              if (i < workflowSteps.length - 1)
                Container(
                  width: 22,
                  height: 2,
                  margin: const EdgeInsets.only(bottom: 18),
                  color: i < active ? const Color(0xFF4ADE80) : Brand.border,
                ),
            ],
          ]),
        ),
      ),
    );
  }

  Widget _step(int i, int active) {
    final (key, label) = workflowSteps[i];
    final done = i < active;
    final isActive = i == active;
    final clickable = canModify && !isActive;
    final circle = done ? const Color(0xFF22C55E) : (isActive ? Brand.primary : Colors.white);
    final labelColor = isActive ? Brand.primary : (done ? const Color(0xFF16A34A) : const Color(0xFFA8A29E));
    return InkWell(
      onTap: clickable ? () => onTap(key) : null,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.all(2),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: circle,
              shape: BoxShape.circle,
              border: Border.all(
                  width: 2, color: done ? const Color(0xFF22C55E) : (isActive ? Brand.primary : Brand.border)),
            ),
            child: Text(done ? '✓' : '${i + 1}',
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: done || isActive ? Colors.white : const Color(0xFFA8A29E))),
          ),
          const SizedBox(height: 4),
          Text(label.toUpperCase(), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: labelColor)),
        ]),
      ),
    );
  }
}

/// Audit Trail sub-tab.
class _AuditTab extends StatefulWidget {
  const _AuditTab({required this.srId});
  final int srId;

  @override
  State<_AuditTab> createState() => _AuditTabState();
}

class _AuditTabState extends State<_AuditTab> {
  late final Future<ApiPage> _future = Api.list('/erp/service-requests/${widget.srId}/audit');

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<ApiPage>(
      future: _future,
      builder: (ctx, s) {
        if (s.connectionState != ConnectionState.done) return const LoadingView();
        if (s.hasError) return Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(ApiClient.describe(s.error!)));
        final rows = s.data!.rows;
        if (rows.isEmpty) return const EmptyView('No audit history yet.');
        return Column(children: [
          for (final e in rows)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(
                        child: Text(txt(e['performed_by']),
                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Brand.heading)),
                      ),
                      Text(e['performed_at'] == null ? '' : fmtDateTime(e['performed_at']),
                          style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                    ]),
                    const SizedBox(height: 4),
                    Text(txt(e['summary'] ?? e['action']), style: const TextStyle(fontSize: 13, color: Brand.body)),
                  ]),
                ),
              ),
            ),
        ]);
      },
    );
  }
}
