import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'store_common.dart';

// Item Master (portal: store/page.tsx, store/new, store/[id],
// ItemErpSections, ItemPhoto, ItemPlantData, ItemImportDialog).

const _itemStatuses = [Option('active', 'Active'), Option('inactive', 'Inactive'), Option('discontinued', 'Discontinued')];
const _statusColor = {'active': cGreen, 'inactive': Color(0xFF78716C), 'discontinued': cRed};
const _sourceText = {
  'item': 'set on this item',
  'category': "from the item's category",
  'default': "Finance's default ledger",
  'none': 'no ledger — Finance must set the default under Finance → Masters → Ledger Settings',
};

String _typeLabel(Json meta, Object? v) {
  for (final t in jsonList(meta['item_types'])) {
    if (t['value'] == v) return txt(t['label']);
  }
  return humanize(v);
}

class ItemsTab extends StatefulWidget {
  const ItemsTab({super.key});

  @override
  State<ItemsTab> createState() => _ItemsTabState();
}

class _ItemsTabState extends State<ItemsTab> {
  final _list = GlobalKey<ApiListViewState>();
  String? _type;
  String? _category;
  String? _subcategory;
  String _search = '';
  Json _meta = const {};
  List<Json> _cats = const [];

  @override
  void initState() {
    super.initState();
    StoreData.meta().then((m) {
      if (mounted) setState(() => _meta = m);
    }, onError: (Object _) {});
    StoreData.categories().then((c) {
      if (mounted) setState(() => _cats = c);
    }, onError: (Object _) {});
  }

  Map<String, dynamic> get _filters =>
      {'search': _search, 'item_type': _type, 'category': _category, 'subcategory': _subcategory};

  void _set(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  List<Json> _catOptions() => _cats
      .where((c) => c['parent_id'] == null && c['item_type'] != null && (_type == null || c['item_type'] == _type))
      .toList();

  List<Json> _subOptions(List<Json> cats) {
    Json? picked;
    for (final c in cats) {
      if (c['name'] == _category) picked = c;
    }
    return picked == null ? <Json>[] : _cats.where((c) => c['parent_id'] == picked!['id']).toList();
  }

  @override
  Widget build(BuildContext context) {
    final hasFilters = _search.isNotEmpty || _type != null || _category != null || _subcategory != null;
    return Scaffold(
      floatingActionButton: can('items', 'create')
          ? CreateFab(
              label: 'Add Item',
              onPressed: () async {
                final created = await openItemForm(context);
                if (created != null && context.mounted) {
                  _list.currentState?.reload();
                  openScreen(context, ItemDetailScreen(itemId: toInt(created['id'])!));
                }
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search code, name or specification',
        load: (page, search) async {
          _search = search;
          final p = await Api.list('/store/items', query: _filters);
          for (final r in p.rows) {
            final id = toInt(r['id']);
            if (id != null) StoreData.itemById[id] = r;
          }
          return p;
        },
        emptyText:
            hasFilters ? 'No items match these filters.' : 'No items yet — use + Add Item to create the first one.',
        header: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            FilterButton(
              active: countSet([_type, _category, _subcategory]),
              onClear: () => _set(() {
                _type = null;
                _category = null;
                _subcategory = null;
              }),
              builder: (ctx, setS) {
                final cats = _catOptions();
                final subs = _subOptions(cats);
                void upd(VoidCallback f) {
                  _set(f);
                  setS(() {});
                }

                return [
                  AppSelect<String>(
                    label: 'All Types',
                    value: _type,
                    options: valueLabelOptions(_meta['item_types']),
                    onChanged: (o) => upd(() {
                      _type = o?.value;
                      _category = null;
                      _subcategory = null;
                    }),
                  ),
                  // Type → Category → Subcategory: each step appears once the one before it is picked.
                  if (_type != null)
                    AppSelect<String>(
                      label: 'All Categories',
                      value: _category,
                      options: [for (final c in cats) Option(c['name'].toString(), txt(c['name']))],
                      onChanged: (o) => upd(() {
                        _category = o?.value;
                        _subcategory = null;
                      }),
                    ),
                  if (subs.isNotEmpty)
                    AppSelect<String>(
                      label: 'All Subcategories',
                      value: _subcategory,
                      options: [for (final c in subs) Option(c['name'].toString(), txt(c['name']))],
                      onChanged: (o) => upd(() => _subcategory = o?.value),
                    ),
                ];
              },
            ),
            if (can('items', 'export'))
              PillButton('Export',
                  icon: Icons.download_rounded,
                  onPressed: () => openApiFile(context, '/store/items/export',
                      'item_master${_type != null ? '_$_type' : ''}_${todayIso()}.xlsx',
                      query: _filters)),
            if (can('items', 'import'))
              PillButton('Import', icon: Icons.upload_file_rounded, onPressed: () => _import(context)),
          ]),
        ),
        itemBuilder: (ctx, i, reload) {
          final spec = (i['description'] ?? '').toString();
          return RecordCard(
            code: txt(i['item_code']),
            title: txt(i['item_name']),
            subtitle: [
              _typeLabel(_meta, i['item_type']),
              if (i['category'] != null)
                '${i['category']}${i['subcategory'] != null ? ' › ${i['subcategory']}' : ''}',
            ].join(' · '),
            trailing: pill(humanize(i['status']), _statusColor[i['status']] ?? cGrey),
            meta: [
              ('UOM', txt(i['uom'])),
              if (spec.isNotEmpty)
                ('Technical Specification', spec.length > 70 ? '${spec.substring(0, 70)}…' : spec),
            ],
            onTap: () => openThen(ctx, ItemDetailScreen(itemId: toInt(i['id'])!), reload),
          );
        },
      ),
    );
  }

  Future<void> _import(BuildContext context) async {
    final go = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Import Items'),
        content: const Text(
            'Fill the Item Master template (one row per item) and upload it. New items are saved; rows that match an existing item are listed and not saved again. Item codes are assigned automatically.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, 'template'), child: const Text('Download template')),
          FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(88, 40)),
              onPressed: () => Navigator.pop(ctx, 'upload'),
              child: const Text('Upload file')),
        ],
      ),
    );
    if (!context.mounted || go == null) return;
    if (go == 'template') {
      await openApiFile(context, '/store/items/import/template', 'item_master_import_template.xlsx');
      return;
    }
    final res = await pickAndUpload(context, '/store/items/import', extensions: const ['xlsx', 'xlsm', 'csv']);
    if (res is! Map || !context.mounted) return;
    final r = jsonMap(res);
    final created = jsonList(r['created']);
    final existing = jsonList(r['existing']);
    final errors = jsonList(r['errors']);
    final units = r['new_units'] is List ? (r['new_units'] as List) : const [];
    String row(Json x) => x.entries
        .where((e) => e.value != null && e.key != 'row' && e.value is! Map && e.value is! List)
        .map((e) => '${humanize(e.key)}: ${e.value}')
        .join(' · ');
    await messageDialog(
        context,
        'Import Result',
        [
          '${created.length} new item${created.length == 1 ? '' : 's'} saved · ${existing.length} already existed (not saved)'
              '${errors.isNotEmpty ? ' · ${errors.length} with problems (not saved)' : ''}',
          if (units.isNotEmpty)
            'New units: ${units.join(', ')} — rename or add a full name in Settings › Units of Measure.',
          if (created.isNotEmpty)
            'NEW ITEMS SAVED\n${created.map((x) => 'Row ${txt(x['row'])}: ${row(x)}').join('\n')}',
          if (existing.isNotEmpty)
            'ALREADY EXIST — NOT SAVED\n${existing.map((x) => 'Row ${txt(x['row'])}: ${row(x)}').join('\n')}',
          if (errors.isNotEmpty)
            'PROBLEMS — NOT SAVED\n${errors.map((x) => 'Row ${txt(x['row'])}: ${row(x)}').join('\n')}',
        ].join('\n\n'));
    if (created.isNotEmpty) {
      StoreData.clear();
      _list.currentState?.reload();
    }
  }
}

