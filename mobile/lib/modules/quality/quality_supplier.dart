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

const _tabs = <String, String>{
  'vendors': 'Vendors',
  'avl': 'Approved vendor list',
  'ratings': 'Monthly rating',
  'audits': 'Vendor audits',
};
const _bandHex = <String, Color>{'approved': qGreen, 'on_watch': Color(0xFFF59E0B), 'blocked': qRed};

String _score(Object? v) {
  final n = asNum(v);
  return n == null ? '—' : n.toStringAsFixed(1);
}

/// Supplier Quality (portal supplier-quality/page.tsx): Vendors, Approved
/// vendor list, Monthly rating, Vendor audits.
class SupplierQualityTab extends StatefulWidget {
  const SupplierQualityTab({super.key});

  @override
  State<SupplierQualityTab> createState() => _SupplierQualityTabState();
}

class _SupplierQualityTabState extends State<SupplierQualityTab> {
  String _tab = 'vendors';
  Json? _meta;
  String _avlStatus = '';
  bool _pendingOnly = false;
  String _search = '';
  String _period = '';
  int _reload = 0;
  bool _busy = false;
  final _listKey = GlobalKey<ApiListViewState>();

  bool get _canCreate => Perm.can('quality', 'supplier_quality', 'create');
  bool get _canEdit => Perm.can('quality', 'supplier_quality', 'edit');
  bool get _seeAudits => Perm.canFeature('quality', 'supplier_quality', 'audits', 'view');
  bool get _canScheduleAudit => _canCreate && Perm.canFeature('quality', 'supplier_quality', 'audits', 'create');
  bool get _canRecordAudit => _canEdit && Perm.canFeature('quality', 'supplier_quality', 'audits', 'edit');

  @override
  void initState() {
    super.initState();
    Api.get('/quality/supplier-quality/meta').then((m) {
      if (mounted && m is Map) {
        setState(() {
          _meta = Map<String, dynamic>.from(m);
          if (_period.isEmpty) _period = str(_meta!['previous_period']);
        });
      }
    }).catchError((_) {});
  }

  void _refresh() {
    setState(() => _reload++);
  }

  List<String> get _months {
    final now = DateTime.now();
    return [
      for (var i = 0; i < 24; i++)
        () {
          final d = DateTime(now.year, now.month - i);
          return '${d.year}-${d.month.toString().padLeft(2, '0')}';
        }(),
    ];
  }

  Future<void> _newAvl() async {
    final a = await _showNewAvlForm(context);
    if (a != null && mounted) {
      _refresh();
      openScreen(context, AvlDetailScreen(id: asInt(a['id'])!));
    }
  }

