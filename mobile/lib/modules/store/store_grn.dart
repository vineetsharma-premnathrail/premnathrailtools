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
import 'store_common.dart';
import 'store_widgets.dart';

// GRN & Quality check (portal: store/grn, grn/new, grn/[id]) — the same
// goods-receipts API as the P2P GRN pages.

const _grnLabel = {'draft': 'Pending quality check', 'completed': 'Completed', 'reversed': 'Reversed'};
const _grnColor = {'draft': cAmber, 'completed': cGreen, 'reversed': cRed};
const _poLabel = {'issued': 'Awaiting Delivery', 'acknowledged': 'Awaiting Delivery', 'partially_fulfilled': 'Partially Received'};

/// Store keepers and the Purchase team can both record a goods receipt.
bool get isPurchaseTeam => Perm.isAdmin || userApps().any((a) => a == 'store' || a == 'purchase');

class GrnTab extends StatefulWidget {
  const GrnTab({super.key});

  @override
  State<GrnTab> createState() => _GrnTabState();
}

class _GrnTabState extends State<GrnTab> {
  List<Json> _grns = const [];
  List<Json> _upcoming = const [];
  bool _loading = true;
  Object? _error;
  late String _bucket = isPurchaseTeam ? 'upcoming' : 'pending';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final g = (await Api.list('/p2p/goods-receipts')).rows;
      final u = isPurchaseTeam ? (await Api.list('/p2p/goods-receipts/pending-purchase-orders')).rows : <Json>[];
      if (mounted) {
        setState(() {
          _grns = g;
          _upcoming = u;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _new([int? poId]) async {
    final g = await openGrnForm(context, poId: poId);
    if (g != null && mounted) {
      _load();
      openThen(context, GrnDetailScreen(grnId: toInt(g['id'])!), _load);
    }
  }

  @override
  Widget build(BuildContext context) {
    final buckets = [
      if (isPurchaseTeam) ('upcoming', 'Upcoming', _upcoming.length),
      ('pending', 'Pending quality check', _grns.where((g) => g['status'] == 'draft').length),
      ('completed', 'Completed', _grns.where((g) => g['status'] == 'completed').length),
      ('all', 'All', _grns.length),
    ];
    final rows = _bucket == 'pending'
        ? _grns.where((g) => g['status'] == 'draft').toList()
        : _bucket == 'completed'
            ? _grns.where((g) => g['status'] == 'completed').toList()
            : _grns;
    const empty = {
      'upcoming': 'No approved purchase orders are awaiting delivery — issued POs appear here until their goods arrive.',
      'pending': 'No goods receipts are waiting for a quality check.',
      'completed': 'No completed goods receipts yet.',
      'all': 'No goods receipts recorded yet — receive a delivery from the Upcoming tab or + New Goods Receipt.',
    };
    return Scaffold(
      floatingActionButton:
          isPurchaseTeam && can('grn', 'create') ? CreateFab(label: 'New Goods Receipt', onPressed: () => _new()) : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
          const StorePageHeader('Goods Receipt (GRN) & Quality check',
              subtitle:
                  'Record goods that arrive against a purchase order. Items flagged for a quality check wait for Quality; the rest go straight into Free stock.'),
          ChipRow([
            for (final (k, l, n) in buckets)
              CountChip(l, _loading ? null : n, selected: _bucket == k, onTap: () => setState(() => _bucket = k)),
          ]),
          if (_loading) const LoadingView(),
          if (_error != null) ErrorView(_error!, onRetry: _load),
          if (!_loading && _error == null && _bucket == 'upcoming') ...[
            if (_upcoming.isEmpty) EmptyView(empty['upcoming']!),
            for (final po in _upcoming)
              RecordCard(
                code: txt(po['po_number']),
                title: txt(po['vendor_name']),
                subtitle: [
                  if (po['p2p_number'] != null) 'PR ${po['p2p_number']}',
                  if (po['po_date'] != null) 'PO ${fmtDate(po['po_date'])}',
                  if (po['expected_delivery'] != null) 'Expected ${fmtDate(po['expected_delivery'])}',
                ].join(' · '),
                trailing: pill(_poLabel[po['status']] ?? humanize(po['status']),
                    po['status'] == 'partially_fulfilled' ? cAmber : cBlue),
                meta: [
                  for (final it in jsonList(po['items']))
                    if (numOr0(it['pending_quantity']) > 0)
                      (txt(it['item_name']), '${fmtQ(it['pending_quantity'])} of ${fmtQ(it['quantity'], it['unit'])}'),
                  if (can('grn', 'create')) ('', 'Tap to receive →'),
                ],
                onTap: can('grn', 'create') ? () => _new(toInt(po['id'])) : null,
              ),
          ],
          if (!_loading && _error == null && _bucket != 'upcoming') ...[
            if (rows.isEmpty) EmptyView(empty[_bucket]!),
            for (final g in rows)
              RecordCard(
                code: txt(g['grn_number']),
                title: txt(g['vendor_name']),
                subtitle: [
                  if (g['po_number'] != null) 'PO ${g['po_number']}',
                  if (g['po_date'] != null) fmtDate(g['po_date']),
                ].join(' · '),
                trailing: pill(_grnLabel[g['status']] ?? humanize(g['status']), _grnColor[g['status']] ?? cGrey),
                meta: [('Received Date', fmtDate(g['received_date']))],
                onTap: () => openThen(context, GrnDetailScreen(grnId: toInt(g['id'])!), _load),
              ),
          ],
        ]),
      ),
    );
  }
}

