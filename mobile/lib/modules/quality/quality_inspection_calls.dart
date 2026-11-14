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
import 'quality_common.dart';
import 'quality_ncr.dart';

/// Customer / Third-party Inspection (portal inspection-calls/page.tsx with
/// its three tabs, new, [id]).

const _statusLabels = <String, String>{
  'requested': 'Requested',
  'scheduled': 'Scheduled',
  'accepted': 'Accepted',
  'partially_accepted': 'Partly accepted',
  'rejected': 'Rejected',
  'cancelled': 'Cancelled',
};
const _statusHex = <String, Color>{
  'requested': Color(0xFF78716C),
  'scheduled': Color(0xFF2563EB),
  'accepted': Color(0xFF16A34A),
  'partially_accepted': Color(0xFFF59E0B),
  'rejected': Color(0xFFDC2626),
  'cancelled': Color(0xFFA8A29E),
};
const _resultLabels = <String, String>{
  'accepted': 'Accepted',
  'partially_accepted': 'Partly accepted',
  'rejected': 'Rejected',
};

Future<List<Option<String>>> _agencies() async {
  final m = await Api.get('/quality/inspection-calls/meta');
  return [for (final a in rowsOf(m is Map ? m['agencies'] : null)) Option(str(a['value']), txt(a['label']))];
}

Future<List<Json>> _contracts([Map<String, dynamic>? query]) async =>
    rowsOf(await Api.get('/quality/inspection-calls/contracts', query: query));

class InspectionCallsTab extends StatefulWidget {
  const InspectionCallsTab({super.key});

  @override
  State<InspectionCallsTab> createState() => _InspectionCallsTabState();
}

class _InspectionCallsTabState extends State<InspectionCallsTab> {
  String _tab = 'calls';
  final _callsKey = GlobalKey<_CallsListState>();

  Future<void> _new() async {
    final c = await _showNewCallForm(context);
    if (c != null && mounted) {
      _callsKey.currentState?.reload();
      openScreen(context, InspectionCallDetailScreen(id: asInt(c['id'])!));
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = Perm.can('quality', 'inspection_calls', 'create');
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: canCreate && _tab == 'calls' ? CreateFab(label: 'New Call', onPressed: _new) : null,
      body: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const PageHeader('Customer / Third-party Inspection', subtitle: 'Quality Module'),
        ChipRow(children: [
          for (final t in const [
            ('calls', 'Inspection calls'),
            ('contracts', 'Contract requirements'),
            ('dispatch', 'Dispatch check'),
          ])
            CountChip(t.$2, null, selected: _tab == t.$1, onTap: () => setState(() => _tab = t.$1)),
        ]),
        Expanded(
          child: switch (_tab) {
            'contracts' => _ContractsList(canApprove: Perm.can('quality', 'inspection_calls', 'approve')),
            'dispatch' => const _DispatchCheck(),
            _ => _CallsList(key: _callsKey),
          },
        ),
      ]),
    );
  }
}

// ── Inspection calls list ────────────────────────────────────────────────────

class _CallsList extends StatefulWidget {
  const _CallsList({super.key});

  @override
  State<_CallsList> createState() => _CallsListState();
}

class _CallsListState extends State<_CallsList> {
  String _status = '';
  String? _op;
  String? _opLabel;
  final _listKey = GlobalKey<ApiListViewState>();

  void reload() => _listKey.currentState?.reload();

