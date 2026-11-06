import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'mt_assets.dart';
import 'mt_common.dart';

// Reports - frontend/src/app/dashboard/maintenance/reports/page.tsx.

const _cat = [Color(0xFF2A78D6), Color(0xFFEB6834), Color(0xFF1BAF7A), Color(0xFFEDA100)];

String _hours(Object? mins) {
  final m = asNum(mins);
  return m == null ? '—' : '${fmtNumber((m / 60 * 10).round() / 10)} h';
}

String _pct(Object? v) => v == null ? '—' : '$v%';

String _month(Object? key) {
  final d = DateTime.tryParse('$key-01');
  return d == null ? str(key) : fmtDate(d).replaceFirst(RegExp(r'^\d+ '), '');
}

class ReportsTab extends StatefulWidget {
  const ReportsTab({super.key});

  @override
  State<ReportsTab> createState() => _ReportsTabState();
}

class _ReportsTabState extends State<ReportsTab> {
  late DateTime _from = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _to = DateTime.now();
  int? _branch;
  String? _category;
  int? _asset;
  String? _assetLabel;
  Json? _lookups;
  Json? _data;
  String? _error;
  bool _loading = false;
  int _token = 0;

  @override
  void initState() {
    super.initState();
    MtLookups.tryGet().then((lk) {
      if (mounted) setState(() => _lookups = lk);
    });
    _load();
  }

  Map<String, dynamic> get _params => {
        'from': apiDate(_from),
        'to': apiDate(_to),
        'branch_id': _branch,
        'category': _category,
        'asset_id': _asset,
      };

