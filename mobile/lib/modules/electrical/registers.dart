// Electrical list pages - phone copies of frontend/src/app/dashboard/electrical/
// jobs, drawings, purchase, testing and troubleshooting. Each row opens the
// job on the matching tab.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'common.dart';
import 'job_detail.dart';
import 'job_form.dart';

/// Page title block of every Electrical page ("ELECTRICAL MODULE" + title + subtitle).
class ElecPageHeader extends StatelessWidget {
  const ElecPageHeader(this.title, this.subtitle, {super.key, this.action});
  final String title;
  final String subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Caps('Electrical Module'),
            const SizedBox(height: 4),
            Row(children: [
              Expanded(
                child: Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
              ),
              ?action,
            ]),
            const SizedBox(height: 4),
            Text(subtitle, style: const TextStyle(fontSize: 13, color: Brand.muted)),
          ],
        ),
      );
}

Widget _filterRow(List<Widget> children) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Row(children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(child: children[i]),
        ],
      ]),
    );

/// Opens the New RRV Electrical Job form, then the created job.
Future<void> createElectricalJob(BuildContext context, {VoidCallback? onCreated}) async {
  final job = await showJobForm(context);
  if (job == null || !context.mounted) return;
  onCreated?.call();
  openElectricalJob(context, job['id']);
}

// ── RRV Jobs ─────────────────────────────────────────────────────────────────

const _jobPhaseLabels = {'design': 'Design', 'procurement': 'Procurement', 'build': 'Assembly', 'test_qc': 'Testing & QC', 'handover': 'Handover'};

class ElecJobsPage extends StatefulWidget {
  const ElecJobsPage({super.key});

  @override
  State<ElecJobsPage> createState() => _ElecJobsPageState();
}

class _ElecJobsPageState extends State<ElecJobsPage> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = 'open';
  String _phase = '';
  bool _mine = false;
  final _vis = Vis('electrical:jobs');

  void _reload() => _list.currentState?.reload();

  @override
  Widget build(BuildContext context) {
    final canCreate = Elec.can('jobs', 'create');
    bool col(String k) => _vis.showColumn('jobs', k);
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: canCreate
          ? CreateFab(label: 'New Job', onPressed: () => createElectricalJob(context, onCreated: _reload))
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search job no., title, model, vehicle, customer…',
        load: (page, search) => Api.list('/electrical/jobs',
            query: {'status': _status, 'phase': _phase, 'mine': _mine ? true : null, 'search': search}),
        emptyText: search(),
        header: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const ElecPageHeader('RRV Electrical Jobs',
                'One job per RRV whose electrical system is being built — open a job to work its stages, BOM, drawings and tests.'),
            _filterRow([
              AppSelect<String>(
                label: 'Status',
                value: _status,
                clearable: false,
                options: [
                  const Option('open', 'Open (draft / active / hold)'),
                  const Option('', 'All statuses'),
                  ...optionsOf(jobStatusLabels),
                ],
                onChanged: (o) {
                  setState(() => _status = o?.value ?? 'open');
                  _reload();
                },
              ),
              AppSelect<String>(
                label: 'Phase',
                value: _phase,
                clearable: false,
                options: [const Option('', 'Any phase'), ...optionsOf(_jobPhaseLabels)],
                onChanged: (o) {
                  setState(() => _phase = o?.value ?? '');
                  _reload();
                },
              ),
            ]),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(children: [
                segment('${_mine ? '✓ ' : ''}My jobs', _mine, () {
                  setState(() => _mine = !_mine);
                  _reload();
                }),
              ]),
            ),
          ],
        ),
        itemBuilder: (ctx, j, reload) {
          final stage = str(j['current_stage_label']);
          final overdue = asBool(j['is_overdue']);
          return RecordCard(
            code: str(j['job_number']),
            title: str(j['title']),
            subtitle: [str(j['rrv_model']), str(j['vehicle_number'])].where((s) => s.isNotEmpty).join(' · ').ifEmpty('—'),
            trailing: Padding(padding: const EdgeInsets.only(left: 8), child: pill(j['status'], jobStatusLabels, jobStatusHex)),
            meta: [
              if (col('customer')) ('Customer', txt(j['customer_name'])),
              if (col('lead_engineer')) ('Lead Engineer', txt(j['lead_engineer_name'])),
              if (col('current_stage'))
                ('Current Stage', stage.isEmpty ? 'All stages done' : '$stage · ${_jobPhaseLabels[str(j['current_phase'])] ?? ''}'),
              if (col('progress')) ('Progress', '${j['done_stages']}/${j['total_stages']} stages'),
              if (col('target_handover'))
                ('Target Handover', '${j['target_handover_date'] == null ? '—' : fmtDate(j['target_handover_date'])}${overdue ? ' · Overdue' : ''}'),
              if (col('priority')) ('Priority', priorityLabel(j['priority'])),
            ],
            onTap: () async {
              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ElectricalJobScreen(jobId: asInt(j['id'])!)));
              reload();
            },
          );
        },
      ),
    );
  }

  String search() => _status != 'open' || _phase.isNotEmpty || _mine
      ? 'No electrical jobs match these filters — clear the search or pick another status.'
      : 'No open electrical jobs.${Elec.can('jobs', 'create') ? ' Use "+ New Job" for each RRV whose electrical system you’re building.' : ''}';
}