  @override
  Widget build(BuildContext context) {
    final (pid, eid) = splitProjectUnit(_op);
    return ApiListView(
      key: _listKey,
      searchHint: 'Search call, item, order, certificate…',
      load: (page, search) => Api.list('/quality/inspection-calls', query: {
        'status': _status,
        'search': search,
        'order_project_element_id': ?eid,
        'order_project_id': eid == null ? pid : null,
      }),
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        FilterSelect(
          label: 'Status',
          allLabel: 'All statuses',
          value: _status,
          options: _statusLabels,
          onChanged: (v) {
            setState(() => _status = v);
            reload();
          },
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: AppSelect<String>(
            label: 'Project — Unit (All projects)',
            value: _op,
            valueLabel: _opLabel,
            loadOptions: loadProjectUnits,
            onChanged: (o) {
              setState(() {
                _op = o?.value;
                _opLabel = o?.label;
              });
              reload();
            },
          ),
        ),
      ]),
      emptyText: 'No inspection calls yet.',
      itemBuilder: (ctx, c, reload) {
        final days = asInt(c['days_to_call']);
        final soon = days != null && days <= 2;
        return RecordCard(
          code: str(c['call_number']),
          title: codeName(c['item_code'], c['item_name']),
          subtitle: [
            str(c['order_reference']),
            str(c['project_label']).isNotEmpty ? str(c['project_label']) : str(c['customer_name']),
            if (str(c['op_number']).isNotEmpty) '${c['op_number']}${str(c['element_no']).isNotEmpty ? ' · ${c['element_no']}' : ''}',
          ].where((s) => s.isNotEmpty).join(' · '),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: qPill(_statusLabels, _statusHex, c['status'])),
          meta: [
            ('Agency', str(c['agency_label']).isNotEmpty ? str(c['agency_label']) : txt(c['agency'])),
            ('Qty', fmtQty(c['quantity'], c['uom'])),
            ('Call date', '${fmtDate(c['call_date'])}${soon ? ' · soon' : ''}'),
            ('Inspector', txt(c['inspector_name'])),
            ('Certificate', txt(c['certificate_number'])),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => InspectionCallDetailScreen(id: asInt(c['id'])!)));
            reload();
          },
        );
      },
    );
  }
}

// ── Contract requirements ────────────────────────────────────────────────────

class _ContractsList extends StatefulWidget {
  const _ContractsList({required this.canApprove});
  final bool canApprove;

  @override
  State<_ContractsList> createState() => _ContractsListState();
}

class _ContractsListState extends State<_ContractsList> {
  bool _requiredOnly = false;
  List<Option<String>> _agencyOpts = [];
  final _listKey = GlobalKey<ApiListViewState>();

  @override
  void initState() {
    super.initState();
    _agencies().then((a) {
      if (mounted) setState(() => _agencyOpts = a);
    }).catchError((_) {});
  }

  Future<void> _save(Json c, bool required, String agency) async {
    final ok = await runAction(
      context,
      () => Api.put('/quality/inspection-calls/contracts/${c['id']}',
          data: {'third_party_inspection_required': required, 'inspection_agency': agency.isEmpty ? null : agency}),
      success: 'Saved for ${txt(c['label'])}.',
    );
    if (ok) _listKey.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return ApiListView(
      key: _listKey,
      searchHint: 'Search serial, PO, customer…',
      load: (page, search) async =>
          ApiPage(await _contracts({'required_only': _requiredOnly, 'search': search})),
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Hint('Customer machines / orders (ERP). Ticking “Third-party inspection” means finished goods for that order '
            'can\'t be dispatched until an inspection call by the agency is accepted with a certificate number (rule 8). '
            'Only a Quality head can change it.'),
        ChipRow(children: [
          CountChip('Only contracts needing inspection', null, selected: _requiredOnly, onTap: () {
            setState(() => _requiredOnly = !_requiredOnly);
            _listKey.currentState?.reload();
          }),
        ]),
      ]),
      emptyText: 'No ERP machines / orders found.',
      itemBuilder: (ctx, c, reload) {
        final req = c['third_party_inspection_required'] == true;
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(txt(c['label']), style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                KvRow('Customer PO', txt(c['po_number'])),
                KvRow('Delivery', fmtDate(c['delivery_date'])),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Third-party inspection', style: TextStyle(fontSize: 14)),
                  value: req,
                  onChanged: widget.canApprove
                      ? (v) => _save(c, v, str(c['inspection_agency']).isNotEmpty
                          ? str(c['inspection_agency'])
                          : (_agencyOpts.isNotEmpty ? _agencyOpts.first.value : ''))
                      : null,
                ),
                AppSelect<String>(
                  label: 'Agency',
                  value: str(c['inspection_agency']).isEmpty ? null : str(c['inspection_agency']),
                  valueLabel: str(c['inspection_agency_label']).isEmpty ? null : str(c['inspection_agency_label']),
                  enabled: widget.canApprove && req,
                  options: _agencyOpts,
                  onChanged: (o) => _save(c, true, o?.value ?? ''),
                ),
              ]),
            ),
          ),
        );
      },
    );
  }
}