  Future<void> _scheduleAudit() async {
    final vendor = TextEditingController();
    DateTime? planned;
    int? auditor;
    String? auditorLabel;
    final scope = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Schedule Vendor Audit',
      saveLabel: 'Schedule',
      builder: (ctx, setS) => [
        const Text('Plan an audit of a supplier\'s process and quality system.', style: TextStyle(color: Brand.muted)),
        AppTextField(label: 'Vendor', required: true, controller: vendor),
        DateField(label: 'Planned date', required: true, value: planned, onChanged: (d) => setS(() => planned = d)),
        AppSelect<int>(
          label: 'Auditor',
          value: auditor,
          valueLabel: auditorLabel,
          loadOptions: loadQualityUsers,
          onChanged: (o) => setS(() {
            auditor = o?.value;
            auditorLabel = o?.label;
          }),
        ),
        AppTextField(label: 'Scope', controller: scope),
      ],
      onSave: () => Api.post('/quality/supplier-quality/audits', data: {
        'vendor_name': vendor.text,
        'planned_date': planned == null ? null : apiDate(planned!),
        'scope': scope.text.trim().isEmpty ? null : scope.text.trim(),
        'auditor_id': auditor,
      }),
    );
    if (ok && mounted) {
      showSnack(context, 'Audit scheduled.');
      _refresh();
    }
  }

  Future<void> _recordAudit(Json a) async {
    DateTime? date;
    final score = TextEditingController();
    var result = 'satisfactory';
    final findings = TextEditingController();
    final remarks = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Record Audit Result',
      saveLabel: 'Save result',
      builder: (ctx, setS) => [
        Text(str(a['audit_number']).isEmpty ? 'Vendor audit' : str(a['audit_number']), style: const TextStyle(color: Brand.muted)),
        DateField(label: 'Audit date', required: true, value: date, onChanged: (d) => setS(() => date = d)),
        AppTextField(label: 'Score (0–100)', controller: score, keyboardType: AppTextField.number),
        AppSelect<String>(
          label: 'Result',
          value: result,
          clearable: false,
          options: const [
            Option('satisfactory', 'Satisfactory'),
            Option('conditional', 'Conditional'),
            Option('unsatisfactory', 'Unsatisfactory'),
          ],
          onChanged: (o) => setS(() => result = o?.value ?? result),
        ),
        AppTextField(label: 'Findings', controller: findings, maxLines: 5),
        const Text('One per line, start with major: / minor: / observation: — major and minor findings raise a CAPA.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
        AppTextField(label: 'Remarks', controller: remarks),
      ],
      onSave: () async {
        final re = RegExp(r'^(major|minor|observation)\s*:\s*(.*)$', caseSensitive: false);
        final f = [
          for (final l in findings.text.split('\n').map((x) => x.trim()).where((x) => x.isNotEmpty))
            () {
              final m = re.firstMatch(l);
              return m != null
                  ? {'type': m.group(1)!.toLowerCase(), 'description': m.group(2)}
                  : {'type': 'observation', 'description': l};
            }(),
        ];
        await Api.post('/quality/supplier-quality/audits/${a['id']}/complete', data: {
          'audit_date': date == null ? null : apiDate(date!),
          'score': parseNum(score.text, 'Score'),
          'result': result,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
          'findings': f,
        });
      },
    );
    if (ok && mounted) {
      showSnack(context, 'Audit result saved.');
      _refresh();
    }
  }

  Future<void> _runRatings() async {
    setState(() => _busy = true);
    final ok = await runAction(context, () => Api.post('/quality/supplier-quality/ratings/run', data: {'period': _period}),
        success: 'Ratings computed for $_period.');
    if (mounted) setState(() => _busy = false);
    if (ok) _refresh();
  }

  Widget _header() {
    final m = _meta;
    final limits = m?['limits'] is Map ? Map<String, dynamic>.from(m!['limits'] as Map) : null;
    final w = limits?['weights'] is Map ? Map<String, dynamic>.from(limits!['weights'] as Map) : <String, dynamic>{};
    final pts = m?['ncr_points'] is Map ? Map<String, dynamic>.from(m!['ncr_points'] as Map) : <String, dynamic>{};
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const PageHeader('Supplier Quality', subtitle: 'Quality Module'),
      if (limits != null)
        Hint('Monthly score = quality ${w['quality']}% (accepted ÷ received) + delivery ${w['delivery']}% (GRN on/before PO date) '
            '+ NCR ${w['ncr']}% (100 − ${pts['minor']}/${pts['major']}/${pts['critical']} per minor/major/critical NCR). '
            'Below ${limits['watch_below']} → On watch (tightened sampling + vendor CAPA); below ${limits['block_below']} → Blocked after a Partner approves.'),
      ChipRow(children: [
        for (final e in _tabs.entries)
          if (e.key != 'audits' || _seeAudits)
            CountChip(e.value, null, selected: _tab == e.key, onTap: () => setState(() => _tab = e.key)),
      ]),
      if (_tab == 'avl') ...[
        FilterSelect(
          label: 'Status',
          allLabel: 'All statuses',
          value: _avlStatus,
          options: avlStatusLabels,
          onChanged: (v) {
            setState(() => _avlStatus = v);
            _listKey.currentState?.reload();
          },
        ),
        ChipRow(children: [
          if (_search.isNotEmpty)
            CountChip('Vendor: $_search  ✕', null, selected: true, onTap: () => setState(() => _search = '')),
          CountChip('Waiting for a Partner', null, selected: _pendingOnly, onTap: () {
            setState(() => _pendingOnly = !_pendingOnly);
            _listKey.currentState?.reload();
          }),
        ]),
      ],
      if (_tab == 'ratings') ...[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: AppSelect<String>(
            label: 'Month',
            value: _period.isEmpty ? null : _period,
            clearable: false,
            options: [
              for (final mo in {..._months, if (_period.isNotEmpty) _period}) Option(mo, mo),
            ],
            onChanged: (o) {
              setState(() => _period = o?.value ?? _period);
              _listKey.currentState?.reload();
            },
          ),
        ),
        if (_canEdit)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: secondaryBtn('Compute / refresh $_period', _busy || _period.isEmpty ? null : _runRatings,
                  icon: Icons.refresh_rounded),
            ),
          ),
        const Hint('The previous month is rated automatically on the 1st; a Quality head can re-run a month.'),
      ],
    ]);
  }

  Future<ApiPage> _load(int page, String search) {
    switch (_tab) {
      case 'avl':
        return Api.list('/quality/supplier-quality/avl', query: {
          'status': _avlStatus,
          if (_pendingOnly) 'pending_only': true,
          'search': search.isNotEmpty ? search : _search,
        });
      case 'ratings':
        return Api.list('/quality/supplier-quality/ratings', query: {'period': _period});
      case 'audits':
        return Api.list('/quality/supplier-quality/audits');
      default:
        return Api.list('/quality/supplier-quality/vendors');
    }
  }

  Widget _row(BuildContext ctx, Json r, VoidCallback reload) {
    switch (_tab) {
      case 'avl':
        return RecordCard(
          code: txt(r['vendor_name']),
          title: codeName(r['item_code'], r['item_name']),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: qPill(avlStatusLabels, avlStatusHex, r['status'])),
          meta: [
            ('Sampling', '${lbl(samplingLabels, r['sampling_state'])}${r['skip_lot_active'] == true ? ' · skip-lot' : ''}'),
            ('Accepted in a row', txt(r['consecutive_accepted'])),
            ('Last score', r['last_score'] != null ? '${_score(r['last_score'])} (${r['last_rated_period']})' : '—'),
            ('Valid until', '${fmtDate(r['valid_until'])}${r['expired'] == true ? ' · re-evaluate' : ''}'),
            ('Pending', str(r['pending_action']).isNotEmpty ? '${r['pending_action']} (Partner)' : '—'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => AvlDetailScreen(id: asInt(r['id'])!)));
            reload();
          },
        );
      case 'ratings':
        return RecordCard(
          code: txt(r['period']),
          title: txt(r['vendor_name']),
          trailing: r['rating_band'] == null
              ? null
              : Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: pill(lbl(avlStatusLabels, r['rating_band']), _bandHex[str(r['rating_band'])])),
          meta: [
            ('Score', _score(r['overall_score'])),
            ('Lots', txt(r['lots_count'])),
            ('Received', txt(r['received_qty'])),
            ('Accepted', txt(r['accepted_qty'])),
            ('Quality', _score(r['quality_score'])),
            ('NCRs (mi/ma/cr)', '${r['ncr_minor'] ?? 0}/${r['ncr_major'] ?? 0}/${r['ncr_critical'] ?? 0}'),
            ('NCR score', _score(r['ncr_score'])),
            ('On-time', (asInt(r['deliveries']) ?? 0) > 0 ? '${r['on_time_deliveries']}/${r['deliveries']}' : '—'),
            ('Delivery', _score(r['on_time_delivery_score'])),
          ],
        );
      case 'audits':
        final findings = rowsOf(r['findings']).map((f) => '[${f['type']}] ${f['description']}').join('; ');
        return _withLinks(RecordCard(
          code: txt(r['audit_number']),
          title: txt(r['vendor_name']),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: StatusBadge(r['status'])),
          meta: [
            ('Planned', fmtDate(r['planned_date'])),
            ('Auditor', txt(r['auditor_name'])),
            if (r['audit_date'] != null) ('Audited', fmtDate(r['audit_date'])),
            ('Score', txt(r['score'])),
            ('Result', txt(r['result'])),
            ('Findings', findings.isEmpty ? '—' : findings),
          ],
        ), [
          if (r['capa_id'] != null)
            TextButton(
              onPressed: () => openScreen(ctx, CapaDetailScreen(id: asInt(r['capa_id'])!)),
              child: Text('CAPA ${txt(r['capa_number'])}', style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
            ),
          if (_canRecordAudit && r['status'] == 'planned')
            TextButton(
              onPressed: () => _recordAudit(r),
              child: const Text('Record result', style: TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
            ),
        ]);
      default:
        final capa = r['open_capa'] is Map ? Map<String, dynamic>.from(r['open_capa'] as Map) : null;
        return _withLinks(RecordCard(
          title: txt(r['vendor_name']),
          meta: [
            ('Items', txt(r['items'])),
            ('Trial', txt(r['trial'])),
            ('Approved', txt(r['approved'])),
            ('On watch', txt(r['on_watch'])),
            ('Blocked', txt(r['blocked'])),
            ('Waiting for Partner', (asInt(r['pending']) ?? 0) > 0 ? txt(r['pending']) : '—'),
            ('Last score', r['last_score'] != null ? '${_score(r['last_score'])} (${r['last_period']})' : '—'),
          ],
          onTap: () => setState(() {
            _search = str(r['vendor_name']);
            _tab = 'avl';
          }),
        ), [
          if (capa != null)
            TextButton(
              onPressed: () => openScreen(ctx, CapaDetailScreen(id: asInt(capa['id'])!)),
              child: Text('Vendor CAPA ${txt(capa['capa_number'])}',
                  style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
            ),
        ]);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fab = _tab == 'audits' && _canScheduleAudit
        ? CreateFab(label: 'Schedule audit', onPressed: _scheduleAudit)
        : (_canCreate ? CreateFab(label: 'Add vendor for an item', onPressed: _newAvl) : null);
    final empty = switch (_tab) {
      'avl' => 'Nothing on the list for this filter.',
      'ratings' => 'No rating for this month yet.',
      'audits' => 'No vendor audits yet.',
      _ => 'No vendors yet — vendors are added automatically when they first supply an inspection-controlled item.',
    };
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: fab,
      body: ApiListView(
        key: ValueKey('$_tab-$_reload-$_search${_tab == 'ratings' ? _period : ''}'),
        searchHint: _tab == 'avl' ? 'Search vendor or item…' : null,
        load: _load,
        header: _header(),
        emptyText: empty,
        itemBuilder: _row,
      ),
    );
  }
}