class _Heat {
  final heat = TextEditingController();
  final qty = TextEditingController();
  final tc = TextEditingController();
  DateTime? expiry;
  MultipartFile? tcFile;
}

class _GrnLine {
  _GrnLine(this.po);
  final Json po;
  final received = TextEditingController();
  final invoice = TextEditingController();
  final serials = TextEditingController();
  int? binId;
  final heats = <_Heat>[_Heat()];
}

List<String> _splitSerials(String s) =>
    s.split(RegExp(r'[\n,;]+')).map((x) => x.trim()).where((x) => x.isNotEmpty).toList();

const _docKeys = [
  'gate_entry_number',
  'vendor_invoice_number',
  'delivery_challan_number',
  'eway_bill_number',
  'vehicle_number',
  'transporter_name',
  'lr_number',
];

Future<Json?> openGrnForm(BuildContext context, {int? poId}) async {
  if (!isPurchaseTeam) {
    showSnack(context, 'Only Store or Purchase users can record a goods receipt — ask an admin to give you Store access.',
        error: true);
    return null;
  }
  List<Json> pos;
  try {
    pos = (await Api.list('/p2p/goods-receipts/pending-purchase-orders')).rows;
  } catch (e) {
    if (context.mounted) showSnack(context, 'Failed to load purchase orders: ${ApiClient.describe(e)}', error: true);
    return null;
  }
  if (!context.mounted) return null;
  int? po = poId;
  int? loc;
  DateTime received = DateTime.now();
  final remarks = TextEditingController();
  final docs = {for (final k in _docKeys) k: TextEditingController()};
  DateTime? invoiceDate;
  DateTime? challanDate;
  var lines = <_GrnLine>[];
  List<Json> bins = const [];
  final canTc = canFeature('grn', 'mill_tc', 'create');
  Json? saved;
  Json? selected() {
    for (final p in pos) {
      if (toInt(p['id']) == po) return p;
    }
    return null;
  }

  void buildLines() => lines = [for (final it in jsonList(selected()?['items'])) _GrnLine(it)];
  buildLines();

  Widget heatBox(_GrnLine l, _Heat h, bool expiry, StateSetter setS) => Container(
        key: ObjectKey(h),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
            border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10), color: Colors.white),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          AppTextField(label: 'Heat / batch no.', required: true, controller: h.heat),
          const SizedBox(height: 8),
          AppTextField(
              label: 'Qty',
              required: true,
              controller: h.qty,
              keyboardType: AppTextField.number,
              onChanged: (_) => setS(() {})),
          const SizedBox(height: 8),
          AppTextField(label: 'Mill TC no.', controller: h.tc),
          if (expiry) ...[
            const SizedBox(height: 8),
            DateField(label: 'Expiry date', value: h.expiry, onChanged: (d) => setS(() => h.expiry = d)),
          ],
          if (canTc)
            Row(children: [
              Expanded(child: Hint(h.tcFile == null ? 'No TC scan attached' : 'TC scan: ${h.tcFile!.filename}')),
              TextButton(
                  onPressed: () async {
                    final f = await Files.pickFile(extensions: const ['pdf', 'jpg', 'jpeg', 'png']);
                    if (f != null) setS(() => h.tcFile = f);
                  },
                  child: const Text('Attach TC')),
            ]),
          if (l.heats.length > 1)
            Align(
                alignment: Alignment.centerRight,
                child: TextButton(onPressed: () => setS(() => l.heats.remove(h)), child: const Text('Remove'))),
        ]),
      );

  Widget lineBox(_GrnLine l, StateSetter setS) {
    final it = l.po;
    final pending = numOr0(it['pending_quantity']);
    final now = parseNum(l.received.text) ?? 0;
    final inv = parseNum(l.invoice.text);
    final variance = inv != null && l.received.text.isNotEmpty ? num.parse((now - inv).toStringAsFixed(3)) : null;
    final heatSum = l.heats.fold<num>(0, (a, h) => a + (parseNum(h.qty.text) ?? 0));
    return Opacity(
      key: ObjectKey(l),
      opacity: pending <= 0 ? 0.5 : 1,
      child: LineBox(
        title: txt(it['item_name']),
        children: [
          if (it['order_project_number'] != null)
            Hint(
                'Project ${it['order_project_number']}${it['order_project_element_no'] != null ? ' · ${it['order_project_element_no']}' : ''}'),
          Wrap(spacing: 16, runSpacing: 6, children: [
            MiniFact('Unit', txt(it['unit'])),
            MiniFact('Ordered Qty', fmtQ(it['quantity'])),
            MiniFact('Already Received', fmtQ(it['received_quantity'])),
            MiniFact('Pending', pending > 0 ? fmtQ(pending) : 'Received', bold: true, color: pending > 0 ? cAmber : cGreen),
          ]),
          if (pending > 0) ...[
            AppTextField(
                label: 'Invoice Qty',
                controller: l.invoice,
                keyboardType: AppTextField.number,
                hint: 'As billed',
                onChanged: (_) => setS(() {})),
            AppTextField(
                label: 'Received Now',
                required: true,
                controller: l.received,
                keyboardType: AppTextField.number,
                onChanged: (_) => setS(() {})),
            if (now > 0 && pending - now > 1e-9) Hint('Short by ${fmtQ(pending - now)} — stays pending from vendor', color: cAmber),
            if (now > pending + 1e-9) Hint('More than pending (${fmtQ(pending)})', color: cRed),
            if (variance != null)
              MiniFact('Variance',
                  variance == 0 ? 'Matches' : (variance < 0 ? 'Short ${fmtQ(-variance)}' : 'Excess ${fmtQ(variance)}'),
                  bold: true, color: variance == 0 ? cGreen : (variance < 0 ? cRed : cAmber)),
            AppSelect<int>(
              label: bins.isEmpty ? 'Bin (no bins)' : 'Bin',
              enabled: bins.isNotEmpty,
              value: l.binId,
              options: [
                for (final b in bins)
                  if (toInt(b['id']) != null)
                    Option(toInt(b['id'])!, '${txt(b['code'])}${b['name'] != null ? ' — ${b['name']}' : ''}'),
              ],
              onChanged: (o) => setS(() => l.binId = o?.value),
            ),
            if (it['batch_controlled'] == true && now > 0) ...[
              const Caps('Batch-tracked — heat / batch numbers from the mill TC'),
              for (final h in l.heats) heatBox(l, h, it['expiry_controlled'] == true, setS),
              Row(children: [
                TextButton(onPressed: () => setS(() => l.heats.add(_Heat())), child: const Text('+ Another heat')),
                Expanded(
                    child: Hint('Heats total ${fmtQ(heatSum)} of ${fmtQ(now)} received',
                        color: (heatSum - now).abs() > 1e-6 ? cRed : cGreen)),
              ]),
            ],
            if (it['serial_controlled'] == true && now > 0)
              AppTextField(
                  label: 'Serial numbers — one per unit (${_splitSerials(l.serials.text).length} of ${fmtQ(now)})',
                  controller: l.serials,
                  maxLines: 4,
                  hint: 'One per line, as on the name plate, e.g. ENG-45821',
                  onChanged: (_) => setS(() {})),
          ],
        ],
      ),
    );
  }

  final ok = await showFormSheet(
    context,
    title: 'Record Goods Receipt',
    saveLabel: 'Save Goods Receipt',
    builder: (ctx, setS) {
      final sel = selected();
      return [
        const Hint(
            "Goods received against a purchase order — count what arrived. Items flagged 'Quality check on receipt' go to Quality; everything else goes straight into stock."),
        const FormHeading('Receipt'),
        AppSelect<int>(
          label: 'Purchase Order',
          required: true,
          value: po,
          options: [
            for (final p in pos)
              if (toInt(p['id']) != null)
                Option(toInt(p['id'])!,
                    '${txt(p['po_number'])} — ${p['vendor_name'] ?? 'No vendor'}${p['p2p_number'] != null ? ' (${p['p2p_number']})' : ''}'),
          ],
          onChanged: (o) => setS(() {
            po = o?.value;
            buildLines();
          }),
        ),
        LocationSelect(
          label: 'Store Location',
          value: loc,
          onChanged: (l) {
            setS(() {
              loc = toInt(l?['id']);
              bins = const [];
              for (final x in lines) {
                x.binId = null;
              }
            });
            if (loc != null) BinSerialPicker.binsOf(loc!).then((b) => setS(() => bins = b));
          },
        ),
        DateField(
            label: 'Received Date', required: true, value: received, onChanged: (d) => setS(() => received = d ?? received)),
        if (sel != null) ...[
          const FormHeading('Gate Entry & Vendor Documents'),
          AppTextField(label: 'Gate Entry No.', controller: docs['gate_entry_number'], hint: 'Auto if blank'),
          AppTextField(label: 'Vendor Invoice No.', controller: docs['vendor_invoice_number'], hint: 'As on the bill'),
          DateField(label: 'Invoice Date', value: invoiceDate, onChanged: (d) => setS(() => invoiceDate = d)),
          AppTextField(label: 'Delivery Challan No.', controller: docs['delivery_challan_number']),
          DateField(label: 'Challan Date', value: challanDate, onChanged: (d) => setS(() => challanDate = d)),
          AppTextField(label: 'E-way Bill No.', controller: docs['eway_bill_number'], hint: '12 digits'),
          AppTextField(label: 'Vehicle No.', controller: docs['vehicle_number'], hint: 'MH12AB1234'),
          AppTextField(label: 'Transporter', controller: docs['transporter_name']),
          AppTextField(label: 'LR No.', controller: docs['lr_number']),
          const Hint(
              'A vendor invoice number can be received only once per vendor. The gate entry number is generated when left blank.'),
        ],
        const FormHeading('Remarks'),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3, hint: 'Condition on arrival, packing, etc.'),
        const FormHeading('Blind Receipt'),
        const Hint(
            "Count the goods and enter what actually arrived — the Invoice Qty is what the vendor's bill says, and the difference shows as Variance. Anything less than pending stays open on the PO and Purchase is notified of the balance due from the vendor. Items flagged 'Quality check on receipt' in the Item Master wait in Quality stock under an inspection lot; every other item goes straight into Free stock when this receipt is saved."),
        if (sel != null) ...[
          FormHeading('Line Items (${lines.length})',
              trailing: TextButton(
                  onPressed: () => setS(() {
                        for (final l in lines) {
                          if (numOr0(l.po['pending_quantity']) > 0) l.invoice.text = '${l.po['pending_quantity']}';
                        }
                      }),
                  child: const Text('Invoice qty = pending'))),
          for (final l in lines) lineBox(l, setS),
        ],
      ];
    },
    onSave: () async {
      if (po == null) throw 'Select a purchase order.';
      if (loc == null) {
        throw "Pick the store the goods were received into — the GRN puts them into that store's stock.";
      }
      if (docs['vendor_invoice_number']!.text.trim().isNotEmpty && invoiceDate == null) {
        throw 'Enter the vendor invoice date too — it is printed next to the invoice number on the bill.';
      }
      final items = <Json>[];
      for (final l in lines) {
        final q = parseNum(l.received.text) ?? 0;
        if (q <= 0) continue;
        final serials = l.po['serial_controlled'] == true ? _splitSerials(l.serials.text) : <String>[];
        final batches = l.po['batch_controlled'] == true
            ? <Json>[
                for (final h in l.heats)
                  if (h.heat.text.trim().isNotEmpty || h.qty.text.trim().isNotEmpty)
                    {
                      'heat_number': h.heat.text.trim(),
                      'quantity': parseNum(h.qty.text) ?? 0,
                      'tc_number': blankToNull(h.tc.text),
                      'expiry_date': h.expiry == null ? null : apiDate(h.expiry!),
                    }
              ]
            : <Json>[];
        final name = txt(l.po['item_name']);
        if (l.po['serial_controlled'] == true && serials.length != q) {
          throw "'$name' is serial-numbered — enter ${fmtQ(q)} serial number(s), one per unit (${serials.length} entered).";
        }
        if (l.po['batch_controlled'] == true) {
          if (batches.isEmpty) {
            throw "'$name' is batch-tracked — add the vendor's heat / batch number(s) with their quantities and mill TC number.";
          }
          final sum = batches.fold<num>(0, (a, b) => a + (b['quantity'] as num));
          if ((sum - q).abs() > 1e-6) {
            throw "'$name': the heats add up to ${fmtQ(sum)} but ${fmtQ(q)} is received — they must match.";
          }
        }
        items.add({
          'po_item_id': l.po['id'],
          'received_quantity': q,
          'invoice_quantity': parseNum(l.invoice.text),
          'bin_id': l.binId,
          'serials': serials,
          'batches': batches,
        });
      }
      if (items.isEmpty) throw 'Enter a received quantity for at least one item.';
      saved = jsonMap(await Api.post('/p2p/goods-receipts', data: {
        'purchase_order_id': po,
        'store_location_id': loc,
        'received_date': apiDate(received),
        'remarks': blankToNull(remarks.text),
        for (final e in docs.entries)
          if (e.value.text.trim().isNotEmpty) e.key: e.value.text.trim(),
        if (invoiceDate != null) 'vendor_invoice_date': apiDate(invoiceDate!),
        if (challanDate != null) 'delivery_challan_date': apiDate(challanDate!),
        'items': items,
      }));
    },
  );
  if (!ok || saved == null) return null;
  // Mill TC scans go up after the GRN exists; a failed upload doesn't undo it.
  final failed = <String>[];
  for (final gl in jsonList(saved!['items'])) {
    for (final l in lines.where((l) => l.po['id'] == gl['po_item_id'])) {
      for (final b in jsonList(gl['batches'])) {
        for (final h in l.heats) {
          if (h.tcFile != null && h.heat.text.trim().toLowerCase() == '${b['heat_number']}'.toLowerCase()) {
            try {
              await uploadMultipart('/store/batches/${b['id']}/tc', h.tcFile!);
            } catch (_) {
              failed.add('${b['heat_number']}');
            }
          }
        }
      }
    }
  }
  if (failed.isNotEmpty && context.mounted) {
    await messageDialog(context, 'Mill TC Not Uploaded',
        "GRN ${txt(saved!['grn_number'])} is saved, but the mill TC for heat ${failed.join(', ')} couldn't be uploaded — attach it from Store › Batches.");
  }
  return saved;
}