// ── Dispatch check ───────────────────────────────────────────────────────────

class _DispatchCheck extends StatefulWidget {
  const _DispatchCheck();

  @override
  State<_DispatchCheck> createState() => _DispatchCheckState();
}

class _DispatchCheckState extends State<_DispatchCheck> {
  int? _itemId;
  String? _itemLabel;
  final _qty = TextEditingController(text: '1');
  final _batch = TextEditingController();
  int? _contractId;
  List<Option<int>> _contractOpts = [];
  Json? _result;
  String _error = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _contracts().then((c) {
      if (mounted) setState(() => _contractOpts = [for (final x in c) Option(asInt(x['id'])!, txt(x['label']))]);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _qty.dispose();
    _batch.dispose();
    super.dispose();
  }

  Future<void> _check() async {
    setState(() {
      _error = '';
      _result = null;
    });
    if (_itemId == null) {
      setState(() => _error = 'Pick the item to check.');
      return;
    }
    setState(() => _busy = true);
    try {
      final r = await Api.post('/quality/inspection-calls/dispatch-check', data: {
        'item_id': _itemId,
        'quantity': num.tryParse(_qty.text.trim()) ?? 0,
        'batch_number': _batch.text.trim().isEmpty ? null : _batch.text.trim(),
        'erp_project_id': _contractId,
      });
      if (mounted) setState(() => _result = r is Map ? Map<String, dynamic>.from(r) : null);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    final allowed = r?['allowed'] == true;
    return ListView(padding: const EdgeInsets.only(top: 8, bottom: 32), children: [
      DetailSection('Can this be dispatched?', children: [
        const Text(
            'Same check Store runs on a “Dispatch to customer” material issue: a decided final inspection for the batch, '
            'and the contract\'s third-party certificate where required.',
            style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        const SizedBox(height: 12),
        if (_error.isNotEmpty) ...[ErrorBanner(_error), const SizedBox(height: 12)],
        AppSelect<int>(
          label: 'Item',
          required: true,
          value: _itemId,
          valueLabel: _itemLabel,
          loadOptions: loadQualityItems,
          onChanged: (o) => setState(() {
            _itemId = o?.value;
            _itemLabel = o?.label;
          }),
        ),
        const SizedBox(height: 12),
        AppTextField(label: 'Quantity', controller: _qty, keyboardType: AppTextField.number),
        const SizedBox(height: 12),
        AppTextField(label: 'Batch / serial', controller: _batch),
        const SizedBox(height: 12),
        AppSelect<int>(
          label: 'Machine / order',
          value: _contractId,
          options: _contractOpts,
          onChanged: (o) => setState(() => _contractId = o?.value),
        ),
        ActionWrap(children: [primaryBtn(_busy ? 'Checking…' : 'Check', _busy ? null : _check, icon: Icons.fact_check_outlined)]),
        if (r != null)
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              color: (allowed ? qGreen : qRed).withValues(alpha: 0.08),
              border: Border.all(color: Brand.border),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (allowed)
                const Text('Cleared for dispatch.', style: TextStyle(color: Color(0xFF15803D)))
              else
                for (final p in (r['problems'] is List ? r['problems'] as List : const []))
                  Text('$p', style: const TextStyle(color: Color(0xFFB91C1C))),
            ]),
          ),
      ]),
    ]);
  }
}

// ── New call (inspection-calls/new/page.tsx) ─────────────────────────────────

