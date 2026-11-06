import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'erp_common.dart';

const _visitStatuses = ['assigned', 'scheduled', 'in_progress', 'pending_parts', 'on_hold', 'work_completed'];
const _slaLabels = {'met': 'Met', 'breached': 'Breached', 'at_risk': 'At risk', 'running': 'On track', 'stopped': 'Stopped'};
const _slaHex = {
  'met': Color(0xFF16A34A),
  'breached': Color(0xFFDC2626),
  'at_risk': Color(0xFFF59E0B),
  'running': Color(0xFF2563EB),
  'stopped': Color(0xFF78716C),
};

String _inr(Object? v) => fmtMoney(numOf(v));

/// SR › Visits (portal: components/erp/ServiceVisitsTab.tsx) - every engineer
/// visit with hours, travel, expenses, work done and the customer's sign-off;
/// each visit has a Word service report.
class SrVisitsTab extends StatefulWidget {
  const SrVisitsTab(
      {super.key, required this.srId, required this.srStatus, required this.assignedId, required this.onChanged});
  final int srId;
  final String srStatus;
  final int? assignedId;
  final VoidCallback onChanged;

  @override
  State<SrVisitsTab> createState() => _SrVisitsTabState();
}

class _SrVisitsTabState extends State<SrVisitsTab> {
  Json? _data;
  String? _error;
  List<Option<int>> _users = [];

  bool get _canEditAll => Perm.can('erp', 'service_requests', 'edit');
  bool get _open => _visitStatuses.contains(widget.srStatus.toLowerCase());
  bool get _canLog => _open && (_canEditAll || widget.assignedId == Perm.userId);

