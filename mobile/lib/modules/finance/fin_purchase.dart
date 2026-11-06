import 'dart:async';

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

/// Finance › Purchase (portal finance/purchase/page.tsx).
class FinPurchasePage extends StatelessWidget {
  const FinPurchasePage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Purchase',
        subtitle:
            'Book vendor bills (against a PO with 3-way match, or direct for services and expenses) and raise debit notes for returns and rate differences.',
        tabs: [
          FinSubTab('Purchase Invoices', (_) => const _Invoices(), permTab: 'purchase_invoices'),
          FinSubTab('Debit Notes', (_) => const NotesTab(noteType: 'debit_note'), permTab: 'debit_notes'),
        ],
      );
}

const _statusLabels = {'pending': 'Pending', 'posted': 'Posted', 'cancelled': 'Cancelled'};
const _payLabels = {'pending': 'Unpaid', 'partial': 'Part paid', 'paid': 'Paid'};
const _payHex = {'pending': Color(0xFF94A3B8), 'partial': Color(0xFFF59E0B), 'paid': Color(0xFF22C55E)};
const _matchLabels = {'matched': 'Matched', 'variance': 'Variance', 'approved_variance': 'Variance approved', 'not_applicable': 'No PO'};
const _matchHex = {
  'matched': Color(0xFF22C55E), 'variance': Color(0xFFDC2626), 'approved_variance': Color(0xFFF59E0B), 'not_applicable': Color(0xFF94A3B8),
};
const _typeLabels = {'po': 'Against PO', 'direct': 'Direct', 'opening': 'Opening'};

class _Invoices extends StatefulWidget {
  const _Invoices();

  @override
  State<_Invoices> createState() => _InvoicesState();
}