Future<Json?> _showNewCallForm(BuildContext context) async {
  List<Json> contracts = [];
  List<Option<String>> agencies = [];
  try {
    final r = await Future.wait([_contracts(), _agencies()]);
    contracts = r[0] as List<Json>;
    agencies = r[1] as List<Option<String>>;
  } catch (_) {}
  if (!context.mounted) return null;
  String? op;
  String? opLabel;
  Json? req;
  var reqError = '';
  int? contractId;
  final orderRef = TextEditingController();
  final customer = TextEditingController();
  int? itemId;
  String? itemLabel;
  String? itemUom;
  final qty = TextEditingController();
  final batch = TextEditingController();
  int? lotId;
  List<Json> lots = [];
  String? agency;
  DateTime? requested = DateTime.now();
  DateTime? callDate;
  final inspector = TextEditingController();
  final remarks = TextEditingController();
  Json? created;

  Json? contractOf(int? id) => contracts.where((c) => asInt(c['id']) == id).firstOrNull;

  Future<void> loadReq(StateSetter setS) async {
    final (pid, eid) = splitProjectUnit(op);
    if (pid == null) return;
    try {
      final r = await Api.get('/quality/inspection-calls/order-project-requirement',
          query: {'element_id': eid, 'project_id': pid});
      final m = r is Map ? Map<String, dynamic>.from(r) : <String, dynamic>{};
      setS(() {
        req = m;
        reqError = '';
        agency = str(m['agency']).isEmpty ? null : str(m['agency']);
      });
    } catch (e) {
      setS(() {
        req = null;
        reqError = ApiClient.describe(e);
      });
    }
  }

  Future<void> loadLots(StateSetter setS) async {
    if (itemId == null) return;
    try {
      final r = rowsOf(await Api.get('/quality/inspection-lots', query: {'status': 'decision_made'}));
      setS(() => lots = r
          .where((l) =>
              asInt(l['item_id']) == itemId &&
              (asNum(l['accepted_qty']) ?? 0) > 0 &&
              ['final', 'first_article'].contains(l['inspection_type']))
          .toList());
    } catch (_) {
      setS(() => lots = []);
    }
  }

  String reqHint() {
    final r = req;
    if (r == null) return '';
    final calls = rowsOf(r['calls']);
    final base = str(r['agency']).isNotEmpty
        ? '${str(r['agency_label']).isNotEmpty ? r['agency_label'] : r['agency']} inspection${r['required'] == true ? ' required before dispatch' : ''} — from Sales Order ${txt(r['so_number'])}.'
        : 'Sales Order ${txt(r['so_number'])} has no inspecting agency — no third-party inspection is due. Ask Sales to amend the order if the customer now wants one.';
    final extra = calls.isEmpty
        ? ''
        : ' Calls already raised for this vehicle / lot: ${calls.map((c) => '${c['call_number']} (${str(c['status']).replaceAll('_', ' ')})').join(', ')}.';
    return base + extra;
  }

  final ok = await showFormSheet(
    context,
    title: 'New Inspection Call',
    saveLabel: 'Raise Call',
    builder: (ctx, setS) {
      final contract = contractOf(contractId);
      return [
        const Text('Offer material to the customer\'s / third-party inspector (RITES, RDSO, customer).',
            style: TextStyle(fontSize: 13, color: Brand.muted)),
        const Caps('Order'),
        AppSelect<String>(
          label: 'Project — Unit (vehicle / lot)',
          value: op,
          valueLabel: opLabel,
          loadOptions: loadProjectUnits,
          onChanged: (o) {
            setS(() {
              op = o?.value;
              opLabel = o?.label;
              req = null;
              reqError = '';
            });
            loadReq(setS);
          },
        ),
        if (reqError.isNotEmpty) Text(reqError, style: const TextStyle(fontSize: 12, color: Color(0xFFB91C1C))),
        if (op != null && req != null)
          Text(reqHint(),
              style: TextStyle(
                  fontSize: 12,
                  color: str(req!['agency']).isNotEmpty
                      ? (req!['required'] == true ? const Color(0xFFB45309) : Brand.body)
                      : const Color(0xFFB91C1C))),
        AppSelect<int>(
          label: 'Machine / order (ERP)',
          value: contractId,
          options: [
            for (final c in contracts)
              Option(asInt(c['id'])!,
                  '${txt(c['label'])}${c['third_party_inspection_required'] == true ? ' · inspection required' : ''}'),
          ],
          onChanged: (o) => setS(() {
            contractId = o?.value;
            final c = contractOf(contractId);
            agency ??= str(c?['inspection_agency']).isEmpty ? null : str(c?['inspection_agency']);
          }),
        ),
        AppTextField(
            label: 'Customer order ref.',
            controller: orderRef,
            hint: str(req?['order_reference']).isNotEmpty
                ? str(req?['order_reference'])
                : (str(contract?['po_number']).isNotEmpty ? str(contract?['po_number']) : 'PO / contract no.')),
        AppTextField(
            label: 'Customer',
            controller: customer,
            hint: str(req?['customer_name']).isNotEmpty ? str(req?['customer_name']) : str(contract?['client_company'])),
        Text(
            op != null
                ? 'Order reference and customer default from the Sales Order when left blank.'
                : contract != null
                    ? (contract['third_party_inspection_required'] == true
                        ? 'This contract needs ${str(contract['inspection_agency_label']).isNotEmpty ? contract['inspection_agency_label'] : contract['inspection_agency']} inspection before dispatch.'
                        : 'This contract has no third-party inspection requirement — the call is for the record.')
                    : 'Pick the Project unit (vehicle / lot), the ERP machine / order, or type the customer order reference.',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
        const Caps('Material offered'),
        AppSelect<int>(
          label: 'Item',
          required: true,
          value: itemId,
          valueLabel: itemLabel,
          loadOptions: loadQualityItems,
          onChanged: (o) {
            setS(() {
              itemId = o?.value;
              itemLabel = o?.label;
              itemUom = o?.subtitle;
              lotId = null;
              lots = [];
            });
            loadLots(setS);
          },
        ),
        AppTextField(
            label: 'Quantity${itemUom != null ? ' ($itemUom)' : ''}',
            required: true,
            controller: qty,
            keyboardType: AppTextField.number),
        AppTextField(label: 'Batch / serial', controller: batch),
        AppSelect<int>(
          label: 'Our final inspection lot',
          value: lotId,
          options: [
            for (final l in lots)
              Option(asInt(l['id'])!, '${txt(l['lot_number'])} · ${str(l['batch_number'])} · ${fmtQty(l['accepted_qty'])} accepted'),
          ],
          onChanged: (o) => setS(() {
            lotId = o?.value;
            final l = lots.where((x) => asInt(x['id']) == lotId).firstOrNull;
            if (batch.text.isEmpty && l != null) batch.text = str(l['batch_number']);
          }),
        ),
        const Caps('Call'),
        if (op != null)
          FieldRow(
              'Agency *',
              str(req?['agency']).isNotEmpty
                  ? '${str(req?['agency_label']).isNotEmpty ? req!['agency_label'] : req!['agency']} · from Sales Order ${req!['so_number']}'
                  : (req != null ? 'None on the Sales Order' : 'Reading the Sales Order…'))
        else
          AppSelect<String>(
            label: 'Agency',
            required: true,
            value: agency,
            options: agencies,
            onChanged: (o) => setS(() => agency = o?.value),
          ),
        DateField(label: 'Call raised on', value: requested, onChanged: (d) => setS(() => requested = d)),
        DateField(label: 'Inspection date', value: callDate, onChanged: (d) => setS(() => callDate = d)),
        AppTextField(label: 'Inspector', controller: inspector),
        const Caps('Remarks'),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      ];
    },
    onSave: () async {
      final contract = contractOf(contractId);
      if (op == null && contractId == null && orderRef.text.trim().isEmpty) {
        throw 'Pick the Project unit (vehicle / lot), or the ERP machine / order, or type the customer order reference.';
      }
      if (op != null && req != null && str(req!['agency']).isEmpty) {
        throw 'Sales Order ${txt(req!['so_number'])} has no inspecting agency, so no third-party inspection is due for '
            '${txt(req!['op_number'])}. Ask Sales to amend the order\'s inspection agency first.';
      }
      if (itemId == null) throw 'Pick the item offered for inspection.';
      final q = num.tryParse(qty.text.trim());
      if (q == null || q <= 0) throw 'Enter the quantity offered for inspection.';
      if (op == null && agency == null && str(contract?['inspection_agency']).isEmpty) throw 'Pick the inspecting agency.';
      final (pid, eid) = splitProjectUnit(op);
      String? opt(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
      final r = await Api.post('/quality/inspection-calls', data: {
        'order_project_id': pid,
        'order_project_element_id': eid,
        'erp_project_id': contractId,
        'order_reference': opt(orderRef),
        'customer_name': opt(customer),
        'item_id': itemId,
        'quantity': q,
        'batch_number': opt(batch),
        'lot_id': lotId,
        'agency': agency,
        'requested_date': requested == null ? null : apiDate(requested!),
        'call_date': callDate == null ? null : apiDate(callDate!),
        'inspector_name': opt(inspector),
        'remarks': opt(remarks),
      });
      created = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? created : null;
}

// ── Call detail (inspection-calls/[id]/page.tsx) ─────────────────────────────

class InspectionCallDetailScreen extends StatefulWidget {
  const InspectionCallDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<InspectionCallDetailScreen> createState() => _InspectionCallDetailScreenState();
}

class _InspectionCallDetailScreenState extends State<InspectionCallDetailScreen> {
  Json? _call;
  Object? _error;
  bool _busy = false;
  List<Option<int>> _locations = [];

  String get _base => '/quality/inspection-calls/${widget.id}';
  bool get _canEdit => Perm.can('quality', 'inspection_calls', 'edit');

  @override
  void initState() {
    super.initState();
    _load();
    Api.get('/quality/masters/locations').then((r) {
      if (mounted) {
        setState(() => _locations = [
              for (final l in rowsOf(r)) Option(asInt(l['id'])!, '${txt(l['code'])} — ${txt(l['name'])}'),
            ]);
      }
    }).catchError((_) {});
  }

  Future<void> _load() async {
    try {
      final r = await Api.get(_base);
      if (mounted) {
        setState(() {
          _call = Map<String, dynamic>.from(r as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _set(dynamic r) {
    if (r is Map && mounted) setState(() => _call = Map<String, dynamic>.from(r));
  }

  String _agencyName(Json c) => str(c['agency_label']).isNotEmpty ? str(c['agency_label']) : str(c['agency']);

  Future<void> _schedule() async {
    final c = _call!;
    DateTime? date = parseDate(c['call_date']);
    final inspector = TextEditingController(text: str(c['inspector_name']));
    final re = c['status'] == 'scheduled';
    final ok = await showFormSheet(
      context,
      title: re ? 'Reschedule inspection' : 'Schedule inspection',
      saveLabel: re ? 'Reschedule' : 'Schedule',
      builder: (ctx, setS) => [
        Text('${txt(c['call_number'])} · ${_agencyName(c)}', style: const TextStyle(color: Brand.muted)),
        DateField(label: 'Inspection date', required: true, value: date, onChanged: (d) => setS(() => date = d)),
        AppTextField(label: 'Inspector', controller: inspector, hint: 'Name of the agency\'s inspector'),
      ],
      onSave: () async {
        if (date == null) throw 'Pick the inspection date.';
        _set(await Api.post('$_base/schedule', data: {
          'call_date': apiDate(date!),
          'inspector_name': inspector.text.trim().isEmpty ? null : inspector.text.trim(),
        }));
      },
    );
    if (ok && mounted) showSnack(context, re ? 'Inspection rescheduled.' : 'Inspection scheduled.');
  }

  Future<void> _result() async {
    final c = _call!;
    var result = 'accepted';
    final acc = TextEditingController();
    final rej = TextEditingController();
    final cert = TextEditingController();
    DateTime? resultDate;
    final remarks = TextEditingController();
    int? location;
    var severity = 'major';
    final ok = await showFormSheet(
      context,
      title: 'Record inspection result',
      saveLabel: 'Record',
      builder: (ctx, setS) {
        final rejecting = result != 'accepted';
        return [
          Text('${txt(c['call_number'])} · ${txt(c['item_name'])} · ${fmtQty(c['quantity'], c['uom'])}',
              style: const TextStyle(color: Brand.muted)),
          const Caps('Result'),
          RadioGroup<String>(
            groupValue: result,
            onChanged: (v) => setS(() => result = v ?? result),
            child: Column(children: [
              for (final e in _resultLabels.entries)
                RadioListTile<String>(contentPadding: EdgeInsets.zero, dense: true, value: e.key, title: Text(e.value)),
            ]),
          ),
          if (result == 'partially_accepted') ...[
            AppTextField(label: 'Accepted qty', required: true, controller: acc, keyboardType: AppTextField.number),
            AppTextField(label: 'Rejected qty', required: true, controller: rej, keyboardType: AppTextField.number),
          ],
          if (result != 'rejected')
            AppTextField(label: 'Certificate / release note no.', required: true, controller: cert),
          DateField(label: 'Inspected on', value: resultDate, onChanged: (d) => setS(() => resultDate = d)),
          if (rejecting) ...[
            const Caps('Rejected quantity', color: qRed),
            AppSelect<String>(
              label: 'NCR severity',
              value: severity,
              clearable: false,
              options: const [Option('minor', 'Minor'), Option('major', 'Major'), Option('critical', 'Critical')],
              onChanged: (o) => setS(() => severity = o?.value ?? severity),
            ),
            AppSelect<int>(
              label: 'Block rejected stock in store',
              value: location,
              options: [const Option<int>(0, 'Don\'t block (not in a store)'), ..._locations],
              onChanged: (o) => setS(() => location = (o?.value == 0) ? null : o?.value),
            ),
          ],
          AppTextField(
              label: rejecting ? 'Why the agency rejected it' : 'Remarks',
              required: rejecting,
              controller: remarks,
              maxLines: 3),
          Text(
              '${rejecting ? 'The rejected quantity gets an NCR. ' : ''}'
              '${result != 'rejected' ? 'The accepted quantity is released for dispatch against this certificate. ' : ''}'
              'A recorded result can\'t be changed.',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
        ];
      },
      onSave: () async {
        final payload = <String, dynamic>{
          'result': result,
          'certificate_number': cert.text.trim().isEmpty ? null : cert.text.trim(),
          'result_date': resultDate == null ? null : apiDate(resultDate!),
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
          'location_id': location,
          'severity': severity,
          'inspector_name': str(c['inspector_name']).trim().isEmpty ? null : str(c['inspector_name']).trim(),
        };
        if (result == 'partially_accepted') {
          payload['accepted_qty'] = parseNum(acc.text, 'Accepted qty');
          payload['rejected_qty'] = parseNum(rej.text, 'Rejected qty');
        }
        _set(await Api.post('$_base/result', data: payload));
      },
    );
    if (ok && mounted) showSnack(context, 'Result recorded: ${_resultLabels[result]}.');
  }

  Future<void> _cancel() async {
    final reason = await promptDialog(context,
        title: 'Cancel this inspection call?',
        message: 'Give the reason (e.g. agency postponed indefinitely, order changed).',
        confirmLabel: 'Cancel call');
    if (reason == null || !mounted) return;
    await _guard(() async => _set(await Api.post('$_base/cancel', data: {'reason': reason})), 'Call cancelled.');
  }

  Future<void> _guard(Future<void> Function() fn, String success) async {
    setState(() => _busy = true);
    await runAction(context, fn, success: success);
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _attach() async {
    final how = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: const Text('Choose PDF / scan'),
              onTap: () => Navigator.pop(ctx, 'file')),
          ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take photo of the certificate'),
              onTap: () => Navigator.pop(ctx, 'camera')),
        ]),
      ),
    );
    if (how == null) return;
    MultipartFile? f;
    try {
      f = how == 'camera'
          ? await Files.takePhoto()
          : await Files.pickFile(extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic']);
    } catch (e) {
      if (mounted) showSnack(context, 'Could not get the file. ${ApiClient.describe(e)}', error: true);
      return;
    }
    if (f == null || !mounted) return;
    final file = f;
    await _guard(() async {
      final form = FormData()..files.add(MapEntry('file', file));
      final r = await Api.dio.post('$_base/certificate',
          data: form, options: Options(contentType: 'multipart/form-data', sendTimeout: const Duration(minutes: 2)));
      _set(r.data);
    }, 'Certificate attached.');
  }

  @override
  Widget build(BuildContext context) {
    final c = _call;
    if (c == null) {
      return SubPage(title: 'Inspection Call', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final status = str(c['status']);
    final open = status == 'requested' || status == 'scheduled';
    final agency = _agencyName(c);
    final days = asInt(c['days_to_call']);
    return SubPage(
      title: txt(c['call_number']),
      bottom: open && _canEdit
          ? BottomActions(children: [primaryBtn('Record result', _busy ? null : _result, icon: Icons.flag_outlined)])
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            Hint('Quality · $agency inspection call'),
            DetailSection(codeName(c['item_code'], c['item_name']), children: [
              Text(
                  '${fmtQty(c['quantity'], c['uom'])} offered to $agency for inspection'
                  '${str(c['customer_name']).isNotEmpty ? ' for ${c['customer_name']}' : ''}.',
                  style: const TextStyle(fontSize: 13.5)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                qPill(_statusLabels, _statusHex, status),
                if (str(c['op_number']).isNotEmpty)
                  pill('${c['op_number']}${str(c['element_no']).isNotEmpty ? ' · ${c['element_no']}' : ''}'
                      '${str(c['element_label']).isNotEmpty ? ' ${c['element_label']}' : ''}', const Color(0xFF4F46E5)),
                Text(
                    'Raised ${fmtDate(c['requested_date'])}${str(c['created_by_name']).isNotEmpty ? ' by ${c['created_by_name']}' : ''}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
                Text(
                    c['call_date'] != null
                        ? 'Inspection ${fmtDate(c['call_date'])}${days != null ? ' (in $days days)' : ''}'
                        : 'Inspection date not fixed yet',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
              if (open && _canEdit)
                ActionWrap(children: [
                  secondaryBtn(status == 'scheduled' ? 'Reschedule' : 'Schedule', _busy ? null : _schedule,
                      icon: Icons.event_outlined),
                  secondaryBtn('Cancel call', _busy ? null : _cancel, color: qRed, icon: Icons.cancel_outlined),
                ]),
            ]),
            DetailSection('Order', children: [
              FieldRow('Order', c['order_reference']),
              FieldRow('Machine / contract', c['project_label']),
              FieldRow('Customer', c['customer_name']),
              if (str(c['so_number']).isNotEmpty)
                FieldRow('Sales order',
                    '${c['so_number']}${c['so_third_party_inspection_required'] == true ? ' (inspection required before dispatch)' : ''}'),
            ]),
            DetailSection('Inspection', children: [
              FieldRow('Agency', agency),
              FieldRow('Inspector', c['inspector_name']),
              FieldRow('Batch / serial', c['batch_number']),
              FieldRow('Our final lot', c['lot_number']),
              if (str(c['remarks']).isNotEmpty) FieldRow('Remarks', c['remarks']),
            ]),
            if (open)
              DetailSection('Result', children: [
                Text(
                    'Waiting for the $agency inspection${c['call_date'] != null ? ' on ${fmtDate(c['call_date'])}' : ''}.',
                    style: const TextStyle(fontSize: 13, color: Brand.muted)),
              ])
            else if (status != 'cancelled')
              DetailSection('Result', children: [
                FieldRow('Result', lbl(_statusLabels, status)),
                FieldRow('Accepted', fmtQty(c['accepted_qty'], c['uom'])),
                FieldRow('Rejected', fmtQty(c['rejected_qty'], c['uom'])),
                FieldRow('Certificate no.', c['certificate_number']),
                FieldRow('Inspected on', fmtDate(c['result_date'])),
                FieldRow('Recorded by', c['result_recorded_by_name']),
                if (str(c['result_remarks']).isNotEmpty) FieldRow('Remarks', c['result_remarks']),
                if (c['ncr_id'] != null)
                  FieldRow(
                      'NCR for the rejected quantity',
                      InkWell(
                        onTap: () => openScreen(context, NcrDetailScreen(id: asInt(c['ncr_id'])!)),
                        child: Text(txt(c['ncr_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w700)),
                      )),
              ]),
            if (status != 'cancelled')
              DetailSection('Agency certificate', children: [
                if (str(c['certificate_file_name']).isNotEmpty)
                  InkWell(
                    onTap: () => runAction(context, () => Files.downloadAndOpen('$_base/certificate', str(c['certificate_file_name']))),
                    child: Text(str(c['certificate_file_name']),
                        style: const TextStyle(color: Color(0xFF2563EB), fontWeight: FontWeight.w600)),
                  )
                else
                  const Text('No certificate file attached.', style: TextStyle(fontSize: 13, color: Brand.muted)),
                if (_canEdit && (open || str(c['certificate_file_name']).isEmpty))
                  ActionWrap(children: [
                    secondaryBtn('Attach certificate (PDF / scan)', _busy ? null : _attach, icon: Icons.upload_file_rounded),
                  ]),
              ]),
          ],
        ),
      ),
    );
  }
}
