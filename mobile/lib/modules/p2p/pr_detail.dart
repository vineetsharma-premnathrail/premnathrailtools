import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';
import 'pr_actions.dart';
import 'pr_form.dart';
import 'rfq.dart';

// One purchase requisition (portal app/dashboard/p2p/[id]/page.tsx): what is
// needed, who approves it, the buying progress, RFQs, the PO and its approval.

const _fulfillLabels = {'pending': 'Awaiting Decision', 'stock_issued': 'Issued from Stock', 'sent_to_procurement': 'In Procurement'};
const _fulfillHex = {'pending': 0xFFF59E0B, 'stock_issued': 0xFF22C55E, 'sent_to_procurement': 0xFF3B82F6};
const _stockLabels = {'in_stock': 'In Stock', 'partial': 'Partial', 'not_in_stock': 'Not in Stock', 'no_match': 'Not linked to Item Master'};
const _stockHex = {'in_stock': 0xFF16A34A, 'partial': 0xFFF59E0B, 'not_in_stock': 0xFFDC2626, 'no_match': 0xFF94A3B8};
const _cancellable = [
  'submitted', 'returned', 'approved', 'vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected', 'po_drafted',
];
const _procurementOpen = [
  'approved', 'vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected', 'po_drafted', 'po_raised',
  'po_approved', 'partially_received',
];
const _rfqLabels = {'draft': 'Draft', 'locked': 'Sent to vendors', 'cancelled': 'Cancelled'};
const _rfqHex = {'draft': 0xFF64748B, 'locked': 0xFF6366F1, 'cancelled': 0xFF94A3B8};
const _poLabels = {
  'draft': 'Draft', 'issued': 'Issued', 'acknowledged': 'Acknowledged by vendor', 'partially_fulfilled': 'Partially received',
  'fulfilled': 'Fully received', 'cancelled': 'Cancelled',
};
const _poHex = {
  'draft': 0xFF64748B, 'issued': 0xFF3B82F6, 'acknowledged': 0xFF0EA5E9, 'partially_fulfilled': 0xFFD97706, 'fulfilled': 0xFF16A34A,
  'cancelled': 0xFF94A3B8,
};

class PrDetailScreen extends StatefulWidget {
  const PrDetailScreen({super.key, required this.prId, this.contextKey, this.poId});
  final int prId;

  /// 'approval' / 'po-approval' when opened from an approval queue (portal ?from=).
  final String? contextKey;

  /// PO to show first (a split requisition has several).
  final int? poId;

  @override
  State<PrDetailScreen> createState() => _PrDetailScreenState();
}

class _PrDetailScreenState extends State<PrDetailScreen> {
  Json? _pr;
  Object? _error;
  bool _busy = false;
  List<Json> _rfqs = [];
  List<Json> _pos = [];
  Json? _loadedPo;
  int? _pickedPo;
  List<Json> _history = [];
  final _stock = <int, Object>{}; // item id -> check Json | error String
  final _issueLoc = <int, int>{};
  final _issueQty = <int, TextEditingController>{};
  int _trackerKey = 0;
  String _poNotice = '';

  bool get _viaPrTab => P2pAccess.can('purchase_requisitions', 'view');
  bool _prFeature(String f, String a) => !_viaPrTab || P2pAccess.feat('purchase_requisitions', f, a);
  bool get _seeHistory => _prFeature('history', 'view');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final pr = asJson(await Api.get('/p2p/requests/${widget.prId}'));
      final id = jInt(pr, 'id');
      final results = await Future.wait([
        Api.get('/p2p/rfqs', query: {'p2p_request_id': id}).catchError((_) => <dynamic>[]),
        Api.get('/p2p/purchase-orders', query: {'p2p_request_id': id}).catchError((_) => <dynamic>[]),
        _seeHistory ? Api.get('/p2p/requests/$id/audit').catchError((_) => <dynamic>[]) : Future.value(<dynamic>[]),
      ]);
      final rfqs = ApiPage.from(results[0]).rows
        ..sort((a, b) => (jStr(a, 'rfq_number') ?? '').compareTo(jStr(b, 'rfq_number') ?? ''));
      final allPos = ApiPage.from(results[1]).rows;
      final live = allPos.where((p) => jStr(p, 'status') != 'cancelled').toList();
      if (!mounted) return;
      setState(() {
        _pr = pr;
        _error = null;
        _rfqs = rfqs;
        _pos = live;
        _loadedPo = pr['purchase_order'] is Map ? asJson(pr['purchase_order']) : (live.firstOrNull ?? allPos.firstOrNull);
        _history = asList(results[2]).reversed.toList();
        _stock.clear();
        _trackerKey++;
      });
      _runStockChecks();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Json? get _po {
    final want = _pickedPo ?? widget.poId;
    return _pos.where((p) => jInt(p, 'id') == want).firstOrNull ?? _loadedPo;
  }

  bool get _isPurchase => P2pAccess.isPurchaseTeam;

  bool get _canIssueStock =>
      (P2pAccess.isAdmin ||
          jList(_pr, 'approvals').any((a) => jStr(a, 'role') == 'store_manager' && jInt(a, 'approver_id') == P2pAccess.me)) &&
      _prFeature('fulfilment', 'create');

  void _runStockChecks() {
    final pr = _pr;
    if (pr == null) return;
    final u = P2pAccess.user;
    final status = jStr(pr, 'status');
    final can = (_isPurchase || P2pAccess.isAdmin || u['is_store_manager'] == true) &&
        _prFeature('fulfilment', 'view') &&
        !['submitted', 'rejected', 'cancelled'].contains(status);
    if (!can) return;
    for (final it in jList(pr, 'items')) {
      if (jStr(it, 'fulfillment_status') != 'pending') continue;
      final itemId = jInt(it, 'id')!;
      Api.get('/p2p/requests/${widget.prId}/items/$itemId/stock-check').then((r) {
        final j = asJson(r);
        if (!mounted) return;
        setState(() {
          _stock[itemId] = j;
          _issueQty[itemId] = TextEditingController(text: fmtQty(j['requested_qty']).replaceAll(',', ''));
        });
      }).catchError((e) {
        if (mounted) setState(() => _stock[itemId] = ApiClient.describe(e));
      });
    }
  }

