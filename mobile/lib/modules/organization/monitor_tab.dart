import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';
import 'permission_tree.dart';

// Organization › System Monitor - native copy of
// frontend/src/app/dashboard/organization/monitor/page.tsx: background job
// runs, server errors (looked up by the reference a user reports) and every
// refused request with the permission that was missing.

const _statusLabels = {'success': 'Success', 'failed': 'Failed', 'running': 'Running', 'skipped': 'Skipped'};
const _statusColors = {
  'success': Color(0xFF16A34A),
  'failed': Color(0xFFDC2626),
  'running': Color(0xFF2563EB),
  'skipped': Color(0xFF78716C),
};
const _tabs = [('jobs', 'Background jobs'), ('errors', 'System errors'), ('denials', 'Denied access')];
const _periods = [
  Option<int>(1, 'Last 24 hours'),
  Option<int>(7, 'Last 7 days'),
  Option<int>(30, 'Last 30 days'),
  Option<int>(90, 'Last 90 days'),
];

Widget _pill(Object? s) =>
    StatusBadge(_statusLabels[str(s)] ?? humanize(s), color: _statusColors[str(s)] ?? const Color(0xFF78716C));

String _lastPart(Object? v) => str(v).split('.').last;

String _cut(String s, int n) => s.length > n ? s.substring(0, n) : s;

class OrgMonitorTab extends StatefulWidget {
  const OrgMonitorTab({super.key});

  @override
  State<OrgMonitorTab> createState() => _OrgMonitorTabState();
}

class _OrgMonitorTabState extends State<OrgMonitorTab> {
  bool get _canEdit => orgCan('monitor', 'edit');

  String _tab = 'jobs';
  int _days = 7;
  List<Json>? _jobs;
  List<Json>? _errors;
  List<Json> _errSummary = [];
  String _errQuery = '';
  List<Json>? _denials;
  List<Json> _denialSummary = [];
  String? _denialKey;
  bool _denialKeySet = false;
  Json? _registry;
  String _error = '';
  String _notice = '';

  @override
  void initState() {
    super.initState();
    _load();
    loadPermissionRegistry().then((r) {
      if (mounted) setState(() => _registry = r);
    }).catchError((_) {});
  }