  @override
  void initState() {
    super.initState();
    _load();
    if (_canEditAll) _loadUsers();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/erp/service-requests/${widget.srId}/visits');
      if (mounted) {
        setState(() {
          _data = Map<String, dynamic>.from(d as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _loadUsers() async {
    try {
      final p = await Api.list('/users/directory');
      if (mounted) {
        setState(() => _users = [
              for (final u in p.rows)
                if (u['id'] is int) Option<int>(u['id'] as int, txt(u['name'] ?? u['email']), subtitle: u['department']?.toString()),
            ]);
      }
    } catch (_) {
      // The engineer picker is optional - without the list the visit is logged under you.
    }
  }

  Future<void> _edit(Json? v) async {
    int? engineerId = v == null ? Perm.userId : (v['engineer_id'] as num?)?.toInt();
    String? engineerName = v?['engineer_name']?.toString() ?? (Perm.user['name'] as String?);
    DateTime? visitDate = v == null ? DateTime.now() : parseDate(v['visit_date']);
    DateTime? travelStart = parseDate(v?['travel_start']);
    DateTime? arrive = parseDate(v?['arrive_at']);
    DateTime? depart = parseDate(v?['depart_at']);
    String s(Object? x) => x == null ? '' : '$x';
    final workHours = TextEditingController(text: s(v?['work_hours']));
    final travelHours = TextEditingController(text: s(v?['travel_hours']));
    final km = TextEditingController(text: s(v?['km']));
    final travelCost = TextEditingController(text: s(v?['travel_cost']));
    final stayCost = TextEditingController(text: s(v?['stay_cost']));
    final miscCost = TextEditingController(text: s(v?['misc_cost']));
    final workDone = TextEditingController(text: s(v?['work_done']));
    final signName = TextEditingController(text: s(v?['customer_sign_name']));
    final remarks = TextEditingController(text: s(v?['customer_remarks']));

    num? numOrNull(TextEditingController c, String label) {
      final t = c.text.trim();
      if (t.isEmpty) return null;
      final n = num.tryParse(t);
      if (n == null) throw '$label must be a number — enter digits only.';
      return n;
    }

    final saved = await showFormSheet(
      context,
      title: v == null ? 'Log visit' : 'Edit visit',
      saveLabel: 'Save visit',
      builder: (ctx, setS) => [
        if (_canEditAll && _users.isNotEmpty)
          AppSelect<int>(
            label: 'Engineer',
            value: engineerId,
            valueLabel: engineerName,
            options: _users,
            onChanged: (o) => setS(() {
              engineerId = o?.value;
              engineerName = o?.label;
            }),
          ),
        DateField(label: 'Visit date', value: visitDate, onChanged: (d) => setS(() => visitDate = d)),
        DateTimeField(label: 'Left for site', value: travelStart, onChanged: (d) => setS(() => travelStart = d)),
        DateTimeField(label: 'Arrived at site', value: arrive, onChanged: (d) => setS(() => arrive = d)),
        DateTimeField(label: 'Left site', value: depart, onChanged: (d) => setS(() => depart = d)),
        Row(children: [
          Expanded(child: AppTextField(label: 'Hours on site', controller: workHours, keyboardType: AppTextField.number)),
          const SizedBox(width: 10),
          Expanded(child: AppTextField(label: 'Travel hours', controller: travelHours, keyboardType: AppTextField.number)),
        ]),
        AppTextField(label: 'Km', controller: km, keyboardType: AppTextField.number),
        Row(children: [
          Expanded(child: AppTextField(label: 'Travel ₹', controller: travelCost, keyboardType: AppTextField.number)),
          const SizedBox(width: 10),
          Expanded(child: AppTextField(label: 'Stay ₹', controller: stayCost, keyboardType: AppTextField.number)),
        ]),
        AppTextField(label: 'Other ₹', controller: miscCost, keyboardType: AppTextField.number),
        AppTextField(label: 'Work done', required: true, controller: workDone, maxLines: 3),
        AppTextField(
            label: 'Customer signed by', controller: signName, hint: "Name of the customer's representative"),
        AppTextField(label: 'Customer remarks', controller: remarks),
        const Text(
            'Hours on site are worked out from arrival / departure when left blank. '
            'Upload the signed paper report on the Attachments tab.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        final payload = {
          'engineer_id': engineerId,
          'visit_date': visitDate == null ? null : apiDate(visitDate!),
          'travel_start': travelStart?.toUtc().toIso8601String(),
          'arrive_at': arrive?.toUtc().toIso8601String(),
          'depart_at': depart?.toUtc().toIso8601String(),
          'work_hours': numOrNull(workHours, 'Hours on site'),
          'travel_hours': numOrNull(travelHours, 'Travel hours'),
          'km': numOrNull(km, 'Km'),
          'travel_cost': numOrNull(travelCost, 'Travel ₹'),
          'stay_cost': numOrNull(stayCost, 'Stay ₹'),
          'misc_cost': numOrNull(miscCost, 'Other ₹'),
          'work_done': workDone.text,
          'customer_sign_name': signName.text.trim().isEmpty ? null : signName.text.trim(),
          'customer_remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        };
        final d = v == null
            ? await Api.post('/erp/service-requests/${widget.srId}/visits', data: payload)
            : await Api.patch('/erp/service-requests/${widget.srId}/visits/${v['id']}', data: payload);
        if (mounted) setState(() => _data = Map<String, dynamic>.from(d as Map));
      },
    );
    if (saved) widget.onChanged();
  }

  Future<void> _remove(Json v) async {
    final ok = await confirmDialog(context,
        title: 'Remove visit',
        message:
            'Remove the ${fmtDate(v['visit_date'])} visit by ${txt(v['engineer_name'])}? Its hours and costs come off the bill.',
        confirmLabel: 'Remove',
        danger: true);
    if (!ok || !mounted) return;
    final done = await runAction(context, () async {
      final d = await Api.delete('/erp/service-requests/${widget.srId}/visits/${v['id']}');
      if (mounted) setState(() => _data = Map<String, dynamic>.from(d as Map));
    }, success: 'Visit removed.');
    if (done) widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null && _error == null) return const LoadingView();
    final t = d?['totals'] is Map ? d!['totals'] as Map : const {};
    final visits = (d?['visits'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(_error!)),
      DetailSection('Visits', children: [
        Text('${t['visit_count'] ?? 0} visit(s) · ${t['engineer_count'] ?? 0} engineer(s)',
            style: const TextStyle(fontSize: 13, color: Brand.body)),
        Text('${t['work_hours'] ?? 0} h on site · ${t['travel_hours'] ?? 0} h travel · ${t['km'] ?? 0} km',
            style: const TextStyle(fontSize: 13, color: Brand.body)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 6, children: [
          if (d?['sla_response_state'] != null)
            HexPill('Response: ${_slaLabels[d!['sla_response_state']] ?? d['sla_response_state']}',
                _slaHex[d['sla_response_state']] ?? Brand.muted),
          if (d?['sla_resolution_state'] != null)
            HexPill('Resolution: ${_slaLabels[d!['sla_resolution_state']] ?? d['sla_resolution_state']}',
                _slaHex[d['sla_resolution_state']] ?? Brand.muted),
        ]),
        if (!_open)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('Visits are logged from Assigned until Work Completed.',
                style: TextStyle(fontSize: 12, color: Brand.muted)),
          ),
        if (_canLog) ...[
          const SizedBox(height: 10),
          SmallButton('+ Log visit', onPressed: () => _edit(null)),
        ],
      ]),
      if (d != null && visits.isEmpty) const EmptyView('No visits logged yet.'),
      for (final v in visits) _visitCard(v),
    ]);
  }

  Widget _visitCard(Json v) {
    final mine = v['engineer_id'] == Perm.userId;
    final canModifyDoc = _canEditAll || mine;
    final arrive = v['arrive_at'] == null
        ? '—'
        : '${fmtDateTime(v['arrive_at'])} → ${v['depart_at'] == null ? '—' : fmtDateTime(v['depart_at'])}';
    return RecordCard(
      code: fmtDate(v['visit_date']),
      title: txt(v['engineer_name']),
      subtitle: txt(v['work_done']),
      meta: [
        ('On site', arrive),
        ('Hours', '${v['work_hours'] ?? 0} h'),
        ('Travel', '${v['travel_hours'] ?? 0} h · ${v['km'] ?? 0} km'),
        ('Expenses', _inr(numOf(v['travel_cost']) + numOf(v['stay_cost']) + numOf(v['misc_cost']))),
        (
          'Customer sign-off',
          v['customer_signed_at'] != null ? '${txt(v['customer_sign_name'])}, ${fmtDateTime(v['customer_signed_at'])}' : 'Not signed'
        ),
      ],
      trailing: PopupMenuButton<String>(
        tooltip: 'Visit actions',
        onSelected: (a) {
          if (a == 'report') {
            showModalBottomSheet<void>(
              context: context,
              backgroundColor: Colors.white,
              shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
              builder: (_) => WordDocumentSheet(
                entityType: 'erp_service_visit_report',
                entityId: v['id'] as int,
                canModify: canModifyDoc,
                recordLabel: 'service report',
                downloadName: 'ServiceReport-${widget.srId}-V${v['id']}',
              ),
            );
          } else if (a == 'edit') {
            _edit(v);
          } else if (a == 'remove') {
            _remove(v);
          }
        },
        itemBuilder: (_) => [
          const PopupMenuItem(value: 'report', child: Text('Report')),
          if (_open && (_canEditAll || mine)) ...[
            const PopupMenuItem(value: 'edit', child: Text('Edit')),
            const PopupMenuItem(value: 'remove', child: Text('Remove', style: TextStyle(color: Brand.danger))),
          ],
        ],
      ),
    );
  }
}

/// A record's managed Word document (portal: shared/ManagedDocumentPanel.tsx):
/// "Create in Word" / "Edit in Word" opens Word, "Download .docx" opens the
/// latest file on the phone, plus the version history.
class WordDocumentSheet extends StatefulWidget {
  const WordDocumentSheet({
    super.key,
    required this.entityType,
    required this.entityId,
    required this.canModify,
    required this.recordLabel,
    required this.downloadName,
  });
  final String entityType;
  final int entityId;
  final bool canModify;
  final String recordLabel;
  final String downloadName;

  @override
  State<WordDocumentSheet> createState() => _WordDocumentSheetState();
}

class _WordDocumentSheetState extends State<WordDocumentSheet> {
  Json? _doc;
  bool _loaded = false;
  String? _error;
  bool _busy = false;

  String get _base => '/managed-documents/${widget.entityType}/${widget.entityId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get(_base);
      final doc = r is Map && r['document'] is Map ? Map<String, dynamic>.from(r['document'] as Map) : null;
      if (mounted) {
        setState(() {
          _doc = doc;
          _loaded = true;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loaded = true;
          _error = 'Could not load the Word document status: ${ApiClient.describe(e)}';
        });
      }
    }
  }

  Future<void> _editInWord() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await Api.get(_base);
      final current = r is Map ? r['document'] : null;
      if (current == null || (current is Map && current['is_stale'] == true)) await Api.post(_base);
      final e = await Api.post('$_base/edit');
      final url = e is Map ? e['url']?.toString() : null;
      if (url == null || url.isEmpty) {
        throw 'The server did not return a Word link for this ${widget.recordLabel}. Try again in a minute.';
      }
      await Files.openUrl(url);
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = e is String ? e : 'Could not open the ${widget.recordLabel} in Word: ${ApiClient.describe(e)}');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Files.downloadAndOpen('$_base/docx', '${widget.downloadName}.docx');
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not download the Word file: ${ApiClient.describe(e)}');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final doc = _doc;
    final versions = (doc?['versions'] as List? ?? const []).whereType<Map>().toList();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
                doc == null
                    ? 'Word document'
                    : 'Word document${versions.isNotEmpty ? ' · v${versions.first['version']}' : ''}',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading)),
            const SizedBox(height: 10),
            if (!_loaded) const LoadingView(),
            if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 10)],
            if (_loaded && doc == null && !widget.canModify && _error == null)
              Text('No ${widget.recordLabel} has been created yet.', style: const TextStyle(color: Brand.muted)),
            if (doc?['is_stale'] == true)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                    'This Word draft was made from an older version of the ${widget.recordLabel}, so it may not match.'
                    '${widget.canModify ? ' Use "Rebuild from current revision & edit".' : ''}',
                    style: const TextStyle(fontSize: 12.5, color: Color(0xFFB45309))),
              ),
            if (_loaded && widget.canModify)
              FilledButton.icon(
                onPressed: _busy ? null : _editInWord,
                icon: const Icon(Icons.description_outlined),
                label: Text(_busy
                    ? 'Opening Word…'
                    : doc == null
                        ? 'Create in Word'
                        : doc['is_stale'] == true
                            ? 'Rebuild from current revision & edit'
                            : 'Edit in Word'),
              ),
            if (doc != null) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                onPressed: _busy ? null : _download,
                icon: const Icon(Icons.download_rounded),
                label: const Text('Download .docx'),
              ),
            ],
            if (versions.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Caps('History'),
              const SizedBox(height: 4),
              for (final v in versions.take(8))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text(
                      'v${v['version']}  ${txt(v['action'])} · ${txt(v['modified_by'])}${v['modified_at'] != null ? ' · ${fmtDateTime(v['modified_at'])}' : ''}',
                      style: const TextStyle(fontSize: 12, color: Brand.body)),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
