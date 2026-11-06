import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_capa.dart';
import 'quality_common.dart';
import 'quality_lots.dart';
import 'quality_ncr.dart';

const _sourceLabels = <String, String>{
  'service_ticket': 'Service ticket',
  'email': 'Email / letter',
  'inspection_report': 'Customer inspection report',
  'phone': 'Phone call',
  'site_visit': 'Site visit',
  'other': 'Other',
};

/// Complaint costs: Quality › Complaints › costs switch (binds roles holding the tab).
bool _seeCosts() =>
    !Perm.can('quality', 'complaints', 'view') || Perm.canFeature('quality', 'complaints', 'costs', 'view');

/// Uploads complaint photos (multipart, field "files"); returns the updated complaint.
Future<Json?> _uploadPhotos(int id, List<MultipartFile> files) async {
  final form = FormData();
  for (final f in files) {
    form.files.add(MapEntry('files', f));
  }
  final r = await Api.dio.post('/quality/complaints/$id/photos',
      data: form, options: Options(contentType: 'multipart/form-data', sendTimeout: const Duration(minutes: 2)));
  return r.data is Map ? Map<String, dynamic>.from(r.data as Map) : null;
}

/// Customer complaints register (portal complaints/page.tsx).
class ComplaintsTab extends StatefulWidget {
  const ComplaintsTab({super.key});

  @override
  State<ComplaintsTab> createState() => _ComplaintsTabState();
}

class _ComplaintsTabState extends State<ComplaintsTab> {
  String _status = 'live';
  String _severity = '';
  Json? _stats;
  final _listKey = GlobalKey<ApiListViewState>();

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  void _loadStats() {
    Api.get('/quality/complaints/stats').then((s) {
      if (mounted && s is Map) setState(() => _stats = Map<String, dynamic>.from(s));
    }).catchError((_) {});
  }

  void _reload() => _listKey.currentState?.reload();

  Future<void> _new() async {
    final c = await _showNewComplaintForm(context);
    if (c != null && mounted) {
      _reload();
      _loadStats();
      openScreen(context, ComplaintDetailScreen(id: asInt(c['id'])!));
    }
  }

  Widget _kpi(String label, String value, {VoidCallback? onTap, bool selected = false}) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Material(
          color: selected ? Brand.primarySoft : Colors.white,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14), side: BorderSide(color: selected ? Brand.primary : Brand.border)),
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: onTap,
            child: Container(
              width: 120,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Caps(label),
                const SizedBox(height: 2),
                Text(value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading)),
              ]),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final seeCosts = _seeCosts();
    final s = _stats;
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton:
          Perm.can('quality', 'complaints', 'create') ? CreateFab(label: 'Log complaint', onPressed: _new) : null,
      body: ApiListView(
        key: _listKey,
        searchHint: 'Search number, customer, item, serial / batch…',
        load: (page, search) => Api.list('/quality/complaints', query: {
          if (_status == 'live') 'open_only': true else 'status': _status,
          'severity': _severity,
          'search': search,
        }),
        header: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const PageHeader('Customer Complaints', subtitle: 'Quality Module'),
            if (s != null)
              SizedBox(
                height: 74,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.fromLTRB(16, 0, 8, 8),
                  children: [
                    _kpi('Open', txt(s['open']), selected: _status == 'live', onTap: () {
                      setState(() => _status = _status == 'live' ? '' : 'live');
                      _reload();
                    }),
                    _kpi('This year', txt(s['this_year'])),
                    _kpi('Repeats', txt(s['repeats'])),
                    _kpi('Avg. response', s['avg_response_days'] == null ? '—' : '${s['avg_response_days']} days'),
                    if (seeCosts) _kpi('Total cost', fmtMoney(s['total_cost'])),
                  ],
                ),
              ),
            AppSelectFilter(
              label: 'Status',
              value: _status,
              options: {'live': 'All open', '': 'All statuses', ...complaintStatusLabels},
              onChanged: (v) {
                setState(() => _status = v);
                _reload();
              },
            ),
            FilterSelect(
              label: 'Severity',
              allLabel: 'All severities',
              value: _severity,
              options: const {'critical': 'Critical', 'major': 'Major', 'minor': 'Minor'},
              onChanged: (v) {
                setState(() => _severity = v);
                _reload();
              },
            ),
          ],
        ),
        emptyText: 'No complaints found — use + Log complaint to record one.',
        itemBuilder: (ctx, c, reload) => RecordCard(
          code: '${txt(c['complaint_number'])}${str(c['repeat_of_number']).isNotEmpty ? ' · repeat' : ''}',
          title: txt(c['customer_name']),
          subtitle: '${str(c['item_name']).isEmpty ? '—' : c['item_name']}'
              '${str(c['serial_number'] ?? c['batch_number']).isNotEmpty ? ' · ${c['serial_number'] ?? c['batch_number']}' : ''}',
          trailing: Padding(
              padding: const EdgeInsets.only(left: 8), child: qPill(complaintStatusLabels, complaintStatusHex, c['status'])),
          meta: [
            ('Severity', humanize(c['severity'])),
            (
              'NCR / CAPA',
              [str(c['ncr_number']), str(c['capa_number'])].where((x) => x.isNotEmpty).join(' / ').isEmpty
                  ? '—'
                  : [str(c['ncr_number']), str(c['capa_number'])].where((x) => x.isNotEmpty).join(' / ')
            ),
            ('Response', c['response_days'] != null ? '${c['response_days']} days' : '${c['age_days'] ?? 0} days open'),
            if (seeCosts) ('Cost', (asNum(c['total_cost']) ?? 0) != 0 ? fmtMoney(c['total_cost']) : '—'),
            ('Date', fmtDate(c['complaint_date'])),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => ComplaintDetailScreen(id: asInt(c['id'])!)));
            reload();
            _loadStats();
          },
        ),
      ),
    );
  }
}

