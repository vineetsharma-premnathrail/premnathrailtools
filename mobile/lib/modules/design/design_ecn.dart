import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'design_boms.dart';
import 'design_changes.dart';
import 'design_common.dart';
import 'design_documents.dart';

/// Change notices (ECN) - portal change-notices/new, components/design/
/// ChangeNoticeForm.tsx and change-notices/[id].

const ecnStatusColors = {
  'draft': Color(0xFF78716C),
  'submitted': Color(0xFFF59E0B),
  'approved': Color(0xFF2563EB),
  'rejected': Color(0xFFDC2626),
  'implemented': Color(0xFF16A34A),
  'closed': Color(0xFF0F766E),
  'cancelled': Color(0xFFA8A29E),
};

Widget ecnStatusBadge(Object? s) => StatusBadge(labelOf(ecnStatusLabels, s), color: ecnStatusColors[str(s)]);

const _implLabels = {
  'pending': 'No revision yet',
  'draft': 'Draft',
  'in_review': 'In Review',
  'in_approval': 'In Approval',
  'approved': 'Awaiting customer',
  'released': 'Released',
  'customer_rejected': 'Customer rejected',
};
const _implColors = {
  'pending': Color(0xFFDC2626),
  'draft': Color(0xFF78716C),
  'in_review': Color(0xFF2563EB),
  'in_approval': Color(0xFF7C3AED),
  'approved': Color(0xFF0891B2),
  'released': Color(0xFF16A34A),
  'customer_rejected': Color(0xFFDC2626),
};

// ── Effectivity & disposition (EffectivityFields) ────────────────────────────

class EcnEffectivity {
  EcnEffectivity([Json? from])
      : type = str(from?['effectivity_type']).isEmpty ? 'immediate' : str(from?['effectivity_type']),
        date = parseDate(from?['effectivity_date']),
        serial = TextEditingController(text: str(from?['effectivity_serial'])),
        note = TextEditingController(text: str(from?['effectivity_note'])),
        stock = str(from?['stock_disposition']).isEmpty ? 'not_applicable' : str(from?['stock_disposition']),
        wip = str(from?['wip_disposition']).isEmpty ? 'not_applicable' : str(from?['wip_disposition']),
        dispositionNote = TextEditingController(text: str(from?['disposition_note']));

  String type;
  DateTime? date;
  final TextEditingController serial;
  final TextEditingController note;
  String stock;
  String wip;
  final TextEditingController dispositionNote;

  List<Widget> fields(StateSetter setS, {String projectHint = 'Applies to the Project / Machine above'}) => [
        AppSelect<String>(
            label: 'Change takes effect',
            clearable: false,
            value: type,
            options: optionsOf(ecnEffectivityLabels),
            onChanged: (o) => setS(() => type = o?.value ?? type)),
        if (type == 'date') DateField(label: 'Effective from', required: true, value: date, onChanged: (d) => setS(() => date = d)),
        if (type == 'serial') AppTextField(label: 'From serial no.', required: true, controller: serial, hint: 'e.g. RRV-0045'),
        AppTextField(
            label: 'Effectivity note',
            controller: note,
            hint: type == 'project' ? projectHint : 'e.g. units already dispatched are not retrofitted'),
        AppSelect<String>(
            label: 'Stock on hand', clearable: false, value: stock, options: optionsOf(dispositionLabels), onChanged: (o) => setS(() => stock = o?.value ?? stock)),
        AppSelect<String>(
            label: 'Work in progress', clearable: false, value: wip, options: optionsOf(dispositionLabels), onChanged: (o) => setS(() => wip = o?.value ?? wip)),
        AppTextField(label: 'Disposition note', controller: dispositionNote, hint: 'e.g. rework the 12 brackets in stock by adding the gusset'),
      ];

  void validate() {
    if (type == 'date' && date == null) {
      throw 'Effectivity is "From a date" — pick the date the change takes effect, or choose another effectivity.';
    }
    if (type == 'serial' && serial.text.trim().isEmpty) {
      throw 'Effectivity is "From a serial number" — enter the first serial number the change applies to.';
    }
  }

  Map<String, dynamic> payload() => {
        'effectivity_type': type,
        'effectivity_date': type == 'date' ? apiDateOrNull(date) : null,
        'effectivity_serial': type == 'serial' ? nullIfEmpty(serial.text) : null,
        'effectivity_note': nullIfEmpty(note.text),
        'stock_disposition': stock,
        'wip_disposition': wip,
        'disposition_note': nullIfEmpty(dispositionNote.text),
      };
}

