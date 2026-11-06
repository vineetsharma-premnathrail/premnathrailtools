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
import 'hr_common.dart';
import 'travel.dart';

// Portal: app/dashboard/hr/me/claims/page.tsx, components/hr/admin/ClaimDetail.tsx,
// components/hr/admin/ClaimFinancePanel.tsx

/// Claim title / date / linked trip (create or edit). Returns the claim or null.
Future<Json?> showClaimHeaderForm(BuildContext context, {Json? claim}) async {
  final title = TextEditingController(text: str(claim?['title']));
  DateTime? date = dateOf(claim?['claim_date']) ?? DateTime.now();
  int? tripId = asInt(claim?['travel_request_id']);
  List<Option<int>> trips = [];
  try {
    trips = [
      for (final t in (await Api.list('/hr/expenses/travel-options')).rows)
        Option(asInt(t['id']) ?? 0, '${t['request_no']} · ${t['from_city']} → ${t['to_city']} · ${fmtDate(t['depart_date'])}'),
    ];
  } catch (_) {}
  if (!context.mounted) return null;
  Json? saved;
  final ok = await showFormSheet(
    context,
    title: claim != null ? 'Edit ${claim['claim_no']}' : 'New expense claim',
    saveLabel: claim != null ? 'Save' : 'Create draft',
    builder: (ctx, setS) => [
      if (claim == null) const HintText('Creates a draft. Add the expense lines and receipts next, then submit it for approval.'),
      AppTextField(label: 'Title', controller: title, required: true, hint: 'Delhi site visit — Sept'),
      DateField(label: 'Claim date', value: date, onChanged: (d) => setS(() => date = d)),
      AppSelect<int>(
        label: 'Linked Trip',
        value: tripId,
        options: trips,
        onChanged: (o) => setS(() => tripId = o?.value),
      ),
      if (trips.isEmpty) const HintText('Only your approved or completed travel requests can be linked.'),
    ],
    onSave: () async {
      if (title.text.trim().isEmpty) throw 'Give the claim a title, e.g. "Delhi site visit — Sept".';
      if (claim != null) {
        saved = mapOf(await Api.patch('/hr/expenses/${claim['id']}', data: {
          'title': title.text.trim(),
          'claim_date': isoOrNull(date),
          if (tripId != null) 'travel_request_id': tripId else 'clear_travel_request': true,
        }));
      } else {
        saved = mapOf(await Api.post('/hr/expenses',
            data: {'title': title.text.trim(), 'claim_date': isoOrNull(date), 'travel_request_id': tripId}));
      }
    },
  );
  return ok ? saved : null;
}

/// My HR › Expense Claims.
class MyClaimsPage extends StatefulWidget {
  const MyClaimsPage({super.key});

  @override
  State<MyClaimsPage> createState() => _MyClaimsPageState();
}

class _MyClaimsPageState extends State<MyClaimsPage> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = '';
  List<Json> _rows = [];

  Future<void> _new() async {
    final c = await showClaimHeaderForm(context);
    if (c != null && mounted) {
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ClaimDetailScreen(claimId: asInt(c['id']) ?? 0)));
      _list.currentState?.reload();
    }
  }

  void _toggle(String s) {
    setState(() => _status = _status == s ? '' : s);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    double sum(List<String> st) => _rows.where((r) => st.contains(r['status'])).fold(0.0, (a, r) => a + toNum(r['total_amount']));
    final drafts = _rows.where((r) => r['status'] == 'draft' || r['status'] == 'rejected').length;
    return ApiListView(
      key: _list,
      load: (_, _) async {
        final page = await Api.list('/hr/expenses/mine');
        _rows = page.rows;
        if (mounted) setState(() {});
        final shown = _status.isEmpty
            ? page.rows
            : _status == 'draft_fix'
                ? page.rows.where((r) => r['status'] == 'draft' || r['status'] == 'rejected').toList()
                : page.rows.where((r) => r['status'] == _status).toList();
        return ApiPage(shown);
      },
      emptyText: _status.isNotEmpty ? 'No claims with this status.' : 'No expense claims yet. Use “+ New Claim” to start one.',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        PageHeader('My Expense Claims',
            subtitle: 'Claim reimbursement for business expenses. Attach receipts, submit to your manager, and track payment.',
            actions: [if (Perm.can('hr', 'me', 'create')) headerButton('New Claim', _new)]),
        if (_rows.isNotEmpty)
          TileGrid([
            StatTile(label: 'Drafts / to fix', value: '$drafts', color: hexColor('#64748B'), selected: _status == 'draft_fix', onTap: () => _toggle('draft_fix')),
            StatTile(label: 'Awaiting approval', value: fmtMoney(sum(['submitted'])), color: hexColor('#F59E0B'), selected: _status == 'submitted', onTap: () => _toggle('submitted')),
            StatTile(label: 'Approved, not paid', value: fmtMoney(sum(['approved'])), color: hexColor('#16A34A'), selected: _status == 'approved', onTap: () => _toggle('approved')),
            StatTile(label: 'Paid', value: fmtMoney(sum(['paid'])), color: hexColor('#2563EB'), selected: _status == 'paid', onTap: () => _toggle('paid')),
          ]),
      ]),
      itemBuilder: (ctx, c, reload) => claimCard(context, c, onChanged: reload),
    );
  }
}

