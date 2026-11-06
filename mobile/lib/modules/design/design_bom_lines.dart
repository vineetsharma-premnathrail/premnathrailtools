import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/widgets.dart';
import 'design_common.dart';

/// BOM lines editor - portal design/boms/BomLinesEditor.tsx on a phone:
/// each line is a card; Add / Edit opens a small line form; Excel import
/// reads lines into the form (nothing is saved until the BOM is saved).

class BomLineDraft {
  BomLineDraft({
    this.position = '',
    this.isNew = false,
    this.itemId,
    this.itemLabel,
    this.newName = '',
    this.newSpec = '',
    this.quantity = '1',
    this.uom = 'Nos',
    this.documentId,
    this.documentLabel,
    this.makeBuy = 'buy',
    this.remarks = '',
  });

  factory BomLineDraft.fromLine(Json l) => BomLineDraft(
        position: str(l['position']),
        isNew: l['store_item_id'] == null,
        itemId: asInt(l['store_item_id']),
        itemLabel: l['store_item_id'] == null ? null : '${str(l['item_code']).isEmpty ? '#${l['store_item_id']}' : l['item_code']} — ${str(l['item_name'])}',
        newName: str(l['new_item_name']),
        newSpec: str(l['new_item_spec']),
        quantity: _qty(l['quantity']),
        uom: str(l['uom']),
        documentId: asInt(l['document_id']),
        documentLabel: nullIfEmpty(str(l['doc_number'] ?? l['document_label'])),
        makeBuy: str(l['make_buy']).isEmpty ? 'buy' : str(l['make_buy']),
        remarks: str(l['remarks']),
      );

  String position;
  bool isNew;
  int? itemId;
  String? itemLabel;
  String newName;
  String newSpec;
  String quantity;
  String uom;
  int? documentId;
  String? documentLabel;
  String makeBuy;
  String remarks;

  String get itemText => isNew ? '${newName.isEmpty ? 'New item' : newName} (new item)' : (itemLabel ?? '—');
}

String _qty(Object? v) {
  final n = asNum(v);
  if (n == null) return '';
  return n == n.roundToDouble() ? n.toInt().toString() : n.toString();
}

/// Checks the rows and builds the API payload (bomDraftsToPayload). Throws
/// a readable message when a row is incomplete.
List<Map<String, dynamic>> bomDraftsToPayload(List<BomLineDraft> rows) {
  final lines = <Map<String, dynamic>>[];
  for (var i = 0; i < rows.length; i++) {
    final r = rows[i];
    final label = 'Line ${r.position.isEmpty ? i + 1 : r.position}';
    if (r.isNew) {
      if (r.newName.trim().length < 2) throw '$label: give the new item a name (Store creates its code from it) — or pick an existing item.';
    } else if (r.itemId == null) {
      throw "$label: pick an item from Item Master, or tick “New item” if it doesn't exist yet.";
    }
    final qty = num.tryParse(r.quantity.trim());
    if (qty == null || qty <= 0) throw '$label: quantity must be a number greater than 0.';
    final pos = r.position.trim().isEmpty ? (i + 1) * 10 : int.tryParse(r.position.trim());
    if (pos == null || pos <= 0) throw '$label: position must be a whole number (e.g. 10, 20, 30).';
    lines.add({
      'position': pos,
      'store_item_id': r.isNew ? null : r.itemId,
      'new_item_name': r.isNew ? r.newName.trim() : null,
      'new_item_spec': r.isNew ? nullIfEmpty(r.newSpec) : null,
      'quantity': qty,
      'uom': nullIfEmpty(r.uom),
      'document_id': r.documentId,
      'make_buy': r.makeBuy,
      'remarks': nullIfEmpty(r.remarks),
    });
  }
  final seen = <int>{};
  for (final l in lines) {
    if (!seen.add(l['position'] as int)) throw 'Position ${l['position']} is used twice — every line needs its own position number.';
  }
  return lines;
}

