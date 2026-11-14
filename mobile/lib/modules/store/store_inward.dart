import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'store_common.dart';
import 'store_widgets.dart';

export 'store_grn.dart' show GrnTab;

// Inward: Before PO and Returns (portal: store/before-po,
// BeforePOReceiptForm / Detail, PrePoAttachments, returns, returns/new,
// returns/[id]). GRN lives in store_grn.dart.

// ── Before PO ────────────────────────────────────────────────────────────────

const _bpoLabel = {'pending_po': 'PO pending', 'po_created': 'PO created', 'closed': 'Closed', 'cancelled': 'Cancelled'};
const _bpoColor = {'pending_po': Color(0xFFEA580C), 'po_created': cBlue, 'closed': cGreen, 'cancelled': Color(0xFF78716C)};
const _bpoNote =
    "Goods go into stock as soon as a receipt is saved — Free stock, or Quality stock for items that need a quality check — so they can be issued straight away. The GRN against Procurement's PO later settles the receipt; stock is not added a second time.";
const _bpoFormNote =
    'Goods go into stock as soon as this is saved — Free stock, or Quality stock for items that need a quality check. Rate is optional; the PO rate replaces it when the PO is received.';
const _docLabel = {'invoice': 'Invoice', 'challan': 'Challan', 'other': 'Other'};

bool get _bpoCanCreate => can('grn', 'create') && canFeature('grn', 'before_po', 'create');

class BeforePoTab extends StatefulWidget {
  const BeforePoTab({super.key});

  @override
  State<BeforePoTab> createState() => _BeforePoTabState();
}

class _BeforePoTabState extends State<BeforePoTab> {
  final _list = GlobalKey<ApiListViewState>();
  List<Json> _all = const [];
  String? _status;

  @override
  Widget build(BuildContext context) {
    if (!(can('grn', 'view') && canFeature('grn', 'before_po', 'view'))) {
      return const EmptyView("You don't have access to Before PO receipts — ask an admin to give you View on Store › GRN.");
    }
    return Scaffold(
      floatingActionButton: _bpoCanCreate
          ? CreateFab(
              label: 'Before PO receipt',
              onPressed: () async {
                final r = await openBeforePoForm(context);
                if (r != null && context.mounted) {
                  _list.currentState?.reload();
                  openScreen(context, BeforePoDetailScreen(receiptId: toInt(r['id'])!));
                }
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Receipt no., vendor, PO, item...',
        load: (page, q) async {
          final rows = (await Api.list('/store/pre-po-receipts')).rows
            ..sort((a, b) => '${a['receipt_number']}'.compareTo('${b['receipt_number']}'));
          _all = rows;
          if (mounted) setState(() {});
          final ql = q.toLowerCase();
          bool hit(Json r) => [
                r['receipt_number'],
                r['vendor_name'],
                r['po_number'],
                r['p2p_number'],
                r['delivery_challan_number'],
                r['vendor_invoice_number'],
                ...jsonList(r['items']).map((i) => i['item_name']),
              ].any((x) => '${x ?? ''}'.toLowerCase().contains(ql));
          return ApiPage(rows.where((r) => (_status == null || r['status'] == _status) && (ql.isEmpty || hit(r))).toList());
        },
        emptyText: _all.isEmpty
            ? 'No Before PO receipts yet. When goods arrive and no PO exists, record them with + Before PO receipt.'
            : 'No receipt matches the search or the selected count — change the search, or tap the highlighted count again to show all.',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const StorePageHeader('Before PO',
              subtitle:
                  'Material that arrived before its purchase order — already in stock. Procurement makes the PO from these receipts.'),
          if (!_bpoCanCreate)
            const Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Hint('Recording a receipt (it adds stock) needs Create permission on GRN.')),
          const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 4), child: InfoNote(_bpoNote, color: Color(0xFFEA580C))),
          ChipRow([
            for (final s in const ['pending_po', 'po_created', 'closed'])
              CountChip(_bpoLabel[s]!, _all.where((r) => r['status'] == s).length,
                  color: _bpoColor[s], selected: _status == s, onTap: () {
                setState(() => _status = _status == s ? null : s);
                _list.currentState?.reload();
              }),
          ]),
        ]),
        itemBuilder: (ctx, r, reload) {
          final items = jsonList(r['items']);
          final docs = [
            if (r['delivery_challan_number'] != null) 'Challan ${r['delivery_challan_number']}',
            if (r['vendor_invoice_number'] != null) 'Invoice ${r['vendor_invoice_number']}',
          ].join(' · ');
          return RecordCard(
            code: txt(r['receipt_number']),
            title: txt(r['vendor_name']),
            subtitle:
                '${items.length} · ${items.take(2).map((i) => i['item_name']).join(', ')}${items.length > 2 ? ' +${items.length - 2} more' : ''}',
            trailing: pill(_bpoLabel[r['status']] ?? humanize(r['status']), _bpoColor[r['status']] ?? cGrey),
            meta: [
              ('Received on', fmtDate(r['received_date'])),
              ('Challan / Invoice', docs.isEmpty ? '—' : docs),
              ('PO', txt(r['po_number'])),
            ],
            onTap: () => openThen(ctx, BeforePoDetailScreen(receiptId: toInt(r['id'])!), reload),
          );
        },
      ),
    );
  }
}

