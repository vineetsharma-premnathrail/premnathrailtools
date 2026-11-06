import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'erp_common.dart';

/// Service › Recycle Bin (portal: app/dashboard/erp/recycle-bin/page.tsx) -
/// deleted machines and service requests, restorable for 10 days.
class ServiceRecycleBinTab extends StatefulWidget {
  const ServiceRecycleBinTab({super.key});

  @override
  State<ServiceRecycleBinTab> createState() => _ServiceRecycleBinTabState();
}

class _ServiceRecycleBinTabState extends State<ServiceRecycleBinTab> {
  List<Json>? _projects;
  List<Json>? _srs;
  Object? _error;

  bool get _canRestore => Perm.can('erp', 'recycle_bin', 'edit');

  bool _canRestoreSr(Json sr) =>
      _canRestore && (ErpPerm.isRoleAdmin || sr['created_by_id'] == null || sr['created_by_id'] == Perm.userId);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final r = await Future.wait([
        Api.list('/erp/projects/recycle-bin/list'),
        Api.list('/erp/service-requests/recycle-bin'),
      ]);
      if (mounted) {
        setState(() {
          _projects = r[0].rows;
          _srs = r[1].rows;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _restoreProject(Json p) async {
    final ok = await runAction(context, () => Api.post('/erp/projects/${p['id']}/restore'),
        success: '${p['serial_number']} restored.');
    if (ok) _load();
  }

  Future<void> _restoreSr(Json sr) async {
    final ok = await runAction(context, () => Api.post('/erp/service-requests/${sr['id']}/restore'),
        success: '${sr['request_number']} restored.');
    if (ok) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _projects == null) return ErrorView(_error!, onRetry: _load);
    if (_projects == null) return const LoadingView();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          const PageHeader('Recycle Bin', subtitle: 'Deleted items are auto-purged after 10 days'),
          DetailSection('Deleted Projects', children: [
            if (_projects!.isEmpty) const Text('Nothing here.', style: TextStyle(fontSize: 13, color: Brand.muted)),
            for (final p in _projects!)
              _Row(
                primary: txt(p['serial_number']),
                secondary: [p['model_name'], p['client_company']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
                deletedAt: p['deleted_at'],
                onRestore: _canRestore ? () => _restoreProject(p) : null,
              ),
          ]),
          DetailSection('Deleted Service Requests', children: [
            if (_srs!.isEmpty) const Text('Nothing here.', style: TextStyle(fontSize: 13, color: Brand.muted)),
            for (final sr in _srs!)
              _Row(
                primary: txt(sr['request_number']),
                secondary: '${sr['issue_description'] ?? ''} — ${sr['days_remaining']} day(s) left',
                deletedAt: sr['deleted_at'],
                onRestore: _canRestoreSr(sr) ? () => _restoreSr(sr) : null,
              ),
          ]),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.primary, required this.secondary, required this.deletedAt, this.onRestore});
  final String primary;
  final String secondary;
  final Object? deletedAt;
  final VoidCallback? onRestore;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(primary, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Brand.heading)),
            Text('$secondary${deletedAt != null ? ' · Deleted ${fmtDate(deletedAt)}' : ''}',
                maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Brand.muted)),
          ]),
        ),
        if (onRestore != null) ...[const SizedBox(width: 8), SmallButton('Restore', primary: true, icon: Icons.restore_rounded, onPressed: onRestore)],
      ]),
    );
  }
}