/// One expense claim: header, actions, approval, lines with receipts.
class ClaimDetailScreen extends StatefulWidget {
  const ClaimDetailScreen({super.key, required this.claimId});
  final int claimId;

  @override
  State<ClaimDetailScreen> createState() => _ClaimDetailScreenState();
}

class _ClaimDetailScreenState extends State<ClaimDetailScreen> {
  Json? _c;
  Object? _error;
  String? _notice;
  bool _busy = false;
  int _rev = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final c = mapOf(await Api.get('/hr/expenses/${widget.claimId}'));
      if (mounted) setState(() { _c = c; _error = null; _rev++; });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _run(Future<dynamic> Function() f, String msg) async {
    setState(() => _busy = true);
    try {
      final r = await f();
      if (!mounted) return;
      setState(() { if (r is Map) _c = mapOf(r); _notice = msg; _rev++; });
      if (r is! Map) await _load();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<MultipartFile?> _pickReceipt() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take photo of bill'), onTap: () => Navigator.pop(ctx, 'camera')),
          ListTile(leading: const Icon(Icons.photo_outlined), title: const Text('Choose photo'), onTap: () => Navigator.pop(ctx, 'gallery')),
          ListTile(leading: const Icon(Icons.attach_file_rounded), title: const Text('Choose PDF / file'), onTap: () => Navigator.pop(ctx, 'file')),
        ]),
      ),
    );
    if (choice == 'camera') return Files.takePhoto();
    if (choice == 'gallery') return Files.pickPhoto();
    if (choice == 'file') return Files.pickFile(extensions: ['pdf', 'jpg', 'jpeg', 'png']);
    return null;
  }

  Future<void> _upload(Json item) async {
    final f = await _pickReceipt();
    if (f == null || !mounted) return;
    await _run(() => Api.post('/hr/expenses/${_c!['id']}/items/${item['id']}/receipt', data: FormData.fromMap({'file': f})),
        'Receipt “${f.filename}” uploaded.');
  }

  /// Add or edit an expense line (with an optional bill photo on add).
  Future<void> _lineForm([Json? item]) async {
    final c = _c!;
    DateTime? date = dateOf(item?['expense_date']) ?? DateTime.now();
    var category = str(item?['category']).isEmpty ? 'food' : str(item?['category']);
    final desc = TextEditingController(text: str(item?['description']));
    final amount = TextEditingController(text: item == null ? '' : numTxt(item['amount']));
    MultipartFile? file;
    String? msg;
    final ok = await showFormSheet(
      context,
      title: item == null ? 'Add expense line' : 'Edit expense line',
      saveLabel: item == null ? 'Add line' : 'Save',
      builder: (ctx, setS) => [
        DateField(label: 'Date', required: true, value: date, lastDate: DateTime.now(), onChanged: (d) => setS(() => date = d)),
        AppSelect<String>(
            label: 'Category', value: category, clearable: false, options: optionsOf(expenseCategoryLabels),
            onChanged: (o) => setS(() => category = o?.value ?? category)),
        AppTextField(label: 'Description', controller: desc, hint: 'Hotel, cab to site, lunch with client…'),
        AppTextField(label: 'Amount (₹)', controller: amount, required: true, keyboardType: AppTextField.number),
        if (item == null) ...[
          Row(children: [
            Expanded(child: Text(file == null ? 'No receipt attached' : 'Receipt: ${file!.filename}', style: const TextStyle(fontSize: 13.5))),
            LinkAction(file == null ? 'Attach receipt' : 'Change', () async {
              final f = await _pickReceipt();
              if (f != null) setS(() => file = f);
            }),
          ]),
          HintText('Receipts: images or PDF, up to 10 MB each. Required for any line above ${fmtMoney(c['receipt_threshold'] ?? 500)}.'),
        ],
      ],
      onSave: () async {
        final p = <String>[];
        if (date == null) p.add('Pick the date of the expense.');
        if (!(toNum(amount.text) > 0)) p.add('Enter an amount greater than ₹0.');
        if (date != null && date!.isAfter(DateTime.now())) p.add('The expense date cannot be in the future.');
        if (p.isNotEmpty) throw p.join(' ');
        final payload = {'expense_date': apiDate(date!), 'category': category, 'description': textOrNull(desc.text), 'amount': amount.text.trim()};
        if (item != null) {
          _c = mapOf(await Api.patch('/hr/expenses/${c['id']}/items/${item['id']}', data: payload));
          msg = 'Line updated.';
          return;
        }
        final before = rowsOf(c['items']).map((i) => i['id']).toSet();
        var res = mapOf(await Api.post('/hr/expenses/${c['id']}/items', data: payload));
        msg = 'Line added.';
        if (file != null) {
          final added = rowsOf(res['items']).where((i) => !before.contains(i['id'])).firstOrNull;
          if (added != null) {
            try {
              res = mapOf(await Api.post('/hr/expenses/${c['id']}/items/${added['id']}/receipt', data: FormData.fromMap({'file': file})));
              msg = 'Line and receipt added.';
            } catch (e) {
              msg = 'The line was added, but the receipt upload failed: ${ApiClient.describe(e)} Use “Upload” on the line to try again.';
            }
          }
        }
        _c = res;
      },
    );
    if (ok && mounted) setState(() { _notice = msg; _rev++; });
  }

  Future<void> _decision(String kind) async {
    final c = _c!;
    final remarks = await promptDialog(context,
        title: kind == 'approve' ? 'Approve ${c['claim_no']}?' : kind == 'reject' ? 'Reject ${c['claim_no']}?' : 'Cancel ${c['claim_no']}?',
        message: kind == 'approve'
            ? '${fmtMoney(c['total_amount'])} for ${c['user_name']}. HR then records the payment.'
            : kind == 'reject'
                ? 'The employee can correct and resubmit it. Say what needs fixing (required).'
                : 'The claim will be withdrawn and cannot be reopened.',
        label: kind == 'reject' ? 'What needs to be corrected' : 'Remarks (optional)',
        required: kind == 'reject',
        confirmLabel: kind == 'approve' ? 'Approve' : kind == 'reject' ? 'Reject' : 'Cancel claim');
    if (remarks == null || !mounted) return;
    await _run(() => Api.post('/hr/expenses/${c['id']}/$kind', data: {'remarks': textOrNull(remarks)}),
        kind == 'approve' ? '${c['claim_no']} approved.' : kind == 'reject' ? '${c['claim_no']} rejected and sent back to ${c['user_name']}.' : '${c['claim_no']} cancelled.');
  }

  Future<void> _submit() async {
    final c = _c!;
    final n = rowsOf(c['items']).length;
    final yes = await confirmDialog(context,
        title: 'Submit ${c['claim_no']}?',
        message: '${fmtMoney(c['total_amount'])} across $n line${n == 1 ? '' : 's'} goes to your reporting manager (or HR if you have none). You cannot edit it while it is being reviewed.',
        confirmLabel: 'Submit');
    if (yes && mounted) await _run(() => Api.post('/hr/expenses/${c['id']}/submit', data: {}), '${c['claim_no']} submitted for approval.');
  }

  Future<void> _markPaid() async {
    final c = _c!;
    DateTime? paidOn = DateTime.now();
    final ref = TextEditingController();
    Json? res;
    final ok = await showFormSheet(context,
        title: 'Record payment for ${c['claim_no']}',
        saveLabel: 'Mark paid',
        builder: (ctx, setS) => [
              HintText('${fmtMoney(c['total_amount'])} to ${c['user_name']}. The payment itself is made outside the portal (bank / ADP); this records it.'),
              DateField(label: 'Paid on', value: paidOn, onChanged: (d) => setS(() => paidOn = d)),
              AppTextField(label: 'Payment reference', controller: ref, required: true, hint: 'UTR / NEFT / cheque no.'),
            ],
        onSave: () async {
          if (ref.text.trim().isEmpty) {
            throw 'Enter the payment reference (NEFT / UTR / cheque no. or ADP batch) so the employee can trace it.';
          }
          res = mapOf(await Api.post('/hr/expenses/${c['id']}/mark-paid', data: {'paid_on': isoOrNull(paidOn), 'payment_reference': ref.text.trim()}));
        });
    if (ok && res != null && mounted) setState(() { _c = res; _notice = '${res!['claim_no']} marked paid.'; _rev++; });
  }

  Future<void> _lineMenu(Json it) async {
    final c = _c!;
    final editable = c['can_edit'] == true;
    final acts = <Widget>[
      if (it['has_receipt'] == true)
        LinkAction('View receipt', () {
          Navigator.pop(context);
          openApiFile(context, '/hr/expenses/${c['id']}/items/${it['id']}/receipt', str(it['receipt_filename']).isEmpty ? 'receipt' : str(it['receipt_filename']));
        }),
      if (editable) LinkAction(it['has_receipt'] == true ? 'Replace receipt' : 'Upload receipt', () { Navigator.pop(context); _upload(it); }),
      if (editable && it['has_receipt'] == true)
        LinkAction('Remove receipt', () {
          Navigator.pop(context);
          _run(() => Api.delete('/hr/expenses/${c['id']}/items/${it['id']}/receipt'), 'Receipt removed.');
        }, color: Brand.danger),
      if (editable) LinkAction('Edit', () { Navigator.pop(context); _lineForm(it); }),
      if (editable)
        LinkAction('Delete', () async {
          Navigator.pop(context);
          final yes = await confirmDialog(context,
              title: 'Delete this line?',
              message: '${fmtDate(it['expense_date'])} · ${labelOf(expenseCategoryLabels, it['category'])} · ${fmtMoney(it['amount'])}${it['has_receipt'] == true ? ' — its receipt is deleted too.' : ''}',
              confirmLabel: 'Delete line',
              danger: true);
          if (yes) _run(() => Api.delete('/hr/expenses/${c['id']}/items/${it['id']}'), 'Line deleted.');
        }, color: Brand.danger),
    ];
    if (acts.isEmpty) return;
    await showModalBottomSheet<void>(
        context: context, builder: (_) => SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: actionRow(acts))));
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    if (c == null) {
      return SubPage(title: 'Expense claim', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final items = rowsOf(c['items']);
    final editable = c['can_edit'] == true;
    final missing = items.where((i) => i['receipt_required'] == true && i['has_receipt'] != true).length;
    final engine = c['approval_request_id'] != null;
    final buttons = <Widget>[
      if (editable) headerButton(c['status'] == 'rejected' ? 'Resubmit for approval' : 'Submit for approval', _busy ? null : _submit, icon: Icons.send_rounded),
      if (editable) headerButton('Edit title / trip', () async {
        final s = await showClaimHeaderForm(context, claim: c);
        if (s != null && mounted) setState(() { _c = s; _notice = 'Claim details saved.'; _rev++; });
      }, primary: false),
      if (c['can_decide'] == true && !engine) headerButton('Approve', _busy ? null : () => _decision('approve'), icon: Icons.check_rounded),
      if (c['can_decide'] == true && !engine) headerButton('Reject', _busy ? null : () => _decision('reject'), primary: false),
      if (c['can_mark_paid'] == true) headerButton('Mark paid', _busy ? null : _markPaid, icon: Icons.currency_rupee_rounded),
      if (c['can_cancel'] == true) headerButton(c['status'] == 'submitted' ? 'Withdraw claim' : 'Cancel claim', _busy ? null : () => _decision('cancel'), primary: false),
    ];
    return SubPage(
      title: 'Expense claim ${c['claim_no']}',
      fab: editable ? CreateFab(label: 'Add line', onPressed: () => _lineForm()) : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 96),
          children: [
            if (_notice != null) padded(NoticeBanner(_notice!)),
            DetailSection(str(c['title']), action: statusPill(c['status'], claimStatusLabels, claimStatusHex), children: [
              Text('Expense claim by ${str(c['user_name']).isEmpty ? 'the employee' : c['user_name']}${str(c['user_department']).isEmpty ? '' : ' (${c['user_department']})'} — '
                  '${items.length} expense line${items.length == 1 ? '' : 's'} totalling ${fmtMoney(c['total_amount'])}.'),
              FieldRow('Claim date', fmtDate(c['claim_date'])),
              FieldRow('Linked trip', str(c['travel_request_no']).isEmpty ? 'Not linked to a trip' : '${c['travel_request_no']} · ${c['travel_route']}'),
              FieldRow('Approver', str(c['decided_by_name']).isNotEmpty ? c['decided_by_name'] : str(c['approver_name']).isNotEmpty ? c['approver_name'] : (c['status'] == 'draft' ? 'Set when submitted' : 'HR')),
              if (str(c['submitted_at']).isNotEmpty) FieldRow('Submitted', fmtDateTime(c['submitted_at'])),
              if (str(c['decided_at']).isNotEmpty) FieldRow('Decided', fmtDateTime(c['decided_at'])),
              if (str(c['decision_remarks']).isNotEmpty)
                FieldRow(c['status'] == 'rejected' ? 'Why it was rejected' : 'Approver remarks',
                    '${c['decision_remarks']}${c['status'] == 'rejected' && editable ? '\nFix the lines below, then submit again.' : ''}'),
              if (str(c['paid_on']).isNotEmpty)
                FieldRow('Paid', '${fmtDate(c['paid_on'])} · ref ${str(c['payment_reference']).isEmpty ? '—' : c['payment_reference']}${str(c['paid_by_name']).isEmpty ? '' : ' · by ${c['paid_by_name']}'}'),
              if (buttons.isNotEmpty) ...[const SizedBox(height: 8), Wrap(spacing: 8, runSpacing: 8, children: buttons)],
            ]),
            if (engine)
              EngineApprovalPanel(key: ValueKey('ap$_rev'), entityType: 'hr_expense_claim', entityId: asInt(c['id']) ?? 0, onChanged: _load),
            if (editable && missing > 0)
              padded(WarnBanner('$missing line${missing > 1 ? 's need' : ' needs'} a receipt — every expense above ${fmtMoney(c['receipt_threshold'] ?? 500)} must have one before you can submit.')),
            BlockTitle('Expense Lines', trailing: Text('${items.length} line${items.length == 1 ? '' : 's'} · ${fmtMoney(c['total_amount'])}', style: const TextStyle(color: Brand.muted, fontSize: 12))),
            if (items.isEmpty) padded(HintText(editable ? 'No lines yet — use “Add line” and photograph each bill.' : 'No expense lines on this claim.')),
            for (final it in items)
              RecordCard(
                title: '${labelOf(expenseCategoryLabels, it['category'])} · ${fmtMoney(it['amount'])}',
                subtitle: str(it['description']),
                trailing: it['has_receipt'] == true
                    ? const HrPill('Receipt', '#16A34A')
                    : it['receipt_required'] == true
                        ? HrPill(editable ? 'Required' : 'Missing', '#DC2626')
                        : null,
                meta: [('Date', fmtDate(it['expense_date']))],
                onTap: () => _lineMenu(it),
              ),
            if (items.isNotEmpty) padded(Text('Total ${fmtMoney(c['total_amount'])}', textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
            _ClaimFinancePanel(key: ValueKey('fin$_rev'), claimId: asInt(c['id']) ?? 0, status: str(c['status'])),
          ],
        ),
      ),
    );
  }
}