  Future<void> _act(Future<void> Function() fn, {String? success}) async {
    setState(() => _busy = true);
    final ok = await runAction(context, fn, success: success);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) await _load();
  }

  Future<void> _prompt({
    required String title,
    required String label,
    required String confirm,
    required bool required,
    String? hint,
    required Future<void> Function(String v) run,
    String? success,
  }) async {
    final pr = _pr!;
    final sub = jStr(pr, 'category_code') == 'ITM' ? '${pr['p2p_number']}' : '${pr['p2p_number']} · ${pr['category_label'] ?? pr['category_code']}';
    final v = await promptDialog(context,
        title: title, message: [sub, ?hint].join('\n'), label: label, required: required, confirmLabel: confirm);
    if (v == null || !mounted) return;
    await _act(() => run(v), success: success);
  }

  List<int> _pendingPoIds(Json pr) {
    final e = pr['engine_approval'] is Map ? asJson(pr['engine_approval']) : null;
    if (e == null) return const [];
    final ids = (e['pending_po_ids'] is List) ? (e['pending_po_ids'] as List).whereType<int>().toList() : <int>[];
    if (ids.isNotEmpty) return ids;
    final one = jInt(e, 'po_id');
    return one == null ? const [] : [one];
  }

  @override
  Widget build(BuildContext context) {
    final pr = _pr;
    if (pr == null) {
      return SubPage(
        title: 'Purchase requisition',
        body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView(),
      );
    }
    final id = jInt(pr, 'id')!;
    final status = jStr(pr, 'status') ?? '';
    final me = P2pAccess.me;
    final isAdmin = P2pAccess.isAdmin;
    final st = prDisplayStatus(pr);
    final items = jList(pr, 'items');
    final canEditPr = P2pAccess.can('purchase_requisitions', 'edit');
    final engine = pr['engine_approval'] is Map ? asJson(pr['engine_approval']) : null;
    final prViaEngine = engine?['pr_request_id'] != null;
    final poViaEngine = engine?['po_id'] != null;

    // Approval roles (matrix or legacy head columns).
    final approvals = jList(pr, 'approvals');
    final roles = approvals.isNotEmpty
        ? [
            for (final a in approvals)
              (
                role: jStr(a, 'role') ?? '',
                label: jStr(a, 'role_label') ?? p2pRoleLabel(jStr(a, 'role')),
                id: jInt(a, 'approver_id'),
                name: jStr(a, 'approver_name'),
                at: a['approved_at'],
                comment: jStr(a, 'comment'),
              ),
          ]
        : [
            (role: 'department_head', label: 'Department Head', id: jInt(pr, 'approver_id'), name: jStr(pr, 'approver_name'),
              at: pr['department_head_approved_at'], comment: jStr(pr, 'department_head_comment')),
            (role: 'project_head', label: 'Project Head', id: jInt(pr, 'project_head_id'), name: jStr(pr, 'project_head_name'),
              at: pr['project_head_approved_at'], comment: jStr(pr, 'project_head_comment')),
            (role: 'plant_head', label: 'Plant Head', id: jInt(pr, 'plant_head_id'), name: jStr(pr, 'plant_head_name'),
              at: pr['plant_head_approved_at'], comment: jStr(pr, 'plant_head_comment')),
          ];
    final hasHeads = roles.any((r) => r.id != null);
    final myPending = roles.any((r) => r.id != null && r.id == me && r.at == null);
    final canApproveOrReject = status == 'submitted' &&
        (hasHeads ? (myPending || isAdmin) : _isPurchase && P2pAccess.can('purchase_requisitions', 'approve'));
    final canRejectAccess = status == 'submitted' &&
        (hasHeads ? (roles.any((r) => r.id != null && r.id == me) || isAdmin) : _isPurchase && P2pAccess.can('purchase_requisitions', 'reject'));
    final fromApproval = widget.contextKey == 'approval';
    final fromPoApproval = widget.contextKey == 'po-approval';
    final canApproveReject = fromApproval && canApproveOrReject && !prViaEngine;
    final canRejectStill = fromApproval && canRejectAccess && !prViaEngine;
    final pendingPoRoles = jStrings(pr, 'pending_po_approval_roles');
    final myPoRoles = userPoRoles(pr).where(pendingPoRoles.contains).toList();
    final canApprovePo = fromPoApproval && status == 'po_raised' && myPoRoles.isNotEmpty && !poViaEngine;
    final poBlocked = poViaEngine || !fromPoApproval || status != 'po_raised' || canApprovePo
        ? null
        : userPoRoles(pr).isEmpty
            ? 'Only the PO approvers picked on this requisition, or a Director, can approve this PO.'
            : 'You have already acted on this PO, or it is no longer pending your approval.';
    final canRejectPo = fromPoApproval && status == 'po_raised' && (userPoRoles(pr).isNotEmpty || isAdmin) && !poViaEngine;
    final cancelAfterPo = status == 'po_approved';
    final canCancel = P2pAccess.can('purchase_requisitions', 'cancel') &&
        (cancelAfterPo ? _isPurchase : (_isPurchase || jInt(pr, 'requested_by_id') == me) && _cancellable.contains(status));
    final isShortClose = status == 'partially_received';
    final canResubmit = status == 'returned' &&
        P2pAccess.can('purchase_requisitions', 'submit') &&
        (_isPurchase || jInt(pr, 'requested_by_id') == me);
    final isDraft = status == 'draft';
    final isMyDraft = isDraft && jInt(pr, 'requested_by_id') == me;
    final canEditContent = isDraft && jBool(pr, 'can_edit');
    final editLock = !jBool(pr, 'can_edit') && isDraft ? jStr(pr, 'edit_block_reason') : null;
    final canClose = _isPurchase && canEditPr && _prFeature('close', 'edit') && (status == 'received' || isShortClose);
    final poArg = status == 'po_raised' && _po != null && _pendingPoIds(pr).contains(jInt(_po, 'id')) ? jInt(_po, 'id') : null;

    final actions = <Widget>[
      if (canApproveReject)
        primaryBtn('Approve', _busy
            ? null
            : () => _prompt(
                title: 'Approve this Purchase Requisition?',
                label: 'Comment',
                confirm: 'Approve',
                required: true,
                hint: 'Your comment is recorded on the approval trail.',
                success: 'Requisition approved.',
                run: (v) => Api.post('/p2p/requests/$id/approve', data: {'comment': v}))),
      if (canApprovePo)
        primaryBtn('Approve PO', _busy
            ? null
            : () => _prompt(
                title: 'Approve this PO?',
                label: 'Comment',
                confirm: 'Approve PO',
                required: true,
                hint: 'Your comment is recorded on the approval trail.',
                success: 'PO approved.',
                run: (v) => Api.post('/p2p/requests/$id/approve-po', data: {'comment': v, 'po_id': poArg}))),
      if (canRejectStill || canRejectPo)
        dangerBtn('Reject', _busy
            ? null
            : () => _prompt(
                title: 'Reject this Purchase Requisition?',
                label: 'Reason for rejecting',
                confirm: 'Reject',
                required: false,
                hint: 'Why it is rejected — the requester sees this.',
                success: 'Rejected.',
                run: (v) => Api.post('/p2p/requests/$id/reject', data: {'reason': v.isEmpty ? null : v, 'po_id': poArg}))),
      if (canResubmit)
        primaryBtn('Resubmit for Approval', _busy ? null : () => _act(() => Api.post('/p2p/requests/$id/submit'), success: 'Sent for approval.')),
      if (isMyDraft)
        primaryBtn('Submit for Approval', _busy ? null : () => _act(() => Api.post('/p2p/requests/$id/submit'), success: 'Sent for approval.')),
      if (canEditContent)
        secondaryBtn('Edit Draft', _busy
            ? null
            : () async {
                final saved = await openPrForm(context, editId: id);
                if (saved != null) _load();
              }),
      if (isMyDraft)
        dangerBtn('Discard Draft', _busy
            ? null
            : () async {
                final yes = await confirmDialog(context,
                    title: 'Discard this draft?',
                    message: "Draft ${pr['p2p_number']} and everything in it will be deleted. This can't be undone.",
                    confirmLabel: 'Discard Draft',
                    danger: true);
                if (!yes || !context.mounted) return;
                final ok = await runAction(context, () => Api.delete('/p2p/requests/$id'), success: 'Draft discarded.');
                if (ok && context.mounted) Navigator.pop(context);
              }),
      if (canClose)
        primaryBtn(isShortClose ? 'Short-close Requisition' : 'Close Requisition', _busy
            ? null
            : () async {
                if (isShortClose) {
                  await _prompt(
                      title: 'Short-close this Requisition?',
                      label: 'Reason',
                      confirm: 'Short-close',
                      required: true,
                      hint: "Only part of the order has been received. Short-closing writes off the balance: no more goods can be received against this PO, and the requisition can't be reopened.",
                      success: 'Requisition short-closed.',
                      run: (v) => Api.post('/p2p/requests/$id/close', data: {'reason': v}));
                } else {
                  final yes = await confirmDialog(context,
                      title: 'Close this Requisition?',
                      message: "Every ordered item has been received. Closing marks the requisition complete — it can't be reopened.",
                      confirmLabel: 'Close Requisition');
                  if (yes) _act(() => Api.post('/p2p/requests/$id/close'), success: 'Requisition closed.');
                }
              }),
      if (canCancel)
        dangerBtn('Cancel Requisition', _busy
            ? null
            : () => _prompt(
                title: 'Cancel this Purchase Requisition?',
                label: 'Reason for cancelling',
                confirm: 'Cancel Requisition',
                required: cancelAfterPo,
                hint: cancelAfterPo
                    ? 'The PO is already approved and with the vendor. Cancelling also cancels the PO — tell the vendor. The reason is recorded on the PO and the requisition history.'
                    : null,
                success: 'Requisition cancelled.',
                run: (v) => Api.post('/p2p/requests/$id/cancel', data: {'reason': v.isEmpty ? null : v}))),
    ];

    final lineBuyers = items.map((it) => jStr(it, 'buyer_name') ?? jStr(pr, 'assigned_buyer_name')).whereType<String>().toSet().toList();
    final purpose = jStr(pr, 'purpose');

    return SubPage(
      title: '${pr['p2p_number']}',
      bottom: actionBar(actions),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 24),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Hint('Purchase requisition — what is needed, who approves it, and how it is being bought.'),
            ),
            if (poBlocked != null)
              Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: NoteBox("Approve PO isn't available to you: $poBlocked", tone: NoteTone.warn)),
            if (isDraft)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16),
                child: NoteBox(
                    "This is a draft — only you can see it, and nobody has been asked to approve it. Tap Submit for Approval when it's ready."),
              ),
            if (editLock != null)
              Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: NoteBox('Editing is locked: $editLock', tone: NoteTone.warn)),
            DetailSection(purposeLabels[purpose] ?? jStr(pr, 'category_label') ?? jStr(pr, 'category_code') ?? 'Requisition', children: [
              Text(
                '${jStr(pr, 'requested_by_name') ?? 'Someone'}${jStr(pr, 'department') != null ? ' (${pr['department']})' : ''} asked for '
                '${items.length} item${items.length == 1 ? '' : 's'}${jStr(pr, 'project_label') != null ? ' for ${pr['project_label']}' : ''}'
                '${pr['required_date'] != null ? ', needed by ${fmtDate(pr['required_date'])}' : ''}.',
              ),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Pill(st.label, st.color),
                if (pr['priority'] != null)
                  Pill('${priorityLabel(pr['priority'])} priority', isUrgent(pr['priority']) ? const Color(0xFFDC2626) : const Color(0xFF64748B)),
                Hint('Raised ${fmtDate(pr['request_date'])}'),
                if (jStr(pr, 'assigned_buyer_name') != null) Hint('· Buyer ${pr['assigned_buyer_name']}'),
              ]),
              const Divider(height: 24),
              const Caps('What it is for'),
              FieldRow('Purpose', purpose == null ? null : purposeLabels[purpose] ?? purpose),
              if (jStr(pr, 'category_code') != 'ITM') FieldRow('Category', jStr(pr, 'category_label') ?? jStr(pr, 'category_code')),
              FieldRow(
                  'Charged to',
                  pr['rnd_project_id'] != null
                      ? 'R&D project: ${jStr(pr, 'rnd_project_label') ?? '#${pr['rnd_project_id']}'}'
                      : jStr(pr, 'project_label')),
              if (jStr(pr, 'order_project_number') != null) FieldRow('Project', pr['order_project_number']),
              FieldRow('Requirement type', jStr(pr, 'requirement_type')),
              const Divider(height: 24),
              const Caps('People & dates'),
              FieldRow('Requested by',
                  jStr(pr, 'requested_by_name') == null ? null : '${pr['requested_by_name']}${jStr(pr, 'department') != null ? ' · ${pr['department']}' : ''}'),
              FieldRow(lineBuyers.length > 1 ? 'Buyers' : 'Buyer', lineBuyers.length > 1 ? lineBuyers.join(', ') : jStr(pr, 'assigned_buyer_name')),
              FieldRow('Request date', fmtDate(pr['request_date'])),
              FieldRow('Required by', pr['required_date'] == null ? null : fmtDate(pr['required_date'])),
              if (jStr(pr, 'remarks') != null) FieldRow('Remarks', pr['remarks']),
            ]),
            if (prViaEngine)
              EngineApprovalSection(entityType: 'p2p_request', entityId: id, onChanged: _load)
            else
              _legacyApproval(pr, roles.map((r) => (r.role, r.label, r.id, r.name, r.at, r.comment)).toList()),
            _itemsSection(pr, items),
            if (!isDraft)
              TrackerSection(
                key: ValueKey('tracker-$_trackerKey'),
                prId: id,
                canReassign: _isPurchase &&
                    (isAdmin || P2pAccess.feat('purchase_requisitions', 'all_lines', 'edit')) &&
                    _procurementOpen.contains(status) &&
                    canEditPr &&
                    P2pAccess.feat('purchase_requisitions', 'buyer', 'edit'),
                canShortClose: _isPurchase && _procurementOpen.contains(status) && canEditPr && P2pAccess.feat('purchase_requisitions', 'close', 'edit'),
                allLines: isAdmin || P2pAccess.feat('purchase_requisitions', 'all_lines', 'edit'),
                rfqLinkable: _isPurchase && P2pAccess.can('rfq', 'view'),
                onChanged: _load,
              ),
            ..._rfqSections(pr),
            ..._poSections(pr),
            if (jList(pr, 'attachments').isNotEmpty && _prFeature('attachments', 'view'))
              DetailSection('Attachments', children: [
                for (final a in jList(pr, 'attachments'))
                  linkBtn('${a['filename']} (${a['doc_type']})',
                      () => openApiFile(context, '/p2p/requests/$id/attachments/${a['id']}/content', '${a['filename']}'),
                      color: Brand.heading),
              ]),
            if (_seeHistory && _history.isNotEmpty)
              DetailSection('History', children: [
                for (final h in _history)
                  Container(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.only(left: 10),
                    decoration: BoxDecoration(
                        border: Border(
                            left: BorderSide(color: jStr(h, 'document_name') != null ? const Color(0xFF2563EB) : Brand.border, width: 2))),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Hint(fmtDateTime(h['performed_at'])),
                      Text(jStr(h, 'summary') ?? '${h['performed_by']}: ${humanize(h['action'])}'),
                      if (jStr(h, 'document_name') != null && P2pAccess.feat('purchase_orders', 'po_document', 'view'))
                        linkBtn('Open PO PDF', () => openApiFile(context, '/p2p/requests/$id/audit/${h['id']}/document', '${h['document_name']}')),
                    ]),
                  ),
              ]),
          ],
        ),
      ),
    );
  }

  Widget _legacyApproval(Json pr, List<(String, String, int?, String?, Object?, String?)> roles) {
    final status = jStr(pr, 'status');
    final rejectedRole = status == 'rejected' ? jStr(pr, 'rejected_by_role') : null;
    final roleRows = [...roles.map((r) => r.$1), 'purchase_head', 'director', 'partner'];
    Widget pillFor(String role, Object? at) => rejectedRole == role
        ? const Pill('Rejected', Color(0xFFDC2626))
        : at != null
            ? const Pill('Approved', Color(0xFF16A34A))
            : const Pill('Pending', Color(0xFF64748B));
    return DetailSection('Approval', children: [
      for (final r in roles)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Caps(r.$2),
            if (r.$3 == null)
              const Hint('— not assigned')
            else ...[
              Wrap(spacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Text((rejectedRole == r.$1 ? jStr(pr, 'rejected_by_name') : null) ?? r.$4 ?? '—'),
                pillFor(r.$1, r.$5),
              ]),
              if ((rejectedRole == r.$1 ? jStr(pr, 'rejected_reason') ?? r.$6 : r.$6) != null)
                Text('"${rejectedRole == r.$1 ? jStr(pr, 'rejected_reason') ?? r.$6 : r.$6}"',
                    style: const TextStyle(fontStyle: FontStyle.italic, fontSize: 12.5, color: Brand.muted)),
            ],
          ]),
        ),
      if (status == 'cancelled')
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Caps('Cancelled'),
          const Pill('Cancelled', Color(0xFF64748B)),
          if (jStr(pr, 'cancelled_reason') != null) Text('"${pr['cancelled_reason']}"', style: const TextStyle(fontStyle: FontStyle.italic)),
        ])
      else if (status == 'rejected' && !roleRows.contains(rejectedRole ?? ''))
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Caps('Rejected'),
          Wrap(spacing: 6, children: [Text(jStr(pr, 'rejected_by_name') ?? '—'), const Pill('Rejected', Color(0xFFDC2626))]),
          if (jStr(pr, 'rejected_reason') != null) Text('"${pr['rejected_reason']}"', style: const TextStyle(fontStyle: FontStyle.italic)),
        ]),
    ]);
  }

  Widget _itemsSection(Json pr, List<Json> items) {
    final status = jStr(pr, 'status') ?? '';
    final canEditPr = P2pAccess.can('purchase_requisitions', 'edit');
    final canManage = _prFeature('fulfilment', 'view') &&
        ((_isPurchase && canEditPr) || _canIssueStock) &&
        !['draft', 'submitted', 'returned', 'rejected', 'cancelled', 'closed'].contains(status);
    final seeAtt = _prFeature('attachments', 'view');
    final checked = items.map((it) => jStr(it, 'stock_checked_at')).whereType<String>().toList()..sort();
    return DetailSection('Item Details', children: [
      if (items.any((it) => it['stock_status'] != null))
        Hint('${items.where((it) => jStr(it, 'stock_status') == 'in_stock').length} of ${items.length} line(s) available in store stock'
            '${checked.isNotEmpty ? ' · checked ${fmtDateTime(checked.last)}' : ''}'
            '${status == 'submitted' ? ' — re-checked automatically at approval.' : '.'}'),
      const SizedBox(height: 8),
      for (var i = 0; i < items.length; i++) _itemCard(pr, items[i], i, canManage, seeAtt),
    ]);
  }

  Widget _itemCard(Json pr, Json it, int idx, bool canManage, bool seeAtt) {
    final fs = jStr(it, 'fulfillment_status') ?? '';
    final stock = jStr(it, 'stock_status');
    final itemId = jInt(it, 'id')!;
    return InnerCard(children: [
      Text('${idx + 1}. ${jStr(it, 'item_code') != null ? '${it['item_code']} — ' : ''}${it['item_name']}',
          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
      const SizedBox(height: 8),
      MiniGrid([
        MiniField('Make', jStr(it, 'make')),
        MiniField('Part Code', jStr(it, 'part_code')),
        MiniField('UOM', jStr(it, 'unit')),
        MiniField('Qty', fmtQty(it['quantity'])),
        MiniField('Project / Inhouse',
            '${jStr(it, 'project_inhouse') ?? '—'}${jStr(it, 'order_project_number') != null ? '\n${it['order_project_display'] ?? it['order_project_number']}' : ''}'),
        MiniField('Category', jStr(it, 'category')),
        MiniField('Buyer', jStr(it, 'buyer_name') ?? jStr(pr, 'assigned_buyer_name')),
        MiniField('Ship To', jStr(it, 'ship_to')),
        MiniField(
            'Stock',
            stock == null
                ? const Hint('—')
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Pill(_stockLabels[stock] ?? stock, Color(_stockHex[stock] ?? 0xFF64748B)),
                    if (stock == 'partial' && it['stock_available_qty'] != null)
                      Hint('${fmtQty(it['stock_available_qty'])} of ${fmtQty(it['quantity'])} available'),
                  ])),
        MiniField(
            'Fulfillment',
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Pill(_fulfillLabels[fs] ?? fs, Color(_fulfillHex[fs] ?? 0xFF64748B)),
              if (fs == 'sent_to_procurement' && jD(it, 'issued_qty') > 0)
                Hint('${fmtQty(it['issued_qty'])} issued from stock · buying ${fmtQty(jD(it, 'quantity') - jD(it, 'issued_qty'))}'),
              if (fs == 'stock_issued') Hint('${fmtQty(it['issued_qty'])} ${jStr(it, 'unit') ?? ''} @ ${jStr(it, 'issued_from_location_name') ?? '—'}'),
            ])),
      ]),
      if (seeAtt && jList(it, 'attachments').isNotEmpty) ...[
        const SizedBox(height: 6),
        for (final a in jList(it, 'attachments'))
          linkBtn('${a['filename']}', () => openApiFile(context, '/p2p/requests/${pr['id']}/attachments/${a['id']}/content', '${a['filename']}')),
      ],
      if (canManage && fs == 'pending') ...[const Divider(height: 20), _stockBlock(pr, it, itemId)],
    ]);
  }

  Widget _stockBlock(Json pr, Json it, int itemId) {
    final check = _stock[itemId];
    if (check == null) return const Hint('Checking store stock…');
    if (check is String) return Hint(check, color: Brand.danger);
    final c = check as Json;
    if (c['matched'] != true) return Hint(jStr(c, 'message') ?? 'No matching store item found.');
    final locs = jList(c, 'locations');
    final shipTo = c['ship_to_location'] is Map ? asJson(c['ship_to_location']) : null;
    final requested = jD(c, 'requested_qty');
    final shipToId = jInt(shipTo, 'location_id');
    final defLoc = shipToId != null && locs.any((l) => jInt(l, 'location_id') == shipToId) ? shipToId : jInt(locs.firstOrNull, 'location_id');
    final selId = _issueLoc[itemId] ?? defLoc;
    final sel = locs.where((l) => jInt(l, 'location_id') == selId).firstOrNull;
    final fully = locs.any((l) => jD(l, 'available_qty') >= requested);
    final maxIssue = requested < jD(sel, 'available_qty') ? requested : jD(sel, 'available_qty');
    final qtyCtrl = _issueQty[itemId] ??= TextEditingController(text: qtyText(maxIssue));
    final issueQty = double.tryParse(qtyCtrl.text) ?? maxIssue;
    final buyQty = requested - (issueQty > 0 ? issueQty : 0);
    final canSend = !fully && ((_isPurchase && P2pAccess.can('purchase_requisitions', 'edit')) || P2pAccess.isAdmin) && _prFeature('fulfilment', 'edit');
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      MiniGrid([
        MiniField('Matched Store Item', '${c['store_item_code']} — ${c['store_item_name']}'),
        MiniField('At Ship-To (${jStr(it, 'ship_to') ?? '—'})',
            shipTo != null ? '${fmtQty(shipTo['available_qty'])} available' : (jStr(it, 'ship_to') != null ? 'Not a store — pick one below' : 'Not set — pick a store below')),
        MiniField('Total (All Locations)', '${fmtQty(asJson(c['total_across_locations'])['available_qty'] ?? 0)} available'),
        MiniField('Requested Qty', fmtQty(requested)),
      ]),
      const SizedBox(height: 10),
      if (locs.isNotEmpty && _canIssueStock) ...[
        AppSelect<int>(
          label: 'Issue From',
          value: selId,
          clearable: false,
          options: [
            for (final l in locs)
              Option(jInt(l, 'location_id')!, '${jStr(l, 'location_name') ?? 'Location ${l['location_id']}'} — ${fmtQty(l['available_qty'])} available'),
          ],
          onChanged: (o) => setState(() {
            if (o != null) _issueLoc[itemId] = o.value;
          }),
        ),
        const SizedBox(height: 8),
        AppTextField(label: 'Issue Qty', controller: qtyCtrl, keyboardType: AppTextField.number, onChanged: (_) => setState(() {})),
        const SizedBox(height: 8),
      ],
      if (selId != null && !_canIssueStock)
        Hint('Waiting for the Store Manager to issue from stock${!fully ? ' — or send it to procurement' : ''}.'),
      Wrap(spacing: 8, runSpacing: 8, children: [
        if (selId != null && _canIssueStock)
          primaryBtn(buyQty > 0 ? 'Issue ${fmtQty(issueQty)} & Buy ${fmtQty(buyQty)}' : 'Issue from Stock', _busy
              ? null
              : () => _prompt(
                  title: 'Issue from Store Stock?',
                  label: 'Comment',
                  confirm: 'Issue',
                  required: true,
                  hint: 'Stock is deducted from the selected store. Your comment is recorded on the material issue and the requisition history.',
                  success: 'Issued from stock.',
                  run: (v) => Api.post('/p2p/requests/${pr['id']}/items/$itemId/issue-from-stock',
                      data: {'location_id': selId, if (issueQty > 0) 'quantity': issueQty, 'comment': v}))),
        if (canSend)
          secondaryBtn('Send to Procurement', _busy
              ? null
              : () async {
                  final yes = await confirmDialog(context,
                      title: 'Send Item to Procurement?',
                      message:
                          'This confirms the item is not available in store stock and will be purchased through the normal RFQ/PO flow. This cannot be undone.',
                      confirmLabel: 'Send to Procurement');
                  if (yes) _act(() => Api.post('/p2p/requests/${pr['id']}/items/$itemId/send-to-procurement'), success: 'Sent to procurement.');
                }),
      ]),
    ]);
  }

  bool _rfqIsMine(Json r) {
    final allLines = P2pAccess.isAdmin || P2pAccess.feat('purchase_requisitions', 'all_lines', 'edit');
    final owner = jInt(r, 'buyer_id') ?? jInt(r, 'created_by_id');
    return allLines || owner == null || owner == P2pAccess.me;
  }

  List<Widget> _rfqSections(Json pr) {
    final status = jStr(pr, 'status') ?? '';
    final open = _procurementOpen.contains(status);
    final allLines = P2pAccess.isAdmin || P2pAccess.feat('purchase_requisitions', 'all_lines', 'edit');
    final canUploadRole = _isPurchase &&
        open &&
        P2pAccess.can('purchase_orders', 'create') &&
        P2pAccess.can('purchase_orders', 'submit') &&
        P2pAccess.feat('purchase_orders', 'po_document', 'create');
    final canRaise = _isPurchase && open && P2pAccess.can('rfq', 'create') &&
        jList(pr, 'items').any((it) => jStr(it, 'fulfillment_status') == 'sent_to_procurement');
    final canOpen = _isPurchase && P2pAccess.can('rfq', 'view');
    final out = <Widget>[];
    if (_rfqs.isNotEmpty || canRaise) {
      out.add(DetailSection('RFQs',
          action: canRaise
              ? primaryBtn('Raise RFQ', _busy
                  ? null
                  : () async {
                      final rfqId = await openRaiseRfq(context, prId: jInt(pr, 'id'));
                      if (rfqId != null && mounted) {
                        _load();
                        if (mounted) openScreen(context, RfqDetailScreen(rfqId: rfqId));
                      }
                    })
              : null,
          children: [
            const Hint('Every buyer raises their own RFQ for the lines they buy, and uploads the POs of that RFQ.'),
            const SizedBox(height: 8),
            if (_rfqs.isEmpty)
              const Text('No RFQ has been raised on this requisition yet. A buyer picks their lines and raises one with Raise RFQ.'),
            for (final r in _rfqs) _rfqCard(pr, r, allLines, canUploadRole, canOpen),
          ]));
    }
    if (P2pAccess.feat('rfq', 'vendor_quotes', 'view')) {
      for (final r in _rfqs.where((r) => jList(r, 'attachments').isNotEmpty && _rfqIsMine(r))) {
        out.add(DetailSection('Vendor Quotations${_rfqs.length > 1 ? ' — ${r['rfq_number']}' : ''}', children: [
          for (final a in jList(r, 'attachments'))
            InnerCard(children: [
              Caps('${a['vendor_tier']}'),
              Text(jStr(a, 'vendor_name') ?? '—', style: const TextStyle(fontWeight: FontWeight.w600)),
              linkBtn('${a['filename']}', () => openApiFile(context, '/p2p/rfqs/${r['id']}/attachments/${a['id']}/content', '${a['filename']}')),
            ]),
        ]));
      }
    }
    return out;
  }

  Widget _rfqCard(Json pr, Json r, bool allLines, bool canUploadRole, bool canOpen) {
    final its = jList(r, 'items');
    final active = its.where((i) => i['withdrawn_at'] == null).toList();
    final moved = its.length - active.length;
    final readable = _rfqIsMine(r);
    final mine = jInt(r, 'buyer_id') != null && jInt(r, 'buyer_id') == P2pAccess.me;
    final rs = jStr(r, 'status') ?? '';
    final canUpload = canUploadRole && rs == 'locked' && (allLines || r['buyer_id'] == null || jInt(r, 'buyer_id') == P2pAccess.me);
    final who = jStr(r, 'buyer_name') ?? jStr(r, 'created_by_name');
    final awarded = jStrings(r, 'awarded_vendors');
    return InnerCard(children: [
      Row(children: [
        Expanded(child: Text('${r['rfq_number']}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading))),
        Pill(_rfqLabels[rs] ?? rs, Color(_rfqHex[rs] ?? 0xFF64748B)),
      ]),
      if (!readable) Hint('RFQ of ${who ?? 'another buyer'}'),
      Text('Buyer: ${who ?? '—'}${mine ? ' (you)' : ''}'),
      const SizedBox(height: 4),
      if (active.isEmpty)
        Hint(its.isNotEmpty ? 'No lines left — moved to another buyer or withdrawn' : 'All lines of the requisition')
      else ...[
        for (final i in active)
          Text('${jStr(i, 'item_code') != null ? '${i['item_code']} — ' : ''}${i['item_name']} × ${fmtQty(i['quantity'])} ${jStr(i, 'unit') ?? ''}',
              style: const TextStyle(fontSize: 13)),
        if (moved > 0) Hint('$moved line${moved == 1 ? '' : 's'} moved or withdrawn'),
      ],
      const SizedBox(height: 4),
      if (!readable)
        Hint('Quotes are kept by ${who ?? 'that buyer'}')
      else ...[
        Hint(rs == 'draft'
            ? 'Not sent yet'
            : (jInt(r, 'invite_count') ?? 0) > 0
                ? '${r['invite_count']} asked${(jInt(r, 'awarded_line_count') ?? 0) > 0 ? ' · ${r['awarded_line_count']} line${r['awarded_line_count'] == 1 ? '' : 's'} awarded' : ''}'
                : jList(r, 'attachments').isNotEmpty
                    ? '${jList(r, 'attachments').length} quotation file(s)'
                    : '—'),
        if (awarded.isNotEmpty) Hint('Awarded: ${awarded.join(', ')}'),
      ],
      const SizedBox(height: 6),
      Wrap(spacing: 8, children: [
        if (canOpen && readable)
          secondaryBtn('Open', () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => RfqDetailScreen(rfqId: jInt(r, 'id')!)));
            _load();
          }),
        if (canUpload)
          primaryBtn('Upload PO', _busy
              ? null
              : () async {
                  final ok = await uploadPo(context, r, pr);
                  if (ok && mounted) {
                    showSnack(context, 'PO uploaded and sent for approval.');
                    _load();
                  }
                }),
      ]),
    ]);
  }

  List<Widget> _poSections(Json pr) {
    final out = <Widget>[];
    final po = _po;
    final status = jStr(pr, 'status') ?? '';
    final seePo = _prFeature('purchase_order', 'view');
    final seePrices = _viaPrTab ? P2pAccess.feat('purchase_requisitions', 'prices', 'view') : P2pAccess.feat('purchase_orders', 'prices', 'view');
    final seeDoc = P2pAccess.feat('purchase_orders', 'po_document', 'view');
    final lines = jList(po, 'items');
    if (seePo && po != null) {
      final poId = jInt(po, 'id')!;
      final ps = jStr(po, 'status') ?? '';
      final draftRfq = ps == 'draft' && po['rfq_id'] != null ? _rfqs.where((r) => jInt(r, 'id') == jInt(po, 'rfq_id')).firstOrNull : null;
      final canDiscard = draftRfq != null &&
          _isPurchase &&
          P2pAccess.can('purchase_orders', 'edit') &&
          _rfqIsMine(draftRfq) &&
          _procurementOpen.contains(status);
      final canLink = _isPurchase &&
          P2pAccess.can('purchase_orders', 'edit') &&
          P2pAccess.feat('purchase_orders', 'link_item', 'edit') &&
          !['fulfilled', 'cancelled'].contains(ps);
      final total = po['total_value'] ?? (lines.isNotEmpty ? lines.fold<double>(0, (s, l) => s + jD(l, 'line_total')) : pr['po_value']);
      final docRfq = jInt(po, 'rfq_id') ?? jInt(_rfqs.firstOrNull, 'id');
      out.add(DetailSection('Purchase Order ${po['po_number']}', children: [
        if (_pos.length > 1) ...[
          Hint('This requisition was split into ${_pos.length} purchase orders — pick one:'),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final x in _pos)
              ChoiceChip(
                label: Text('${x['po_number']}${jStr(x, 'vendor_name') != null ? ' · ${x['vendor_name']}' : ''}'),
                selected: jInt(x, 'id') == poId,
                onSelected: (_) => setState(() => _pickedPo = jInt(x, 'id')),
              ),
          ]),
          const SizedBox(height: 8),
        ],
        if (_poNotice.isNotEmpty) NoteBox(_poNotice, tone: NoteTone.ok),
        if (canDiscard)
          NoteBox('This PO is a draft (not sent for approval). If it is no longer wanted, discard it and its quantity goes back to open.',
              child: Align(
                alignment: Alignment.centerRight,
                child: dangerBtn('Discard draft PO', () async {
                  final ok = await discardPoDraft(context,
                      rfqId: jInt(draftRfq, 'id')!, poId: poId, poNumber: '${po['po_number']}', vendorName: jStr(po, 'vendor_name'));
                  if (ok && mounted) {
                    setState(() => _poNotice =
                        'Draft PO ${po['po_number']} discarded. Its quantity is open to order again and its Tally number can be used again.');
                    _load();
                  }
                }),
              )),
        Text('Order placed with ${jStr(po, 'vendor_name') ?? 'the vendor'} for ${lines.isEmpty ? 'the' : lines.length} line${lines.length == 1 ? '' : 's'} of this requisition.'),
        const SizedBox(height: 6),
        Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Pill(_poLabels[ps] ?? ps, Color(_poHex[ps] ?? 0xFF64748B)),
          Hint('PO date ${fmtDate(po['po_date'])}'),
          if (po['expected_delivery'] != null) Hint('· Delivery by ${fmtDate(po['expected_delivery'])}'),
        ]),
        FieldRow('Vendor', jStr(po, 'vendor_name')),
        FieldRow('Expected delivery', po['expected_delivery'] == null ? null : fmtDate(po['expected_delivery'])),
        if (seePrices) FieldRow('PO value (incl. tax)', total == null ? null : money(total)),
        if (seeDoc) FieldRow('Tally PO no.', jStr(po, 'external_ref')),
        if (seeDoc)
          FieldRow(
              'Tally PO (PDF)',
              jStr(po, 'document_filename') != null && docRfq != null
                  ? linkBtn('${po['document_filename']}',
                      () => openApiFile(context, '/p2p/rfqs/$docRfq/po-draft/$poId/document/content', '${po['document_filename']}'))
                  : const Hint('No document attached yet')),
        for (var i = 0; i < lines.length; i++)
          InnerCard(children: [
            Text('${i + 1}. ${jStr(lines[i], 'item_code') != null ? '${lines[i]['item_code']} — ' : ''}${lines[i]['item_name']}'
                '${jStr(lines[i], 'make') != null ? ' · ${lines[i]['make']}' : ''}'),
            if (jStr(lines[i], 'category') != null && jStr(lines[i], 'category') != 'stock')
              Pill(jStr(lines[i], 'category') == 'service' ? 'Service' : 'Asset',
                  jStr(lines[i], 'category') == 'service' ? const Color(0xFF7C3AED) : const Color(0xFF0891B2)),
            MiniGrid([
              MiniField('Qty', '${fmtQty(lines[i]['quantity'])} ${jStr(lines[i], 'unit') ?? ''}'),
              if (seePrices) MiniField('Unit Price', money(lines[i]['unit_price'])),
              MiniField('Tax %', lines[i]['tax_rate'] != null ? '${lines[i]['tax_rate']}%' : '—'),
              if (seePrices) MiniField('Line Total', money(lines[i]['line_total'])),
            ]),
            if (lines[i]['store_item_id'] == null)
              Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                const Pill('Not linked to Item Master', Color(0xFFB45309)),
                if (canLink) secondaryBtn('Link to Item Master', () => _linkLine(poId, lines[i])),
              ]),
          ]),
        if (seePrices && lines.isNotEmpty) Text('Total: ${money(total)}', style: const TextStyle(fontWeight: FontWeight.w700)),
      ]));
    }

    // PO approval.
    final engine = pr['engine_approval'] is Map ? asJson(pr['engine_approval']) : null;
    final poRaised = status == 'po_raised' || status == 'po_approved' || pr['po_number'] != null;
    if (engine?['po_id'] != null) {
      final ids = _pendingPoIds(pr);
      final shown = ids.isNotEmpty ? ids : [jInt(engine, 'po_id')!];
      if (shown.length > 1) {
        out.add(Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Hint('${shown.length} purchase orders of this requisition are waiting for approval. Each one is decided on its own below.'),
        ));
      }
      for (var i = 0; i < shown.length; i++) {
        final label = jStr(_pos.where((x) => jInt(x, 'id') == shown[i]).firstOrNull, 'po_number');
        out.add(EngineApprovalSection(
          entityType: 'p2p_purchase_order',
          entityId: shown[i],
          title: shown.length > 1 ? 'PO Approval — ${label ?? 'PO ${i + 1} of ${shown.length}'}' : 'PO Approval',
          onChanged: _load,
        ));
      }
    } else if (_rfqs.isNotEmpty || poRaised) {
      if (jStr(pr, 'approval_scheme') == 'engine' && !poRaised) {
        out.add(const DetailSection('PO Approval', children: [
          Text('PO not sent for approval yet. It goes through the “Purchase order” workflow (Organization › Approval Workflows).'),
        ]));
      } else {
        out.add(_legacyPoApproval(pr, poRaised));
      }
    }

    if (po != null && jStr(po, 'status') != 'cancelled' && P2pAccess.feat('purchase_orders', 'delivery_costs', 'view') &&
        lines.any((l) => (jStr(l, 'category') ?? 'stock') == 'stock')) {
      out.add(DeliveryCostsSection(key: ValueKey('dc-${po['id']}'), poId: jInt(po, 'id')!, onChanged: _load));
    }
    if (po != null && P2pAccess.feat('purchase_orders', 'service_entries', 'view') && lines.any((l) => jStr(l, 'category') == 'service')) {
      out.add(ServiceEntriesSection(
        key: ValueKey('se-${po['id']}'),
        poId: jInt(po, 'id')!,
        poOpen: ['issued', 'acknowledged', 'partially_fulfilled'].contains(jStr(po, 'status')),
        onChanged: _load,
      ));
    }
    return out;
  }

  Widget _legacyPoApproval(Json pr, bool poRaised) {
    final status = jStr(pr, 'status');
    final rejectedRole = status == 'rejected' ? jStr(pr, 'rejected_by_role') : null;
    if (pr['project_type'] != null) {
      if (!poRaised) {
        return DetailSection('PO Approval', children: [
          Text('PO not raised yet. It will go to ${jStrings(pr, 'po_approval_role_labels').join(', ')}; all of them must approve (any one Director).'),
        ]);
      }
      final panel = jList(pr, 'po_approval_panel');
      return DetailSection('PO Approval', children: [
        const Text('All of these must approve the PO (any one Director).'),
        const SizedBox(height: 8),
        for (final a in panel)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Caps(jStr(a, 'role_label') ?? ''),
              Builder(builder: (_) {
                final rejectedHere = status == 'rejected' && rejectedRole == jStr(a, 'role');
                final pill = rejectedHere
                    ? const Pill('Rejected', Color(0xFFDC2626))
                    : a['approved_at'] != null
                        ? const Pill('Approved', Color(0xFF16A34A))
                        : const Pill('Pending', Color(0xFF64748B));
                final actor = rejectedHere ? jStr(pr, 'rejected_by_name') : jStr(a, 'approved_by_name');
                final people = jList(a, 'people');
                final note = rejectedHere ? jStr(pr, 'rejected_reason') : jStr(a, 'comment');
                return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  if (actor != null)
                    Wrap(spacing: 6, children: [Text(actor), pill])
                  else if (people.isNotEmpty)
                    Wrap(spacing: 6, children: [
                      Text(people.map((p) => jStr(p, 'name') ?? 'User #${p['id']}').join(jStr(a, 'role') == 'director' ? ' / ' : ', ')),
                      pill,
                    ])
                  else
                    const Hint('— nobody holds this role'),
                  if (note != null) Text('"$note"', style: const TextStyle(fontStyle: FontStyle.italic, fontSize: 12.5)),
                ]);
              }),
            ]),
          ),
        if (status == 'rejected' && !panel.any((a) => jStr(a, 'role') == rejectedRole))
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Caps('Rejected'),
            Wrap(spacing: 6, children: [
              Text(jStr(pr, 'rejected_by_name') ?? '—'),
              Pill('Rejected${rejectedRole != null ? ' as ${p2pRoleLabel(rejectedRole)}' : ''}', const Color(0xFFDC2626)),
            ]),
            if (jStr(pr, 'rejected_reason') != null) Text('"${pr['rejected_reason']}"', style: const TextStyle(fontStyle: FontStyle.italic)),
          ]),
      ]);
    }
    final roles = [
      ('purchase_head', 'Purchase Head', jStr(pr, 'purchase_head_approved_by_name'), pr['purchase_head_approved_at'], jStr(pr, 'purchase_head_comment')),
      ('director', 'Director', jStr(pr, 'director_approved_by_name'), pr['director_approved_at'], jStr(pr, 'director_comment')),
      ('partner', 'Partner', jStr(pr, 'partner_approved_by_name'), pr['partner_approved_at'], jStr(pr, 'partner_comment')),
    ];
    return DetailSection('PO Approval', children: [
      for (final r in roles)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Caps(r.$2),
            if (!poRaised)
              const Hint('— PO not raised yet')
            else ...[
              Wrap(spacing: 6, children: [
                Text((rejectedRole == r.$1 ? jStr(pr, 'rejected_by_name') : r.$3) ?? '—'),
                rejectedRole == r.$1
                    ? const Pill('Rejected', Color(0xFFDC2626))
                    : r.$4 != null
                        ? const Pill('Approved', Color(0xFF16A34A))
                        : const Pill('Pending', Color(0xFF64748B)),
              ]),
              if ((rejectedRole == r.$1 ? jStr(pr, 'rejected_reason') ?? r.$5 : r.$5) != null)
                Text('"${rejectedRole == r.$1 ? jStr(pr, 'rejected_reason') ?? r.$5 : r.$5}"', style: const TextStyle(fontStyle: FontStyle.italic, fontSize: 12.5)),
            ],
          ]),
        ),
    ]);
  }

  Future<void> _linkLine(int poId, Json line) async {
    final master = await withLoading(context, loadActiveItems);
    if (master == null || !mounted) return;
    int? pick;
    final ok = await showFormSheet(
      context,
      title: 'Link to Item Master',
      saveLabel: 'Link',
      builder: (ctx, setS) => [
        Text('${line['item_name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
        AppSelect<int>(
          label: 'Item Master item',
          required: true,
          value: pick,
          options: [for (final i in master) Option(jInt(i, 'id')!, itemLabel(i), subtitle: itemDetail(i))],
          onChanged: (o) => setS(() => pick = o?.value),
        ),
        const Hint("The line then carries the Item Master id — the GRN receives it into that item's stock."),
      ],
      onSave: () async {
        if (pick == null) throw 'Pick the Item Master item this PO line is.';
        await Api.post('/p2p/purchase-orders/$poId/items/${line['id']}/link-item', data: {'store_item_id': pick});
      },
    );
    if (ok) _load();
  }
}