/// A list card with a row of link buttons under it (CAPA link, Record result).
Widget _withLinks(Widget card, List<Widget> links) {
  if (links.isEmpty) return card;
  return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    card,
    Padding(
      padding: const EdgeInsets.fromLTRB(24, 0, 16, 10),
      child: Transform.translate(offset: const Offset(0, -6), child: Wrap(spacing: 4, children: links)),
    ),
  ]);
}

// ── Add vendor for an item (supplier-quality/new/page.tsx) ───────────────────

Future<Json?> _showNewAvlForm(BuildContext context) async {
  int? itemId;
  String? itemLabel;
  final vendor = TextEditingController();
  final remarks = TextEditingController();
  Json? created;
  final ok = await showFormSheet(
    context,
    title: 'Add Vendor for an Item',
    saveLabel: 'Add to list',
    builder: (ctx, setS) => [
      const Text('Quality · Approved vendor list', style: TextStyle(color: Brand.muted)),
      const Caps('Vendor'),
      AppSelect<int>(
        label: 'Item',
        required: true,
        value: itemId,
        valueLabel: itemLabel,
        loadOptions: loadQualityItems,
        onChanged: (o) => setS(() {
          itemId = o?.value;
          itemLabel = o?.label;
        }),
      ),
      AppTextField(label: 'Vendor', required: true, controller: vendor, hint: 'Exactly as on the purchase orders'),
      AppTextField(label: 'Remarks', controller: remarks),
      const Caps('How vendors get on the list'),
      const Text(
          'A vendor starts on Trial. Vendors of inspection-controlled items are added automatically on their first receipt and '
          'approved by their first article; use this to pre-register a vendor (e.g. before a trial order).',
          style: TextStyle(fontSize: 13, color: Brand.body)),
    ],
    onSave: () async {
      if (itemId == null || vendor.text.trim().isEmpty) {
        throw 'Pick the item and enter the vendor name exactly as on the purchase orders.';
      }
      final r = await Api.post('/quality/supplier-quality/avl', data: {
        'item_id': itemId,
        'vendor_name': vendor.text.trim(),
        'remarks': remarks.text.trim().isEmpty ? null : remarks.text,
      });
      created = r is Map ? Map<String, dynamic>.from(r) : null;
    },
  );
  return ok ? created : null;
}

