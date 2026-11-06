import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'erp_common.dart';
import 'sr_detail.dart';
import 'sr_form.dart';

/// Service › Service Requests (portal: app/dashboard/erp/service-requests/page.tsx)
/// - "Service Request Registry": count chips, search, Filters sheet, Export,
/// Import and "+ New Service Request".
class ServiceRequestsTab extends StatefulWidget {
  const ServiceRequestsTab({super.key});

  @override
  State<ServiceRequestsTab> createState() => _ServiceRequestsTabState();
}

class _ServiceRequestsTabState extends State<ServiceRequestsTab> {
  final _list = GlobalKey<ApiListViewState>();

  String _status = 'all';
  String _priority = 'all';
  String _serviceType = 'all';
  bool _overdue = false;

  /// Status picked from a count chip: narrows the loaded rows on screen only.
  String _chip = '';
  String _search = '';

  // Last server rows (after the overdue filter) - chip taps reuse them.
  List<Json> _rows = [];
  bool _chipOnly = false;
  final Map<int, Json> _machines = {};
  bool _machinesLoaded = false;

  bool get _canCreate => ErpPerm.hasErp('sr_create');
  bool get _canExport => Perm.can('erp', 'service_requests', 'export');
  bool get _canImport => Perm.can('erp', 'service_requests', 'import') && _canCreate;

  int get _activeFilters =>
      [_status, _priority, _serviceType].where((v) => v != 'all').length +
      (_overdue ? 1 : 0) +
      (_chip.isNotEmpty && _status == 'all' ? 1 : 0);

  Future<ApiPage> _load(int page, String search) async {
    if (_chipOnly) {
      _chipOnly = false;
      return ApiPage(_visible(_rows));
    }
    _search = search;
    final res = await Future.wait([
      Api.list('/erp/service-requests', query: {
        'search': search,
        'status': _status == 'all' ? null : _status,
        'priority': _priority == 'all' ? null : _priority,
        'service_type': _serviceType == 'all' ? null : _serviceType,
        'limit': 1000,
      }),
      if (!_machinesLoaded) Api.list('/erp/projects', query: {'limit': 5000}),
    ]);
    if (res.length > 1) {
      _machines
        ..clear()
        ..addEntries(res[1].rows.where((p) => p['id'] is int).map((p) => MapEntry(p['id'] as int, p)));
      _machinesLoaded = true;
    }
    var rows = res[0].rows;
    if (_overdue) {
      final today = apiDate(DateTime.now());
      rows = rows.where((sr) {
        final d = (sr['expected_completion_date'] ?? '').toString();
        return d.isNotEmpty &&
            d.substring(0, d.length < 10 ? d.length : 10).compareTo(today) < 0 &&
            !['closed', 'cancelled'].contains(sr['status']);
      }).toList();
    }
    if (mounted) setState(() => _rows = rows);
    return ApiPage(_visible(rows));
  }

  List<Json> _visible(List<Json> rows) => _chip.isEmpty ? rows : rows.where((r) => r['status'] == _chip).toList();

  void _reload() => _list.currentState?.reload();

  void _refilter() {
    _chipOnly = true;
    _reload();
  }

  void _pickChip(String value) {
    if (_status == value) {
      setState(() => _status = 'all');
      _reload();
      return;
    }
    if (_chip == value) {
      setState(() => _chip = '');
      _refilter();
      return;
    }
    if (_status != 'all') {
      setState(() {
        _status = 'all';
        _chip = value;
      });
      _reload();
      return;
    }
    setState(() => _chip = value);
    _refilter();
  }

  void _clearChips() {
    final server = _status != 'all';
    setState(() {
      _status = 'all';
      _chip = '';
    });
    server ? _reload() : _refilter();
  }

  void _clearFilters() {
    setState(() {
      _status = 'all';
      _priority = 'all';
      _serviceType = 'all';
      _overdue = false;
      _chip = '';
    });
    _reload();
  }