/// Finance posting of an approved claim (portal ClaimFinancePanel).
class _ClaimFinancePanel extends StatefulWidget {
  const _ClaimFinancePanel({super.key, required this.claimId, required this.status});
  final int claimId;
  final String status;

  @override
  State<_ClaimFinancePanel> createState() => _ClaimFinancePanelState();
}

class _ClaimFinancePanelState extends State<_ClaimFinancePanel> {
  Json? _p;
  String? _error;

  bool get _canView => Perm.can('accounts', 'payments', 'view');

  @override
  void initState() {
    super.initState();
    if (_canView && (widget.status == 'approved' || widget.status == 'paid')) _load();
  }

  Future<void> _load() async {
    try {
      final p = mapOf(await Api.get('/accounts/hr-claims/${widget.claimId}'));
      if (mounted) setState(() { _p = p; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _post() async {
    try {
      final p = mapOf(await Api.post('/accounts/hr-claims/${widget.claimId}/post', data: {}));
      if (mounted) setState(() => _p = p);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _pay() async {
    List<Option<int>> banks = [];
    try {
      banks = [
        for (final b in (await Api.list('/accounts/bank-accounts')).rows)
          if (b['status'] == 'active') Option(asInt(b['id']) ?? 0, '${b['bank_name']}${str(b['account_no']).isEmpty ? '' : ' — ${b['account_no']}'}'),
      ];
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
      return;
    }
    if (!mounted) return;
    int? bank;
    var mode = 'neft';
    DateTime? paidOn = DateTime.now();
    final ref = TextEditingController();
    final p = _p!;
    await showFormSheet(context,
        title: 'Pay ${p['claim_no']} — ${fmtMoney(p['total_amount'])}',
        saveLabel: 'Record payment',
        builder: (ctx, setS) => [
              const HintText('Records a payment voucher Dr Employee reimbursements payable / Cr the bank or cash account, numbered in the FY payment series.'),
              AppSelect<int>(label: 'Bank / cash account', required: true, value: bank, options: banks, onChanged: (o) => setS(() => bank = o?.value)),
              AppSelect<String>(
                  label: 'Mode', value: mode, clearable: false,
                  options: [for (final m in ['neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash']) Option(m, m.toUpperCase())],
                  onChanged: (o) => setS(() => mode = o?.value ?? mode)),
              DateField(label: 'Paid on', value: paidOn, onChanged: (d) => setS(() => paidOn = d)),
              AppTextField(label: 'Bank reference', controller: ref),
            ],
        onSave: () async {
          if (bank == null) throw 'Pick the bank or cash account the money is paid from.';
          final r = mapOf(await Api.post('/accounts/hr-claims/${widget.claimId}/pay', data: {
            'bank_account_id': bank, 'payment_mode': mode, 'paid_on': isoOrNull(paidOn), 'payment_reference': textOrNull(ref.text),
          }));
          if (mounted) setState(() => _p = r);
        });
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    if (!_canView || p == null || !(p['status'] == 'approved' || p['status'] == 'paid')) {
      return _error == null ? const SizedBox.shrink() : padded(ErrorBanner(_error!));
    }
    return DetailSection('Finance posting', children: [
      if (_error != null) ErrorBanner(_error!),
      FieldRow('Approval journal', str(p['posted_je_number']).isEmpty ? const HrPill('Not posted', '#F59E0B') : HrPill(str(p['posted_je_number']), '#16A34A')),
      FieldRow('Payment voucher', str(p['payment_voucher_number']).isEmpty ? '—' : '${p['payment_voucher_number']} · ${fmtDate(p['paid_on'])}'),
      Wrap(spacing: 8, children: [
        if (str(p['posted_je_number']).isEmpty && Perm.can('accounts', 'journal_vouchers', 'create'))
          headerButton('Post to accounts', _post, primary: false),
        if (p['status'] == 'approved' && Perm.can('accounts', 'payments', 'create')) headerButton('Pay by voucher', _pay, icon: Icons.currency_rupee_rounded),
      ]),
    ]);
  }
}