const _qualityOptions = [Option('passed', 'Passed'), Option('failed', 'Failed'), Option('partial', 'Partially Accepted')];
const _returnReasons = [
  Option('quality_rejection', 'Rejected in quality check'),
  Option('damaged', 'Damaged in transit / on receipt'),
  Option('wrong_item', 'Wrong item supplied'),
  Option('excess', 'Excess quantity supplied'),
  Option('other', 'Other'),
];

class _Inspect {
  _Inspect(Json it)
      : accepted = TextEditingController(text: '${it['accepted_quantity'] ?? it['received_quantity'] ?? 0}'),
        rejected = TextEditingController(text: '${it['rejected_quantity'] ?? 0}'),
        status = it['quality_status'] != null && it['quality_status'] != 'pending' ? '${it['quality_status']}' : 'passed',
        reason = TextEditingController(text: it['rejection_reason']?.toString() ?? '');
  final TextEditingController accepted;
  final TextEditingController rejected;
  String status;
  final TextEditingController reason;
  final rejectedSerials = <String>[];
}

class GrnDetailScreen extends StatefulWidget {
  const GrnDetailScreen({super.key, required this.grnId});
  final int grnId;

  @override
  State<GrnDetailScreen> createState() => _GrnDetailScreenState();
}

class _GrnDetailScreenState extends State<GrnDetailScreen> {
  Json? _grn;
  List<Json> _returns = const [];
  Object? _error;
  bool _busy = false;
  List<String> _stockNotes = const [];
  final Map<int, _Inspect> _rows = {};