class _BpoLine {
  int? itemId;
  final invoiceName = TextEditingController();
  final qty = TextEditingController();
  final rate = TextEditingController();
  final remarks = TextEditingController();
}

// Item types a Before PO receipt may carry: the "stock" purpose's types;
// types Store added beyond the standard five stay offered.
const _standardTypes = ['material', 'service', 'asset', 'consumable', 'tool_equipment'];
const _stockTypes = ['material', 'consumable', 'tool_equipment'];
bool _typeFits(Object? t) => !_standardTypes.contains(t ?? '') || _stockTypes.contains(t ?? '');

Future<Json?> openBeforePoForm(BuildContext context) async {
  List<Json> vendors, locations;
  try {
    vendors = (await Api.list('/store/material-issues/lookups/vendors')).rows
      ..sort((a, b) => '${a['label']}'.compareTo('${b['label']}'));
    await StoreData.items(activeOnly: true);
    locations = (await StoreData.locations()).where((l) => l['is_active'] != false).toList();
  } catch (e) {
    if (context.mounted) {
      showSnack(context, 'Could not load the form — close it and open it again. ${ApiClient.describe(e)}', error: true);
    }
    return null;
  }
  if (!context.mounted) return null;
  // A store person books into their own store only (the server enforces it
  // too): the stores they manage, else the stores of their plant. Admins pick any.
  final isAdmin = Perm.user['role'] == 'admin';
  final managed = locations.where((l) => l['manager_user_id'] != null && l['manager_user_id'] == Perm.userId).toList();
  final own = isAdmin ? locations : (managed.isNotEmpty ? managed : locations);
  final locked = !isAdmin && own.length == 1 ? own.first : null;
  int? vendor;
  DateTime received = DateTime.now();
  int? loc = toInt(locked?['id']);
  // Tax invoice or delivery challan — only the chosen document's fields show and are saved.
  String docType = 'invoice';
  final challan = TextEditingController(), invoice = TextEditingController(), remarks = TextEditingController();
  DateTime? invoiceDate, challanDate;
  MultipartFile? invoiceFile, challanFile;
  final lines = <_BpoLine>[_BpoLine()];
  Json? saved;

  Widget lineBox(int i, StateSetter setS) {
    final l = lines[i];
    final it = l.itemId == null ? null : StoreData.itemById[l.itemId];
    final used = {for (final x in lines) if (x != l && x.itemId != null) x.itemId};
    final tech = it == null ? '' : '${it['specification'] ?? it['description'] ?? '—'}';
    return LineBox(
      key: ObjectKey(l),
      title: 'Line ${i + 1}',
      onRemove: lines.length == 1 ? null : () => setS(() => lines.remove(l)),
      children: [
        // One search over every stock item (code, name and technical details).
        ItemSelect(
          label: 'Item (Item Master)',
          activeOnly: true,
          value: l.itemId,
          where: (x) => !used.contains(toInt(x['id'])) && _typeFits(x['item_type']),
          onChanged: (x) => setS(() => l.itemId = toInt(x?['id'])),
        ),
        AppTextField(
            key: ValueKey('tech-${l.itemId}'),
            label: 'Technical details',
            initialValue: tech,
            enabled: false,
            hint: 'Shows after the item is picked'),
        AppTextField(label: 'Name on invoice', controller: l.invoiceName, hint: 'As written on the bill'),
        AppTextField(
            label: 'Quantity${it?['uom'] != null ? ' (${it!['uom']})' : ''}',
            required: true,
            controller: l.qty,
            keyboardType: AppTextField.number),
        AppTextField(label: 'Rate (₹/unit)', controller: l.rate, keyboardType: AppTextField.number, hint: 'If known'),
        AppTextField(label: 'Remarks', controller: l.remarks),
      ],
    );
  }

  final ok = await showFormSheet(
    context,
    title: 'Before PO receipt',
    saveLabel: 'Save receipt',
    builder: (ctx, setS) => [
      const Hint('Goods that arrived before their purchase order'),
      const InfoNote(_bpoFormNote, color: Color(0xFFEA580C)),
      const FormHeading('Receipt'),
      AppSelect<int>(
          label: 'Vendor',
          required: true,
          value: vendor,
          options: idLabelOptions(vendors),
          onChanged: (o) => setS(() => vendor = o?.value)),
      DateField(
          label: 'Received on', required: true, value: received, onChanged: (d) => setS(() => received = d ?? received)),
      if (locked != null)
        AppTextField(label: 'Store', initialValue: txt(locked['name']), enabled: false)
      else
        LocationSelect(
            label: 'Store (the goods go into)',
            only: own,
            value: loc,
            onChanged: (l) => setS(() => loc = toInt(l?['id']))),
      AppTextField(
          label: 'Remarks',
          controller: remarks,
          maxLines: 3,
          hint: 'Condition on arrival, who brought it, why there is no PO yet…'),
      const FormHeading('Vendor Documents'),
      const Caps('Goods came with'),
      ChipRow([
        for (final (v, label) in const [('invoice', 'Tax Invoice'), ('challan', 'Delivery Challan')])
          CountChip(label, null, selected: docType == v, onTap: () => setS(() => docType = v)),
      ]),
      if (docType == 'invoice') ...[
        AppTextField(label: 'Invoice no.', controller: invoice, hint: 'As on the bill'),
        DateField(label: 'Invoice date', value: invoiceDate, onChanged: (d) => setS(() => invoiceDate = d)),
        PillButton(invoiceFile == null ? 'Invoice file' : 'Invoice: ${invoiceFile!.filename}',
            icon: Icons.attach_file_rounded,
            onPressed: () async {
              final f = await Files.pickFile(extensions: const ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx']);
              if (f != null) setS(() => invoiceFile = f);
            }),
      ] else ...[
        AppTextField(label: 'Delivery challan no.', controller: challan),
        DateField(label: 'Challan date', value: challanDate, onChanged: (d) => setS(() => challanDate = d)),
        PillButton(challanFile == null ? 'Challan file' : 'Challan: ${challanFile!.filename}',
            icon: Icons.attach_file_rounded,
            onPressed: () async {
              final f = await Files.pickFile(extensions: const ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx']);
              if (f != null) setS(() => challanFile = f);
            }),
      ],
      const Hint('Procurement sees the file on the PO. More can be attached later from the receipt.'),
      FormHeading('Items received (${lines.length})'),
      for (var i = 0; i < lines.length; i++) lineBox(i, setS),
      AddLineButton('Add line', onPressed: () => setS(() => lines.add(_BpoLine()))),
      const Hint(
          "Search the Item Master item by code, name or technical details, so Procurement's PO carries the same item. An item can be on one line only. Batch- or serial-controlled items cannot be booked here — record those with a GRN after the PO."),
    ],
    onSave: () async {
      if (vendor == null) throw 'Pick the vendor the goods came from — Procurement makes the PO to this vendor.';
      if (locked == null && loc == null) {
        throw own.isNotEmpty
            ? "Pick the store the goods went into — the receipt puts them into that store's stock."
            : 'No store is linked to you, so goods cannot be booked. Ask an admin to make you the manager of your store in Store › Settings › Stores.';
      }
      final day = DateTime(received.year, received.month, received.day);
      if (docType == 'challan' && challanDate != null && challanDate!.isAfter(day)) {
        throw 'The challan date is after the date the goods were received — check the date printed on the delivery challan, or correct the Received on date.';
      }
      if (docType == 'invoice' && invoiceDate != null && invoiceDate!.isAfter(day)) {
        throw "The invoice date is after the date the goods were received — check the date printed on the vendor's bill, or correct the Received on date.";
      }
      final filled = lines.where((l) => l.itemId != null || l.qty.text.trim().isNotEmpty).toList();
      if (filled.isEmpty) throw 'Add at least one item with its quantity.';
      for (final l in filled) {
        final name = l.itemId == null ? 'A line' : txt(StoreData.itemById[l.itemId]?['item_name']);
        if (l.itemId == null) throw 'Pick the Item Master item on every line, or remove the empty line.';
        if ((parseNum(l.qty.text) ?? 0) <= 0) throw '$name: enter the quantity received (above 0).';
        if (l.rate.text.trim().isNotEmpty && (parseNum(l.rate.text) ?? 0) <= 0) {
          throw '$name: the rate must be more than 0 — or leave it blank if you do not know it yet.';
        }
      }
      saved = jsonMap(await Api.post('/store/pre-po-receipts', data: {
        'vendor_id': vendor,
        'received_date': apiDate(received),
        'store_location_id': loc,
        'delivery_challan_number': docType == 'challan' ? blankToNull(challan.text) : null,
        'delivery_challan_date': docType == 'challan' && challanDate != null ? apiDate(challanDate!) : null,
        'vendor_invoice_number': docType == 'invoice' ? blankToNull(invoice.text) : null,
        'vendor_invoice_date': docType == 'invoice' && invoiceDate != null ? apiDate(invoiceDate!) : null,
        'remarks': blankToNull(remarks.text),
        'items': [
          for (final l in filled)
            {
              'store_item_id': l.itemId,
              'quantity': parseNum(l.qty.text),
              'unit_rate': parseNum(l.rate.text),
              'remarks': blankToNull(l.remarks.text),
              'invoice_item_name': blankToNull(l.invoiceName.text),
            },
        ],
      }));
    },
  );
  if (!ok || saved == null) return null;
  // The chosen document's file goes up after the receipt exists; a failed upload doesn't undo it.
  final notes = <String>[];
  final file = docType == 'invoice' ? invoiceFile : challanFile;
  if (file != null) {
    try {
      await uploadMultipart('/store/pre-po-receipts/${saved!['id']}/attachments', file, fields: {'doc_type': docType});
    } catch (e) {
      notes.add('${file.filename}: ${ApiClient.describe(e)}');
    }
  }
  if (notes.isNotEmpty && context.mounted) {
    await messageDialog(context, 'File Not Attached',
        '${txt(saved!['receipt_number'])} is saved, but a file could not be attached — ${notes.join(' ')} Open the receipt and attach it again.');
  }
  return saved;
}

class BeforePoDetailScreen extends StatefulWidget {
  const BeforePoDetailScreen({super.key, required this.receiptId});
  final int receiptId;

  @override
  State<BeforePoDetailScreen> createState() => _BeforePoDetailScreenState();
}

class _BeforePoDetailScreenState extends State<BeforePoDetailScreen> {
  int _v = 0;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        key: ValueKey(_v),
        load: () async => jsonMap(await Api.get('/store/pre-po-receipts/${widget.receiptId}')),
        builder: (ctx, r, reload) {
          final pending = r['status'] == 'pending_po';
          final open = r['status'] != 'cancelled';
          final posted = r['stock_posted'] == true;
          final items = jsonList(r['items']);
          final base = '/store/pre-po-receipts/${r['id']}';
          String stockText(Json i) => i['receipt_posting'] == 'quality'
              ? 'Quality${i['inspection_lot_number'] != null ? ' — ${i['inspection_lot_number']}' : ''}'
              : (i['receipt_posting'] == 'free' ? 'Free stock' : '—');
          Future<void> attach(String type) async {
            final res = await pickAndUpload(ctx, '$base/attachments', fields: {'doc_type': type});
            if (res != null) setState(() => _v++);
          }

          Future<void> remove(Json a) async {
            final ok = await confirmDialog(ctx,
                title: 'Delete this file?',
                message: '${a['filename']} will be removed from the receipt.',
                confirmLabel: 'Delete',
                danger: true);
            if (!ok || !ctx.mounted) return;
            final done = await runAction(ctx, () => Api.delete('$base/attachments/${a['id']}'));
            if (done) setState(() => _v++);
          }

          return SubPage(
            title: txt(r['receipt_number']),
            bottom: pending && _bpoCanCreate
                ? ActionBar([
                    secondaryAction('Cancel receipt', () async {
                      final reason = await promptDialog(ctx,
                          title: 'Cancel ${txt(r['receipt_number'])}?',
                          message: posted
                              ? "The receipt leaves Procurement's Before PO list and its stock is taken back out of the store. This is refused if any of it was already issued — return it to the store first — or if a quality lot has no decision yet. Give the reason, e.g. goods returned to the vendor."
                              : "The receipt leaves Procurement's Before PO list. Give the reason, e.g. goods returned to the vendor.",
                          label: 'Why is this receipt being cancelled?',
                          confirmLabel: 'Cancel receipt');
                      if (reason == null || !ctx.mounted) return;
                      final ok = await runAction(ctx, () => Api.post('$base/cancel', data: {'reason': reason}));
                      if (ok) setState(() => _v++);
                    }, color: cRed),
                  ])
                : null,
            body: detailList([
              SummaryCard(
                title: txt(r['receipt_number']),
                text: '${txt(r['vendor_name'])} · received ${fmtDate(r['received_date'])}',
                badges: [
                  pill(_bpoLabel[r['status']] ?? humanize(r['status']), _bpoColor[r['status']] ?? cGrey),
                  if (posted && open) pill('In stock', cGreen),
                ],
              ),
              if (r['status'] == 'cancelled' && r['cancel_reason'] != null)
                Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: InfoNote('Cancelled — ${r['cancel_reason']}', color: cRed)),
              if (pending && !_bpoCanCreate)
                const Padding(
                    padding: EdgeInsets.fromLTRB(16, 0, 16, 12), child: Hint('Cancelling needs Create permission on GRN.')),
              DetailSection('Receipt', children: [
                FieldRow('Vendor', r['vendor_name']),
                FieldRow('Received on', fmtDate(r['received_date'])),
                FieldRow('Store location', r['store_location_name']),
                FieldRow('Delivery challan no.', r['delivery_challan_number']),
                FieldRow('Vendor invoice no.', r['vendor_invoice_number']),
                FieldRow('Recorded by', r['created_by_name']),
                FieldRow('Purchase request', r['p2p_number']),
                FieldRow('Purchase order',
                    r['po_number'] == null ? null : '${r['po_number']}${r['po_status'] != null ? ' · ${humanize(r['po_status'])}' : ''}'),
                if (r['remarks'] != null) FieldRow('Remarks', r['remarks']),
              ]),
              DetailSection('Items received (${items.length})', children: [
                for (final i in items)
                  LineTile(
                    title: '${txt(i['item_code'])} — ${txt(i['item_name'])}',
                    trailing: fmtQ(i['quantity'], i['unit']),
                    subtitle: i['invoice_item_name'] != null ? 'On invoice: ${i['invoice_item_name']}' : null,
                    facts: [
                      if (items.any((x) => x['unit_rate'] != null))
                        MiniFact('Rate', i['unit_rate'] != null ? fmtMoney(i['unit_rate']) : '—'),
                      if (posted) MiniFact('Stock', stockText(i)),
                      if (posted) MiniFact('Settled by GRN', '${fmtQ(i['settled_qty'] ?? 0)} of ${fmtQ(i['quantity'])}'),
                      MiniFact('Remarks', txt(i['remarks'])),
                    ],
                  ),
              ]),
              DetailSection('Invoice & challan files', children: [
                if (jsonList(r['attachments']).isEmpty) const Hint('No invoice or challan attached yet.'),
                for (final a in jsonList(r['attachments']))
                  LineTile(
                    title: txt(a['filename']),
                    subtitle: [
                      _docLabel[a['doc_type']] ?? txt(a['doc_type']),
                      if (a['uploaded_by_name'] != null) '${a['uploaded_by_name']}',
                      if (a['created_at'] != null) fmtDateTime(a['created_at']),
                    ].join(' · '),
                    extra: Wrap(spacing: 8, children: [
                      TextButton(
                          onPressed: () => openApiFile(ctx, '$base/attachments/${a['id']}/content', txt(a['filename'])),
                          child: const Text('View / Download')),
                      if (open &&
                          r['status'] != 'closed' &&
                          (a['uploaded_by_id'] == null || a['uploaded_by_id'] == Perm.userId))
                        TextButton(onPressed: () => remove(a), child: const Text('Delete', style: TextStyle(color: cRed))),
                    ]),
                  ),
                if (_bpoCanCreate && open) ...[
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 8, children: [
                    PillButton('Attach invoice', icon: Icons.upload_rounded, onPressed: () => attach('invoice')),
                    PillButton('Attach challan', icon: Icons.upload_rounded, onPressed: () => attach('challan')),
                  ]),
                ] else if (open)
                  const Hint('Attaching files needs Create permission on GRN.'),
              ]),
            ]),
          );
        },
      );
}