  Future<void> _load() async {
    setState(() => _error = '');
    try {
      if (_tab == 'jobs') {
        final j = (await Api.list('/organization/monitor/jobs')).rows;
        if (mounted) setState(() => _jobs = j);
      } else if (_tab == 'errors') {
        final e = (await Api.list('/organization/monitor/errors',
                query: {'days': _days, 'q': _errQuery.trim(), 'limit': 1000}))
            .rows;
        if (mounted) setState(() => _errors = e);
        try {
          final s = (await Api.list('/organization/monitor/errors/summary', query: {'days': _days})).rows;
          if (mounted) setState(() => _errSummary = s);
        } catch (_) {}
      } else {
        final d = (await Api.list('/organization/grc/denials',
                query: {'days': _days, 'permission': _denialKeySet ? _denialKey : null, 'limit': 1000}))
            .rows;
        if (mounted) setState(() => _denials = d);
        try {
          final s = (await Api.list('/organization/grc/denials/summary', query: {'days': _days})).rows;
          if (mounted) setState(() => _denialSummary = s);
        } catch (_) {}
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  String _perm(Object? key, Object? label) =>
      str(key).isNotEmpty ? permissionWords(_registry, str(key)) : (str(label).isNotEmpty ? str(label) : 'Record-level rule');

  Future<void> _rerun(Json j) async {
    final ok = await confirmDialog(context,
        title: 'Run this job now?',
        message:
            "'${str(j['label'])}' runs once more now. It is safe to repeat — reminders already sent today are not sent again.",
        confirmLabel: 'Run now');
    if (!ok || !mounted) return;
    final done = await runAction(
        context, () => Api.post('/organization/monitor/jobs/${Uri.encodeComponent(str(j['job_id']))}/run'));
    if (done && mounted) {
      setState(() => _notice = "'${str(j['label'])}' started. Its run appears in the history when it finishes.");
      Future.delayed(const Duration(milliseconds: 2500), () {
        if (mounted && _tab == 'jobs') _load();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final count = switch (_tab) {
      'jobs' => _jobs?.length,
      'errors' => _errors?.length,
      _ => _denials?.length,
    };
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          const PageHeader('System Monitor',
              subtitle:
                  'Background job runs, server errors (search the reference a user reports) and every refused request with the permission that was missing.'),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(_error)),
          if (_notice.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0x1416A34A),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0x3316A34A)),
                ),
                child: Text(_notice, style: const TextStyle(color: Color(0xFF15803D))),
              ),
            ),
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                for (final (k, label) in _tabs)
                  CountChip(label, k == _tab ? count : null, selected: _tab == k, onTap: () {
                    setState(() {
                      _tab = k;
                      _error = '';
                      _notice = '';
                    });
                    _load();
                  }),
              ],
            ),
          ),
          if (_tab != 'jobs')
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: AppSelect<int>(
                label: 'Period',
                value: _days,
                options: _periods,
                required: true,
                onChanged: (o) {
                  if (o == null) return;
                  setState(() => _days = o.value);
                  _load();
                },
              ),
            ),
          ..._body(),
        ],
      ),
    );
  }

  List<Widget> _body() {
    if (_tab == 'jobs') {
      final jobs = _jobs;
      if (jobs == null) return const [LoadingView()];
      if (jobs.isEmpty) {
        return const [EmptyView('No jobs are registered on this server (the scheduler may not have started).')];
      }
      return [for (final j in jobs) _jobCard(j)];
    }
    if (_tab == 'errors') {
      return [
        if (_errSummary.isNotEmpty)
          DetailSection('Most frequent', children: [
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final s in _errSummary.take(8))
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                      color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
                  child: Text.rich(TextSpan(style: const TextStyle(fontSize: 11.5, color: Brand.body), children: [
                    TextSpan(text: '${s['count']}× ', style: const TextStyle(fontWeight: FontWeight.w700)),
                    TextSpan(text: '${str(s['method'])} ${str(s['path'])} '),
                    TextSpan(text: _lastPart(s['exception_type']), style: const TextStyle(color: Brand.muted)),
                  ])),
                ),
            ]),
          ]),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: TextField(
            textInputAction: TextInputAction.search,
            onChanged: (v) => _errQuery = v,
            onSubmitted: (_) => _load(),
            decoration: fieldDecoration('Search',
                hint: 'Error reference, message or exception…',
                suffix: IconButton(icon: const Icon(Icons.search_rounded), tooltip: 'Search', onPressed: _load)),
          ),
        ),
        if (_errors == null)
          const LoadingView()
        else if (_errors!.isEmpty)
          const EmptyView('No server errors in this period.')
        else
          for (final e in _errors!)
            RecordCard(
              code: str(e['error_ref']),
              title: _lastPart(e['exception_type']).isEmpty ? 'Error' : _lastPart(e['exception_type']),
              subtitle: _cut(str(e['message']), 160),
              meta: [
                ('When', fmtDateTime(e['occurred_at'])),
                ('Request', '${str(e['method'])} ${str(e['path'])}'),
                ('User', txt(e['user_name'])),
              ],
              onTap: () => openScreen(context, _ErrorDetailScreen(errorRef: str(e['error_ref']))),
            ),
      ];
    }
    // denials
    return [
      DetailSection('Most refused permissions', children: [
        if (_denialSummary.isEmpty)
          const Text('Nothing was refused in this period.', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final s in _denialSummary.take(12))
            _summaryChip(s),
        ]),
      ]),
      if (_denials == null)
        const LoadingView()
      else if (_denials!.isEmpty)
        const EmptyView('No denied requests.')
      else
        for (final d in _denials!)
          RecordCard(
            title: _perm(d['permission_key'], d['permission_label']),
            subtitle: str(d['permission_key']).isEmpty && str(d['detail']).isNotEmpty ? _cut(str(d['detail']), 180) : null,
            meta: [
              ('When', fmtDateTime(d['occurred_at'])),
              ('User', str(d['user_name']).isEmpty ? 'Not signed in' : str(d['user_name'])),
              ('Request', '${str(d['method'])} ${str(d['path'])}'),
              ('Times', txt(d['repeat_count'])),
              (
                'Fix: a role that grants it',
                jsonList(d['granted_by_roles']).isEmpty
                    ? '—'
                    : jsonList(d['granted_by_roles']).map((r) => str(r['name'])).join(', ')
              ),
            ],
          ),
    ];
  }

  Widget _summaryChip(Json s) {
    final key = s['permission_key'] as String?;
    final active = _denialKeySet && _denialKey == key;
    return Material(
      color: active ? const Color(0x1AFF7A45) : Colors.white,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10), side: BorderSide(color: active ? Brand.primary : Brand.border)),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: () {
          setState(() {
            _denialKeySet = !active;
            _denialKey = active ? null : key;
          });
          _load();
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Text.rich(TextSpan(style: const TextStyle(fontSize: 12, color: Brand.body), children: [
            TextSpan(text: '${s['count']}× ', style: const TextStyle(fontWeight: FontWeight.w700)),
            TextSpan(text: _perm(key, s['permission_label'])),
            TextSpan(text: ' · ${s['users']} user(s)', style: const TextStyle(color: Brand.muted)),
          ])),
        ),
      ),
    );
  }

  Widget _jobCard(Json j) {
    final last = j['last_run'] is Map ? jsonMap(j['last_run']) : null;
    final fails = asInt(j['failures_7d']) ?? 0;
    String result = '—';
    if (last != null) {
      if (str(last['error']).isNotEmpty) {
        final lines = str(last['error']).split('\n');
        result = _cut(lines.skip(lines.length > 2 ? lines.length - 2 : 0).join(' '), 160);
      } else {
        result = str(last['result_summary']).isNotEmpty
            ? str(last['result_summary'])
            : (last['rows'] != null ? '${last['rows']} row(s)' : 'OK');
      }
    }
    Widget? action;
    if (_canEdit) {
      action = j['idempotent'] == true
          ? PillButton(j['running'] == true ? 'Running…' : 'Run now',
              icon: Icons.play_arrow_rounded, onPressed: j['running'] == true ? null : () => _rerun(j))
          : const Tooltip(
              message: 'Not safe to repeat by hand — it runs at its next scheduled time',
              child: Text('Scheduled only', style: TextStyle(fontSize: 11, color: Brand.muted)));
    }
    return RecordCard(
      title: txt(j['label']),
      subtitle: str(j['job_id']),
      trailing: last == null ? null : _pill(last['status']),
      meta: [
        ('Schedule', txt(j['schedule'])),
        ('Next run', fmtDateTime(j['next_run_at'])),
        ('Last run', last == null ? 'Never' : fmtDateTime(last['started_at'])),
        ('Result', result),
        ('Fails (7d)', '$fails'),
      ],
      onTap: () => openScreen(context, _JobRunsScreen(job: j, canEdit: _canEdit, onRerun: () => _rerun(j))),
    ).withAction(action);
  }
}

