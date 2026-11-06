import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';

/// Finance › Payments (portal finance/payments + payments/advances +
/// payments/runs). The portal's header links (Payment runs, Advances &
/// write-offs) are sub-tabs here.
class FinPaymentsPage extends StatelessWidget {
  const FinPaymentsPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Payments & Receipts',
        subtitle:
            'Vendor payments, customer receipts, expense payments, other receipts and contra transfers — settled bill-wise against open invoices.',
        tabs: [
          FinSubTab('Vouchers', (_) => const _Vouchers(), permTab: 'payments'),
          FinSubTab('Advances & write-offs', (_) => const _Advances(),
              visible: finCanFeature('payments', 'advances', 'view') || finCan('outstanding', 'view')),
          FinSubTab('Payment runs', (_) => const _Runs(), permTab: 'payment_runs'),
        ],
      );
}

const kPayTypeLabels = {
  'vendor': 'Vendor payment', 'customer': 'Customer receipt', 'expense': 'Expense payment', 'other_receipt': 'Other receipt',
  'contra': 'Contra', 'employee': 'Employee payment',
};
const _typeHex = {
  'vendor': Color(0xFFB45309), 'customer': Color(0xFF15803D), 'expense': Color(0xFF9333EA), 'other_receipt': Color(0xFF0369A1),
  'contra': Color(0xFF64748B), 'employee': Color(0xFF64748B),
};
const _statusLabels = {'posted': 'Posted', 'cancelled': 'Cancelled', 'pending_approval': 'Waiting approval', 'rejected': 'Rejected'};
const _statusHex = {'posted': Color(0xFF22C55E), 'cancelled': Color(0xFF78716C), 'pending_approval': Color(0xFFF59E0B), 'rejected': Color(0xFFDC2626)};
const _reconLabels = {'pending': 'Unreconciled', 'reconciled': 'Reconciled', 'cleared': 'Cleared'};
const _reconHex = {'pending': Color(0xFF94A3B8), 'reconciled': Color(0xFF22C55E), 'cleared': Color(0xFF22C55E)};
const _modes = ['cheque', 'neft', 'rtgs', 'imps', 'upi', 'cash', 'dd'];
const kModeLabels = {'cheque': 'Cheque', 'neft': 'NEFT', 'rtgs': 'RTGS', 'imps': 'IMPS', 'upi': 'UPI', 'cash': 'Cash', 'dd': 'Demand Draft'};
const _createTypes = {
  'vendor': 'Vendor payment (PV)',
  'customer': 'Customer receipt (RV)',
  'expense': 'Expense payment (PV)',
  'other_receipt': 'Other receipt (RV)',
  'contra': 'Contra — bank/cash transfer (CV)',
};
const _deductionReasons = {
  'ld_deduction': 'Liquidated damages (LD)',
  'penalty': 'Penalty',
  'bank_charges': 'Bank charges',
  'short_payment': 'Short payment written off',
  'rounding': 'Rounding / small difference',
  'cash_discount': 'Cash (early-payment) discount',
  'other': 'Other (pick the ledger)',
};
const _tabTypes = {
  'All': null, 'Vendor Payments': 'vendor', 'Customer Receipts': 'customer', 'Expense Payments': 'expense',
  'Other Receipts': 'other_receipt', 'Contra': 'contra',
};

String _bankLabel(Json b) =>
    '${b['bank_name']}${(b['account_no'] ?? '').toString().isNotEmpty ? ' — ${b['account_no']}' : ''}${b['account_kind'] == 'cash' ? ' (cash)' : ''}';

String _partyCell(Json p) {
  if (p['vendor_name'] != null || p['customer_name'] != null) return '${p['vendor_name'] ?? p['customer_name']}';
  final lines = listOf(p['lines']);
  if (lines.isNotEmpty) return lines.map((l) => '${l['gl_account_code'] ?? ''} ${l['gl_account_name'] ?? ''}'.trim()).join(', ');
  if (p['payment_type'] == 'contra') return 'Bank/cash transfer';
  return txt(p['narration']);
}

// ── Voucher list ─────────────────────────────────────────────────────────────

class _Vouchers extends StatefulWidget {
  const _Vouchers();

  @override
  State<_Vouchers> createState() => _VouchersState();
}

class _VouchersState extends State<_Vouchers> {
  final _list = GlobalKey<ApiListViewState>();
  String _tab = 'All';
  DateTime? _from = fyStart();
  DateTime? _to = DateTime.now();
  String? _status;