// ── Returns ──────────────────────────────────────────────────────────────────

const _retLabel = {'pending_approval': 'Pending Approval', 'approved': 'Approved', 'rejected': 'Rejected', 'cancelled': 'Withdrawn'};
const _retColor = {'pending_approval': cAmber, 'approved': cGreen, 'rejected': cRed, 'cancelled': Color(0xFF78716C)};
const _ruleLabel = {'warehouse_manager': 'Store in-charge', 'department_head': 'Department head', 'specific_users': 'Designated approver'};

class ReturnsTab extends StatefulWidget {
  const ReturnsTab({super.key});

  @override
  State<ReturnsTab> createState() => _ReturnsTabState();
}

class _ReturnsTabState extends State<ReturnsTab> {
  final _list = GlobalKey<ApiListViewState>();
  List<Json> _all = const [];
  String? _status;

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('returns', 'create')
            ? CreateFab(
                label: 'New Return',
                onPressed: () async {
                  final r = await openReturnForm(context);
                  if (r != null && context.mounted) {
                    _list.currentState?.reload();
                    openScreen(context, ReturnDetailScreen(returnId: toInt(r['id'])!));
                  }
                })
            : null,
        body: ApiListView(
          key: _list,
          load: (page, s) async {
            final p = await Api.list('/store/material-returns');
            _all = p.rows;
            if (mounted) setState(() {});
            return ApiPage(_status == null ? p.rows : p.rows.where((r) => r['status'] == _status).toList());
          },
          emptyText: _status != null
              ? 'No returns in this status — tap the chip again to show all.'
              : 'No material returns yet${can('returns', 'create') ? ' — use + New Return when material comes back to a store.' : '.'}',
          header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const StorePageHeader('Material Returns',
                subtitle: 'Unused or faulty material coming back into a store; it posts to stock once approved.'),
            ChipRow([
              for (final e in _retLabel.entries)
                CountChip(e.value, _all.where((r) => r['status'] == e.key).length,
                    color: _retColor[e.key], selected: _status == e.key, onTap: () {
                  setState(() => _status = _status == e.key ? null : e.key);
                  _list.currentState?.reload();
                }),
            ]),
          ]),
          itemBuilder: (ctx, r, reload) => RecordCard(
            code: txt(r['return_number']),
            title: txt(r['location_name']),
            subtitle: txt(r['source_issue_number'] ?? r['source_description'] ?? r['source_type_label']),
            trailing: pill('${_retLabel[r['status']] ?? humanize(r['status'])}${r['can_act'] == true ? ' · your action' : ''}',
                _retColor[r['status']] ?? cGrey),
            meta: [('Date', fmtDate(r['return_date'])), ('Items', '${jsonList(r['items']).length}')],
            onTap: () => openThen(ctx, ReturnDetailScreen(returnId: toInt(r['id'])!), reload),
          ),
        ),
      );
}