// ── Drawing Register ─────────────────────────────────────────────────────────

class ElecDrawingsPage extends StatefulWidget {
  const ElecDrawingsPage({super.key});

  @override
  State<ElecDrawingsPage> createState() => _ElecDrawingsPageState();
}

class _ElecDrawingsPageState extends State<ElecDrawingsPage> {
  final _list = GlobalKey<ApiListViewState>();
  String _type = '';
  String _status = '';
  String _asBuilt = '';
  Map<String, String> _types = {};
  String? _lookupError;

  @override
  void initState() {
    super.initState();
    ElecMeta.load().then((m) {
      if (mounted) setState(() => _types = m.drawingTypes);
    }, onError: (Object e) {
      if (mounted) {
        setState(() => _lookupError = "Couldn't load the drawing type list for the Type filter — the register below still works "
            'unfiltered; pull down to try again. ${ApiClient.describe(e)}');
      }
    });
  }

  void _set(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final awaitingOnly = _status == 'submitted';
    final filtered = _type.isNotEmpty || _status.isNotEmpty || _asBuilt.isNotEmpty;
    return ApiListView(
      key: _list,
      searchHint: 'Search drawing number, title or job number…',
      load: (page, search) => Api.list('/electrical/drawings', query: {
        'search': search,
        'drawing_type': _type,
        'revision_status': _status,
        'as_built': _asBuilt.isEmpty ? null : _asBuilt == 'yes',
      }),
      emptyText: filtered
          ? 'No drawings match these filters.'
          : 'No electrical drawings yet. Drawings are added from an RRV job’s Drawings tab.',
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ElecPageHeader('Drawing Register',
              "Every electrical drawing on every RRV job. Open a row to submit or approve its revisions on the job's Drawings tab."),
          if (_lookupError != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: ErrorBanner(_lookupError!)),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(children: [
              segment(awaitingOnly ? '✓ Awaiting approval only' : 'Awaiting approval only', awaitingOnly,
                  () => _set(() => _status = awaitingOnly ? '' : 'submitted')),
            ]),
          ),
          _filterRow([
            AppSelect<String>(
              label: 'Type',
              value: _type,
              clearable: false,
              options: [const Option('', 'All drawing types'), ...optionsOf(_types)],
              onChanged: (o) => _set(() => _type = o?.value ?? ''),
            ),
            AppSelect<String>(
              label: 'Revision status',
              value: _status,
              clearable: false,
              options: [const Option('', 'All revision statuses'), ...optionsOf(revisionStatusLabels)],
              onChanged: (o) => _set(() => _status = o?.value ?? ''),
            ),
          ]),
          _filterRow([
            AppSelect<String>(
              label: 'As-built',
              value: _asBuilt,
              clearable: false,
              options: const [Option('', 'As-built: All'), Option('yes', 'As-built: Yes'), Option('no', 'As-built: No')],
              onChanged: (o) => _set(() => _asBuilt = o?.value ?? ''),
            ),
          ]),
        ],
      ),
      itemBuilder: (ctx, d, reload) => RecordCard(
        code: str(d['drawing_number']),
        title: str(d['title']),
        subtitle: [str(d['job_number']), str(d['job_title'])].where((s) => s.isNotEmpty).join(' · ').ifEmpty('—'),
        trailing: Padding(
          padding: const EdgeInsets.only(left: 8),
          child: pill(d['latest_revision_status'], revisionStatusLabels, revisionStatusHex),
        ),
        meta: [
          ('Type', _types[str(d['drawing_type'])] ?? str(d['drawing_type']).replaceAll('_', ' ')),
          ('Latest Rev', txt(d['latest_revision_label'])),
          ('Approved Rev', txt(d['approved_revision_label'])),
          ('As-built', asBool(d['is_as_built']) ? 'As-built' : 'No'),
        ],
        onTap: () => openElectricalJob(context, d['job_id'], tab: 'drawings'),
      ),
    );
  }
}