  void _reload() => _list.currentState?.reload();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCan('payments', 'create')
          ? CreateFab(
              label: 'New voucher',
              onPressed: () async {
                if (await showPaymentVoucherForm(context)) _reload();
              })
          : null,
      body: ApiListView(
        key: _list,
        load: (p, s) async => ApiPage(asRows(await Api.get('/accounts/payments', query: {
          'payment_type': _tabTypes[_tab],
          'status': _status,
          'from_date': dateOrNull(_from),
          'to_date': dateOrNull(_to),
        }))),
        emptyText: 'No vouchers in this period.',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ChipRow([
            for (final t in _tabTypes.keys)
              CountChip(t, null,
                  selected: _tab == t,
                  onTap: () => setState(() {
                        _tab = t;
                        _reload();
                      })),
          ]),
          DateRangeRow(
              from: _from,
              to: _to,
              onChanged: (f, t) => setState(() {
                    _from = f;
                    _to = t;
                    _reload();
                  })),
          padded(AppSelect<String>(
            label: 'Status',
            value: _status,
            options: [for (final e in _statusLabels.entries) Option(e.key, e.value)],
            onChanged: (o) => setState(() {
              _status = o?.value;
              _reload();
            }),
          )),
        ]),
        itemBuilder: (ctx, p, reload) => RecordCard(
          code: '${p['payment_number']}',
          title: _partyCell(p),
          subtitle:
              '${p['bank_account_label'] ?? '—'}${p['payment_type'] == 'contra' && p['counter_bank_account_label'] != null ? ' → ${p['counter_bank_account_label']}' : ''}',
          trailing: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              FinStatusPill(p['status'], labels: _statusLabels, colors: _statusHex),
              const SizedBox(height: 4),
              FinStatusPill(p['payment_type'], labels: kPayTypeLabels, colors: _typeHex),
            ]),
          ),
          meta: [
            ('Date', fmtDate(p['payment_date'])),
            ('Amount', inr(p['amount'])),
            if (toD(p['unallocated_amount']) > 0.005) ('Unallocated', inr(p['unallocated_amount'])),
            (
              'Mode / ref',
              '${kModeLabels['${p['payment_mode']}'] ?? p['payment_mode']}${p['cheque_number'] != null ? ' · Chq ${p['cheque_number']}' : p['reference_no'] != null ? ' · ${p['reference_no']}' : ''}'
            ),
            ('Bank reco', _reconLabels['${p['reconciliation_status']}'] ?? txt(p['reconciliation_status'])),
            if (p['is_advance'] == true)
              ('Advance', '${p['sales_order_number'] ?? p['purchase_order_number'] ?? 'On account'}'),
            if (p['status'] == 'pending_approval' && p['approval_stage'] != null) ('Stage', '${p['approval_stage']}'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => PaymentVoucherScreen(id: toInt(p['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

class PaymentVoucherScreen extends StatefulWidget {
  const PaymentVoucherScreen({super.key, required this.id});
  final int id;

  @override
  State<PaymentVoucherScreen> createState() => _PaymentVoucherScreenState();
}

class _PaymentVoucherScreenState extends State<PaymentVoucherScreen> {
  int _tick = 0;
  void _reload() => setState(() => _tick++);

  Future<void> _cancel(Json p) async {
    final reason = await promptDialog(context,
        title: 'Cancel ${p['payment_number']}?',
        message:
            "Reverses the voucher's journal entry and releases every bill it settled. Those bills become due again. A voucher already reconciled with the bank statement can't be cancelled. The reason is kept on the voucher and in the audit log.",
        label: 'Reason for cancelling',
        confirmLabel: 'Cancel voucher');
    if (reason == null || !mounted) return;
    if (await runAction(context, () => Api.post('/accounts/payments/${p['id']}/cancel', data: {'reason': reason}),
        success: '${p['payment_number']} was cancelled; its journal has been reversed and its allocations released.')) {
      _reload();
    }
  }

  Future<void> _removeAllocation(Json a) async {
    final ok = await confirmDialog(context,
        title: 'Remove this allocation?',
        message:
            'The bill becomes due again by this amount, and the amount goes back to the voucher as an unallocated advance. No journal entry changes.',
        confirmLabel: 'Remove',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/accounts/payments/allocations/${a['id']}'), success: 'Allocation removed.')) _reload();
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      key: ValueKey(_tick),
      load: () async => asJson(await Api.get('/accounts/payments/${widget.id}')),
      builder: (ctx, p, reload) {
        final party = p['payment_type'] == 'vendor' || p['payment_type'] == 'customer';
        final reconciled = p['reconciliation_status'] != 'pending' || (p['counter_reconciliation_status'] ?? 'pending') != 'pending';
        final canAllocate = p['status'] == 'posted' && party && toD(p['unallocated_amount']) > 0.005 && finCanFeature('payments', 'allocation', 'edit');
        final actions = <Widget>[
          if (canAllocate)
            actionBtn('Allocate', () async {
              final ok = await showAllocateSheet(context,
                  sourceType: 'payment',
                  sourceId: toInt(p['id'])!,
                  docNumber: '${p['payment_number']}',
                  available: toD(p['unallocated_amount']),
                  partyType: p['payment_type'] == 'vendor' ? 'vendor' : 'customer',
                  partyId: toInt(p['payment_type'] == 'vendor' ? p['vendor_id'] : p['customer_id'])!,
                  partyName: '${p['vendor_name'] ?? p['customer_name'] ?? ''}');
              if (ok) _reload();
            }, primary: true),
          if (p['status'] == 'posted' && !reconciled && finCanFeature('payments', 'cancellation', 'cancel'))
            actionBtn('Cancel', () => _cancel(p), danger: true),
        ];
        final lines = listOf(p['lines']);
        final deductions = listOf(p['deductions']);
        final allocations = listOf(p['allocations']);
        return SubPage(
          title: '${p['payment_number']}',
          bottom: actions.isEmpty ? null : ActionBar(actions),
          body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Wrap(spacing: 8, runSpacing: 6, children: [
                FinStatusPill(p['payment_type'], labels: kPayTypeLabels, colors: _typeHex),
                FinStatusPill(p['status'], labels: _statusLabels, colors: _statusHex),
                FinStatusPill(p['reconciliation_status'], labels: _reconLabels, colors: _reconHex),
              ]),
            ),
            if (p['status'] == 'posted' && reconciled)
              const InfoBanner(
                  'This voucher has been matched to the bank statement, so it really went through the bank — record a reverse voucher instead of cancelling.'),
            DetailSection('Payment', children: [
              FieldRow('Date', fmtDate(p['payment_date'])),
              FieldRow('Party / ledgers', _partyCell(p)),
              FieldRow('Bank / cash',
                  '${p['bank_account_label'] ?? '—'}${p['counter_bank_account_label'] != null ? ' → ${p['counter_bank_account_label']}' : ''}'),
              FieldRow('Mode', kModeLabels['${p['payment_mode']}'] ?? p['payment_mode']),
              AmountRow('Amount', inr(p['amount']), bold: true),
              AmountRow('Unallocated', inr(p['unallocated_amount'])),
              FieldRow('Narration', p['narration']),
              if (p['cheque_number'] != null)
                FieldRow('Cheque', 'No. ${p['cheque_number']}${p['cheque_date'] != null ? ' dated ${fmtDate(p['cheque_date'])}' : ''}'),
              if (p['reference_no'] != null) FieldRow('Reference', p['reference_no']),
              if (p['cleared_date'] != null) FieldRow('Cleared in bank on', fmtDate(p['cleared_date'])),
              if (p['is_advance'] == true)
                FieldRow('Advance against',
                    '${p['sales_order_number'] ?? p['purchase_order_number'] ?? 'On account${p['advance_reason'] != null ? ' — ${p['advance_reason']}' : ''}'}'),
            ]),
            DetailSection('Record', children: [
              FieldRow('Recorded by', p['created_by_name']),
              if (p['approved_by_name'] != null) FieldRow('Approved by', p['approved_by_name']),
              if (p['rejection_reason'] != null) FieldRow('Rejected because', p['rejection_reason']),
            ]),
            if (p['status'] == 'pending_approval' || p['approval_request_id'] != null)
              ApprovalPanel(entityType: 'accounts_payment', entityId: toInt(p['id'])!, onChanged: reload),
            if (lines.isNotEmpty)
              DetailSection('Ledger lines', children: [
                for (final l in lines)
                  AmountRow('${l['gl_account_code']} — ${l['gl_account_name']}${l['remarks'] != null ? ' · ${l['remarks']}' : ''}', inr(l['amount'])),
              ]),
            if (deductions.isNotEmpty)
              DetailSection('Deductions (settled without cash)', children: [
                for (final d in deductions)
                  AmountRow(
                      '${d['target_number'] ?? '#${d['target_id']}'} · ${d['reason_label'] ?? d['reason']} · ${d['gl_account_code']} — ${d['gl_account_name']}${d['remarks'] != null ? ' · ${d['remarks']}' : ''}',
                      inr(d['amount'])),
              ]),
            if (party && p['status'] == 'pending_approval')
              const InfoBanner('Bills are settled when the payment is approved and posted.'),
            if (party && p['status'] != 'pending_approval')
              DetailSection(p['is_advance'] == true ? 'Invoices this advance was adjusted against' : 'Bills settled', children: [
                if (allocations.isEmpty)
                  const Text('Nothing allocated yet — the full amount is an advance on the party.', style: TextStyle(color: Brand.muted)),
                for (final a in allocations)
                  Row(children: [
                    Expanded(child: AmountRow('${a['target_number'] ?? '#${a['target_id']}'} · ${fmtDate(a['allocation_date'])}', inr(a['amount']))),
                    if (p['status'] == 'posted' && finCanFeature('payments', 'allocation', 'edit'))
                      IconButton(
                          tooltip: 'Remove',
                          icon: const Icon(Icons.link_off_rounded, color: Brand.danger, size: 20),
                          onPressed: () => _removeAllocation(a)),
                  ]),
              ]),
            FinanceAttachments(
              entityType: 'payment',
              entityId: toInt(p['id'])!,
              tabKey: 'payments',
              locked: p['status'] != 'pending_approval',
              closed: p['status'] == 'cancelled' || p['status'] == 'rejected',
            ),
          ]),
        );
      },
    );
  }
}

// ── Allocate / set off (portal AllocateDialog + AllocateCreditDialog) ────────

/// Sets an open credit (payment, advance, note, journal) off against the
/// party's open bills. True when allocated.
Future<bool> showAllocateSheet(
  BuildContext context, {
  required String sourceType,
  required int sourceId,
  required String docNumber,
  required double available,
  required String partyType,
  required int partyId,
  String partyName = '',
}) async {
  List<Json> docs;
  try {
    docs = listOf(asJson(await Api.get('/accounts/payments/open-items', query: {'party_type': partyType, 'party_id': partyId}))['documents']);
  } catch (e) {
    if (context.mounted) showSnack(context, "Could not load the party's open bills. ${ApiClient.describe(e)}", error: true);
    return false;
  }
  final ctrls = {for (final d in docs) toInt(d['id'])!: TextEditingController()};
  double total() => round2(ctrls.values.fold<double>(0, (s, c) => s + (double.tryParse(c.text) ?? 0)));
  if (!context.mounted) return false;
  final ok = await showFormSheet(
    context,
    title: sourceType == 'payment' ? 'Allocate $docNumber' : 'Set off $docNumber',
    saveLabel: 'Allocate',
    builder: (ctx, setS) => [
      Text('${partyName.isNotEmpty ? '$partyName — ' : ''}${inr(available)} unallocated', style: const TextStyle(color: Brand.muted)),
      const Text(
          'Set this advance off against the bills it pays; only the bill-wise status changes, the journal entry stays as it is.',
          style: TextStyle(fontSize: 12, color: Brand.muted)),
      if (docs.isEmpty) const Text('This party has no open bills to allocate against.'),
      if (docs.isNotEmpty)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed: () => setS(() {
              var left = available;
              for (final d in docs) {
                final take = left <= 0 ? 0.0 : round2(toD(d['amount_due']) < left ? toD(d['amount_due']) : left);
                ctrls[toInt(d['id'])!]!.text = take > 0 ? '$take' : '';
                left = round2(left - take);
              }
            }),
            child: const Text('Fill oldest first'),
          ),
        ),
      for (final d in docs)
        Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${d['doc_number']}', style: const TextStyle(fontWeight: FontWeight.w600)),
              Text(
                  '${fmtDate(d['doc_date'])} · due ${fmtDate(d['due_date'])}${toInt(d['days_overdue']) != null && toInt(d['days_overdue'])! > 0 ? ' · ${d['days_overdue']} d overdue' : ''} · ${inr(d['amount_due'])} due',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
          ),
          SizedBox(
            width: 110,
            child: AppTextField(
                label: 'Allocate', controller: ctrls[toInt(d['id'])!], keyboardType: AppTextField.number, onChanged: (_) => setS(() {})),
          ),
          TextButton(
            onPressed: () => setS(() => ctrls[toInt(d['id'])!]!.text =
                '${round2(toD(d['amount_due']) < available ? toD(d['amount_due']) : available)}'),
            child: const Text('Max'),
          ),
        ]),
      Text('Allocating ${inr(total())} of ${inr(available)}',
          style: TextStyle(fontWeight: FontWeight.w600, color: total() > available + 0.001 ? Brand.danger : Brand.body)),
    ],
    onSave: () async {
      final allocations = [
        for (final d in docs)
          if ((double.tryParse(ctrls[toInt(d['id'])!]!.text) ?? 0) > 0)
            {'target_type': d['target_type'], 'target_id': d['id'], 'amount': round2(double.parse(ctrls[toInt(d['id'])!]!.text))},
      ];
      if (allocations.isEmpty) throw 'Enter an amount against at least one bill.';
      if (total() > available + 0.001) throw 'You are allocating ${inr(total())} but $docNumber has only ${inr(available)} unallocated.';
      await Api.post('/accounts/payments/allocate',
          data: {'source_type': sourceType, 'source_id': sourceId, 'allocations': allocations, 'allocation_date': todayIso()});
    },
  );
  if (ok && context.mounted) showSnack(context, '${inr(total())} of $docNumber has been set off against the selected bills.');
  return ok;
}