class _InvoicesState extends State<_Invoices> {
  final _list = GlobalKey<ApiListViewState>();
  String? _status;
  String? _pay;
  String? _type;
  int? _vendor;
  String? _vendorLabel;
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
      floatingActionButton: finCan('purchase_invoices', 'create')
          ? CreateFab(
              label: 'Record invoice',
              onPressed: () async {
                if (await showPurchaseInvoiceForm(context)) _reload();
              })
          : null,
      body: ApiListView(
        key: _list,
        load: (p, s) async => ApiPage(asRows(await Api.get('/accounts/vendor-invoices', query: {
          'status': _status,
          'payment_status': _pay,
          'invoice_type': _type,
          'vendor_id': _vendor,
        }))),
        emptyText: 'No purchase invoices match these filters.',
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
          padded(Row(children: [
            Expanded(
              child: AppSelect<String>(
                label: 'Payment',
                value: _pay,
                options: [for (final e in _payLabels.entries) Option(e.key, e.value)],
                onChanged: (o) => setState(() {
                  _pay = o?.value;
                  _reload();
                }),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: AppSelect<String>(
                label: 'Type',
                value: _type,
                options: [for (final e in _typeLabels.entries) Option(e.key, e.value)],
                onChanged: (o) => setState(() {
                  _type = o?.value;
                  _reload();
                }),
              ),
            ),
          ])),
          padded(AppSelect<int>(
            label: 'Vendor',
            value: _vendor,
            valueLabel: _vendorLabel,
            loadOptions: FinLookups.vendors,
            onChanged: (o) => setState(() {
              _vendor = o?.value;
              _vendorLabel = o?.label;
              _reload();
            }),
          )),
        ]),
        itemBuilder: (ctx, inv, reload) => RecordCard(
          code: '${inv['invoice_number']}',
          title: txt(inv['vendor_name']),
          subtitle: inv['po_number'] != null ? 'PO ${inv['po_number']}' : null,
          trailing: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              FinStatusPill(inv['status'], labels: _statusLabels, colors: kDocStatusHex),
              if (inv['status'] == 'pending')
                ApprovalBadge(status: inv['approval_status'] as String?, stage: inv['approval_stage'] as String?),
              if (inv['status'] == 'posted') FinStatusPill(inv['payment_status'], labels: _payLabels, colors: _payHex),
            ]),
          ),
          meta: [
            ('Date', fmtDate(inv['invoice_date'])),
            ('Due', fmtDate(inv['due_date'])),
            ('Type', _typeLabels['${inv['invoice_type']}'] ?? '${inv['invoice_type']}'),
            ('Total', inr(inv['invoice_total'])),
            ('Due amount', inr(inv['amount_due'])),
            ('Match', _matchLabels['${inv['matching_status']}'] ?? txt(inv['matching_status'])),
            if (inv['is_reverse_charge'] == true) ('GST', 'RCM'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => _InvoiceScreen(id: toInt(inv['id'])!)));
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
    return ApiLoader<(Json, ProofRules)>(
      key: ValueKey(_tick),
      load: () async => (asJson(await Api.get('/accounts/vendor-invoices/${widget.id}')), await ProofRules.load()),
      builder: (ctx, data, reload) {
        final (inv, rules) = data;
        final pending = inv['status'] == 'pending';
        final isMaker = Perm.userId != null && toInt(inv['created_by_id']) == Perm.userId;
        final canApproveVariance = isFinanceManager && finCanFeature('purchase_invoices', 'variance_approval', 'approve');
        final interstate = inv['is_interstate'] == true;
        final actions = <Widget>[
          if (pending && inv['matching_status'] == 'variance' && canApproveVariance && !isMaker)
            actionBtn('Approve variance', () async {
              final note = await promptDialog(context,
                  title: 'Approve the 3-way-match variance?',
                  message: 'The bill differs from the PO / goods received beyond tolerance.',
                  label: 'Note',
                  required: false,
                  confirmLabel: 'Approve variance');
              if (note != null) {
                _do(() => Api.post('/accounts/vendor-invoices/${inv['id']}/approve-variance', data: {'note': note.isEmpty ? null : note}),
                    'Variance approved.');
              }
            }, primary: true),
          if (pending && inv['matching_status'] != 'variance' && !isMaker && finCan('purchase_invoices', 'approve'))
            actionBtn('Post', () => _do(() => Api.post('/accounts/vendor-invoices/${inv['id']}/post'), 'Invoice posted.'), primary: true),
          if (pending && inv['approval_status'] != 'pending' && finCan('purchase_invoices', 'submit'))
            actionBtn('Submit for approval',
                () => _do(() => Api.post('/accounts/vendor-invoices/${inv['id']}/submit'), 'Sent for approval.')),
          if (pending && finCan('purchase_invoices', 'delete'))
            actionBtn('Cancel', () async {
              final reason = await promptDialog(context,
                  title: 'Cancel this purchase invoice?',
                  message: 'Only an unposted bill can be cancelled.',
                  label: 'Reason for cancelling',
                  confirmLabel: 'Cancel invoice');
              if (reason != null) {
                _do(() => Api.post('/accounts/vendor-invoices/${inv['id']}/cancel', data: {'reason': reason}), 'Invoice cancelled.');
              }
            }, danger: true),
          if (inv['status'] == 'posted' && toD(inv['amount_due']) > 0.005 && finCan('payments', 'create'))
            actionBtn('Pay', () async {
              if (await showPaymentVoucherForm(context,
                  paymentType: 'vendor', vendorId: toInt(inv['vendor_id']), partyLabel: '${inv['vendor_name'] ?? ''}')) {
                setState(() => _tick++);
              }
            }, primary: true),
        ];
        return SubPage(
          title: '${inv['invoice_number']}',
          bottom: actions.isEmpty ? null : ActionBar(actions),
          body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Wrap(spacing: 8, runSpacing: 6, children: [
                FinStatusPill(inv['status'], labels: _statusLabels, colors: kDocStatusHex),
                if (pending) ApprovalBadge(status: inv['approval_status'] as String?, stage: inv['approval_stage'] as String?),
                if (inv['status'] == 'posted') FinStatusPill(inv['payment_status'], labels: _payLabels, colors: _payHex),
                FinStatusPill(inv['matching_status'], labels: _matchLabels, colors: _matchHex),
                if (inv['is_reverse_charge'] == true) const StatusBadge('RCM', color: Color(0xFF7C3AED)),
              ]),
            ),
            if (pending && isMaker)
              const InfoBanner('You recorded this bill, so a different finance user must approve/post it (maker-checker).'),
            ApprovalPanel(entityType: 'accounts_vendor_invoice', entityId: toInt(inv['id'])!, onChanged: reload),
            DetailSection('Bill', children: [
              FieldRow('Vendor', inv['vendor_name']),
              if (inv['po_number'] != null) FieldRow('Purchase order', inv['po_number']),
              FieldRow('Type', _typeLabels['${inv['invoice_type']}'] ?? inv['invoice_type']),
              FieldRow('Bill date', fmtDate(inv['invoice_date'])),
              FieldRow('Due date', fmtDate(inv['due_date'])),
              FieldRow('Journal', inv['journal_entry_number']),
            ]),
            TaxLinesView(lines: listOf(inv['lines']), interstate: interstate),
            DetailSection('Tax & amounts', children: [
              FieldRow('Vendor GSTIN', inv['vendor_gstin']),
              FieldRow('Place of supply', inv['place_of_supply_state_code']),
              if (inv['is_reverse_charge'] == true) const FieldRow('Reverse charge', 'Yes — we pay the GST'),
              AmountRow('Taxable value', inr(inv['invoice_amount'])),
              AmountRow(interstate ? 'IGST' : 'CGST + SGST',
                  interstate ? inr(inv['igst_amount']) : '${inr(inv['cgst_amount'])} + ${inr(inv['sgst_amount'])}'),
              if (toD(inv['round_off']) != 0) AmountRow('Round-off', inr(inv['round_off'])),
              AmountRow('Bill total', inr(inv['invoice_total']), bold: true),
              AmountRow('Due', inr(inv['amount_due'])),
            ]),
            DetailSection('Matching & record', children: [
              if (inv['qty_po'] != null)
                FieldRow('Quantities', 'PO ${inv['qty_po']} · GRN accepted ${inv['qty_gr'] ?? '—'} · Invoiced ${inv['qty_invoice'] ?? '—'}'),
              if (inv['variance_approved_by_name'] != null)
                FieldRow('Variance approved by',
                    '${inv['variance_approved_by_name']}${inv['variance_note'] != null ? ' — ${inv['variance_note']}' : ''}'),
              FieldRow('Narration', inv['narration']),
              if (inv['cancelled_reason'] != null) FieldRow('Cancelled because', inv['cancelled_reason']),
              FieldRow('Recorded by', inv['created_by_name']),
              if (inv['posted_by_name'] != null) FieldRow('Posted by', inv['posted_by_name']),
            ]),
            if (finCanFeature('purchase_invoices', 'settlements', 'view'))
              SettlementsSection(
                path: '/accounts/vendor-invoices/${inv['id']}/settlements',
                title: 'Settlement history',
                emptyText: 'Nothing settled against this bill yet.',
                sourceLabel: (s) => s['source_type'] == 'payment' ? 'Payment' : 'Debit note',
              ),
            FinanceAttachments(
              entityType: 'vendor_invoice',
              entityId: toInt(inv['id'])!,
              tabKey: 'purchase_invoices',
              locked: !pending,
              closed: inv['status'] == 'cancelled',
              required: rules.purchaseInvoice && inv['invoice_type'] != 'opening' && pending,
            ),
          ]),
        );
      },
    );
  }
}