  Future<void> _load() async {
    final t = ++_token;
    setState(() => _loading = true);
    try {
      final d = asMap(await Api.get('/maintenance/reports/summary', query: _params));
      if (mounted && t == _token) {
        setState(() {
          _data = d;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted && t == _token) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted && t == _token) setState(() => _loading = false);
    }
  }

  void _set(VoidCallback change) {
    setState(change);
    _load();
  }

  Future<void> _export() => runAction(
      context,
      () => Files.downloadAndOpen('/maintenance/reports/export', 'maintenance_report_${apiDate(_from)}_to_${apiDate(_to)}.xlsx',
          query: {..._params, 'format': 'xlsx'}..removeWhere((k, v) => v == null)));

  @override
  Widget build(BuildContext context) {
    final branches = MtLookups.branches(_lookups);
    final d = _data;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          MtHeader('Maintenance Reports',
              subtitle: 'Downtime, MTTR, MTBF, availability, PM compliance and cost for the selected period.',
              actions: [if (Mt.can('reports', 'export')) smallBtn('Export Excel', d == null ? null : _export)]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Column(children: [
              Row(children: [
                Expanded(
                  child: DateField(label: 'From', required: true, value: _from, onChanged: (v) {
                    if (v != null) _set(() => _from = v);
                  }),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DateField(label: 'To', required: true, value: _to, onChanged: (v) {
                    if (v != null) _set(() => _to = v);
                  }),
                ),
              ]),
              const SizedBox(height: 8),
              AppSelect<int>(
                label: 'Asset',
                value: _asset,
                valueLabel: _assetLabel,
                loadOptions: (q) => loadAssetOptions(q, branchId: _branch),
                onChanged: (o) => _set(() {
                  _asset = o?.value;
                  _assetLabel = o?.label;
                }),
              ),
            ]),
          ),
          filterRow([
            if (branches.length > 1)
              FilterSelect<int>(
                  allLabel: 'All plants',
                  value: _branch,
                  options: branches,
                  onChanged: (v) => _set(() {
                        _branch = v;
                        _asset = null;
                        _assetLabel = null;
                      })),
            FilterSelect<String>(
                allLabel: 'All categories', value: _category, options: optionsOf(assetCategoryLabels), onChanged: (v) => _set(() => _category = v)),
          ]),
          if (_loading) const LinearProgressIndicator(minHeight: 2),
          if (_error != null) Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(_error!)),
          if (d != null) ..._report(d),
        ],
      ),
    );
  }

  List<Widget> _report(Json d) {
    final k = asMap(d['kpis']) ?? {};
    final def = asMap(d['definitions']) ?? {};
    final showCosts = Mt.showCosts;
    final downtime = asMap(d['downtime']) ?? {};
    final cost = asMap(d['cost']) ?? {};
    final pm = asMap(d['pm_compliance']) ?? {};
    final mix = asMap(d['work_mix']) ?? {};
    final top = asMap(d['top_assets']) ?? {};
    final backlog = asMap(d['backlog']) ?? {};
    final pareto = asList(d['failure_pareto']);
    final avail = asNum(k['availability_pct']);
    final comp = asNum(k['pm_compliance_pct']);
    Color? band(num? v, num good, num ok) => v == null ? null : v >= good ? kGreen : v >= ok ? kAmber : kRed;
    void openAsset(Json r) => openScreen(context, AssetDetailScreen(id: asInt(r['asset_id'])!));
    return [
      kpiGrid([
        KpiTile(
            label: 'Downtime',
            value: _hours(k['downtime_minutes']),
            color: (asNum(k['downtime_minutes']) ?? 0) > 0 ? kRed : null,
            sub: '${k['breakdowns'] ?? 0} breakdown(s). ${str(def['downtime'])}'),
        KpiTile(label: 'MTTR', value: formatMinutes(k['mttr_minutes']), sub: str(def['mttr'])),
        KpiTile(label: 'MTBF', value: k['mtbf_hours'] == null ? '—' : '${fmtNumber(k['mtbf_hours'])} h', sub: str(def['mtbf'])),
        KpiTile(
            label: 'Availability',
            value: _pct(k['availability_pct']),
            color: band(avail, 95, 85),
            sub: '${str(def['availability'])} Available: ${fmtNumber(k['available_hours'])} h.'),
        KpiTile(label: 'PM Compliance', value: _pct(k['pm_compliance_pct']), color: band(comp, 90, 70), sub: str(def['pm_compliance'])),
        if (showCosts) KpiTile(label: 'Maintenance Cost', value: formatInr(k['maintenance_cost']), sub: str(def['cost'])),
      ]),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: smallText('Available-hours basis: ${str(asMap(d['availability_basis'])?['description'])}'),
      ),
      DetailSection('Breakdown downtime by month', children: [
        hintText('Hours, counted only inside the period.'),
        _BarChart(
          labels: [for (final m in asList(downtime['by_month'])) _month(m['month'])],
          series: [
            ('Downtime (h)', _cat[1], [for (final m in asList(downtime['by_month'])) ((asNum(m['downtime_minutes']) ?? 0) / 6).round() / 10]),
          ],
        ),
      ]),
      if (showCosts)
        DetailSection('Maintenance cost by month', children: [
          hintText('Jobs finished in each month — spares, labour and outside vendors.'),
          _BarChart(
            labels: [for (final m in asList(cost['by_month'])) _month(m['month'])],
            series: [
              ('Spares', _cat[0], [for (final m in asList(cost['by_month'])) asNum(m['spares']) ?? 0]),
              ('Labour', _cat[2], [for (final m in asList(cost['by_month'])) asNum(m['labour']) ?? 0]),
              ('External', _cat[3], [for (final m in asList(cost['by_month'])) asNum(m['external']) ?? 0]),
            ],
            money: true,
          ),
        ]),
      DetailSection('PM compliance', children: [
        hintText('PM jobs whose due date falls in the period.'),
        if ((asInt(pm['due']) ?? 0) == 0)
          mutedText('No PM jobs were due in this period.')
        else
          for (final (l, key, c) in [
            ('Due in period', 'due', Brand.heading),
            ('Done on time', 'on_time', kGreen),
            ('Done late', 'late', kAmber),
            ('Overdue, not done', 'missed', kRed),
            ('Not yet due', 'not_yet_due', Brand.muted),
          ])
            _kv(l, '${pm[key] ?? 0}', c),
      ]),
      DetailSection('Breakdown vs planned work', children: [
        hintText('Jobs raised in the period. A healthy plant does most of its work as planned (PM) jobs.'),
        if ((asInt(mix['breakdown']) ?? 0) + (asInt(mix['planned']) ?? 0) == 0)
          mutedText('No work orders raised in this period.')
        else ...[
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: SizedBox(
              height: 14,
              child: Row(children: [
                Expanded(flex: math.max(1, (1000 - (asNum(mix['planned_pct']) ?? 0) * 10).round()), child: Container(color: kRed)),
                Expanded(flex: math.max(1, ((asNum(mix['planned_pct']) ?? 0) * 10).round()), child: Container(color: kGreen)),
              ]),
            ),
          ),
          const SizedBox(height: 8),
          Text('${mix['breakdown']} breakdown / corrective · ${mix['planned']} preventive / calibration / inspection',
              style: const TextStyle(fontSize: 13)),
          smallText('Planned share: ${_pct(mix['planned_pct'])}'
              '${(asInt(mix['other']) ?? 0) > 0 ? ' · ${mix['other']} improvement job(s) not counted' : ''}'),
        ],
      ]),
      for (final (title, key) in [('Top 10 — most breakdowns', 'by_breakdowns'), ('Top 10 — most downtime', 'by_downtime')])
        DetailSection(title, children: [
          hintText('Your worst offenders — candidates for a root-cause review or a PM plan.'),
          if (asList(top[key]).isEmpty) mutedText('No breakdowns in this period.'),
          for (final r in asList(top[key]))
            LineItem(
              title: '${r['asset_code']} ${str(r['asset_name'])}',
              trailing: [smallText('${r['breakdowns']} breakdowns'), smallText(formatMinutes(r['downtime_minutes']))],
              onTap: () => openAsset(r),
            ),
        ]),
      DetailSection('Backlog — open work orders by age', children: [
        hintText('As of today (not limited to the period). Old urgent jobs are the ones to chase.'),
        if ((asInt(backlog['total']) ?? 0) == 0)
          mutedText('No open work orders.')
        else
          for (final r in asList(backlog['matrix']))
            LineItem(
              title: 'Age ${r['age_bucket']} days',
              trailing: [Text('${r['total']}', style: const TextStyle(fontWeight: FontWeight.w700))],
              badges: [
                for (final p in (backlog['priorities'] is List ? backlog['priorities'] as List : const []))
                  smallText('${priorityText(p)}: ${asInt(r['$p']) ?? 0}',
                      color: (asInt(r['$p']) ?? 0) > 0 ? priorityHex[normPriority(p)]! : Brand.muted, weight: FontWeight.w600),
              ],
            ),
      ]),
      DetailSection('Failure Pareto', children: [
        hintText('Breakdown + corrective jobs by failure category. The top few usually explain ~80% of failures — fix those first.'),
        if (pareto.isEmpty) mutedText('No breakdowns in this period.'),
        for (final r in pareto)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                    child: Text(r['failure_category'] == 'not_recorded' ? 'Not recorded' : label(failureCategoryLabels, r['failure_category']),
                        style: const TextStyle(fontSize: 13))),
                smallText('${r['count']} jobs · cum. ${r['cumulative_pct']}%'),
              ]),
              const SizedBox(height: 4),
              ClipRRect(
                borderRadius: BorderRadius.circular(20),
                child: LinearProgressIndicator(
                  value: ((asNum(r['pct']) ?? 0) / 100).clamp(0, 1).toDouble(),
                  minHeight: 8,
                  color: _cat[1],
                  backgroundColor: const Color(0x14000000),
                ),
              ),
            ]),
          ),
      ]),
      if (showCosts)
        DetailSection('Cost by asset', children: [
          hintText('Jobs finished in the period.'),
          if (asList(cost['by_asset']).isEmpty) mutedText('No finished jobs with cost in this period.'),
          for (final r in asList(cost['by_asset']))
            LineItem(
              title: '${r['asset_code']} ${str(r['asset_name'])}',
              subtitle: 'Jobs ${r['jobs']} · Spares ${formatInr(r['spares'])} · Labour ${formatInr(r['labour'])} · External ${formatInr(r['external'])}',
              trailing: [Text(formatInr(r['total']), style: const TextStyle(fontWeight: FontWeight.w700))],
            ),
        ]),
      DetailSection('Availability by asset', children: [
        hintText('Assets that had breakdowns in the period.'),
        if (asList(downtime['by_asset']).isEmpty) mutedText('No breakdown downtime in this period — every asset was 100% available.'),
        for (final r in asList(downtime['by_asset']))
          LineItem(
            title: '${r['asset_code']} ${str(r['asset_name'])}',
            subtitle: 'Breakdowns ${r['breakdowns']} · Downtime ${formatMinutes(r['downtime_minutes'])} · Available ${fmtNumber(r['available_hours'])} h',
            trailing: [Text(_pct(r['availability_pct']), style: const TextStyle(fontWeight: FontWeight.w700))],
          ),
      ]),
    ];
  }

  Widget _kv(String l, String v, Color c) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Expanded(child: Text(l, style: const TextStyle(fontSize: 13))),
          Text(v, style: TextStyle(fontWeight: FontWeight.w700, color: c)),
        ]),
      );
}