class _Affected {
  _Affected(this.id, this.label, String desc) : desc = TextEditingController(text: desc);
  final int id;
  final String label;
  final TextEditingController desc;
}

/// New ECN / Edit ECN (ChangeNoticeForm). Returns the ECN id.
Future<int?> showEcnForm(BuildContext context, {Json? existing}) async {
  final e = existing;
  final title = TextEditingController(text: str(e?['title']));
  final description = TextEditingController(text: str(e?['description']));
  final impact = TextEditingController(text: str(e?['impact_assessment']));
  String reason = str(e?['reason']).isEmpty ? 'design_improvement' : str(e?['reason']);
  String priority = priorityLabel(e?['priority']) == 'Urgent' ? 'urgent' : 'standard';
  DateTime? target = parseDate(e?['target_date']);
  int? projectId = asInt(e?['pm_project_id']), machineId = asInt(e?['erp_project_id']), approverId = asInt(e?['approver_id']);
  String? projectL = nullIfEmpty(str(e?['pm_project_label'])), machineL = nullIfEmpty(str(e?['erp_project_label']));
  String? approverL = nullIfEmpty(str(e?['approver_name']));
  final docs = [
    for (final d in jsonList(e?['documents'])) _Affected(asInt(d['document_id'])!, '${d['doc_number']} — ${d['title']}', str(d['change_description'])),
  ];
  final boms = [
    for (final b in jsonList(e?['boms']))
      _Affected(asInt(b['bom_id'])!, '${str(b['bom_number']).isEmpty ? 'BOM #${b['bom_id']}' : b['bom_number']} — ${str(b['title'])}', str(b['change_description'])),
  ];
  final eff = EcnEffectivity(e);
  int? id;
  await showFormSheet(
    context,
    title: e == null ? 'New Change Notice' : 'Edit ${e['ecn_number']}',
    saveLabel: e == null ? 'Create ECN' : 'Save',
    builder: (ctx, setS) => [
      if (e != null) InfoNote('${e['title']} — every field can be changed until the ECN is submitted for approval.'),
      const Caps('Change'),
      AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Increase bogie gusset thickness'),
      AppSelect<String>(label: 'Reason', clearable: false, value: reason, options: optionsOf(ecnReasonLabels), onChanged: (o) => setS(() => reason = o?.value ?? reason)),
      AppSelect<String>(
          label: 'Priority', clearable: false, value: priority, options: optionsOf(priorityLabels), onChanged: (o) => setS(() => priority = o?.value ?? priority)),
      DateField(label: 'Target date', value: target, onChanged: (d) => setS(() => target = d)),
      AppTextField(label: 'Description — what is changing', controller: description, maxLines: 3),
      AppTextField(label: 'Impact — production, stock, cost, in-service units', controller: impact, maxLines: 3),
      const Caps('Associations & approval'),
      AppSelect<int>(
          label: 'Project',
          value: projectId,
          valueLabel: projectL,
          loadOptions: (s) => designLookup('projects', s),
          onChanged: (o) => setS(() {
                projectId = o?.value;
                projectL = o?.label;
              })),
      AppSelect<int>(
          label: 'Machine',
          value: machineId,
          valueLabel: machineL,
          loadOptions: (s) => designLookup('machines', s),
          onChanged: (o) => setS(() {
                machineId = o?.value;
                machineL = o?.label;
              })),
      AppSelect<int>(
          label: 'Approver',
          value: approverId,
          valueLabel: approverL,
          loadOptions: (s) => designUsers(s, excludeMe: true),
          onChanged: (o) => setS(() {
                approverId = o?.value;
                approverL = o?.label;
              })),
      const Caps('Affected documents'),
      for (final r in docs) _affectedRow(r, 'What changes in this document', () => setS(() => docs.remove(r))),
      AppSelect<int>(
        key: ValueKey('docs${docs.length}'),
        label: 'Search active documents by number or title to add…',
        value: null,
        loadOptions: (s) async => (await designLookup('documents', s, query: {'limit': 500}, sendSearch: true))
            .where((o) => !docs.any((r) => r.id == o.value))
            .toList(),
        onChanged: (o) {
          if (o != null) setS(() => docs.add(_Affected(o.value, o.label, '')));
        },
      ),
      const Caps('Affected BOMs'),
      for (final r in boms) _affectedRow(r, 'What changes in this BOM', () => setS(() => boms.remove(r))),
      AppSelect<int>(
        key: ValueKey('boms${boms.length}'),
        label: 'Search BOMs by number or title to add…',
        value: null,
        loadOptions: (s) async => (await designLookup('boms', s, query: {'released_only': false})).where((o) => !boms.any((r) => r.id == o.value)).toList(),
        onChanged: (o) {
          if (o != null) setS(() => boms.add(_Affected(o.value, o.label, '')));
        },
      ),
      const Caps('Effectivity & disposition'),
      ...eff.fields(setS),
    ],
    onSave: () async {
      if (title.text.trim().length < 3) throw 'Give the change notice a title (at least 3 characters).';
      eff.validate();
      final payload = {
        'title': title.text.trim(),
        'reason': reason,
        'priority': priority,
        'description': nullIfEmpty(description.text),
        'impact_assessment': nullIfEmpty(impact.text),
        'target_date': apiDateOrNull(target),
        'pm_project_id': projectId,
        'erp_project_id': machineId,
        'approver_id': approverId,
        'documents': [for (final r in docs) {'document_id': r.id, 'change_description': nullIfEmpty(r.desc.text)}],
        'boms': [for (final r in boms) {'bom_id': r.id, 'change_description': nullIfEmpty(r.desc.text)}],
        ...eff.payload(),
      };
      final out = jsonMap(e == null ? await Api.post('/design/change-notices', data: payload) : await Api.patch('/design/change-notices/${e['id']}', data: payload));
      id = asInt(out['id']);
    },
  );
  return id;
}

Widget _affectedRow(_Affected r, String hint, VoidCallback onRemove) => Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
      decoration: BoxDecoration(color: Brand.background, border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(r.label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
          IconButton(icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger, size: 20), onPressed: onRemove),
        ]),
        Padding(padding: const EdgeInsets.only(right: 8), child: AppTextField(label: hint, controller: r.desc)),
      ]),
    );