// ── Add / Edit item ─────────────────────────────────────────────────────────

/// Add Item (item == null) or Edit. Returns the saved item.
Future<Json?> openItemForm(BuildContext context, {Json? item}) async {
  Json meta;
  List<Json> cats;
  String codePreview = '';
  try {
    meta = await StoreData.meta();
    cats = await StoreData.categories();
    if (item == null) {
      try {
        codePreview = txt(jsonMap(await Api.get('/store/items/next-code'))['item_code']);
      } catch (_) {}
    }
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return null;
  }
  if (!context.mounted) return null;
  final editing = item != null;
  final v = <String, dynamic>{...?item};
  final types = jsonList(meta['item_types']);
  // Types this role may pick (plus the one an edited item already holds).
  final allowed = types.where((t) => t['allowed'] != false || (editing && t['value'] == item['item_type'])).toList();
  v['item_type'] ??= allowed.any((t) => t['value'] == 'material')
      ? 'material'
      : (allowed.isNotEmpty ? allowed.first['value'] : 'material');
  if (!editing && allowed.isNotEmpty && !allowed.any((t) => t['value'] == v['item_type'])) {
    v['item_type'] = allowed.first['value'];
  }
  v['status'] ??= 'active';
  MultipartFile? photo;
  Json? saved;
  TextEditingController ctl(String k) => TextEditingController(text: v[k] == null ? '' : '${v[k]}');
  final name = ctl('item_name'),
      desc = ctl('description'),
      part = ctl('part_number'),
      lead = ctl('lead_time_days'),
      legacy = ctl('legacy_code'),
      moq = ctl('min_order_qty'),
      make = ctl('make'),
      manu = ctl('manufacturer'),
      hsn = ctl('hsn_sac_code'),
      stdCost = ctl('standard_cost'),
      rl = ctl('reorder_level'),
      rq = ctl('reorder_quantity'),
      ss = ctl('safety_stock'),
      minS = ctl('minimum_stock'),
      maxS = ctl('maximum_stock'),
      shelf = ctl('shelf_life_days');

  final ok = await showFormSheet(
    context,
    title: editing ? 'Edit ${txt(item['item_name'])}' : 'Add Item',
    saveLabel: editing ? 'Save Changes' : 'Save Item',
    builder: (ctx, setS) {
      final isService = v['item_type'] == 'service';
      final unit = (v['uom'] ?? 'unit').toString();
      final top = cats
          .where((c) =>
              c['parent_id'] == null && (c['item_type'] == v['item_type'] || (editing && c['name'] == v['category'])))
          .toList();
      Json? selCat;
      for (final c in top) {
        if (c['name'] == v['category']) selCat = c;
      }
      final subs = selCat == null ? <Json>[] : cats.where((c) => c['parent_id'] == selCat!['id']).toList();
      String? ledgerNow(String kind) {
        final src = item?['effective_${kind}_gl_source'];
        if (!editing || src == null || v['${kind}_gl_account_id'] != null) return null;
        return 'Now: ${txt(item['effective_${kind}_gl'])} (${_sourceText[src] ?? src}).';
      }

      List<Option<int>> idOpts(Object? rows) => [
            for (final o in jsonList(rows))
              if (toInt(o['value']) != null) Option(toInt(o['value'])!, txt(o['label'])),
          ];

      return [
        AppTextField(
            label: 'Item Code',
            initialValue: editing ? txt(item['item_code']) : codePreview,
            enabled: false,
            hint: 'Next running number'),
        Hint(editing
            ? 'Fixed once created.'
            : 'Assigned automatically when you save — the next running number. Numbers are never reused.'),
        const FormHeading('Item Details'),
        AppSelect<String>(
          label: 'Item Type',
          value: v['item_type']?.toString(),
          clearable: false,
          options: valueLabelOptions(allowed),
          onChanged: (o) => setS(() {
            if (o == null || o.value == v['item_type']) return;
            v['item_type'] = o.value;
            v['category'] = null;
            v['subcategory'] = null;
          }),
        ),
        AppSelect<String>(
          label: 'Category',
          value: v['category']?.toString(),
          options: [for (final c in top) Option(c['name'].toString(), txt(c['name']))],
          onChanged: (o) => setS(() {
            if (o?.value == v['category']) return;
            v['category'] = o?.value;
            v['subcategory'] = null;
          }),
        ),
        AppSelect<String>(
          label: 'Subcategory',
          value: v['subcategory']?.toString(),
          enabled: subs.isNotEmpty,
          options: [for (final c in subs) Option(c['name'].toString(), txt(c['name']))],
          onChanged: (o) => setS(() => v['subcategory'] = o?.value),
        ),
        AppTextField(label: 'Item Name', required: true, controller: name, hint: 'Mild Steel Rod 12mm'),
        AppSelect<String>(
          label: 'UOM',
          required: true,
          value: v['uom']?.toString(),
          options: valueLabelOptions(meta['uoms']),
          onChanged: (o) => setS(() => v['uom'] = o?.value),
        ),
        if (editing)
          AppSelect<String>(
            label: 'Status',
            value: v['status']?.toString(),
            clearable: false,
            options: _itemStatuses,
            onChanged: (o) => setS(() => v['status'] = o?.value ?? v['status']),
          ),
        AppTextField(label: 'Technical Specification', controller: desc, maxLines: 3),
        FormHeading(editing ? 'Planning & Cost' : 'Planning'),
        AppTextField(
            label: 'Purchase lead time (days)', controller: lead, keyboardType: TextInputType.number, hint: 'e.g. 21'),
        AppTextField(label: 'Legacy code', controller: legacy, hint: 'v3 / Tally code'),
        const Hint('Lead time = calendar days from PO to goods in store. Used by MRP and the Engineering long-lead list.'),
        const FormHeading('Purchasing'),
        AppSelect<int>(
          label: 'Preferred vendor',
          value: toInt(v['preferred_vendor_id']),
          valueLabel: v['preferred_vendor_name']?.toString(),
          options: idOpts(meta['vendors']),
          onChanged: (o) => setS(() => v['preferred_vendor_id'] = o?.value),
        ),
        const Hint('Suggested first on purchase requisitions and RFQs. Add new vendors in Procurement → Vendors.'),
        AppTextField(label: 'Minimum order qty ($unit)', controller: moq, keyboardType: AppTextField.number, hint: 'e.g. 100'),
        const Hint('Smallest quantity the vendor sells. Planning rounds orders up to it.'),
        AppTextField(label: 'Part Code', controller: part),
        if (!isService) ...[
          AppTextField(label: 'Make / Brand', controller: make, hint: 'e.g. SKF'),
          AppTextField(label: 'Manufacturer', controller: manu),
        ],
        const FormHeading('Tax & Accounts'),
        AppTextField(
            label: isService ? 'SAC code' : 'HSN code',
            controller: hsn,
            hint: isService ? '6 digits, starts with 99' : '4, 6 or 8 digits'),
        const Hint("From the vendor's tax invoice. Required on GST invoices and e-invoices."),
        AppSelect<num>(
          label: 'GST rate',
          value: toNum(v['gst_rate']),
          options: [
            for (final r in (meta['gst_rates'] is List ? meta['gst_rates'] as List : const []))
              if (toNum(r) != null) Option(toNum(r)!, '${fmtQ(r)}%'),
          ],
          onChanged: (o) => setS(() => v['gst_rate'] = o?.value),
        ),
        const Hint("Rates come from Finance's GST rate master."),
        AppSelect<int>(
          label: 'Purchase ledger',
          value: toInt(v['purchase_gl_account_id']),
          options: idOpts(meta['purchase_ledgers']),
          onChanged: (o) => setS(() => v['purchase_gl_account_id'] = o?.value),
        ),
        Hint(ledgerNow('purchase') ?? 'Leave blank to use the category ledger. Assets go to a fixed-asset ledger.'),
        AppSelect<int>(
          label: 'Sales ledger',
          value: toInt(v['sales_gl_account_id']),
          options: idOpts(meta['sales_ledgers']),
          onChanged: (o) => setS(() => v['sales_gl_account_id'] = o?.value),
        ),
        Hint(ledgerNow('sales') ?? 'Only for items we also sell (spares, finished goods).'),
        if (!isService) ...[
          const FormHeading('Stock Levels & Cost'),
          AppTextField(
              label: 'Standard cost (₹ per unit)', controller: stdCost, keyboardType: AppTextField.number, hint: 'Planned rate'),
          const Hint('Planning rate for BOM estimates. Stock is valued at the system weighted average, not this.'),
          AppTextField(label: 'Reorder level ($unit)', controller: rl, keyboardType: AppTextField.number),
          const Hint('Raise a PR when free stock falls to this.'),
          AppTextField(label: 'Reorder qty ($unit)', controller: rq, keyboardType: AppTextField.number),
          AppTextField(label: 'Safety stock ($unit)', controller: ss, keyboardType: AppTextField.number),
          AppTextField(label: 'Minimum stock ($unit)', controller: minS, keyboardType: AppTextField.number),
          AppTextField(label: 'Maximum stock ($unit)', controller: maxS, keyboardType: AppTextField.number),
          const FormHeading('Quality & Tracking'),
          CheckField(
            label:
                'Quality check on receipt — receipts wait in Quality stock under an inspection lot; without this, GRN quantity goes straight into Free stock',
            value: v['inspection_on_receipt'] == true,
            onChanged: (x) => setS(() {
              v['inspection_on_receipt'] = x;
              if (!x) v['test_certificate_required'] = false;
            }),
          ),
          Opacity(
            opacity: v['inspection_on_receipt'] == true ? 1 : 0.5,
            child: CheckField(
              label:
                  "Test certificate (MTC) required — an incoming lot can't be accepted until the certificate is marked received",
              value: v['test_certificate_required'] == true,
              onChanged: (x) => setS(() {
                if (v['inspection_on_receipt'] == true) v['test_certificate_required'] = x;
              }),
            ),
          ),
          CheckField(
              label: 'Batch / heat number tracked',
              value: v['batch_controlled'] == true,
              onChanged: (x) => setS(() => v['batch_controlled'] = x)),
          CheckField(
              label: 'Serial number tracked (one serial per unit)',
              value: v['serial_controlled'] == true,
              onChanged: (x) => setS(() => v['serial_controlled'] = x)),
          CheckField(
              label: 'Has expiry (paint, adhesives, chemicals)',
              value: v['expiry_controlled'] == true,
              onChanged: (x) => setS(() => v['expiry_controlled'] = x)),
          if (v['expiry_controlled'] == true)
            AppTextField(label: 'Shelf life (days)', controller: shelf, keyboardType: TextInputType.number),
        ],
        if (!editing) ...[
          const FormHeading('Photo'),
          Wrap(spacing: 8, runSpacing: 8, children: [
            PillButton(photo == null ? 'Take photo' : 'Retake photo',
                icon: Icons.photo_camera_outlined,
                onPressed: () async {
                  final p = await Files.takePhoto();
                  if (p != null) setS(() => photo = p);
                }),
            PillButton('Pick from gallery',
                icon: Icons.photo_library_outlined,
                onPressed: () async {
                  final p = await Files.pickPhoto();
                  if (p != null) setS(() => photo = p);
                }),
          ]),
          if (photo != null) Hint('Photo ready: ${photo!.filename ?? 'photo'} — uploaded right after the item is saved.'),
        ],
      ];
    },
    onSave: () async {
      if (name.text.trim().isEmpty) throw 'Item Name is required.';
      if (v['uom'] == null) throw 'Pick the unit of measure (UOM).';
      final payload = <String, dynamic>{
        'item_name': name.text.trim(),
        'item_type': v['item_type'],
        'category': v['category'],
        'subcategory': v['subcategory'],
        'description': blankToNull(desc.text),
        'part_number': blankToNull(part.text),
        'uom': v['uom'],
        'lead_time_days': parseNum(lead.text)?.toInt(),
        'legacy_code': blankToNull(legacy.text),
        'preferred_vendor_id': v['preferred_vendor_id'],
        'make': blankToNull(make.text),
        'manufacturer': blankToNull(manu.text),
        'min_order_qty': parseNum(moq.text),
        'hsn_sac_code': blankToNull(hsn.text),
        'gst_rate': v['gst_rate'],
        'purchase_gl_account_id': v['purchase_gl_account_id'],
        'sales_gl_account_id': v['sales_gl_account_id'],
        'standard_cost': parseNum(stdCost.text),
        'minimum_stock': parseNum(minS.text),
        'reorder_level': parseNum(rl.text),
        'safety_stock': parseNum(ss.text),
        'reorder_quantity': parseNum(rq.text),
        'maximum_stock': parseNum(maxS.text),
        'inspection_on_receipt': v['inspection_on_receipt'] == true,
        'test_certificate_required': v['test_certificate_required'] == true,
        'batch_controlled': v['batch_controlled'] == true,
        'serial_controlled': v['serial_controlled'] == true,
        'expiry_controlled': v['expiry_controlled'] == true,
        'shelf_life_days': parseNum(shelf.text)?.toInt(),
        if (editing) 'status': v['status'],
      };
      saved = jsonMap(editing
          ? await Api.patch('/store/items/${item['id']}', data: payload)
          : await Api.post('/store/items', data: payload));
      StoreData.clear();
    },
  );
  if (!ok || saved == null) return null;
  if (photo != null && context.mounted) {
    try {
      await uploadMultipart('/store/items/${saved!['id']}/photo', photo!);
    } catch (e) {
      if (context.mounted) {
        await messageDialog(context, 'Photo Not Uploaded',
            "Item ${txt(saved!['item_code'])} was saved, but the photo couldn't be uploaded: ${ApiClient.describe(e)} You can add it from the item page.");
      }
    }
  }
  return saved;
}