// ── Approved vendor entry (supplier-quality/[id]/page.tsx) ───────────────────

class AvlDetailScreen extends StatefulWidget {
  const AvlDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<AvlDetailScreen> createState() => _AvlDetailScreenState();
}

class _AvlDetailScreenState extends State<AvlDetailScreen> {
  Json? _a;
  Object? _error;
  bool _busy = false;

  String get _base => '/quality/supplier-quality/avl/${widget.id}';
  bool get _canManage =>
      Perm.can('quality', 'supplier_quality', 'edit') && Perm.can('quality', 'supplier_quality', 'approve');
  bool get _isPartner => Perm.user['is_partner'] == true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get(_base);
      if (mounted) {
        setState(() {
          _a = Map<String, dynamic>.from(r as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _run(Future<dynamic> Function() fn, {String? success}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final r = await fn();
      if (!mounted) return;
      if (r is Map) setState(() => _a = Map<String, dynamic>.from(r));
      if (success != null) showSnack(context, success);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _prompt(String action, String title, String message, String label) async {
    final reason = await promptDialog(context, title: title, message: message, confirmLabel: label);
    if (reason == null || reason.trim().isEmpty) return;
    if (action == 'reject-pending') {
      await _run(() => Api.post('$_base/decision', data: {'approve': false, 'remarks': reason}), success: 'Decision recorded.');
    } else {
      await _run(() => Api.post('$_base/$action', data: {'reason': reason}), success: 'Vendor updated.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = _a;
    if (a == null) {
      return SubPage(title: 'Approved vendor', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final status = str(a['status']);
    final pending = str(a['pending_action']);
    final events = rowsOf(a['events']);
    final recent = a['recent_lots'] is List ? (a['recent_lots'] as List) : const [];
    return SubPage(
      title: txt(a['vendor_name']),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            const Hint('Quality · Approved vendor list'),
            if (pending.isNotEmpty)
              DetailSection('${pending == 'block' ? 'Block' : 'Unblock'} waiting for a Partner', children: [
                FieldRow('Reason', a['pending_reason']),
                FieldRow('Requested', '${txt(a['pending_requested_by_name'])} · ${fmtDate(a['pending_requested_at'])}'),
                if (a['legacy_pending'] != true)
                  const Text(
                      'Approvers decide in the Approval panel below (Organization › Approval Workflows › Vendor block / unblock).',
                      style: TextStyle(fontSize: 12.5, color: Brand.muted))
                else if (_isPartner)
                  ActionWrap(children: [
                    primaryBtn('Approve $pending',
                        _busy ? null : () => _run(() => Api.post('$_base/decision', data: {'approve': true, 'remarks': ''}),
                            success: 'Decision recorded.'),
                        color: pending == 'block' ? qRed : null),
                    secondaryBtn('Reject', _busy
                        ? null
                        : () => _prompt('reject-pending', 'Reject the $pending?', 'Give the reason.', 'Reject'),
                        icon: Icons.close_rounded),
                  ])
                else
                  const Text('Only a Partner (Company Info → Partners) can decide this.',
                      style: TextStyle(fontSize: 12.5, color: Brand.muted)),
              ]),
            ApprovalPanel(
              key: ValueKey('avl-$status-$pending'),
              entityType: 'quality_approved_vendor',
              entityId: widget.id,
              title: 'Approval workflow',
              onChanged: _load,
            ),
            DetailSection(codeName(a['item_code'], a['item_name']), children: [
              Text('Whether ${txt(a['vendor_name'])} may supply this item, and how strictly its lots are sampled.',
                  style: const TextStyle(fontSize: 13.5)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                qPill(avlStatusLabels, avlStatusHex, status),
                if (a['expired'] == true) pill('Re-evaluation due', qRed),
                Text('Valid until ${fmtDate(a['valid_until'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                if (a['last_score'] != null)
                  Text('Last rating ${_score(a['last_score'])} (${a['last_rated_period']})',
                      style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
            ]),
            DetailSection('Approval', children: [
              FieldRow('Status reason', a['status_reason']),
              FieldRow(
                  'Approved',
                  a['approved_at'] == null
                      ? null
                      : '${fmtDate(a['approved_at'])}${str(a['approved_by_name']).isNotEmpty ? ' by ${a['approved_by_name']}' : ''}'),
              FieldRow('First article', a['fai_number']),
            ]),
            DetailSection('Sampling (ISO 2859-1 switching)', children: [
              FieldRow('Current state',
                  '${lbl(samplingLabels, a['sampling_state'])}${a['skip_lot_active'] == true ? ' · skip-lot active' : ''}'),
              FieldRow('Accepted in a row', txt(a['consecutive_accepted'])),
              FieldRow('Recent lots (oldest → newest)', recent.isEmpty ? null : recent.map((x) => x == true ? '✓' : '✗').join(' ')),
              if (_canManage && !(status == 'blocked' && pending.isNotEmpty))
                ActionWrap(children: [
                  if (status == 'trial')
                    primaryBtn(
                        'Approve vendor',
                        _busy
                            ? null
                            : () => _prompt(
                                'approve',
                                'Approve this vendor for the item?',
                                'Record the basis (sample report, audit, trial order). Inspection-controlled items are approved by their first article instead.',
                                'Approve'),
                        color: qGreen),
                  if (status == 'trial' || status == 'approved')
                    secondaryBtn(
                        'Put on watch',
                        _busy
                            ? null
                            : () => _prompt('watch', 'Put the vendor on watch?',
                                'Lots switch to tightened sampling and a vendor CAPA is raised. Give the reason.', 'Put on watch'),
                        icon: Icons.visibility_outlined),
                  if (status == 'on_watch')
                    secondaryBtn(
                        'Take off watch',
                        _busy
                            ? null
                            : () => _prompt('release-watch', 'Take the vendor off watch?',
                                'Needs the vendor CAPA closed. Give the reason.', 'Back to approved'),
                        icon: Icons.visibility_off_outlined),
                  if (status != 'blocked' && pending.isEmpty)
                    secondaryBtn(
                        'Request block',
                        _busy
                            ? null
                            : () => _prompt(
                                'request-block',
                                'Request a block?',
                                'A Partner must approve. A blocked vendor gets no PO lines and no lot acceptance for this item. Give the reason.',
                                'Request block'),
                        color: qRed,
                        icon: Icons.block_rounded),
                  if (status == 'blocked' && pending.isEmpty)
                    secondaryBtn(
                        'Request unblock',
                        _busy
                            ? null
                            : () => _prompt('request-unblock', 'Request an unblock?',
                                'A Partner must approve; the vendor returns On watch. Give the reason.', 'Request unblock'),
                        icon: Icons.lock_open_rounded),
                ]),
            ]),
            DetailSection('History', children: [
              if (events.isEmpty) const Text('No history.', style: TextStyle(fontSize: 13, color: Brand.muted)),
              for (final e in events)
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                      '${fmtDate(e['created_at'])} · ${humanize(e['event'])}'
                      '${e['from_status'] != e['to_status'] && e['to_status'] != null ? ' (${lbl(avlStatusLabels, e['from_status'])} → ${lbl(avlStatusLabels, e['to_status'])})' : ''}'
                      '${str(e['reason']).isNotEmpty ? ' — ${e['reason']}' : ''} · ${str(e['user_name']).isEmpty ? 'System' : e['user_name']}',
                      style: const TextStyle(fontSize: 12.5)),
                ),
            ]),
          ],
        ),
      ),
    );
  }
}