class _RetLine {
  int? itemId;
  final qty = TextEditingController();
  String? condition;
  final batch = TextEditingController();
}

Json? _byValue(List<Json> rows, Object? v) {
  for (final r in rows) {
    if (r['value'] == v) return r;
  }
  return null;
}

Future<Json?> openReturnForm(BuildContext context) async {
  List<Json> issues, departments, sources, conditions;
  try {
    final r = await Future.wait<Object>([
      Api.list('/store/material-issues'),
      Api.list('/organization/departments'),
      docTypes('return_source'),
      docTypes('return_condition'),
    ]);
    issues = (r[0] as ApiPage).rows;
    departments = (r[1] as ApiPage).rows;
    sources = r[2] as List<Json>;
    conditions = r[3] as List<Json>;
  } catch (e) {
    if (context.mounted) showSnack(context, "Couldn't load the form data: ${ApiClient.describe(e)}", error: true);
    return null;
  }
  if (!context.mounted) return null;
  int? loc;
  String? sourceType = sources.isEmpty ? null : '${sources.first['value']}';
  int? issueId;
  int? dept;
  final sourceDesc = TextEditingController(), reason = TextEditingController(), remarks = TextEditingController();
  final defCond = conditions.isEmpty ? null : '${conditions.first['value']}';
  final lines = <_RetLine>[_RetLine()..condition = defCond];
  List<Json> usedTypes() => [
        ?_byValue(sources, sourceType),
        for (final c in {for (final l in lines) if (l.itemId != null) l.condition}) ?_byValue(conditions, c),
      ].where((t) => t['approver_rule'] != 'none').toList();

  Json? saved;
  final ok = await showFormSheet(
    context,
    title: 'New Material Return',
    saveLabel: 'Save Return',
    builder: (ctx, setS) {
      final source = _byValue(sources, sourceType);
      final used = usedTypes();
      final steps = <String, List<String>>{};
      for (final t in used) {
        final key = t['approver_rule'] == 'specific_users'
            ? '${t['approver_rule']}:${t['approver_user_ids']}'
            : '${t['approver_rule']}';
        steps.putIfAbsent(key, () => []).add(txt(t['label']));
      }
      final needsDept = used.any((t) => t['approver_rule'] == 'department_head');
      final quarantine =
          lines.where((l) => l.itemId != null && _byValue(conditions, l.condition)?['stock_effect'] == 'quarantine').length;
      return [
        const Hint('Material coming back into a store — from an issue, a site or a vendor challan.'),
        const FormHeading('Return Details'),
        LocationSelect(value: loc, onChanged: (l) => setS(() => loc = toInt(l?['id']))),
        AppSelect<String>(
            label: 'Source',
            required: true,
            value: sourceType,
            clearable: false,
            options: valueLabelOptions(sources),
            onChanged: (o) => setS(() => sourceType = o?.value ?? sourceType)),
        if (source?['requires_issue'] == true)
          AppSelect<int>(
            label: 'Material Issue',
            required: true,
            value: issueId,
            options: [
              for (final i in issues)
                if (toInt(i['id']) != null)
                  Option(toInt(i['id'])!,
                      '${txt(i['issue_number'])}${i['department_name'] != null ? ' — ${i['department_name']}' : ''}'),
            ],
            onChanged: (o) => setS(() {
              issueId = o?.value;
              // The issue's department drives the department-head rule; it can still be changed.
              for (final i in issues) {
                if (toInt(i['id']) == issueId && i['department_id'] != null) dept = toInt(i['department_id']);
              }
            }),
          )
        else
          AppTextField(label: 'Source Description', controller: sourceDesc, hint: 'e.g. Site surplus return'),
        AppSelect<int>(
          label: 'Department',
          required: needsDept,
          value: dept,
          options: [
            for (final d in departments)
              if (toInt(d['id']) != null) Option(toInt(d['id'])!, txt(d['name'])),
          ],
          onChanged: (o) => setS(() => dept = o?.value),
        ),
        AppTextField(label: 'Reason', controller: reason),
        const FormHeading('Approval'),
        InfoNote(
            steps.isEmpty
                ? 'No approval needed — stock updates as soon as you record this return.'
                : 'Needs approval before stock changes (default routing — an admin can change it in Organization › Approval Workflows):\n'
                    '${steps.entries.map((e) => '• ${_ruleLabel[e.key.split(':').first] ?? humanize(e.key.split(':').first)} — for ${e.value.join(', ')}').join('\n')}'
                    '${quarantine > 0 ? '\n$quarantine line(s) go to quarantine, not usable stock — clear them later from the Stock page.' : ''}',
            color: steps.isEmpty ? cGreen : cAmber),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
        FormHeading('Items (${lines.length})'),
        for (var i = 0; i < lines.length; i++)
          LineBox(
            key: ObjectKey(lines[i]),
            title: 'Line ${i + 1}',
            onRemove: lines.length == 1 ? null : () => setS(() => lines.removeAt(i)),
            children: [
              ItemSelect(value: lines[i].itemId, onChanged: (x) => setS(() => lines[i].itemId = toInt(x?['id']))),
              AppTextField(label: 'Quantity', required: true, controller: lines[i].qty, keyboardType: AppTextField.number),
              AppSelect<String>(
                label: 'Condition',
                value: lines[i].condition,
                clearable: false,
                options: [
                  for (final c in conditions)
                    Option('${c['value']}',
                        '${txt(c['label'])} — ${c['stock_effect'] == 'quarantine' ? 'to quarantine' : 'to usable stock'}'),
                ],
                onChanged: (o) => setS(() => lines[i].condition = o?.value ?? lines[i].condition),
              ),
              AppTextField(label: 'Batch #', controller: lines[i].batch),
            ],
          ),
        AddLineButton('Add Item', onPressed: () => setS(() => lines.add(_RetLine()..condition = defCond))),
      ];
    },
    onSave: () async {
      final source = _byValue(sources, sourceType);
      final problems = <String>[];
      if (loc == null) problems.add('Store is required.');
      if (source == null) problems.add('Source is required — pick where the material is coming back from.');
      if (source?['requires_issue'] == true && issueId == null) {
        problems.add("'${source!['label']}' needs the Material Issue the material came from.");
      }
      if (usedTypes().any((t) => t['approver_rule'] == 'department_head') && dept == null) {
        problems.add('Department is required — the department head must approve this return.');
      }
      final valid = lines.where((l) => l.itemId != null && l.qty.text.trim().isNotEmpty).toList();
      if (valid.isEmpty) problems.add('At least one item is required.');
      if (valid.any((l) => (parseNum(l.qty.text) ?? 0) <= 0)) problems.add('Every item quantity must be greater than zero.');
      if (problems.isNotEmpty) throw problems.join('\n');
      saved = jsonMap(await Api.post('/store/material-returns', data: {
        'location_id': loc,
        'source_type': sourceType,
        'source_issue_id': issueId,
        'source_description': source?['requires_issue'] == true ? null : blankToNull(sourceDesc.text),
        'department_id': dept,
        'reason': blankToNull(reason.text),
        'remarks': blankToNull(remarks.text),
        'items': [
          for (final l in valid)
            {
              'item_id': l.itemId,
              'quantity': parseNum(l.qty.text),
              'condition': l.condition,
              'batch_number': blankToNull(l.batch.text),
            },
        ],
      }));
    },
  );
  return ok ? saved : null;
}

