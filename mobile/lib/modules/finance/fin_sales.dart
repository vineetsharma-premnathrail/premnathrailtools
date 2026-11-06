import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';
import 'fin_notes.dart';
import 'fin_payments.dart';

/// Finance › Sales (portal finance/sales/page.tsx + SalesBillingDue).
class FinSalesPage extends StatelessWidget {
  const FinSalesPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Sales',
        subtitle:
            'Raise GST tax invoices to customers (CRM organizations), record e-invoice / e-way bill details, and issue credit notes for returns and rate differences.',
        tabs: [
          FinSubTab('Sales Invoices', (_) => const _Invoices(), permTab: 'sales_invoices'),
          FinSubTab('Billing Due', (_) => const _BillingDue(),
              visible: finCan('sales_invoices', 'view') &&
                  finCanFeature('sales_invoices', 'billing_due', 'view') &&
                  finCanFeature('sales_invoices', 'bill_from_so', 'create')),
          FinSubTab('Credit Notes', (_) => const NotesTab(noteType: 'credit_note'), permTab: 'credit_notes'),
        ],
      );
}

const _statusLabels = {'pending': 'Draft', 'posted': 'Issued', 'cancelled': 'Cancelled'};
const _collLabels = {'pending': 'Uncollected', 'partial': 'Part received', 'collected': 'Received', 'overdue': 'Overdue'};
const _collHex = {
  'pending': Color(0xFF94A3B8), 'partial': Color(0xFFF59E0B), 'collected': Color(0xFF22C55E), 'overdue': Color(0xFFDC2626),
};

class _Invoices extends StatefulWidget {
  const _Invoices();

  @override
  State<_Invoices> createState() => _InvoicesState();
}

class _InvoicesState extends State<_Invoices> {
  final _list = GlobalKey<ApiListViewState>();
  String? _status;
  String? _coll;
  int? _customer;
  String? _customerLabel;
  List<String> _warnings = [];

  @override
  void initState() {
    super.initState();
    FinSetup.load().then((s) {
      if (mounted) setState(() => _warnings = s.warnings);
    }).catchError((_) {});
  }

