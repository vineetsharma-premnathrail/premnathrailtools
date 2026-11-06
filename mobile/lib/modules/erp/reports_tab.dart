import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'erp_common.dart';

const _presets = <Option<String>>[
  Option('this_month', 'This month'),
  Option('last_month', 'Last month'),
  Option('this_quarter', 'This quarter'),
  Option('last_quarter', 'Last quarter'),
  Option('this_fy', 'This financial year'),
  Option('last_fy', 'Last financial year'),
  Option('last_30_days', 'Last 30 days'),
  Option('last_90_days', 'Last 90 days'),
];

/// From-to of a report preset (portal lib/reports/dates.ts, FY April-March).
(String, String) _resolve(String key) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  String d(DateTime x) => apiDate(x);
  DateTime last(int y, int m) => DateTime(y, m + 1, 0);
  final y = today.year, m = today.month;
  switch (key) {
    case 'last_month':
      final pm = m == 1 ? 12 : m - 1, py = m == 1 ? y - 1 : y;
      return (d(DateTime(py, pm, 1)), d(last(py, pm)));
    case 'this_quarter':
      return (d(DateTime(y, ((m - 1) ~/ 3) * 3 + 1, 1)), d(today));
    case 'last_quarter':
      var qm = ((m - 1) ~/ 3) * 3 + 1 - 3;
      var qy = y;
      if (qm < 1) {
        qm += 12;
        qy -= 1;
      }
      return (d(DateTime(qy, qm, 1)), d(last(qy, qm + 2)));
    case 'this_fy':
      return (d(DateTime(m >= 4 ? y : y - 1, 4, 1)), d(today));
    case 'last_fy':
      final fy = (m >= 4 ? y : y - 1) - 1;
      return (d(DateTime(fy, 4, 1)), d(DateTime(fy + 1, 3, 31)));
    case 'last_30_days':
      return (d(today.subtract(const Duration(days: 29))), d(today));
    case 'last_90_days':
      return (d(today.subtract(const Duration(days: 89))), d(today));
    default:
      return (d(DateTime(y, m, 1)), d(today));
  }
}

class _Spec {
  _Spec(Map r, {bool kpi = false})
      : id = '${r['id'] ?? r['key'] ?? ''}',
        kind = kpi || r['is_kpi'] == true ? 'kpi' : '${r['kind'] ?? 'column'}',
        title = '${r['title'] ?? r['label'] ?? ''}',
        hint = (r['hint'] ?? r['definition'])?.toString(),
        type = (r['value_type'] ?? r['type'])?.toString(),
        dimension = _dim(r);
  final String id;
  final String kind;
  final String title;
  final String? hint;
  final String? type;
  final String? dimension;

  static String? _dim(Map r) {
    final drill = r['drill'];
    if (drill is String) return drill;
    if (drill is Map && drill['dimension'] is String) return drill['dimension'] as String;
    for (final k in ['drill_dimension', 'dimension', 'group_by']) {
      if (r[k] is String) return r[k] as String;
    }
    return null;
  }
}

class _Page {
  _Page(Map r)
      : key = '${r['key'] ?? ''}',
        label = '${r['label'] ?? r['key'] ?? ''}',
        hint = r['hint']?.toString(),
        snapshot = r['date_mode'] == 'snapshot',
        selfOnly = r['self_only'] == true,
        kpis = [for (final k in (r['kpis'] as List? ?? const []).whereType<Map>()) _Spec(k, kpi: true)],
        visuals = [for (final v in (r['visuals'] as List? ?? const []).whereType<Map>()) _Spec(v)];
  final String key;
  final String label;
  final String? hint;
  final bool snapshot;
  final bool selfOnly;
  final List<_Spec> kpis;
  final List<_Spec> visuals;
}

