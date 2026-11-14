import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'design_common.dart';
import 'design_documents.dart';
import 'design_reviews.dart';

/// Reports - portal design/reports ("Design Reports"): Master Document
/// List export, summary KPIs, first-time-right, customer approvals, change
/// register, Design WBS status, workload, revision history per drawing.

const _msLabels = {
  'not_started': 'Not started',
  'in_progress': 'In progress',
  'submitted': 'Submitted',
  'achieved': 'Achieved',
  'cancelled': 'Cancelled',
};
const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

String _pct(Object? v) => v == null ? '—' : '$v%';
String _days(Object? v) => v == null ? '—' : '$v d';
String _monthLabel(String m) {
  final p = m.split('-');
  final i = p.length > 1 ? int.tryParse(p[1]) : null;
  return i == null || i < 1 || i > 12 ? m : '${_months[i - 1]} ${p[0]}';
}

class DesignReportsTab extends StatefulWidget {
  const DesignReportsTab({super.key});

  @override
  State<DesignReportsTab> createState() => _DesignReportsTabState();
}

class _DesignReportsTabState extends State<DesignReportsTab> {
  Json? _summary, _ftr, _approvals, _register, _milestones, _workload, _history;
  final _errors = <String>[];
  Json _me = const {};
  String _status = 'draft,in_review,in_approval,released,revising';
  String? _type, _discipline;
  int? _docId;
  String? _docL;
  bool _historyLoading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<Json?> _get(String path, String what) async {
    try {
      return jsonMap(await Api.get(path));
    } catch (e) {
      _errors.add('Could not load $what: ${ApiClient.describe(e)}');
      return null;
    }
  }

  Future<void> _load() async {
    _errors.clear();
    final me = await DesignMe.load();
    final r = await Future.wait([
      _get('/design/reports/summary', 'Design reports'),
      _get('/design/reports/change-register', 'the change register'),
      _get('/design/reports/milestones', 'the WBS report'),
      _get('/design/reports/workload', 'the workload report'),
      _get('/design/reports/first-time-right', 'the first-time-right report'),
      if (DesignMe.isTeam(me)) _get('/design/reports/customer-approvals', 'the customer approvals report'),
    ]);
    if (!mounted) return;
    setState(() {
      _me = me;
      _summary = r[0];
      _register = r[1];
      _milestones = r[2];
      _workload = r[3];
      _ftr = r[4];
      _approvals = r.length > 5 ? r[5] : null;
    });
  }