  void _reload() => _list.currentState?.reload();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: finCan('sales_invoices', 'create')
          ? CreateFab(
              label: 'New sales invoice',
              onPressed: () async {
                if (await showSalesInvoiceForm(context)) _reload();
              })
          : null,
      body: ApiListView(
        key: _list,
        load: (p, s) async => ApiPage(asRows(await Api.get('/accounts/ar-transactions', query: {
          'status': _status,
          'collection_status': _coll,
          'customer_id': _customer,
        }))),
        emptyText: 'No sales invoices match these filters.',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (_warnings.isNotEmpty) InfoBanner(_warnings.join('\n'), tone: Tone.warning),
          ChipRow([
            for (final e in _statusLabels.entries)
              CountChip(e.value, null,
                  selected: _status == e.key,
                  color: kDocStatusHex[e.key],
                  onTap: () => setState(() {
                        _status = _status == e.key ? null : e.key;
                        _reload();
                      })),
          ]),
          padded(AppSelect<String>(
            label: 'Collection',
            value: _coll,
            options: [for (final e in _collLabels.entries) Option(e.key, e.value)],
            onChanged: (o) => setState(() {
              _coll = o?.value;
              _reload();
            }),
          )),
          padded(AppSelect<int>(
            label: 'Customer',
            value: _customer,
            valueLabel: _customerLabel,
            loadOptions: customerOptions,
            onChanged: (o) => setState(() {
              _customer = o?.value;
              _customerLabel = o?.label;
              _reload();
            }),
          )),
        ]),
        itemBuilder: (ctx, t, reload) => RecordCard(
          code: isDraftNumber(t['invoice_number']) ? 'Draft' : '${t['invoice_number']}',
          title: txt(t['customer_name']),
          subtitle: '${t['customer_gstin'] ?? 'Unregistered'} · POS ${t['place_of_supply_state_code'] ?? '—'}',
          trailing: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              FinStatusPill(t['status'], labels: _statusLabels, colors: kDocStatusHex),
              if (t['status'] == 'pending') ApprovalBadge(status: t['approval_status'] as String?, stage: t['approval_stage'] as String?),
              if (t['status'] == 'posted') FinStatusPill(t['collection_status'], labels: _collLabels, colors: _collHex),
            ]),
          ),
          meta: [
            ('Date', fmtDate(t['invoice_date'])),
            ('Due', fmtDate(t['due_date'])),
            ('Total', inr(t['total_amount'])),
            ('Due amount', t['status'] == 'posted' ? inr(t['amount_due']) : '—'),
            if ((toInt(t['days_overdue']) ?? 0) > 0) ('Overdue', '${t['days_overdue']} d'),
            if (t['irn'] != null || t['eway_bill_no'] != null)
              ('E-docs', [if (t['irn'] != null) 'IRN', if (t['eway_bill_no'] != null) 'EWB'].join(' · ')),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => _InvoiceScreen(id: toInt(t['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

class _InvoiceScreen extends StatefulWidget {
  const _InvoiceScreen({required this.id});
  final int id;

  @override
  State<_InvoiceScreen> createState() => _InvoiceScreenState();
}

class _InvoiceScreenState extends State<_InvoiceScreen> {
  int _tick = 0;

  Future<void> _do(Future<dynamic> Function() fn, String ok) async {
    if (await runAction(context, fn, success: ok)) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      key: ValueKey(_tick),
      load: () async => asJson(await Api.get('/accounts/ar-transactions/${widget.id}')),
      builder: (ctx, t, reload) {
        final pending = t['status'] == 'pending';
        final isMaker = Perm.userId != null && toInt(t['created_by_id']) == Perm.userId;
        final interstate = t['is_interstate'] == true;
        final actions = <Widget>[
          if (pending && t['approval_status'] != 'pending' && finCan('sales_invoices', 'submit'))
            actionBtn('Submit for approval',
                () => _do(() => Api.post('/accounts/ar-transactions/${t['id']}/submit'), 'Sent for approval.')),
          if (pending && !isMaker && finCan('sales_invoices', 'approve'))
            actionBtn('Issue / Post', () => _do(() => Api.post('/accounts/ar-transactions/${t['id']}/post'), 'Invoice issued.'),
                primary: true),
          if (pending && finCan('sales_invoices', 'delete'))
            actionBtn('Cancel', () async {
              final reason = await promptDialog(context,
                  title: 'Cancel this draft invoice?',
                  message: 'Only a draft can be cancelled — it never received a tax-invoice number.',
                  label: 'Reason for cancelling',
                  confirmLabel: 'Cancel invoice');
              if (reason != null) {
                _do(() => Api.post('/accounts/ar-transactions/${t['id']}/cancel', data: {'reason': reason}), 'Invoice cancelled.');
              }
            }, danger: true),
          if (t['status'] != 'cancelled' && finCanFeature('sales_invoices', 'e_invoice', 'edit'))
            actionBtn('E-invoice / e-way bill', () async {
              if (await _showEInvoice(context, t)) setState(() => _tick++);
            }),
          if (t['status'] == 'posted' && toD(t['amount_due']) > 0.005 && finCan('payments', 'create'))
            actionBtn('Receive', () async {
              if (await showPaymentVoucherForm(context,
                  paymentType: 'customer', customerId: toInt(t['customer_id']), partyLabel: '${t['customer_name'] ?? ''}')) {
                setState(() => _tick++);
              }
            }, primary: true),
        ];
        return SubPage(
          title: isDraftNumber(t['invoice_number']) ? 'Draft invoice' : '${t['invoice_number']}',
          bottom: actions.isEmpty ? null : ActionBar(actions),
          body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Wrap(spacing: 8, runSpacing: 6, children: [
                FinStatusPill(t['status'], labels: _statusLabels, colors: kDocStatusHex),
                if (pending) ApprovalBadge(status: t['approval_status'] as String?, stage: t['approval_stage'] as String?),
                if (t['status'] == 'posted') FinStatusPill(t['collection_status'], labels: _collLabels, colors: _collHex),
                if (t['irn'] != null) const StatusBadge('IRN', color: Color(0xFF0369A1)),
                if (t['eway_bill_no'] != null) const StatusBadge('EWB', color: Color(0xFF7C3AED)),
              ]),
            ),
            if (pending && isMaker)
              const InfoBanner('You drafted this invoice, so a different finance user must issue it (maker-checker).'),
            ApprovalPanel(entityType: 'accounts_ar_transaction', entityId: toInt(t['id'])!, onChanged: reload),
            DetailSection('Customer & amounts', children: [
              FieldRow('Customer', t['customer_name']),
              FieldRow('GSTIN', t['customer_gstin'] ?? 'Unregistered'),
              FieldRow('Place of supply', t['place_of_supply_state_code']),
              FieldRow('Invoice date', fmtDate(t['invoice_date'])),
              FieldRow('Due date', fmtDate(t['due_date'])),
              if (t['customer_po_number'] != null)
                FieldRow('Customer PO',
                    '${t['customer_po_number']}${t['customer_po_date'] != null ? ' dated ${fmtDate(t['customer_po_date'])}' : ''}'),
              FieldRow('Bill to', t['billing_address']),
              FieldRow('Ship to', t['shipping_address']),
              AmountRow('Taxable', inr(t['invoice_amount'])),
              AmountRow(interstate ? 'IGST' : 'CGST + SGST',
                  interstate ? inr(t['igst_amount']) : '${inr(t['cgst_amount'])} + ${inr(t['sgst_amount'])}'),
              if (toD(t['round_off']) != 0) AmountRow('Round-off', inr(t['round_off'])),
              AmountRow('Total', inr(t['total_amount']), bold: true),
              if (t['status'] == 'posted') AmountRow('Due', inr(t['amount_due'])),
              FieldRow('Narration', t['narration']),
              if (t['cancelled_reason'] != null) FieldRow('Cancelled because', t['cancelled_reason']),
              FieldRow('Drafted by', t['created_by_name']),
            ]),
            TaxLinesView(lines: listOf(t['lines']), interstate: interstate),
            DetailSection('E-invoice / e-way bill', children: [
              FieldRow('IRN', t['irn']),
              FieldRow('Acknowledgement', t['ack_no'] == null ? null : '${t['ack_no']}${t['ack_date'] != null ? ' · ${fmtDate(t['ack_date'])}' : ''}'),
              FieldRow('E-way bill',
                  t['eway_bill_no'] == null ? null : '${t['eway_bill_no']}${t['eway_bill_date'] != null ? ' · ${fmtDate(t['eway_bill_date'])}' : ''}'),
              FieldRow('Vehicle', t['vehicle_no']),
            ]),
            if (finCanFeature('sales_invoices', 'settlements', 'view'))
              SettlementsSection(
                path: '/accounts/ar-transactions/${t['id']}/settlements',
                title: 'Receipt history',
                emptyText: 'Nothing received against this invoice yet.',
                sourceLabel: (s) => s['source_type'] == 'payment' ? 'Receipt' : 'Credit note',
              ),
            FinanceAttachments(
                entityType: 'ar_transaction', entityId: toInt(t['id'])!, tabKey: 'sales_invoices', locked: !pending, closed: t['status'] == 'cancelled'),
          ]),
        );
      },
    );
  }
}

