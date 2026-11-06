import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';

// Organization › Cockpit - native copy of
// frontend/src/app/dashboard/organization/cockpit/page.tsx. One tile per step
// of the core flow: enquiry → order intake → backlog → production WIP → QC
// holds → dispatch → billing → collections → service SLA.

final _int = NumberFormat.decimalPattern('en_IN');

String _money(num v) {
  if (v.abs() >= 1e7) return '₹${(v / 1e7).toStringAsFixed(2)} Cr';
  if (v.abs() >= 1e5) return '₹${(v / 1e5).toStringAsFixed(2)} L';
  return '₹${_int.format(v.round())}';
}

String _show(Json k, Object? v) {
  if (v is! num) return '—';
  return k['unit'] == 'inr' ? _money(v) : _int.format(v);
}

String _monthLabel(String m) {
  final d = DateTime.tryParse('$m-01');
  return d == null ? m : DateFormat("MMM ''yy", 'en_IN').format(d);
}

class OrgCockpitTab extends StatefulWidget {
  const OrgCockpitTab({super.key});

  @override
  State<OrgCockpitTab> createState() => _OrgCockpitTabState();
}

class _OrgCockpitTabState extends State<OrgCockpitTab> {
  Json? _data;
  String _error = '';
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool refresh = false}) async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final d = jsonMap(await Api.get('/analytics/cockpit', query: refresh ? {'refresh': true} : null));
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final kpis = jsonList(d?['kpis']);
    final asOf = d == null ? '' : DateTime.tryParse(str(d['as_of']))?.toLocal();
    final mins = d == null ? 0 : ((asInt(d['cache_seconds']) ?? 0) / 60).round();
    final asOfText = asOf is DateTime ? DateFormat('d MMM yyyy, h:mm a', 'en_IN').format(asOf) : '';
    return RefreshIndicator(
      onRefresh: () => _load(refresh: true),
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          PageHeader(
            'Management Cockpit',
            subtitle:
                'The order-to-cash flow at a glance${d != null ? ' · as of $asOfText (refreshes every $mins min)' : ''}.',
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Align(
              alignment: Alignment.centerRight,
              child: PillButton(_loading ? 'Refreshing…' : 'Refresh now',
                  icon: Icons.refresh_rounded, onPressed: _loading ? null : () => _load(refresh: true)),
            ),
          ),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(_error)),
          if (d == null && _error.isEmpty) const LoadingView(),
          for (var i = 0; i < kpis.length; i++) _Tile(k: kpis[i], step: i + 1),
        ],
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.k, required this.step});
  final Json k;
  final int step;

  @override
  Widget build(BuildContext context) {
    final ok = k['status'] == 'ok';
    final cur = k['current'];
    final prev = k['previous'];
    final int? delta = cur is num && prev is num && prev != 0 ? (((cur - prev) / prev.abs()) * 100).round() : null;
    final alert = k['alert'] != null && k['alert'] != 0;
    final trend = jsonList(k['trend']);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Caps('$step. ${str(k['stage'])}')),
                  if (ok && str(k['href']).isNotEmpty)
                    InkWell(
                      onTap: () => runAction(context, () => Files.openInPortal(str(k['href']))),
                      child: const Padding(
                        padding: EdgeInsets.all(4),
                        child: Text('Open →',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.primaryActive)),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              Text(str(k['label']),
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF475569))),
              if (ok) ...[
                Padding(
                  padding: const EdgeInsets.only(top: 4, bottom: 2),
                  child: Text(_show(k, k['value']),
                      style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Brand.heading)),
                ),
                if (delta != null)
                  Text('${delta >= 0 ? '▲' : '▼'} ${delta.abs()}% vs last month (${_show(k, prev)})',
                      style: const TextStyle(fontSize: 12, color: Color(0xFF475569))),
                if (str(k['secondary']).isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text('${alert ? '⚠ ' : ''}${str(k['secondary'])}',
                        style: TextStyle(fontSize: 12, color: alert ? const Color(0xFFB45309) : Brand.muted)),
                  ),
                if (trend.isNotEmpty) _Trend(k: k, data: trend),
              ] else
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(k['status'] == 'restricted' ? 'Hidden — ${str(k['message'])}' : str(k['message']),
                      style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 12-month single-series bar trend; tap a bar for its value.
class _Trend extends StatefulWidget {
  const _Trend({required this.k, required this.data});
  final Json k;
  final List<Json> data;

  @override
  State<_Trend> createState() => _TrendState();
}

class _TrendState extends State<_Trend> {
  int? _sel;

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    final values = data.map((d) => (d['value'] is num) ? (d['value'] as num).toDouble() : 0.0).toList();
    final max = math.max(1.0, values.fold<double>(0, math.max));
    const h = 64.0;
    final label = _sel != null && _sel! < data.length
        ? '${_monthLabel(str(data[_sel!]['month']))}  ${_show(widget.k, data[_sel!]['value'])}'
        : '${_monthLabel(str(data.first['month']))} – ${_monthLabel(str(data.last['month']))}';
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: h,
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Brand.border))),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (var i = 0; i < data.length; i++)
                  Expanded(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => setState(() => _sel = _sel == i ? null : i),
                      child: Container(
                        alignment: Alignment.bottomCenter,
                        padding: const EdgeInsets.symmetric(horizontal: 1),
                        child: Container(
                          height: math.max(values[i] > 0 ? 2.0 : 0.0, values[i] / max * h),
                          decoration: BoxDecoration(
                            color: Brand.primary.withValues(alpha: _sel == null || _sel == i ? 1 : 0.45),
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(fontSize: 11, color: Brand.muted)),
        ],
      ),
    );
  }
}
