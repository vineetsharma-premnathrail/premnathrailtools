import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';
import 'quality_first_articles.dart';
import 'quality_ncr.dart';

/// Inspection Lots register and My Inspections (portal LotList.tsx,
/// lots/page.tsx, my-inspections/page.tsx).
class LotsTab extends StatefulWidget {
  const LotsTab({super.key, this.mine = false, this.initialType = ''});
  final bool mine;
  final String initialType;

  @override
  State<LotsTab> createState() => _LotsTabState();
}

class _LotsTabState extends State<LotsTab> {
  late String _type = widget.initialType;
  String _status = '';
  int _waitingDays = 2;
  final _listKey = GlobalKey<ApiListViewState>();

  @override
  void initState() {
    super.initState();
    Api.get('/quality/settings').then((s) {
      final v = s is Map && s['values'] is Map ? (s['values'] as Map)['lot_waiting_days'] : null;
      if (mounted) setState(() => _waitingDays = asInt(v) ?? (asNum(v)?.toInt() ?? 2));
    }).catchError((_) {});
  }

  Future<void> _newLot() async {
    final lot = await showManualLotForm(context);
    if (lot != null && mounted) {
      _listKey.currentState?.reload();
      openScreen(context, LotDetailScreen(id: asInt(lot['id'])!));
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = !widget.mine && Perm.can('quality', 'inspection_lots', 'create');
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: canCreate ? CreateFab(label: 'Manual Lot', onPressed: _newLot) : null,
      body: ApiListView(
        key: _listKey,
        searchHint: 'Search lot, item, GRN / WO number, vendor…',
        load: (page, search) => Api.list('/quality/inspection-lots', query: {
          if (widget.mine) 'mine': true,
          'status': _status,
          'inspection_type': _type,
          'search': search,
        }),
        header: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            PageHeader(widget.mine ? 'My Inspections' : 'Inspection Lots', subtitle: 'Quality Module'),
            if (widget.mine)
              const Hint('Open inspection lots assigned to you, plus unassigned lots anyone can pick up. Lots are created '
                  'automatically from GRNs and production output for items flagged “Quality check on receipt”.'),
            FilterSelect(
              label: 'Inspection type',
              allLabel: 'All inspection types',
              value: _type,
              options: inspectionTypeLabels,
              onChanged: (v) {
                setState(() => _type = v);
                _listKey.currentState?.reload();
              },
            ),
            if (!widget.mine)
              FilterSelect(
                label: 'Status',
                allLabel: 'All statuses',
                value: _status,
                options: lotStatusLabels,
                onChanged: (v) {
                  setState(() => _status = v);
                  _listKey.currentState?.reload();
                },
              ),
          ],
        ),
        emptyText: widget.mine
            ? 'Nothing waiting for you — open lots assigned to you or unassigned show here.'
            : 'No inspection lots found.',
        itemBuilder: (ctx, l, reload) {
          final open = ['created', 'in_inspection', 'results_recorded'].contains(l['status']);
          final age = asInt(l['age_days']) ?? 0;
          final late = open && age > _waitingDays;
          return RecordCard(
            code: str(l['lot_number']),
            title: codeName(l['item_code'], l['item_name']),
            trailing: Padding(
                padding: const EdgeInsets.only(left: 8),
                child: qPill(lotStatusLabels, lotStatusHex, l['status'])),
            meta: [
              ('Qty', fmtQty(l['quantity'], l['uom'])),
              ('Type', lbl(inspectionTypeLabels, l['inspection_type'])),
              ('Source', txt(l['source_reference'] ?? l['source_type'])),
              ('Assigned', str(l['assigned_to_name']).isEmpty ? 'Unassigned' : str(l['assigned_to_name'])),
              ('Age', late ? '$age d · waiting too long' : '$age d'),
              ('Decision', l['decision'] == null ? '—' : lbl(decisionLabels, l['decision'])),
            ],
            onTap: () async {
              await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => LotDetailScreen(id: asInt(l['id'])!)));
              reload();
            },
          );
        },
      ),
    );
  }
}

// ── New manual lot (lots/new/page.tsx) ───────────────────────────────────────

const _manualTypes = ['stock_reinspection', 'sales_return', 'in_process', 'job_work', 'final', 'third_party'];