  Future<void> _openFilters() async {
    var status = _status != 'all' ? _status : (_chip.isEmpty ? 'all' : _chip);
    var priority = _priority;
    var type = _serviceType;
    var overdue = _overdue;
    final applied = await showFormSheet(
      context,
      title: 'Filters',
      saveLabel: 'Apply Filters',
      builder: (ctx, setS) => [
        const Text('Narrow the service requests, then press Apply.', style: TextStyle(color: Brand.muted)),
        AppSelect<String>(
          label: 'Status',
          value: status,
          clearable: false,
          options: [
            const Option('all', 'All Statuses'),
            for (final e in srStatusLabels.entries) Option(e.key, e.value),
          ],
          onChanged: (o) => setS(() => status = o?.value ?? 'all'),
        ),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: const [Option('all', 'All Priorities'), Option('standard', 'Standard'), Option('urgent', 'Urgent')],
          onChanged: (o) => setS(() => priority = o?.value ?? 'all'),
        ),
        AppSelect<String>(
          label: 'Service Type',
          value: type,
          clearable: false,
          options: [const Option('all', 'All Service Types'), for (final (k, l) in serviceTypes) Option(k, l)],
          onChanged: (o) => setS(() => type = o?.value ?? 'all'),
        ),
        CheckField(label: 'Overdue Only', value: overdue, onChanged: (v) => setS(() => overdue = v)),
        OutlinedButton(
          onPressed: () {
            Navigator.pop(ctx, false);
            _clearFilters();
          },
          child: const Text('Clear Filters'),
        ),
      ],
      onSave: () async {},
    );
    if (!applied) return;
    setState(() {
      _status = status;
      _priority = priority;
      _serviceType = type;
      _overdue = overdue;
      _chip = '';
    });
    _reload();
  }

  Future<void> _export() async {
    final params = <String, dynamic>{
      'search': _search,
      'status': _status != 'all' ? _status : (_chip.isEmpty ? null : _chip),
      'priority': _priority == 'all' ? null : _priority,
      'service_type': _serviceType == 'all' ? null : _serviceType,
    }..removeWhere((k, v) => v == null || v == '');
    showSnack(context, 'Preparing the Excel file…');
    try {
      await Files.downloadAndOpen('/erp/service-requests/export', 'service_requests.xlsx', query: params);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  Future<void> _import() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _ImportSheet(onImported: _reload),
    );
  }

  Future<void> _create() async {
    final created = await showSrForm(context);
    if (created != null && mounted) {
      _reload();
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SrDetailScreen(srId: created)));
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final base = _rows;
    int count(String s) => base.where((r) => r['status'] == s).length;
    bool on(String s) => _status == s || _chip == s;
    final filters = _activeFilters;
    return Scaffold(
      backgroundColor: Brand.background,
      floatingActionButton: _canCreate ? CreateFab(label: 'New Service Request', onPressed: _create) : null,
      body: ApiListView(
        key: _list,
        load: _load,
        searchHint: 'SR#, title, serial, client...',
        emptyText: 'No service requests found.',
        header: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const PageHeader('Service Request Registry'),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(children: [
                CountChip('Requests', base.length,
                    color: const Color(0xFF3B82F6), selected: _status == 'all' && _chip.isEmpty, onTap: _clearChips),
                CountChip('Open', count('open'),
                    color: const Color(0xFFEA580C), selected: on('open'), onTap: () => _pickChip('open')),
                CountChip('In progress', count('in_progress'),
                    color: const Color(0xFFCA8A04), selected: on('in_progress'), onTap: () => _pickChip('in_progress')),
                CountChip('Closed', count('closed'),
                    color: const Color(0xFF16A34A), selected: on('closed'), onTap: () => _pickChip('closed')),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Wrap(spacing: 8, runSpacing: 8, children: [
                SmallButton(filters > 0 ? 'Filters ($filters)' : 'Filters',
                    icon: filters > 0 ? Icons.filter_alt_rounded : Icons.filter_alt_outlined, onPressed: _openFilters),
                if (filters > 0) SmallButton('Clear', onPressed: _clearFilters),
                if (_canExport) SmallButton('Export', icon: Icons.download_rounded, onPressed: _export),
                if (_canImport) SmallButton('Import', icon: Icons.upload_file_rounded, onPressed: _import),
              ]),
            ),
          ],
        ),
        itemBuilder: (ctx, sr, reload) => _SrCard(sr: sr, machine: _machines[sr['project_id']], onChanged: reload),
      ),
    );
  }
}