String _fmtValue(Object? v, String? type) {
  if (v == null) return '—';
  if (v is String && num.tryParse(v) == null) return v;
  final n = numOf(v);
  switch (type) {
    case 'money':
    case 'currency':
      return fmtMoney(n);
    case 'percent':
    case 'pct':
      return '${n.toStringAsFixed(n == n.roundToDouble() ? 0 : 1)}%';
    case 'hours':
      return '${fmtNumber(n)} h';
    case 'days':
      return '${fmtNumber(n)} d';
    default:
      return fmtNumber(n);
  }
}

/// Service › Reports (portal: ModuleDashboardPage module="erp") - dashboard
/// pages, period, KPI cards and charts; tap a bar to filter the other charts;
/// Export to Excel.
class ServiceReportsTab extends StatefulWidget {
  const ServiceReportsTab({super.key});

  @override
  State<ServiceReportsTab> createState() => _ServiceReportsTabState();
}

class _ServiceReportsTabState extends State<ServiceReportsTab> {
  List<_Page>? _pages;
  bool _canExport = false;
  String? _catError;
  String? _moduleLabel;
  int _pageIndex = 0;
  String _preset = 'this_month';
  Json? _results;
  List<String> _notes = [];
  String? _error;
  bool _loading = false;
  int _seq = 0;

  /// Chart clicks: dimension -> (tokens, labels).
  final Map<String, List<(String, String)>> _sel = {};

  @override
  void initState() {
    super.initState();
    _loadCatalogue();
  }

  Future<void> _loadCatalogue() async {
    setState(() => _catError = null);
    try {
      final c = await Api.get('/reports/erp');
      final dashes = c is Map ? (c['dashboards'] as List? ?? const []) : const [];
      final pages = dashes.isEmpty || dashes.first is! Map
          ? <_Page>[]
          : [for (final p in ((dashes.first as Map)['pages'] as List? ?? const []).whereType<Map>()) _Page(p)];
      if (!mounted) return;
      setState(() {
        _pages = pages;
        _canExport = c is Map && c['can_export'] == true;
        _moduleLabel = c is Map ? c['module_label']?.toString() : null;
      });
      if (pages.isNotEmpty) _run();
    } catch (e) {
      if (mounted) {
        setState(() => _catError =
            'The dashboards could not be loaded - check your connection and press Reload. ${ApiClient.describe(e)}');
      }
    }
  }

  _Page get _page => _pages![_pageIndex];

  Map<String, String> _filterParams({String? except}) => {
        for (final e in _sel.entries)
          if (e.key != except && e.value.isNotEmpty) 'f_${e.key}': e.value.map((t) => t.$1).join(','),
      };

  Map<String, dynamic> _period() {
    if (_page.snapshot) return {};
    final (from, to) = _resolve(_preset);
    return {'preset': _preset, 'date_from': from, 'date_to': to};
  }