// ── Log complaint (complaints/new/page.tsx) ──────────────────────────────────

Future<Json?> _showNewComplaintForm(BuildContext context) async {
  Json meta = {};
  List<Option<int>> codes = [];
  try {
    final r = await Future.wait([Api.get('/quality/complaints/meta'), Api.get('/quality/masters/defect-codes')]);
    if (r[0] is Map) meta = Map<String, dynamic>.from(r[0] as Map);
    codes = [
      for (final c in rowsOf(r[1]))
        if (c['is_active'] != false) Option(asInt(c['id'])!, '${txt(c['code'])} — ${txt(c['name'])}'),
    ];
  } catch (_) {}
  if (!context.mounted) return null;
  final sources = meta['sources'] is Map
      ? Map<String, dynamic>.from(meta['sources'] as Map).map((k, v) => MapEntry(k, '$v'))
      : _sourceLabels;
  final projects = rowsOf(meta['projects']);
  final categories = rowsOf(meta['categories']);
  var source = 'email';
  final sourceRef = TextEditingController();
  var date = DateTime.now();
  int? projectId;
  final customer = TextEditingController();
  final contact = TextEditingController();
  int? itemId;
  String? itemLabel;
  final itemName = TextEditingController();
  final serial = TextEditingController();
  final batch = TextEditingController();
  final qty = TextEditingController();
  String? category;
  int? codeId;
  var severity = 'minor';
  final desc = TextEditingController();
  var photos = <MultipartFile>[];
  Json? created;
  final ok = await showFormSheet(
    context,
    title: 'Log Customer Complaint',
    saveLabel: 'Log complaint',
    builder: (ctx, setS) => [
      const Text('Quality · Customer complaints — record it as the customer reported it.',
          style: TextStyle(fontSize: 13, color: Brand.muted)),
      const Caps('Where it came from'),
      AppSelect<String>(
        label: 'Source',
        value: source,
        clearable: false,
        options: [for (final e in sources.entries) Option(e.key, e.value)],
        onChanged: (o) => setS(() => source = o?.value ?? source),
      ),
      AppTextField(
          label: source == 'service_ticket' ? 'Service ticket no.' : 'Reference (email date, letter no.)', controller: sourceRef),
      DateField(label: 'Complaint date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
      AppSelect<int>(
        label: 'Machine / order (ERP)',
        value: projectId,
        options: [for (final p in projects) Option(asInt(p['id'])!, txt(p['label']))],
        onChanged: (o) => setS(() {
          projectId = o?.value;
          final p = projects.where((x) => asInt(x['id']) == projectId).firstOrNull;
          if (customer.text.isEmpty && p != null) customer.text = str(p['client_company']);
        }),
      ),
      AppTextField(label: 'Customer', required: true, controller: customer),
      AppTextField(label: 'Contact person', controller: contact),
      const Caps('What failed'),
      AppSelect<int>(
        label: 'Item (Item Master)',
        value: itemId,
        valueLabel: itemLabel,
        loadOptions: loadQualityItems,
        onChanged: (o) => setS(() {
          itemId = o?.value;
          itemLabel = o?.label;
        }),
      ),
      if (itemId == null) AppTextField(label: '…or item name', controller: itemName),
      AppTextField(label: 'Serial no.', controller: serial),
      AppTextField(label: 'Batch / heat no.', controller: batch),
      AppTextField(label: 'Qty affected', controller: qty, keyboardType: AppTextField.number),
      AppSelect<String>(
        label: 'Category',
        value: category,
        options: [for (final c in categories) Option(str(c['value']), txt(c['label']))],
        onChanged: (o) => setS(() => category = o?.value),
      ),
      AppSelect<int>(label: 'Defect code', value: codeId, options: codes, onChanged: (o) => setS(() => codeId = o?.value)),
      AppSelect<String>(
        label: 'Severity',
        value: severity,
        clearable: false,
        options: const [Option('minor', 'Minor'), Option('major', 'Major'), Option('critical', 'Critical')],
        onChanged: (o) => setS(() => severity = o?.value ?? severity),
      ),
      AppTextField(label: 'Description (as the customer reported it)', required: true, controller: desc, maxLines: 5),
      const Caps('Photos'),
      Wrap(spacing: 8, runSpacing: 8, children: [
        secondaryBtn('Take / choose photo', () async {
          final picked = await choosePhotos(ctx);
          if (picked.isNotEmpty) setS(() => photos = [...photos, ...picked]);
        }, icon: Icons.photo_camera_outlined),
        if (photos.isNotEmpty) secondaryBtn('Clear', () => setS(() => photos = []), icon: Icons.clear_rounded),
      ]),
      Text(photos.isEmpty ? 'Images only — uploaded after the complaint is logged.' : '${photos.length} photo(s) selected.',
          style: const TextStyle(fontSize: 12, color: Brand.muted)),
    ],
    onSave: () async {
      if (customer.text.trim().isEmpty && projectId == null) {
        throw 'Enter the customer (or pick the machine / order it came from).';
      }
      if (desc.text.trim().isEmpty) throw 'Describe the complaint as the customer reported it.';
      String? nz(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
      final r = await Api.post('/quality/complaints', data: {
        'source': source,
        'source_reference': nz(sourceRef),
        'erp_project_id': projectId,
        'customer_name': nz(customer),
        'contact_person': nz(contact),
        'item_id': itemId,
        'item_name': itemId != null ? null : nz(itemName),
        'serial_number': nz(serial),
        'batch_number': nz(batch),
        'quantity_affected': parseNum(qty.text, 'Qty affected'),
        'category': category,
        'defect_code_id': codeId,
        'severity': severity,
        'description': desc.text,
        'complaint_date': apiDate(date),
      });
      created = r is Map ? Map<String, dynamic>.from(r) : null;
      if (created != null && photos.isNotEmpty) {
        // A failed photo upload doesn't block logging the complaint (same as the portal).
        try {
          await _uploadPhotos(asInt(created!['id'])!, photos);
        } catch (_) {}
      }
    },
  );
  return ok ? created : null;
}

// ── Complaint detail (complaints/[id]/page.tsx) ──────────────────────────────

const _steps = ['open', 'under_investigation', 'response_sent', 'customer_accepted', 'closed'];

class ComplaintDetailScreen extends StatefulWidget {
  const ComplaintDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<ComplaintDetailScreen> createState() => _ComplaintDetailScreenState();
}

class _ComplaintDetailScreenState extends State<ComplaintDetailScreen> {
  Json? _c;
  Object? _error;
  bool _busy = false;
  Json? _cont;
  String _contError = '';
  final _containment = TextEditingController();
  final _costs = <String, TextEditingController>{
    'replacement_cost': TextEditingController(),
    'travel_cost': TextEditingController(),
    'rework_cost': TextEditingController(),
    'other_cost': TextEditingController(),
  };

  String get _base => '/quality/complaints/${widget.id}';
  bool get _canEdit => Perm.can('quality', 'complaints', 'edit');
  bool get _canApprove => Perm.can('quality', 'complaints', 'approve');
  bool get _canRespond => _canEdit && (Perm.can('quality', 'ncr', 'edit') || Perm.can('quality', 'ncr', 'approve'));

  @override
  void initState() {
    super.initState();
    _load();
    _loadContainment();
  }

  @override
  void dispose() {
    _containment.dispose();
    for (final c in _costs.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get(_base);
      if (mounted) _apply(Map<String, dynamic>.from(r as Map));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _loadContainment() {
    Api.get('$_base/containment').then((r) {
      if (mounted) {
        setState(() {
          _cont = r is Map ? Map<String, dynamic>.from(r) : null;
          _contError = '';
        });
      }
    }).catchError((Object e) {
      if (mounted) {
        setState(() {
          _cont = null;
          _contError = ApiClient.describe(e);
        });
      }
    });
  }

  void _apply(Json c) {
    _containment.text = str(c['containment_notes']);
    _costs.forEach((k, ctrl) => ctrl.text = c[k] == null ? '' : '${c[k]}');
    setState(() {
      _c = c;
      _error = null;
    });
  }

  Future<bool> _run(Future<dynamic> Function() fn, {String? success}) async {
    if (_busy) return false;
    setState(() => _busy = true);
    try {
      final r = await fn();
      if (!mounted) return true;
      if (r is Map) _apply(Map<String, dynamic>.from(r));
      if (success != null) showSnack(context, success);
      return true;
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sheet(Future<dynamic> Function() fn) async {
    final r = await fn();
    if (mounted && r is Map) _apply(Map<String, dynamic>.from(r));
  }

  String get _sub => '${txt(_c!['complaint_number'])} · ${txt(_c!['customer_name'])}';

  Future<void> _addPhotos() async {
    var files = <MultipartFile>[];
    final ok = await showFormSheet(
      context,
      title: 'Add photos',
      saveLabel: 'Upload photos',
      builder: (ctx, setS) => [
        Text(_sub, style: const TextStyle(color: Brand.muted)),
        const Caps('Photos of the defect *'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          secondaryBtn('Take / choose photo', () async {
            final picked = await choosePhotos(ctx);
            if (picked.isNotEmpty) setS(() => files = [...files, ...picked]);
          }, icon: Icons.photo_camera_outlined),
          if (files.isNotEmpty) secondaryBtn('Clear', () => setS(() => files = []), icon: Icons.clear_rounded),
        ]),
        Text(
            files.isNotEmpty
                ? '${files.length} photo(s) selected.'
                : 'Images only — the failed part, the nameplate / serial, the site condition.',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (files.isEmpty) throw 'Choose one or more photos first.';
        final r = await _uploadPhotos(widget.id, files);
        if (mounted && r != null) _apply(r);
      },
    );
    if (ok && mounted) showSnack(context, 'Photos uploaded.');
  }

  Future<void> _investigate() async {
    final c = _c!;
    int? owner = asInt(c['owner_id']);
    String? ownerLabel = str(c['owner_name']).isEmpty ? null : str(c['owner_name']);
    final ok = await showFormSheet(
      context,
      title: 'Start investigation',
      saveLabel: 'Start investigation',
      builder: (ctx, setS) => [
        Text('${txt(c['complaint_number'])} · raises an NCR and a CAPA (8D)', style: const TextStyle(color: Brand.muted)),
        AppSelect<int>(
          label: 'Complaint owner',
          value: owner,
          valueLabel: ownerLabel,
          loadOptions: loadQualityUsers,
          onChanged: (o) => setS(() {
            owner = o?.value;
            ownerLabel = o?.label;
          }),
        ),
        const Text(
            'The owner drives the investigation and the customer response; the NCR and CAPA are linked to this complaint.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () => _sheet(() => Api.post('$_base/investigate', data: {'owner_id': owner})),
    );
    if (ok && mounted) showSnack(context, 'Investigation started.');
  }

  Future<void> _reject() async {
    final reason = await promptDialog(context,
        title: 'Reject as not a valid complaint?',
        message: 'Give the reason (it is shared with the customer).',
        confirmLabel: 'Reject complaint');
    if (reason == null) return;
    await _run(() => Api.post('$_base/reject', data: {'reason': reason}), success: 'Complaint rejected.');
  }

  Future<void> _response() async {
    final ctrl = TextEditingController(text: str(_c!['response_text']));
    final ok = await showFormSheet(
      context,
      title: 'Response sent to the customer',
      saveLabel: 'Response sent',
      builder: (ctx, setS) => [
        Text(_sub, style: const TextStyle(color: Brand.muted)),
        AppTextField(label: 'Response to the customer', required: true, controller: ctrl, maxLines: 7),
        const Text(
            '8D summary: root cause, containment, corrective actions. The response time is counted from the complaint date.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () => _sheet(() => Api.post('$_base/response', data: {'response_text': ctrl.text})),
    );
    if (ok && mounted) showSnack(context, 'Response recorded.');
  }

  Future<void> _accepted() async {
    final ref = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Customer accepted',
      saveLabel: 'Customer accepted',
      builder: (ctx, setS) => [
        Text(_sub, style: const TextStyle(color: Brand.muted)),
        AppTextField(label: 'Customer acceptance', required: true, controller: ref, hint: 'Email / letter ref., name, date'),
      ],
      onSave: () => _sheet(() => Api.post('$_base/feedback', data: {'accepted': true, 'reference': ref.text})),
    );
    if (ok && mounted) showSnack(context, 'Acceptance recorded.');
  }

  Future<void> _notSatisfied() async {
    final remarks = await promptDialog(context,
        title: 'Customer not satisfied?',
        message: 'The complaint goes back to investigation. Record what the customer was not satisfied with.',
        label: 'Remarks',
        confirmLabel: 'Back to investigation');
    if (remarks == null) return;
    await _run(() => Api.post('$_base/feedback', data: {'accepted': false, 'remarks': remarks}),
        success: 'Back to investigation.');
  }

  Future<void> _close() async {
    final res = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Close complaint',
      saveLabel: 'Close complaint',
      builder: (ctx, setS) => [
        Text(_sub, style: const TextStyle(color: Brand.muted)),
        AppTextField(label: 'Resolution notes', controller: res, maxLines: 4),
        const Text('Recorded in Organization › Approval Workflows › Customer complaint close / reject.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () => _sheet(() => Api.post('$_base/close',
          data: {'resolution_notes': res.text.trim().isEmpty ? null : res.text.trim()})),
    );
    if (ok && mounted) showSnack(context, 'Complaint closed.');
  }

  Future<void> _saveCosts() async {
    try {
      final payload = {for (final e in _costs.entries) e.key: parseNum(e.value.text, humanize(e.key))};
      await _run(() => Api.patch(_base, data: payload), success: 'Costs saved.');
    } catch (e) {
      if (e is String && mounted) showSnack(context, e, error: true);
    }
  }

  Widget _muted(String t, {Color color = Brand.muted}) =>
      Padding(padding: const EdgeInsets.only(top: 4), child: Text(t, style: TextStyle(fontSize: 12.5, color: color)));

  Widget _bold(String t) => Padding(
      padding: const EdgeInsets.only(top: 10, bottom: 2),
      child: Text(t, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading)));

  Widget _containmentSection(bool live) {
    final cont = _cont;
    final children = <Widget>[];
    if (cont == null) {
      children.add(_contError.isNotEmpty ? _muted(_contError, color: const Color(0xFFB91C1C)) : _muted('Loading…'));
    } else if (str(cont['note']).isNotEmpty) {
      children.add(_muted(str(cont['note'])));
    } else {
      final keys = cont['keys'] is List ? (cont['keys'] as List).join(', ') : '';
      children.add(_muted('Traced by serial / batch $keys.'));
      final inStock = rowsOf(cont['in_stock']);
      children.add(_bold('Same batch still in stock (${inStock.length})'));
      if (inStock.isEmpty) {
        children.add(_muted('None in any store.'));
      } else {
        for (final s in inStock) {
          children.add(KvRow(txt(s['location_name']), 'Free ${txt(s['free'])} · Quality ${txt(s['quality'])} · Blocked ${txt(s['blocked'])}'));
        }
      }
      final delivered = rowsOf(cont['delivered']);
      children.add(_bold('Same batch already delivered / issued (${delivered.length})'));
      if (delivered.isEmpty) {
        children.add(_muted('No issue or dispatch of this batch recorded.'));
      } else {
        for (final d in delivered) {
          children.add(KvRow('${txt(d['issue_number'])} · ${txt(d['issue_type'])}',
              '${fmtDate(d['issue_date'])} · qty ${txt(d['quantity'])} · to ${txt(d['to'])}'));
        }
      }
      final tr = cont['traceability'] is Map ? Map<String, dynamic>.from(cont['traceability'] as Map) : null;
      if (tr != null) {
        final lots = rowsOf(tr['lots']);
        children.add(_bold('Inspection history of the batch (${lots.length})'));
        if (lots.isEmpty) {
          children.add(_muted('No inspection lot carries this batch / serial.'));
        } else {
          for (final l in lots) {
            children.add(InkWell(
              onTap: () => openScreen(context, LotDetailScreen(id: asInt(l['id'])!)),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(txt(l['lot_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
                  Text(
                      '${lbl(inspectionTypeLabels, l['inspection_type'])} · ${txt(l['source_reference'] ?? l['source_type'])} · '
                      '${txt(l['vendor_name'])} · ${l['decision'] != null ? lbl(decisionLabels, l['decision']) : txt(l['status'])} · ${fmtDate(l['lot_date'])}',
                      style: const TextStyle(fontSize: 12.5)),
                ]),
              ),
            ));
          }
        }
        final machines = rowsOf(tr['machines']);
        final ncrs = rowsOf(tr['ncrs']);
        final calls = rowsOf(tr['inspection_calls']);
        if (machines.isNotEmpty || ncrs.isNotEmpty || calls.isNotEmpty) {
          final parts = <String>[
            if (machines.isNotEmpty)
              machines.map((m) => 'Machine ${txt(m['serial_number'])} (${txt(m['client_company'])})').join('; '),
            if (ncrs.isNotEmpty) 'NCRs: ${ncrs.map((n) => n['ncr_number']).join(', ')}',
            if (calls.isNotEmpty) 'Third-party: ${calls.map((x) => '${x['call_number']} ${x['result'] ?? x['status']}').join(', ')}',
          ];
          children.add(Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(parts.join(' · '), style: const TextStyle(fontSize: 12.5))));
        }
      }
      final related = rowsOf(cont['related_complaints']);
      if (related.isNotEmpty) {
        children.add(_muted(
            'Other complaints on this batch: ${related.map((r) => '${r['complaint_number']} (${r['customer_name']})').join(', ')}',
            color: const Color(0xFFB91C1C)));
      }
    }
    if (live && _canEdit) {
      children.addAll([
        const SizedBox(height: 10),
        AppTextField(label: 'Containment done (units held / sorted / replaced)', controller: _containment, maxLines: 3),
        ActionWrap(children: [
          secondaryBtn('Save', _busy
              ? null
              : () => _run(() => Api.patch(_base, data: {'containment_notes': _containment.text}), success: 'Containment saved.'),
              icon: Icons.save_outlined),
        ]),
      ]);
    }
    return DetailSection('Traceability & containment', children: children);
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    if (c == null) {
      return SubPage(
          title: 'Customer complaint', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final status = str(c['status']);
    final live = status != 'closed' && status != 'rejected';
    final photos = rowsOf(c['photos']);
    final seeCosts = _seeCosts();
    final stepIndex = _steps.indexOf(status);

    return SubPage(
      title: txt(c['complaint_number']),
      body: RefreshIndicator(
        onRefresh: () async {
          await _load();
          _loadContainment();
        },
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            const Hint('Quality · Customer complaint'),
            ApprovalPanel(
                key: ValueKey('cc-$status'),
                entityType: 'quality_complaint',
                entityId: widget.id,
                title: 'Close / reject approval',
                onChanged: _load),
            if (status != 'rejected')
              ChipRow(children: [
                for (var i = 0; i < _steps.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: StatusBadge('${i + 1}. ${complaintStatusLabels[_steps[i]]}',
                        color: stepIndex >= i ? const Color(0xFF15803D) : const Color(0xFF64748B)),
                  ),
              ]),
            DetailSection('Complaint from ${txt(c['customer_name'])}', children: [
              Text(txt(c['description']), style: const TextStyle(fontSize: 13.5)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                qPill(complaintStatusLabels, complaintStatusHex, status),
                pill(humanize(c['severity']), severityHex[str(c['severity'])]),
                if (str(c['repeat_of_number']).isNotEmpty) pill('Repeat', qRed),
                Text(
                    'Logged ${fmtDate(c['complaint_date'])}${str(c['received_by_name']).isNotEmpty ? ' by ${c['received_by_name']}' : ''}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
                if (str(c['owner_name']).isNotEmpty)
                  Text('Owner ${c['owner_name']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                Text(c['response_days'] != null ? 'Answered in ${c['response_days']} days' : 'Open ${c['age_days'] ?? 0} days',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
              if (status == 'open' && (_canEdit || _canApprove))
                ActionWrap(children: [
                  if (_canEdit)
                    primaryBtn('Start investigation (raise NCR + CAPA)', _busy ? null : _investigate, icon: Icons.search_rounded),
                  if (_canApprove)
                    secondaryBtn('Not a valid complaint', _busy ? null : _reject, color: qRed, icon: Icons.block_rounded),
                ]),
            ]),
            DetailSection('Customer', children: [
              FieldRow('Contact person', c['contact_person']),
              FieldRow('Machine / order', c['project_label']),
              FieldRow('Came in through',
                  '${humanize(c['source'])}${str(c['source_reference']).isNotEmpty ? ' · ${c['source_reference']}' : ''}'),
            ]),
            DetailSection('What failed', children: [
              FieldRow('Item', str(c['item_name']).isEmpty ? null : codeName(c['item_code'], c['item_name'])),
              FieldRow('Serial / batch', [str(c['serial_number']), str(c['batch_number'])].where((x) => x.isNotEmpty).join(' / ')),
              FieldRow('Qty affected', fmtQty(c['quantity_affected'])),
              FieldRow('Category', c['category_label']),
              FieldRow('Defect', c['defect_code_label']),
              if (c['repeat_of_id'] != null)
                FieldRow(
                    'Repeat of',
                    InkWell(
                      onTap: () => openScreen(context, ComplaintDetailScreen(id: asInt(c['repeat_of_id'])!)),
                      child: Text.rich(TextSpan(children: [
                        TextSpan(text: txt(c['repeat_of_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
                        const TextSpan(text: ' (same customer and item)', style: TextStyle(color: Color(0xFFB91C1C))),
                      ])),
                    )),
              if (str(c['rejection_reason']).isNotEmpty) FieldRow('Rejected because', c['rejection_reason']),
              if (photos.isNotEmpty || (live && _canEdit))
                FieldRow(
                    'Photos',
                    Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      for (final p in photos)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: ApiImage('$_base/photos/${p['id']}', width: 120, height: 90, caption: str(p['file_name'])),
                        ),
                      if (live && _canEdit) secondaryBtn('+ Add photos', _busy ? null : _addPhotos, icon: Icons.add_a_photo_outlined),
                    ])),
            ]),
            if (c['ncr_id'] != null || c['capa_id'] != null)
              DetailSection('Investigation', children: [
                if (c['ncr_id'] != null)
                  InkWell(
                    onTap: () => openScreen(context, NcrDetailScreen(id: asInt(c['ncr_id'])!)),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text.rich(TextSpan(children: [
                        const TextSpan(text: 'NCR: '),
                        TextSpan(text: txt(c['ncr_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
                      ])),
                    ),
                  ),
                if (c['capa_id'] != null)
                  InkWell(
                    onTap: () => openScreen(context, CapaDetailScreen(id: asInt(c['capa_id'])!)),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text.rich(TextSpan(children: [
                        const TextSpan(text: 'CAPA (8D): '),
                        TextSpan(text: txt(c['capa_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
                        TextSpan(
                            text: ' · ${lbl(capaStatusLabels, c['capa_status'])}${c['capa_effective'] == true ? ' · effective' : ''}'),
                      ])),
                    ),
                  ),
                _muted('The 8D report for the customer is generated on the CAPA once its root cause is found.'),
              ]),
            _containmentSection(live),
            if (['under_investigation', 'response_sent', 'customer_accepted', 'closed'].contains(status))
              DetailSection('Customer response', children: [
                if (c['response_sent_at'] != null)
                  FieldRow('Sent', '${fmtDate(c['response_sent_at'])} (${c['response_days']} days after the complaint)'),
                if (status == 'under_investigation')
                  (_canRespond
                      ? ActionWrap(children: [primaryBtn('Record response sent', _busy ? null : _response, icon: Icons.send_rounded)])
                      : const SizedBox.shrink())
                else
                  FieldRow('Response to the customer', c['response_text']),
                if (status == 'response_sent' && _canRespond)
                  ActionWrap(children: [
                    primaryBtn('Customer accepted', _busy ? null : _accepted, color: qGreen),
                    secondaryBtn('Not satisfied', _busy ? null : _notSatisfied, icon: Icons.undo_rounded),
                  ]),
                if (c['customer_accepted_at'] != null)
                  FieldRow('Customer accepted', '${fmtDate(c['customer_accepted_at'])} · ${str(c['customer_acceptance_reference'])}'),
              ]),
            if (status != 'rejected' && seeCosts)
              DetailSection('Cost of the complaint', children: [
                for (final e in _costs.entries)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: AppTextField(
                      label: '${humanize(e.key.replaceAll('_cost', ''))} (₹)',
                      controller: e.value,
                      keyboardType: AppTextField.number,
                      enabled: live && _canEdit,
                    ),
                  ),
                Text('Total ${fmtMoney(c['total_cost'])}', style: const TextStyle(fontWeight: FontWeight.w700)),
                if (live && _canEdit) ActionWrap(children: [secondaryBtn('Save costs', _busy ? null : _saveCosts, icon: Icons.save_outlined)]),
              ]),
            if (status == 'customer_accepted' || status == 'closed')
              DetailSection('Closure', children: [
                if (status == 'closed')
                  FieldRow('Closed',
                      '${fmtDate(c['closed_at'])}${str(c['resolution_notes']).isNotEmpty ? ' · ${c['resolution_notes']}' : ''}')
                else ...[
                  if (c['capa_effective'] != true && c['capa_id'] != null)
                    _muted(
                        'The complaint closes only once CAPA ${txt(c['capa_number'])} is closed effective (D8) — currently ${lbl(capaStatusLabels, c['capa_status'])}.',
                        color: const Color(0xFFB45309)),
                  if (_canApprove)
                    ActionWrap(children: [primaryBtn('Close complaint', _busy ? null : _close, color: qGreen, icon: Icons.verified_outlined)]),
                ],
              ]),
          ],
        ),
      ),
    );
  }
}
