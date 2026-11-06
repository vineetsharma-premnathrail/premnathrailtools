import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'prod_common.dart';
import 'work_orders.dart';

/// Production › Dashboard - portal app/dashboard/production/page.tsx.
class ProductionDashboardTab extends StatelessWidget {
  const ProductionDashboardTab({super.key, required this.onGoTab});

  /// Switches the module tab (KPI cards open their page like the portal).
  final ValueChanged<String> onGoTab;

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      load: () async => mapOf(await Api.get('/production/dashboard')),
      builder: (ctx, data, reload) {
        final k = mapOf(data['kpis']);
        final out = n(k['output_30d']);
        final scrap = n(k['scrap_30d']);
        void open(Json r) async {
          await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => WorkOrderDetail(id: idOf(r['work_order_id'])!)));
          reload();
        }

        return ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            PageHeader('Production Dashboard', actions: [
              if (ProdPerm.can('work_orders', 'create'))
                miniBtn('+ New Work Order', () async {
                  await openNewWorkOrder(ctx);
                  reload();
                }, primary: true),
            ]),
            KpiGrid([
              KpiCard('In Progress', fq(k['in_progress']),
                  sub: '${fq(k['released'])} released · ${fq(k['draft'])} draft', color: cAmber, onTap: () => onGoTab('work_orders')),
              KpiCard('Overdue', fq(k['overdue']), sub: 'Past planned end date', color: n(k['overdue']) > 0 ? cRed : null),
              KpiCard('Material Shortages', fq(k['shortage_items']),
                  sub: 'Items short for released orders', color: n(k['shortage_items']) > 0 ? cRed : null, onTap: () => onGoTab('planning')),
              KpiCard('Awaiting Inspection', fq(k['pending_inspections']),
                  sub: 'Quality gates pending', color: n(k['pending_inspections']) > 0 ? cBlue : null, onTap: () => onGoTab('shop_floor')),
              KpiCard('Output (30 days)', fq(out), sub: 'Units received into Store', color: cGreen),
              KpiCard('Scrap (30 days)', fq(scrap),
                  sub: out + scrap > 0 ? '${(scrap / (out + scrap) * 100).toStringAsFixed(1)}% of output' : null),
              KpiCard('Hours Booked (30 days)', fq(k['hours_30d'])),
              KpiCard('Masters', '${fq(k['active_boms'])} / ${fq(k['active_workstations'])}',
                  sub: 'Active BOMs / workstations', onTap: () => onGoTab('bom')),
            ]),
            _orders('Due in the next 7 days', rowsOf(data['due_soon']), 'Nothing due this week.', open),
            _orders('Recent work orders', rowsOf(data['recent']),
                'No work orders yet — create a BOM, activate it, then raise a work order.', open),
          ],
        );
      },
    );
  }

  Widget _orders(String title, List<Json> rows, String empty, void Function(Json) open) {
    return DetailSection(title, children: [
      if (rows.isEmpty) emptyLine(empty),
      for (final r in rows)
        LineCard(
          title: txt(r['wo_number']),
          subtitle: '${txt(r['product_name'])} · ${fq(r['quantity_completed'])}/${fq(r['quantity_planned'])}',
          trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            woStatusPill(r['status']),
            const SizedBox(height: 4),
            Text(fmtDate(r['planned_end_date']),
                style: TextStyle(fontSize: 12, color: r['is_overdue'] == true ? cRed : Brand.muted)),
          ]),
          onTap: () => open(r),
        ),
    ]);
  }
}
