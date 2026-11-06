import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';

// M.I.S Report (portal app/dashboard/p2p/mis): KPIs, trend and category bars,
// pending approvals by approver, Excel export.

const _periods = [
  Option('daily', 'Daily'), Option('weekly', 'Weekly'), Option('monthly', 'Monthly'), Option('yearly', 'Yearly'), Option('custom', 'Custom'),
];
const _palette = [Color(0xFF2A78D6), Color(0xFFEB6834), Color(0xFF1BAF7A), Color(0xFFEDA100)];

class MisTab extends StatefulWidget {
  const MisTab({super.key});

  @override
  State<MisTab> createState() => _MisTabState();
}

class _MisTabState extends State<MisTab> {
  String _period = 'weekly';
  DateTime? _from;
  DateTime? _to;
  Json? _summary;
  Object? _error;
  bool _loading = true;

  bool get _incomplete => _period == 'custom' && (_from == null || _to == null);
  bool get _invalid => _period == 'custom' && _from != null && _to != null && _from!.isAfter(_to!);

  Map<String, dynamic> get _params => _period == 'custom'
      ? {'period': _period, 'date_from': _from == null ? null : apiDate(_from!), 'date_to': _to == null ? null : apiDate(_to!)}
      : {'period': _period};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_incomplete || _invalid) {
      setState(() {
        _summary = null;
        _loading = false;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final s = asJson(await Api.get('/p2p/mis/summary', query: _params));
      if (mounted) setState(() => _summary = s);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _filters() async {
    var period = _period;
    var from = _from;
    var to = _to;
    final ok = await showFormSheet(context, title: 'Filters', saveLabel: 'Apply Filters', builder: (ctx, setS) => [
          const Hint('Choose the period the report covers, then press Apply.'),
          AppSelect<String>(label: 'Period', value: period, clearable: false, options: _periods, onChanged: (o) => setS(() => period = o?.value ?? 'weekly')),
          if (period == 'custom') ...[
            DateField(label: 'From', value: from, onChanged: (d) => setS(() => from = d)),
            DateField(label: 'To', value: to, onChanged: (d) => setS(() => to = d)),
            if (from != null && to != null && from!.isAfter(to!))
              const Hint('The From date must be on or before the To date.', color: Brand.danger)
            else if (from == null || to == null)
              const Hint('Pick both dates to load the report.'),
          ],
        ], onSave: () async {});
    if (!ok) return;
    setState(() {
      _period = period;
      _from = from;
      _to = to;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final s = _summary;
    final k = asJson(s?['kpis']);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const PageHeader('M.I.S Report'),
        if (s != null)
          ChipStrip([
            CountChip('PRs created', k['prs_created'], color: const Color(0xFF3B82F6)),
            CountChip('PRs approved', k['prs_approved'], color: const Color(0xFF16A34A)),
            CountChip('PRs rejected', k['prs_rejected'], color: const Color(0xFFDC2626)),
            CountChip('PRs pending approval', k['prs_pending_approval'], color: const Color(0xFFCA8A04)),
            CountChip('POs raised', k['pos_raised'], color: const Color(0xFF3B82F6)),
            CountChip('POs approved', k['pos_approved'], color: const Color(0xFF16A34A)),
            CountChip('POs pending approval', k['pos_pending_approval'], color: const Color(0xFFCA8A04)),
          ]),
        FilterBar(
          count: _period != 'weekly' ? 1 : 0,
          onOpen: _filters,
          onClear: () {
            setState(() {
              _period = 'weekly';
              _from = null;
              _to = null;
            });
            _load();
          },
          leading: [if (s != null) Hint('${fmtDate(s['date_from'])} – ${fmtDate(s['date_to'])}')],
          trailing: [
            if (P2pAccess.can('mis', 'export'))
              secondaryBtn('Export', _loading || s == null
                  ? null
                  : () => openApiFile(context, '/p2p/mis/export', 'P2P_MIS_${_period}_${s['date_from'] ?? ''}_to_${s['date_to'] ?? ''}.xlsx',
                      query: _params)),
          ],
        ),
        if (_invalid || _incomplete)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Hint(_invalid ? 'The From date must be on or before the To date. Open Filters to fix it.' : 'Pick both dates in Filters to load the report.',
                color: _invalid ? Brand.danger : null),
          ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(16),
            child: ErrorBanner('${ApiClient.describe(_error!)} Purchase module or PO approver access is required.'),
          ),
        if (_loading) const LoadingView(),
        if (!_loading && s != null) ...[
          DetailSection('Trend — Created vs Approved vs PO Raised', children: [
            Wrap(spacing: 12, children: [
              for (final (i, l) in const ['Created', 'Approved', 'PO Raised'].indexed)
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Container(width: 10, height: 10, color: _palette[[0, 2, 3][i]]),
                  const SizedBox(width: 4),
                  Text(l, style: const TextStyle(fontSize: 12)),
                ]),
            ]),
            const SizedBox(height: 8),
            ..._trend(jList(s, 'trend')),
          ]),
          DetailSection('PRs by Category', children: [
            if (jList(s, 'category_breakdown').isEmpty) const Hint('No PRs created in this period.'),
            ..._bars([for (final c in jList(s, 'category_breakdown')) (jStr(c, 'label') ?? '', jD(c, 'count'))], _palette[1]),
          ]),
          DetailSection('Pending Approval — By Approver', children: [
            if (jList(s, 'approver_pending').isEmpty) const Text('Nothing is waiting for an approver in this period.'),
            for (final a in jList(s, 'approver_pending'))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(children: [
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(jStr(a, 'approver_name') ?? '—'),
                      Hint(jStr(a, 'role') == null ? '—' : humanize(a['role'])),
                    ]),
                  ),
                  Text('${a['pending_count']}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                ]),
              ),
          ]),
        ],
      ]),
    );
  }

  List<Widget> _trend(List<Json> rows) {
    final max = rows.fold<double>(1, (m, t) => [m, jD(t, 'created'), jD(t, 'approved'), jD(t, 'po_raised')].reduce((a, b) => a > b ? a : b));
    return [
      for (final t in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch('${t['date']}') ? fmtDate(t['date']) : '${t['date']}',
                style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
            for (final (key, color) in [('created', _palette[0]), ('approved', _palette[2]), ('po_raised', _palette[3])])
              _bar(jD(t, key), max, color),
          ]),
        ),
    ];
  }

  List<Widget> _bars(List<(String, double)> rows, Color color) {
    final max = rows.fold<double>(1, (m, r) => r.$2 > m ? r.$2 : m);
    return [
      for (final r in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(r.$1, style: const TextStyle(fontSize: 12)),
            _bar(r.$2, max, color),
          ]),
        ),
    ];
  }

  Widget _bar(double v, double max, Color color) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Row(children: [
          Expanded(
            child: LayoutBuilder(
              builder: (ctx, c) => Align(
                alignment: Alignment.centerLeft,
                child: Container(
                  width: (c.maxWidth * (v / max)).clamp(2, c.maxWidth).toDouble(),
                  height: 10,
                  decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4)),
                ),
              ),
            ),
          ),
          SizedBox(width: 36, child: Text(fmtNumber(v), textAlign: TextAlign.right, style: const TextStyle(fontSize: 11.5))),
        ]),
      );
}