class _EDocs {
  _EDocs([Json? t])
      : irn = TextEditingController(text: '${t?['irn'] ?? ''}'),
        ackNo = TextEditingController(text: '${t?['ack_no'] ?? ''}'),
        ackDate = isoToDate(t?['ack_date']),
        ewb = TextEditingController(text: '${t?['eway_bill_no'] ?? ''}'),
        ewbDate = isoToDate(t?['eway_bill_date']),
        vehicle = TextEditingController(text: '${t?['vehicle_no'] ?? ''}');
  final TextEditingController irn;
  final TextEditingController ackNo;
  DateTime? ackDate;
  final TextEditingController ewb;
  DateTime? ewbDate;
  final TextEditingController vehicle;

  void validate() {
    final i = irn.text.trim();
    if (i.isNotEmpty && i.length != 64) {
      throw 'An IRN is exactly 64 characters (this one is ${i.length}) — copy it in full from the e-invoice portal.';
    }
    if (ewb.text.trim().isNotEmpty && !RegExp(r'^\d{12}$').hasMatch(ewb.text.trim())) throw 'An e-way bill number is 12 digits.';
  }

  Json payload() => {
        'irn': irn.text.trim().isEmpty ? null : irn.text.trim(),
        'ack_no': ackNo.text.trim().isEmpty ? null : ackNo.text.trim(),
        'ack_date': dateOrNull(ackDate),
        'eway_bill_no': ewb.text.trim().isEmpty ? null : ewb.text.trim(),
        'eway_bill_date': dateOrNull(ewbDate),
        'vehicle_no': vehicle.text.trim().isEmpty ? null : vehicle.text.trim().toUpperCase(),
      };