// ── Item detail ──────────────────────────────────────────────────────────────

class ItemDetailScreen extends StatefulWidget {
  const ItemDetailScreen({super.key, required this.itemId});
  final int itemId;

  @override
  State<ItemDetailScreen> createState() => _ItemDetailScreenState();
}

class _ItemDetailScreenState extends State<ItemDetailScreen> {
  int _v = 0;

  @override
  Widget build(BuildContext context) {
    return ApiLoader<(Json, Json)>(
      key: ValueKey(_v),
      load: () async => (jsonMap(await Api.get('/store/items/${widget.itemId}')), await StoreData.meta()),
      builder: (ctx, data, reload) {
        final (it, meta) = data;
        final seeVal = seeValues;
        final seeStd = seeVal || can('items', 'edit');
        final isService = it['item_type'] == 'service';
        final uom = it['uom'];
        String n(Object? x) => x == null ? '—' : fmtQ(x, uom);
        String? ledger(String kind) {
          final name = it['effective_${kind}_gl'];
          final src = it['effective_${kind}_gl_source'];
          if (name != null) return '$name${src != null && src != 'item' ? ' (${_sourceText[src]})' : ''}';
          return src == 'none' ? _sourceText['none'] : null;
        }

        String avg() {
          if (it['moving_average_cost'] == null) return 'Not valued yet';
          final last = it['last_receipt_rate'] != null
              ? ' · last receipt ${fmtMoney(it['last_receipt_rate'])}${it['last_receipt_date'] != null ? ' on ${fmtDate(it['last_receipt_date'])}' : ''}'
              : '';
          return '${fmtMoney(it['moving_average_cost'])} (system weighted average$last)';
        }

        final statusLabel = _itemStatuses
            .firstWhere((s) => s.value == it['status'], orElse: () => Option('', humanize(it['status'])))
            .label;
        return SubPage(
          title: txt(it['item_code']),
          bottom: actionBar([
            if (can('items', 'delete'))
              secondaryAction('Delete', () async {
                final ok = await confirmDialog(ctx,
                    title: 'Delete this item?',
                    message:
                        'This permanently removes "${txt(it['item_name'])}" from the item master. This cannot be undone.',
                    confirmLabel: 'Delete',
                    danger: true);
                if (!ok || !ctx.mounted) return;
                final done =
                    await runAction(ctx, () => Api.delete('/store/items/${it['id']}'), success: 'Item deleted.');
                if (done && ctx.mounted) {
                  StoreData.clear();
                  Navigator.pop(ctx);
                }
              }, color: cRed),
            if (can('items', 'edit'))
              primaryAction('Edit', () async {
                final s = await openItemForm(ctx, item: it);
                if (s != null) setState(() => _v++);
              }),
          ]),
          body: detailList([
            SummaryCard(
              title: txt(it['item_name']),
              text:
                  '${_typeLabel(meta, it['item_type'])}${it['category'] != null ? ' · ${it['category']}${it['subcategory'] != null ? ' › ${it['subcategory']}' : ''}' : ''}'
                  ' — stocked, bought and issued in ${it['uom'] ?? 'units'}.',
              badges: [pill(statusLabel, _statusColor[it['status']] ?? cGrey)],
              meta: [
                'Code ${txt(it['item_code'])}',
                if (it['part_number'] != null) 'Part code ${it['part_number']}',
              ],
            ),
            _ItemPhoto(itemId: toInt(it['id'])!, hasPhoto: it['has_photo'] == true, editable: can('items', 'edit')),
            DetailSection('Item Details', children: [
              FieldRow('Item Type', _typeLabel(meta, it['item_type'])),
              FieldRow(
                  'Category',
                  it['category'] == null
                      ? null
                      : '${it['category']}${it['subcategory'] != null ? ' › ${it['subcategory']}' : ''}'),
              FieldRow('UOM', it['uom']),
              FieldRow('Technical Specification', it['description']),
            ]),
            DetailSection('Planning & Cost', children: [
              FieldRow(
                  'Purchase lead time',
                  it['lead_time_days'] != null
                      ? '${fmtQ(it['lead_time_days'])} calendar day(s)'
                      : 'Not set — MRP will assume one'),
              FieldRow('Legacy code (v3 / Tally)', it['legacy_code']),
              if (seeStd) FieldRow('Standard cost', it['standard_cost'] == null ? null : fmtMoney(it['standard_cost'])),
              if (seeVal) FieldRow('Weighted average', avg()),
            ]),
            DetailSection('Purchasing', children: [
              FieldRow(
                  'Preferred vendor',
                  it['preferred_vendor_name'] ??
                      (it['preferred_supplier'] != null
                          ? '${it['preferred_supplier']} (not linked to the vendor master — pick it again)'
                          : null)),
              FieldRow('Minimum order qty', it['min_order_qty'] == null ? null : n(it['min_order_qty'])),
              if (!isService)
                FieldRow('Make / Manufacturer',
                    [it['make'], it['manufacturer']].where((x) => x != null && '$x'.isNotEmpty).join(' · ')),
            ]),
            DetailSection('Tax & Accounts', children: [
              FieldRow(isService ? 'SAC code' : 'HSN code', it['hsn_sac_code'] ?? 'Not set — needed on GST invoices'),
              FieldRow('GST rate', it['gst_rate'] != null ? '${fmtQ(it['gst_rate'])}%' : 'Not set'),
              FieldRow('Purchase ledger', ledger('purchase')),
              FieldRow('Sales ledger', ledger('sales')),
            ]),
            if (!isService) ...[
              DetailSection('Stock Levels', children: [
                FieldRow('Reorder level / qty', '${n(it['reorder_level'])} / ${n(it['reorder_quantity'])}'),
                FieldRow('Safety stock', it['safety_stock'] == null ? null : n(it['safety_stock'])),
                FieldRow('Min / Max stock', '${n(it['minimum_stock'])} / ${n(it['maximum_stock'])}'),
              ]),
              DetailSection('Quality & Tracking', children: [
                FieldRow(
                    'Quality check on receipt',
                    it['inspection_on_receipt'] == true
                        ? 'Yes — GRN / production receipts wait in Quality stock under an inspection lot'
                        : 'No — GRN quantity goes straight into Free stock'),
                FieldRow(
                    'Test certificate required',
                    it['test_certificate_required'] == true
                        ? "Yes — an incoming lot can't be accepted without the MTC / test certificate"
                        : 'No'),
                FieldRow('Batch / Serial tracked',
                    '${it['batch_controlled'] == true ? 'Yes' : 'No'} / ${it['serial_controlled'] == true ? 'Yes' : 'No'}'),
                FieldRow(
                    'Expiry',
                    it['expiry_controlled'] == true
                        ? (it['shelf_life_days'] != null
                            ? 'Yes — shelf life ${fmtQ(it['shelf_life_days'])} day(s)'
                            : 'Yes — shelf life not set')
                        : 'No'),
              ]),
            ],
            if (canFeature('items', 'plant_data', 'view'))
              _PlantData(itemId: toInt(it['id'])!, canEdit: canFeature('items', 'plant_data', 'edit')),
            if (canFeature('items', 'vendor_suggestions', 'view')) _VendorSuggestions(itemId: toInt(it['id'])!),
          ]),
        );
      },
    );
  }
}

