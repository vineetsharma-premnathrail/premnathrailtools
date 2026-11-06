import 'dart:async';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/app_frame.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'mt_assets.dart';
import 'mt_common.dart';
import 'mt_reports.dart';
import 'mt_requests.dart';
import 'mt_schedule.dart';
import 'mt_spares.dart';
import 'mt_work_orders.dart';

// Maintenance Dashboard - frontend/src/app/dashboard/maintenance/page.tsx.

class MaintenanceDashboard extends StatefulWidget {
  const MaintenanceDashboard({super.key});

  @override
  State<MaintenanceDashboard> createState() => _MaintenanceDashboardState();
}

class _MaintenanceDashboardState extends State<MaintenanceDashboard> {
  Json? _data;
  Json? _lookups;
  String? _error;
  int? _branch;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    MtLookups.tryGet().then((lk) {
      if (mounted) setState(() => _lookups = lk);
    });
    _load();
    // Downtime clocks on "machines down" should keep moving.
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = asMap(await Api.get('/maintenance/dashboard', query: {'branch_id': _branch}));
      if (mounted) {
        setState(() {
          _data = d;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  void _sub(String title, Widget body) => openScreen(context, SubPage(title: title, body: body));

  @override
  Widget build(BuildContext context) {
    final branches = MtLookups.branches(_lookups);
    final d = _data;
    return withFab(
      RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 88),
          children: [
            const MtHeader('Maintenance Dashboard'),
            if (branches.length > 1)
              filterRow([
                FilterSelect<int>(
                  allLabel: 'All plants',
                  value: _branch,
                  options: branches,
                  onChanged: (v) {
                    setState(() => _branch = v);
                    _load();
                  },
                ),
              ]),
            if (_error != null) Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(_error!)),
            if (d == null && _error == null) const LoadingView(),
            if (d != null) ..._body(d),
          ],
        ),
      ),
      CreateFab(label: 'Report Breakdown', onPressed: () => reportBreakdown(context, onCreated: _load)),
    );
  }

  List<Widget> _body(Json d) {
    final c = asMap(d['counts']) ?? {};
    final m = asMap(d['last_30_days']) ?? {};
    final month = asMap(d['this_month']);
    final pmDue = asMap(d['pm_due_this_week']);
    final pmOver = asMap(d['pm_overdue']);
    final spLow = asMap(d['critical_spares_below_min']);
    final down = asInt(c['down']) ?? 0;
    final openReq = asInt(c['open_requests']) ?? 0;
    final awaiting = asInt(c['awaiting_close']) ?? 0;
    final avail = asNum(month?['availability_pct']);
    void openWo(Object? id) => openScreen(context, WorkOrderDetailScreen(id: asInt(id)!));
    return [
      kpiGrid([
        KpiTile(
          label: 'Machines Down',
          value: '$down',
          sub: 'of ${c['assets'] ?? 0} assets',
          color: down > 0 ? kRed : kGreen,
          onTap: () => _sub('Assets', AssetsList(initialStatus: 'down', initialBranch: _branch)),
        ),
        KpiTile(
          label: 'Open Requests',
          value: '$openReq',
          sub: 'Awaiting acknowledgement',
          color: openReq > 0 ? kAmber : null,
          onTap: () => _sub('Requests', RequestsList(initialStatus: 'open', initialBranch: _branch)),
        ),
        KpiTile(
          label: 'Open Work Orders',
          value: '${c['open_work_orders'] ?? 0}',
          sub: '${c['my_work_orders'] ?? 0} assigned to me',
          onTap: () => _sub('Work Orders', WorkOrdersList(initialBranch: _branch)),
        ),
        KpiTile(
          label: 'Awaiting Close',
          value: '$awaiting',
          sub: 'Completed, not yet closed',
          color: awaiting > 0 ? kBlue : null,
          onTap: () => _sub('Work Orders', WorkOrdersList(initialStatus: 'completed', initialBranch: _branch)),
        ),
        KpiTile(label: 'Breakdowns (30 days)', value: '${m['breakdowns'] ?? 0}'),
        KpiTile(
            label: 'Downtime (30 days)',
            value: formatMinutes(m['downtime_minutes']),
            color: (asNum(m['downtime_minutes']) ?? 0) > 0 ? kRed : null),
        KpiTile(label: 'MTTR (30 days)', value: formatMinutes(m['mttr_minutes']), sub: 'Mean time to repair'),
        if (Mt.showCosts)
          KpiTile(label: 'Maintenance Cost (30 days)', value: formatInr(m['maintenance_cost']), sub: 'Spares + labour + external'),
        if (month != null) ...[
          KpiTile(
            label: 'MTTR (this month)',
            value: formatMinutes(month['mttr_minutes']),
            sub: 'Avg. repair time per breakdown',
            onTap: () => _sub('Reports', const ReportsTab()),
          ),
          KpiTile(
            label: 'Availability (this month)',
            value: avail == null ? '—' : '$avail%',
            color: avail == null ? null : avail >= 95 ? kGreen : avail >= 85 ? kAmber : kRed,
            sub: 'Working hours not lost to breakdowns',
            onTap: () => _sub('Reports', const ReportsTab()),
          ),
          KpiTile(
            label: 'PM Due This Week',
            value: '${pmDue?['count'] ?? 0}',
            sub: 'Preventive jobs due in ${pmDue?['window_days'] ?? 7} days',
            onTap: () => _sub('PM Schedule', ScheduleTab(initialView: 'upcoming', initialBranch: _branch)),
          ),
          KpiTile(
            label: 'PM Overdue',
            value: '${pmOver?['count'] ?? 0}',
            color: (asInt(pmOver?['count']) ?? 0) > 0 ? kRed : null,
            sub: 'Open PM jobs past due date',
            onTap: () => _sub('PM Schedule', ScheduleTab(initialDue: 'overdue', initialBranch: _branch)),
          ),
          KpiTile(
            label: 'Critical Spares Low',
            value: '${spLow?['count'] ?? 0}',
            color: (asInt(spLow?['count']) ?? 0) > 0 ? kRed : null,
            sub: 'Below minimum stock',
            onTap: () => _sub('Spares', const SparesList()),
          ),
        ],
      ]),
      DetailSection('Machines down now', children: [
        if (asList(d['machines_down']).isEmpty) mutedText('Every asset is running.'),
        for (final x in asList(d['machines_down']))
          LineItem(
            lead: Pill(str(x['criticality']), critHex[x['criticality']] ?? kGrey),
            title: '${x['asset_code']} ${str(x['name'])}',
            subtitle: str(x['wo_number']).isEmpty ? 'No work order yet' : str(x['wo_number']),
            trailing: [Text(formatMinutes(x['down_minutes']), style: const TextStyle(fontWeight: FontWeight.w700, color: kRed))],
            onTap: () => x['work_order_id'] != null
                ? openWo(x['work_order_id'])
                : openScreen(context, AssetDetailScreen(id: asInt(x['asset_id'])!)),
          ),
      ]),
      DetailSection('Open requests', children: [
        if (asList(d['open_requests']).isEmpty) mutedText('No requests waiting.'),
        for (final r in asList(d['open_requests']))
          LineItem(
            title: str(r['request_number']),
            subtitle: '${r['asset_code']} — ${r['problem_description']}',
            badges: [
              if (r['machine_down'] == true) const Pill('Machine down', kRed),
              priorityPill(r['priority']),
              smallText(fmtDateTime(r['reported_at'])),
            ],
            onTap: () => openScreen(context, RequestDetailScreen(id: asInt(r['id'])!)),
          ),
      ]),
      DetailSection('My work orders', children: [
        if (asList(d['my_work_orders']).isEmpty) mutedText('Nothing assigned to you.'),
        for (final w in asList(d['my_work_orders']))
          LineItem(
            title: str(w['wo_number']),
            subtitle: '${w['asset_code']} — ${w['title']}',
            badges: [
              priorityPill(w['priority']),
              statusPill(woStatusLabels, woStatusHex, w['status']),
              if (w['planned_start'] != null) smallText(fmtDate(w['planned_start'])),
            ],
            onTap: () => openWo(w['id']),
          ),
      ]),
      DetailSection('Completed — awaiting close', children: [
        if (asList(d['awaiting_close']).isEmpty) mutedText('Nothing waiting to be closed.'),
        for (final w in asList(d['awaiting_close']))
          LineItem(
            title: str(w['wo_number']),
            subtitle: '${w['asset_code']} — ${w['title']}',
            badges: [w['awaiting_confirmation'] == true ? const Pill('Waiting for requester', kAmber) : const Pill('Ready to close', kGreen)],
            onTap: () => openWo(w['id']),
          ),
      ]),
      if (pmDue != null || pmOver != null || spLow != null) ...[
        DetailSection(
          'Preventive maintenance — overdue & due this week',
          action: TextButton(onPressed: () => _sub('PM Schedule', const ScheduleTab()), child: const Text('PM schedule →')),
          children: [
            if (asList(pmOver?['items']).isEmpty && asList(pmDue?['items']).isEmpty)
              mutedText('Nothing overdue and nothing due this week.'),
            for (final w in asList(pmOver?['items']))
              LineItem(
                title: str(w['wo_number']),
                subtitle: '${w['asset_code']} — ${w['title']}',
                badges: [Pill('${w['days_overdue']}d overdue', kRed), smallText('Due ${fmtDate(w['due_date'])}')],
                onTap: () => openWo(w['id']),
              ),
            for (final p in asList(pmDue?['items']))
              LineItem(
                title: str(p['number']),
                subtitle: '${p['asset_code']} — ${p['title']}',
                badges: [
                  p['kind'] == 'plan' ? const Pill('Job not generated yet', kGrey) : statusPill(woStatusLabels, woStatusHex, p['status']),
                  smallText('Due ${fmtDate(p['due_date'])}'),
                ],
                onTap: () => p['kind'] == 'work_order' ? openWo(p['id']) : openScreen(context, PmPlanDetailScreen(id: asInt(p['id'])!)),
              ),
          ],
        ),
        DetailSection(
          'Critical spares below minimum',
          action: TextButton(onPressed: () => _sub('Spares', const SparesList()), child: const Text('Spares →')),
          children: [
            if (asList(spLow?['items']).isEmpty) mutedText('All critical spares are at or above minimum stock.'),
            for (final s in asList(spLow?['items']))
              LineItem(
                title: '${s['item_code']} ${str(s['item_name'])}',
                subtitle: '${s['asset_count']} asset(s)',
                trailing: [
                  Text('${fmtQty(s['on_hand'])} / ${fmtQty(s['minimum_stock'])} ${str(s['uom'])}',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: kRed)),
                ],
                onTap: () => _sub('Spares', const SparesList()),
              ),
          ],
        ),
      ],
    ];
  }
}