// ── Procurement progress (portal PrTracker, phone layout) ────────────────────

const _stateHex = {
  'awaiting_stock_decision': 0xFFF59E0B, 'issued_from_stock': 0xFF22C55E, 'to_quote': 0xFF64748B, 'quoting': 0xFF6366F1,
  'awarded': 0xFF0EA5E9, 'po_in_approval': 0xFFF59E0B, 'with_vendor': 0xFF3B82F6, 'partly_received': 0xFFD97706,
  'received': 0xFF16A34A, 'short_closed': 0xFF94A3B8,
};
const _waitingText = {
  'awaiting_stock_decision': 'waiting for the stock check',
  'to_quote': 'waiting for an RFQ',
  'quoting': 'waiting for quotes',
  'awarded': 'waiting for the PO upload',
  'po_in_approval': 'PO in approval',
};
const _poStageHex = {
  'draft': 0xFF64748B, 'in_approval': 0xFFF59E0B, 'with_vendor': 0xFF3B82F6, 'partly_received': 0xFFD97706, 'received': 0xFF16A34A,
  'closed': 0xFF22C55E, 'short_closed': 0xFF94A3B8, 'cancelled': 0xFF94A3B8,
};
const _trackerReqLabel = {
  'pending': 'Waiting for approval', 'approved': 'Approved', 'rejected': 'Rejected', 'returned': 'Returned for changes', 'cancelled': 'Cancelled',
};

