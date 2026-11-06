import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'erp_common.dart';
import 'sr_detail.dart';

const _closed = ['closed', 'cancelled'];

/// Service › Dashboard (portal: app/dashboard/erp/page.tsx) - stat chips,
/// tickets by status, active tickets by priority and the recent tickets;
/// every count / bar filters the recent tickets (tap again to show all).
class ServiceDashboardTab extends StatefulWidget {
  const ServiceDashboardTab({super.key, required this.onViewAll});

  /// "View all →" - switches to the Service Requests tab.
  final VoidCallback onViewAll;

  @override
  State<ServiceDashboardTab> createState() => _ServiceDashboardTabState();
}

class _Filter {
  const _Filter({this.active = false, this.status = '', this.priority = ''});
  final bool active;
  final String status;
  final String priority;

  bool same(_Filter o) => active == o.active && status == o.status && priority == o.priority;
  bool get isNone => !active && status.isEmpty && priority.isEmpty;
}

class _ServiceDashboardTabState extends State<ServiceDashboardTab> {
  List<Json> _srs = [];
  bool _loading = true;
  String? _error;
  _Filter _filter = const _Filter();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final p = await Api.list('/erp/service-requests', query: {'limit': 1000});
      if (mounted) setState(() => _srs = p.rows);
    } catch (e) {
      if (mounted) setState(() => _error = 'Service requests: ${ApiClient.describe(e)}');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _apply(_Filter next) => setState(() => _filter = _filter.same(next) ? const _Filter() : next);

  @override
  Widget build(BuildContext context) {
    final srs = _srs;
    String st(Json s) => (s['status'] ?? '').toString();
    final total = srs.length;
    final active = srs.where((s) => !_closed.contains(st(s))).length;
    final inProgress = srs.where((s) => st(s) == 'in_progress').length;
    final closed = srs.where((s) => st(s) == 'closed').length;

    final byStatus = <String, int>{};
    for (final s in srs) {
      byStatus[st(s)] = (byStatus[st(s)] ?? 0) + 1;
    }
    final statusRows = byStatus.entries.map((e) => (e.key, e.value as num)).toList()..sort((a, b) => b.$2.compareTo(a.$2));
    final byPriority = <String, int>{};
    for (final s in srs.where((s) => !_closed.contains(st(s)))) {
      final p = (s['priority'] ?? '').toString();
      byPriority[p] = (byPriority[p] ?? 0) + 1;
    }
    final priorityRows = byPriority.entries.map((e) => (e.key, e.value as num)).toList();

    final f = _filter;
    final recent = srs
        .where((s) =>
            (!f.active || !_closed.contains(st(s))) &&
            (f.status.isEmpty || st(s) == f.status) &&
            (f.priority.isEmpty || s['priority'] == f.priority))
        .toList()
      ..sort((a, b) => (b['created_at'] ?? '').toString().compareTo((a['created_at'] ?? '').toString()));
    final shown = recent.take(50).toList();
    final name = (Perm.user['name'] as String?) ?? 'there';

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          PageHeader('Dashboard Panel',
              subtitle: 'Welcome back, $name. Here is the current state of your service requests.'),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: ErrorBanner('Some figures below are incomplete. $_error'),
            ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
            child: Row(children: [
              CountChip('Service requests', total,
                  color: const Color(0xFFEA580C), selected: f.isNone, onTap: () => setState(() => _filter = const _Filter())),
              CountChip('Active tickets', active,
                  color: const Color(0xFFCA8A04),
                  selected: f.same(const _Filter(active: true)),
                  onTap: () => _apply(const _Filter(active: true))),
              CountChip('In progress', inProgress,
                  color: const Color(0xFF2563EB),
                  selected: f.same(const _Filter(status: 'in_progress')),
                  onTap: () => _apply(const _Filter(status: 'in_progress'))),
              CountChip('Closed', closed,
                  color: const Color(0xFF78716C),
                  selected: f.same(const _Filter(status: 'closed')),
                  onTap: () => _apply(const _Filter(status: 'closed'))),
            ]),
          ),
          DetailSection('Tickets by Status', children: [
            if (statusRows.isEmpty)
              const Text('No service requests yet.', style: TextStyle(fontSize: 13, color: Brand.muted))
            else
              BarList(
                rows: statusRows,
                labelFor: (k) => srStatusLabels[k] ?? humanize(k),
                colorFor: (k) => dashStatusHex[k] ?? Brand.muted,
                isActive: (k) => f.same(_Filter(status: k)),
                onTap: (k) => _apply(_Filter(status: k)),
              ),
          ]),
          DetailSection('Active Tickets Breakdown', children: [
            if (priorityRows.isEmpty)
              const Text('No open tickets.', style: TextStyle(fontSize: 13, color: Brand.muted))
            else
              BarList(
                rows: priorityRows,
                labelFor: priorityLabel,
                colorFor: (k) => priorityHex[k] ?? Brand.muted,
                isActive: (k) => f.same(_Filter(active: true, priority: k)),
                onTap: (k) => _apply(_Filter(active: true, priority: k)),
              ),
          ]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    f.isNone
                        ? 'Recent Service Tickets'
                        : 'Recent Service Tickets (filtered: ${[
                            if (f.active) 'active',
                            if (f.status.isNotEmpty) f.status.replaceAll('_', ' '),
                            if (f.priority.isNotEmpty) f.priority
                          ].join(' · ')})',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Brand.heading),
                  ),
                ),
                TextButton(onPressed: widget.onViewAll, child: const Text('View all →')),
              ],
            ),
          ),
          if (_loading && srs.isEmpty) const LoadingView(),
          if (!_loading && shown.isEmpty)
            EmptyView(f.isNone
                ? 'No service requests yet.'
                : 'No service tickets match this count. Tap the highlighted count again to show all.'),
          for (final sr in shown) _RecentCard(sr: sr, onChanged: _load),
        ],
      ),
    );
  }
}

class _RecentCard extends StatelessWidget {
  const _RecentCard({required this.sr, required this.onChanged});
  final Json sr;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final age = daysBetween(sr['opened_at'] ?? sr['created_at']);
    return RecordCard(
      code: txt(sr['request_number']),
      title: txt(sr['issue_title']),
      trailing: Padding(padding: const EdgeInsets.only(left: 8), child: SrStatusPill(sr['status'])),
      meta: [
        ('Type', sr['service_type'] == null ? '—' : humanize(sr['service_type'])),
        ('Priority', priorityLabel(sr['priority']).toUpperCase()),
        ('Assigned To', txt(sr['assigned_to_name'])),
        ('Target Date', fmtDate(sr['expected_completion_date'])),
        ('Age', age == null ? '—' : '${age}d'),
      ],
      onTap: () async {
        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SrDetailScreen(srId: sr['id'] as int)));
        onChanged();
      },
    );
  }
}