  List<Widget> fields(StateSetter setS) => [
        const Caps('E-invoice (IRN)'),
        AppTextField(label: 'IRN (64 characters)${irn.text.trim().isNotEmpty ? ' — ${irn.text.trim().length}/64' : ''}', controller: irn,
            onChanged: (_) => setS(() {})),
        AppTextField(label: 'Ack no.', controller: ackNo),
        DateField(label: 'Ack date', value: ackDate, onChanged: (d) => setS(() => ackDate = d)),
        const Caps('E-way bill'),
        AppTextField(label: 'E-way bill no. (12 digits)', controller: ewb, keyboardType: TextInputType.number),
        DateField(label: 'E-way bill date', value: ewbDate, onChanged: (d) => setS(() => ewbDate = d)),
        AppTextField(label: 'Vehicle no.', controller: vehicle, hint: 'e.g. HR55AB1234'),
      ];
}

Future<bool> _showEInvoice(BuildContext context, Json t) {
  final e = _EDocs(t);
  return showFormSheet(
    context,
    title: 'E-invoice / e-way bill',
    saveLabel: 'Save details',
    builder: (ctx, setS) => [
      Text('${isDraftNumber(t['invoice_number']) ? 'Draft invoice' : t['invoice_number']}${t['customer_name'] != null ? ' · ${t['customer_name']}' : ''}',
          style: const TextStyle(color: Brand.muted)),
      const Text(
          "Generate the IRN on the IRP (e-invoice) portal and the e-way bill on the EWB portal, then record them here. They don't change any amount.",
          style: TextStyle(fontSize: 12.5, color: Brand.muted)),
      ...e.fields(setS),
    ],
    onSave: () async {
      e.validate();
      await Api.patch('/accounts/ar-transactions/${t['id']}/e-invoice', data: e.payload());
    },
  );
}

