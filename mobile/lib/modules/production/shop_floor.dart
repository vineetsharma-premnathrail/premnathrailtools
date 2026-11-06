import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'prod_common.dart';
import 'work_orders.dart';

/// Production › Shop Floor - portal app/dashboard/production/shop-floor.
/// Open operations on released work orders, grouped by workstation, with
/// one-tap Start / Log Time / Request Inspection / Complete.
class ShopFloorTab extends StatefulWidget {
  const ShopFloorTab({super.key});

  @override
  State<ShopFloorTab> createState() => _ShopFloorTabState();
}

class _ShopFloorTabState extends State<ShopFloorTab> {
  final _workstations = LookupCache('/production/lookups/workstations');
  final _ws = Pick();
  List<Json> _queue = [];
  bool _loading = true;
  bool _busy = false;
  Object? _error;

  bool get _canRun => ProdPerm.feat('shop_floor', 'run_operations', 'edit');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/production/shop-floor/queue', query: {'workstation_id': _ws.id});
      if (mounted) {
        setState(() {
          _queue = rowsOf(d);
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

  Future<void> _act(Future<void> Function() fn, String success) async {
    setState(() => _busy = true);
    final ok = await runAction(context, fn, success: success);
    if (ok) await _load();
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final groups = <String, List<Json>>{};
    for (final q in _queue) {
      groups.putIfAbsent(q['workstation_name']?.toString() ?? 'Unassigned', () => []).add(q);
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          const PageHeader('Shop Floor',
              subtitle: 'Open operations on released work orders — running first, then by priority and due date.'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(children: [
              Expanded(
                child: AppSelect<int>(
                  label: 'All workstations',
                  value: _ws.id,
                  valueLabel: _ws.label,
                  loadOptions: _workstations.search,
                  onChanged: (o) {
                    setState(() => _ws.set(o));
                    _load();
                  },
                ),
              ),
              const SizedBox(width: 8),
              IconButton.outlined(tooltip: 'Refresh', onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh_rounded)),
            ]),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: ErrorBanner(ApiClient.describe(_error!))),
          if (_loading)
            const LoadingView()
          else if (_queue.isEmpty)
            const EmptyView('No open operations. Release a work order to put its routing on the shop floor.')
          else
            for (final e in groups.entries) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
                child: Text.rich(TextSpan(children: [
                  TextSpan(text: e.key, style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                  TextSpan(
                      text:
                          ' · ${e.value.length} operation(s) · ${e.value.fold<num>(0, (s, q) => s + (n(q['planned_hours']) - n(q['actual_hours']) > 0 ? n(q['planned_hours']) - n(q['actual_hours']) : 0)).toStringAsFixed(1)} h remaining',
                      style: const TextStyle(color: Brand.muted)),
                ])),
              ),
              for (final q in e.value) _card(q),
            ],
        ],
      ),
    );
  }

  Widget _card(Json q) {
    final pc = priorityHex[normPriority(q['priority'])]!;
    final insp = q['inspection_status']?.toString();
    final passed = insp == 'passed' || insp == 'conditionally_passed';
    final gate = q['requires_inspection'] == true;
    final canRequest = gate && (insp == null || insp == 'failed');
    final planned = n(q['planned_hours']);
    final actual = n(q['actual_hours']);
    final woId = idOf(q['work_order_id'])!;
    final opId = idOf(q['operation_id'])!;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Container(
          decoration: BoxDecoration(border: Border(left: BorderSide(color: pc, width: 4))),
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  InkWell(
                    onTap: () async {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => WorkOrderDetail(id: woId)));
                      _load();
                    },
                    child: Text(txt(q['wo_number']),
                        style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.primary, fontSize: 13)),
                  ),
                  Text('${q['sequence']} · ${txt(q['operation_name'])}',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Brand.heading)),
                  Text('${txt(q['product_name'])} × ${fq(q['quantity_planned'])}${q['project_label'] != null ? ' · ${q['project_label']}' : ''}',
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ]),
              ),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Pill(opStatusLabels['${q['status']}'] ?? humanize(q['status']), opStatusHex['${q['status']}'] ?? cGrey),
                const SizedBox(height: 4),
                Pill(priorityLabel(q['priority']), pc),
              ]),
            ]),
            if (q['instructions'] != null && '${q['instructions']}'.isNotEmpty)
              Padding(padding: const EdgeInsets.only(top: 8), child: Hint('${q['instructions']}')),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: Text('${fq(actual)} / ${fq(planned)} h', style: const TextStyle(fontSize: 12, color: Brand.muted))),
              Text('Good ${fq(q['qty_good'])}${n(q['qty_scrap']) > 0 ? ' · Scrap ${fq(q['qty_scrap'])}' : ''}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
            const SizedBox(height: 4),
            Bar(planned > 0 ? actual / planned * 100 : 0, color: actual > planned ? cRed : cAmber, height: 5),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              if (q['planned_end_date'] != null)
                Text('Due ${fmtDate(q['planned_end_date'])}${q['is_overdue'] == true ? ' · overdue' : ''}',
                    style: TextStyle(fontSize: 12, color: q['is_overdue'] == true ? cRed : Brand.muted)),
              if (gate) Pill(insp != null ? (inspLabels[insp] ?? humanize(insp)) : 'Quality gate', insp != null ? (inspHex[insp] ?? cGrey) : cGrey),
            ]),
            if (_canRun) ...[
              const SizedBox(height: 12),
              btnWrap([
                if (q['status'] == 'pending')
                  miniBtn('Start', _busy
                      ? null
                      : () => _act(() => Api.post('/production/work-orders/$woId/operations/$opId/start'), '${q['operation_name']} started.')),
                miniBtn('Log Time', _busy
                    ? null
                    : () async {
                        final ok = await showLogTime(context,
                            woId: woId,
                            opId: opId,
                            subtitle: '${q['wo_number']} · ${q['sequence']} ${q['operation_name']}',
                            bookedHint: '${fq(actual)} of ${fq(planned)} planned hours booked so far.');
                        if (ok && mounted) {
                          showSnack(context, 'Booked time on ${q['wo_number']} · ${q['operation_name']}.');
                          _load();
                        }
                      }, primary: true),
                if (canRequest)
                  miniBtn(insp == 'failed' ? 'Re-inspect' : 'Request Inspection', _busy
                      ? null
                      : () => _act(() => Api.post('/production/work-orders/$woId/operations/$opId/request-inspection'),
                          'Inspection requested — Quality has been notified.')),
                miniBtn('Complete', _busy || (gate && !passed)
                    ? null
                    : () => _act(() => Api.post('/production/work-orders/$woId/operations/$opId/complete', data: {}),
                        '${q['operation_name']} completed.')),
              ]),
              if (gate && !passed) const Padding(padding: EdgeInsets.only(top: 6), child: Hint('Complete needs a passed Quality inspection first.')),
            ],
          ]),
        ),
      ),
    );
  }
}