// ── Purchase Requirements ────────────────────────────────────────────────────

class ElecPurchasePage extends StatefulWidget {
  const ElecPurchasePage({super.key});

  @override
  State<ElecPurchasePage> createState() => _ElecPurchasePageState();
}

class _ElecPurchasePageState extends State<ElecPurchasePage> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = '';
  String _category = '';
  Map<String, String> _cats = {};
  List<Json> _rows = [];
  bool _loaded = false;
  String _search = '';

  @override
  void initState() {
    super.initState();
    ElecMeta.load().then((m) {
      if (mounted) setState(() => _cats = m.componentCategories);
    }, onError: (Object _) {});
  }

  void _set(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final toBuy = _rows.where((r) => r['procurement_status'] == 'required').length;
    final jobs = _rows.map((r) => r['job_id']).toSet().length;
    return ApiListView(
      key: _list,
      searchHint: 'Search description, make, part no. or job…',
      load: (page, search) async {
        _search = search;
        final p = await Api.list('/electrical/purchase-requirements',
            query: {'procurement_status': _status, 'category': _category, 'search': search});
        if (mounted) {
          setState(() {
            _rows = p.rows;
            _loaded = true;
          });
        }
        return p;
      },
      emptyText: _status.isEmpty && _category.isEmpty && _search.isEmpty
          ? 'Nothing left to buy — every BOM line on open jobs is in stock, received or issued.'
          : 'No BOM lines match these filters.',
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ElecPageHeader('Purchase Requirements',
              'BOM lines that still need buying across every RRV job — the Purchase Requirement stage.'),
          _filterRow([
            AppSelect<String>(
              label: 'Procurement',
              value: _status,
              clearable: false,
              options: const [
                Option('', 'Still open (To Buy / PR Raised / Ordered)'),
                Option('required', 'To Buy'),
                Option('pr_raised', 'PR Raised'),
                Option('ordered', 'Ordered'),
                Option('in_stock', 'In Stock'),
                Option('received', 'Received'),
                Option('issued', 'Issued'),
              ],
              onChanged: (o) => _set(() => _status = o?.value ?? ''),
            ),
            AppSelect<String>(
              label: 'Category',
              value: _category,
              clearable: false,
              options: [const Option('', 'All categories'), ...optionsOf(_cats)],
              onChanged: (o) => _set(() => _category = o?.value ?? ''),
            ),
          ]),
          if (_loaded)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(runSpacing: 6, children: [
                    CountChip('${plural(toBuy, 'line')} to buy', toBuy,
                        color: toBuy > 0 ? cRed : cGreen,
                        selected: _status == 'required',
                        onTap: () => _set(() => _status = _status == 'required' ? '' : 'required')),
                    CountChip('${plural(_rows.length, 'line')} shown, across $jobs ${plural(jobs, 'job')}', _rows.length,
                        color: cBlue, onTap: () => _set(() => _status = '')),
                  ]),
                  const SizedBox(height: 6),
                  const Muted("Raise the PR in Procurement from the job's BOM tab, then link it to the line.", size: 12),
                ],
              ),
            ),
        ],
      ),
      itemBuilder: (ctx, r, reload) => RecordCard(
        code: '${txt(r['job_number'])} · Line ${r['line_no']}',
        title: str(r['description']),
        subtitle: [str(r['make']), str(r['part_number'])].where((s) => s.isNotEmpty).join(' · '),
        trailing: Padding(
          padding: const EdgeInsets.only(left: 8),
          child: pill(r['procurement_status'], procurementLabels, procurementHex),
        ),
        meta: [
          if (str(r['job_title']).isNotEmpty) ('Job', str(r['job_title'])),
          ('Category', _cats[str(r['category'])] ?? str(r['category']).replaceAll('_', ' ')),
          ('Qty', '${fmtNumber(r['quantity'])} ${str(r['uom'])}'),
          ('Rating', txt(r['rating'])),
          ('PR', str(r['p2p_number']).isEmpty
              ? '—'
              : '${r['p2p_number']}${str(r['p2p_status']).isNotEmpty ? ' · ${humanizeKey(str(r['p2p_status']))}' : ''}'),
        ],
        onTap: () => openElectricalJob(context, r['job_id'], tab: 'bom'),
      ),
    );
  }
}