// ── Detail ───────────────────────────────────────────────────────────────────

const _eventLabels = {
  'ecn_created': 'raised the change notice',
  'ecn_updated': 'edited it',
  'ecn_submitted': 'submitted it for approval',
  'ecn_approved': 'approved it',
  'ecn_rejected': 'rejected it',
  'ecn_implemented': 'released the ECN',
  'ecn_cancelled': 'cancelled it',
  'comment': 'commented',
  'document_revision_started': 'started a drawing revision under it',
  'document_released': 'released a drawing revision under it',
  'ecn_created_from_ecr': 'created it from the approved change request',
  'ecn_effectivity_updated': 'updated the effectivity / disposition',
  'ecn_acknowledged': 'acknowledged it',
  'ecn_closed': 'closed it (all departments acknowledged)',
  'bom_revision_started': 'started a BOM revision under it',
  'bom_released': 'released a BOM revision under it',
};

class DesignChangeNoticeDetail extends StatefulWidget {
  const DesignChangeNoticeDetail({super.key, required this.id});
  final int id;

  @override
  State<DesignChangeNoticeDetail> createState() => _DesignChangeNoticeDetailState();
}

class _DesignChangeNoticeDetailState extends State<DesignChangeNoticeDetail> {
  Json? _ecn;
  Object? _error;
  bool _busy = false;
  int _approvalKey = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = jsonMap(await Api.get('/design/change-notices/${widget.id}'));
      if (mounted) setState(() => (_ecn = d, _error = null, _approvalKey++));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  bool _can(String a) => strList(_ecn?['allowed_actions']).contains(a);

