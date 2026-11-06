import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';

const _ncrSources = <String, String>{
  'incoming': 'Incoming inspection',
  'job_work': 'Job work',
  'in_process': 'In-process',
  'final': 'Final',
  'customer_inspection': 'Customer / third-party',
  'complaint': 'Customer complaint',
  'audit': 'Audit',
  'internal': 'Internal',
};

/// Quality Reports — defect Pareto (portal reports/page.tsx).
class ReportsTab extends StatefulWidget {
  const ReportsTab({super.key});

  @override
  State<ReportsTab> createState() => _ReportsTabState();
}

class _ReportsTabState extends State<ReportsTab> {
  String _basis = 'ncr';
  DateTime? _from = DateTime(DateTime.now().year, 1, 1);
  DateTime? _to;
  int? _itemId;
  String? _itemLabel;
  final _vendor = TextEditingController();
  String _source = '';
  List<Json> _rows = [];
  num _total = 0;
  bool _loading = true;
  String _error = '';
  int _token = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _vendor.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final t = ++_token;
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final r = await Api.get('/quality/analysis/defect-pareto', query: {
        'basis': _basis,
        'date_from': _from == null ? null : apiDate(_from!),
        'date_to': _to == null ? null : apiDate(_to!),
        'item_id': _itemId,
        'vendor': _vendor.text.trim(),
        'source': _source,
      });
      if (!mounted || t != _token) return;
      setState(() {
        _rows = r is Map ? rowsOf(r['rows']) : <Json>[];
        _total = r is Map ? (asNum(r['total']) ?? 0) : 0;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || t != _token) return;
      setState(() {
        _error = ApiClient.describe(e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final sources = _basis == 'ncr' ? _ncrSources : inspectionTypeLabels;
    var max = 1;
    for (final r in _rows) {
      final c = asInt(r['count']) ?? 0;
      if (c > max) max = c;
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          const PageHeader('Quality Reports', subtitle: 'Quality Module'),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: ErrorBanner(_error)),
          DetailSection('Defect Pareto', children: [
            AppSelect<String>(
              label: 'Count',
              value: _basis,
              clearable: false,
              options: const [Option('ncr', 'NCRs'), Option('lot_results', 'Failed characteristics on lots')],
              onChanged: (o) {
                setState(() {
                  _basis = o?.value ?? _basis;
                  _source = '';
                });
                _load();
              },
            ),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: DateField(
                    label: 'From',
                    value: _from,
                    onChanged: (d) {
                      setState(() => _from = d);
                      _load();
                    }),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: DateField(
                    label: 'To',
                    value: _to,
                    onChanged: (d) {
                      setState(() => _to = d);
                      _load();
                    }),
              ),
            ]),
            const SizedBox(height: 10),
            AppSelect<int>(
              label: 'Item',
              value: _itemId,
              valueLabel: _itemLabel,
              loadOptions: loadQualityItems,
              onChanged: (o) {
                setState(() {
                  _itemId = o?.value;
                  _itemLabel = o?.label;
                });
                _load();
              },
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _vendor,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _load(),
              decoration: fieldDecoration('Vendor',
                  suffix: IconButton(icon: const Icon(Icons.search_rounded), onPressed: _load)),
            ),
            const SizedBox(height: 10),
            AppSelect<String>(
              label: _basis == 'ncr' ? 'NCR source' : 'Inspection type',
              value: _source,
              clearable: false,
              options: [const Option('', 'All'), for (final e in sources.entries) Option(e.key, e.value)],
              onChanged: (o) {
                setState(() => _source = o?.value ?? '');
                _load();
              },
            ),
            const SizedBox(height: 10),
            Text(
                '${fmtNumber(_total)} occurrence(s). Highlighted rows are the "vital few" — the defect codes that make up '
                'the first 80% — where a CAPA pays off most.',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          ]),
          if (_loading)
            const LoadingView()
          else if (_rows.isEmpty)
            const EmptyView('No defects in this selection.')
          else
            for (final r in _rows) _row(r, max),
        ],
      ),
    );
  }

  Widget _row(Json r, int max) {
    final vital = r['vital_few'] == true;
    final count = asInt(r['count']) ?? 0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Card(
        color: vital ? const Color(0xFFFFF6F1) : Colors.white,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text('${txt(r['code'])} — ${txt(r['name'])}',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
              ),
              Text('$count', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            ]),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: count / max,
                minHeight: 10,
                backgroundColor: const Color(0x0F0F172A),
                color: vital ? qAccent : const Color(0xFFA8A29E),
              ),
            ),
            const SizedBox(height: 6),
            Wrap(spacing: 16, runSpacing: 4, children: [
              _kv('Category', txt(r['category'])),
              _kv('%', '${txt(r['percent'])}%'),
              _kv('Cumulative %', '${txt(r['cumulative_percent'])}%'),
              _kv('Quantity', txt(r['quantity'])),
              if (_basis == 'ncr') _kv('Cost', r['cost'] == null ? '—' : '₹${fmtNumber(r['cost'])}'),
            ]),
          ]),
        ),
      ),
    );
  }

  Widget _kv(String l, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text(l, style: const TextStyle(fontSize: 11, color: Brand.muted)),
        Text(v, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
      ]);
}