/// Record purchase invoice (portal PurchaseInvoiceForm). True when saved.
Future<bool> showPurchaseInvoiceForm(BuildContext context) async {
  FinSetup setup;
  ProofRules rules;
  List<Json> pos = [];
  try {
    setup = await FinSetup.load();
    rules = await ProofRules.load();
    try {
      pos = asRows(await Api.get('/p2p/purchase-orders'))
          .where((p) => const ['issued', 'acknowledged', 'partially_fulfilled', 'fulfilled'].contains(p['status']))
          .toList();
    } catch (_) {
      pos = []; // no Purchase access - Direct bills still work
    }
  } catch (e) {
    if (context.mounted) {
      showSnack(context,
          'Could not load the purchase set-up (company GST state, ledgers, GST rates, vendors, purchase orders). ${ApiClient.describe(e)}',
          error: true);
    }
    return false;
  }
  String mode = pos.isEmpty ? 'direct' : 'po';
  int? poId;
  int? vendorId;
  String? vendorLabel;
  Json? vendor;
  final billNo = TextEditingController();
  DateTime invoiceDate = DateTime.now();
  DateTime? dueDate;
  String? posChoice;
  bool rcm = false;
  final roundOff = TextEditingController(text: '0');
  final narration = TextEditingController();
  final lines = [TaxLine()];
  final proof = <PickedProof>[];
  Json? preview;
  String? previewError;
  bool previewLoading = false;
  String previewKey = '';
  Timer? debounce;
  String warning = '';

  Json? po() {
    for (final p in pos) {
      if (toInt(p['id']) == poId) return p;
    }
    return null;
  }

  Future<Json?> vendorRow(int? id, String? name) async {
    try {
      final rows = asRows(await Api.get('/accounts/vendors', query: {'search': name ?? ''}));
      for (final r in rows) {
        if (id != null && toInt(r['id']) == id) return r;
      }
      for (final r in rows) {
        if (name != null && '${r['name']}'.trim().toLowerCase() == name.trim().toLowerCase()) return r;
      }
    } catch (_) {}
    return null;
  }

  void schedulePreview(StateSetter setS) {
    final p = po();
    final qty = lines.fold<double>(0, (s, l) => s + l.quantity);
    final taxable = previewTax(lines, false).taxable;
    if (mode != 'po' || p == null || qty <= 0 || taxable <= 0) {
      previewKey = '';
      return;
    }
    final payload = [
      for (final l in lines)
        if (l.quantity > 0)
          {'po_item_id': l.poItemId, 'quantity': l.quantity, 'rate': l.rate, 'discount_amount': l.discount, 'uom': l.uom.trim().isEmpty ? null : l.uom.trim()},
    ];
    final key = '$poId|$payload';
    if (key == previewKey) return;
    previewKey = key;
    debounce?.cancel();
    debounce = Timer(const Duration(milliseconds: 450), () async {
      setS(() => previewLoading = true);
      try {
        final r = asJson(await Api.post('/accounts/vendor-invoices/match-preview', data: {'purchase_order_id': poId, 'lines': payload}));
        if (key == previewKey) {
          setS(() {
            preview = r;
            previewError = null;
          });
        }
      } catch (e) {
        if (key == previewKey) {
          setS(() {
            preview = null;
            previewError = 'Could not check the 3-way match. ${ApiClient.describe(e)}';
          });
        }
      } finally {
        setS(() => previewLoading = false);
      }
    });
  }

  if (!context.mounted) return false;
  final saved = await showFormSheet(
    context,
    title: 'Record purchase invoice',
    saveLabel: 'Record invoice',
    builder: (ctx, setS) {
      schedulePreview(setS);
      final p = po();
      final placeOfSupply = posChoice ?? setup.companyState;
      final vendorState = vendor == null ? null : setup.partyStateCode(vendor!['gstin'], vendor!['state']);
      final interstate = vendor != null && vendorState != null && placeOfSupply.isNotEmpty ? vendorState != placeOfSupply : null;
      final registration = '${vendor?['gst_registration_type'] ?? 'regular'}'.toLowerCase();
      final totals = previewTax(lines, interstate == true);
      final ro = double.tryParse(roundOff.text) ?? 0;
      final payable = round2(totals.taxable + (rcm ? 0 : totals.tax) + ro);
      final payDays = toInt(vendor?['payment_days']) ?? 0;
      final poItems = listOf(p?['items']);
      return [
        const Text("Book the vendor's bill exactly as printed — it goes to its approvers when saved.", style: TextStyle(color: Brand.muted)),
        const InfoBanner(
            "A bill against a PO is checked against the PO and goods received (3-way match); a difference beyond tolerance needs a Finance "
            "Manager's approval. Once posted the bill can't be edited — correct it with a debit note."),
        if (vendor != null && (registration == 'composition' || registration == 'unregistered'))
          InfoBanner(
              '${vendor!['name']} is $registration under GST, so its bill carries no input tax credit. Keep the GST rate at 0% on every line — unless '
              'this supply falls under reverse charge, in which case tick RCM.',
              tone: Tone.warning),
        if (vendor != null && vendorState == null)
          InfoBanner(
              "${vendor!['name']} has no GSTIN or state, so CGST/SGST vs IGST can't be decided — complete it under Finance > Masters > Vendors.",
              tone: Tone.warning),
        const Caps('Vendor'),
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'po', label: Text('Against PO')), ButtonSegment(value: 'direct', label: Text('Direct (no PO)'))],
          selected: {mode},
          onSelectionChanged: (s) => setS(() {
            mode = s.first;
            vendor = null;
          }),
        ),
        if (mode == 'po') ...[
          AppSelect<int>(
            label: 'Purchase order',
            required: true,
            value: poId,
            options: [for (final x in pos) Option(toInt(x['id'])!, '${x['po_number']}${x['vendor_name'] != null ? ' — ${x['vendor_name']}' : ''}')],
            onChanged: (o) async {
              setS(() {
                poId = o?.value;
                vendor = null;
              });
              final px = po();
              if (px != null) {
                final v = await vendorRow(toInt(px['vendor_id']), px['vendor_name'] as String?);
                setS(() => vendor = v);
              }
            },
          ),
          if (p != null)
            Text(
              vendor != null
                  ? 'Vendor: ${vendor!['name']}${vendor!['gstin'] != null ? ' · ${vendor!['gstin']}' : ''}'
                  : "No vendor master matches '${p['vendor_name'] ?? '?'}' — add it under Finance > Masters > Vendors.",
              style: TextStyle(fontSize: 12, color: vendor != null ? Brand.muted : Brand.danger),
            ),
        ] else
          AppSelect<int>(
            label: 'Vendor',
            required: true,
            value: vendorId,
            valueLabel: vendorLabel,
            loadOptions: FinLookups.vendors,
            onChanged: (o) async {
              setS(() {
                vendorId = o?.value;
                vendorLabel = o?.label;
                vendor = null;
              });
              if (o != null) {
                final v = await vendorRow(o.value, o.label);
                setS(() => vendor = v);
              }
            },
          ),
        const Caps('Bill'),
        AppTextField(label: 'Vendor bill no.', required: true, controller: billNo, hint: 'As printed on the bill'),
        DateField(label: 'Bill date', required: true, value: invoiceDate, onChanged: (d) => setS(() => invoiceDate = d ?? invoiceDate)),
        DateField(label: 'Due date', value: dueDate, onChanged: (d) => setS(() => dueDate = d)),
        Text(
            vendor != null
                ? 'Blank = ${fmtDate(invoiceDate.add(Duration(days: payDays)))} ($payDays payment days)'
                : 'Blank = vendor payment days',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
        AppSelect<String>(
          label: 'Place of supply',
          required: true,
          value: placeOfSupply.isEmpty ? null : placeOfSupply,
          clearable: false,
          options: setup.stateOptions,
          onChanged: (o) => setS(() => posChoice = o?.value),
        ),
        const Caps('GST'),
        CheckField(label: 'Reverse charge (RCM)', value: rcm, onChanged: (v) => setS(() => rcm = v)),
        const Text(
            'Tick for supplies where we pay the GST to the government instead of the vendor (e.g. GTA freight, legal services, notified goods '
            'from unregistered suppliers). The vendor is paid only the taxable value; the GST goes to RCM payable and is claimed back as input credit.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
        if (mode == 'po' && poItems.isNotEmpty) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton(
              onPressed: () => setS(() {
                lines
                  ..clear()
                  ..addAll(poItems.map((it) => TaxLine(
                        description: '${it['item_name'] ?? ''}',
                        quantity: toD(it['quantity']),
                        uom: '${it['unit'] ?? ''}',
                        rate: toD(it['unit_price']),
                        gstRate: it['tax_rate'] != null ? toD(it['tax_rate']) : 18,
                        storeItemId: toInt(it['store_item_id']),
                        poItemId: toInt(it['id']),
                      )));
              }),
              child: const Text('Load PO lines'),
            ),
          ),
          const Text("Each bill line is matched to its own PO line and its goods receipt, in the PO's unit.",
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ],
        TaxLinesEditor(
            lines: lines, setState: setS, interstate: interstate, ledgerHint: 'default: Purchases / vendor default', costObjects: true),
        if (mode == 'po' && poItems.length > 1) ...[
          const Caps('PO line for each bill line'),
          for (var i = 0; i < lines.length; i++)
            AppSelect<int>(
              label: 'Line ${i + 1}${lines[i].description.isNotEmpty ? ' — ${lines[i].description}' : ''}',
              value: lines[i].poItemId,
              options: [
                for (final it in poItems)
                  Option(toInt(it['id'])!, '${it['item_name']} · ${it['quantity']} ${it['unit'] ?? ''} @ ${it['unit_price'] ?? '—'}'),
              ],
              onChanged: (o) => setS(() => lines[i].poItemId = o?.value),
            ),
        ],
        if (mode == 'po' && (previewLoading || previewError != null || preview != null)) ...[
          const Caps('3-way match'),
          if (previewLoading) const Text('Checking 3-way match…', style: TextStyle(color: Brand.muted)),
          if (!previewLoading && previewError != null) ErrorBanner(previewError!),
          if (!previewLoading && preview != null) _MatchPreview(preview: preview!),
        ],
        AppTextField(label: 'Narration', controller: narration, maxLines: 3, hint: 'What this bill is for'),
        ProofPicker(
          entityType: 'vendor_invoice',
          value: proof,
          setState: setS,
          required: rules.purchaseInvoice,
          hint: "Attach the vendor's bill (PDF or photo) — it is needed before the invoice can go for approval, and it backs the GST input credit.",
        ),
        const Caps('Totals'),
        AppTextField(
            label: 'Round-off (₹)',
            controller: roundOff,
            keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
            onChanged: (_) => setS(() {})),
        Column(children: [
          AmountRow('Taxable value', inr(totals.taxable)),
          AmountRow('GST${rcm ? ' (RCM — paid by us)' : ''}', inr(totals.tax)),
          if (ro != 0) AmountRow('Round-off', inr(ro)),
          AmountRow('Payable to vendor${rcm ? ' (excl. RCM GST)' : ''}', inr(payable), bold: true),
        ]),
      ];
    },
    onSave: () async {
      if (mode == 'po' && poId == null) {
        throw 'Pick the purchase order this bill is against — or switch to "Direct (no PO)" for a service/expense bill.';
      }
      if (mode == 'direct' && vendorId == null) throw 'Pick the vendor who issued this bill.';
      if (billNo.text.trim().isEmpty) throw "Enter the vendor's bill number exactly as printed on their invoice.";
      final ro = double.tryParse(roundOff.text) ?? 0;
      if (ro.abs() >= 1) throw 'Round-off only absorbs paise — it must be less than ₹1 either way.';
      validateTaxLines(lines);
      if (rules.purchaseInvoice && proof.isEmpty) {
        throw "Attach the vendor's bill under Supporting documents — the invoice can't go for approval without it.";
      }
      final placeOfSupply = posChoice ?? setup.companyState;
      final created = asJson(await Api.post('/accounts/vendor-invoices', data: {
        if (mode == 'po') 'purchase_order_id': poId else 'vendor_id': vendorId,
        'invoice_number': billNo.text.trim(),
        'invoice_date': apiDate(invoiceDate),
        'due_date': dateOrNull(dueDate),
        'place_of_supply_state_code': placeOfSupply.isEmpty ? null : placeOfSupply,
        'is_reverse_charge': rcm,
        'round_off': ro,
        'narration': narration.text.trim().isEmpty ? null : narration.text.trim(),
        'lines': [for (final l in lines) l.toPayload(costObjects: true)],
      }));
      final id = toInt(created['id'])!;
      final no = '${created['invoice_number']}';
      final proofError = proof.isEmpty ? '' : await uploadPickedProof('vendor_invoice', id, proof, 'Invoice $no');
      if (proofError.isNotEmpty) {
        warning = '$proofError It stays pending until then — submit it for approval after.';
        return;
      }
      if (finCan('purchase_invoices', 'submit')) {
        warning = await submitAfterSave(() => Api.post('/accounts/vendor-invoices/$id/submit'), 'Invoice $no');
      }
    },
  );
  debounce?.cancel();
  if (saved && context.mounted) showSnack(context, warning.isEmpty ? 'Purchase invoice recorded.' : warning, error: warning.isNotEmpty);
  return saved;
}