  Future<void> _run() async {
    final my = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = _page;
      final body = {
        ..._period(),
        'filters': _filterParams(),
        'visuals': [
          for (final v in [...page.kpis, ...page.visuals])
            if (v.dimension != null && _sel.containsKey(v.dimension))
              {'id': v.id, 'filters': _filterParams(except: v.dimension)}
            else
              {'id': v.id},
        ],
      };
      final d = await Api.post('/reports/erp/dashboard/${page.key}', data: body);
      if (my != _seq || !mounted) return;
      final m = d is Map ? d : const {};
      setState(() {
        _results = {
          ...(m['results'] is Map ? Map<String, dynamic>.from(m['results'] as Map) : const {}),
          ...(m['kpis'] is Map ? Map<String, dynamic>.from(m['kpis'] as Map) : const {}),
        };
        _notes = (m['notes'] as List? ?? const []).map((x) => '$x').toList();
      });
    } catch (e) {
      if (my == _seq && mounted) {
        setState(() => _error =
            'The dashboard could not be loaded - check your connection and press Reload. ${ApiClient.describe(e)}');
      }
    } finally {
      if (my == _seq && mounted) setState(() => _loading = false);
    }
  }

  Future<void> _export() async {
    showSnack(context, 'Preparing Excel…');
    try {
      await Files.downloadAndOpen('/reports/erp/dashboard/${_page.key}/export', 'erp_${_page.key}.xlsx',
          query: {..._period(), ..._filterParams()});
    } catch (e) {
      if (mounted) {
        showSnack(context,
            'The export failed - ${ApiClient.describe(e)} If it keeps failing, choose a shorter period.',
            error: true);
      }
    }
  }

  void _toggle(String dim, String token, String label) {
    final cur = _sel[dim] ?? [];
    final has = cur.any((t) => t.$1 == token);
    setState(() {
      if (has && cur.length == 1) {
        _sel.remove(dim);
      } else {
        _sel[dim] = [(token, label)];
      }
    });
    _run();
  }

  @override
  Widget build(BuildContext context) {
    if (_catError != null) return ErrorView(_catError!, onRetry: _loadCatalogue);
    final pages = _pages;
    if (pages == null) return const LoadingView();
    if (pages.isEmpty) {
      return const EmptyView('There are no dashboards you can open in this module yet. '
          'Ask an admin to give your role Reports access in Organization > Role & Permissions.');
    }
    final page = _page;
    final results = _results ?? const {};
    return RefreshIndicator(
      onRefresh: _run,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          PageHeader('Reports', subtitle: 'Service performance at a glance', actions: [
            if (_canExport) IconButton(tooltip: 'Export to Excel', onPressed: _export, icon: const Icon(Icons.download_rounded)),
          ]),
          if (pages.length > 1)
            SizedBox(
              height: 48,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                itemCount: pages.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (_, i) => ChoiceChip(
                  label: Text(pages[i].label),
                  selected: i == _pageIndex,
                  showCheckmark: false,
                  selectedColor: Brand.primarySoft,
                  onSelected: (_) {
                    if (i == _pageIndex) return;
                    setState(() {
                      _pageIndex = i;
                      _sel.clear();
                      _results = null;
                    });
                    _run();
                  },
                ),
              ),
            ),
          if ((page.hint ?? '').isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Text(page.hint!, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            ),
          if (!page.snapshot)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: AppSelect<String>(
                label: 'Period',
                value: _preset,
                clearable: false,
                options: _presets,
                onChanged: (o) {
                  if (o == null) return;
                  setState(() => _preset = o.value);
                  _run();
                },
              ),
            ),
          if (_sel.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Wrap(spacing: 6, runSpacing: 6, children: [
                for (final e in _sel.entries)
                  for (final t in e.value)
                    InputChip(
                      label: Text(t.$2),
                      onDeleted: () {
                        setState(() => _sel.remove(e.key));
                        _run();
                      },
                    ),
                ActionChip(
                  label: const Text('Clear all'),
                  onPressed: () {
                    setState(_sel.clear);
                    _run();
                  },
                ),
              ]),
            ),
          if (page.selfOnly)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                  'Showing only your own figures - team figures need ${_moduleLabel ?? 'Service Module'} > Reports > People & performance.',
                  style: const TextStyle(fontSize: 12.5, color: Color(0xFF2563EB))),
            ),
          for (final n in _notes)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(n, style: const TextStyle(fontSize: 12.5, color: Color(0xFF92400E))),
            ),
          if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: ErrorView(_error!, onRetry: _run)),
          if (_loading && _results == null) const LoadingView(),
          if (page.kpis.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.6,
                children: [for (final k in page.kpis) _kpi(k, results[k.id])],
              ),
            ),
          for (final v in page.visuals) _visual(v, results[v.id]),
        ],
      ),
    );
  }

  Widget _kpi(_Spec k, Object? raw) {
    final r = raw is Map ? raw : const {};
    final values = r['values'] is List ? r['values'] as List : null;
    final value = r['value'] ?? (values != null && values.isNotEmpty ? values.first : r['total']);
    final delta = r['delta_pct'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(k.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Brand.muted)),
          const SizedBox(height: 4),
          Text(raw == null ? '…' : _fmtValue(value, k.type ?? r['type']?.toString()),
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Brand.heading)),
          if (delta is num)
            Text('${delta >= 0 ? '▲' : '▼'} ${delta.abs().toStringAsFixed(1)}%',
                style: TextStyle(fontSize: 11.5, color: delta >= 0 ? Brand.success : Brand.danger)),
        ]),
      ),
    );
  }

  Widget _visual(_Spec v, Object? raw) {
    final r = raw is Map ? raw : const {};
    final children = <Widget>[];
    if (raw == null) {
      children.add(Text(_error != null ? 'Could not load.' : 'Loading...', style: const TextStyle(color: Brand.muted)));
    } else if (v.kind == 'table') {
      final cols = (r['columns'] as List? ?? const []).whereType<Map>().toList();
      final rows = (r['rows'] as List? ?? const []).whereType<Map>().toList();
      if (rows.isEmpty) {
        children.add(const Text('Nothing to show for this period and these filters. Widen the dates or clear a filter.',
            style: TextStyle(color: Brand.muted)));
      }
      for (final row in rows) {
        final flat = row.containsKey('values') && row.containsKey('label')
            ? {'__label': row['label'], ...(row['values'] is Map ? row['values'] as Map : const {})}
            : row;
        final name = flat['__label'] ?? flat[cols.isEmpty ? '' : cols.first['key']];
        children.add(Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(txt(name), style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
            Wrap(spacing: 12, children: [
              for (final c in cols)
                if (c['key'] != '__label' && c['key'] != 'label' && flat[c['key']] != null && flat[c['key']] != name)
                  Text('${c['label'] ?? c['key']}: ${_fmtValue(flat[c['key']], c['type']?.toString())}',
                      style: const TextStyle(fontSize: 12.5, color: Brand.body)),
            ]),
          ]),
        ));
      }
    } else {
      final labels = (r['labels'] as List? ?? const []).map((x) => '$x').toList();
      List data;
      if (r['datasets'] is List && (r['datasets'] as List).isNotEmpty) {
        final sets = (r['datasets'] as List).whereType<Map>().toList();
        data = List.generate(labels.length, (i) => sets.fold<num>(0, (s, d) {
              final arr = d['data'] as List? ?? const [];
              return s + (i < arr.length ? numOf(arr[i]) : 0);
            }));
      } else {
        data = r['values'] as List? ?? const [];
      }
      final tk = r['tokens'] ?? (r['drill'] is Map ? (r['drill'] as Map)['tokens'] : null);
      List<String> tokens = labels;
      if (tk is List) tokens = tk.map((x) => '$x').toList();
      if (tk is Map) tokens = labels.map((l) => '${tk[l] ?? l}').toList();
      final rows = <(String, num)>[for (var i = 0; i < labels.length; i++) (labels[i], i < data.length ? numOf(data[i]) : 0)];
      final dim = (r['drill'] is Map && (r['drill'] as Map)['dimension'] is String)
          ? (r['drill'] as Map)['dimension'] as String
          : v.dimension;
      if (rows.isEmpty || rows.every((x) => x.$2 == 0)) {
        children.add(const Text('Nothing to show for this period and these filters. Widen the dates or clear a filter.',
            style: TextStyle(color: Brand.muted)));
      } else {
        final selected = dim == null ? <String>{} : (_sel[dim] ?? []).map((t) => t.$1).toSet();
        children.add(BarList(
          rows: rows,
          labelFor: (k) => k,
          isActive: (k) {
            final i = labels.indexOf(k);
            return i >= 0 && i < tokens.length && selected.contains(tokens[i]);
          },
          onTap: dim == null
              ? null
              : (k) {
                  final i = labels.indexOf(k);
                  if (i >= 0 && i < tokens.length) _toggle(dim, tokens[i], k);
                },
        ));
      }
    }
    return DetailSection(v.title, children: [
      if ((v.hint ?? '').isNotEmpty)
        Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(v.hint!, style: const TextStyle(fontSize: 12, color: Brand.muted))),
      ...children,
    ]);
  }
}