// ── Test Register ────────────────────────────────────────────────────────────

class ElecTestingPage extends StatefulWidget {
  const ElecTestingPage({super.key});

  @override
  State<ElecTestingPage> createState() => _ElecTestingPageState();
}

class _ElecTestingPageState extends State<ElecTestingPage> {
  final _list = GlobalKey<ApiListViewState>();
  String _phase = '';
  String _result = '';
  String _type = '';
  bool _needsRetest = false;
  Map<String, String> _types = {};
  int _openFailures = 0;
  final _vis = Vis('electrical:testing');

  @override
  void initState() {
    super.initState();
    ElecMeta.load().then((m) {
      if (mounted) setState(() => _types = m.testTypes);
    }, onError: (Object _) {});
  }

  void _set(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    bool col(String k) => _vis.showColumn('tests', k);
    return ApiListView(
      key: _list,
      load: (page, search) async {
        final p = await Api.list('/electrical/tests', query: {
          'phase': _phase,
          'result': _result,
          'test_type': _type,
          'needs_retest': _needsRetest ? true : null,
        });
        if (mounted) setState(() => _openFailures = p.rows.where((t) => asBool(t['needs_retest'])).length);
        return p;
      },
      emptyText: _phase.isNotEmpty || _result.isNotEmpty || _type.isNotEmpty || _needsRetest
          ? 'No tests match these filters.'
          : 'No electrical tests recorded yet. Tests are recorded from each RRV job’s Tests tab.',
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ElecPageHeader('Electrical Test Register',
              "Factory and commissioning tests across every RRV job. Record tests from the job's Tests tab."),
          _filterRow([
            AppSelect<String>(
              label: 'Phase',
              value: _phase,
              clearable: false,
              options: [const Option('', 'All phases'), ...optionsOf(testPhaseLabels)],
              onChanged: (o) => _set(() => _phase = o?.value ?? ''),
            ),
            AppSelect<String>(
              label: 'Result',
              value: _result,
              clearable: false,
              options: [const Option('', 'All results'), ...optionsOf(testResultLabels)],
              onChanged: (o) => _set(() => _result = o?.value ?? ''),
            ),
          ]),
          _filterRow([
            AppSelect<String>(
              label: 'Test type',
              value: _type,
              clearable: false,
              options: [const Option('', 'All test types'), ...optionsOf(_types)],
              onChanged: (o) => _set(() => _type = o?.value ?? ''),
            ),
          ]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(children: [
              segment('${_needsRetest ? '✓ ' : ''}Needs retest only', _needsRetest, () => _set(() => _needsRetest = !_needsRetest)),
              const SizedBox(width: 8),
              Expanded(
                child: _openFailures > 0
                    ? Text('$_openFailures awaiting retest',
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: cRed))
                    : const Muted('No failed test awaiting a retest'),
              ),
            ]),
          ),
        ],
      ),
      itemBuilder: (ctx, t, reload) {
        final links = [str(t['panel_tag']), str(t['cable_tag'])].where((s) => s.isNotEmpty).join(' · ');
        return RecordCard(
          code: str(t['test_number']),
          title: col('type') ? (_types[str(t['test_type'])] ?? str(t['test_type']).replaceAll('_', ' ')) : str(t['test_number']),
          subtitle: str(t['retest_of_number']).isNotEmpty ? 'Retest of ${t['retest_of_number']}' : null,
          trailing: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              pill(t['result'], testResultLabels, testResultHex),
              if (asBool(t['needs_retest'])) ...[const SizedBox(height: 4), tagPill('Needs retest', cRed)],
            ]),
          ),
          meta: [
            if (col('job')) ('Job', [str(t['job_number']), str(t['job_title'])].where((s) => s.isNotEmpty).join(' · ').ifEmpty('—')),
            if (col('phase')) ('Phase', testPhaseLabels[str(t['phase'])] ?? str(t['phase'])),
            if (col('circuit')) ('Circuit', [str(t['circuit']), links].where((s) => s.isNotEmpty).join(' · ').ifEmpty('—')),
            if (col('measured'))
              ('Measured', str(t['measured_value']).isEmpty ? '—' : '${t['measured_value']}${str(t['unit']).isNotEmpty ? ' ${t['unit']}' : ''}'),
            if (col('date')) ('Date', fmtDate(t['test_date'])),
            if (col('tested_by')) ('Tested by', txt(t['tested_by_name'])),
          ],
          onTap: () => openElectricalJob(context, t['job_id'], tab: 'tests'),
        );
      },
    );
  }
}