class _ItemPhoto extends StatefulWidget {
  const _ItemPhoto({required this.itemId, required this.hasPhoto, required this.editable});
  final int itemId;
  final bool hasPhoto;
  final bool editable;

  @override
  State<_ItemPhoto> createState() => _ItemPhotoState();
}

class _ItemPhotoState extends State<_ItemPhoto> {
  Uint8List? _bytes;
  late bool _has = widget.hasPhoto;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (_has) _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.dio
          .get<List<int>>('/store/items/${widget.itemId}/photo', options: Options(responseType: ResponseType.bytes));
      if (mounted) setState(() => _bytes = Uint8List.fromList(r.data ?? const []));
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _upload(bool camera) async {
    final f = camera ? await Files.takePhoto() : await Files.pickPhoto();
    if (f == null || !mounted) return;
    setState(() => _busy = true);
    final ok = await runAction(context, () => uploadMultipart('/store/items/${widget.itemId}/photo', f),
        success: 'Photo saved.');
    if (ok) {
      _has = true;
      _error = null;
      await _load();
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _remove() async {
    final ok = await confirmDialog(context,
        title: 'Remove the photo?',
        message: 'The item keeps all its data; only the photo is removed.',
        confirmLabel: 'Remove',
        danger: true);
    if (!ok || !mounted) return;
    final done =
        await runAction(context, () => Api.delete('/store/items/${widget.itemId}/photo'), success: 'Photo removed.');
    if (done && mounted) {
      setState(() {
        _has = false;
        _bytes = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_has && !widget.editable) return const SizedBox();
    return DetailSection('Photo', children: [
      if (_has && _bytes != null && _bytes!.isNotEmpty)
        ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.memory(_bytes!, height: 200, fit: BoxFit.contain)),
      if (_has && _bytes == null && _error == null) const LoadingView(),
      if (_error != null) ErrorBanner(_error!),
      if (!_has) const Hint('No photo yet.'),
      if (widget.editable) ...[
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          PillButton(_has ? 'Replace — camera' : 'Take photo',
              icon: Icons.photo_camera_outlined, onPressed: _busy ? null : () => _upload(true)),
          PillButton(_has ? 'Replace — gallery' : 'Pick from gallery',
              icon: Icons.photo_library_outlined, onPressed: _busy ? null : () => _upload(false)),
          if (_has)
            PillButton('Remove', icon: Icons.delete_outline_rounded, color: cRed, onPressed: _busy ? null : _remove),
        ]),
      ],
    ]);
  }
}

// ── Plant data (MRP views) ──────────────────────────────────────────────────

const _plantNums = [
  ('reorder_level', 'Reorder level'),
  ('safety_stock', 'Safety stock'),
  ('minimum_stock', 'Min'),
  ('maximum_stock', 'Max'),
  ('reorder_quantity', 'Reorder qty'),
  ('lead_time_days', 'Purchase days'),
  ('inhouse_production_days', 'Make days'),
];

class _PlantData extends StatefulWidget {
  const _PlantData({required this.itemId, required this.canEdit});
  final int itemId;
  final bool canEdit;

