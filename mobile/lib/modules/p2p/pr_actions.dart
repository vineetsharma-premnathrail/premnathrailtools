import 'dart:convert';

import 'package:dio/dio.dart' show MultipartFile;
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';

// Line and PO actions shared by the requisition page, My Lines and the RFQ page
// (portal ReassignLineDialog, ShortCloseLineDialog, DiscardPoDraftDialog,
// UploadPODialog, PoDeliveryCostsPanel, ServiceEntriesPanel).

typedef LineRef = ({int prItemId, String itemName, String? unit, double openToOrder, int? buyerId});

/// Purchase head: move a line's not-yet-ordered quantity to another buyer.
Future<bool> reassignLine(BuildContext context, int prId, LineRef line) async {
  int? buyerId;
  String? buyerName;
  final reason = TextEditingController();
  final unit = line.unit ?? '';
  return showFormSheet(
    context,
    title: 'Move line to another buyer',
    saveLabel: 'Move line',
    builder: (ctx, setS) => [
      Text(line.itemName, style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
      Text('This moves ${fmtQty(line.openToOrder)} $unit not yet ordered; quantity already on POs stays with its buyer. '
          "The old buyer's RFQ line is taken off, and awards without a PO are cleared. Their quotes stay as history."),
      AppSelect<int>(
        label: 'Move to buyer',
        required: true,
        value: buyerId,
        valueLabel: buyerName,
        loadOptions: (q) async => (await directoryOptions(q)).where((o) => o.value != line.buyerId).toList(),
        onChanged: (o) => setS(() {
          buyerId = o?.value;
          buyerName = o?.label;
        }),
      ),
      AppTextField(
          label: 'Reason', required: true, controller: reason, maxLines: 3,
          hint: 'e.g. Rahul is on leave; this vendor is handled by Anita'),
      const Hint('At least 5 characters. It is saved in the requisition history and sent with the notice to the old buyer and the requester.'),
    ],
    onSave: () async {
      if (buyerId == null) throw 'Pick the buyer who should take this line over.';
      if (reason.text.trim().length < 5) {
        throw 'Write why the line is moving (at least 5 characters), so the old buyer and the requester can see the reason.';
      }
      await Api.post('/p2p/requests/$prId/lines/${line.prItemId}/reassign-buyer',
          data: {'buyer_id': buyerId, 'reason': reason.text.trim()});
    },
  );
}

/// Write off a line's not-yet-ordered quantity (all, or part).
Future<bool> shortCloseLine(BuildContext context, int prId, LineRef line) async {
  final open = line.openToOrder;
  final unit = line.unit ?? '';
  final qty = TextEditingController(text: qtyText(open));
  final reason = TextEditingController();
  return showFormSheet(
    context,
    title: 'Short-close line',
    saveLabel: 'Short-close',
    builder: (ctx, setS) => [
      Text(line.itemName, style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
      const NoteBox(
          'This cannot be undone. The quantity is taken off what must be bought, any award above the new quantity is trimmed, '
          'and the requester is told. Quantity already on a PO is not touched.',
          tone: NoteTone.warn),
      AppTextField(
          label: 'Quantity to short-close${unit.isEmpty ? '' : ' ($unit)'}',
          required: true,
          controller: qty,
          keyboardType: AppTextField.number),
      Hint('${fmtQty(open)} $unit is not yet ordered — that is the most you can short-close.'),
      AppTextField(
          label: 'Reason', required: true, controller: reason, maxLines: 3,
          hint: 'e.g. Requirement cancelled by the project; stock issued instead'),
      const Hint('At least 5 characters. It is saved in the requisition history.'),
    ],
    onSave: () async {
      final n = double.tryParse(qty.text.trim());
      if (n == null || n <= 0) throw 'Enter how much to short-close: more than 0 and at most ${fmtQty(open)} $unit.';
      if (n - open > 1e-6) {
        throw 'Only ${fmtQty(open)} $unit is not yet ordered, so you can short-close at most that. Lower the quantity.';
      }
      if (reason.text.trim().length < 5) {
        throw 'Write why this quantity is not needed (at least 5 characters). The requester is told the reason.';
      }
      await Api.post('/p2p/requests/$prId/lines/${line.prItemId}/short-close', data: {
        if ((n - open).abs() > 1e-6) 'quantity': n,
        'reason': reason.text.trim(),
      });
    },
  );
}

/// Discard a draft PO; its quantity goes back to open.
Future<bool> discardPoDraft(BuildContext context, {required int rfqId, required int poId, required String poNumber, String? vendorName}) {
  final reason = TextEditingController();
  return showFormSheet(
    context,
    title: 'Discard draft PO',
    saveLabel: 'Discard draft PO',
    builder: (ctx, setS) => [
      Text('$poNumber${vendorName != null ? ' · $vendorName' : ''}',
          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
      const NoteBox(
          'The quantity on this draft goes back to open, so you can upload a new PO for it. The Tally PO number can be used again. '
          'A PO that is in approval or already released cannot be discarded here.',
          tone: NoteTone.warn),
      AppTextField(
          label: 'Reason', required: true, controller: reason, maxLines: 3,
          hint: 'e.g. Vendor changed the price; a new PO will be made in Tally'),
      const Hint('At least 5 characters. It is saved in the requisition history and sent to the requester and the buyers of these lines.'),
    ],
    onSave: () async {
      if (reason.text.trim().length < 5) {
        throw 'Write why this draft PO is discarded (at least 5 characters). It is saved in the requisition history.';
      }
      await Api.post('/p2p/rfqs/$rfqId/po-draft/$poId/discard', data: {'reason': reason.text.trim()});
    },
  );
}

class _PoLine {
  _PoLine(this.prItemId, this.itemCode, this.itemName, this.unit, this.max, {this.quotedPrice, this.quotedTax})
      : qty = TextEditingController(text: qtyText(max)),
        price = TextEditingController(),
        tax = TextEditingController();
  final int prItemId;
  final String? itemCode;
  final String itemName;
  final String? unit;
  final double max;
  final double? quotedPrice;
  final double? quotedTax;
  bool on = true;
  final TextEditingController qty;
  final TextEditingController price;
  final TextEditingController tax;
}

class _AwardVendor {
  _AwardVendor(this.vqId, this.vendorName);
  final int vqId;
  final String vendorName;
  final lines = <_PoLine>[];
}

/// Upload PO on the requisition: the Tally PO no. + PDF, ONE vendor, the lines
/// with quantity and price. The server builds the PO and sends it for approval.
Future<bool> uploadPo(BuildContext context, Json rfq, Json pr) async {
  final rfqId = jInt(rfq, 'id')!;
  final prId = jInt(pr, 'id')!;
  final needsCostCenter = jStr(pr, 'purpose') == 'department' && pr['internal_order_id'] == null && pr['cost_center_id'] == null;
  final loaded = await withLoading(context, () async {
    Json? cmp;
    String note = '';
    try {
      cmp = asJson(await Api.get('/p2p/rfqs/$rfqId/comparison'));
    } catch (e) {
      note = 'The awarded vendors could not be loaded: ${ApiClient.describe(e)}';
    }
    Json? trk;
    try {
      trk = asJson(await Api.get('/p2p/requests/$prId/tracker'));
    } catch (_) {}
    final stores = asList(await Api.get('/store/locations', query: {'all_plants': true}))
        .where((l) => l['is_active'] != false)
        .toList();
    final branches = asList(await Api.get('/organization/branches').catchError((_) => <dynamic>[]));
    List<Json> costCenters = const [];
    if (needsCostCenter) {
      try {
        costCenters = jList(asJson(await Api.get('/p2p/account-assignment/options', query: {'kind': 'cost_center'})), 'options');
      } catch (_) {}
    }
    return (cmp: cmp, note: note, trk: trk, stores: stores, branches: branches, costCenters: costCenters);
  });
  if (loaded == null || !context.mounted) return false;

  // Awarded vendors with what is still awarded and not yet on a live PO.
  final onLive = <String, double>{};
  for (final l in jList(loaded.trk, 'lines')) {
    for (final p in jList(l, 'pos')) {
      if (jStr(p, 'stage') == 'cancelled' || p['vendor_name'] == null) continue;
      final k = '${p['vendor_name']}:${l['pr_item_id']}';
      onLive[k] = (onLive[k] ?? 0) + jD(p, 'quantity');
    }
  }
  final byVq = <int, _AwardVendor>{};
  final cmp = loaded.cmp;
  final cmpVendors = jList(cmp, 'vendors');
  for (final row in jList(cmp, 'lines')) {
    for (final a in jList(row, 'awards')) {
      final v = cmpVendors.where((x) => jInt(x, 'vendor_quotation_id') == jInt(a, 'vendor_quotation_id')).firstOrNull;
      if (v == null) continue;
      final cell = asList(row['quotes']).where((q) => jInt(q, 'vendor_quotation_item_id') == jInt(a, 'vendor_quotation_item_id')).firstOrNull;
      final name = jStr(v, 'vendor_name') ?? '';
      final remaining = (jD(a, 'quantity') - (onLive['$name:${row['pr_item_id']}'] ?? 0)).clamp(0, double.infinity).toDouble();
      final entry = byVq.putIfAbsent(jInt(v, 'vendor_quotation_id')!, () => _AwardVendor(jInt(v, 'vendor_quotation_id')!, name));
      entry.lines.add(_PoLine(jInt(row, 'pr_item_id')!, jStr(row, 'item_code'), jStr(row, 'item_name') ?? 'Item', jStr(row, 'unit'), remaining,
          quotedPrice: jNum(cell, 'net_unit'), quotedTax: jNum(cell, 'gst_rate')));
    }
  }
  final awardVendors = byVq.values.toList()..sort((a, b) => a.vendorName.compareTo(b.vendorName));
  final orderable = awardVendors.where((v) => v.lines.any((l) => l.max > eps)).toList();
  final awardMode = awardVendors.isNotEmpty;

  // No awards: vendor from the quoted L1–L4 files, the vendor already chosen, or the vendor master.
  final tiers = <String, Json>{};
  for (final a in jList(rfq, 'attachments')) {
    final t = jStr(a, 'vendor_tier');
    if (t != null && jStr(a, 'vendor_name') != null && !tiers.containsKey(t)) tiers[t] = a;
  }
  final tierKeys = tiers.keys.toList()..sort();
  final presetVendor = jStr(pr, 'status') == 'vendor_selected' ? jStr(pr, 'selected_vendor') : null;
  final showTiers = !awardMode && presetVendor == null && tierKeys.isNotEmpty;
  final pickFromMaster = !awardMode && tierKeys.isEmpty && presetVendor == null;
  List<Json> vendors = const [];
  if (pickFromMaster) {
    try {
      vendors = await loadActiveVendors();
    } catch (_) {}
  }

  final legacyLines = <_PoLine>[];
  if (!awardMode) {
    final active = jList(rfq, 'items').where((i) => i['withdrawn_at'] == null).toList();
    final prItems = jList(pr, 'items');
    if (active.isNotEmpty) {
      for (final i in active) {
        final item = prItems.where((x) => jInt(x, 'id') == jInt(i, 'pr_item_id')).firstOrNull;
        final toBuy = item != null ? (jD(item, 'quantity') - jD(item, 'issued_qty') - jD(item, 'short_closed_qty')).clamp(0, double.infinity) : jD(i, 'quantity');
        final max = i['open_qty'] != null ? jD(i, 'open_qty') : (jD(i, 'quantity') < toBuy ? jD(i, 'quantity') : toBuy.toDouble());
        legacyLines.add(_PoLine(jInt(i, 'pr_item_id')!, jStr(i, 'item_code'), jStr(i, 'item_name') ?? jStr(item, 'item_name') ?? 'Item', jStr(i, 'unit'), max));
      }
    } else {
      for (final i in prItems) {
        final left = jD(i, 'quantity') - jD(i, 'issued_qty') - jD(i, 'short_closed_qty');
        if (jStr(i, 'fulfillment_status') != 'stock_issued' && left > 0) {
          legacyLines.add(_PoLine(jInt(i, 'id')!, jStr(i, 'item_code'), jStr(i, 'item_name') ?? 'Item', jStr(i, 'unit'), left));
        }
      }
    }
  }

  // Ship to: the plant the requisition names and its first store.
  int? storeId;
  final targets = jList(pr, 'items').map((i) => (jStr(i, 'ship_to') ?? '').trim()).where((s) => s.isNotEmpty).toSet();
  if (targets.length == 1) {
    final b = loaded.branches.where((b) => '${b['name']} (${b['code']})' == targets.first).firstOrNull;
    if (b != null) {
      final first = loaded.stores.where((l) => jInt(l, 'branch_id') == jInt(b, 'id')).toList()
        ..sort((a, c) => (jStr(a, 'name') ?? '').compareTo(jStr(c, 'name') ?? ''));
      if (first.isNotEmpty) storeId = jInt(first.first, 'id');
    }
  }

  final tallyNo = TextEditingController();
  MultipartFile? file;
  String? fileName;
  _AwardVendor? selected = orderable.firstOrNull;
  var tier = 'L1';
  final reason = TextEditingController();
  int? vendorId;
  DateTime? expected;
  int? costCenterId;

  List<_PoLine> lines() => awardMode ? (selected?.lines.where((l) => l.max > eps).toList() ?? []) : legacyLines;
  double qtyOf(_PoLine l) => double.tryParse(l.qty.text) ?? l.max;
  double priceOf(_PoLine l) => double.tryParse(l.price.text) ?? 0;

  if (!context.mounted) return false;
  return showFormSheet(
    context,
    title: 'Upload PO',
    saveLabel: 'Upload',
    builder: (ctx, setS) {
      final ls = lines();
      final ticked = ls.where((l) => l.on);
      final total = ticked.fold<double>(0, (s, l) => s + qtyOf(l) * priceOf(l) * (1 + (double.tryParse(l.tax.text) ?? 0) / 100));
      return [
        Hint('${pr['p2p_number']} · ${rfq['rfq_number']} — one PO per vendor: attach the PO made in Tally; it goes for approval.'),
        const FormHeading('1. Tally PO'),
        AppTextField(label: 'Tally PO no.', required: true, controller: tallyNo, hint: 'e.g. PO/0042/26-27'),
        Row(children: [
          Expanded(child: Text(fileName ?? 'Tally PO print (PDF) *', overflow: TextOverflow.ellipsis)),
          secondaryBtn(file == null ? 'Attach PDF' : 'Change', () async {
            final f = await Files.pickFile(extensions: ['pdf']);
            if (f == null) return;
            file = f;
            fileName = f.filename;
            try {
              setS(() {});
            } catch (_) {}
          }, icon: Icons.attach_file_rounded),
        ]),
        const Hint('PDF only · up to 15 MB'),
        const FormHeading('2. Vendor'),
        if (!awardMode && loaded.note.isNotEmpty) Hint('${loaded.note} You can still pick the vendor below.', color: const Color(0xFF92400E)),
        if (awardMode && orderable.isEmpty)
          const NoteBox(
              'Every awarded quantity of this RFQ is already on a PO, so there is nothing left to upload. To change an order, cancel or amend that PO first.',
              tone: NoteTone.warn),
        if (awardMode)
          for (final v in orderable)
            RadioListTile<int>(
              contentPadding: EdgeInsets.zero,
              value: v.vqId,
              // ignore: deprecated_member_use
              groupValue: selected?.vqId,
              // ignore: deprecated_member_use
              onChanged: (_) => setS(() => selected = v),
              title: Text(v.vendorName),
              subtitle: Text('${v.lines.where((l) => l.max > eps).length} line(s) left to order'),
            ),
        if (awardMode && orderable.isNotEmpty) const Hint('One PO is made for one vendor. Upload the next vendor’s PO after this one.'),
        if (presetVendor != null) Text(presetVendor, style: const TextStyle(fontWeight: FontWeight.w600)),
        if (pickFromMaster) ...[
          AppSelect<int>(
            label: 'Vendor',
            required: true,
            value: vendorId,
            options: [
              for (final v in vendors)
                Option(jInt(v, 'id')!, jStr(v, 'code') != null ? '${v['code']} — ${v['name']}' : '${v['name']}'),
            ],
            onChanged: (o) => setS(() => vendorId = o?.value),
          ),
          const Hint('This RFQ has no awarded vendor or L1/L2 quote files (quotes came by email) — pick the vendor of the Tally PO.'),
        ],
        if (showTiers)
          for (final t in tierKeys)
            RadioListTile<String>(
              contentPadding: EdgeInsets.zero,
              value: t,
              // ignore: deprecated_member_use
              groupValue: tier,
              // ignore: deprecated_member_use
              onChanged: (v) => setS(() => tier = v ?? 'L1'),
              title: Text('$t · ${tiers[t]!['vendor_name']}'),
              subtitle: Text([if (t == 'L1') 'lowest', jStr(tiers[t], 'vendor_contact')].whereType<String>().join(' · ')),
            ),
        if (showTiers && tier != 'L1')
          AppTextField(
              label: 'Why not L1 (lowest)?', required: true, controller: reason, maxLines: 2,
              hint: "e.g. L1 can't deliver before the required date / L1 failed technical evaluation"),
        const FormHeading('3. Delivery'),
        AppSelect<int>(
          label: 'Deliver to store',
          required: true,
          value: storeId,
          options: [for (final s in loaded.stores) Option(jInt(s, 'id')!, '${s['code']} — ${s['name']}')],
          onChanged: (o) => setS(() => storeId = o?.value),
        ),
        const Hint("The store's address is the PO's delivery address; the GRN is done there."),
        DateField(label: 'Expected delivery', value: expected, onChanged: (d) => setS(() => expected = d)),
        if (needsCostCenter) ...[
          AppSelect<int>(
            label: 'Cost centre (charged to)',
            required: true,
            value: costCenterId,
            options: [for (final c in loaded.costCenters) Option(jInt(c, 'id')!, jStr(c, 'label') ?? '')],
            onChanged: (o) => setS(() => costCenterId = o?.value),
          ),
          const Hint('A department running-cost purchase is charged to a cost centre; Finance books the invoice to it.'),
        ],
        FormHeading('4. Lines on this PO${selected != null ? ' — ${selected!.vendorName}' : ''} (prices as on the Tally PO)'),
        if (ls.isEmpty)
          Hint(awardMode
              ? 'No line is left to order for this vendor.'
              : 'No line of this RFQ has quantity left to order. Everything is on a PO, issued from stock or short-closed.'),
        for (final l in ls)
          InnerCard(key: ValueKey('pol-${selected?.vqId}-${l.prItemId}'), children: [
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: l.on,
              onChanged: (v) => setS(() => l.on = v ?? false),
              title: Text('${l.itemCode != null ? '${l.itemCode} — ' : ''}${l.itemName}'),
              subtitle: Text('Left to order: ${fmtQty(l.max)} ${l.unit ?? ''}'),
            ),
            if (l.on) ...[
              AppTextField(label: 'Quantity', required: true, controller: l.qty, keyboardType: AppTextField.number, onChanged: (_) => setS(() {})),
              const SizedBox(height: 8),
              AppTextField(
                  label: 'Unit price', required: true, controller: l.price, keyboardType: AppTextField.number,
                  hint: l.quotedPrice != null ? 'quoted ${l.quotedPrice}' : null, onChanged: (_) => setS(() {})),
              const SizedBox(height: 8),
              AppTextField(
                  label: 'Tax %', controller: l.tax, keyboardType: AppTextField.number,
                  hint: l.quotedTax != null ? '${l.quotedTax}' : null, onChanged: (_) => setS(() {})),
            ],
          ]),
        Text('PO value (incl. tax): ${money(total)}', style: const TextStyle(fontWeight: FontWeight.w700)),
        const Hint(
            "Lower a quantity to order less than is left; the rest stays to order on another PO. Un-tick a line to leave it off this PO. "
            "The grey figure in a price box is the vendor's quoted rate, for reference only: type the price on the Tally PO. "
            'The PO number is generated; the Tally PO number is kept on it. The PO goes to the PO approvers, then a Partner.'),
      ];
    },
    onSave: () async {
      final problems = <String>[];
      final ls = lines();
      final ticked = ls.where((l) => l.on).toList();
      if (tallyNo.text.trim().isEmpty) problems.add('Enter the Tally PO number — the voucher number of this PO in Tally.');
      if (file == null) problems.add('Attach the Tally PO print as a PDF (print it from Tally to PDF).');
      if (awardMode && selected == null) {
        problems.add('Every awarded quantity of this RFQ is already on a PO. Nothing is left to upload; cancel or amend a PO first if it must change.');
      }
      if (showTiers && tier != 'L1' && reason.text.trim().isEmpty) problems.add('You picked the $tier vendor instead of L1 (lowest) — write the reason.');
      if (pickFromMaster && vendorId == null) problems.add('Pick the vendor the PO is placed with.');
      if (storeId == null) problems.add('Pick the store the goods are delivered to.');
      if (needsCostCenter && costCenterId == null) problems.add('Pick the cost centre this department purchase is charged to.');
      if (ticked.isEmpty) problems.add('Tick at least one line to put on this PO.');
      final badQty = ticked.where((l) => !(qtyOf(l) > 0) || qtyOf(l) > l.max + eps).map((l) => '${l.itemName} (up to ${fmtQty(l.max)})');
      if (badQty.isNotEmpty) problems.add('Quantity must be more than 0 and not above what is left to order for: ${badQty.join(', ')}.');
      final unpriced = ticked.where((l) => !(priceOf(l) > 0)).map((l) => l.itemName);
      if (unpriced.isNotEmpty) problems.add('Enter the unit price (as on the Tally PO) for: ${unpriced.join(', ')}.');
      final badTax = ticked.where((l) {
        final t = l.tax.text.trim();
        if (t.isEmpty) return false;
        final n = double.tryParse(t);
        return n == null || n < 0 || n > 100;
      }).map((l) => l.itemName);
      if (badTax.isNotEmpty) problems.add('Tax % must be between 0 and 100 for: ${badTax.join(', ')}.');
      if (problems.isNotEmpty) throw problems.join(' ');
      final details = <String, dynamic>{
        if (awardMode && selected != null) 'vendor_quotation_id': selected!.vqId,
        if (showTiers) 'vendor_tier': tier,
        if (showTiers && tier != 'L1') 'selection_reason': reason.text.trim(),
        if (needsCostCenter) 'cost_center_id': costCenterId,
        if (pickFromMaster) 'vendor_id': vendorId,
        'ship_to_location_id': storeId,
        if (expected != null) 'expected_delivery': apiDate(expected!),
        'lines': [
          for (final l in ticked)
            {
              'pr_item_id': l.prItemId,
              'quantity': qtyOf(l),
              'unit_price': priceOf(l),
              'tax_rate': l.tax.text.trim().isEmpty ? null : double.tryParse(l.tax.text.trim()),
            },
        ],
      };
      await Api.post('/p2p/rfqs/$rfqId/upload-po',
          data: formData({'tally_po_no': tallyNo.text.trim(), 'details': jsonText(details), 'file': file}));
    },
  );
}

// ── Delivery costs & landed cost (portal PoDeliveryCostsPanel) ───────────────

class DeliveryCostsSection extends StatefulWidget {
  const DeliveryCostsSection({super.key, required this.poId, this.onChanged});
  final int poId;
  final VoidCallback? onChanged;

  @override
  State<DeliveryCostsSection> createState() => _DeliveryCostsSectionState();
}

class _DeliveryCostsSectionState extends State<DeliveryCostsSection> {
  Json? _view;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final v = asJson(await Api.get('/p2p/purchase-orders/${widget.poId}/charges'));
      if (mounted) setState(() => _view = v);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _add() async {
    final view = _view!;
    final voucher = !jBool(view, 'editable');
    final meta = asJson(view['meta']);
    var type = 'freight';
    var basis = 'value';
    final amount = TextEditingController();
    final gst = TextEditingController();
    final desc = TextEditingController();
    final bill = TextEditingController();
    DateTime? date;
    final ok = await showFormSheet(
      context,
      title: voucher ? 'Post landed-cost voucher' : 'Add delivery cost',
      saveLabel: voucher ? 'Post voucher' : 'Add',
      builder: (ctx, setS) => [
        Hint(voucher
            ? 'A cost billed after receipt — posted into the stock still on hand.'
            : 'A planned cost — spread over the stock lines; every GRN is valued at the landed rate.'),
        AppSelect<String>(
          label: voucher ? 'Cost billed after receipt' : 'Planned cost',
          required: true,
          value: type,
          clearable: false,
          options: [for (final o in jList(meta, 'charge_types')) Option(jStr(o, 'value') ?? '', jStr(o, 'label') ?? '')],
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        AppSelect<String>(
          label: 'Apportion',
          value: basis,
          clearable: false,
          options: [for (final o in jList(meta, 'bases')) Option(jStr(o, 'value') ?? '', jStr(o, 'label') ?? '')],
          onChanged: (o) => setS(() => basis = o?.value ?? basis),
        ),
        AppTextField(label: 'Description', controller: desc),
        AppTextField(label: 'Amount (₹, excl. GST)', required: true, controller: amount, keyboardType: AppTextField.number),
        AppTextField(label: 'GST %', controller: gst, keyboardType: AppTextField.number),
        const Hint('GST is input credit and is never loaded into the stock value.'),
        if (voucher) ...[
          AppTextField(label: 'Bill / BOE ref.', controller: bill),
          DateField(label: 'Voucher date', value: date, onChanged: (d) => setS(() => date = d)),
        ],
      ],
      onSave: () async {
        final payload = {
          'charge_type': type,
          'basis': basis,
          'amount': double.tryParse(amount.text) ?? 0,
          'gst_rate': gst.text.trim().isEmpty ? null : double.tryParse(gst.text),
          'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
        };
        if (voucher) {
          await Api.post('/p2p/purchase-orders/${widget.poId}/landed-cost-vouchers', data: {
            ...payload,
            'bill_reference': bill.text.trim().isEmpty ? null : bill.text.trim(),
            'voucher_date': date == null ? null : apiDate(date!),
          });
        } else {
          await Api.post('/p2p/purchase-orders/${widget.poId}/charges', data: payload);
        }
      },
    );
    if (ok) {
      await _load();
      widget.onChanged?.call();
    }
  }

  Future<void> _remove(int id) async {
    final yes = await confirmDialog(context,
        title: 'Remove delivery cost',
        message: 'Remove this planned delivery cost from the PO? The landed rate of its lines is recalculated.',
        confirmLabel: 'Remove',
        danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.delete('/p2p/purchase-orders/${widget.poId}/charges/$id'));
    if (ok) _load();
  }

  @override
  Widget build(BuildContext context) {
    final view = _view;
    if (view == null) {
      return _error == null
          ? const SizedBox.shrink()
          : DetailSection('Delivery costs & landed cost', children: [ErrorBanner(ApiClient.describe(_error!))]);
    }
    final canEdit = P2pAccess.can('purchase_orders', 'edit') && P2pAccess.feat('purchase_orders', 'delivery_costs', 'create');
    final canRemove = P2pAccess.can('purchase_orders', 'edit') && P2pAccess.feat('purchase_orders', 'delivery_costs', 'delete');
    final editable = jBool(view, 'editable');
    return DetailSection('Delivery costs & landed cost', children: [
      const Hint('Amounts before GST. Planned costs are spread over the stock lines and every GRN is valued at the landed rate; '
          'a cost billed after receipt is posted as a landed-cost voucher into the stock still on hand. GST is input credit and is never loaded.'),
      const SizedBox(height: 8),
      for (final c in jList(view, 'charges'))
        InnerCard(children: [
          Text('${c['charge_label']}${jStr(c, 'description') != null ? ' — ${c['description']}' : ''}',
              style: const TextStyle(fontWeight: FontWeight.w600)),
          MiniGrid([
            MiniField('Basis', jStr(c, 'basis') == 'quantity' ? 'By quantity' : 'By value'),
            MiniField('Amount', money(c['amount'])),
            MiniField('GST (credit)', c['gst_rate'] != null ? '${c['gst_rate']}%' : '—'),
          ]),
          if (editable && canRemove) Align(alignment: Alignment.centerRight, child: linkBtn('Remove', () => _remove(jInt(c, 'id')!), color: Brand.danger)),
        ]),
      for (final l in jList(view, 'lines'))
        InnerCard(children: [
          Text('${jStr(l, 'item_code') != null ? '${l['item_code']} · ' : ''}${l['item_name']}'
              '${jStr(l, 'category') != 'stock' ? ' (${l['category']} — not loaded)' : ''}'),
          MiniGrid([
            MiniField('Qty', '${fmtQty(l['quantity'])} ${jStr(l, 'unit') ?? ''}'),
            MiniField('PO rate', money(l['po_rate'])),
            MiniField('Delivery cost', money(l['allocated'])),
            MiniField('Landed rate', money(l['landed_rate'])),
          ]),
        ]),
      for (final v in jList(view, 'vouchers'))
        InnerCard(children: [
          Text('${v['voucher_number']}${jStr(v, 'bill_reference') != null ? ' · ${v['bill_reference']}' : ''}',
              style: const TextStyle(fontWeight: FontWeight.w600)),
          MiniGrid([
            MiniField('Date', fmtDate(v['voucher_date'])),
            MiniField('Cost', jStr(v, 'charge_label')),
            MiniField('Amount', money(v['amount'])),
            MiniField('Into stock', money(v['value_to_stock'])),
            MiniField('Consumed share', money(v['value_to_consumption'])),
          ]),
        ]),
      if (canEdit) primaryBtn(editable ? '+ Add delivery cost' : '+ Post landed-cost voucher', _add),
    ]);
  }
}

// ── Service entries (portal ServiceEntriesPanel) ─────────────────────────────

const _sesLabels = {'draft': 'Awaiting acceptance', 'accepted': 'Accepted', 'cancelled': 'Cancelled'};
const _sesHex = {'draft': 0xFFD97706, 'accepted': 0xFF16A34A, 'cancelled': 0xFF6B7280};

class ServiceEntriesSection extends StatefulWidget {
  const ServiceEntriesSection({super.key, required this.poId, required this.poOpen, this.onChanged});
  final int poId;
  final bool poOpen;
  final VoidCallback? onChanged;

  @override
  State<ServiceEntriesSection> createState() => _ServiceEntriesSectionState();
}

class _ServiceEntriesSectionState extends State<ServiceEntriesSection> {
  List<Json> _lines = [];
  List<Json> _entries = [];
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = asJson(await Api.get('/p2p/purchase-orders/${widget.poId}/service-entries'));
      if (mounted) {
        setState(() {
          _lines = jList(d, 'service_lines');
          _entries = jList(d, 'entries');
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _changed() {
    _load();
    widget.onChanged?.call();
  }

  Future<void> _record() async {
    final open = _lines.where((l) => jD(l, 'open_quantity') > 0).toList();
    int? lineId;
    final qty = TextEditingController();
    final desc = TextEditingController();
    DateTime? date;
    DateTime? from;
    DateTime? to;
    final ok = await showFormSheet(
      context,
      title: 'Record service entry',
      saveLabel: 'Record',
      builder: (ctx, setS) => [
        const Hint("What the vendor did — once accepted it counts as received and the vendor's bill is matched against it."),
        AppSelect<int>(
          label: 'Service line',
          required: true,
          value: lineId,
          options: [
            for (final l in open)
              Option(jInt(l, 'po_item_id')!, '${l['item_name']} (${fmtQty(l['open_quantity'])} ${jStr(l, 'unit') ?? ''} open)'),
          ],
          onChanged: (o) => setS(() => lineId = o?.value),
        ),
        AppTextField(label: 'Quantity', required: true, controller: qty, keyboardType: AppTextField.number),
        AppTextField(label: 'What was done', controller: desc, hint: 'e.g. Q3 AMC visit, calibration cert. no.'),
        DateField(label: 'Service date', value: date, onChanged: (d) => setS(() => date = d)),
        DateField(label: 'Period from', value: from, onChanged: (d) => setS(() => from = d)),
        DateField(label: 'Period to', value: to, onChanged: (d) => setS(() => to = d)),
      ],
      onSave: () async {
        if (lineId == null) throw 'Pick the service line this entry is for.';
        if (!((double.tryParse(qty.text) ?? 0) > 0)) throw 'Enter how much of the service was done — the quantity must be more than 0.';
        await Api.post('/p2p/purchase-orders/${widget.poId}/service-entries', data: {
          'po_item_id': lineId,
          'quantity': double.parse(qty.text),
          'service_date': date == null ? null : apiDate(date!),
          'period_from': from == null ? null : apiDate(from!),
          'period_to': to == null ? null : apiDate(to!),
          'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
        });
      },
    );
    if (ok) _changed();
  }

  Future<void> _accept(Json e) async {
    final yes = await confirmDialog(context,
        title: 'Accept service entry',
        message: 'Accept ${e['ses_number']} (${fmtQty(e['quantity'])} ${jStr(e, 'unit') ?? ''} of ${e['item_name']})? '
            "It then counts as received on the PO and the vendor's bill is matched against it.",
        confirmLabel: 'Accept');
    if (!yes || !mounted) return;
    if (await runAction(context, () => Api.post('/p2p/service-entries/${e['id']}/accept'), success: 'Service entry accepted.')) _changed();
  }

  Future<void> _cancel(Json e) async {
    final reason = await promptDialog(context,
        title: 'Cancel service entry',
        message: '${e['ses_number']} · ${fmtQty(e['quantity'])} ${jStr(e, 'unit') ?? ''} of ${e['item_name'] ?? ''}\nThis is kept on the PO history.',
        label: 'Why is it being cancelled?',
        confirmLabel: 'Cancel entry');
    if (reason == null || !mounted) return;
    if (await runAction(context, () => Api.post('/p2p/service-entries/${e['id']}/cancel', data: {'reason': reason}),
        success: 'Service entry cancelled.')) {
      _changed();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_lines.isEmpty && _entries.isEmpty && _error == null) return const SizedBox.shrink();
    final canCreate = widget.poOpen && P2pAccess.can('purchase_orders', 'create') && P2pAccess.feat('purchase_orders', 'service_entries', 'create');
    final canAccept = P2pAccess.can('purchase_orders', 'approve') && P2pAccess.feat('purchase_orders', 'service_entries', 'approve');
    final canCancel = P2pAccess.can('purchase_orders', 'cancel') && P2pAccess.feat('purchase_orders', 'service_entries', 'cancel');
    return DetailSection('Service Entries', children: [
      const Hint('Service lines are not received on a GRN or into store stock. Record what the vendor did; once accepted it counts as received '
          "and the vendor's bill is matched against it."),
      if (_error != null) ErrorBanner(ApiClient.describe(_error!)),
      const SizedBox(height: 8),
      for (final l in _lines)
        InnerCard(children: [
          Text('${jStr(l, 'item_code') != null ? '${l['item_code']} — ' : ''}${l['item_name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
          MiniGrid([
            MiniField('Ordered', '${fmtQty(l['ordered_quantity'])} ${jStr(l, 'unit') ?? ''}'),
            MiniField('Accepted', fmtQty(l['accepted_quantity'])),
            MiniField('Awaiting acceptance', fmtQty(l['pending_entry_quantity'])),
            MiniField('Open', fmtQty(l['open_quantity'])),
          ]),
        ]),
      if (canCreate && _lines.any((l) => jD(l, 'open_quantity') > 0)) primaryBtn('+ Record service entry', _record),
      for (final e in _entries)
        InnerCard(children: [
          Row(children: [
            Expanded(child: Text('${e['ses_number']}', style: const TextStyle(fontWeight: FontWeight.w700))),
            Pill(_sesLabels[jStr(e, 'status')] ?? '${e['status']}', Color(_sesHex[jStr(e, 'status')] ?? 0xFF78716C)),
          ]),
          Text('${e['item_name'] ?? ''}${jStr(e, 'description') != null ? ' — ${e['description']}' : ''}'),
          MiniGrid([
            MiniField('Qty', '${fmtQty(e['quantity'])} ${jStr(e, 'unit') ?? ''}'),
            MiniField('Date / Period', '${fmtDate(e['service_date'])}'
                '${e['period_from'] != null || e['period_to'] != null ? '\n${fmtDate(e['period_from'])} – ${fmtDate(e['period_to'])}' : ''}'),
            MiniField('Recorded By', '${jStr(e, 'created_by_name') ?? '—'}${jStr(e, 'accepted_by_name') != null ? '\nAccepted by ${e['accepted_by_name']}' : ''}'),
          ]),
          if (jStr(e, 'cancel_reason') != null) Hint('${e['cancel_reason']}'),
          Wrap(spacing: 8, children: [
            if (jStr(e, 'status') == 'draft' && canAccept) secondaryBtn('Accept', () => _accept(e)),
            if (jStr(e, 'status') != 'cancelled' && canCancel) dangerBtn('Cancel', () => _cancel(e)),
          ]),
        ]),
    ]);
  }
}

/// JSON text for a multipart field.
String jsonText(Object? v) => jsonEncode(v);