// ── New voucher form ─────────────────────────────────────────────────────────

class _Split {
  int? ledgerId;
  String? ledgerLabel;
  int? ccId;
  String? ccLabel;
  int? ioId;
  String? ioLabel;
  final amount = TextEditingController();
  final remarks = TextEditingController();
}

class _Deduction {
  int? targetId;
  String reason = 'ld_deduction';
  int? ledgerId;
  String? ledgerLabel;
  final amount = TextEditingController();
  final remarks = TextEditingController();
}

/// New payment / receipt / contra voucher (portal "New voucher" form).
/// [paymentType] + party preset it (Purchase › Pay, Sales › Receive,
/// Outstanding). True when saved.
Future<bool> showPaymentVoucherForm(BuildContext context,
    {String? paymentType, int? vendorId, int? customerId, String? partyLabel}) async {
  List<Json> banks;
  ProofRules rules;
  try {
    banks = asRows(await Api.get('/accounts/bank-accounts', query: {'status': 'active'}));
    rules = await ProofRules.load();
  } catch (e) {
    if (context.mounted) showSnack(context, 'Could not load bank accounts. ${ApiClient.describe(e)}', error: true);
    return false;
  }
  String ptype = paymentType ?? (customerId != null && vendorId == null ? 'customer' : 'vendor');
  int? partyId = vendorId ?? customerId;
  String? partyName = partyLabel;
  List<Json> openDocs = [];
  List<Json> openCredits = [];
  bool openLoading = false;
  final settle = <int, TextEditingController>{};
  final amount = TextEditingController();
  final lines = [_Split()];
  int? bankId;
  int? counterBankId;
  String mode = 'neft';
  DateTime payDate = DateTime.now();
  final chequeNo = TextEditingController();
  DateTime? chequeDate;
  final referenceNo = TextEditingController();
  final narration = TextEditingController();
  final proof = <PickedProof>[];
  final deductions = <_Deduction>[];
  bool isAdvance = false;
  int? orderId;
  String? orderLabel;
  final advanceReason = TextEditingController();
  String? orderNote;
  Json? result;

  Json? bankById(int? id) {
    for (final b in banks) {
      if (toInt(b['id']) == id) return b;
    }
    return null;
  }

  Future<void> loadOpen(StateSetter setS) async {
    if (partyId == null || (ptype != 'vendor' && ptype != 'customer')) return;
    setS(() => openLoading = true);
    try {
      final d = asJson(await Api.get('/accounts/payments/open-items', query: {'party_type': ptype, 'party_id': partyId}));
      setS(() {
        openDocs = listOf(d['documents']);
        openCredits = listOf(d['credits']);
        settle
          ..clear()
          ..addAll({for (final x in openDocs) toInt(x['id'])!: TextEditingController()});
      });
    } catch (_) {
      // Shown again by the server on save if it matters.
    } finally {
      setS(() => openLoading = false);
    }
  }

  bool started = false;
  if (!context.mounted) return false;
  final saved = await showFormSheet(
    context,
    title: 'New voucher',
    saveLabel: 'Save voucher',
    builder: (ctx, setS) {
      if (!started) {
        started = true;
        if (partyId != null) Future.microtask(() => loadOpen(setS));
      }
      final isParty = ptype == 'vendor' || ptype == 'customer';
      final isSplit = ptype == 'expense' || ptype == 'other_receipt';
      final amountNum = round2(double.tryParse(amount.text) ?? 0);
      final allocated = round2(settle.values.fold<double>(0, (s, c) => s + (double.tryParse(c.text) ?? 0)));
      final onAccount = round2(amountNum - allocated);
      final dedTotal = round2(deductions.fold<double>(0, (s, d) => s + (double.tryParse(d.amount.text) ?? 0)));
      final linesTotal = round2(lines.fold<double>(0, (s, l) => s + (double.tryParse(l.amount.text) ?? 0)));
      final bank = bankById(bankId);
      final modes = bank != null && bank['account_kind'] == 'cash' ? ['cash'] : _modes.where((m) => m != 'cash').toList();
      final proofRequired = rules.paymentNeedsProof(ptype, amountNum);
      void changeType(String t) {
        ptype = t;
        partyId = null;
        partyName = null;
        openDocs = [];
        openCredits = [];
        settle.clear();
        lines
          ..clear()
          ..add(_Split());
        counterBankId = null;
        deductions.clear();
        isAdvance = false;
        orderId = null;
      }

      return [
        const Text('Vendor payment, customer receipt, expense payment, other receipt or contra — settled bill-wise against open invoices.',
            style: TextStyle(color: Brand.muted)),
        const Caps('Voucher'),
        AppSelect<String>(
          label: 'Voucher type',
          required: true,
          value: ptype,
          clearable: false,
          options: [for (final e in _createTypes.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => changeType(o?.value ?? ptype)),
        ),
        if (isParty)
          AppSelect<int>(
            label: ptype == 'vendor' ? 'Vendor' : 'Customer',
            required: true,
            value: partyId,
            valueLabel: partyName,
            loadOptions: ptype == 'vendor' ? FinLookups.vendors : customerOptions,
            onChanged: (o) {
              setS(() {
                partyId = o?.value;
                partyName = o?.label;
                orderId = null;
                deductions.clear();
                openDocs = [];
                settle.clear();
              });
              loadOpen(setS);
            },
          ),
        DateField(label: 'Date', required: true, value: payDate, onChanged: (d) => setS(() => payDate = d ?? payDate)),
        AppTextField(label: 'Amount (₹)', required: true, controller: amount, keyboardType: AppTextField.number, onChanged: (_) => setS(() {})),
        const Caps('Bank & mode'),
        AppSelect<int>(
          label: ptype == 'contra'
              ? 'From (paying) account'
              : ptype == 'customer' || ptype == 'other_receipt'
                  ? 'Received into (bank/cash)'
                  : 'Paid from (bank/cash)',
          required: true,
          value: bankId,
          options: [for (final b in banks) Option(toInt(b['id'])!, '${_bankLabel(b)} · bal ${inr(b['book_balance'])}')],
          onChanged: (o) => setS(() {
            bankId = o?.value;
            final b = bankById(bankId);
            if (b?['account_kind'] == 'cash') {
              mode = 'cash';
            } else if (mode == 'cash') {
              mode = 'neft';
            }
          }),
        ),
        if (ptype == 'contra')
          AppSelect<int>(
            label: 'To (receiving) account',
            required: true,
            value: counterBankId,
            options: [
              for (final b in banks)
                if (toInt(b['id']) != bankId) Option(toInt(b['id'])!, '${_bankLabel(b)} · bal ${inr(b['book_balance'])}'),
            ],
            onChanged: (o) => setS(() => counterBankId = o?.value),
          ),
        AppSelect<String>(
          label: 'Mode',
          value: mode,
          clearable: false,
          options: [for (final m in modes) Option(m, kModeLabels[m] ?? m)],
          onChanged: (o) => setS(() => mode = o?.value ?? mode),
        ),
        if (mode == 'cheque') ...[
          AppTextField(label: 'Cheque no.', required: true, controller: chequeNo),
          DateField(label: 'Cheque date', value: chequeDate, onChanged: (d) => setS(() => chequeDate = d)),
        ],
        if (mode != 'cash') AppTextField(label: mode == 'cheque' ? 'Reference' : 'UTR / reference', controller: referenceNo),
        if (bank != null)
          Text(
              'Book balance of ${bank['bank_name']}: ${inr(bank['book_balance'])}${bank['account_kind'] == 'cash' ? " — cash can't go below zero; record a withdrawal (contra) first if it would." : ''}',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
        if (isParty) ...[
          const Caps('Advance (down payment)'),
          CheckField(
            label:
                'This is an advance (down payment) ${ptype == 'customer' ? 'received from the customer' : 'paid against a purchase order'}',
            value: isAdvance,
            onChanged: (v) => setS(() {
              isAdvance = v;
              for (final c in settle.values) {
                c.clear();
              }
              deductions.clear();
              orderId = null;
            }),
          ),
          if (isAdvance) ...[
            if (ptype == 'vendor')
              AppSelect<int>(
                label: 'Purchase order',
                value: orderId,
                valueLabel: orderLabel,
                loadOptions: (q) async {
                  try {
                    final rows = asRows(await Api.get('/p2p/purchase-orders', query: {'limit': 500, 'search': q}));
                    return [
                      for (final o in rows)
                        if ((o['vendor_id'] == null || toInt(o['vendor_id']) == partyId) &&
                            !const ['cancelled', 'rejected', 'draft'].contains(o['status']))
                          Option(toInt(o['id'])!, '${o['po_number']} (${o['status']})'),
                    ];
                  } catch (_) {
                    setS(() => orderNote = 'Purchase orders could not be loaded (you may not have Purchase access) — give the reason instead.');
                    return <Option<int>>[];
                  }
                },
                onChanged: (o) => setS(() {
                  orderId = o?.value;
                  orderLabel = o?.label;
                }),
              ),
            AppTextField(
                label: ptype == 'customer' ? 'Reason (what the advance is for)' : 'Reason (if on account)',
                controller: advanceReason,
                hint: 'e.g. tender EMD, advance against LOA'),
            Text(
                orderNote ??
                    'The advance is held on the ${ptype == 'customer' ? 'Advances from Customers (Other Current Liabilities)' : 'Advances to Suppliers (Short-term Loans & Advances)'} ledger — not netted in ${ptype == 'customer' ? 'Trade Receivables' : 'Trade Payables'} — and is adjusted against the invoice later with Allocate.',
                style: const TextStyle(fontSize: 12, color: Brand.muted)),
          ],
        ],
        if (isParty && partyId != null && !isAdvance) ...[
          Row(children: [
            Caps('Open bills (${openDocs.length})'),
            const Spacer(),
            if (openDocs.isNotEmpty && amountNum > 0)
              TextButton(
                onPressed: () => setS(() {
                  var left = amountNum;
                  for (final d in openDocs) {
                    final due = toD(d['amount_due']);
                    final take = left <= 0 ? 0.0 : round2(due < left ? due : left);
                    settle[toInt(d['id'])!]!.text = take > 0 ? '$take' : '';
                    left = round2(left - take);
                  }
                }),
                child: const Text('Auto-settle oldest first'),
              ),
          ]),
          if (openLoading) const Text('Loading open bills…', style: TextStyle(color: Brand.muted)),
          if (!openLoading && openDocs.isEmpty)
            const Text('No open bills — the whole amount will be recorded as an advance.', style: TextStyle(color: Brand.muted)),
          for (final d in openDocs)
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10)),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${d['doc_number']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(
                        '${fmtDate(d['doc_date'])} · due ${fmtDate(d['due_date'])}${(toInt(d['days_overdue']) ?? 0) > 0 ? ' · ${d['days_overdue']} d overdue' : ''}',
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    Text('Bill ${inr(d['total'])} · due ${inr(d['amount_due'])}', style: const TextStyle(fontSize: 12)),
                    TextButton(
                      style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 28)),
                      onPressed: () => setS(() => settle[toInt(d['id'])!]!.text = '${d['amount_due']}'),
                      child: Text(ptype == 'vendor' ? 'Pay in full' : 'Receive in full'),
                    ),
                  ]),
                ),
                SizedBox(
                  width: 120,
                  child: AppTextField(
                      label: 'Settle amount',
                      controller: settle[toInt(d['id'])!],
                      keyboardType: AppTextField.number,
                      onChanged: (_) => setS(() {})),
                ),
              ]),
            ),
          if (openCredits.isNotEmpty)
            Text(
                'Existing unadjusted credits on this party (allocate them from the voucher list or Outstanding rather than paying again): '
                '${openCredits.map((c) => '${c['doc_number']} (${fmtDate(c['doc_date'])}) ${inr(c['available'])}').join('; ')}',
                style: const TextStyle(fontSize: 12, color: Brand.muted)),
          if (openDocs.isNotEmpty) ...[
            Row(children: [
              Caps('Deductions ${ptype == 'customer' ? 'made by the customer' : 'made from the vendor'}'),
              const Spacer(),
              TextButton(onPressed: () => setS(() => deductions.add(_Deduction())), child: const Text('+ Add deduction')),
            ]),
            for (final d in deductions)
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10)),
                child: Column(children: [
                  Row(children: [
                    Expanded(
                      child: AppSelect<int>(
                        label: 'Bill',
                        value: d.targetId,
                        options: [for (final x in openDocs) Option(toInt(x['id'])!, '${x['doc_number']}')],
                        onChanged: (o) => setS(() => d.targetId = o?.value),
                      ),
                    ),
                    IconButton(
                        icon: const Icon(Icons.close_rounded, color: Brand.danger), onPressed: () => setS(() => deductions.remove(d))),
                  ]),
                  const SizedBox(height: 8),
                  AppSelect<String>(
                    label: 'Reason',
                    value: d.reason,
                    clearable: false,
                    options: [for (final e in _deductionReasons.entries) Option(e.key, e.value)],
                    onChanged: (o) => setS(() => d.reason = o?.value ?? d.reason),
                  ),
                  const SizedBox(height: 8),
                  AppTextField(label: 'Amount', controller: d.amount, keyboardType: AppTextField.number, onChanged: (_) => setS(() {})),
                  const SizedBox(height: 8),
                  AppSelect<int>(
                    label: d.reason == 'other' ? 'Ledger *' : 'Ledger (default for the reason)',
                    value: d.ledgerId,
                    valueLabel: d.ledgerLabel,
                    loadOptions: (q) async => (await FinLookups.ledgerOptions())
                        .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                        .toList(),
                    onChanged: (o) => setS(() {
                      d.ledgerId = o?.value;
                      d.ledgerLabel = o?.label;
                    }),
                  ),
                  const SizedBox(height: 8),
                  AppTextField(label: 'Remarks', controller: d.remarks),
                ]),
              ),
          ],
        ],
        if (isSplit) ...[
          Caps(ptype == 'expense' ? 'Expense ledgers (debit)' : 'Income / other ledgers (credit)'),
          for (final l in lines)
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10)),
              child: Column(children: [
                Row(children: [
                  Expanded(
                    child: AppSelect<int>(
                      label: 'Ledger',
                      required: true,
                      value: l.ledgerId,
                      valueLabel: l.ledgerLabel,
                      loadOptions: (q) async {
                        final bankGl = {for (final b in banks) toInt(b['gl_account_id'])};
                        return (await FinLookups.ledgerOptions(
                                filter: (a) => a['is_control_account'] != true && !bankGl.contains(toInt(a['id']))))
                            .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                            .toList();
                      },
                      onChanged: (o) => setS(() {
                        l.ledgerId = o?.value;
                        l.ledgerLabel = o?.label;
                      }),
                    ),
                  ),
                  if (lines.length > 1)
                    IconButton(icon: const Icon(Icons.close_rounded, color: Brand.danger), onPressed: () => setS(() => lines.remove(l))),
                ]),
                const SizedBox(height: 8),
                AppTextField(label: 'Amount (₹)', controller: l.amount, keyboardType: AppTextField.number, onChanged: (_) => setS(() {})),
                const SizedBox(height: 8),
                AppSelect<int>(
                  label: 'Cost centre',
                  value: l.ccId,
                  valueLabel: l.ccLabel,
                  loadOptions: (q) async => (await FinLookups.costCentres())
                      .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                      .toList(),
                  onChanged: (o) => setS(() {
                    l.ccId = o?.value;
                    l.ccLabel = o?.label;
                  }),
                ),
                const SizedBox(height: 8),
                AppSelect<int>(
                  label: 'Internal order',
                  value: l.ioId,
                  valueLabel: l.ioLabel,
                  loadOptions: (q) async => (await FinLookups.internalOrders())
                      .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                      .toList(),
                  onChanged: (o) => setS(() {
                    l.ioId = o?.value;
                    l.ioLabel = o?.label;
                  }),
                ),
                const SizedBox(height: 8),
                AppTextField(label: 'Remarks', controller: l.remarks),
              ]),
            ),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
                onPressed: () => setS(() => lines.add(_Split())), icon: const Icon(Icons.add_rounded, size: 18), label: const Text('Add line')),
          ),
        ],
        AppTextField(label: 'Narration', controller: narration, maxLines: 3, hint: 'What this money is for'),
        if (ptype != 'contra')
          ProofPicker(entityType: 'payment', value: proof, setState: setS, required: proofRequired, hint: 'Bill, bank advice or UTR screenshot.'),
        const Caps('Summary'),
        Column(children: [
          AmountRow('Voucher amount', inr(amountNum), bold: true),
          if (isParty && !isAdvance) ...[
            AmountRow('Allocated to bills', inr(allocated)),
            if (deductions.isNotEmpty) AmountRow('Deductions', inr(dedTotal)),
            AmountRow('On account (advance)', inr(onAccount), color: onAccount < 0 ? Brand.danger : null),
          ],
          if (isSplit)
            AmountRow('Ledger lines total', inr(linesTotal), color: linesTotal == amountNum ? null : Brand.danger),
        ]),
      ];
    },
    onSave: () async {
      final isParty = ptype == 'vendor' || ptype == 'customer';
      final isSplit = ptype == 'expense' || ptype == 'other_receipt';
      final amountNum = round2(double.tryParse(amount.text) ?? 0);
      final allocated = round2(settle.values.fold<double>(0, (s, c) => s + (double.tryParse(c.text) ?? 0)));
      final linesTotal = round2(lines.fold<double>(0, (s, l) => s + (double.tryParse(l.amount.text) ?? 0)));
      final errs = <String>[];
      if (bankId == null) errs.add('Pick the ${ptype == 'customer' || ptype == 'other_receipt' ? 'receiving' : 'paying'} bank/cash account.');
      if (amountNum <= 0) errs.add('Enter an amount greater than zero.');
      if (isParty && partyId == null) errs.add(ptype == 'vendor' ? 'Pick the vendor being paid.' : 'Pick the customer the money is received from.');
      if (isParty && isAdvance && orderId == null && advanceReason.text.trim().isEmpty) {
        errs.add(ptype == 'customer'
            ? 'Give the reason this advance is held on account (for example the tender, LOA or project it is for).'
            : 'Link the advance to the purchase order it is for, or give the reason it is on account.');
      }
      if (isParty && !isAdvance) {
        for (final d in deductions) {
          Json? doc;
          for (final x in openDocs) {
            if (toInt(x['id']) == d.targetId) doc = x;
          }
          if (doc == null) {
            errs.add('Pick the bill each deduction was made against.');
          } else {
            final v = double.tryParse(d.amount.text) ?? 0;
            if (v <= 0) errs.add('${doc['doc_number']}: deduction amount must be greater than zero.');
            final onBill = round2((double.tryParse(settle[d.targetId]?.text ?? '') ?? 0) +
                deductions.where((x) => x.targetId == d.targetId).fold<double>(0, (s, x) => s + (double.tryParse(x.amount.text) ?? 0)));
            if (onBill > toD(doc['amount_due']) + 0.001) {
              errs.add('${doc['doc_number']} has ${inr(doc['amount_due'])} due but cash + deductions come to ${inr(onBill)}.');
            }
          }
          if (d.reason == 'other' && d.ledgerId == null) errs.add('Pick the ledger for an "Other" deduction.');
        }
        if (allocated > amountNum + 0.001) {
          errs.add('Settled amounts add up to ${inr(allocated)} but the voucher is only ${inr(amountNum)} — reduce the settlements or raise the amount.');
        }
        for (final d in openDocs) {
          final v = double.tryParse(settle[toInt(d['id'])]?.text ?? '') ?? 0;
          if (v < 0) errs.add("${d['doc_number']}: settle amount can't be negative.");
          if (v > toD(d['amount_due']) + 0.001) errs.add("${d['doc_number']} has only ${inr(d['amount_due'])} due — can't settle ${inr(v)}.");
        }
      }
      if (isSplit) {
        if (lines.any((l) => l.ledgerId == null)) errs.add('Pick a ledger on every line (or remove the empty line).');
        if (linesTotal != amountNum) {
          errs.add('The ledger lines add up to ${inr(linesTotal)} but the voucher amount is ${inr(amountNum)} — they must match.');
        }
      }
      if (ptype == 'contra') {
        if (counterBankId == null) {
          errs.add('Pick the receiving bank/cash account.');
        } else if (counterBankId == bankId) {
          errs.add('A contra moves money between two different accounts — pick a different receiving account.');
        }
      }
      if (mode == 'cheque' && chequeNo.text.trim().isEmpty) errs.add('Enter the cheque number for a cheque payment.');
      if (rules.paymentNeedsProof(ptype, amountNum) && proof.isEmpty) {
        errs.add(
            'Attach a supporting document (bill, bank advice or UTR screenshot) — Finance › Settings makes it compulsory ${rules.paymentAbove > 0 ? 'for vouchers above ${inr(rules.paymentAbove)}' : 'for every voucher'}.');
      }
      if (errs.isNotEmpty) throw errs.join('\n');

      final payload = <String, dynamic>{
        'payment_type': ptype,
        'bank_account_id': bankId,
        'amount': amountNum,
        'payment_mode': mode,
        'payment_date': apiDate(payDate),
        'cheque_number': mode == 'cheque' ? chequeNo.text.trim() : null,
        'cheque_date': mode == 'cheque' ? dateOrNull(chequeDate) : null,
        'reference_no': referenceNo.text.trim().isEmpty ? null : referenceNo.text.trim(),
        'narration': narration.text.trim().isEmpty ? null : narration.text.trim(),
      };
      if (ptype == 'vendor') payload['vendor_id'] = partyId;
      if (ptype == 'customer') payload['customer_id'] = partyId;
      if (isParty && isAdvance) {
        payload['is_advance'] = true;
        if (orderId != null && ptype == 'vendor') payload['purchase_order_id'] = orderId;
        payload['advance_reason'] = advanceReason.text.trim().isEmpty ? null : advanceReason.text.trim();
      }
      if (isParty && !isAdvance && deductions.isNotEmpty) {
        payload['deductions'] = [
          for (final d in deductions)
            {
              'target_id': d.targetId,
              'reason': d.reason,
              'amount': round2(double.tryParse(d.amount.text) ?? 0),
              'gl_account_id': d.ledgerId,
              'remarks': d.remarks.text.trim().isEmpty ? null : d.remarks.text.trim(),
            },
        ];
      }
      if (isParty && !isAdvance) {
        payload['allocations'] = [
          for (final d in openDocs)
            if ((double.tryParse(settle[toInt(d['id'])]?.text ?? '') ?? 0) > 0)
              {'target_type': d['target_type'], 'target_id': d['id'], 'amount': round2(double.parse(settle[toInt(d['id'])]!.text))},
        ];
      }
      if (isSplit) {
        payload['lines'] = [
          for (final l in lines)
            {
              'gl_account_id': l.ledgerId,
              'amount': round2(double.tryParse(l.amount.text) ?? 0),
              'cost_center_id': l.ccId,
              'internal_order_id': l.ioId,
              'remarks': l.remarks.text.trim().isEmpty ? null : l.remarks.text.trim(),
            },
        ];
      }
      if (ptype == 'contra') payload['counter_bank_account_id'] = counterBankId;
      if (ptype != 'contra' && proof.isNotEmpty) {
        try {
          payload['attachment_ids'] = await stagePickedProof(proof);
        } catch (e) {
          throw 'Could not upload the supporting documents, so the voucher was not saved. ${ApiClient.describe(e)}';
        }
      }
      result = asJson(await Api.post('/accounts/payments', data: payload));
    },
  );
  if (saved && result != null && context.mounted) {
    final c = result!;
    final type = kPayTypeLabels['${c['payment_type']}'] ?? 'Voucher';
    final adv = toD(c['unallocated_amount']) > 0.005
        ? (c['is_advance'] == true
            ? ' It is held on the ${c['payment_type'] == 'customer' ? 'Advances from Customers' : 'Advances to Suppliers'} ledger until you adjust it against the invoice.'
            : ' ${inr(c['unallocated_amount'])} stays on account as an advance.')
        : '';
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(c['status'] == 'pending_approval' ? 'Sent for approval' : 'Voucher posted'),
        content: Text(c['status'] == 'pending_approval'
            ? '$type for ${inr(c['amount'])} has been recorded and is waiting for approval${c['approval_stage'] != null ? ' (${c['approval_stage']})' : ''}. It is posted — and the bills settled — only once the Finance approver and then a Partner approve it.'
            : '$type ${c['payment_number']} for ${inr(c['amount'])} has been posted.$adv'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
      ),
    );
  }
  return saved;
}