/// "New Manual Inspection Lot" form; returns the created lot.
Future<Json?> showManualLotForm(BuildContext context, {String? initialType}) async {
  var type = initialType != null && _manualTypes.contains(initialType) ? initialType : 'stock_reinspection';
  int? itemId;
  String? itemLabel;
  String? itemUom;
  final qty = TextEditingController();
  final batch = TextEditingController();
  final vendor = TextEditingController();
  final ref = TextEditingController();
  final remarks = TextEditingController();
  var hold = true;
  int? locationId;
  String? projectUnit;
  String? projectLabel;
  Json? created;
  List<Option<int>>? locations;
  try {
    locations = [
      for (final l in rowsOf(await Api.get('/quality/masters/locations')))
        Option(asInt(l['id'])!, '${txt(l['code'])} — ${txt(l['name'])}'),
    ];
  } catch (_) {
    locations = [];
  }
  if (!context.mounted) return null;
  final ok = await showFormSheet(
    context,
    title: 'New Manual Inspection Lot',
    saveLabel: 'Create Lot',
    builder: (ctx, setS) => [
      const Text(
          'Incoming lots come from GRNs and final lots from production output — raise one here for re-inspection, '
          'returns, job work, in-process or third-party.',
          style: TextStyle(fontSize: 13, color: Brand.muted)),
      const Caps('Lot'),
      AppSelect<String>(
        label: 'Inspection type',
        value: type,
        clearable: false,
        options: [for (final t in _manualTypes) Option(t, inspectionTypeLabels[t]!)],
        onChanged: (o) => setS(() => type = o?.value ?? type),
      ),
      AppSelect<int>(
        label: 'Item',
        required: true,
        value: itemId,
        valueLabel: itemLabel,
        loadOptions: loadQualityItems,
        onChanged: (o) => setS(() {
          itemId = o?.value;
          itemLabel = o?.label;
          itemUom = o?.subtitle;
        }),
      ),
      AppTextField(
          label: 'Quantity${itemUom != null ? ' ($itemUom)' : ''}',
          required: true,
          controller: qty,
          keyboardType: AppTextField.number),
      AppTextField(label: 'Batch / serial', controller: batch),
      AppTextField(label: 'Vendor (if any)', controller: vendor),
      AppTextField(label: 'Reference document', controller: ref, hint: 'e.g. return note no.'),
      AppSelect<String>(
        label: 'Project — Unit (vehicle / lot)',
        value: projectUnit,
        valueLabel: projectLabel,
        loadOptions: loadProjectUnits,
        onChanged: (o) => setS(() {
          projectUnit = o?.value;
          projectLabel = o?.label;
        }),
      ),
      const Text('Link a final / in-process check to the build it belongs to — it shows on the Project\'s Quality column.',
          style: TextStyle(fontSize: 12, color: Brand.muted)),
      const Caps('Stock'),
      CheckField(
        label: 'Hold stock — move this quantity from Free to Quality stock until the usage decision (it can\'t be issued meanwhile)',
        value: hold,
        onChanged: (v) => setS(() => hold = v),
      ),
      if (hold)
        AppSelect<int>(
          label: 'Store',
          required: true,
          value: locationId,
          options: locations ?? const [],
          onChanged: (o) => setS(() => locationId = o?.value),
        ),
      const Text('Untick only when the material is not in a store\'s Free stock.',
          style: TextStyle(fontSize: 12, color: Brand.muted)),
      const Caps('Remarks'),
      AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
    ],
    onSave: () async {
      if (itemId == null) throw 'Pick the item to inspect.';
      final q = num.tryParse(qty.text.trim());
      if (q == null || q <= 0) throw 'Enter a quantity greater than zero.';
      if (hold && locationId == null) {
        throw 'Pick the store whose Free stock should be held in Quality for this inspection — or untick "Hold stock".';
      }
      final (pid, eid) = splitProjectUnit(projectUnit);
      final r = await Api.post('/quality/inspection-lots', data: {
        'inspection_type': type,
        'item_id': itemId,
        'quantity': q,
        'location_id': hold ? locationId : null,
        'take_from_free': hold,
        'batch_number': batch.text.trim().isEmpty ? null : batch.text.trim(),
        'vendor_name': vendor.text.trim().isEmpty ? null : vendor.text.trim(),
        'source_reference': ref.text.trim().isEmpty ? null : ref.text.trim(),
        'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        'order_project_id': pid,
        'order_project_element_id': eid,
      });
      created = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? created : null;
}

// ── Lot detail (lots/[id]/page.tsx) ──────────────────────────────────────────

const _sourceLabels = <String, String>{
  'grn': 'GRN',
  'work_order': 'Work order output',
  'ncr': 'NCR re-inspection',
  'manual': 'Manual',
  'work_order_operation': 'Production gate',
  'material_return': 'Job work receipt',
};
const _faiStatusHex = <String, Color>{
  'open': Color(0xFFF59E0B),
  'approved': Color(0xFF16A34A),
  'rejected': Color(0xFFDC2626),
  'cancelled': Color(0xFFA8A29E),
};

class _Draft {
  _Draft(Json r)
      : values = TextEditingController(
            text: (r['measured_values'] is List) ? (r['measured_values'] as List).map(_numStr).join(', ') : ''),
        defects = TextEditingController(text: r['defects_found'] == null ? '' : '${r['defects_found']}'),
        remarks = TextEditingController(text: str(r['remarks'])),
        defectCodeId = asInt(r['defect_code_id']),
        defectCodeLabel = r['defect_code_label']?.toString(),
        gaugeId = asInt(r['gauge_id']),
        gaugeRef = str(r['gauge_reference']);
  final TextEditingController values;
  final TextEditingController defects;
  final TextEditingController remarks;
  int? defectCodeId;
  String? defectCodeLabel;
  int? gaugeId;
  String gaugeRef;

  void dispose() {
    values.dispose();
    defects.dispose();
    remarks.dispose();
  }
}

String _numStr(Object? v) {
  final n = asNum(v);
  if (n == null) return '';
  return n == n.roundToDouble() && n is double ? n.toInt().toString() : n.toString();
}

String _limits(Json r) {
  if (r['char_type'] != 'variable') return 'Pass / fail';
  final lo = r['min_value'] ?? '–';
  final hi = r['max_value'] ?? '–';
  final unit = str(r['unit']);
  return '${r['nominal'] != null ? '${r['nominal']} ' : ''}($lo … $hi)${unit.isNotEmpty ? ' $unit' : ''}';
}

class LotDetailScreen extends StatefulWidget {
  const LotDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<LotDetailScreen> createState() => _LotDetailScreenState();
}

class _LotDetailScreenState extends State<LotDetailScreen> {
  Json? _lot;
  Object? _error;
  bool _busy = false;
  final _drafts = <int, _Draft>{};
  List<Option<int>> _users = [];
  List<Option<int>> _gauges = [];
  List<Option<int>> _codes = [];

  String get _base => '/quality/inspection-lots/${widget.id}';

  bool get _canEdit => Perm.can('quality', 'inspection_lots', 'edit');
  bool get _canDecide =>
      Perm.can('quality', 'inspection_lots', 'approve') &&
      Perm.canFeature('quality', 'inspection_lots', 'usage_decision', 'approve');
  bool get _canRecord => Perm.canFeature('quality', 'inspection_lots', 'results', 'edit');
  bool get _canSubmitResults => Perm.canFeature('quality', 'inspection_lots', 'results', 'submit');
  bool get _seePhotos =>
      !Perm.can('quality', 'inspection_lots', 'view') || Perm.canFeature('quality', 'inspection_lots', 'photos', 'view');
  bool get _isHead => Perm.can('quality', 'ncr', 'approve');

  @override
  void initState() {
    super.initState();
    _load();
    Api.get('/quality/settings/roles').then((r) {
      final users = r is Map ? rowsOf(r['users']) : <Json>[];
      if (mounted) setState(() => _users = [for (final u in users) Option(asInt(u['id'])!, txt(u['name']))]);
    }).catchError((_) {});
    Api.get('/quality/gauges', query: {'usable_only': true}).then((r) {
      if (mounted) {
        setState(() => _gauges = [
              for (final g in rowsOf(r)) Option(asInt(g['id'])!, '${txt(g['code'])} — ${txt(g['name'])}', subtitle: str(g['code'])),
            ]);
      }
    }).catchError((_) {});
    loadDefectCodes('').then((c) {
      if (mounted) setState(() => _codes = c);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    for (final d in _drafts.values) {
      d.dispose();
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

  void _apply(Json lot) {
    for (final d in _drafts.values) {
      d.dispose();
    }
    _drafts.clear();
    for (final r in rowsOf(lot['results'])) {
      _drafts[asInt(r['id'])!] = _Draft(r);
    }
    setState(() {
      _lot = lot;
      _error = null;
    });
  }

  /// Runs a lot action that returns the updated lot.
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

  Future<void> _saveResults() async {
    final lot = _lot!;
    final entries = <Json>[];
    for (final r in rowsOf(lot['results'])) {
      final d = _drafts[asInt(r['id'])]!;
      final parts = d.values.text.split(RegExp(r'[\s,;]+')).where((s) => s.isNotEmpty).toList();
      final values = parts.map(num.tryParse).toList();
      if (r['char_type'] == 'variable' && values.any((v) => v == null)) {
        showSnack(context, 'Measured values must be numbers, separated by commas or spaces.', error: true);
        return;
      }
      final defects = d.defects.text.trim().isEmpty ? null : int.tryParse(d.defects.text.trim());
      final mv = r['char_type'] == 'variable' ? values.whereType<num>().toList() : null;
      if ((mv != null && mv.isNotEmpty) || defects != null) {
        entries.add({
          'result_id': r['id'],
          'measured_values': mv,
          'defects_found': defects,
          'defect_code_id': d.defectCodeId,
          'gauge_id': d.gaugeId,
          'gauge_reference': d.gaugeRef,
          'remarks': d.remarks.text,
        });
      }
    }
    if (entries.isEmpty) {
      showSnack(context, 'Enter at least one measured value or defect count before saving.', error: true);
      return;
    }
    await _run(() => Api.post('$_base/results', data: {'entries': entries}), success: 'Results saved.');
  }

  Future<void> _cancelLot() async {
    final reason = await promptDialog(context,
        title: 'Cancel this lot?',
        message: 'Only a manual lot without stock can be cancelled. Give the reason.',
        confirmLabel: 'Cancel lot');
    if (reason == null) return;
    await _run(() => Api.post('$_base/cancel', data: {'reason': reason}), success: 'Lot cancelled.');
  }

  Future<void> _certificate() async {
    final lot = _lot!;
    final ctrl = TextEditingController(text: str(lot['test_certificate_reference']));
    final ok = await showFormSheet(
      context,
      title: 'Test certificate / MTC',
      saveLabel: 'Save',
      builder: (ctx, setS) => [
        Text('${txt(lot['lot_number'])} · ${txt(lot['item_name'])}', style: const TextStyle(color: Brand.muted)),
        AppTextField(label: 'Certificate / heat number', controller: ctrl, hint: 'Certificate / heat number'),
        const Text(
            'Enter the number to mark the certificate received; leave it empty and save to mark it not received.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        final r = await Api.post('$_base/test-certificate',
            data: {'received': ctrl.text.trim().isNotEmpty, 'reference': ctrl.text});
        if (r is Map && mounted) _apply(Map<String, dynamic>.from(r));
      },
    );
    if (ok && mounted) showSnack(context, 'Certificate updated.');
  }

  Future<void> _decide() async {
    final lot = _lot!;
    var decision = 'accept';
    final acc = TextEditingController();
    final rej = TextEditingController();
    final dev = TextEditingController();
    final remarks = TextEditingController();
    final uom = str(lot['uom']);
    final q = fmtQty(lot['quantity']);
    String summary() {
      switch (decision) {
        case 'accept':
          return '$q $uom will move from Quality to Free stock.';
        case 'accept_with_deviation':
          return '$q $uom will move to Free stock under deviation ${dev.text.isEmpty ? '—' : dev.text}; an NCR records the deviation.';
        case 'reject':
          return '$q $uom will move to Blocked stock and an NCR will be raised.';
        default:
          return '${acc.text.isEmpty ? 0 : acc.text} $uom to Free stock, ${rej.text.isEmpty ? 0 : rej.text} $uom to Blocked stock with an NCR.';
      }
    }

    final failed = asInt(lot['failed_count']) ?? 0;
    final ok = await showFormSheet(
      context,
      title: 'Usage decision',
      saveLabel: 'Record',
      builder: (ctx, setS) => [
        Text('${txt(lot['lot_number'])} · ${txt(lot['item_name'])} · ${fmtQty(lot['quantity'], lot['uom'])}',
            style: const TextStyle(color: Brand.muted)),
        if (failed > 0)
          Text(
              '$failed characteristic(s) failed.${lot['critical_failed'] == true ? ' A critical characteristic failed — the lot can only be rejected (rule 4).' : ''}',
              style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13)),
        const Caps('Decision *'),
        RadioGroup<String>(
          groupValue: decision,
          onChanged: (v) => setS(() => decision = v ?? decision),
          child: Column(
            children: [
              for (final e in decisionLabels.entries)
                if (e.key != 'accept_with_deviation' || _isHead || decision == e.key)
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    value: e.key,
                    title: Text(e.value),
                  ),
            ],
          ),
        ),
        if (decision == 'partial') ...[
          AppTextField(
              label: 'Accepted qty',
              required: true,
              controller: acc,
              keyboardType: AppTextField.number,
              onChanged: (_) => setS(() {})),
          AppTextField(
              label: 'Rejected qty',
              required: true,
              controller: rej,
              keyboardType: AppTextField.number,
              onChanged: (_) => setS(() {})),
        ],
        if (decision == 'accept_with_deviation')
          AppTextField(
              label: 'Design / customer concession no.',
              required: true,
              controller: dev,
              onChanged: (_) => setS(() {})),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
        Text('${summary()} A decided lot can\'t be edited afterwards.',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        final payload = <String, dynamic>{
          'decision': decision,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        };
        if (decision == 'partial') {
          payload['accepted_qty'] = parseNum(acc.text, 'Accepted qty');
          payload['rejected_qty'] = parseNum(rej.text, 'Rejected qty');
        }
        if (decision == 'accept_with_deviation') payload['deviation_reference'] = dev.text;
        final r = await Api.post('$_base/decision', data: payload);
        if (r is Map && mounted) _apply(Map<String, dynamic>.from(r));
      },
    );
    if (ok && mounted) showSnack(context, 'Usage decision recorded: ${decisionLabels[decision]}.');
  }

  Future<void> _addPhotos() async {
    final lot = _lot!;
    var files = <MultipartFile>[];
    int? resultId;
    final caption = TextEditingController();
    final results = rowsOf(lot['results']);
    final ok = await showFormSheet(
      context,
      title: 'Add inspection photos',
      saveLabel: 'Add photos',
      builder: (ctx, setS) => [
        Text('${txt(lot['lot_number'])} · ${txt(lot['item_name'])}', style: const TextStyle(color: Brand.muted)),
        const Caps('Photos *'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          secondaryBtn('Take / choose photo', () async {
            final picked = await choosePhotos(ctx);
            if (picked.isNotEmpty) setS(() => files = [...files, ...picked]);
          }, icon: Icons.photo_camera_outlined),
          if (files.isNotEmpty) secondaryBtn('Clear', () => setS(() => files = []), icon: Icons.clear_rounded),
        ]),
        Text(files.isNotEmpty ? '${files.length} photo(s) selected.' : 'Images only — defects, markings or the set-up.',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
        AppSelect<int>(
          label: 'Characteristic',
          value: resultId,
          options: [for (final r in results) Option(asInt(r['id'])!, txt(r['characteristic_name']))],
          onChanged: (o) => setS(() => resultId = o?.value),
        ),
        AppTextField(label: 'Caption', controller: caption, hint: 'e.g. Crack at weld toe'),
      ],
      onSave: () async {
        if (files.isEmpty) throw 'Choose one or more photos first.';
        final form = FormData();
        for (final f in files) {
          form.files.add(MapEntry('files', f));
        }
        if (resultId != null) form.fields.add(MapEntry('result_id', '$resultId'));
        if (caption.text.trim().isNotEmpty) form.fields.add(MapEntry('caption', caption.text.trim()));
        final r = await Api.dio.post('$_base/photos',
            data: form, options: Options(contentType: 'multipart/form-data', sendTimeout: const Duration(minutes: 2)));
        if (r.data is Map && mounted) _apply(Map<String, dynamic>.from(r.data as Map));
      },
    );
    if (ok && mounted) showSnack(context, 'Photos added.');
  }

  Future<void> _removePhoto(int photoId) async {
    final yes = await confirmDialog(context,
        title: 'Remove this photo?', message: 'The photo is removed from the lot.', confirmLabel: 'Remove', danger: true);
    if (!yes) return;
    await _run(() => Api.delete('$_base/photos/$photoId'), success: 'Photo removed.');
  }

  @override
  Widget build(BuildContext context) {
    final lot = _lot;
    if (lot == null) {
      return SubPage(
        title: 'Inspection Lot',
        body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView(),
      );
    }
    final status = str(lot['status']);
    final editable = (status == 'created' || status == 'in_inspection') && _canEdit;
    final resultsEditable = editable && _canRecord;
    final results = rowsOf(lot['results']);
    final skipLot = lot['skip_lot'] == true;
    final hasPlan = lot['plan_id'] != null;
    final showResultButtons = resultsEditable && (results.isNotEmpty || (skipLot && hasPlan));
    final photos = rowsOf(lot['photos']);
    final type = lbl(inspectionTypeLabels, lot['inspection_type']);
    final fai = lot['first_article'] is Map ? Map<String, dynamic>.from(lot['first_article'] as Map) : null;
    final gate = lot['gate'] is Map ? Map<String, dynamic>.from(lot['gate'] as Map) : null;
    final failed = asInt(lot['failed_count']) ?? 0;
    final live = ['created', 'in_inspection', 'results_recorded'].contains(status);
    final photoAdd = live && Perm.canFeature('quality', 'inspection_lots', 'photos', 'create');
    final photoRemove = live && Perm.canFeature('quality', 'inspection_lots', 'photos', 'delete');

    return SubPage(
      title: txt(lot['lot_number']),
      bottom: showResultButtons
          ? BottomActions(children: [
              secondaryBtn(_busy ? 'Saving…' : 'Save results', _busy ? null : _saveResults, icon: Icons.check_rounded),
              if (status == 'in_inspection' && _canSubmitResults)
                primaryBtn('Submit for decision', _busy
                    ? null
                    : () => _run(() => Api.post('$_base/submit-results'), success: 'Results submitted for the decision.'),
                    color: const Color(0xFF2563EB), icon: Icons.send_rounded),
            ])
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            Hint('Quality · $type lot'),
            DetailSection(
              codeName(lot['item_code'], lot['item_name']),
              children: [
                Text(
                    '${fmtQty(lot['quantity'], lot['uom'])} to inspect — $type inspection from ${lbl(_sourceLabels, lot['source_type'])}'
                    '${str(lot['source_reference']).isNotEmpty ? ' ${lot['source_reference']}' : ''}.',
                    style: const TextStyle(fontSize: 13.5, color: Brand.body)),
                const SizedBox(height: 8),
                Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  qPill(lotStatusLabels, lotStatusHex, status),
                  if (str(lot['op_number']).isNotEmpty)
                    pill('${lot['op_number']}${str(lot['element_no']).isNotEmpty ? ' · ${lot['element_no']}' : ''}'
                        '${str(lot['element_label']).isNotEmpty ? ' ${lot['element_label']}' : ''}', const Color(0xFF4F46E5)),
                  Text('Lot date ${fmtDate(lot['lot_date'])} (${lot['age_days'] ?? 0} days old)',
                      style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ]),
              ],
            ),
            DetailSection('Material', children: [
              FieldRow('Vendor', lot['vendor_name']),
              FieldRow('Batch / serial', lot['batch_number']),
              FieldRow(
                  'Stock',
                  lot['stock_in_quality'] == true
                      ? 'Held in Quality stock at ${str(lot['location_name']).isEmpty ? 'store' : lot['location_name']}'
                      : 'No stock behind this lot'),
            ]),
            DetailSection('Inspection', children: [
              FieldRow('Inspection plan',
                  str(lot['plan_number']).isNotEmpty ? '${lot['plan_number']} rev ${lot['plan_revision']}' : 'No approved plan yet'),
              FieldRow('Sample size (max)', lot['sample_size']),
              if (fai != null)
                FieldRow(
                  'First article',
                  InkWell(
                    onTap: () => openScreen(context, FirstArticleDetailScreen(id: asInt(fai['id'])!)),
                    child: Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      Text(txt(fai['fai_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w700)),
                      pill(humanize(fai['status']), _faiStatusHex[str(fai['status'])]),
                      const Text('full drawing check; approve the FAI after the decision',
                          style: TextStyle(fontSize: 12, color: Brand.muted)),
                    ]),
                  ),
                ),
              if (gate != null)
                FieldRow('Production gate',
                    '${txt(gate['wo_number'])} op ${txt(gate['operation'])} — the next operation is held until this lot is decided'),
            ]),
            DetailSection('Controls', children: [
              AppSelect<String>(
                label: 'Sampling state',
                value: str(lot['sampling_severity']),
                clearable: false,
                enabled: status == 'created' && !_busy && _canEdit,
                options: [for (final e in samplingLabels.entries) Option(e.key, e.value)],
                onChanged: (o) {
                  if (o != null && o.value != lot['sampling_severity']) {
                    _run(() => Api.post('$_base/sampling', data: {'sampling_severity': o.value}));
                  }
                },
              ),
              const SizedBox(height: 12),
              AppSelect<int>(
                label: 'Inspector',
                value: asInt(lot['assigned_to_id']),
                valueLabel: str(lot['assigned_to_name']).isEmpty ? null : str(lot['assigned_to_name']),
                clearable: false,
                enabled: editable && !_busy,
                options: _users,
                onChanged: (o) {
                  if (o != null) _run(() => Api.post('$_base/assign', data: {'user_id': o.value}), success: 'Inspector assigned.');
                },
              ),
              if (lot['test_certificate_required'] == true) ...[
                const SizedBox(height: 8),
                FieldRow(
                    'Test certificate / MTC — ${lot['test_certificate_received'] == true ? 'received' : 'REQUIRED, not received'}',
                    lot['test_certificate_reference']),
                if (_canEdit && live)
                  secondaryBtn(lot['test_certificate_received'] == true ? 'Change certificate' : 'Record certificate',
                      _busy ? null : _certificate,
                      icon: Icons.description_outlined),
              ],
              ActionWrap(children: [
                if (_canEdit && status == 'created' && !hasPlan)
                  secondaryBtn('Attach approved plan', _busy ? null : () => _run(() => Api.post('$_base/refresh-plan'))),
                if (_canEdit && status == 'created')
                  primaryBtn('Start inspection', _busy ? null : () => _run(() => Api.post('$_base/start'), success: 'Inspection started.'),
                      icon: Icons.play_arrow_rounded),
                if (lot['source_type'] == 'manual' && lot['stock_in_quality'] != true && editable)
                  secondaryBtn('Cancel lot', _busy ? null : _cancelLot, color: qRed, icon: Icons.cancel_outlined),
                if (_canEdit && status == 'decision_made')
                  primaryBtn('Close lot', _busy ? null : () => _run(() => Api.post('$_base/close'), success: 'Lot closed.'),
                      icon: Icons.lock_outline_rounded),
              ]),
            ]),
            _resultsSection(lot, results, resultsEditable, skipLot, hasPlan),
            if (_seePhotos)
              DetailSection('Photos (${photos.length})', children: [
                if (photos.isEmpty)
                  Text(photoAdd ? 'No photos yet — add photos of defects, markings or the set-up.' : 'No photos were taken for this lot.',
                      style: const TextStyle(fontSize: 13, color: Brand.muted))
                else
                  Wrap(spacing: 10, runSpacing: 10, children: [
                    for (final p in photos)
                      SizedBox(
                        width: 150,
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: ApiImage('$_base/photos/${p['id']}', caption: str(p['caption'] ?? p['file_name'])),
                          ),
                          Text(str(p['caption']).isNotEmpty ? str(p['caption']) : str(p['file_name']),
                              maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                          if (p['result_id'] != null)
                            Text(
                                txt(results.firstWhere((r) => r['id'] == p['result_id'],
                                    orElse: () => <String, dynamic>{})['characteristic_name']),
                                style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                          Text(str(p['uploaded_by_name']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                          if (photoRemove)
                            InkWell(
                              onTap: () => _removePhoto(asInt(p['id'])!),
                              child: const Text('Remove', style: TextStyle(color: qRed, fontWeight: FontWeight.w600, fontSize: 12.5)),
                            ),
                        ]),
                      ),
                  ]),
                if (photoAdd) ActionWrap(children: [secondaryBtn('+ Add photos', _addPhotos, icon: Icons.add_a_photo_outlined)]),
              ]),
            if (status == 'results_recorded')
              DetailSection('Usage decision', children: [
                if (failed > 0)
                  Text(
                      '$failed characteristic(s) failed.${lot['critical_failed'] == true ? ' A critical characteristic failed — the lot can only be rejected (rule 4).' : ''}',
                      style: const TextStyle(fontSize: 13, color: Color(0xFFB91C1C))),
                if (_canDecide)
                  ActionWrap(children: [primaryBtn('Record usage decision', _busy ? null : _decide, icon: Icons.flag_outlined)])
                else
                  const Text('Results are in — waiting for a Quality engineer / head to record the usage decision.',
                      style: TextStyle(fontSize: 13, color: Brand.muted)),
              ]),
            if (lot['decision'] != null)
              DetailSection('Decision', children: [
                FieldRow('Decision', lbl(decisionLabels, lot['decision'])),
                FieldRow('Accepted → Free', fmtQty(lot['accepted_qty'], lot['uom'])),
                FieldRow('Rejected → Blocked', fmtQty(lot['rejected_qty'], lot['uom'])),
                FieldRow('Decided by', '${txt(lot['decided_by_name'])} · ${fmtDate(lot['decided_at'])}'),
                if (str(lot['deviation_reference']).isNotEmpty) FieldRow('Deviation', lot['deviation_reference']),
                if (str(lot['decision_remarks']).isNotEmpty) FieldRow('Remarks', lot['decision_remarks']),
                if (rowsOf(lot['ncrs']).isNotEmpty) ...[
                  const SizedBox(height: 6),
                  const Text('NCRs:', style: TextStyle(fontSize: 12, color: Brand.muted)),
                  for (final n in rowsOf(lot['ncrs']))
                    InkWell(
                      onTap: () => openScreen(context, NcrDetailScreen(id: asInt(n['id'])!)),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                          Text(txt(n['ncr_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w700)),
                          pill(str(n['severity']), severityHex[str(n['severity'])]),
                          qPill(ncrStatusLabels, ncrStatusHex, n['status']),
                        ]),
                      ),
                    ),
                ],
              ]),
            if (lot['decision'] != null)
              DetailSection('Documents', children: [
                RecordDocTile(
                  title: 'Inspection report',
                  hint: 'Results per characteristic, usage decision and NCRs, on the company letterhead.',
                  entityType: 'quality_inspection_report',
                  entityId: widget.id,
                  pdfPath: '/quality/records/lots/${widget.id}/inspection-report.pdf',
                  canModify: _canEdit,
                  downloadName: 'Inspection-Report-${lot['lot_number']}',
                ),
                if ((asNum(lot['accepted_qty']) ?? 0) > 0)
                  RecordDocTile(
                    title: 'Test certificate',
                    hint: 'Certifies the ${fmtQty(lot['accepted_qty'], lot['uom'])} accepted — goes to the customer with the material.',
                    entityType: 'quality_test_certificate',
                    entityId: widget.id,
                    pdfPath: '/quality/records/lots/${widget.id}/test-certificate.pdf',
                    canModify: _canEdit,
                    downloadName: 'Test-Certificate-${lot['lot_number']}',
                  ),
              ]),
          ],
        ),
      ),
    );
  }

  Widget _resultsSection(Json lot, List<Json> results, bool editable, bool skipLot, bool hasPlan) {
    return DetailSection('Results (${results.length} characteristics)', children: [
      if (skipLot)
        const Text(
            'Skip-lot: this vendor has a consistently good record (Quality → Supplier Quality), so only critical characteristics '
            '(always 100%) are checked on this lot — confirm identity, quantity and the test certificate, then submit for the decision.',
            style: TextStyle(fontSize: 12.5, color: Color(0xFF0F766E))),
      if (results.isEmpty && !(skipLot && hasPlan))
        Text(
            'No approved inspection plan is attached. A Quality engineer must create and a Quality head approve a '
            '${lbl(inspectionTypeLabels, lot['inspection_type'])} plan for this item (Quality → Inspection Plans), then use “Attach approved plan”.',
            style: const TextStyle(fontSize: 13, color: Brand.muted)),
      for (final r in results) _resultCard(r, editable),
      if (str(lot['results_recorded_by_name']).isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text('Results submitted by ${lot['results_recorded_by_name']}.',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
        ),
      if (!skipLot && results.isNotEmpty && editable)
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text(
              'Measured values: separate several readings with commas or spaces. “Save results” keeps them; '
              '“Submit for decision” sends the lot to the usage decision.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ),
    ]);
  }

  Widget _resultCard(Json r, bool editable) {
    final d = _drafts[asInt(r['id'])]!;
    final variable = r['char_type'] == 'variable';
    final result = r['result'];
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
            color: result == 'fail' ? qRed.withValues(alpha: 0.5) : (result == 'pass' ? qGreen.withValues(alpha: 0.4) : Brand.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(txt(r['characteristic_name']),
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: Brand.heading)),
                if (str(r['method']).isNotEmpty)
                  Text(str(r['method']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
              ]),
            ),
            pill(str(r['classification']), severityHex[str(r['classification'])]),
            const SizedBox(width: 6),
            result == null
                ? const Text('Pending', style: TextStyle(fontSize: 12, color: Brand.muted))
                : pill(result == 'pass' ? 'Pass' : 'Fail', result == 'pass' ? qGreen : qRed),
          ]),
          const SizedBox(height: 6),
          KvRow('Spec', _limits(r)),
          KvRow('Sample n / Ac / Re',
              '${r['sample_size']} / ${r['accept_number']} / ${r['reject_number']}${r['aql'] != null ? '  (AQL ${r['aql']})' : ''}'),
          if (!editable) ...[
            if (variable)
              KvRow('Measured values',
                  (r['measured_values'] is List && (r['measured_values'] as List).isNotEmpty)
                      ? (r['measured_values'] as List).map(_numStr).join(', ')
                      : '—'),
            KvRow('Defective', txt(r['defects_found'])),
            KvRow('Defect code', txt(r['defect_code_label'])),
            KvRow('Gauge', txt(r['gauge_reference'])),
            KvRow('Remarks', txt(r['remarks'])),
          ] else ...[
            const SizedBox(height: 8),
            if (variable) ...[
              AppTextField(
                  label: 'Measured values',
                  controller: d.values,
                  hint: 'e.g. 50.01, 49.98',
                  keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true)),
              const SizedBox(height: 10),
            ],
            AppTextField(
              label: variable ? 'Defective (extra, go/no-go)' : 'Defective units found',
              controller: d.defects,
              hint: variable ? 'extra' : '0',
              keyboardType: TextInputType.number,
            ),
            if (!variable)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Wrap(spacing: 6, children: [
                  ActionChip(
                    label: const Text('0 — all OK'),
                    onPressed: () => setState(() => d.defects.text = '0'),
                  ),
                ]),
              ),
            const SizedBox(height: 10),
            AppSelect<int>(
              label: 'Defect code (needed if it fails)',
              value: d.defectCodeId,
              valueLabel: d.defectCodeLabel,
              options: _codes,
              onChanged: (o) => setState(() {
                d.defectCodeId = o?.value;
                d.defectCodeLabel = o?.label;
              }),
            ),
            const SizedBox(height: 10),
            AppSelect<int>(
              label: 'Gauge',
              value: d.gaugeId,
              valueLabel: d.gaugeRef.isEmpty ? null : d.gaugeRef,
              options: _gauges,
              onChanged: (o) => setState(() {
                d.gaugeId = o?.value;
                d.gaugeRef = o?.subtitle ?? '';
              }),
            ),
            const SizedBox(height: 10),
            AppTextField(label: 'Remarks', controller: d.remarks),
          ],
          if (str(r['recorded_by_name']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(str(r['recorded_by_name']), style: const TextStyle(fontSize: 11, color: Brand.muted)),
            ),
        ],
      ),
    );
  }
}
