import 'dart:convert';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';

/// Organization › Audit Logs - native copy of
/// frontend/src/app/dashboard/organization/audit-logs/page.tsx (read-only).
const _moduleLabels = <String, String>{
  'organization': 'Organization',
  'erp': 'Service Module',
  'crm': 'CRM',
  'p2p': 'Procurement',
  'quality': 'Quality',
  'store': 'Store',
  'production': 'Production',
  'hydraulic': 'Hydraulic & Pneumatic',
  'design': 'Design',
  'rnd': 'R&D',
  'other': 'Other',
};

const _apiSourceLabels = <String, String>{
  'web_app': 'Web App',
  'bearer_token': 'API Client (Bearer Token)',
};

const _actionOptions = [
  'create', 'created', 'update', 'updated', 'delete', 'deleted', 'restored', 'approve', 'approved', 'reject', 'rejected',
  'status_change', 'line_added', 'item_added', 'item_removed', 'member_added', 'member_removed',
];

class OrgAuditLogsTab extends StatefulWidget {
  const OrgAuditLogsTab({super.key});

  @override
  State<OrgAuditLogsTab> createState() => _OrgAuditLogsTabState();
}

class _OrgAuditLogsTabState extends State<OrgAuditLogsTab> {
  String? _module;
  String? _action;
  Json? _dash;
  Object? _dashError;
  int _gen = 0;

  @override
  void initState() {
    super.initState();
    _loadDash();
  }

  Future<void> _loadDash() async {
    try {
      final d = await Api.get('/organization/audit-logs/dashboard');
      if (mounted) setState(() => _dash = jsonMap(d));
    } catch (e) {
      if (mounted) setState(() => _dashError = e);
    }
  }

  Widget _stat(String label, String value, {String? sub, double size = 22}) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: Brand.border)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Caps(label),
            const SizedBox(height: 4),
            Text(value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: size, fontWeight: FontWeight.w700, color: Brand.heading)),
            if (sub != null && sub.isNotEmpty) Text(sub, style: const TextStyle(fontSize: 11, color: Brand.muted)),
          ],
        ),
      );

  Widget _header() {
    final d = _dash;
    final top = d == null ? <Json>[] : jsonList(d['top_users']);
    final byModule = d == null ? <String, dynamic>{} : jsonMap(d['by_module']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const PageHeader('Audit Logs',
            subtitle: 'A read-only record of who did what, when — system-generated on every tracked action. '
                'Nothing here can be added or edited manually.'),
        if (_dashError != null)
          Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: ErrorBanner(ApiClient.describe(_dashError!))),
        if (d != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 1.9,
              children: [
                _stat('Total Logs', fmtNumber(d['total_logs'])),
                _stat('Today', fmtNumber(d['logs_today'])),
                _stat('Last 7 Days', fmtNumber(d['logs_last_7_days'])),
                _stat('Most Active User (7d)', top.isEmpty ? '—' : txt(top.first['user_name']),
                    sub: top.isEmpty ? '' : '${top.first['count']} action(s)', size: 14),
              ],
            ),
          ),
        if (byModule.isNotEmpty)
          DetailSection('Activity by Module', children: [
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final e in byModule.entries)
                StatusBadge('${_moduleLabels[e.key] ?? e.key}: ${e.value}', color: Brand.primary),
            ]),
          ]),
        const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 8), child: Caps('All Audit Logs')),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
          child: Row(children: [
            Expanded(
              child: AppSelect<String>(
                label: 'All Modules',
                value: _module,
                options: [for (final e in _moduleLabels.entries) Option(e.key, e.value)],
                onChanged: (o) => setState(() {
                  _module = o?.value;
                  _gen++;
                }),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: AppSelect<String>(
                label: 'All Actions',
                value: _action,
                options: [for (final a in _actionOptions) Option(a, a)],
                onChanged: (o) => setState(() {
                  _action = o?.value;
                  _gen++;
                }),
              ),
            ),
          ]),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return ApiListView(
      key: ValueKey('audit-$_gen'),
      searchHint: 'Search summary…',
      header: _header(),
      emptyText: 'No audit logs match your filters.',
      load: (page, search) => Api.list('/organization/audit-logs',
          query: {'module_key': _module, 'action': _action, 'q': search}),
      itemBuilder: (ctx, log, reload) => _AuditCard(log),
    );
  }
}