extension on RecordCard {
  Widget withAction(Widget? action) {
    if (action == null) return this;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      this,
      Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: Align(alignment: Alignment.centerLeft, child: action)),
    ]);
  }
}

/// Run history of one job (portal: the "run history" popup).
class _JobRunsScreen extends StatelessWidget {
  const _JobRunsScreen({required this.job, required this.canEdit, required this.onRerun});
  final Json job;
  final bool canEdit;
  final VoidCallback onRerun;

  @override
  Widget build(BuildContext context) {
    final id = str(job['job_id']);
    return SubPage(
      title: '${str(job['label'])} — run history',
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Text('Background job $id${str(job['schedule']).isNotEmpty ? ' · ${str(job['schedule'])}' : ''}',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          ),
          Expanded(
            child: ApiListView(
              load: (_, _) => Api.list('/organization/monitor/jobs/${Uri.encodeComponent(id)}/runs'),
              emptyText: 'No runs recorded yet.',
              itemBuilder: (ctx, r, _) {
                final ms = r['duration_ms'];
                return Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            Expanded(
                                child: Text(fmtDateTime(r['started_at']),
                                    style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading))),
                            _pill(r['status']),
                          ]),
                          const SizedBox(height: 6),
                          Wrap(spacing: 16, runSpacing: 4, children: [
                            _kv('Duration', ms is num ? '${(ms / 1000).toStringAsFixed(1)} s' : '—'),
                            _kv('Rows', txt(r['rows'])),
                            _kv('By', txt(r['triggered_by'])),
                          ]),
                          const SizedBox(height: 6),
                          if (str(r['error']).isNotEmpty)
                            Container(
                              constraints: const BoxConstraints(maxHeight: 180),
                              child: SingleChildScrollView(
                                child: SelectableText(str(r['error']),
                                    style: const TextStyle(fontSize: 11.5, color: Color(0xFFB91C1C), fontFamily: 'monospace')),
                              ),
                            )
                          else
                            Text(txt(r['result_summary']), style: const TextStyle(fontSize: 12.5, color: Brand.body)),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
      bottom: canEdit && job['idempotent'] == true
          ? FilledButton(
              onPressed: job['running'] == true
                  ? null
                  : () {
                      Navigator.pop(context);
                      onRerun();
                    },
              child: Text(job['running'] == true ? 'Running…' : 'Run now'))
          : null,
    );
  }

  Widget _kv(String l, String v) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l, style: const TextStyle(fontSize: 11, color: Brand.muted)),
          Text(v, style: const TextStyle(fontSize: 13, color: Brand.body)),
        ],
      );
}

/// One server error with request and stack trace (portal: the "Error" popup).
class _ErrorDetailScreen extends StatelessWidget {
  const _ErrorDetailScreen({required this.errorRef});
  final String errorRef;

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'Error $errorRef',
      body: ApiLoader<Json>(
        load: () async => jsonMap(await Api.get('/organization/monitor/errors/${Uri.encodeComponent(errorRef)}')),
        builder: (ctx, e, _) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('Server error — full request and stack trace', style: TextStyle(fontSize: 12.5, color: Brand.muted)),
            const SizedBox(height: 10),
            SelectableText(
                '${str(e['method'])} ${str(e['path'])}${str(e['query_string']).isNotEmpty ? '?${str(e['query_string'])}' : ''}',
                style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
            const SizedBox(height: 4),
            Text(
                '${fmtDateTime(e['occurred_at'])} · ${str(e['user_name']).isEmpty ? 'Unknown user' : str(e['user_name'])} · ${txt(e['ip_address'])}',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            const SizedBox(height: 10),
            SelectableText('${str(e['exception_type'])}: ${str(e['message'])}',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.body)),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: const Color(0xFF1F1108), borderRadius: BorderRadius.circular(10)),
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: SelectableText(str(e['traceback']),
                    style: const TextStyle(fontSize: 11.5, color: Color(0xFFFDE7D4), fontFamily: 'monospace')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
