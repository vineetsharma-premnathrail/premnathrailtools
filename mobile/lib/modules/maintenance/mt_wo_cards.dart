import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'mt_common.dart';

// Work order cards - WorkOrderPermitsCard.tsx and WorkOrderPurchaseCard.tsx.

const _permitStatusLabels = {'issued': 'Issued', 'active': 'Active', 'closed': 'Closed', 'cancelled': 'Cancelled'};
const _permitStatusHex = {'issued': kAmber, 'active': kGreen, 'closed': kTeal, 'cancelled': kGrey};

/// Permit-to-work on a work order. The job can't start until a permit is
/// active and can't complete while one is still open (backend enforces it).
class PermitsSection extends StatefulWidget {
  const PermitsSection({
    super.key,
    required this.woId,
    required this.woStatus,
    required this.permitRequired,
    required this.assignedToId,
    required this.onChanged,
  });
  final int woId;
  final String woStatus;
  final bool permitRequired;
  final int? assignedToId;
  final VoidCallback onChanged;

  @override
  State<PermitsSection> createState() => _PermitsSectionState();
}

class _PermitsSectionState extends State<PermitsSection> {
  List<Json>? _permits;
  List<Json> _types = [];
  String? _error;
  bool _busy = false;

  bool _pf(String a) => Mt.feat('work_orders', 'permits', a);
  bool get _canIssue => Mt.can('work_orders', 'approve') && _pf('create');
  bool get _canCancel => Mt.can('work_orders', 'approve') && _pf('cancel');
  bool get _canAccept => _pf('approve');
  bool get _canEdit => Mt.can('work_orders', 'edit') && _pf('edit');

  @override
  void initState() {
    super.initState();
    _load();
    Api.list('/maintenance/permit-types').then((p) {
      if (mounted) setState(() => _types = p.rows);
    }).catchError((Object _) {});
  }