double _nonNeg(Object? v) {
  final n = toDouble(v) ?? 0;
  return n < 0 ? 0 : n;
}

double _toBuy(Json l) => _nonNeg(jD(l, 'quantity') - jD(l, 'issued_qty') - jD(l, 'short_closed_qty'));
double _openToOrder(Json l) => _nonNeg(jD(l, 'quantity') - jD(l, 'issued_qty') - jD(l, 'short_closed_qty') - jD(l, 'ordered_qty'));

String approvalText(Json? a, String? stage) {
  if (stage == 'cancelled') return 'Cancelled';
  if (a == null) return stage == 'draft' ? 'Not sent for approval yet' : '—';
  final decided = jList(a, 'steps').where((s) => s['decided_at'] != null).toList()
    ..sort((x, y) => '${x['decided_at']}'.compareTo('${y['decided_at']}'));
  final last = decided.lastOrNull;
  final who = jStr(last, 'decided_by_name') ?? jStr(last, 'approver_name');
  final st = jStr(a, 'status');
  if (st == 'approved') {
    final when = a['completed_at'] ?? last?['decided_at'];
    return 'Approved${who != null ? ' by $who' : ''}${when != null ? ' on ${fmtDate(when)}' : ''}';
  }
  if (st == 'rejected') {
    final r = decided.where((s) => jStr(s, 'status') == 'rejected').firstOrNull ?? last;
    return 'Rejected${jStr(r, 'decided_by_name') != null ? ' by ${r!['decided_by_name']}' : ''}${r?['decided_at'] != null ? ' on ${fmtDate(r!['decided_at'])}' : ''}';
  }
  if (st == 'returned') return 'Returned for changes${who != null ? ' by $who' : ''}${last?['decided_at'] != null ? ' on ${fmtDate(last!['decided_at'])}' : ''}';
  if (st == 'cancelled') return 'Approval withdrawn';
  final names = jList(a, 'steps').where((s) => jStr(s, 'status') == 'pending').map((s) => jStr(s, 'approver_name')).whereType<String>().toSet();
  return names.isNotEmpty ? 'Waiting for ${names.join(' / ')}' : 'Waiting for approval';
}