// ── Advances & write-offs ────────────────────────────────────────────────────

const _woReasons = {
  'rounding': 'Rounding / small difference',
  'short_payment': 'Short payment written off',
  'ld_deduction': 'Liquidated damages (LD)',
  'penalty': 'Penalty',
  'bank_charges': 'Bank charges',
  'cash_discount': 'Cash (early-payment) discount',
  'other': 'Other (pick the ledger)',
};
const _woStatusLabels = {'posted': 'Posted', 'cancelled': 'Cancelled', 'pending': 'Pending'};
const _woStatusHex = {'posted': Color(0xFF22C55E), 'cancelled': Color(0xFF78716C), 'pending': Color(0xFFF59E0B)};

class _Advances extends StatelessWidget {
  const _Advances();

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Advances & write-offs',
        showHeader: false,
        tabs: [
          FinSubTab('Open advances', (_) => const _OpenAdvances()),
          FinSubTab('Write-offs', (_) => const _WriteOffs(), visible: finCanFeature('payments', 'write_offs', 'view')),
        ],
      );
}

class _OpenAdvances extends StatelessWidget {
  const _OpenAdvances();

  @override
  Widget build(BuildContext context) {
    final canAllocate = finCanFeature('payments', 'allocation', 'edit');
    return ApiListView(
      load: (p, s) async => ApiPage(asRows(await Api.get('/accounts/payments/advances'))),
      header: const InfoBanner(
          'Customer advances sit on Advances from Customers (Other Current Liabilities) and supplier advances on Advances to Suppliers '
          '(Short-term Loans & Advances) — shown separately on the Balance Sheet, not netted in receivables / payables. When the invoice is '
          'raised, Adjust the advance against it.'),
      emptyText: 'No open advances.',
      itemBuilder: (ctx, a, reload) => RecordCard(
        code: '${a['payment_number']}',
        title: txt(a['party_name']),
        subtitle: a['party_type'] == 'customer' ? 'From customer' : 'To supplier',
        meta: [
          ('Date', fmtDate(a['payment_date'])),
          ('Against', '${a['sales_order_number'] ?? a['purchase_order_number'] ?? 'On account — ${a['advance_reason'] ?? ''}'}'),
          ('Advance', inr(a['amount'])),
          ('Adjusted', inr(a['adjusted'])),
          ('Open', inr(a['balance'])),
        ],
        trailing: canAllocate
            ? TextButton(
                onPressed: () async {
                  final ok = await showAllocateSheet(ctx,
                      sourceType: 'advance',
                      sourceId: toInt(a['id'])!,
                      docNumber: '${a['payment_number']}',
                      available: toD(a['balance']),
                      partyType: '${a['party_type']}',
                      partyId: toInt(a['party_id'])!,
                      partyName: '${a['party_name'] ?? ''}');
                  if (ok) reload();
                },
                child: const Text('Adjust'))
            : null,
      ),
    );
  }
}