  Future<void> _load() async {
    try {
      final p = await Api.list('/maintenance/work-orders/${widget.woId}/permits');
      if (mounted) {
        setState(() {
          _permits = p.rows;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _run(Future<dynamic> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
      await _load();
      widget.onChanged();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _issue() async {
    String type = _types.isEmpty ? 'general' : str(_types.first['value']);
    DateTime? from = DateTime.now();
    DateTime? to = DateTime.now().add(const Duration(hours: 8));
    final fields = {
      'hazards': ('Hazards', true),
      'isolation_points': ('Isolation points (breakers / valves locked & tagged)', false),
      'precautions': ('Precautions', false),
      'ppe_required': ('PPE required', false),
      'work_description': ('Work to be done', false),
    };
    final ctrls = {for (final k in fields.keys) k: TextEditingController()};
    final saved = await showFormSheet(
      context,
      title: 'Issue permit-to-work',
      saveLabel: 'Issue permit',
      builder: (ctx, setS) => [
        hintText("The technician accepts it at site; the job can't start until a permit is active."),
        sheetSection('Permit & Validity'),
        AppSelect<String>(
          label: 'Permit type',
          value: type,
          clearable: false,
          options: [for (final t in _types) Option(str(t['value']), str(t['label']))],
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        DateTimeField(label: 'Valid from', value: from, onChanged: (v) => setS(() => from = v)),
        DateTimeField(label: 'Valid to', value: to, onChanged: (v) => setS(() => to = v)),
        sheetSection('Hazards & Precautions'),
        for (final e in fields.entries) AppTextField(label: e.value.$1, required: e.value.$2, controller: ctrls[e.key], maxLines: 2),
      ],
      onSave: () async {
        await Api.post('/maintenance/work-orders/${widget.woId}/permits', data: {
          'permit_type': type,
          'valid_from': isoOf(from),
          'valid_to': isoOf(to),
          for (final k in fields.keys) k: ctrls[k]!.text,
        });
      },
    );
    for (final c in ctrls.values) {
      c.dispose();
    }
    if (saved) {
      _load();
      widget.onChanged();
    }
  }

  Future<void> _close(Json p) async {
    var removed = false;
    final remarks = TextEditingController();
    final saved = await showFormSheet(
      context,
      title: 'Close ${p['permit_number']}',
      saveLabel: 'Close permit',
      builder: (ctx, setS) => [
        hintText('Confirm the site is safe and handed back.'),
        CheckField(
          label: 'Isolation removed, locks / tags taken off, area cleaned and handed back.',
          value: removed,
          onChanged: (v) => setS(() => removed = v),
        ),
        AppTextField(label: 'Remarks (optional)', controller: remarks, maxLines: 2),
      ],
      onSave: () async {
        await Api.post('/maintenance/permits/${p['id']}/close', data: {'isolation_removed': removed, 'remarks': remarks.text});
      },
    );
    remarks.dispose();
    if (saved) {
      _load();
      widget.onChanged();
    }
  }

  Future<void> _cancel(Json p) async {
    final reason = await promptDialog(context,
        title: 'Cancel ${p['permit_number']}', message: 'Why is the permit being cancelled?', confirmLabel: 'Cancel permit');
    if (reason == null) return;
    _run(() => Api.post('/maintenance/permits/${p['id']}/cancel', data: {'reason': reason}));
  }

  @override
  Widget build(BuildContext context) {
    final locked = const ['completed', 'closed', 'cancelled'].contains(widget.woStatus);
    final permits = _permits;
    return DetailSection(
      'Work permits',
      action: _canIssue && !locked ? smallBtn('+ Issue permit', _busy ? null : _issue) : null,
      children: [
        hintText(widget.permitRequired
            ? 'This job needs an active permit before it starts, and every permit closed before it completes.'
            : 'No permit required for this job (a permit can still be issued).'),
        if (_error != null) ...[const SizedBox(height: 8), ErrorBanner(_error!)],
        if (permits != null && permits.isEmpty) mutedText('No permits issued.'),
        for (final p in permits ?? <Json>[])
          Container(
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(border: Border.all(color: const Color(0x1F000000)), borderRadius: BorderRadius.circular(12)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  Text(str(p['permit_number']), style: const TextStyle(fontWeight: FontWeight.w700)),
                  smallText(str(p['permit_type_label'])),
                  p['expired'] == true
                      ? const Pill('Expired', kGrey)
                      : Pill(_permitStatusLabels[p['status']] ?? str(p['status']), _permitStatusHex[p['status']] ?? kGrey),
                ]),
                const SizedBox(height: 6),
                factLine('Hazards', txt(p['hazards'])),
                if (str(p['isolation_points']).isNotEmpty) factLine('Isolation (LOTO)', str(p['isolation_points'])),
                if (str(p['precautions']).isNotEmpty) factLine('Precautions', str(p['precautions'])),
                if (str(p['ppe_required']).isNotEmpty) factLine('PPE', str(p['ppe_required'])),
                factLine('Valid', '${fmtDateTime(p['valid_from'])} → ${fmtDateTime(p['valid_to'])}'),
                factLine('Issued by', txt(p['issued_by_name'])),
                if (str(p['accepted_by_name']).isNotEmpty) factLine('Accepted', '${p['accepted_by_name']}, ${fmtDateTime(p['accepted_at'])}'),
                if (str(p['closed_by_name']).isNotEmpty)
                  factLine('Closed', '${p['closed_by_name']}, ${fmtDateTime(p['closed_at'])} (isolation removed)'),
                if (str(p['cancel_reason']).isNotEmpty) factLine('Cancelled', str(p['cancel_reason'])),
                const SizedBox(height: 8),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  if (p['status'] == 'issued' && _canAccept && (widget.assignedToId == Perm.userId || _canEdit))
                    smallBtn('Accept at site', _busy ? null : () => _run(() => Api.post('/maintenance/permits/${p['id']}/activate'))),
                  if (p['status'] == 'active' && _canEdit) smallBtn('Close permit', _busy ? null : () => _close(p)),
                  if (const ['issued', 'active'].contains(p['status']) && _canCancel)
                    smallBtn('Cancel', _busy ? null : () => _cancel(p), danger: true),
                  smallBtn(
                    'Permit document',
                    () => runAction(context,
                        () => Files.downloadAndOpen('/maintenance/permits/${p['id']}/permit.pdf', 'Permit-${p['permit_number']}.pdf')),
                  ),
                ]),
              ],
            ),
          ),
      ],
    );
  }
}

// ── Purchase requisitions from the job ───────────────────────────────────────

const _prStatusHex = {
  'submitted': kAmber, 'approved': kBlue, 'po_raised': kPurple, 'received': kGreen, 'closed': kTeal, 'rejected': kRed, 'cancelled': kGrey,
};
const _purposeLabels = {'spares': 'Spares (out of stock)', 'external_service': 'Outside repair / service'};
const _categories = [
  ('OTH', 'Others'), ('MKT', 'Market Items'), ('PNH', 'Pneumatic & Hydraulic'), ('ELE', 'Electrical'),
  ('HWC', 'Hardware & Consumables'), ('RAW', 'Raw Material'), ('JOB', 'Job Work'),
];

class _PrLine {
  int? item;
  final qty = TextEditingController(text: '1');
}

/// PRs raised from this job - out-of-stock spares or an outside repair.
class PurchaseSection extends StatefulWidget {
  const PurchaseSection({super.key, required this.woId, required this.woStatus, required this.onChanged});
  final int woId;
  final String woStatus;
  final VoidCallback onChanged;

  @override
  State<PurchaseSection> createState() => _PurchaseSectionState();
}

class _PurchaseSectionState extends State<PurchaseSection> {
  Json? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = asMap(await Api.get('/maintenance/work-orders/${widget.woId}/purchase-requests'));
      if (mounted) {
        setState(() {
          _data = d;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _raise() async {
    var purpose = 'spares';
    var category = 'OTH';
    var priority = 'standard';
    DateTime? required;
    final reason = TextEditingController();
    final lines = <_PrLine>[_PrLine()];
    final saved = await showFormSheet(
      context,
      title: 'Raise purchase requisition',
      saveLabel: 'Raise PR',
      builder: (ctx, setS) => [
        hintText('Goes through the normal Procurement approval; an outside-service bill is costed to this job.'),
        sheetSection('Requisition'),
        AppSelect<String>(
          label: 'For',
          value: purpose,
          clearable: false,
          options: [for (final e in _purposeLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() {
            purpose = o?.value ?? purpose;
            for (final l in lines) {
              l.item = null;
            }
          }),
        ),
        AppSelect<String>(
          label: 'Category',
          value: category,
          clearable: false,
          options: [for (final (v, l) in _categories) Option(v, l)],
          onChanged: (o) => setS(() => category = o?.value ?? category),
        ),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: optionsOf(priorityLabels),
          onChanged: (o) => setS(() => priority = o?.value ?? priority),
        ),
        DateField(label: 'Required by', value: required, onChanged: (d) => setS(() => required = d)),
        sheetSection(purpose == 'external_service' ? 'Services (Item Master type Service)' : 'Spares (from the Item Master)'),
        for (var i = 0; i < lines.length; i++)
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              flex: 3,
              child: AppSelect<int>(
                key: ValueKey('prl-$i-$purpose'),
                label: 'Item',
                value: lines[i].item,
                valueLabel: lines[i].item == null
                    ? null
                    : '${storeItemCache[lines[i].item]?['item_code'] ?? ''} — ${storeItemCache[lines[i].item]?['item_name'] ?? ''}',
                loadOptions: (q) => loadStoreItemOptions(q, where: (it) {
                  final service = str(it['item_type']).toLowerCase() == 'service';
                  return purpose == 'external_service' ? service : !service;
                }),
                onChanged: (o) => setS(() => lines[i].item = o?.value),
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(width: 80, child: AppTextField(label: 'Qty', controller: lines[i].qty, keyboardType: AppTextField.number)),
            if (lines.length > 1)
              IconButton(icon: const Icon(Icons.close_rounded, color: kRed), onPressed: () => setS(() => lines.removeAt(i))),
          ]),
        Align(alignment: Alignment.centerLeft, child: smallBtn('+ Add line', () => setS(() => lines.add(_PrLine())))),
        sheetSection('Reason', extra: '(optional)'),
        AppTextField(label: 'Reason', controller: reason, maxLines: 2),
      ],
      onSave: () async {
        await Api.post('/maintenance/work-orders/${widget.woId}/raise-pr', data: {
          'purpose': purpose,
          'category_code': category,
          'priority': priority,
          'required_date': required == null ? null : apiDate(required!),
          'reason': reason.text,
          'items': [for (final l in lines) {'store_item_id': l.item, 'quantity': num.tryParse(l.qty.text.trim()) ?? 0}],
        });
      },
    );
    reason.dispose();
    for (final l in lines) {
      l.qty.dispose();
    }
    if (saved) {
      _load();
      widget.onChanged();
    }
  }

  @override
  Widget build(BuildContext context) {
    final canRaise = Mt.can('work_orders', 'edit') &&
        Mt.feat('work_orders', 'purchase', 'create') &&
        const ['draft', 'assigned', 'in_progress', 'on_hold'].contains(widget.woStatus);
    final showCosts = Mt.showCosts;
    final d = _data;
    final prs = asList(d?['purchase_requests']);
    return DetailSection(
      'Purchase requisitions',
      action: canRaise ? smallBtn('+ Raise PR', _raise) : null,
      children: [
        if (showCosts && d != null && ((asNum(d['service_committed']) ?? 0) > 0 || (asNum(d['procured_cost']) ?? 0) > 0))
          hintText('Outside service: ${formatInr(d['service_committed'])} on PO · ${formatInr(d['service_invoiced'])} billed (costed to this job)'),
        if (_error != null) ErrorBanner(_error!),
        if (d != null && prs.isEmpty) mutedText('No PRs raised from this job.'),
        for (final pr in prs)
          LineItem(
            title: str(pr['p2p_number']),
            subtitle: [
              _purposeLabels[pr['purpose']] ?? str(pr['purpose']),
              for (final l in asList(pr['lines'])) '${l['item_name']} × ${fmtQty(l['quantity'])} ${str(l['unit'])}'.trim(),
            ].join('\n'),
            badges: [
              Pill(str(pr['status']).replaceAll('_', ' '), _prStatusHex[pr['status']] ?? kGrey),
              for (final po in asList(pr['purchase_orders']))
                Text(
                  '${po['po_number']} · ${txt(po['vendor_name'])} · ${str(po['status']).replaceAll('_', ' ')}'
                  '${showCosts ? ' · ${formatInr(po['total_value'])}${(asNum(po['invoiced_amount']) ?? 0) > 0 ? ' (billed ${formatInr(po['invoiced_amount'])})' : ''}' : ''}',
                  style: const TextStyle(fontSize: 12, color: Brand.body),
                ),
            ],
          ),
      ],
    );
  }
}