class TrackerSection extends StatefulWidget {
  const TrackerSection({
    super.key,
    required this.prId,
    required this.canReassign,
    required this.canShortClose,
    required this.allLines,
    required this.rfqLinkable,
    this.onChanged,
  });
  final int prId;
  final bool canReassign;
  final bool canShortClose;
  final bool allLines;
  final bool rfqLinkable;
  final VoidCallback? onChanged;

  @override
  State<TrackerSection> createState() => _TrackerSectionState();
}

class _TrackerSectionState extends State<TrackerSection> {
  Json? _data;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = asJson(await Api.get('/p2p/requests/${widget.prId}/tracker'));
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  String _summary(List<Json> lines) {
    final buy = lines.where((l) => _toBuy(l) > eps || jD(l, 'ordered_qty') > eps).toList();
    final ordered = buy.where((l) => _toBuy(l) <= eps || jD(l, 'ordered_qty') + eps >= _toBuy(l)).length;
    final parts = ['$ordered of ${buy.length} line${buy.length == 1 ? '' : 's'} ordered'];
    for (final e in _waitingText.entries) {
      final n = lines.where((l) => jStr(l, 'state') == e.key).length;
      if (n > 0) parts.add('$n ${e.value}');
    }
    final stock = lines.where((l) => jStr(l, 'state') == 'issued_from_stock').length;
    if (stock > 0) parts.add('$stock issued from stock');
    final closed = lines.where((l) => jStr(l, 'state') == 'short_closed').length;
    if (closed > 0) parts.add('$closed closed short');
    return parts.join(' · ');
  }