  Future<void> _loadHistory(int id) async {
    setState(() => (_historyLoading = true, _history = null));
    try {
      final h = jsonMap(await Api.get('/design/reports/revision-history', query: {'document_id': id}));
      if (mounted) setState(() => _history = h);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
    if (mounted) setState(() => _historyLoading = false);
  }

  Widget _countTable(String title, Object? rows, Map<String, String> labels) {
    final list = jsonList(rows);
    return DetailSection(title, children: [
      if (list.isEmpty) const Text('No documents yet.', style: TextStyle(fontSize: 13, color: Brand.muted)),
      for (final r in list)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(children: [
            Expanded(child: Text(labelOf(labels, r['key']))),
            Text('${r['count']}', style: const TextStyle(fontWeight: FontWeight.w700)),
          ]),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final d = _summary;
    final canExport = Perm.can('design', 'reports', 'export');
    final today = DateTime.now();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
        const PageHeader('Design Reports', subtitle: 'Design Module'),
        for (final e in _errors) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: ErrorBanner(e)),
        DetailSection('Master Document List (ISO 9001 §7.5)', children: [
          const Text(
              'Every controlled document with its current revision, who checked and approved it, and any revision in progress — as a CSV for audits and customer submissions.',
              style: TextStyle(fontSize: 13, color: Brand.muted)),
          const SizedBox(height: 10),
          AppSelect<String>(
              label: 'Documents',
              clearable: false,
              value: _status,
              options: const [
                Option('draft,in_review,in_approval,released,revising', 'All active documents'),
                Option('released,revising', 'Released only'),
                Option('obsolete', 'Obsolete only'),
                Option('', 'Everything, incl. obsolete'),
              ],
              onChanged: (o) => setState(() => _status = o?.value ?? _status)),
          const SizedBox(height: 8),
          AppSelect<String>(label: 'All types', value: _type, options: optionsOf(docTypeLabels), onChanged: (o) => setState(() => _type = o?.value)),
          const SizedBox(height: 8),
          AppSelect<String>(
              label: 'All disciplines', value: _discipline, options: optionsOf(disciplineLabels), onChanged: (o) => setState(() => _discipline = o?.value)),
          if (canExport) ...[
            const SizedBox(height: 10),
            FilledButton.icon(
              icon: const Icon(Icons.download_rounded),
              label: const Text('Export CSV'),
              onPressed: () => openApiFile(context, '/design/reports/master-document-list',
                  'master-document-list-${apiDate(today)}.csv',
                  query: {
                    'status': _status.isEmpty ? null : _status,
                    'document_type': _type,
                    'discipline': _discipline,
                  }..removeWhere((k, v) => v == null)),
            ),
          ],
        ]),
        if (d == null && _errors.isEmpty) const LoadingView(),
        if (d != null) ...[
          StatGrid([
            StatTile('Revisions released', d['total_revisions_released'], hint: 'all time'),
            StatTile('Avg. cycle time', d['avg_cycle_days'] == null ? '—' : '${d['avg_cycle_days']} days', hint: 'revision opened → released'),
            StatTile('Avg. returns per release', d['avg_returns_per_release'] ?? '—', hint: 'times sent back before release'),
          ]),
          _countTable('By status', d['by_status'], docStatusLabels),
          _countTable('By type', d['by_type'], docTypeLabels),
          _countTable('By discipline', d['by_discipline'], disciplineLabels),
          DetailSection('Releases — last 12 months', children: [
            for (final m in jsonList(d['releases_by_month']))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(children: [
                  Expanded(child: Text(_monthLabel(str(m['month'])))),
                  Text('${m['released']}',
                      style: TextStyle(
                          fontWeight: (asInt(m['released']) ?? 0) > 0 ? FontWeight.w700 : FontWeight.w400,
                          color: (asInt(m['released']) ?? 0) > 0 ? Brand.heading : Brand.muted)),
                ]),
              ),
          ]),
        ],
        if (_ftr != null) ...[
          const Padding(padding: EdgeInsets.fromLTRB(16, 8, 16, 8), child: Caps('First-time-right')),
          StatGrid([
            StatTile('Customer FTR', _pct(_ftr!['customer_ftr_pct']),
                hint: '${_ftr!['customer_first_time_right']} of ${_ftr!['customer_drawings_released']} customer drawings released with no customer rejection'),
            StatTile('Internal FTR', _pct(_ftr!['internal_ftr_pct']),
                hint: '${_ftr!['internal_first_time_right']} of ${_ftr!['revisions_released']} revisions released without being sent back'),
          ]),
        ],
        if (DesignMe.isTeam(_me) && _approvals != null) _approvalsSection(_approvals!),
        if (_register != null) _registerSection(_register!),
        if (_milestones != null) _milestoneSection(_milestones!),
        if (_workload != null) _workloadSection(_workload!),
        DetailSection('Revision history per drawing', children: [
          AppSelect<int>(
            label: 'Pick a drawing',
            value: _docId,
            valueLabel: _docL,
            loadOptions: (s) => designLookup('documents', s, query: {'limit': 500}, sendSearch: true),
            onChanged: (o) {
              setState(() => (_docId = o?.value, _docL = o?.label, _history = null));
              if (o != null) _loadHistory(o.value);
            },
          ),
          const SizedBox(height: 8),
          if (_docId == null)
            const Text('Pick a drawing to see every revision — who authored, checked and approved it, how often it was sent back, and how long each took.',
                style: TextStyle(fontSize: 13, color: Brand.muted)),
          if (_historyLoading) const Text('Loading…', style: TextStyle(color: Brand.muted)),
          if (_history != null) ...[
            if (jsonList(_history!['revisions']).isEmpty)
              Text('${_history!['doc_number']} has no revisions yet.', style: const TextStyle(color: Brand.muted))
            else ...[
              Text('${_history!['doc_number']} — ${_history!['title']}', style: const TextStyle(fontWeight: FontWeight.w600)),
              for (final r in jsonList(_history!['revisions']))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Text(str(r['revision_label']), style: const TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(width: 8),
                      docStatusBadge(r['status']),
                    ]),
                    if (str(r['change_summary']).isNotEmpty) Text(str(r['change_summary']), style: const TextStyle(fontSize: 12.5)),
                    Text(
                        'Author ${txt(r['author'])} · Checked ${txt(r['checked_by'])} · Approved ${txt(r['approved_by'])}\n'
                        'Opened ${fmtDate(r['created_at'])} · Released ${fmtDate(r['released_at'])}'
                        '${r['superseded_at'] != null ? ' · superseded ${fmtDate(r['superseded_at'])}' : ''} · Returns ${r['returns']} · Cycle ${_days(r['cycle_days'])}',
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ]),
                ),
            ],
          ],
        ]),
      ]),
    );
  }

  Widget _approvalsSection(Json a) => DetailSection('Customer approvals', children: [
        Text(
            'Avg. turnaround: ${a['avg_turnaround_days'] == null ? '—' : '${a['avg_turnaround_days']} days'} (sent → customer response)',
            style: const TextStyle(fontSize: 13)),
        if (jsonList(a['submissions']).isEmpty) const Text('No transmittals sent to customers yet.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final c in jsonList(a['customers']))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Text(
                '${c['customer_name']} — ${c['submissions']} transmittals · ${c['drawings']} drawings · ${c['approved']} approved · '
                '${c['rejected']} rejected · avg ${_days(c['avg_turnaround_days'])}',
                style: const TextStyle(fontSize: 12.5)),
          ),
        const Divider(),
        for (final s in jsonList(a['submissions']))
          InkWell(
            onTap: () => openScreen(context, DesignSubmissionDetail(id: asInt(s['id'])!)),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Row(children: [
                Expanded(
                  child: Text(
                      '${s['submission_number']} · ${s['customer_name']}\nSent ${fmtDate(s['sent_date'])} · '
                      '${s['response_date'] != null ? 'Response ${fmtDate(s['response_date'])}' : (s['days_waiting'] != null ? 'waiting ${s['days_waiting']} d' : '—')}'
                      ' · Turnaround ${_days(s['turnaround_days'])} · ${s['drawings']} drawings · ${s['rejected']} rejected',
                      style: const TextStyle(fontSize: 12.5)),
                ),
                subStatusBadge(s['status']),
                if (s['overdue'] == true) const Padding(padding: EdgeInsets.only(left: 4), child: StatusBadge('Overdue', color: Brand.danger)),
              ]),
            ),
          ),
      ]);

  Widget _registerSection(Json r) => DetailSection('Change register (ECR → ECN)', children: [
        Text('Open ECRs: ${r['open_ecrs']} · Avg. request → release: ${r['avg_days_to_release'] == null ? '—' : '${r['avg_days_to_release']} days'}',
            style: const TextStyle(fontSize: 13)),
        if (jsonList(r['rows']).isEmpty) const Text('No change requests or notices yet.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final x in jsonList(r['rows']))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${str(x['ecr_number']).isEmpty ? 'Direct ECN' : x['ecr_number']} → ${txt(x['ecn_number'])} · ${x['title']}',
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
              Wrap(spacing: 6, children: [
                if (str(x['ecr_status']).isNotEmpty) StatusBadge(labelOf(ecrStatusLabels, x['ecr_status'])),
                if (str(x['ecn_status']).isNotEmpty) StatusBadge(labelOf(ecnStatusLabels, x['ecn_status'])),
              ]),
              Text(
                  'Source ${str(x['source']).isEmpty ? '—' : (x['ecr_id'] != null ? labelOf(ecrSourceLabels, x['source']) : labelOf(ecnReasonLabels, x['source']))}'
                  ' · Raised ${fmtDate(x['raised_at'])} · Decision ${_days(x['days_to_decision'])} · Released ${fmtDate(x['released_at'])} · Release ${_days(x['days_to_release'])}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
          ),
      ]);

  Widget _milestoneSection(Json m) => DetailSection('Design WBS status', children: [
        if (str(m['note']).isNotEmpty)
          Text(str(m['note']), style: const TextStyle(fontSize: 13, color: Brand.muted))
        else if (jsonList(m['rows']).isEmpty)
          const Text('No project WBS elements are assigned to the Design department.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final x in jsonList(m['rows']))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(children: [
              Expanded(
                child: Text(
                    '${x['title']}\n${txt(x['project'])} · Target ${fmtDate(x['target_date'])}'
                    '${x['actual_date'] != null ? ' · done ${fmtDate(x['actual_date'])}' : ''}'
                    '${(asInt(x['slip_days']) ?? 0) != 0 ? ' · Slip ${(asInt(x['slip_days']) ?? 0) > 0 ? '+' : ''}${x['slip_days']} d' : ''}',
                    style: const TextStyle(fontSize: 12.5)),
              ),
              StatusBadge(labelOf(_msLabels, x['status'])),
              if (x['overdue'] == true) const Padding(padding: EdgeInsets.only(left: 4), child: StatusBadge('Overdue', color: Brand.danger)),
            ]),
          ),
      ]);

  Widget _workloadSection(Json w) => DetailSection('Designer workload & on-time', children: [
        if (str(w['note']).isNotEmpty)
          Text(str(w['note']), style: const TextStyle(fontSize: 13, color: Brand.muted))
        else if (jsonList(w['rows']).isEmpty)
          const Text('No team members.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final x in jsonList(w['rows']))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Text.rich(TextSpan(style: const TextStyle(fontSize: 12.5), children: [
              TextSpan(text: '${str(x['name']).isEmpty ? 'User #${x['user_id']}' : x['name']} (${labelOf(teamRoleLabels, x['role'])})\n',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              TextSpan(text: 'Open ${x['open']} · '),
              TextSpan(text: 'Overdue ${x['overdue']}', style: TextStyle(color: (asInt(x['overdue']) ?? 0) > 0 ? Brand.danger : null)),
              TextSpan(text: ' · Done ${x['done']} · On time ${_pct(x['on_time_pct'])}${x['on_time_pct'] != null ? ' (${x['on_time']}/${x['done']})' : ''}'),
            ])),
          ),
        const Text('From Project Management tasks assigned to each team member. On time = completed on or before the due date.',
            style: TextStyle(fontSize: 11.5, color: Brand.muted)),
      ]);
}
