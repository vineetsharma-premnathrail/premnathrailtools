import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'prod_common.dart';
import 'work_orders.dart';

/// Production › Reports - portal reports/page.tsx + WipReportSection.tsx.
class ReportsTab extends StatefulWidget {
  const ReportsTab({super.key});

  @override
  State<ReportsTab> createState() => _ReportsTabState();
}

class _ReportsTabState extends State<ReportsTab> {
  DateTime _from = DateTime.now().subtract(const Duration(days: 29));
  DateTime _to = DateTime.now();
  DateTime _asOf = DateTime.now();
  Json? _report;
  Json? _wip;
  Object? _error;
  Object? _wipError;
  bool _loading = true;

  bool get _seeCosts => ProdPerm.feat('reports', 'costs', 'view');
  bool get _canExport => ProdPerm.can('reports', 'export');

  @override
  void initState() {
    super.initState();
    _load();
    if (_seeCosts) _loadWip();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final d = mapOf(await Api.get('/production/reports', query: {'date_from': apiDate(_from), 'date_to': apiDate(_to)}));
      if (mounted) {
        setState(() {
        _report = d;
        _error = null;
        _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
        _error = e;
        _loading = false;
        });
      }
    }
  }

  Future<void> _loadWip() async {
    try {
      final d = mapOf(await Api.get('/production/reports/wip', query: {'as_of': apiDate(_asOf)}));
      if (mounted) {
        setState(() {
        _wip = d;
        _wipError = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _wipError = e);
    }
  }

  void _openWo(Object? id) {
    final i = idOf(id);
    if (i != null) openScreen(context, WorkOrderDetail(id: i));
  }

  Widget _export(String file, List<String> header, List<List<Object?>> rows) => _canExport
      ? TextButton(
          onPressed: rows.isEmpty ? null : () => runAction(context, () => shareCsv(file, header, rows)),
          child: const Text('Export CSV'))
      : const SizedBox.shrink();

  @override
  Widget build(BuildContext context) {
    final r = _report;
    final range = r == null ? '' : '${r['date_from']}_to_${r['date_to']}';
    final costs = rowsOf(r?['costs']);
    final est = costs.fold<num>(0, (s, c) => s + n(c['estimated_total_cost']));
    final act = costs.fold<num>(0, (s, c) => s + n(c['actual_total_cost']));
    return RefreshIndicator(
      onRefresh: () async {
        await _load();
        if (_seeCosts) await _loadWip();
      },
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          const PageHeader('Production Reports'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(children: [
              Expanded(child: DateField(label: 'From', value: _from, required: true, onChanged: (d) {
                if (d != null) setState(() => _from = d);
                _load();
              })),
              const SizedBox(width: 10),
              Expanded(child: DateField(label: 'To', value: _to, required: true, onChanged: (d) {
                if (d != null) setState(() => _to = d);
                _load();
              })),
            ]),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: ErrorBanner(ApiClient.describe(_error!))),
          if (_loading) const LoadingView(),
          if (r != null && !_loading) ...[
            KpiGrid([
              KpiCard('Output', fq(r['total_output']), sub: '${fmtDate(r['date_from'])} – ${fmtDate(r['date_to'])}'),
              KpiCard('Scrap', fq(r['total_scrap']),
                  sub: r['scrap_rate_percent'] != null ? '${r['scrap_rate_percent']}% scrap rate' : 'No bookings'),
              if (_seeCosts) ...[
                KpiCard('Orders Finished', '${costs.length}', sub: 'Completed or closed in range'),
                KpiCard('Cost Variance', est != 0 ? signedInr(act - est) : '—',
                    sub: est != 0 ? '${inr(act)} actual vs ${inr(est)} estimated' : 'No finished orders'),
              ],
            ]),
            DetailSection('Finished Goods Output (${rowsOf(r['output']).length})',
                action: _export('production_output_$range.csv', ['Item Code', 'Item', 'UOM', 'Quantity', 'Work Orders'],
                    [for (final o in rowsOf(r['output'])) [o['item_code'], o['item_name'], o['uom'], o['quantity'], o['work_orders']]]),
                children: [
                  if (rowsOf(r['output']).isEmpty) emptyLine('No finished goods were received in this range.'),
                  for (final o in rowsOf(r['output']))
                    LineCard(
                      title: '${txt(o['item_code'])} — ${txt(o['item_name'])}',
                      trailing: Text('${fq(o['quantity'])} ${o['uom'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      lines: [KV('Work Orders', txt(o['work_orders']))],
                    ),
                ]),
            if (_seeCosts)
              DetailSection('Work Order Cost — Estimated vs Actual (${costs.length})',
                  action: _export(
                      'production_cost_$range.csv',
                      ['WO Number', 'Product', 'Planned', 'Completed', 'Scrapped', 'Estimated Cost', 'Actual Cost', 'Variance', 'Variance %', 'Cost per Unit'],
                      [
                        for (final c in costs)
                          [c['wo_number'], c['product_name'], c['quantity_planned'], c['quantity_completed'], c['quantity_scrapped'], c['estimated_total_cost'], c['actual_total_cost'], c['variance'], c['variance_percent'], c['cost_per_unit']]
                      ]),
                  children: [
                    if (costs.isEmpty) emptyLine('No work orders were completed in this range.'),
                    for (final c in costs)
                      LineCard(
                        title: txt(c['wo_number']),
                        subtitle: txt(c['product_name']),
                        onTap: () => _openWo(c['work_order_id']),
                        trailing: Text(
                            '${signedInr(c['variance'])}${c['variance_percent'] != null ? ' (${c['variance_percent']}%)' : ''}',
                            style: TextStyle(fontWeight: FontWeight.w700, color: n(c['variance']) > 0 ? cRed : cGreen)),
                        lines: [
                          KV('Built / Planned', '${fq(c['quantity_completed'])} / ${fq(c['quantity_planned'])}'),
                          KV('Scrap', fq(c['quantity_scrapped'])),
                          KV('Estimated', inr(c['estimated_total_cost'])),
                          KV('Actual', inr(c['actual_total_cost'])),
                          KV('Cost / Unit', c['cost_per_unit'] != null ? inr(c['cost_per_unit']) : '—'),
                        ],
                      ),
                  ]),
            DetailSection('Workstation Utilization (${rowsOf(r['utilization']).length})',
                action: _export('production_utilization_$range.csv', ['Workstation', 'Hours Logged', 'Capacity Hours', 'Utilization %', 'Good Qty', 'Scrap Qty'], [
                  for (final u in rowsOf(r['utilization']))
                    [u['workstation_name'], u['hours_logged'], u['capacity_hours'], u['utilization_percent'], u['qty_good'], u['qty_scrap']]
                ]),
                children: [
                  const Hint('Hours booked ÷ (daily capacity × working days, Monday–Saturday).'),
                  if (rowsOf(r['utilization']).isEmpty) emptyLine('No workstations or time bookings in this range.'),
                  for (final u in rowsOf(r['utilization']))
                    LineCard(
                      title: txt(u['workstation_name']),
                      trailing: Text(u['utilization_percent'] != null ? '${u['utilization_percent']}%' : '—',
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      lines: [
                        if (u['utilization_percent'] != null)
                          Bar(n(u['utilization_percent']), color: n(u['utilization_percent']) > 100 ? cRed : cBlue),
                        KV('Hours Logged', fq(u['hours_logged'])),
                        KV('Capacity', fq(u['capacity_hours'])),
                        KV('Good', fq(u['qty_good'])),
                        KV('Scrap', fq(u['qty_scrap']), color: n(u['qty_scrap']) > 0 ? cRed : null),
                      ],
                    ),
                ]),
          ],
          if (_seeCosts) _wipSection(),
        ],
      ),
    );
  }

  Widget _wipSection() {
    final w = _wip;
    final rows = rowsOf(w?['rows']);
    return DetailSection('Work in Progress${w != null ? ' · ${inr(w['total_wip'])}' : ''}', children: [
      const Hint(
          'Material issued (net of returns) + labour booked − cost already received into stock, for every work order not yet delivered on the date. Finance adds this to Store stock as closing stock at period end; it clears when the order delivers its last unit.'),
      const SizedBox(height: 8),
      DateField(label: 'As of', value: _asOf, required: true, onChanged: (d) {
        if (d != null) setState(() => _asOf = d);
        _loadWip();
      }),
      if (_wipError != null) errorLine(_wipError!),
      if (w != null && rowsOf(w['by_rrv_build']).isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final b in rowsOf(w['by_rrv_build']))
              Pill('RRV ${b['rrv_build_number']}: ${inr(b['wip_value'])} (${b['orders']} order${n(b['orders']) == 1 ? '' : 's'})', cBlue),
          ]),
        ),
      if (w != null && rows.isEmpty) emptyLine('No work in progress on this date.'),
      for (final x in rows)
        LineCard(
          title: txt(x['wo_number']),
          subtitle: '${txt(x['product_code'])} — ${txt(x['product_name'])}${x['rrv_build_number'] != null ? ' · ${x['rrv_build_number']}' : ''}',
          onTap: () => _openWo(x['work_order_id']),
          trailing: woStatusPill(x['status']),
          lines: [
            KV('Built / Planned', '${fq(x['quantity_completed'])} / ${fq(x['quantity_planned'])}'),
            KV('Material', inr(x['material_cost'])),
            KV('Labour', inr(x['labour_cost'])),
            KV('Received to Stock', inr(x['cost_relieved'])),
            KV('WIP', inr(x['wip_value']), bold: true, color: Brand.heading),
          ],
        ),
    ]);
  }
}