class _WriteOffs extends StatefulWidget {
  const _WriteOffs();

  @override
  State<_WriteOffs> createState() => _WriteOffsState();
}

class _WriteOffsState extends State<_WriteOffs> {
  final _list = GlobalKey<ApiListViewState>();

  Future<void> _new() async {
    String partyType = 'customer';
    int? partyId;
    String? partyLabel;
    List<Json> docs = [];
    int? docId;
    String reason = 'rounding';
    final amount = TextEditingController();
    DateTime woDate = DateTime.now();
    int? glId;
    String? glLabel;
    final remarks = TextEditingController();
    Future<void> pick(StateSetter setS, int? id) async {
      setS(() {
        partyId = id;
        docId = null;
        docs = [];
      });
      if (id == null) return;
      final d = asJson(await Api.get('/accounts/payments/open-items', query: {'party_type': partyType, 'party_id': id}));
      setS(() => docs = listOf(d['documents']));
    }

    final ok = await showFormSheet(
      context,
      title: 'Write off what is left on a bill',
      saveLabel: 'Post write-off',
      builder: (ctx, setS) => [
        const Text('For the paise left after a receipt, or an LD / short payment agreed after the receipt was posted.',
            style: TextStyle(color: Brand.muted)),
        const Caps('Bill'),
        AppSelect<String>(
          label: 'Party type',
          value: partyType,
          clearable: false,
          options: const [Option('customer', 'Customer'), Option('vendor', 'Vendor')],
          onChanged: (o) => setS(() {
            partyType = o?.value ?? partyType;
            partyId = null;
            partyLabel = null;
            docs = [];
            docId = null;
          }),
        ),
        AppSelect<int>(
          label: partyType == 'vendor' ? 'Vendor' : 'Customer',
          required: true,
          value: partyId,
          valueLabel: partyLabel,
          loadOptions: partyType == 'vendor' ? FinLookups.vendors : customerOptions,
          onChanged: (o) {
            partyLabel = o?.label;
            pick(setS, o?.value);
          },
        ),
        AppSelect<int>(
          label: 'Bill',
          required: true,
          value: docId,
          options: [
            for (final d in docs) Option(toInt(d['id'])!, '${d['doc_number']}', subtitle: '${fmtDate(d['doc_date'])} · ${inr(d['amount_due'])} due'),
          ],
          onChanged: (o) => setS(() => docId = o?.value),
        ),
        const Caps('Write-off'),
        AppSelect<String>(
          label: 'Reason',
          required: true,
          value: reason,
          clearable: false,
          options: [for (final e in _woReasons.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => reason = o?.value ?? reason),
        ),
        AppTextField(label: 'Amount (₹)', required: true, controller: amount, keyboardType: AppTextField.number),
        DateField(label: 'Date', required: true, value: woDate, onChanged: (d) => setS(() => woDate = d ?? woDate)),
        AppSelect<int>(
          label: 'Ledger',
          required: reason == 'other',
          value: glId,
          valueLabel: glLabel ?? (glId == null ? '— default for the reason —' : null),
          loadOptions: (q) async => (await FinLookups.ledgerOptions())
              .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
              .toList(),
          onChanged: (o) => setS(() {
            glId = o?.value;
            glLabel = o?.label;
          }),
        ),
        AppTextField(label: 'Remarks', controller: remarks),
      ],
      onSave: () async {
        Json? doc;
        for (final d in docs) {
          if (toInt(d['id']) == docId) doc = d;
        }
        final errs = <String>[];
        if (doc == null) errs.add('Pick the bill to write off.');
        final amt = round2(double.tryParse(amount.text) ?? 0);
        if (amt <= 0) errs.add('Enter an amount greater than zero.');
        if (doc != null && amt > toD(doc['amount_due']) + 0.001) errs.add('${doc['doc_number']} has only ${inr(doc['amount_due'])} due.');
        if (reason == 'other' && glId == null) errs.add('Pick the ledger for an "Other" write-off.');
        if (errs.isNotEmpty) throw errs.join('\n');
        await Api.post('/accounts/payments/write-off', data: {
          'target_type': doc!['target_type'],
          'target_id': doc['id'],
          'amount': amt,
          'reason': reason,
          'write_off_date': apiDate(woDate),
          'gl_account_id': glId,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        });
      },
    );
    if (ok) {
      if (mounted) showSnack(context, "Written off — the bill's due amount is reduced.");
      _list.currentState?.reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCanFeature('payments', 'write_offs', 'create') ? CreateFab(label: 'Write off a bill', onPressed: _new) : null,
      body: ApiListView(
        key: _list,
        load: (p, s) async => ApiPage(asRows(await Api.get('/accounts/payments/write-offs'))),
        emptyText: 'No write-offs yet.',
        itemBuilder: (ctx, w, reload) => RecordCard(
          code: '${w['target_number']}',
          title: txt(w['reason_label']),
          subtitle: '${w['gl_account_code']} — ${w['gl_account_name']}',
          status: null,
          trailing: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: FinStatusPill(w['status'], labels: _woStatusLabels, colors: _woStatusHex)),
          meta: [
            ('Date', fmtDate(w['adjustment_date'])),
            ('Amount', inr(w['amount'])),
            if ((w['remarks'] ?? '').toString().isNotEmpty) ('Remarks', '${w['remarks']}'),
          ],
          onTap: w['status'] == 'posted' && finCanFeature('payments', 'write_offs', 'cancel')
              ? () async {
                  final why = await promptDialog(ctx,
                      title: 'Cancel this write-off?',
                      message: '${inr(w['amount'])} on ${w['target_number']}',
                      label: 'Reason for cancelling',
                      confirmLabel: 'Cancel write-off');
                  if (why == null || !ctx.mounted) return;
                  if (await runAction(ctx, () => Api.post('/accounts/payments/write-offs/${w['id']}/cancel', data: {'reason': why}),
                      success: 'Write-off cancelled.')) {
                    reload();
                  }
                }
              : null,
        ),
      ),
    );
  }
}