// ── Troubleshooting ──────────────────────────────────────────────────────────

class ElecTroubleshootingPage extends StatefulWidget {
  const ElecTroubleshootingPage({super.key});

  @override
  State<ElecTroubleshootingPage> createState() => _ElecTroubleshootingPageState();
}

class _ElecTroubleshootingPageState extends State<ElecTroubleshootingPage> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = 'open';
  String _severity = '';
  bool _mine = false;
  List<Json> _rows = [];
  bool _loaded = false;

  void _set(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  bool _isOpen(Json i) => i['status'] == 'open' || i['status'] == 'investigating';

  @override
  Widget build(BuildContext context) {
    final openCount = _rows.where(_isOpen).length;
    final critical = _rows.where((i) => i['severity'] == 'critical' && _isOpen(i)).length;
    return ApiListView(
      key: _list,
      load: (page, search) async {
        final p = await Api.list('/electrical/issues',
            query: {'status': _status, 'severity': _severity, 'mine': _mine ? true : null});
        if (mounted) {
          setState(() {
            _rows = p.rows;
            _loaded = true;
          });
        }
        return p;
      },
      emptyText: _status == 'open' && _severity.isEmpty && !_mine
          ? 'No open electrical issues — every logged fault has been resolved.'
          : 'No issues match these filters.',
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const ElecPageHeader('Troubleshooting',
              "Electrical faults logged across every RRV job. Log and resolve issues from the job's Issues tab."),
          _filterRow([
            AppSelect<String>(
              label: 'Status',
              value: _status,
              clearable: false,
              options: const [
                Option('open', 'Open (unresolved)'),
                Option('investigating', 'Investigating'),
                Option('resolved', 'Resolved'),
                Option('closed', 'Closed'),
                Option('', 'All statuses'),
              ],
              onChanged: (o) => _set(() => _status = o?.value ?? ''),
            ),
            AppSelect<String>(
              label: 'Severity',
              value: _severity,
              clearable: false,
              options: [const Option('', 'All severities'), ...optionsOf(severityLabels)],
              onChanged: (o) => _set(() => _severity = o?.value ?? ''),
            ),
          ]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(children: [
              segment('${_mine ? '✓ ' : ''}Assigned to me', _mine, () => _set(() => _mine = !_mine)),
            ]),
          ),
          if (_loaded)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Wrap(runSpacing: 6, children: [
                CountChip('open / investigating', openCount,
                    color: openCount > 0 ? cRed : cGreen,
                    selected: _status == 'open' && _severity.isEmpty,
                    onTap: () => _set(() {
                          _status = 'open';
                          _severity = '';
                        })),
                CountChip('critical still open', critical,
                    color: critical > 0 ? cRed : cStone,
                    selected: _status == 'open' && _severity == 'critical',
                    onTap: () => _set(() {
                          final on = _status == 'open' && _severity == 'critical';
                          _status = 'open';
                          _severity = on ? '' : 'critical';
                        })),
              ]),
            ),
        ],
      ),
      itemBuilder: (ctx, i, reload) {
        final links = [
          if (str(i['test_number']).isNotEmpty) 'Test ${i['test_number']}',
          if (str(i['panel_tag']).isNotEmpty) 'Panel ${i['panel_tag']}',
          if (str(i['cable_tag']).isNotEmpty) 'Cable ${i['cable_tag']}',
        ].join(' · ');
        return RecordCard(
          code: str(i['issue_number']),
          title: str(i['title']),
          subtitle: [str(i['job_number']), str(i['job_title'])].where((s) => s.isNotEmpty).join(' · '),
          trailing: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              pill(i['status'], issueStatusLabels, issueStatusHex),
              const SizedBox(height: 4),
              pill(i['severity'], severityLabels, severityHex),
            ]),
          ),
          meta: [
            ('Linked', links.isEmpty ? '—' : links),
            ('Assigned to', str(i['assigned_to_name']).isEmpty ? 'Unassigned' : str(i['assigned_to_name'])),
            ('Reported', '${fmtDate(i['created_at'])}${str(i['reported_by_name']).isNotEmpty ? ' · ${i['reported_by_name']}' : ''}'),
          ],
          onTap: () => openElectricalJob(context, i['job_id'], tab: 'issues'),
        );
      },
    );
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}