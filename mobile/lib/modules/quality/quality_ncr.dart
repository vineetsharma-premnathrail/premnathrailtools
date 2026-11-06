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

/// NCR register (portal ncr/page.tsx).
class NcrTab extends StatefulWidget {
  const NcrTab({super.key});

  @override
  State<NcrTab> createState() => _NcrTabState();
}

class _NcrTabState extends State<NcrTab> {
  String _status = '';
  String _severity = '';
  bool _mine = false;
  final _listKey = GlobalKey<ApiListViewState>();

  void _reload() => _listKey.currentState?.reload();

  Future<void> _new() async {
    final n = await showNewNcrForm(context);
    if (n != null && mounted) {
      _reload();
      openScreen(context, NcrDetailScreen(id: asInt(n['id'])!));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton:
          Perm.can('quality', 'ncr', 'create') ? CreateFab(label: 'New NCR', onPressed: _new) : null,
      body: ApiListView(
        key: _listKey,
        searchHint: 'Search NCR number, item, vendor, description…',
        load: (page, search) => Api.list('/quality/ncr', query: {
          if (_status == 'live') 'open_only': true else 'status': _status,
          'severity': _severity,
          'search': search,
          if (_mine) 'awaiting_my_approval': true,
        }),
        header: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const PageHeader('Non-Conformance Reports', subtitle: 'Quality Module'),
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
            FilterSelect(
              label: 'Status',
              allLabel: 'All statuses',
              value: _status,
              options: {'live': 'All not closed', ...ncrStatusLabels},
              onChanged: (v) {
                setState(() => _status = v);
                _reload();
              },
            ),
            ChipRow(children: [
              CountChip('Waiting for my approval', null, selected: _mine, onTap: () {
                setState(() => _mine = !_mine);
                _reload();
              }),
            ]),
          ],
        ),
        emptyText: 'No NCRs found — use + New NCR to raise one.',
        itemBuilder: (ctx, n, reload) => RecordCard(
          code: '${txt(n['ncr_number'])}${n['auto_raised'] == true ? ' · auto' : ''}',
          title: codeName(n['item_code'], n['item_name']),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: qPill(ncrStatusLabels, ncrStatusHex, n['status'])),
          meta: [
            ('Qty', fmtQty(n['quantity'], n['uom'])),
            ('Severity', humanize(n['severity'])),
            ('Source', humanize(n['source'])),
            (
              'Disposition',
              n['disposition_type'] == null
                  ? '—'
                  : '${lbl(dispositionTypeLabels, n['disposition_type'])}${n['disposition_status'] == 'pending_approval' ? ' (awaiting approval)' : ''}'
            ),
            ('NCR date', fmtDate(n['ncr_date'])),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => NcrDetailScreen(id: asInt(n['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

// ── Raise NCR (ncr/new/page.tsx) ─────────────────────────────────────────────

/// "Raise NCR" form; returns the created NCR.
Future<Json?> showNewNcrForm(BuildContext context) async {
  List<Option<String>> sources = [];
  List<Option<int>> locations = [];
  List<Option<int>> codes = [];
  try {
    final r = await Future.wait([
      Api.get('/quality/masters/values', query: {'list_key': 'ncr_sources'}),
      Api.get('/quality/masters/locations'),
      Api.get('/quality/masters/defect-codes'),
    ]);
    sources = [for (final s in rowsOf(r[0])) Option(str(s['value']), txt(s['label']))];
    locations = [for (final l in rowsOf(r[1])) Option(asInt(l['id'])!, '${txt(l['code'])} — ${txt(l['name'])}')];
    codes = [
      for (final c in rowsOf(r[2])) Option(asInt(c['id'])!, '${txt(c['code'])} — ${txt(c['name'])} (${txt(c['category'])})'),
    ];
  } catch (_) {}
  if (!context.mounted) return null;
  var source = 'internal';
  var severity = 'minor';
  var ncrDate = DateTime.now();
  int? itemId;
  String? itemLabel;
  String? itemUom;
  final itemName = TextEditingController();
  final qty = TextEditingController();
  final batch = TextEditingController();
  final vendor = TextEditingController();
  final ref = TextEditingController();
  final desc = TextEditingController();
  int? defectCode;
  var block = false;
  int? locationId;
  Json? created;
  final ok = await showFormSheet(
    context,
    title: 'Raise NCR',
    saveLabel: 'Raise NCR',
    builder: (ctx, setS) => [
      const Text(
          'Rejections at an inspection lot raise their NCR automatically — use this for non-conformances found elsewhere '
          '(in stock, on the shop floor, in an audit, from a customer).',
          style: TextStyle(fontSize: 13, color: Brand.muted)),
      const Caps('Non-conformance'),
      AppSelect<String>(
        label: 'Source',
        value: source,
        clearable: false,
        options: sources,
        onChanged: (o) => setS(() => source = o?.value ?? source),
      ),
      AppSelect<String>(
        label: 'Severity',
        value: severity,
        clearable: false,
        options: const [Option('minor', 'Minor'), Option('major', 'Major'), Option('critical', 'Critical')],
        onChanged: (o) => setS(() => severity = o?.value ?? severity),
      ),
      DateField(label: 'NCR date', value: ncrDate, required: true, onChanged: (d) => setS(() => ncrDate = d ?? ncrDate)),
      AppSelect<int>(
        label: 'Item (Item Master)',
        value: itemId,
        valueLabel: itemLabel,
        loadOptions: loadQualityItems,
        onChanged: (o) => setS(() {
          itemId = o?.value;
          itemLabel = o?.label;
          itemUom = o?.subtitle;
          if (itemId == null) block = false;
        }),
      ),
      if (itemId == null) AppTextField(label: 'Item name (non-stock)', controller: itemName),
      AppTextField(
          label: 'Quantity${itemUom != null ? ' ($itemUom)' : ''}', controller: qty, keyboardType: AppTextField.number),
      AppTextField(label: 'Batch / serial', controller: batch),
      AppTextField(label: 'Vendor', controller: vendor),
      AppSelect<int>(
        label: 'Defect code',
        value: defectCode,
        options: codes,
        onChanged: (o) => setS(() => defectCode = o?.value),
      ),
      AppTextField(label: 'Reference document', controller: ref, hint: 'Complaint / audit / job no.'),
      AppTextField(
          label: 'Description',
          required: true,
          controller: desc,
          maxLines: 5,
          hint: 'What is wrong, where it was found, how much is affected'),
      const Caps('Stock'),
      if (itemId != null) ...[
        CheckField(
            label: 'Block this quantity — move it from Free to Blocked stock',
            value: block,
            onChanged: (v) => setS(() => block = v)),
        if (block)
          AppSelect<int>(
            label: 'Store',
            required: true,
            value: locationId,
            options: locations,
            onChanged: (o) => setS(() => locationId = o?.value),
          ),
      ] else
        const Text('Pick an Item Master item to block its stock while the NCR is open.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
    ],
    onSave: () async {
      if (itemId == null && itemName.text.trim().isEmpty) {
        throw 'Pick the item from the Item Master, or type the name of a non-stock item.';
      }
      if (desc.text.trim().isEmpty) throw 'Describe the non-conformance.';
      final q = parseNum(qty.text, 'Quantity');
      final r = await Api.post('/quality/ncr', data: {
        'source': source,
        'severity': severity,
        'item_id': itemId,
        'item_name': itemId != null ? null : itemName.text.trim(),
        'quantity': q,
        'block_stock': block,
        'location_id': block ? locationId : null,
        'batch_number': batch.text.trim().isEmpty ? null : batch.text.trim(),
        'vendor_name': vendor.text.trim().isEmpty ? null : vendor.text.trim(),
        'defect_code_id': defectCode,
        'source_reference': ref.text.trim().isEmpty ? null : ref.text.trim(),
        'description': desc.text.trim(),
        'ncr_date': apiDate(ncrDate),
      });
      created = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? created : null;
}

// ── NCR detail (ncr/[id]/page.tsx) ───────────────────────────────────────────

const _steps = ['open', 'disposition_decided', 'action_done', 'verified', 'closed'];
const _actionHint = <String, String>{
  'use_as_is': 'Concession / release note no.',
  'rework': 'Rework order no.',
  'repair': 'Repair order / deviation no.',
  'return_to_vendor': 'RTV / debit note no.',
  'scrap': 'Scrap note no.',
};

String _rupees(Object? v) => '₹${fmtNumber(v ?? 0)}';

class NcrDetailScreen extends StatefulWidget {
  const NcrDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<NcrDetailScreen> createState() => _NcrDetailScreenState();
}

class _NcrDetailScreenState extends State<NcrDetailScreen> {
  Json? _ncr;
  Object? _error;
  bool _busy = false;
  int _panelKey = 0;
  List<Json> _codes = [];

  String get _base => '/quality/ncr/${widget.id}';

  bool get _isHead => Perm.can('quality', 'ncr', 'approve');
  bool get _isEngineer => Perm.can('quality', 'ncr', 'edit') || _isHead;
  bool get _holdsTab => Perm.can('quality', 'ncr', 'view');
  bool _nf(String feature, String action) => Perm.canFeature('quality', 'ncr', feature, action);
  bool get _canPropose => _isEngineer && _nf('disposition', 'submit');
  bool get _canSign => !_holdsTab || _nf('disposition', 'approve');
  bool get _canRejectDisp => !_holdsTab || _nf('disposition', 'reject');
  bool get _canActVerify => _isEngineer && _nf('action_verify', 'edit');
  bool get _canClose => _isHead && _nf('closure', 'approve');
  bool get _canCancel => _isHead && _nf('closure', 'cancel');
  bool get _seeCosts => !_holdsTab || _nf('costs', 'view');

  @override
  void initState() {
    super.initState();
    _load();
    Api.get('/quality/masters/disposition-codes').then((r) {
      if (mounted) setState(() => _codes = rowsOf(r).where((c) => c['is_active'] != false).toList());
    }).catchError((_) {});
  }

  Future<void> _load() async {
    try {
      final r = await Api.get(_base);
      if (mounted) {
        setState(() {
          _ncr = Map<String, dynamic>.from(r as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<bool> _act(String name, Json payload, {String? success}) async {
    if (_busy) return false;
    setState(() => _busy = true);
    try {
      final r = await Api.post('$_base/$name', data: payload);
      if (!mounted) return true;
      setState(() {
        if (r is Map) _ncr = Map<String, dynamic>.from(r);
        _panelKey++;
      });
      if (success != null) showSnack(context, success);
      return true;
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// For form sheets: throws so the sheet shows the server's reason.
  Future<void> _actInSheet(String name, Json payload) async {
    final r = await Api.post('$_base/$name', data: payload);
    if (mounted) {
      setState(() {
        if (r is Map) _ncr = Map<String, dynamic>.from(r);
        _panelKey++;
      });
    }
  }

  Future<void> _propose() async {
    final ncr = _ncr!;
    int? codeId;
    final remarks = TextEditingController();
    var custReq = false;
    final custRef = TextEditingController();
    final first = ncr['disposition_status'] == 'none';
    final ok = await showFormSheet(
      context,
      title: first ? 'Propose disposition' : 'Re-propose disposition',
      saveLabel: 'Propose',
      builder: (ctx, setS) {
        final sel = _codes.where((c) => asInt(c['id']) == codeId).firstOrNull;
        return [
          Text('${txt(ncr['ncr_number'])} · ${txt(ncr['item_name'])} · ${fmtQty(ncr['quantity'], ncr['uom'])}',
              style: const TextStyle(color: Brand.muted)),
          AppSelect<int>(
            label: 'Disposition',
            required: true,
            value: codeId,
            options: [for (final c in _codes) Option(asInt(c['id'])!, '${txt(c['code'])} — ${txt(c['name'])}')],
            onChanged: (o) => setS(() => codeId = o?.value),
          ),
          if (!first)
            const Text('Re-proposing restarts the approvals.', style: TextStyle(fontSize: 12, color: Brand.muted)),
          AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
          if (sel != null && ['use_as_is', 'repair'].contains(sel['disposition_type'])) ...[
            CheckField(
                label: 'Contract needs customer approval', value: custReq, onChanged: (v) => setS(() => custReq = v)),
            if (custReq) AppTextField(label: 'Customer approval ref.', controller: custRef),
          ],
        ];
      },
      onSave: () async {
        if (codeId == null) throw 'Pick the disposition to propose.';
        await _actInSheet('propose-disposition', {
          'disposition_code_id': codeId,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
          'customer_approval_required': custReq,
          'customer_approval_reference': custRef.text.trim().isEmpty ? null : custRef.text.trim(),
        });
      },
    );
    if (ok && mounted) showSnack(context, 'Disposition proposed.');
  }

  Future<void> _actionDone() async {
    final ncr = _ncr!;
    final ref = TextEditingController();
    final remarks = TextEditingController();
    final type = str(ncr['disposition_type']);
    final ok = await showFormSheet(
      context,
      title: 'Record action done',
      saveLabel: 'Record action done',
      builder: (ctx, setS) => [
        Text('${txt(ncr['ncr_number'])} · ${str(ncr['disposition_label']).isNotEmpty ? ncr['disposition_label'] : lbl(dispositionTypeLabels, type)}',
            style: const TextStyle(color: Brand.muted)),
        AppTextField(label: _actionHint[type] ?? 'Document no.', required: true, controller: ref),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
        if (type == 'rework' || type == 'repair')
          const Text(
              'Recording the action moves the Blocked quantity back to Quality stock and opens a re-inspection lot.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () => _actInSheet('action', {'action_reference': ref.text, 'remarks': remarks.text}),
    );
    if (ok && mounted) showSnack(context, 'Action recorded.');
  }

  Future<void> _verify() async {
    final ncr = _ncr!;
    final remarks = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Verify NCR',
      saveLabel: 'Verify',
      builder: (ctx, setS) => [
        Text('${txt(ncr['ncr_number'])} · ${txt(ncr['item_name'])}', style: const TextStyle(color: Brand.muted)),
        AppTextField(label: 'Verification remarks', controller: remarks, maxLines: 4),
      ],
      onSave: () => _actInSheet('verify', {'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim()}),
    );
    if (ok && mounted) showSnack(context, 'NCR verified.');
  }

  Future<void> _close() async {
    final ncr = _ncr!;
    final mat = TextEditingController();
    final rew = TextEditingController();
    final oth = TextEditingController();
    final root = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Close NCR',
      saveLabel: 'Close NCR',
      builder: (ctx, setS) => [
        Text('${txt(ncr['ncr_number'])} · cost of non-quality', style: const TextStyle(color: Brand.muted)),
        if (str(ncr['closure_problem']).isNotEmpty)
          Text(str(ncr['closure_problem']), style: const TextStyle(fontSize: 12.5, color: Color(0xFFB45309))),
        AppTextField(label: 'Material cost (₹)', controller: mat, keyboardType: AppTextField.number),
        AppTextField(label: 'Rework cost (₹)', controller: rew, keyboardType: AppTextField.number),
        AppTextField(label: 'Other cost (₹)', controller: oth, keyboardType: AppTextField.number),
        AppTextField(label: 'Root cause', controller: root, maxLines: 3),
      ],
      onSave: () => _actInSheet('close', {
        'material_cost': parseNum(mat.text, 'Material cost'),
        'rework_cost': parseNum(rew.text, 'Rework cost'),
        'other_cost': parseNum(oth.text, 'Other cost'),
        'root_cause': root.text.trim().isEmpty ? null : root.text.trim(),
      }),
    );
    if (ok && mounted) showSnack(context, 'NCR closed.');
  }

  Future<void> _rejectRole(String role) async {
    final reason = await promptDialog(context,
        title: 'Reject this disposition?',
        message: 'The proposer will be asked to propose a different disposition. Give the reason.',
        confirmLabel: 'Reject');
    if (reason == null) return;
    await _act('approve-disposition', {'role': role, 'approve': false, 'remarks': reason}, success: 'Disposition rejected.');
  }

  Future<void> _cancel() async {
    final reason = await promptDialog(context,
        title: 'Cancel this NCR?',
        message: 'Only a manual NCR with no Blocked stock can be cancelled. Give the reason.',
        confirmLabel: 'Cancel NCR');
    if (reason == null) return;
    await _act('cancel', {'reason': reason}, success: 'NCR cancelled.');
  }

  Widget _muted(String t) => Text(t, style: const TextStyle(fontSize: 13, color: Brand.muted));

  @override
  Widget build(BuildContext context) {
    final ncr = _ncr;
    if (ncr == null) {
      return SubPage(title: 'NCR', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final status = str(ncr['status']);
    final dispStatus = str(ncr['disposition_status']);
    final dispType = str(ncr['disposition_type']);
    final approvals = rowsOf(ncr['approvals']).where((a) => a['superseded'] != true).toList();
    final requiredRoles = (ncr['required_roles'] is List) ? (ncr['required_roles'] as List).map((e) => '$e').toList() : <String>[];
    final pendingRoles = (ncr['pending_roles'] is List) ? (ncr['pending_roles'] as List).map((e) => '$e').toList() : <String>[];
    final capas = rowsOf(ncr['capas']);
    final stepIndex = _steps.indexOf(status);

    return SubPage(
      title: txt(ncr['ncr_number']),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            Hint('Quality · NCR${ncr['auto_raised'] == true ? ' (raised by inspection)' : ''}'),
            ChipRow(children: [
              for (var i = 0; i < _steps.length; i++)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: StatusBadge('${i + 1}. ${ncrStatusLabels[_steps[i]]}',
                      color: stepIndex >= i ? const Color(0xFF15803D) : const Color(0xFF64748B)),
                ),
            ]),
            DetailSection(codeName(ncr['item_code'], ncr['item_name']), children: [
              Text(txt(ncr['description']), style: const TextStyle(fontSize: 13.5, color: Brand.body)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                qPill(ncrStatusLabels, ncrStatusHex, status),
                pill(humanize(ncr['severity']), severityHex[str(ncr['severity'])]),
                Text(fmtQty(ncr['quantity'], ncr['uom']), style: const TextStyle(fontSize: 12.5)),
                Text(
                    'Raised ${fmtDate(ncr['ncr_date'])}${str(ncr['raised_by_name']).isNotEmpty ? ' by ${ncr['raised_by_name']}' : ''}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
              if (_canCancel &&
                  status == 'open' &&
                  dispStatus == 'none' &&
                  ncr['auto_raised'] != true &&
                  ncr['stock_blocked'] != true)
                ActionWrap(children: [
                  secondaryBtn('Cancel NCR', _busy ? null : _cancel, color: qRed, icon: Icons.cancel_outlined),
                ]),
            ]),
            DetailSection('Where it came from', children: [
              FieldRow('Source', humanize(ncr['source'])),
              FieldRow('Reference', ncr['source_reference']),
              if (ncr['lot_id'] != null)
                FieldRow(
                    'Inspection lot',
                    InkWell(
                      onTap: () => openScreen(context, LotDetailScreen(id: asInt(ncr['lot_id'])!)),
                      child: Text(txt(ncr['lot_number']), style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
                    )),
              FieldRow('Vendor', ncr['vendor_name']),
              FieldRow('Batch / serial', ncr['batch_number']),
            ]),
            DetailSection('Defect & stock', children: [
              FieldRow('Defect', ncr['defect_code_label']),
              FieldRow('Stock',
                  ncr['stock_blocked'] == true ? 'Blocked at ${str(ncr['location_name']).isEmpty ? 'store' : ncr['location_name']}' : 'Not holding Blocked stock'),
              if (_seeCosts) FieldRow('Estimated value', ncr['estimated_value'] == null ? null : _rupees(ncr['estimated_value'])),
              if (str(ncr['root_cause']).isNotEmpty) FieldRow('Root cause', ncr['root_cause']),
              if (capas.isNotEmpty)
                FieldRow(
                    'CAPA',
                    Wrap(spacing: 8, runSpacing: 4, children: [
                      for (final c in capas)
                        InkWell(
                          onTap: () => openScreen(context, CapaDetailScreen(id: asInt(c['id'])!)),
                          child: Text('${txt(c['capa_number'])} (${humanize(c['status']).toLowerCase()})',
                              style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
                        ),
                    ])),
            ]),
            DetailSection('Disposition', children: [
              if (dispType.isNotEmpty) ...[
                FieldRow('Disposition',
                    str(ncr['disposition_label']).isNotEmpty ? ncr['disposition_label'] : lbl(dispositionTypeLabels, dispType)),
                FieldRow(
                    'Approval',
                    dispStatus == 'pending_approval'
                        ? 'Waiting for approval'
                        : dispStatus == 'approved'
                            ? 'Approved'
                            : 'Not proposed'),
                FieldRow('Needs', requiredRoles.isEmpty ? '—' : requiredRoles.map((r) => approvalRoleLabels[r] ?? r).join(' + ')),
                if (ncr['customer_approval_required'] == true)
                  FieldRow('Customer approval',
                      str(ncr['customer_approval_reference']).isEmpty ? 'Required — reference missing' : ncr['customer_approval_reference']),
                if (str(ncr['disposition_remarks']).isNotEmpty) FieldRow('Remarks', ncr['disposition_remarks']),
              ],
              if (dispType == 'scrap' && ncr['scrap_value_limit'] != null)
                _muted('Scrap above ${_rupees(ncr['scrap_value_limit'])} also needs a Partner\'s approval '
                    '(limit set in Organization › Approval Workflows › NCR disposition).'),
              for (final a in approvals)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    pill(a['decision'] == 'approved' ? 'Approved' : 'Rejected', a['decision'] == 'approved' ? qGreen : qRed),
                    Text(
                        '${approvalRoleLabels[str(a['role'])] ?? a['role']} — ${txt(a['approved_by_name'])}'
                        '${str(a['remarks']).isNotEmpty ? ' · ${a['remarks']}' : ''} · ${fmtDate(a['created_at'])}',
                        style: const TextStyle(fontSize: 12.5)),
                  ]),
                ),
              if (status == 'open' && dispStatus == 'pending_approval' && ncr['legacy_approval'] != true)
                _muted('Waiting for: ${pendingRoles.isEmpty ? '—' : pendingRoles.map((r) => approvalRoleLabels[r] ?? r).join(' → ')}. '
                    'Approvers decide in the Disposition approval panel below.'),
              if (status == 'open' && dispStatus == 'pending_approval' && ncr['legacy_approval'] == true && pendingRoles.isNotEmpty)
                ActionWrap(children: [
                  for (final r in pendingRoles) ...[
                    if (_canSign)
                      primaryBtn('Approve as ${approvalRoleLabels[r] ?? r}', _busy
                          ? null
                          : () => _act('approve-disposition', {'role': r, 'approve': true}, success: 'Approved.')),
                    if (_canRejectDisp) secondaryBtn('Reject', _busy ? null : () => _rejectRole(r), color: qRed, icon: Icons.close_rounded),
                  ],
                ]),
              if (status == 'open' && _canPropose)
                ActionWrap(children: [
                  dispStatus == 'none'
                      ? primaryBtn('Propose disposition', _busy ? null : _propose, icon: Icons.flag_outlined)
                      : secondaryBtn('Re-propose disposition', _busy ? null : _propose, icon: Icons.flag_outlined),
                ]),
            ]),
            ApprovalPanel(
              key: ValueKey(_panelKey),
              entityType: 'quality_ncr',
              entityId: widget.id,
              title: 'Disposition approval',
              onChanged: _load,
            ),
            if (dispStatus == 'approved' && (dispType == 'use_as_is' || dispType == 'repair'))
              DetailSection('Deviation approval', children: [
                RecordDocTile(
                  title: 'Deviation approval',
                  hint: 'Concession record with the approving authorities, on the company letterhead '
                      '(attach to the material / send to the customer where required).',
                  entityType: 'quality_deviation_approval',
                  entityId: widget.id,
                  pdfPath: '/quality/records/ncr/${widget.id}/deviation-approval.pdf',
                  canModify: Perm.can('quality', 'ncr', 'edit'),
                  downloadName: 'Deviation-Approval-${ncr['ncr_number']}',
                ),
              ]),
            if (status == 'disposition_decided' || ncr['action_done_at'] != null)
              DetailSection('Action', children: [
                if (ncr['action_done_at'] != null) ...[
                  FieldRow('Document', ncr['action_reference']),
                  FieldRow('Done on', fmtDate(ncr['action_done_at'])),
                  if (str(ncr['action_remarks']).isNotEmpty) FieldRow('Remarks', ncr['action_remarks']),
                  if (ncr['reinspection_lot_id'] != null)
                    FieldRow(
                        'Re-inspection lot',
                        InkWell(
                          onTap: () => openScreen(context, LotDetailScreen(id: asInt(ncr['reinspection_lot_id'])!)),
                          child: Text(txt(ncr['reinspection_lot_number']),
                              style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
                        )),
                ] else if (_canActVerify)
                  ActionWrap(children: [primaryBtn('Record action done', _busy ? null : _actionDone)])
                else
                  _muted('Waiting for a Quality engineer to record the disposition action.'),
                if ((dispType == 'rework' || dispType == 'repair') && ncr['action_done_at'] == null)
                  _muted('Recording the action moves the Blocked quantity back to Quality stock and opens a re-inspection lot.'),
              ]),
            if (status == 'action_done')
              DetailSection('Verification', children: [
                if (_canActVerify)
                  ActionWrap(children: [primaryBtn('Verify', _busy ? null : _verify, color: const Color(0xFF0891B2), icon: Icons.verified_outlined)])
                else
                  _muted('Waiting for a Quality engineer to verify the action.'),
              ]),
            if (status == 'verified' || status == 'closed')
              DetailSection(_seeCosts ? 'Closure & cost of non-quality' : 'Closure', children: [
                if (status == 'closed') ...[
                  if (_seeCosts) ...[
                    FieldRow('Material', _rupees(ncr['material_cost'])),
                    FieldRow('Rework', _rupees(ncr['rework_cost'])),
                    FieldRow('Other', _rupees(ncr['other_cost'])),
                    FieldRow('Total', _rupees(ncr['cost_of_non_quality'])),
                  ],
                  FieldRow('Closed', fmtDate(ncr['closed_at'])),
                ] else ...[
                  if (str(ncr['closure_problem']).isNotEmpty)
                    Text(str(ncr['closure_problem']), style: const TextStyle(fontSize: 12.5, color: Color(0xFFB45309))),
                  if (_canClose)
                    ActionWrap(children: [primaryBtn('Close NCR', _busy ? null : _close, color: qGreen, icon: Icons.currency_rupee_rounded)])
                  else
                    _muted('Verified — waiting for a Quality head to record the cost and close the NCR.'),
                ],
              ]),
          ],
        ),
      ),
    );
  }
}