  LineRef _ref(Json l) => (
        prItemId: jInt(l, 'pr_item_id')!,
        itemName: jStr(l, 'item_name') ?? '',
        unit: jStr(l, 'unit'),
        openToOrder: _openToOrder(l),
        buyerId: jInt(l, 'buyer_id'),
      );

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final lines = jList(d, 'lines')..sort((a, b) => (jInt(a, 'pr_item_id') ?? 0).compareTo(jInt(b, 'pr_item_id') ?? 0));
    final approval = d?['pr_approval'] is Map ? asJson(d!['pr_approval']) : null;
    final me = P2pAccess.me;
    return DetailSection('Procurement progress', children: [
      const Hint('Who approved it, who is buying each line, and where every line is: RFQ, PO, goods received.'),
      const SizedBox(height: 8),
      if (d == null && _error == null) const Hint('Loading procurement progress…'),
      if (_error != null)
        NoteBox(
            '${ApiClient.describe(_error!)} Pull to refresh; if it keeps failing, ask an admin to check your access to this requisition.',
            tone: NoteTone.error),
      if (d != null) ...[
        Wrap(spacing: 8, runSpacing: 4, children: [
          Pill(jStr(d, 'status_label') ?? '', Color(prStatusHex[jStr(d, 'status')] ?? 0xFF64748B)),
          if (lines.isNotEmpty) Pill(_summary(lines), const Color(0xFF57534E)),
        ]),
        const SizedBox(height: 10),
        if (approval != null && jList(approval, 'steps').isNotEmpty) ...[
          Caps('Requisition approval · ${_trackerReqLabel[jStr(approval, 'status')] ?? approval['status']}'
              '${approval['completed_at'] != null ? ' · ${fmtDateTime(approval['completed_at'])}' : ''}'),
          const SizedBox(height: 4),
          for (final s in jList(approval, 'steps')) StepLine(s, showStage: true),
          const SizedBox(height: 8),
        ],
        if (lines.isEmpty)
          const Text('No lines to follow yet. Lines appear here once the requisition is submitted and the Store has decided what to issue from stock.'),
        for (var i = 0; i < lines.length; i++) _lineCard(lines[i], i, me),
      ],
    ]);
  }

  Widget _lineCard(Json l, int idx, int? me) {
    final state = jStr(l, 'state') ?? '';
    final pos = jList(l, 'pos');
    final live = pos.where((p) => jStr(p, 'stage') != 'cancelled').toList();
    final grns = pos.expand((p) => jList(p, 'grns')).toList();
    final open = _openToOrder(l);
    final mayReassign = widget.canReassign && open > eps && jInt(l, 'buyer_id') != me;
    final mayShort = widget.canShortClose && open > eps && (widget.allLines || jInt(l, 'buyer_id') == me);
    final linkable = widget.rfqLinkable && (widget.allLines || jInt(l, 'buyer_id') == me);
    return InnerCard(children: [
      Text('${idx + 1}. ${jStr(l, 'item_code') != null ? '${l['item_code']} — ' : ''}${l['item_name']}',
          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
      const SizedBox(height: 4),
      Wrap(spacing: 6, runSpacing: 4, children: [
        Pill(jStr(l, 'state_label') ?? state, Color(_stateHex[state] ?? 0xFF64748B)),
        if (jBool(l, 'po_rejected')) const Pill('PO rejected — upload again', Color(0xFFD97706)),
        if (jBool(l, 'over_ordered')) const Pill('Over-ordered', Color(0xFFD97706)),
      ]),
      const SizedBox(height: 8),
      MiniGrid([
        MiniField('Buyer', jStr(l, 'buyer_name')),
        MiniField(
            'RFQ',
            jList(l, 'rfqs').isEmpty
                ? const Hint('—')
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    for (final r in jList(l, 'rfqs'))
                      linkable
                          ? linkBtn('${r['rfq_number']} · ${jStr(r, 'status') == 'draft' ? 'draft' : jStr(r, 'status') == 'cancelled' ? 'cancelled' : '${r['quote_count']} quote(s)'}',
                              () => openScreen(context, RfqDetailScreen(rfqId: jInt(r, 'rfq_id')!)))
                          : Text('${r['rfq_number']} · ${r['quote_count']} quote(s)'),
                  ])),
        MiniField('PO', live.isEmpty ? '—' : live.map((p) => '${p['po_number']}${jStr(p, 'vendor_name') != null ? ' · ${p['vendor_name']}' : ''}').join('\n')),
        MiniField('Goods received (GRN)', grns.isEmpty ? '—' : grns.map((g) => '${g['grn_number']}${g['received_date'] != null ? ' · ${fmtDate(g['received_date'])}' : ''}').join('\n')),
        MiniField('Requested', '${fmtQty(l['quantity'])} ${jStr(l, 'unit') ?? ''}${jD(l, 'issued_qty') > eps ? '\n${fmtQty(l['issued_qty'])} from stock' : ''}'),
        MiniField('Ordered', fmtQty(_nonNeg(l['ordered_qty']))),
        MiniField('Received', fmtQty(_nonNeg(l['accepted_qty']))),
        MiniField('Pending', fmtQty(_nonNeg(l['pending_qty']))),
        if (_nonNeg(l['short_closed_qty']) > eps) MiniField('Written off', fmtQty(l['short_closed_qty'])),
      ]),
      if (live.isNotEmpty) ...[
        const SizedBox(height: 6),
        MiniField('PO approval', live.map((p) => '${live.length > 1 ? '${p['po_number']}: ' : ''}${approvalText(p['approval'] is Map ? asJson(p['approval']) : null, jStr(p, 'stage'))}').join('\n')),
      ],
      if (jStr(l, 'short_closed_reason') != null) Hint('Written off: ${l['short_closed_reason']}'),
      if (mayReassign || mayShort)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Wrap(spacing: 8, children: [
            if (mayReassign)
              secondaryBtn('Reassign', () async {
                if (await reassignLine(context, widget.prId, _ref(l))) {
                  _load();
                  widget.onChanged?.call();
                }
              }),
            if (mayShort)
              secondaryBtn('Short-close', () async {
                if (await shortCloseLine(context, widget.prId, _ref(l))) {
                  _load();
                  widget.onChanged?.call();
                }
              }),
          ]),
        ),
      for (final p in pos) ...[
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: Brand.background, borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Text('${p['po_number']}', style: const TextStyle(fontWeight: FontWeight.w700)),
              Pill(jStr(p, 'stage_label') ?? '', Color(_poStageHex[jStr(p, 'stage')] ?? 0xFF64748B)),
              if (jStr(p, 'vendor_name') != null) Hint('${p['vendor_name']}'),
              Hint('${fmtQty(p['quantity'])} on this line'),
              if (p['expected_delivery'] != null) Hint('Delivery by ${fmtDate(p['expected_delivery'])}'),
            ]),
            const SizedBox(height: 4),
            const Caps('PO approval'),
            if (p['approval'] is Map && jList(asJson(p['approval']), 'steps').isNotEmpty)
              for (final s in jList(asJson(p['approval']), 'steps')) StepLine(s, showStage: true)
            else
              Text(approvalText(p['approval'] is Map ? asJson(p['approval']) : null, jStr(p, 'stage'))),
            const SizedBox(height: 4),
            const Caps('Goods received'),
            if (jList(p, 'grns').isEmpty) const Hint('No goods received yet.'),
            for (final g in jList(p, 'grns'))
              Text('${g['grn_number']}${g['received_date'] != null ? ' · ${fmtDate(g['received_date'])}' : ''} · received ${fmtQty(g['received_qty'])} '
                  '· accepted ${fmtQty(g['accepted_qty'])}${jD(g, 'rejected_qty') > eps ? ' · rejected ${fmtQty(g['rejected_qty'])}' : ''}'
                  '${jStr(g, 'status') != null && jStr(g, 'status') != 'completed' ? ' · ${humanize(g['status'])}' : ''}',
                  style: const TextStyle(fontSize: 12.5)),
          ]),
        ),
      ],
    ]);
  }
}