class ReturnDetailScreen extends StatefulWidget {
  const ReturnDetailScreen({super.key, required this.returnId});
  final int returnId;

  @override
  State<ReturnDetailScreen> createState() => _ReturnDetailScreenState();
}

class _ReturnDetailScreenState extends State<ReturnDetailScreen> {
  int _v = 0;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        key: ValueKey(_v),
        load: () async => jsonMap(await Api.get('/store/material-returns/${widget.returnId}')),
        builder: (ctx, r, reload) {
          final items = jsonList(r['items']);
          final approvals = jsonList(r['approvals']);
          Future<void> reject() async {
            final reason = await promptDialog(ctx,
                title: 'Reject this return?',
                message: 'Nothing is posted to stock. The store keeper sees your reason.',
                label: "Reason — e.g. quantity doesn't match, material not received",
                confirmLabel: 'Reject');
            if (reason == null || !ctx.mounted) return;
            final ok = await runAction(ctx, () => Api.post('/store/material-returns/${r['id']}/reject', data: {'reason': reason}));
            if (ok) setState(() => _v++);
          }

          Future<void> approve() async {
            final last = approvals.where((a) => a['status'] == 'pending').length <= 1;
            final ok = await confirmDialog(ctx,
                title: 'Approve this return?',
                message: last
                    ? 'Yours is the last approval — the returned quantities post to stock (usable lines to on-hand, quarantine lines to quarantine).'
                    : 'Other approvals are still pending — stock changes only after all of them approve.',
                confirmLabel: 'Approve');
            if (!ok || !ctx.mounted) return;
            final done = await runAction(ctx, () => Api.post('/store/material-returns/${r['id']}/approve'));
            if (done) setState(() => _v++);
          }

          final from = r['source_issue_number'] != null
              ? ' against material issue ${r['source_issue_number']}'
              : (r['source_type_label'] != null ? ' from ${'${r['source_type_label']}'.toLowerCase()}' : '');
          return SubPage(
            title: txt(r['return_number']),
            bottom: r['can_act'] == true
                ? ActionBar([secondaryAction('Reject', reject, color: cRed), primaryAction('Approve', approve)])
                : null,
            body: detailList([
              if (r['status'] == 'rejected' && r['rejected_reason'] != null)
                Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: InfoNote('Rejected — ${r['rejected_reason']}. Nothing was posted to stock.', color: cRed)),
              SummaryCard(
                title: txt(r['return_number']),
                text:
                    '${items.length} item line${items.length == 1 ? '' : 's'} returned to ${r['location_name'] ?? 'the store'}$from${r['reason'] != null ? ' — ${r['reason']}' : ''}.',
                badges: [pill(_retLabel[r['status']] ?? humanize(r['status']), _retColor[r['status']] ?? cGrey)],
                meta: [fmtDate(r['return_date']), if (r['returned_by_name'] != null) 'Returned by ${r['returned_by_name']}'],
              ),
              DetailSection('Return', children: [
                FieldRow('Store', r['location_name']),
                FieldRow('Source', r['source_type_label'] ?? r['source_type']),
                FieldRow(r['source_issue_number'] != null ? 'Material Issue' : 'Source Description',
                    r['source_issue_number'] ?? r['source_description']),
                FieldRow('Department', r['department_name']),
                FieldRow('Reason', r['reason']),
                FieldRow('Remarks', r['remarks']),
              ]),
              ApprovalPanel(entityType: 'material_return', entityId: toInt(r['id'])!, onChanged: () => setState(() => _v++)),
              if (approvals.isNotEmpty)
                DetailSection('Approvals (raised before Approval Workflows)', children: [
                  for (final a in approvals)
                    LineTile(
                      title: txt(a['label']),
                      subtitle: a['status'] == 'pending'
                          ? 'Any one of: ${(a['approver_names'] is List && (a['approver_names'] as List).isNotEmpty) ? (a['approver_names'] as List).join(', ') : '—'}'
                          : '${humanize(a['status'])} by ${txt(a['acted_by_name'])}${a['acted_at'] != null ? ' on ${fmtDate(a['acted_at'])}' : ''}${a['comment'] != null ? ' — ${a['comment']}' : ''}',
                      extra: Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: pill(humanize(a['status']),
                              _retColor[a['status'] == 'pending' ? 'pending_approval' : a['status']] ?? cGrey)),
                    ),
                ]),
              DetailSection('Items (${items.length})', children: [
                for (final l in items)
                  LineTile(
                    title: '${txt(l['item_code'])} — ${txt(l['item_name'])}',
                    trailing: fmtQ(l['quantity'], l['uom']),
                    extra: Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: pill(txt(l['condition_label'] ?? l['condition']), l['condition'] == 'good' ? cGreen : cAmber)),
                    facts: [
                      MiniFact('Batch', txt(l['batch_number'])),
                      if (l['remarks'] != null) MiniFact('Remarks', txt(l['remarks'])),
                    ],
                  ),
              ]),
            ]),
          );
        },
      );
}