class _MatchPreview extends StatelessWidget {
  const _MatchPreview({required this.preview});
  final Json preview;

  @override
  Widget build(BuildContext context) {
    final matched = preview['matching_status'] == 'matched';
    final tol = asJson(preview['tolerances']);
    final reasons = [for (final r in (preview['variance_reasons'] is List ? preview['variance_reasons'] as List : const [])) '$r'];
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: (matched ? Brand.success : Brand.danger).withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        StatusBadge(matched ? '3-way match: within tolerance' : '3-way match: variance — needs approval',
            color: matched ? Brand.success : Brand.danger),
        const SizedBox(height: 6),
        Text(
            'PO qty ${preview['qty_po']} · GRN accepted ${preview['qty_gr']} · Already invoiced ${preview['already_invoiced_qty']} · '
            'Received value ${inr(preview['received_value'])} · Approved PO value ${inr(preview['po_value'])} (before GST)',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
        for (final m in listOf(preview['lines']))
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                    child: Text('${m['item_name']}${m['category'] == 'service' ? ' (service entry)' : ''}',
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
                StatusBadge(m['match_status'] == 'matched' ? 'Matched' : 'Variance',
                    color: m['match_status'] == 'matched' ? Brand.success : Brand.danger),
              ]),
              Text(
                  'Received ${m['received_qty']} ${m['unit'] ?? ''} · Already billed ${m['already_invoiced_qty']} · This bill ${m['invoice_qty']} · '
                  'Qty diff ${m['qty_variance']} · PO rate ${m['po_rate'] != null ? inr(m['po_rate']) : '—'} · Bill rate ${inr(m['invoice_rate'])} · '
                  'Price diff ${m['price_variance'] != null ? inr(m['price_variance']) : '—'}',
                  style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
            ]),
          ),
        if (tol.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
                'Tolerances (Procurement › Settings): quantity +${tol['qty_tol_pct']}% · price ±${tol['price_tol_pct']}%'
                '${toD(tol['price_tol_abs']) != 0 ? ' and at most ${inr(tol['price_tol_abs'])} per line' : ''}',
                style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
          ),
        for (final r in reasons) Text('• $r', style: const TextStyle(fontSize: 12, color: Brand.danger)),
      ]),
    );
  }
}