/// Opens the line form; returns the edited draft (or null when cancelled).
Future<BomLineDraft?> editBomLine(BuildContext context, BomLineDraft? existing, int index) async {
  final d = existing ?? BomLineDraft(position: '${(index + 1) * 10}');
  final pos = TextEditingController(text: d.position);
  final name = TextEditingController(text: d.newName);
  final spec = TextEditingController(text: d.newSpec);
  final qty = TextEditingController(text: d.quantity);
  final uom = TextEditingController(text: d.uom);
  final remarks = TextEditingController(text: d.remarks);
  bool isNew = d.isNew;
  int? itemId = d.itemId, docId = d.documentId;
  String? itemL = d.itemLabel, docL = d.documentLabel;
  String makeBuy = d.makeBuy;
  final ok = await showFormSheet(
    context,
    title: existing == null ? 'Add line' : 'Edit line',
    saveLabel: 'Done',
    builder: (ctx, setS) => [
      AppTextField(label: 'Pos.', controller: pos, keyboardType: TextInputType.number, hint: 'e.g. 10'),
      CheckField(label: 'New item (not in Item Master yet)', value: isNew, onChanged: (v) => setS(() => isNew = v)),
      if (isNew) ...[
        AppTextField(label: 'New item name', controller: name, required: true),
        AppTextField(label: 'Specification (material, size, grade…)', controller: spec),
      ] else
        AppSelect<int>(
            label: 'Item',
            required: true,
            value: itemId,
            valueLabel: itemL,
            loadOptions: (s) => designLookup('items', s, query: {'limit': 200}, sendSearch: true),
            onChanged: (o) => setS(() {
                  itemId = o?.value;
                  itemL = o?.label;
                })),
      AppTextField(label: 'Qty', controller: qty, required: true, keyboardType: AppTextField.number),
      AppTextField(label: 'UOM', controller: uom, hint: 'Nos'),
      AppSelect<int>(
          label: 'Drawing',
          value: docId,
          valueLabel: docL,
          loadOptions: (s) => designLookup('documents', s, query: {'limit': 500}, sendSearch: true),
          onChanged: (o) => setS(() {
                docId = o?.value;
                docL = o?.label;
              })),
      AppSelect<String>(
          label: 'Make / Buy',
          clearable: false,
          value: makeBuy,
          options: const [Option('buy', 'Buy'), Option('make', 'Make')],
          onChanged: (o) => setS(() => makeBuy = o?.value ?? makeBuy)),
      AppTextField(label: 'Remarks', controller: remarks),
    ],
    onSave: () async {
      if (isNew && name.text.trim().length < 2) throw 'Give the new item a name (Store creates its code from it) — or pick an existing item.';
      if (!isNew && itemId == null) throw "Pick an item from Item Master, or tick “New item” if it doesn't exist yet.";
      final q = num.tryParse(qty.text.trim());
      if (q == null || q <= 0) throw 'Quantity must be a number greater than 0.';
    },
  );
  if (!ok) return null;
  return BomLineDraft(
    position: pos.text.trim(),
    isNew: isNew,
    itemId: isNew ? null : itemId,
    itemLabel: isNew ? null : itemL,
    newName: name.text.trim(),
    newSpec: spec.text.trim(),
    quantity: qty.text.trim(),
    uom: uom.text.trim(),
    documentId: docId,
    documentLabel: docL,
    makeBuy: makeBuy,
    remarks: remarks.text.trim(),
  );
}

/// The lines block inside a BOM form sheet.
List<Widget> bomLinesFields(BuildContext context, StateSetter setS, List<BomLineDraft> rows, {List<Widget> extra = const []}) => [
      Caps('Lines (${rows.length})'),
      ...extra,
      Row(children: [
        Expanded(
          child: OutlinedButton.icon(
            icon: const Icon(Icons.upload_file_rounded, size: 18),
            label: const Text('Import from Excel'),
            onPressed: () async {
              final f = await Files.pickFile(extensions: const ['xlsx', 'xls', 'csv']);
              if (f == null) return;
              try {
                final res = jsonMap((await Api.dio.post('/design/boms/import-lines', data: formData({'file': f}))).data);
                final lines = jsonList(res['lines'])..sort((a, b) => (asInt(a['position']) ?? 0).compareTo(asInt(b['position']) ?? 0));
                final errors = jsonList(res['errors']);
                setS(() {
                  if (lines.isNotEmpty) {
                    rows
                      ..clear()
                      ..addAll(lines.map(BomLineDraft.fromLine));
                  }
                });
                if (context.mounted) {
                  final msg = [
                    if (lines.isNotEmpty) '${lines.length} line${lines.length == 1 ? '' : 's'} loaded into the form — review them, then save.',
                    if (lines.isEmpty) 'No line could be loaded — fix the rows and import again.',
                    for (final e in errors) 'Row ${e['row']}${str(e['item_code']).isEmpty ? '' : ' (${e['item_code']})'}: ${e['reason']}',
                  ].join('\n');
                  showSnack(context, msg, error: lines.isEmpty || errors.isNotEmpty);
                }
              } catch (e) {
                if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
              }
            },
          ),
        ),
        const SizedBox(width: 8),
        TextButton(
          onPressed: () => openApiFile(context, '/design/boms/import-lines/template', 'bom_lines_template.xlsx'),
          child: const Text('Template'),
        ),
      ]),
      for (var i = 0; i < rows.length; i++)
        Container(
          padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
          decoration: BoxDecoration(color: Brand.background, border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10)),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${rows[i].position.isEmpty ? (i + 1) * 10 : rows[i].position}. ${rows[i].itemText}',
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: rows[i].isNew ? const Color(0xFFB45309) : Brand.heading)),
                Text(
                    'Qty ${rows[i].quantity} ${rows[i].uom} · ${rows[i].makeBuy == 'make' ? 'Make' : 'Buy'}'
                    '${rows[i].documentLabel == null ? '' : ' · ${rows[i].documentLabel}'}${rows[i].remarks.isEmpty ? '' : ' · ${rows[i].remarks}'}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
            ),
            IconButton(
              tooltip: 'Edit line',
              icon: const Icon(Icons.edit_outlined, size: 18),
              onPressed: () async {
                final d = await editBomLine(context, rows[i], i);
                if (d != null) setS(() => rows[i] = d);
              },
            ),
            IconButton(
              tooltip: 'Remove line',
              icon: const Icon(Icons.delete_outline_rounded, size: 18, color: Brand.danger),
              onPressed: () => setS(() => rows.removeAt(i)),
            ),
          ]),
        ),
      OutlinedButton.icon(
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add line'),
        onPressed: () async {
          final d = await editBomLine(context, null, rows.length);
          if (d != null) setS(() => rows.add(d));
        },
      ),
    ];
