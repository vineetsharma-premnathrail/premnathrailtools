// Troubleshooting tab - phone copy of frontend/src/components/electrical/IssuesTab.tsx:
// the job's fault log - Log Issue, Start investigating, Resolve (root cause +
// corrective action), Close, Reopen, Edit, Delete.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'common.dart';

const _openStatuses = ['open', 'investigating'];

class IssuesTab extends StatefulWidget {
  const IssuesTab({super.key, required this.job, required this.meta, required this.canEdit, required this.onChanged});
  final Json job;
  final ElecMeta meta;
  final bool canEdit;
  final VoidCallback onChanged;

  @override
  State<IssuesTab> createState() => _IssuesTabState();
}

class _IssuesTabState extends State<IssuesTab> {
  List<Json> _issues = [];
  bool _loading = true;
  String? _error;
  bool _openOnly = true;
  int? _busyId;

  Json get job => widget.job;
  int get jobId => asInt(job['id'])!;
  String get jobNo => str(job['job_number']);
  bool get _canLog => widget.canEdit && (Elec.jf('issues', 'create') || Elec.can('troubleshooting', 'create'));
  bool get _canWork => widget.canEdit && (Elec.jf('issues', 'edit') || Elec.can('troubleshooting', 'edit'));
  bool get _canRemove => Elec.jf('issues', 'delete') || Elec.can('troubleshooting', 'delete');
  bool _mayDelete(Json i) =>
      _openStatuses.contains(i['status']) && _canRemove && Elec.canDelete('troubleshooting', i['reported_by_id']);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = rowsOf(await Api.get('/electrical/jobs/$jobId/issues'));
      if (mounted) {
        setState(() {
          _issues = rows;
          _error = null;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = "Couldn't load this job's troubleshooting log. Pull down to try again. ${ApiClient.describe(e)}";
          _loading = false;
        });
      }
    }
  }

  Future<void> _after(String msg) async {
    await _load();
    widget.onChanged();
    if (mounted) showSnack(context, msg);
  }

  Future<void> _openForm([Json? editing]) async {
    final title = TextEditingController(text: str(editing?['title']));
    final symptom = TextEditingController(text: str(editing?['symptom']));
    var severity = editing == null ? 'major' : str(editing['severity']);
    int? testId = asInt(editing?['test_id']);
    int? panelId = asInt(editing?['panel_id']);
    int? cableId = asInt(editing?['cable_id']);
    int? assignee = asInt(editing?['assigned_to_id']);
    String? assigneeLabel = str(editing?['assigned_to_name']).isEmpty ? null : str(editing?['assigned_to_name']);

    List<Json> tests = [], panels = [], cables = [];
    try {
      final seeTests = Elec.sees('tests') || Elec.can('testing', 'view');
      if (seeTests) tests = rowsOf(await Api.get('/electrical/jobs/$jobId/tests'));
      if (Elec.sees('panels')) panels = rowsOf(await Api.get('/electrical/jobs/$jobId/panels'));
      if (Elec.sees('cables')) cables = rowsOf(await Api.get('/electrical/jobs/$jobId/cables'));
    } catch (e) {
      if (mounted) {
        showSnack(context,
            "Couldn't load this job's tests / panels / cables for the pickers — you can still log the issue without them. ${ApiClient.describe(e)}",
            error: true);
      }
    }
    if (!mounted) return;
    String testLabel(Json t) =>
        '${t['test_number']} · ${widget.meta.testTypes[str(t['test_type'])] ?? str(t['test_type']).replaceAll('_', ' ')} · '
        '${testResultLabels[str(t['result'])] ?? str(t['result'])}${asBool(t['needs_retest']) ? ' (needs retest)' : ''}';
    Json? saved;

    final ok = await showFormSheet(
      context,
      title: editing == null ? 'Log Issue' : 'Edit Issue ${editing['issue_number']}',
      saveLabel: editing == null ? 'Log Issue' : 'Save Changes',
      builder: (ctx, setS) => [
        Muted(editing == null ? 'A fault found on $jobNo — it stays open until resolved.' : '${editing['title']} — $jobNo'),
        const FormHeading('The Fault'),
        AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Tail lamp flickers under load'),
        AppSelect<String>(
          label: 'Severity',
          value: severity,
          clearable: false,
          options: optionsOf(severityLabels),
          onChanged: (o) => setS(() => severity = o?.value ?? severity),
        ),
        AppTextField(
            label: 'Symptom', controller: symptom, maxLines: 4, hint: 'What was observed, when, and under what conditions'),
        const FormHeading('Assignment'),
        AppSelect<int>(
          label: 'Assigned To',
          value: assignee,
          valueLabel: assigneeLabel,
          loadOptions: (q) =>
              userOptions(ruleKey: 'electrical:jobs.issues', keep: asInt(editing?['assigned_to_id']), search: q),
          onChanged: (o) => setS(() {
            assignee = o?.value;
            assigneeLabel = o?.label;
          }),
        ),
        const FormHeading('Where It Was Found (optional)'),
        AppSelect<int>(
          label: 'Linked Test',
          value: testId,
          valueLabel: str(editing?['test_number']).isEmpty ? null : str(editing?['test_number']),
          options: [for (final t in tests) Option(asInt(t['id'])!, testLabel(t))],
          onChanged: (o) => setS(() => testId = o?.value),
        ),
        AppSelect<int>(
          label: 'Panel',
          value: panelId,
          valueLabel: str(editing?['panel_tag']).isEmpty ? null : str(editing?['panel_tag']),
          options: [for (final p in panels) Option(asInt(p['id'])!, '${p['panel_tag']} — ${p['name']}')],
          onChanged: (o) => setS(() => panelId = o?.value),
        ),
        AppSelect<int>(
          label: 'Cable',
          value: cableId,
          valueLabel: str(editing?['cable_tag']).isEmpty ? null : str(editing?['cable_tag']),
          options: [for (final c in cables) Option(asInt(c['id'])!, '${c['cable_tag']} · ${c['from_point']} → ${c['to_point']}')],
          onChanged: (o) => setS(() => cableId = o?.value),
        ),
      ],
      onSave: () async {
        if (title.text.trim().isEmpty) throw 'Give the issue a short title describing the fault.';
        final payload = {
          'title': title.text.trim(),
          'symptom': strOrNull(symptom.text),
          'severity': severity,
          'test_id': testId,
          'panel_id': panelId,
          'cable_id': cableId,
          'assigned_to_id': assignee,
        };
        saved = asJson(editing == null
            ? await Api.post('/electrical/jobs/$jobId/issues', data: payload)
            : await Api.patch('/electrical/issues/${editing['id']}', data: payload));
      },
    );
    title.dispose();
    symptom.dispose();
    if (!ok) return;
    if (editing == null) _openOnly = true;
    await _after(editing == null ? 'Issue ${saved?['issue_number']} logged.' : 'Issue ${saved?['issue_number']} updated.');
  }

  Future<void> _resolve(Json i) async {
    final rootCause = TextEditingController(text: str(i['root_cause']));
    final corrective = TextEditingController(text: str(i['corrective_action']));
    final ok = await showFormSheet(
      context,
      title: 'Resolve Issue ${i['issue_number']}',
      saveLabel: 'Resolve Issue',
      builder: (ctx, setS) => [
        Muted(str(i['title'])),
        const FormHeading('Root Cause'),
        AppTextField(
            label: 'What actually caused the fault', controller: rootCause, required: true, maxLines: 4),
        const FormHeading('Corrective Action'),
        AppTextField(
            label: 'What was done to fix it',
            controller: corrective,
            required: true,
            maxLines: 4,
            hint: 'What was done to fix it (and any retest recorded)'),
        const Muted('The issue moves to Resolved; close it once the fix is confirmed.', size: 12),
      ],
      onSave: () async {
        if (rootCause.text.trim().isEmpty) throw 'Enter the root cause — what actually caused the fault.';
        if (corrective.text.trim().isEmpty) throw 'Enter the corrective action — what was done to fix it.';
        await Api.post('/electrical/issues/${i['id']}/resolve',
            data: {'root_cause': rootCause.text.trim(), 'corrective_action': corrective.text.trim()});
      },
    );
    rootCause.dispose();
    corrective.dispose();
    if (ok) await _after('Issue ${i['issue_number']} resolved.');
  }

  Future<void> _action(Json i, String action) async {
    setState(() => _busyId = asInt(i['id']));
    try {
      if (action == 'investigate') {
        await Api.patch('/electrical/issues/${i['id']}', data: {'status': 'investigating'});
        await _after('Issue ${i['issue_number']} is now under investigation.');
      } else if (action == 'close') {
        await Api.post('/electrical/issues/${i['id']}/close');
        await _after('Issue ${i['issue_number']} closed.');
      } else {
        await Api.post('/electrical/issues/${i['id']}/reopen');
        _openOnly = true;
        await _after('Issue ${i['issue_number']} reopened.');
      }
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _delete(Json i) async {
    final ok = await confirmDialog(context,
        title: 'Delete issue ${i['issue_number']}?',
        message: 'This removes the issue from the troubleshooting log. Only delete an issue logged by mistake — a real fault '
            'should be resolved instead so it stays on record.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/electrical/issues/${i['id']}'))) {
      await _after('Issue ${i['issue_number']} deleted.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final openCount = _issues.where((i) => _openStatuses.contains(i['status'])).length;
    final visible = _openOnly ? _issues.where((i) => _openStatuses.contains(i['status'])).toList() : _issues;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabHeader(title: 'Troubleshooting Log', action: _canLog ? primaryBtn('Log Issue', () => _openForm()) : null),
          Row(children: [
            segment('Open ($openCount)', _openOnly, () => setState(() => _openOnly = true)),
            segment('All (${_issues.length})', !_openOnly, () => setState(() => _openOnly = false)),
          ]),
          const Padding(
            padding: EdgeInsets.only(top: 4, bottom: 10),
            child: Muted('Troubleshooting stage completes once no issue is open or investigating.', size: 11.5),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: ErrorBanner(_error!)),
          if (_loading)
            const LoadingView()
          else if (visible.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Muted(
                  '${_openOnly && _issues.isNotEmpty ? 'No open issues — every logged fault has been resolved.' : 'No issues logged on this job.'}'
                  '${_canLog && _issues.isEmpty ? ' Use "+ Log Issue" when a fault is found.' : ''}',
                  size: 13),
            )
          else
            for (final i in visible) _card(i),
        ],
      ),
    );
  }

  Widget _card(Json i) {
    final isOpen = _openStatuses.contains(i['status']);
    final busy = _busyId == asInt(i['id']);
    final links = [
      if (str(i['test_number']).isNotEmpty) 'Test ${i['test_number']}',
      if (str(i['panel_tag']).isNotEmpty) 'Panel ${i['panel_tag']}',
      if (str(i['cable_tag']).isNotEmpty) 'Cable ${i['cable_tag']}',
    ].join(' · ');
    final buttons = <Widget>[
      if (_canWork && i['status'] == 'open') smallBtn('Start investigating', busy ? null : () => _action(i, 'investigate')),
      if (_canWork && isOpen) smallBtn('Resolve', busy ? null : () => _resolve(i)),
      if (_canWork && isOpen) smallBtn('Edit', busy ? null : () => _openForm(i)),
      if (_canWork && i['status'] == 'resolved') smallBtn('Close', busy ? null : () => _action(i, 'close')),
      if (_canWork && !isOpen) smallBtn('Reopen', busy ? null : () => _action(i, 'reopen')),
      if (widget.canEdit && _mayDelete(i)) smallBtn('Delete', busy ? null : () => _delete(i), danger: true),
    ];
    Widget detail(String label, Object? v) => Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Caps(label),
            const SizedBox(height: 2),
            Text(str(v), style: const TextStyle(fontSize: 13, color: Brand.body)),
          ]),
        );
    return ItemCard(
      accent: severityHex[str(i['severity'])] ?? cStone,
      children: [
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text(str(i['issue_number']), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.heading)),
          pill(i['severity'], severityLabels, severityHex),
          pill(i['status'], issueStatusLabels, issueStatusHex),
        ]),
        const SizedBox(height: 2),
        Text(str(i['title']), style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: Brand.body)),
        const SizedBox(height: 4),
        if (links.isNotEmpty) Muted('Linked: $links', size: 11.5),
        Muted('Assigned to: ${str(i['assigned_to_name']).isEmpty ? 'Unassigned' : i['assigned_to_name']}', size: 11.5),
        Muted('Reported by ${txt(i['reported_by_name'])}${i['created_at'] != null ? ' on ${fmtDate(i['created_at'])}' : ''}',
            size: 11.5),
        if (str(i['resolved_by_name']).isNotEmpty)
          Muted('Resolved by ${i['resolved_by_name']}${i['resolved_at'] != null ? ' · ${fmtDateTime(i['resolved_at'])}' : ''}',
              size: 11.5),
        if (str(i['symptom']).isNotEmpty) detail('Symptom', i['symptom']),
        if (str(i['root_cause']).isNotEmpty) detail('Root Cause', i['root_cause']),
        if (str(i['corrective_action']).isNotEmpty) detail('Corrective Action', i['corrective_action']),
        if (buttons.isNotEmpty) ...[const SizedBox(height: 10), btnWrap(buttons)],
      ],
    );
  }
}