/// Simple (stacked) vertical bar chart drawn with boxes.
class _BarChart extends StatelessWidget {
  const _BarChart({required this.labels, required this.series, this.money = false});
  final List<String> labels;
  final List<(String, Color, List<num>)> series;
  final bool money;

  @override
  Widget build(BuildContext context) {
    if (labels.isEmpty) return mutedText('No data in this period.');
    final totals = [
      for (var i = 0; i < labels.length; i++) series.fold<num>(0, (s, e) => s + (i < e.$3.length ? e.$3[i] : 0)),
    ];
    final maxV = totals.fold<num>(0, (a, b) => math.max(a, b));
    const h = 150.0;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (series.length > 1)
        Wrap(spacing: 12, children: [
          for (final s in series)
            Row(mainAxisSize: MainAxisSize.min, children: [
              Container(width: 10, height: 10, color: s.$2),
              const SizedBox(width: 4),
              smallText(s.$1),
            ]),
        ]),
      const SizedBox(height: 8),
      SizedBox(
        height: h + 34,
        child: ListView(
          scrollDirection: Axis.horizontal,
          children: [
            for (var i = 0; i < labels.length; i++)
              Padding(
                padding: const EdgeInsets.only(right: 10),
                child: SizedBox(
                  width: 44,
                  child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                    Text(money ? formatInr(totals[i]).replaceAll('₹', '') : fmtNumber(totals[i]),
                        style: const TextStyle(fontSize: 9.5, color: Brand.muted), maxLines: 1, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    for (final s in series.reversed)
                      Container(
                        width: 28,
                        height: maxV == 0 ? 0 : (i < s.$3.length ? s.$3[i] : 0) / maxV * h,
                        color: s.$2,
                      ),
                    const SizedBox(height: 4),
                    Text(labels[i], style: const TextStyle(fontSize: 10, color: Brand.muted), maxLines: 1),
                  ]),
                ),
              ),
          ],
        ),
      ),
    ]);
  }
}