// ── Payment runs ─────────────────────────────────────────────────────────────

const _runStatusLabels = {
  'draft': 'Draft', 'submitted': 'Waiting approval', 'approved': 'Approved — ready to pay', 'executed': 'Paid',
  'rejected': 'Rejected', 'cancelled': 'Cancelled',
};
const _runStatusHex = {
  'draft': Color(0xFF64748B), 'submitted': Color(0xFFF59E0B), 'approved': Color(0xFF0369A1), 'executed': Color(0xFF22C55E),
  'rejected': Color(0xFFDC2626), 'cancelled': Color(0xFF78716C),
};
const _runModes = {'neft': 'NEFT', 'rtgs': 'RTGS', 'imps': 'IMPS', 'cheque': 'Cheque'};

class _Runs extends StatefulWidget {
  const _Runs();

  @override
  State<_Runs> createState() => _RunsState();
}

class _RunsState extends State<_Runs> {
  final _list = GlobalKey<ApiListViewState>();
  String? _status;

  Future<void> _new() async {
    List<Json> banks;
    try {
      banks = asRows(await Api.get('/accounts/bank-accounts', query: {'status': 'active'})).where((b) => b['account_kind'] != 'cash').toList();
    } catch (e) {
      if (mounted) showSnack(context, 'Could not load bank accounts or vendors. ${ApiClient.describe(e)}', error: true);
      return;
    }
    DateTime payBy = DateTime.now().add(const Duration(days: 7));
    int? vendorId;
    String? vendorLabel;
    final notes = TextEditingController();
    int? bankId;
    String mode = 'neft';
    Json? built;
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: 'New payment run',
      saveLabel: 'Build proposal',
      builder: (ctx, setS) => [
        const Text('Builds a proposal of the posted vendor bills due by a date — nothing is paid until it is approved.',
            style: TextStyle(color: Brand.muted)),
        const Caps('Run'),
        DateField(label: 'Pay bills due by', required: true, value: payBy, onChanged: (d) => setS(() => payBy = d ?? payBy)),
        AppSelect<int>(
          label: 'Vendor',
          value: vendorId,
          valueLabel: vendorLabel,
          loadOptions: FinLookups.vendors,
          onChanged: (o) => setS(() {
            vendorId = o?.value;
            vendorLabel = o?.label;
          }),
        ),
        AppTextField(label: 'Notes', controller: notes, maxLines: 2),
        const Caps('Pay from'),
        AppSelect<int>(
          label: 'Bank account',
          required: true,
          value: bankId,
          options: [for (final b in banks) Option(toInt(b['id'])!, '${_bankLabel(b)} · bal ${inr(b['book_balance'])}')],
          onChanged: (o) => setS(() => bankId = o?.value),
        ),
        AppSelect<String>(
          label: 'Mode',
          value: mode,
          clearable: false,
          options: [for (final e in _runModes.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => mode = o?.value ?? mode),
        ),
        const Caps('What the run picks'),
        const Text(
            "Every posted vendor bill due on or before the date that isn't already paid, in another run or waiting in a held "
            'payment. Open debit notes and supplier advances are set off first; an early-payment discount is taken when the vendor offers one. '
            'Bills blocked for payment, blocked vendors and vendors without bank details are listed but left out.',
            style: TextStyle(fontSize: 12.5, color: Brand.muted)),
      ],
      onSave: () async {
        final errs = <String>[];
        if (bankId == null) errs.add('Pick the bank account the run pays from.');
        if (errs.isNotEmpty) throw errs.join('\n');
        built = asJson(await Api.post('/accounts/payment-proposals', data: {
          'pay_by_date': apiDate(payBy),
          'bank_account_id': bankId,
          'payment_mode': mode,
          'vendor_ids': vendorId == null ? [] : [vendorId],
          'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
        }));
      },
    );
    if (ok && built != null && mounted) {
      showSnack(context,
          '${built!['proposal_number']} lists ${listOf(built!['lines']).length} bill(s) for ${inr(built!['total_amount'])}. Review it, leave out anything that shouldn\'t be paid, then send it for approval.');
      _list.currentState?.reload();
      openScreen(context, _RunScreen(id: toInt(built!['id'])!));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCan('payment_runs', 'create') ? CreateFab(label: 'New payment run', onPressed: _new) : null,
      body: ApiListView(
        key: _list,
        load: (p, s) async => ApiPage(asRows(await Api.get('/accounts/payment-proposals', query: {'status': _status}))),
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const InfoBanner(
              'Pick the vendor bills due by a date, get the run approved (Finance approver, then a Partner) and pay them in one go — one voucher per vendor plus a bank upload file.'),
          padded(AppSelect<String>(
            label: 'Status',
            value: _status,
            options: [for (final e in _runStatusLabels.entries) Option(e.key, e.value)],
            onChanged: (o) => setState(() {
              _status = o?.value;
              _list.currentState?.reload();
            }),
          )),
        ]),
        emptyText: 'No payment runs yet.',
        itemBuilder: (ctx, r, reload) => RecordCard(
          code: '${r['proposal_number']}',
          title: '${r['bank_account_label'] ?? ''} · ${'${r['payment_mode'] ?? ''}'.toUpperCase()}',
          trailing: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: FinStatusPill(r['status'], labels: _runStatusLabels, colors: _runStatusHex)),
          meta: [
            ('Run date', fmtDate(r['run_date'])),
            ('Due by', fmtDate(r['pay_by_date'])),
            ('Vendors', txt(r['vendor_count'])),
            ('To pay', inr(r['total_amount'])),
            if (r['status'] == 'submitted' && r['approval_stage'] != null) ('Stage', '${r['approval_stage']}'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => _RunScreen(id: toInt(r['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

class _RunScreen extends StatefulWidget {
  const _RunScreen({required this.id});
  final int id;

  @override
  State<_RunScreen> createState() => _RunScreenState();
}

class _RunScreenState extends State<_RunScreen> {
  int _tick = 0;

  Future<void> _act(Future<dynamic> Function() fn, String what, {String? done}) async {
    try {
      final out = await fn();
      if (!mounted) return;
      final msg = out is Map && out['message'] != null ? '${out['message']}' : (done ?? '$what — done.');
      showSnack(context, msg);
      setState(() => _tick++);
    } catch (e) {
      if (mounted) showSnack(context, 'Could not ${what.toLowerCase()}. ${ApiClient.describe(e)}', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      key: ValueKey(_tick),
      load: () async => asJson(await Api.get('/accounts/payment-proposals/${widget.id}')),
      builder: (ctx, r, reload) {
        final editable = r['status'] == 'draft' || r['status'] == 'rejected';
        final canEdit = editable && finCan('payment_runs', 'edit');
        final lines = listOf(r['lines']);
        final num = '${r['proposal_number']}';
        final actions = <Widget>[
          if (editable && finCan('payment_runs', 'submit'))
            actionBtn('Send for approval', () => _act(() => Api.post('/accounts/payment-proposals/${r['id']}/submit'), 'Sent for approval'),
                primary: true),
          if (r['status'] == 'approved' && finCanFeature('payment_runs', 'execution', 'create'))
            actionBtn('Pay now', () async {
              DateTime date = DateTime.now();
              final ok = await showFormSheet(
                context,
                title: 'Pay $num now?',
                saveLabel: 'Post payments',
                builder: (c, setS) => [
                  Text('${inr(r['total_amount'])} to ${r['vendor_count']} vendor(s) from ${r['bank_account_label']}',
                      style: const TextStyle(color: Brand.muted)),
                  DateField(label: 'Payment date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
                ],
                onSave: () async =>
                    Api.post('/accounts/payment-proposals/${r['id']}/execute', data: {'payment_date': apiDate(date)}),
              );
              if (ok && context.mounted) {
                showSnack(context, 'Payments posted for $num.');
                setState(() => _tick++);
              }
            }, primary: true),
          if (r['status'] == 'executed' && finCanFeature('payment_runs', 'bank_file', 'export'))
            actionBtn('Bank file',
                () => finDownload(context, '/accounts/payment-proposals/${r['id']}/bank-file', '${num.replaceAll('/', '-')}-bank-upload.csv')),
          if (!const ['executed', 'cancelled'].contains(r['status']) && finCan('payment_runs', 'cancel'))
            actionBtn('Cancel', () async {
              final reason = await promptDialog(context,
                  title: 'Cancel $num?',
                  message: 'Nothing has been paid yet; the bills become free for another run.',
                  label: 'Reason for cancelling',
                  confirmLabel: 'Cancel run');
              if (reason != null) {
                _act(() => Api.post('/accounts/payment-proposals/${r['id']}/cancel', data: {'reason': reason}), 'Cancelled',
                    done: '$num was cancelled.');
              }
            }, danger: true),
        ];
        return SubPage(
          title: num,
          bottom: actions.isEmpty ? null : ActionBar(actions),
          body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            DetailSection('Run', children: [
              Align(alignment: Alignment.centerLeft, child: FinStatusPill(r['status'], labels: _runStatusLabels, colors: _runStatusHex)),
              FieldRow('Run date', fmtDate(r['run_date'])),
              FieldRow('Due by', fmtDate(r['pay_by_date'])),
              FieldRow('Bank / mode', '${r['bank_account_label']} · ${'${r['payment_mode'] ?? ''}'.toUpperCase()}'),
              AmountRow('To pay (${r['vendor_count']} vendor(s))', inr(r['total_amount']), bold: true),
              if (r['created_by_name'] != null) FieldRow('Built by', r['created_by_name']),
              if (r['approved_by_name'] != null) FieldRow('Approved by', r['approved_by_name']),
              if (r['executed_by_name'] != null) FieldRow('Paid by', r['executed_by_name']),
              if (r['notes'] != null) FieldRow('Notes', r['notes']),
              if (r['rejection_reason'] != null) FieldRow('Reason', r['rejection_reason']),
            ]),
            if (r['status'] == 'submitted' || r['approval_request_id'] != null)
              ApprovalPanel(entityType: 'accounts_payment_proposal', entityId: toInt(r['id'])!, onChanged: reload),
            SectionTitle('Bills (${lines.length})'),
            for (final l in lines)
              Opacity(
                opacity: l['excluded'] == true ? 0.55 : 1,
                child: RecordCard(
                  code: '${l['invoice_number']}',
                  title: txt(l['vendor_name']),
                  subtitle: l['payment_number'] != null
                      ? 'Paid — ${l['payment_number']}'
                      : l['excluded'] == true
                          ? 'Left out: ${l['exclusion_reason'] ?? ''}'
                          : 'To pay',
                  meta: [
                    ('Due', fmtDate(l['due_date'])),
                    ('Due amount', inr(l['amount_due'])),
                    if (toD(l['credit_amount']) != 0) ('Notes/advances set off', inr(l['credit_amount'])),
                    if (toD(l['discount_amount']) != 0) ('Discount', inr(l['discount_amount'])),
                    ('Pay', inr(l['amount'])),
                  ],
                  trailing: canEdit
                      ? PopupMenuButton<String>(
                          onSelected: (v) async {
                            if (v == 'amount') {
                              final ctrl = TextEditingController(text: '${l['amount']}');
                              final ok = await showFormSheet(context,
                                  title: 'Change the amount',
                                  builder: (c, s) => [AppTextField(label: 'Pay (₹)', controller: ctrl, keyboardType: AppTextField.number)],
                                  onSave: () async {
                                    final v = double.tryParse(ctrl.text);
                                    if (v == null || v < 0) throw 'Enter the amount to pay — a number of zero or more.';
                                    await Api.patch('/accounts/payment-proposals/${r['id']}/lines/${l['id']}', data: {'amount': v});
                                  });
                              if (ok) setState(() => _tick++);
                            } else if (v == 'include') {
                              _act(() => Api.patch('/accounts/payment-proposals/${r['id']}/lines/${l['id']}', data: {'excluded': false}),
                                  'Include the bill');
                            } else {
                              final reason = await promptDialog(context,
                                  title: 'Leave ${l['invoice_number']} out of the run?',
                                  message: '${l['vendor_name']} · ${inr(l['amount'])}',
                                  label: 'Reason',
                                  confirmLabel: 'Leave out');
                              if (reason != null) {
                                _act(
                                    () => Api.patch('/accounts/payment-proposals/${r['id']}/lines/${l['id']}',
                                        data: {'excluded': true, 'exclusion_reason': reason}),
                                    'Leave out the bill');
                              }
                            }
                          },
                          itemBuilder: (_) => [
                            if (l['excluded'] != true) const PopupMenuItem(value: 'amount', child: Text('Change the amount')),
                            if (l['excluded'] == true)
                              const PopupMenuItem(value: 'include', child: Text('Include'))
                            else
                              const PopupMenuItem(value: 'exclude', child: Text('Leave out')),
                          ],
                        )
                      : null,
                ),
              ),
          ]),
        );
      },
    );
  }
}