class _AuditCard extends StatelessWidget {
  const _AuditCard(this.log);
  final Json log;

  @override
  Widget build(BuildContext context) {
    final mk = str(log['module_key']).isEmpty ? 'other' : str(log['module_key']);
    final entity = '${str(log['entity_type']).replaceAll('_', ' ')}'
        '${log['entity_id'] != null ? ' #${log['entity_id']}' : ''}';
    final by = str(log['performed_by_name']);
    final source = _apiSourceLabels[str(log['api_source'])] ?? str(log['api_source']);
    final metas = <(String, String)>[
      if (str(log['ip_address']).isNotEmpty) ('IP Address', str(log['ip_address'])),
      if (str(log['user_agent']).isNotEmpty) ('Device / Browser', str(log['user_agent'])),
      if (log['session_id'] != null) ('Session ID', str(log['session_id'])),
      if (source.isNotEmpty) ('API / Application Source', source),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Text('#${log['id']}', style: const TextStyle(fontSize: 11, color: Brand.muted)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(str(log['action']),
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.heading)),
                ),
                Text(fmtDateTime(log['performed_at']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
              ]),
              const SizedBox(height: 6),
              Wrap(spacing: 6, runSpacing: 6, children: [
                StatusBadge(_moduleLabels[mk] ?? mk, color: Brand.primary),
                StatusBadge(entity, color: const Color(0xFF64748B)),
              ]),
              const SizedBox(height: 6),
              Text('${txt(log['summary'])}${by.isNotEmpty ? ' · by $by' : ''}',
                  style: const TextStyle(fontSize: 13, color: Brand.body)),
              _ChangeDetails(log),
              if (metas.isNotEmpty) ...[
                const SizedBox(height: 6),
                for (final (l, v) in metas)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text.rich(TextSpan(children: [
                      TextSpan(text: '$l: ', style: const TextStyle(fontWeight: FontWeight.w600)),
                      TextSpan(text: v),
                    ]), style: const TextStyle(fontSize: 11, color: Brand.muted)),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

Map<String, dynamic>? _parseValues(Object? raw) {
  if (raw is! String || raw.isEmpty) return null;
  try {
    final p = jsonDecode(raw);
    return p is Map ? Map<String, dynamic>.from(p) : null;
  } catch (_) {
    return null;
  }
}

String _fmtValue(Object? v) {
  if (v == null || v == '') return '—';
  if (v is Map || v is List) return jsonEncode(v);
  return v.toString();
}

/// Field-level before/after values: an update shows only what changed; a
/// delete shows the full record as it was.
class _ChangeDetails extends StatelessWidget {
  const _ChangeDetails(this.log);
  final Json log;

  @override
  Widget build(BuildContext context) {
    final oldV = _parseValues(log['old_value']);
    final newV = _parseValues(log['new_value']);
    if (oldV == null && newV == null) {
      if (str(log['old_value']).isEmpty && str(log['new_value']).isEmpty) return const SizedBox.shrink();
      final f = str(log['field_name']);
      return Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Text('${f.isNotEmpty ? '$f: ' : ''}${txt(log['old_value'])} → ${txt(log['new_value'])}',
            style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
      );
    }
    final isChange = oldV != null && newV != null;
    final fields = <String>{...?oldV?.keys, ...?newV?.keys}.toList();
    if (fields.isEmpty) return const SizedBox.shrink();
    final label = isChange
        ? 'Changes (${fields.length})'
        : oldV != null
            ? 'Record as it was before deletion'
            : 'Values recorded';
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        dense: true,
        initiallyExpanded: isChange && fields.length <= 3,
        title: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.muted)),
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(color: const Color(0x08000000), borderRadius: BorderRadius.circular(8)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final f in fields)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(f, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Brand.body)),
                        if (isChange) ...[
                          Text('Before: ${_fmtValue(oldV[f])}', style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                          Text('After: ${_fmtValue(newV[f])}', style: const TextStyle(fontSize: 11.5, color: Brand.body)),
                        ] else
                          Text(_fmtValue((oldV ?? newV)![f]), style: const TextStyle(fontSize: 11.5, color: Brand.body)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