/// New sales invoice (portal SalesInvoiceForm). True when saved.
Future<bool> showSalesInvoiceForm(BuildContext context) async {
  FinSetup setup;
  try {
    setup = await FinSetup.load();
  } catch (e) {
    if (context.mounted) {
      showSnack(context, 'Could not load the sales set-up (company GST state, ledgers, GST rates, customers). ${ApiClient.describe(e)}',
          error: true);
    }
    return false;
  }
  int? customerId;
  String? customerLabel;
  DateTime invoiceDate = DateTime.now();
  String? posChoice;
  final poNumber = TextEditingController();
  DateTime? poDate;
  final billing = TextEditingController();
  final shipping = TextEditingController();
  final narration = TextEditingController();
  final roundOff = TextEditingController(text: '0');
  final lines = [TaxLine()];
  bool showE = false;
  final e = _EDocs();
  final proof = <PickedProof>[];
  String warning = '';
  if (!context.mounted) return false;
  final saved = await showFormSheet(
    context,
    title: 'New sales invoice',
    saveLabel: 'Save draft',
    builder: (ctx, setS) {
      final placeOfSupply = posChoice ?? setup.companyState;
      final interstate = customerId != null && placeOfSupply.isNotEmpty && setup.companyState.isNotEmpty
          ? placeOfSupply != setup.companyState
          : null;
      final totals = previewTax(lines, interstate == true);
      final ro = double.tryParse(roundOff.text) ?? 0;
      return [
        const Text('Saved as a draft — the tax-invoice number is issued when another finance user posts it.',
            style: TextStyle(color: Brand.muted)),
        const Caps('Customer'),
        AppSelect<int>(
          label: 'Customer',
          required: true,
          value: customerId,
          valueLabel: customerLabel,
          loadOptions: (q) async {
            final rows = asRows(await Api.get('/crm/organizations', query: {'picker': true, 'search': q, 'limit': 50}));
            return [
              for (final c in rows)
                Option(toInt(c['id'])!, '${c['name']}', subtitle: [c['gst_number'], c['city']].where((x) => x != null).join(' · ')),
            ];
          },
          onChanged: (o) async {
            setS(() {
              customerId = o?.value;
              customerLabel = o?.label;
            });
            if (o == null) return;
            try {
              final rows = asRows(await Api.get('/crm/organizations', query: {'picker': true, 'search': o.label, 'limit': 50}));
              for (final c in rows) {
                if (toInt(c['id']) == o.value) {
                  final tail = [c['city'], c['state'], c['pin_code']].where((x) => x != null && '$x'.isNotEmpty).join(', ');
                  final addr = [c['address'], tail].where((x) => x != null && '$x'.isNotEmpty).join('\n');
                  setS(() {
                    posChoice = setup.partyStateCode(c['gst_number'], c['state']) ?? setup.companyState;
                    if (addr.isNotEmpty) billing.text = addr;
                  });
                }
              }
            } catch (_) {}
          },
        ),
        DateField(label: 'Invoice date', required: true, value: invoiceDate, onChanged: (d) => setS(() => invoiceDate = d ?? invoiceDate)),
        AppSelect<String>(
          label: 'Place of supply',
          required: true,
          value: placeOfSupply.isEmpty ? null : placeOfSupply,
          clearable: false,
          options: setup.stateOptions,
          onChanged: (o) => setS(() => posChoice = o?.value),
        ),
        const Text('Where the goods are delivered; decides CGST+SGST vs IGST.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        const Caps('Customer PO (optional)'),
        AppTextField(label: 'Customer PO no.', controller: poNumber),
        DateField(label: 'Customer PO date', value: poDate, onChanged: (d) => setS(() => poDate = d)),
        const Caps('Addresses'),
        AppTextField(label: 'Billing address', controller: billing, maxLines: 3),
        AppTextField(label: 'Shipping address', controller: shipping, maxLines: 3),
        TaxLinesEditor(lines: lines, setState: setS, interstate: interstate),
        CheckField(label: 'E-invoice / e-way bill details', value: showE, onChanged: (v) => setS(() => showE = v)),
        if (showE) ...e.fields(setS),
        AppTextField(label: 'Narration', controller: narration, maxLines: 3),
        ProofPicker(entityType: 'ar_transaction', value: proof, setState: setS),
        const Caps('Totals'),
        AppTextField(
            label: 'Round-off (₹)',
            controller: roundOff,
            keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
            onChanged: (_) => setS(() {})),
        AmountRow('Invoice total', inr(round2(totals.total + ro)), bold: true),
      ];
    },
    onSave: () async {
      if (customerId == null) throw 'Pick the customer (CRM organization) this invoice is for.';
      final ro = double.tryParse(roundOff.text) ?? 0;
      if (ro.abs() >= 1) throw 'Round-off only absorbs paise — it must be less than ₹1 either way.';
      e.validate();
      validateTaxLines(lines);
      final placeOfSupply = posChoice ?? setup.companyState;
      final created = asJson(await Api.post('/accounts/ar-transactions', data: {
        'customer_id': customerId,
        'invoice_date': apiDate(invoiceDate),
        'place_of_supply_state_code': placeOfSupply.isEmpty ? null : placeOfSupply,
        'round_off': ro,
        'billing_address': billing.text.trim().isEmpty ? null : billing.text.trim(),
        'shipping_address': shipping.text.trim().isEmpty ? null : shipping.text.trim(),
        'customer_po_number': poNumber.text.trim().isEmpty ? null : poNumber.text.trim(),
        'customer_po_date': dateOrNull(poDate),
        'narration': narration.text.trim().isEmpty ? null : narration.text.trim(),
        ...e.payload(),
        'lines': [for (final l in lines) l.toPayload()],
      }));
      final id = toInt(created['id'])!;
      final proofWarning = proof.isEmpty ? '' : await uploadPickedProof('ar_transaction', id, proof, 'The sales invoice');
      final submitWarning = finCan('sales_invoices', 'submit')
          ? await submitAfterSave(() => Api.post('/accounts/ar-transactions/$id/submit'), 'The sales invoice')
          : '';
      warning = [proofWarning, submitWarning].where((s) => s.isNotEmpty).join(' ');
    },
  );
  if (saved && context.mounted) showSnack(context, warning.isEmpty ? 'Sales invoice saved.' : warning, error: warning.isNotEmpty);
  return saved;
}

// ── Billing due ──────────────────────────────────────────────────────────────

const _billLabels = {
  'not_due': 'Not due', 'due': 'Due', 'invoice_requested': 'Invoice requested', 'invoiced': 'Invoiced', 'settled': 'Settled',
  'proforma_issued': 'Proforma issued',
};
const _billHex = {
  'not_due': Color(0xFF94A3B8), 'due': Color(0xFFF59E0B), 'invoice_requested': Color(0xFF8B5CF6), 'invoiced': Color(0xFF0EA5E9),
  'settled': Color(0xFF22C55E), 'proforma_issued': Color(0xFF64748B),
};
const _show = {'due': 'Billable now', 'overdue': 'Overdue', 'all': 'All milestones'};

class _BillingDue extends StatefulWidget {
  const _BillingDue();

  @override
  State<_BillingDue> createState() => _BillingDueState();
}

class _BillingDueState extends State<_BillingDue> {
  String _showSel = 'due';
  int _tick = 0;

  Future<List<Json>> _load() async {
    final orders = asRows(await Api.get('/accounts/sales-billing/orders'));
    final wanted = orders.where((o) => _showSel == 'all' || toD(o['due_amount']) > 0.5).toList();
    final detail = await Future.wait(wanted.map((o) async => asJson(await Api.get('/accounts/sales-billing/orders/${o['so_id']}'))));
    final all = [for (final d in detail) ...listOf(d['milestones'])];
    final out = all
        .where((v) => _showSel == 'all' || (toD(v['due_amount']) > 0.5 && (_showSel != 'overdue' || v['overdue'] == true)))
        .toList();
    out.sort((a, b) {
      final c = '${a['due_date'] ?? a['triggered_on'] ?? ''}'.compareTo('${b['due_date'] ?? b['triggered_on'] ?? ''}');
      if (c != 0) return c;
      final d = '${a['so_display'] ?? ''}'.compareTo('${b['so_display'] ?? ''}');
      if (d != 0) return d;
      return (toInt(a['sequence']) ?? 0).compareTo(toInt(b['sequence']) ?? 0);
    });
    return out;
  }

  Future<void> _raise(Json m) async {
    DateTime date = DateTime.now();
    final rowsAll = listOf(m['rows']);
    final picked = <int>{for (final r in rowsAll) if ((toD(r['billable_units'])) > 0) toInt(r['schedule_id'])!};
    final eway = TextEditingController();
    final vehicle = TextEditingController();
    final narration = TextEditingController();
    final proof = <PickedProof>[];
    Json? inv;
    String proofWarning = '';
    final ok = await showFormSheet(
      context,
      title: 'Invoice ${m['percent']}% ${'${m['milestone_label'] ?? ''}'.toLowerCase()}',
      saveLabel: 'Create draft invoice',
      builder: (ctx, setS) => [
        Text('${m['so_display']} · ${m['customer_name']}', style: const TextStyle(color: Brand.muted)),
        if (m['row_linked'] == true) ...[
          const Caps('Units to bill'),
          for (final r in rowsAll)
            if (toD(r['billable_units']) > 0)
              CheckField(
                label:
                    '${r['label']} — ${r['billable_units']} unit(s), ${r['event_date'] != null ? fmtDate(r['event_date']) : ''} · ${inr(r['billable_amount'])}',
                value: picked.contains(toInt(r['schedule_id'])),
                onChanged: (v) => setS(() => v ? picked.add(toInt(r['schedule_id'])!) : picked.remove(toInt(r['schedule_id']))),
              ),
        ],
        const Caps('Invoice details'),
        DateField(label: 'Invoice date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
        AppTextField(label: 'E-way bill no.', controller: eway),
        AppTextField(label: 'Vehicle no.', controller: vehicle),
        AppTextField(label: 'Narration', controller: narration, maxLines: 2),
        ProofPicker(entityType: 'ar_transaction', value: proof, setState: setS),
      ],
      onSave: () async {
        if (m['row_linked'] == true && picked.isEmpty) throw 'Tick at least one unit to bill.';
        inv = asJson(await Api.post('/accounts/sales-billing/invoices', data: {
          'so_id': m['so_id'],
          'billing_plan_line_id': m['billing_line_id'],
          'schedule_ids': m['row_linked'] == true ? picked.toList() : [],
          'invoice_date': apiDate(date),
          'narration': narration.text.trim().isEmpty ? null : narration.text.trim(),
          'eway_bill_no': eway.text.trim().isEmpty ? null : eway.text.trim(),
          'vehicle_no': vehicle.text.trim().isEmpty ? null : vehicle.text.trim(),
        }));
        if (proof.isNotEmpty) proofWarning = await uploadPickedProof('ar_transaction', toInt(inv!['id'])!, proof, 'The draft sales invoice');
      },
    );
    if (ok && mounted) {
      showSnack(
          context,
          proofWarning.isNotEmpty
              ? proofWarning
              : 'Draft sales invoice for ${inr(inv?['total_amount'])} created from ${m['so_display']} — submit it for approval on the Sales Invoices tab.',
          error: proofWarning.isNotEmpty);
      setState(() => _tick++);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = finCan('sales_invoices', 'create');
    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      padded(AppSelect<String>(
        label: 'Show',
        value: _showSel,
        clearable: false,
        options: [for (final e in _show.entries) Option(e.key, e.value)],
        onChanged: (o) => setState(() {
          _showSel = o?.value ?? 'due';
          _tick++;
        }),
      )),
      ApiLoader<List<Json>>(
        key: ValueKey('bd$_tick'),
        load: _load,
        builder: (ctx, rows, _) {
          final total = rows.fold<double>(0, (s, r) => s + toD(r['due_amount']));
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            padded(Text('Billable now: ${inr(total)} incl. GST', style: const TextStyle(fontWeight: FontWeight.w600))),
            if (rows.isEmpty) const EmptyView('Nothing due for invoicing.'),
            for (final m in rows)
              RecordCard(
                code: '${m['so_display']}',
                title: '${m['percent']}% ${'${m['milestone_label'] ?? ''}'.toLowerCase()}',
                subtitle: [
                  '${m['customer_name'] ?? ''}',
                  if (toD(m['recovers_advance_percent']) > 0) 'recovers ${m['recovers_advance_percent']}% of the advance',
                ].join(' · '),
                trailing: Padding(
                    padding: const EdgeInsets.only(left: 8), child: FinStatusPill(m['status'], labels: _billLabels, colors: _billHex)),
                meta: [
                  ('Due since', fmtDate(m['triggered_on'])),
                  ('Due date', '${fmtDate(m['due_date'])}${m['overdue'] == true ? ' (overdue)' : ''}'),
                  ('Milestone', inr(m['amount'])),
                  ('Invoiced', '${inr(m['invoiced_amount'])}${toD(m['reserved_amount']) > 0.5 ? ' + ${inr(m['reserved_amount'])} draft' : ''}'),
                  ('Billable now', inr(m['due_amount'])),
                ],
                onTap: canCreate && toD(m['due_amount']) > 0.5 ? () => _raise(m) : null,
              ),
            const InfoBanner(
                'Orders raised before Sales Orders were retired stay billable here until they are closed. Milestones fall due on their event: '
                'advance on order confirmation, dispatch / delivery / commissioning per unit, an accepted third-party inspection, a marked drawing approval, '
                'retention once every warranty ended. A draft invoice reserves its amount until it is posted or cancelled; a credit note against it gives the amount back. '
                'Tap a billable milestone to create its invoice.'),
          ]);
        },
      ),
    ]);
  }
}