class _SrCard extends StatelessWidget {
  const _SrCard({required this.sr, required this.machine, required this.onChanged});
  final Json sr;
  final Json? machine;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final closedAt = sr['closed_at'];
    final tat = daysBetween(sr['opened_at'] ?? sr['created_at'], closedAt);
    final p = machine;
    final warranty = p == null || p['warranty_start_date'] == null || p['warranty_end_date'] == null
        ? 'No'
        : '${fmtDate(p['warranty_start_date'])} → ${fmtDate(p['warranty_end_date'])}';
    final client = [p?['client_company'], p?['site_name']].where((v) => v != null && v.toString().isNotEmpty).join(' · ');
    return RecordCard(
      code: txt(sr['request_number']),
      title: txt(sr['issue_title']),
      subtitle: client.isEmpty ? null : client,
      trailing: Padding(padding: const EdgeInsets.only(left: 8), child: SrStatusPill(sr['status'])),
      meta: [
        ('Machine Serial', txt(p?['serial_number'])),
        ('Priority', priorityLabel(sr['priority']).toUpperCase()),
        ('Opening Date', fmtDate(sr['opened_at'])),
        ('Closing Date', closedAt == null ? 'Open' : fmtDate(closedAt)),
        ('Age', tat == null ? '—' : dayText(tat)),
        ('Warranty', warranty),
      ],
      onTap: () async {
        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => SrDetailScreen(srId: sr['id'] as int)));
        onChanged();
      },
    );
  }
}

/// Bulk import (portal: BulkImportDialog kind="service-requests").
class _ImportSheet extends StatefulWidget {
  const _ImportSheet({required this.onImported});
  final VoidCallback onImported;

  @override
  State<_ImportSheet> createState() => _ImportSheetState();
}

class _ImportSheetState extends State<_ImportSheet> {
  MultipartFile? _file;
  bool _busy = false;
  String? _error;
  Json? _result;

  Future<void> _template() async {
    try {
      await Files.downloadAndOpen('/erp/service-requests/import/template', 'service_request_import_template.xlsx');
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _pick() async {
    try {
      final f = await Files.pickFile(extensions: ['xlsx']);
      if (f != null) setState(() => _file = f);
    } catch (e) {
      setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _upload() async {
    if (_file == null) {
      setState(() => _error = 'Pick the filled Excel file (.xlsx) first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final form = FormData()..files.add(MapEntry('file', _file!));
      final r = await Api.dio.post('/erp/service-requests/import',
          data: form,
          options: Options(
              contentType: 'multipart/form-data',
              sendTimeout: const Duration(minutes: 3),
              receiveTimeout: const Duration(minutes: 3)));
      final data = r.data is Map ? Map<String, dynamic>.from(r.data as Map) : <String, dynamic>{};
      setState(() {
        _result = data;
        _file = null;
      });
      if ((data['created'] as List? ?? const []).isNotEmpty) widget.onImported();
    } catch (e) {
      setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    List<Map> rows(String k) => (r?[k] as List? ?? const []).whereType<Map>().toList();
    return FractionallySizedBox(
      heightFactor: 0.9,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
            child: Row(children: [
              const Expanded(
                child: Text('Import Service Requests',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading)),
              ),
              IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(context)),
            ]),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                    'Download the template, fill one row per service request, then upload it. '
                    'Duplicates are skipped and never overwritten; no emails are sent for imported requests.',
                    style: TextStyle(color: Brand.muted)),
                const SizedBox(height: 12),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  SmallButton('Download template', icon: Icons.download_rounded, onPressed: _template),
                  SmallButton(_file == null ? 'Pick Excel file' : (_file!.filename ?? 'file.xlsx'),
                      icon: Icons.attach_file_rounded, onPressed: _busy ? null : _pick),
                ]),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: _busy ? null : _upload,
                  child: Text(_busy ? 'Importing…' : 'Import'),
                ),
                if (_error != null) ...[const SizedBox(height: 12), ErrorBanner(_error!)],
                if (r != null) ...[
                  const SizedBox(height: 16),
                  Text(
                      '${rows('created').length} saved · ${rows('existing').length} duplicate(s) (not saved)'
                      '${rows('errors').isNotEmpty ? ' · ${rows('errors').length} with problems (not saved)' : ''}',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                  const SizedBox(height: 8),
                  for (final x in rows('created'))
                    _ResultRow('Row ${x['row']} · Saved', '${txt(x['ref'])} — ${txt(x['name'])}', Brand.success),
                  for (final x in rows('existing'))
                    _ResultRow('Row ${x['row']} · Duplicate — not saved', '${txt(x['key'])}: ${txt(x['reason'])}',
                        const Color(0xFFB45309)),
                  for (final x in rows('errors'))
                    _ResultRow('Row ${x['row']} · Problem — not saved', '${txt(x['key'])}: ${txt(x['reason'])}', Brand.danger),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ResultRow extends StatelessWidget {
  const _ResultRow(this.title, this.text, this.color);
  final String title;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color)),
          Text(text, style: const TextStyle(fontSize: 13, color: Brand.body)),
        ]),
      );
}