  @override
  State<_PlantData> createState() => _PlantDataState();
}

class _PlantDataState extends State<_PlantData> {
  Json? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = jsonMap(await Api.get('/store/items/${widget.itemId}/plants'));
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  String _optLabel(Object? opts, Object? v, {bool short = true}) {
    for (final o in jsonList(opts)) {
      if (o['value'] == v) {
        final l = txt(o['label']);
        return short ? l.split(' — ').first : l;
      }
    }
    return txt(v);
  }

  String _plantName(List<Json> plants, Object? id) {
    for (final p in plants) {
      if (p['id'] == id) return txt(p['name']);
    }
    return 'Plant $id';
  }

  Future<void> _edit() async {
    final d = _data!;
    final meta = jsonMap(d['meta']);
    final plants = jsonList(meta['plants']);
    final stores = jsonList(meta['stores']);
    final rows = [for (final r in jsonList(d['plants'])) <String, dynamic>{...r}];
    final ctls = <Json, Map<String, TextEditingController>>{};
    Map<String, TextEditingController> c(Json r) => ctls.putIfAbsent(
        r, () => {for (final f in _plantNums) f.$1: TextEditingController(text: r[f.$1] == null ? '' : '${r[f.$1]}')});
    List<Option<String>> pickable(Object? opts, Object? cur) => [
          for (final o in jsonList(opts))
            if (o['allowed'] != false || o['value'] == cur)
              Option(o['value'].toString(), txt(o['label']).split(' — ').first),
        ];
    String first(Object? opts, String fb) {
      for (final o in jsonList(opts)) {
        if (o['allowed'] != false) return o['value'].toString();
      }
      return fb;
    }

    int? addPlant;
    final ok = await showFormSheet(
      context,
      title: 'Edit Plant Data',
      saveLabel: 'Save plant data',
      builder: (ctx, setS) {
        final unused = plants.where((p) => !rows.any((r) => r['branch_id'] == p['id'])).toList();
        return [
          const Hint('Planning per plant (MRP views) — a plant without a row uses the Item Master fields.'),
          if (rows.isEmpty) const Hint('No plant rows — add a plant below.'),
          for (final r in rows)
            LineBox(
              key: ObjectKey(r),
              title: _plantName(plants, r['branch_id']),
              onRemove: () => setS(() => rows.remove(r)),
              children: [
                AppSelect<String>(
                    label: 'MRP type',
                    value: r['mrp_type']?.toString(),
                    clearable: false,
                    options: pickable(meta['mrp_types'], r['mrp_type']),
                    onChanged: (o) => setS(() => r['mrp_type'] = o?.value ?? r['mrp_type'])),
                AppSelect<String>(
                    label: 'Make / buy',
                    value: r['procurement_type']?.toString(),
                    clearable: false,
                    options: pickable(meta['procurement_types'], r['procurement_type']),
                    onChanged: (o) => setS(() => r['procurement_type'] = o?.value ?? r['procurement_type'])),
                for (final f in _plantNums)
                  AppTextField(label: f.$2, controller: c(r)[f.$1], keyboardType: AppTextField.number),
                AppSelect<int>(
                  label: 'Default store',
                  value: toInt(r['default_location_id']),
                  options: [
                    for (final s in stores)
                      if (toInt(s['id']) != null && (s['branch_id'] == null || s['branch_id'] == r['branch_id']))
                        Option(toInt(s['id'])!, txt(s['name'])),
                  ],
                  onChanged: (o) => setS(() => r['default_location_id'] = o?.value),
                ),
                CheckField(
                    label: 'Purchasing blocked',
                    value: r['purchasing_blocked'] == true,
                    onChanged: (x) => setS(() => r['purchasing_blocked'] = x)),
              ],
            ),
          if (unused.isNotEmpty)
            Row(children: [
              Expanded(
                child: AppSelect<int>(
                  label: 'Add a plant…',
                  value: addPlant,
                  options: [
                    for (final p in unused)
                      if (toInt(p['id']) != null) Option(toInt(p['id'])!, txt(p['name'])),
                  ],
                  onChanged: (o) => setS(() => addPlant = o?.value),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filledTonal(
                tooltip: 'Add',
                onPressed: addPlant == null
                    ? null
                    : () => setS(() {
                          rows.add({
                            'branch_id': addPlant,
                            'mrp_type': first(meta['mrp_types'], 'reorder_point'),
                            'procurement_type': first(meta['procurement_types'], 'buy'),
                            'purchasing_blocked': false,
                          });
                          addPlant = null;
                        }),
                icon: const Icon(Icons.add_rounded),
              ),
            ]),
        ];
      },
      onSave: () async {
        final payload = [
          for (final r in rows)
            {
              'branch_id': r['branch_id'],
              'mrp_type': r['mrp_type'],
              'procurement_type': r['procurement_type'],
              'default_location_id': r['default_location_id'],
              'purchasing_blocked': r['purchasing_blocked'] == true,
              'remarks': r['remarks'],
              for (final f in _plantNums)
                f.$1: f.$1.endsWith('_days') ? parseNum(c(r)[f.$1]!.text)?.toInt() : parseNum(c(r)[f.$1]!.text),
            }
        ];
        final d2 = jsonMap(await Api.put('/store/items/${widget.itemId}/plants', data: {'plants': payload}));
        if (mounted) setState(() => _data = d2);
      },
    );
    if (ok && mounted) showSnack(context, 'Plant data saved.');
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) {
      return _error == null ? const SizedBox() : DetailSection('Plant data', children: [ErrorBanner(_error!)]);
    }
    final meta = jsonMap(d['meta']);
    final rows = jsonList(d['plants']);
    final stores = jsonList(meta['stores']);
    String storeName(Object? id) {
      for (final s in stores) {
        if (s['id'] == id) return txt(s['name']);
      }
      return '—';
    }

    return DetailSection('Plant data (MRP views)',
        action: widget.canEdit ? TextButton(onPressed: _edit, child: const Text('Edit plant data')) : null,
        children: [
          const Hint(
              "Planning per plant. Reorder runs per plant with that plant's stores' stock; a plant without a row uses the company-wide fields above. MRP type 'MRP' leaves the item to Production MRP."),
          if (rows.isEmpty)
            const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('No plant-specific data — every plant uses the Item Master fields.')),
          for (final r in rows)
            LineTile(
              title: _plantName(jsonList(meta['plants']), r['branch_id']),
              subtitle:
                  '${_optLabel(meta['mrp_types'], r['mrp_type'])} · ${_optLabel(meta['procurement_types'], r['procurement_type'], short: false)}',
              facts: [
                for (final f in _plantNums) MiniFact(f.$2, fmtQ(r[f.$1])),
                MiniFact('Default store', storeName(r['default_location_id'])),
                MiniFact('Purch. blocked', r['purchasing_blocked'] == true ? 'Yes' : 'No'),
              ],
            ),
        ]);
  }
}

class _VendorSuggestions extends StatelessWidget {
  const _VendorSuggestions({required this.itemId});
  final int itemId;