  Future<void> _act(Future<dynamic> Function() fn, String done) async {
    setState(() => _busy = true);
    Json? out;
    final ok = await runAction(context, () async {
      final r = await fn();
      if (r is Map) out = jsonMap(r);
    }, success: done);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (ok && out != null && out!.containsKey('ecn_number')) {
        _ecn = out;
        _approvalKey++;
      }
    });
  }

  Future<void> _confirm(String which) async {
    final e = _ecn!;
    final (title, message, label) = switch (which) {
      'submit' => (
          'Submit for approval?',
          "${e['ecn_number']} goes to ${str(e['approver_name']).isEmpty ? 'the approver' : e['approver_name']} for a decision. It can't be edited after this.",
          'Submit'
        ),
      'implement' => (
          'Release this ECN?',
          'Every affected drawing and BOM has a released revision under this ECN. The effectivity and disposition are frozen, and Production, Purchase, Store, Quality and Project are asked to acknowledge it.',
          'Release ECN'
        ),
      _ => ('Delete this draft?', 'The draft change notice is deleted.', 'Delete'),
    };
    if (!await confirmDialog(context, title: title, message: message, confirmLabel: label, danger: which == 'delete') || !mounted) return;
    switch (which) {
      case 'submit':
        await _act(() => Api.post('/design/change-notices/${e['id']}/submit'),
            '${e['ecn_number']} submitted — ${str(e['approver_name']).isEmpty ? 'the approver' : e['approver_name']} has been notified.');
      case 'implement':
        await _act(() => Api.post('/design/change-notices/${e['id']}/implement'), '${e['ecn_number']} released — the departments have been asked to acknowledge it.');
      default:
        setState(() => _busy = true);
        final done = await runAction(context, () => Api.delete('/design/change-notices/${e['id']}'), success: '${e['ecn_number']} deleted.');
        if (!mounted) return;
        setState(() => _busy = false);
        if (done) Navigator.of(context).pop();
    }
  }

  Future<void> _prompt(String which) async {
    final e = _ecn!;
    final (title, label, required) = switch (which) {
      'approve' => ('Approve change notice', 'Approve', false),
      'reject' => ('Reject change notice', 'Reject', true),
      _ => ('Cancel change notice', 'Cancel ECN', true),
    };
    final v = await promptDialog(context,
        title: title,
        message: '${e['ecn_number']} — ${e['title']}',
        label: which == 'approve' ? 'Comment' : 'Reason',
        required: required,
        confirmLabel: label);
    if (v == null || !mounted) return;
    switch (which) {
      case 'approve':
        await _act(() => Api.post('/design/change-notices/${e['id']}/approve', data: {'comment': nullIfEmpty(v)}), '${e['ecn_number']} approved.');
      case 'reject':
        await _act(() => Api.post('/design/change-notices/${e['id']}/reject', data: {'comment': v}), '${e['ecn_number']} rejected.');
      default:
        if (v.length < 3) {
          showSnack(context, 'Give a reason for cancelling the ECN (at least 3 characters).', error: true);
          return;
        }
        await _act(() => Api.post('/design/change-notices/${e['id']}/cancel', data: {'reason': v}), '${e['ecn_number']} cancelled.');
    }
  }

  Future<void> _acknowledge(Json a) async {
    final e = _ecn!;
    final dept = labelOf(ackDepartmentLabels, a['department']);
    final v = await promptDialog(context,
        title: 'Acknowledge for $dept', message: '${e['ecn_number']} — ${e['title']}', label: 'Remarks', required: false, confirmLabel: 'Acknowledge');
    if (v == null || !mounted) return;
    await _act(() => Api.post('/design/change-notices/${e['id']}/acknowledge', data: {'department': a['department'], 'remarks': nullIfEmpty(v)}),
        '${e['ecn_number']} acknowledged for $dept.');
  }

  Future<void> _editEffectivity() async {
    final e = _ecn!;
    final eff = EcnEffectivity(e);
    DateTime? target = parseDate(e['target_date']);
    final saved = await showFormSheet(context, title: 'Effectivity & disposition', builder: (ctx, setS) => [
          InfoNote('${e['ecn_number']} — when the change takes effect and what happens to stock and work in progress.'),
          DateField(label: 'Target date', value: target, onChanged: (d) => setS(() => target = d)),
          ...eff.fields(setS),
        ], onSave: () async {
      eff.validate();
      final out = await Api.patch('/design/change-notices/${e['id']}/effectivity', data: {...eff.payload(), 'target_date': apiDateOrNull(target)});
      if (mounted && out is Map) setState(() => _ecn = jsonMap(out));
    });
    if (saved && mounted) showSnack(context, 'Effectivity & disposition saved.');
  }

  List<DAction> _actions(Json e) {
    final engine = e['approval_engine'] == true;
    return [
      if (_can('submit')) DAction('Submit for Approval', () => _confirm('submit'), primary: true),
      if (_can('approve') && !engine) DAction('Approve', () => _prompt('approve'), primary: true),
      if (_can('reject') && !engine) DAction('Reject', () => _prompt('reject'), danger: true),
      if (_can('implement')) DAction('Release ECN', () => _confirm('implement'), primary: true),
      if (_can('edit'))
        DAction('Edit', () async {
          final id = await showEcnForm(context, existing: e);
          if (id != null && mounted) {
            showSnack(context, '${e['ecn_number']} saved.');
            _load();
          }
        }),
      if (_can('edit_effectivity')) DAction('Edit effectivity', _editEffectivity),
      if (_can('cancel')) DAction('Cancel ECN', () => _prompt('cancel'), danger: true),
      if (_can('delete')) DAction('Delete', () => _confirm('delete'), danger: true),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final e = _ecn;
    return SubPage(
      title: e == null ? 'Change notice' : str(e['ecn_number']),
      bottom: e == null ? null : actionBar(context, _actions(e), busy: _busy),
      body: e == null ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()) : RefreshIndicator(onRefresh: _load, child: _body(e)),
    );
  }

  String _effectivityText(Json e) {
    final base = labelOf(ecnEffectivityLabels, e['effectivity_type']);
    final t = str(e['effectivity_type']);
    if (t == 'date' && e['effectivity_date'] != null) return '$base: ${fmtDate(e['effectivity_date'])}';
    if (t == 'serial' && str(e['effectivity_serial']).isNotEmpty) return '$base: ${e['effectivity_serial']}';
    if (t == 'project') return '$base: ${str(e['pm_project_label'] ?? e['erp_project_label']).isEmpty ? 'not set' : (e['pm_project_label'] ?? e['erp_project_label'])}';
    return base;
  }

  Widget _body(Json e) {
    final docs = jsonList(e['documents']);
    final boms = jsonList(e['boms']);
    final acks = jsonList(e['acknowledgements']);
    final events = jsonList(e['events']);
    return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
      DetailSection(str(e['title']), children: [
        Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          ecnStatusBadge(e['status']),
          StatusBadge(priorityLabel(e['priority']), color: priorityLabel(e['priority']) == 'Urgent' ? Brand.danger : const Color(0xFF64748B)),
          Text('Target ${fmtDate(e['target_date'])}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          Text('Raised by ${txt(e['created_by_name'])} · ${fmtDate(e['created_at'])}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
        if (str(e['description']).isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(str(e['description']))),
      ]),
      DetailSection('Change', children: [
        FieldRow('Impact', e['impact_assessment']),
        FieldRow('Reason', labelOf(ecnReasonLabels, e['reason'])),
        if (e['ecr_id'] != null)
          FieldRow(
              'From change request',
              InkWell(
                onTap: () => openScreen(context, DesignChangeRequestDetail(id: asInt(e['ecr_id'])!)),
                child: Text(txt(e['ecr_number']), style: const TextStyle(color: Brand.primaryActive, fontWeight: FontWeight.w600)),
              )),
      ]),
      DetailSection('Linked to', children: [
        FieldRow('Project', e['pm_project_label']),
        FieldRow('Machine', e['erp_project_label']),
      ]),
      DetailSection('Approval & release', children: [
        FieldRow('Approver', str(e['approver_name']).isEmpty ? 'Not named yet' : e['approver_name']),
        if (e['decided_at'] != null)
          FieldRow(str(e['status']) == 'rejected' ? 'Rejected by' : 'Approved by',
              '${txt(e['decided_by_name'])} · ${fmtDate(e['decided_at'])}${str(e['decision_comment']).isEmpty ? '' : ' — ${e['decision_comment']}'}'),
        if (e['implemented_at'] != null) FieldRow('Released', '${txt(e['implemented_by_name'])} · ${fmtDate(e['implemented_at'])}'),
        if (e['closed_at'] != null) FieldRow('Closed', fmtDate(e['closed_at'])),
        if (e['cancelled_at'] != null) FieldRow('Cancelled', '${fmtDate(e['cancelled_at'])}${str(e['cancel_reason']).isEmpty ? '' : ' — ${e['cancel_reason']}'}'),
      ]),
      DesignApprovalPanel(key: ValueKey('ap$_approvalKey'), entityType: 'design_ecn', entityId: asInt(e['id'])!, title: 'ECN approval', onChanged: _load),
      DetailSection('Affected drawings (${docs.length})', children: [
        if (docs.isEmpty) const Text('No drawings on this ECN.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final d in docs)
          InkWell(
            onTap: () => openScreen(context, DesignDocumentDetail(id: asInt(d['document_id'])!)),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('${d['doc_number']} — ${txt(d['title'])}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading))),
                  StatusBadge(labelOf(_implLabels, d['implementation_status']), color: _implColors[str(d['implementation_status'])]),
                ]),
                if (str(d['change_description']).isNotEmpty) Text(str(d['change_description']), style: const TextStyle(fontSize: 12.5)),
                Text(
                    'Owner ${txt(d['owner_name'])} · Controlled rev ${txt(d['released_revision_label'])} · Under this ECN ${txt(d['ecn_revision_label'])}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
            ),
          ),
      ]),
      if (boms.isNotEmpty)
        DetailSection('Affected BOMs (${boms.length})', children: [
          for (final b in boms)
            InkWell(
              onTap: () => openScreen(context, DesignBomDetail(id: asInt(b['bom_id'])!)),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text('${b['bom_number']} — ${txt(b['title'])}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading))),
                    StatusBadge(labelOf(_implLabels, b['implementation_status']), color: _implColors[str(b['implementation_status'])]),
                  ]),
                  if (str(b['change_description']).isNotEmpty) Text(str(b['change_description']), style: const TextStyle(fontSize: 12.5)),
                  Text('Released rev ${txt(b['released_revision_label'])} · Under this ECN ${txt(b['ecn_revision_label'])}',
                      style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ]),
              ),
            ),
        ]),
      DetailSection('Effectivity & disposition', children: [
        FieldRow('Takes effect', _effectivityText(e)),
        FieldRow('Stock on hand', labelOf(dispositionLabels, e['stock_disposition'])),
        FieldRow('Work in progress', labelOf(dispositionLabels, e['wip_disposition'])),
        if (str(e['effectivity_note']).isNotEmpty) FieldRow('Effectivity note', e['effectivity_note']),
        if (str(e['disposition_note']).isNotEmpty) FieldRow('Disposition note', e['disposition_note']),
      ]),
      if (acks.isNotEmpty)
        DetailSection('Department acknowledgements (${e['acknowledged_count']} / ${acks.length})', children: [
          for (final a in acks)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(labelOf(ackDepartmentLabels, a['department']), style: const TextStyle(fontWeight: FontWeight.w600)),
                    if (a['acknowledged_at'] != null)
                      Text('${txt(a['acknowledged_by_name'])} · ${fmtDateTime(a['acknowledged_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    if (str(a['remarks']).isNotEmpty) Text(str(a['remarks']), style: const TextStyle(fontSize: 12.5)),
                  ]),
                ),
                if (a['acknowledged_at'] == null) const StatusBadge('Pending', color: Brand.warning),
                if (a['can_acknowledge'] == true && a['acknowledged_at'] == null)
                  TextButton(onPressed: _busy ? null : () => _acknowledge(a), child: const Text('Acknowledge')),
              ]),
            ),
        ]),
      DetailSection(
        'Timeline',
        action: TextButton.icon(
                icon: const Icon(Icons.add_comment_outlined, size: 18),
                label: const Text('Comment'),
                onPressed: () async {
                  final t = await promptDialog(context, title: 'Add a comment', label: 'Comment', confirmLabel: 'Post');
                  if (t == null || t.isEmpty || !mounted) return;
                  await _act(() => Api.post('/design/change-notices/${e['id']}/comments', data: {'comment': t}), 'Comment added.');
                }),
        children: [
          if (events.isEmpty) const Text('No activity yet.', style: TextStyle(color: Brand.muted)),
          for (final ev in events)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text.rich(TextSpan(style: const TextStyle(fontSize: 13), children: [
                  TextSpan(text: str(ev['actor_name']).isEmpty ? 'System' : str(ev['actor_name']), style: const TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(text: ' ${_eventLabels[str(ev['action'])] ?? str(ev['action']).replaceAll('_', ' ')}'),
                  if (str(ev['doc_number']).isNotEmpty) TextSpan(text: ' · ${ev['doc_number']} ${str(ev['revision_label'])}', style: const TextStyle(color: Brand.muted)),
                ])),
                if (str(ev['comment']).isNotEmpty) Text(str(ev['comment']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                Text(fmtDateTime(ev['created_at']), style: const TextStyle(fontSize: 11, color: Brand.muted)),
              ]),
            ),
        ],
      ),
    ]);
  }
}