  bool get _seeReturns => canFeature('grn', 'return_to_vendor', 'view');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final g = jsonMap(await Api.get('/p2p/goods-receipts/${widget.grnId}'));
      List<Json> rets = const [];
      if (_seeReturns) {
        try {
          rets = (await Api.list('/p2p/vendor-returns', query: {'goods_receipt_id': widget.grnId})).rows;
        } catch (_) {}
      }
      _rows.clear();
      for (final it in jsonList(g['items'])) {
        final id = toInt(it['id']);
        if (id != null) _rows[id] = _Inspect(it);
      }
      if (mounted) {
        setState(() {
          _grn = g;
          _returns = rets;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  double _acceptedLeft(Json it) {
    final v = numOr0(it['accepted_quantity']) - numOr0(it['returned_quantity']);
    return v < 0 ? 0 : v;
  }

  double _rejectedLeft(Json it) {
    final v = numOr0(it['rejected_quantity']) - numOr0(it['rejected_returned_quantity']);
    return v < 0 ? 0 : v;
  }

  Future<void> _complete() async {
    final g = _grn!;
    setState(() => _busy = true);
    try {
      final items = [
        for (final it in jsonList(g['items']))
          if (it['quality_status'] == 'pending' && _rows[toInt(it['id'])] != null)
            {
              'item_id': it['id'],
              'accepted_quantity': parseNum(_rows[toInt(it['id'])]!.accepted.text) ?? 0,
              'rejected_quantity': parseNum(_rows[toInt(it['id'])]!.rejected.text) ?? 0,
              'quality_status': _rows[toInt(it['id'])]!.status,
              'rejection_reason':
                  _rows[toInt(it['id'])]!.status == 'passed' ? null : blankToNull(_rows[toInt(it['id'])]!.reason.text),
              'rejected_serials':
                  _rows[toInt(it['id'])]!.status == 'partial' ? _rows[toInt(it['id'])]!.rejectedSerials : <String>[],
            },
      ];
      final updated = jsonMap(await Api.post('/p2p/goods-receipts/${g['id']}/inspect', data: {'items': items}));
      _stockNotes = updated['stock_sync_notes'] is List
          ? (updated['stock_sync_notes'] as List).map((e) => '$e').toList()
          : const [];
      await _load();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _returnToVendor(List<Json> returnable) async {
    final g = _grn!;
    final qty = <String, TextEditingController>{};
    TextEditingController q(Json it, String src) => qty.putIfAbsent('${it['id']}:$src', () => TextEditingController());
    String? reason;
    DateTime? date;
    final vehicle = TextEditingController();
    final remarks = TextEditingController();
    Json? rtv;
    final ok = await showFormSheet(
      context,
      title: 'Return to Vendor',
      saveLabel: 'Save Return',
      builder: (ctx, setS) => [
        Hint('${txt(g['grn_number'])}${g['vendor_name'] != null ? ' · ${g['vendor_name']}' : ''} — goods going back to the vendor.'),
        const Hint(
            "Accepted goods leave stock at the PO rate and the PO opens again for the replacement; if the vendor's invoice is already booked, a debit note is raised for Finance. Rejected goods were never taken into stock — this records that they went back. Material rejected by a Quality lot goes back through its NCR."),
        FormHeading('Quantities Going Back (${returnable.length})'),
        for (final it in returnable)
          LineBox(
            key: ObjectKey(it),
            title:
                '${it['item_code'] != null ? '${it['item_code']} — ' : ''}${txt(it['item_name'])}${it['unit'] != null ? ' (${it['unit']})' : ''}',
            children: [
              Wrap(spacing: 16, children: [
                MiniFact('Accepted left', fmtQ(_acceptedLeft(it))),
                MiniFact('Rejected left', fmtQ(_rejectedLeft(it))),
              ]),
              if (_acceptedLeft(it) > 0)
                AppTextField(label: 'Return accepted', controller: q(it, 'accepted'), keyboardType: AppTextField.number),
              if (_rejectedLeft(it) > 0)
                AppTextField(label: 'Return rejected', controller: q(it, 'rejected'), keyboardType: AppTextField.number),
            ],
          ),
        const FormHeading('Return Details'),
        AppSelect<String>(
            label: 'Reason',
            required: true,
            value: reason,
            options: _returnReasons,
            onChanged: (o) => setS(() => reason = o?.value)),
        DateField(label: 'Return Date', value: date, onChanged: (d) => setS(() => date = d)),
        AppTextField(label: 'Vehicle No.', controller: vehicle, hint: 'e.g. HR55 AB 1234'),
        AppTextField(label: 'Remarks', required: reason == 'other', controller: remarks),
      ],
      onSave: () async {
        if (reason == null) throw 'Pick why the goods are going back.';
        final items = [
          for (final e in qty.entries)
            if ((parseNum(e.value.text) ?? 0) > 0)
              {
                'grn_item_id': int.parse(e.key.split(':')[0]),
                'source': e.key.split(':')[1],
                'quantity': parseNum(e.value.text),
              },
        ];
        if (items.isEmpty) throw 'Enter the quantity to return on at least one line.';
        rtv = jsonMap(await Api.post('/p2p/vendor-returns', data: {
          'goods_receipt_id': g['id'],
          'reason': reason,
          'return_date': date == null ? null : apiDate(date!),
          'vehicle_number': blankToNull(vehicle.text),
          'remarks': blankToNull(remarks.text),
          'items': items,
        }));
      },
    );
    if (ok && mounted) {
      await messageDialog(context, 'Done',
          '${txt(rtv?['rtv_number'])} saved — the goods are out of stock and the PO is open again for the replacement. ${rtv?['debit_note_message'] ?? ''}');
      _load();
    }
  }

  Future<void> _reverse() async {
    final g = _grn!;
    final reason = await promptDialog(context,
        title: 'Reverse ${txt(g['grn_number'])}?',
        message:
            'Use this only when the GRN was entered by mistake (wrong PO, wrong quantity, wrong store). The accepted stock is taken back out at the PO rate and the PO is open again. Goods that really came and must go back use Return to Vendor instead.',
        label: 'Why is it being reversed? (e.g. entered against the wrong PO)',
        confirmLabel: 'Reverse GRN');
    if (reason == null || !mounted) return;
    final ok = await runAction(context, () => Api.post('/p2p/goods-receipts/${g['id']}/reverse', data: {'reason': reason}),
        success: '${txt(g['grn_number'])} reversed — its stock was taken back out and the PO is open again.');
    if (ok) _load();
  }

  Widget _line(Json it, bool canInspect, bool isDraft) {
    final r = _rows[toInt(it['id'])];
    final editable = r != null && canInspect && isDraft && it['quality_status'] == 'pending';
    final serials = it['serial_numbers'] is List ? (it['serial_numbers'] as List).map((e) => '$e').toList() : <String>[];
    final v = toNum(it['receipt_variance']);
    final qs = it['quality_status'];
    final qsLabel = qs == 'in_quality'
        ? 'With Quality (inspection lot)'
        : _qualityOptions
            .firstWhere((o) => o.value == qs, orElse: () => Option('', qs == 'pending' ? 'Pending' : humanize(qs)))
            .label;
    final reasonText = it['rejection_reason'] ?? (qs == 'in_quality' ? it['remarks'] : null);
    return LineTile(
      title:
          '${it['item_code'] != null ? '${it['item_code']} — ' : ''}${txt(it['item_name'])}${it['unit'] != null ? ' (${it['unit']})' : ''}',
      subtitle: [
        if (it['bin_code'] != null) 'Bin ${it['bin_code']}',
        if (serials.isNotEmpty) 'S/N ${serials.join(', ')}',
        if (it['order_project_number'] != null) 'Project ${it['order_project_number']}',
      ].join(' · '),
      facts: [
        MiniFact('Ordered', fmtQ(it['ordered_quantity'])),
        MiniFact('Invoice Qty', fmtQ(it['invoice_quantity'])),
        MiniFact('Received', fmtQ(it['received_quantity'])),
        if (v != null && v != 0)
          MiniFact('vs bill', v < 0 ? 'Short ${fmtQ(-v)}' : 'Excess ${fmtQ(v)}', color: v < 0 ? cRed : cAmber),
        if (!editable) MiniFact('Accepted', fmtQ(it['accepted_quantity']), color: cGreen, bold: true),
        if (!editable)
          MiniFact('Rejected', fmtQ(it['rejected_quantity']),
              color: numOr0(it['rejected_quantity']) > 0 ? cRed : Brand.muted, bold: true),
        if (numOr0(it['returned_quantity']) + numOr0(it['rejected_returned_quantity']) > 0)
          MiniFact(
              'Returned',
              [
                if (numOr0(it['returned_quantity']) > 0) '${fmtQ(it['returned_quantity'])} accepted',
                if (numOr0(it['rejected_returned_quantity']) > 0) '${fmtQ(it['rejected_returned_quantity'])} rejected',
              ].join(' · ')),
      ],
      extra: editable
          ? Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Expanded(child: AppTextField(label: 'Accepted', controller: r.accepted, keyboardType: AppTextField.number)),
                  const SizedBox(width: 8),
                  Expanded(child: AppTextField(label: 'Rejected', controller: r.rejected, keyboardType: AppTextField.number)),
                ]),
                const SizedBox(height: 8),
                AppSelect<String>(
                    label: 'Quality Status',
                    value: r.status,
                    clearable: false,
                    options: _qualityOptions,
                    onChanged: (o) => setState(() => r.status = o?.value ?? r.status)),
                if (r.status != 'passed') ...[
                  const SizedBox(height: 8),
                  AppTextField(label: 'Rejection Reason', controller: r.reason),
                ],
                if (serials.isNotEmpty && r.status == 'partial') ...[
                  const SizedBox(height: 6),
                  const Hint('Tap the rejected serial(s):'),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final s in serials)
                      FilterChip(
                        label: Text(s),
                        selected: r.rejectedSerials.contains(s),
                        selectedColor: cRed.withValues(alpha: 0.15),
                        onSelected: (on) => setState(() => on ? r.rejectedSerials.add(s) : r.rejectedSerials.remove(s)),
                      ),
                  ]),
                ],
              ]),
            )
          : Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Wrap(spacing: 8, runSpacing: 4, children: [
                pill(qsLabel, qs == 'passed' ? cGreen : (qs == 'failed' ? cRed : (qs == 'partial' ? cAmber : cGrey))),
                if (reasonText != null) Text(txt(reasonText), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              ]),
            ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final g = _grn;
    if (g == null) {
      return SubPage(
          title: 'Goods Receipt', body: _error == null ? const LoadingView() : ErrorView(_error!, onRetry: _load));
    }
    final canInspect = canFeature('grn', 'inspection', 'approve');
    final isDraft = g['status'] == 'draft';
    final isReversed = g['status'] == 'reversed';
    final items = jsonList(g['items']);
    final returnable = items
        .where((it) =>
            ['passed', 'failed', 'partial'].contains(it['quality_status']) &&
            (_acceptedLeft(it) > 0 || _rejectedLeft(it) > 0))
        .toList();
    final canReverse = canFeature('grn', 'reverse', 'approve') && !isReversed && _returns.isEmpty;
    final pendingLines = items.any((it) => it['quality_status'] == 'pending');
    return SubPage(
      title: txt(g['grn_number']),
      bottom: actionBar([
        if (!isReversed && canFeature('grn', 'return_to_vendor', 'create') && returnable.isNotEmpty)
          secondaryAction('↩ Return to Vendor', () => _returnToVendor(returnable)),
        if (canReverse) secondaryAction('Reverse GRN', _busy ? null : _reverse, color: cRed),
        if (isDraft && canInspect && pendingLines)
          primaryAction(_busy ? 'Completing…' : 'Complete quality check', _busy ? null : _complete),
      ]),
      body: RefreshIndicator(
        onRefresh: _load,
        child: detailList([
          if (isReversed)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: InfoNote(
                  'This GRN was reversed: ${txt(g['reversal_reason'])}${g['reversed_by_name'] != null ? ' — by ${g['reversed_by_name']}' : ''}${g['reversed_at'] != null ? ' on ${fmtDate(g['reversed_at'])}' : ''}. Its stock was taken back out; it no longer counts as received.',
                  color: cRed),
            ),
          if (_stockNotes.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: InfoNote(
                  'Stock was not fully updated:\n${_stockNotes.map((n) => '• $n').join('\n')}\nAdd the missing item in Item Master (+ Add Item).',
                  color: cAmber),
            ),
          SummaryCard(
            title: txt(g['grn_number']),
            text:
                'Goods received${g['vendor_name'] != null ? ' from ${g['vendor_name']}' : ''} against ${g['po_number'] ?? 'the purchase order'}${g['store_location_name'] != null ? ' into ${g['store_location_name']}' : ''}.',
            badges: [pill(_grnLabel[g['status']] ?? humanize(g['status']), _grnColor[g['status']] ?? cGrey)],
            meta: [
              'Received ${fmtDate(g['received_date'])}',
              if (g['received_by_name'] != null) 'by ${g['received_by_name']}',
              if (g['status'] == 'completed' && g['inspected_by_name'] != null) 'Quality check by ${g['inspected_by_name']}',
              if (g['status'] == 'completed' && g['inspected_by_name'] == null)
                'Completed on receipt — no quality check needed for these items',
            ],
          ),
          DetailSection('Order', children: [
            FieldRow('PO Number', g['po_number']),
            FieldRow('PR Number', g['p2p_number']),
            FieldRow('Vendor', g['vendor_name']),
            FieldRow('Store Location', g['store_location_name']),
          ]),
          DetailSection('Delivery Documents', children: [
            FieldRow(
                'Gate Entry',
                [g['gate_entry_number'], g['gate_entry_at'] == null ? null : fmtDateTime(g['gate_entry_at'])]
                    .where((x) => x != null)
                    .join(' · ')),
            FieldRow(
                'Vendor Invoice',
                g['vendor_invoice_number'] == null
                    ? null
                    : '${g['vendor_invoice_number']}${g['vendor_invoice_date'] != null ? ' dt. ${fmtDate(g['vendor_invoice_date'])}' : ''}'),
            FieldRow(
                'Delivery Challan',
                g['delivery_challan_number'] == null
                    ? null
                    : '${g['delivery_challan_number']}${g['delivery_challan_date'] != null ? ' dt. ${fmtDate(g['delivery_challan_date'])}' : ''}'),
            FieldRow('E-way Bill', g['eway_bill_number']),
            FieldRow('Vehicle / Transporter',
                [g['vehicle_number'], g['transporter_name']].where((x) => x != null).join(' · ')),
            FieldRow('LR No.', g['lr_number']),
            if (g['remarks'] != null) FieldRow('Remarks', g['remarks']),
          ]),
          DetailSection(isDraft ? 'Quality check' : 'Quality check result', children: [
            for (final it in items) _line(it, canInspect, isDraft),
            if (isDraft && items.any((it) => it['quality_status'] == 'in_quality'))
              const Hint(
                  "Lines marked “With Quality (inspection lot)” are held in Quality stock; the GRN completes once Quality makes the usage decision on their inspection lots. Items without the 'Quality check on receipt' flag are already in Free stock."),
            if (isDraft && !canInspect && pendingLines)
              const Hint(
                  "These lines still need an accepted / rejected decision. Someone with 'Approve' on Store › GRN & Quality check completes it — accepted quantity then counts as received, rejected goes back to the vendor."),
          ]),
          if (_seeReturns && _returns.isNotEmpty)
            DetailSection('Returns to Vendor', children: [
              for (final r in _returns)
                LineTile(
                  title: txt(r['rtv_number']),
                  subtitle:
                      '${fmtDate(r['return_date'])} · ${r['reason_label'] ?? _returnReasons.firstWhere((x) => x.value == r['reason'], orElse: () => Option('', txt(r['reason']))).label}',
                  facts: [
                    for (final i in jsonList(r['items']))
                      MiniFact(txt(i['item_name']), '${fmtQ(i['quantity'], i['unit'])} (${i['source']})'),
                    if (seeValues) MiniFact('Value', r['total_value'] == null ? '—' : fmtMoney(r['total_value'])),
                    MiniFact('Vehicle', txt(r['vehicle_number'])),
                    MiniFact('By', txt(r['created_by_name'])),
                  ],
                  extra: r['debit_note_message'] != null || r['remarks'] != null
                      ? Hint([
                          if (r['debit_note_message'] != null) '${r['debit_note_message']}',
                          if (r['remarks'] != null) 'Remarks: ${r['remarks']}',
                        ].join('\n'))
                      : null,
                ),
            ]),
        ]),
      ),
    );
  }
}