  @override
  Widget build(BuildContext context) => FutureBuilder<ApiPage>(
        future: Api.list('/store/items/$itemId/vendors'),
        builder: (ctx, s) {
          final rows = s.data?.rows ?? const <Json>[];
          String rupees(Object? v, Object? unit) => v == null ? '—' : '${fmtMoney(v)}${unit != null ? ' / $unit' : ''}';
          return DetailSection('Vendors for this item', children: [
            const Hint(
                'Preferred vendor first, then vendors we bought it from (latest first), then vendors whose catalog lists it. Matched by item / part code, or the exact item name.'),
            if (s.hasError) ErrorBanner(ApiClient.describe(s.error!)),
            if (s.connectionState != ConnectionState.done) const LoadingView(),
            if (s.connectionState == ConnectionState.done && !s.hasError && rows.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                    "No vendor has supplied or listed this item yet. Pick a preferred vendor, or add it to a vendor's catalog in Procurement → Vendors."),
              ),
            for (final r in rows)
              LineTile(
                title: txt(r['vendor_name']),
                extra: r['preferred'] == true
                    ? Padding(padding: const EdgeInsets.only(top: 4), child: pill('Preferred', cGreen))
                    : null,
                facts: [
                  MiniFact('Last PO rate', rupees(r['last_po_rate'], r['last_po_unit'])),
                  MiniFact('Last PO',
                      r['last_po_number'] != null ? '${r['last_po_number']} · ${fmtDate(r['last_po_date'])}' : '—'),
                  MiniFact('POs / Qty bought',
                      (toNum(r['po_count']) ?? 0) > 0 ? '${fmtQ(r['po_count'])} / ${fmtQ(r['total_qty'])}' : '—'),
                  MiniFact('Catalog price', rupees(r['catalog_price'], r['catalog_unit'])),
                  MiniFact('Catalog lead time',
                      r['catalog_lead_time_days'] != null ? '${r['catalog_lead_time_days']} day(s)' : '—'),
                ],
              ),
          ]);
        },
      );
}