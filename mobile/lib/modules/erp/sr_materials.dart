import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'erp_common.dart';

const _materialStatus = {
  'issued': ('Issued', Color(0xFF16A34A)),
  'returned': ('Returned', Color(0xFF64748B)),
  'pending': ('Pending', Color(0xFFD97706)),
};

const _prStatus = {
  'submitted': ('Submitted', Color(0xFF3B82F6)),
  'approved': ('Approved', Color(0xFF8B5CF6)),
  'po_raised': ('PO Raised', Color(0xFFF59E0B)),
  'partially_received': ('Partially Received', Color(0xFFD97706)),
  'received': ('Received', Color(0xFF0EA5E9)),
  'closed': ('Closed', Color(0xFF22C55E)),
  'rejected': ('Rejected', Color(0xFFDC2626)),
  'cancelled': ('Cancelled', Color(0xFF94A3B8)),
};

String _typeLabel(String t) {
  final s = t.replaceAll('_', ' ');
  return s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

/// SR › Materials (portal: MaterialsTab in service-requests/[id]/page.tsx):
/// Material Request (store stock checked, the shortfall goes to Purchase),
/// the material list with PR, received qty, spares issued from / returned to
/// Store, and photos per material.
class SrMaterialsTab extends StatefulWidget {
  const SrMaterialsTab({
    super.key,
    required this.srId,
    required this.canEdit,
    required this.canAdd,
    required this.canDelete,
    required this.canRaisePr,
    required this.canIssueSpares,
    required this.canReturnSpares,
    required this.onAttachmentsChanged,
  });
  final int srId;
  final bool canEdit;
  final bool canAdd;
  final bool canDelete;
  final bool canRaisePr;
  final bool canIssueSpares;
  final bool canReturnSpares;

  /// Files that land on the SR's Attachments tab (no PR raised).
  final VoidCallback onAttachmentsChanged;

  @override
  State<SrMaterialsTab> createState() => _SrMaterialsTabState();
}

class _MrLine {
  String type = '';
  String category = '';
  int? itemId;
  final qty = TextEditingController(text: '1');
}

class _SrMaterialsTabState extends State<SrMaterialsTab> {
  List<Json>? _materials;
  String? _error;
  String? _message;
  List<Json> _items = [];
  bool _itemsLoading = false;
  int? _expanded;

  bool get _canIssue => Perm.can('store', 'issues', 'create') && widget.canIssueSpares;
  bool get _canReturn => Perm.can('store', 'issues', 'create') && widget.canReturnSpares;
  String get _base => '/erp/service-requests/${widget.srId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await Api.list('$_base/materials');
      if (mounted) {
        setState(() {
          _materials = p.rows;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _loadItems() async {
    setState(() => _itemsLoading = true);
    try {
      final p = await Api.list('/store/items', query: {'status': 'active'});
      if (mounted) setState(() => _items = p.rows);
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not load the Item Master list: ${ApiClient.describe(e)}');
    } finally {
      if (mounted) setState(() => _itemsLoading = false);
    }
  }

  // ── Material Request ───────────────────────────────────────────────────────

  Future<void> _request() async {
    if (_items.isEmpty) await _loadItems();
    if (!mounted) return;
    final lines = <_MrLine>[_MrLine()];
    final stock = <int, num>{};
    DateTime? requiredDate;
    String priority = 'standard';
    final remarks = TextEditingController();
    final specFiles = <MultipartFile>[];
    final byId = {for (final i in _items) if (i['id'] is int) i['id'] as int: i};
    final types = _items.map((i) => (i['item_type'] ?? '').toString()).where((t) => t.isNotEmpty).toSet().toList()..sort();
    List<String> catsFor(String type) => _items
        .where((i) => i['item_type'] == type)
        .map((i) => (i['category'] ?? '').toString())
        .where((c) => c.isNotEmpty)
        .toSet()
        .toList()
      ..sort();
    String? resultMessage;

    Future<void> checkStock(StateSetter setS) async {
      final ids = lines.map((l) => l.itemId).whereType<int>().where((id) => !stock.containsKey(id)).toSet().toList();
      if (ids.isEmpty) return;
      try {
        final r = await Api.get('$_base/material-request/stock', query: {'item_ids': ids.join(',')});
        if (r is Map) {
          r.forEach((k, v) => stock[int.tryParse('$k') ?? -1] = numOf(v));
          try {
            setS(() {});
          } catch (_) {
            // The sheet was closed meanwhile.
          }
        }
      } catch (_) {
        // "Checking…" stays; the server still splits the lines on submit.
      }
    }

    final saved = await showFormSheet(
      context,
      title: 'Material Request',
      saveLabel: 'Request Material',
      builder: (ctx, setS) {
        // Preview of how each line will be filled - the same item on two lines shares one stock.
        final used = <int, num>{};
        String plan(_MrLine l) {
          if (l.itemId == null) return '—';
          final avail = stock[l.itemId];
          if (avail == null) return 'Checking…';
          final q = (num.tryParse(l.qty.text) ?? 0).clamp(0, double.infinity);
          final left = (avail - (used[l.itemId!] ?? 0)).clamp(0, double.infinity);
          final fromStore = q < left ? q : left;
          used[l.itemId!] = (used[l.itemId!] ?? 0) + fromStore;
          final buy = q - fromStore;
          if (buy <= 0) return 'From store';
          if (fromStore <= 0) return 'Buy — goes to Purchase';
          return '${qtyText(fromStore)} from store + ${qtyText(buy)} to buy';
        }

        return [
          const Text(
              "Pick the parts and how many. Store stock is checked automatically — what's in store is issued by Store, the rest goes to Purchase.",
              style: TextStyle(color: Brand.muted)),
          for (var i = 0; i < lines.length; i++)
            Builder(builder: (_) {
              final l = lines[i];
              final m = l.itemId == null ? null : byId[l.itemId];
              final lineType = l.type.isNotEmpty ? l.type : (m?['item_type'] ?? '').toString();
              final cats = lineType.isEmpty ? <String>[] : catsFor(lineType);
              final lineCat = l.category.isNotEmpty
                  ? l.category
                  : (m != null && m['item_type'] == lineType ? (m['category'] ?? '').toString() : '');
              final ready = l.itemId != null || (lineType.isNotEmpty && (lineCat.isNotEmpty || cats.isEmpty));
              final shown = _items.where((it) =>
                  it['id'] == l.itemId ||
                  (it['item_type'] == lineType && (lineCat.isEmpty || it['category'] == lineCat)));
              final uom = (m?['uom'] ?? '').toString();
              final avail = l.itemId == null ? null : stock[l.itemId];
              final planText = plan(l);
              return Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      Text('Item ${i + 1}',
                          style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                      const Spacer(),
                      if (lines.length > 1)
                        TextButton(
                          onPressed: () => setS(() => lines.removeAt(i)),
                          child: const Text('Remove', style: TextStyle(color: Color(0xFFB91C1C))),
                        ),
                    ]),
                    AppSelect<String>(
                      label: 'Item Type',
                      required: true,
                      value: lineType.isEmpty ? null : lineType,
                      options: [for (final t in types) Option(t, _typeLabel(t))],
                      onChanged: (o) => setS(() {
                        l.type = o?.value ?? '';
                        l.category = '';
                        l.itemId = null;
                      }),
                    ),
                    const SizedBox(height: 10),
                    AppSelect<String>(
                      label: lineType.isEmpty ? 'Category (pick the type first)' : (cats.isEmpty ? 'No categories' : 'Category'),
                      enabled: lineType.isNotEmpty && cats.isNotEmpty,
                      value: lineCat.isEmpty ? null : lineCat,
                      options: [for (final c in cats) Option(c, c)],
                      onChanged: (o) => setS(() {
                        l.type = lineType;
                        l.category = o?.value ?? '';
                        l.itemId = null;
                      }),
                    ),
                    const SizedBox(height: 10),
                    AppSelect<int>(
                      label: _itemsLoading
                          ? 'Loading items…'
                          : !ready
                              ? (lineType.isEmpty ? 'Item (pick the type first)' : 'Item (pick the category first)')
                              : 'Item (from Item Master)',
                      required: true,
                      enabled: ready,
                      value: l.itemId,
                      valueLabel: m == null ? null : '${m['item_code']} — ${m['item_name']}',
                      options: [
                        for (final it in shown)
                          Option<int>(it['id'] as int, '${it['item_code']} — ${it['item_name']}', subtitle: _itemDetail(it)),
                      ],
                      onChanged: (o) {
                        setS(() => l.itemId = o?.value);
                        checkStock(setS);
                      },
                    ),
                    const SizedBox(height: 10),
                    Row(children: [
                      Expanded(
                        child: AppTextField(
                          label: uom.isEmpty ? 'Qty' : 'Qty ($uom)',
                          required: true,
                          controller: l.qty,
                          keyboardType: AppTextField.number,
                          onChanged: (_) => setS(() {}),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(
                              'In store: ${l.itemId == null ? '—' : avail == null ? 'Checking…' : '${qtyText(avail)} $uom'}',
                              style: const TextStyle(fontSize: 12.5, color: Brand.body)),
                          Text('Will be: $planText',
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: planText == 'From store' ? const Color(0xFF047857) : const Color(0xFFB45309))),
                        ]),
                      ),
                    ]),
                  ]),
                ),
              );
            }),
          OutlinedButton.icon(
            onPressed: () => setS(() => lines.add(_MrLine())),
            icon: const Icon(Icons.add_rounded),
            label: const Text('Add Item'),
          ),
          Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
            const Text('Part not in the list? Add it in Store › Item Master, then ',
                style: TextStyle(fontSize: 12, color: Brand.muted)),
            InkWell(
              onTap: _itemsLoading
                  ? null
                  : () async {
                      await _loadItems();
                      byId
                        ..clear()
                        ..addAll({for (final i in _items) if (i['id'] is int) i['id'] as int: i});
                      try {
                        setS(() {});
                      } catch (_) {
                        // The sheet was closed meanwhile.
                      }
                    },
              child: Text(_itemsLoading ? 'refreshing…' : 'refresh items.',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFFC2410C))),
            ),
          ]),
          const Caps('Details'),
          DateField(label: 'Required Date', value: requiredDate, onChanged: (d) => setS(() => requiredDate = d)),
          AppSelect<String>(
            label: 'Priority',
            value: priority,
            clearable: false,
            options: priorityOptions,
            onChanged: (o) => setS(() => priority = o?.value ?? 'standard'),
          ),
          AppTextField(label: 'Remarks (optional)', controller: remarks, maxLines: 2),
          const Caps('Attachments (optional)'),
          const Text('Specification / Reference File', style: TextStyle(fontSize: 12.5, color: Brand.body)),
          PickButtons(onPicked: (f) => setS(() => specFiles.addAll(f))),
          StagedFiles(files: specFiles, onRemove: (i) => setS(() => specFiles.removeAt(i))),
          const Text(
              "Attached to the purchase requisition for Purchase. If everything comes from store, they are saved in this SR's Attachments tab.",
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ];
      },
      onSave: () async {
        final picked = lines.where((l) => l.itemId != null).toList();
        if (picked.isEmpty) {
          throw "Pick at least one item from the Item Master. If it's a new part, add it first in Store › Item Master, then tap \"refresh items\".";
        }
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].itemId == null) continue;
          if (!((num.tryParse(lines[i].qty.text) ?? 0) > 0)) {
            final m = byId[lines[i].itemId];
            throw 'Line ${i + 1} (${m == null ? 'item' : m['item_name']}): quantity must be more than 0.';
          }
        }
        final r = await Api.post('$_base/material-request', data: {
          'items': [
            for (final l in picked) {'store_item_id': l.itemId, 'quantity': num.parse(l.qty.text)},
          ],
          'required_by_date': requiredDate == null ? null : apiDate(requiredDate!),
          'priority': priority,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        });
        final res = r is Map ? r : const {};
        final parts = <String>[];
        final fromStore = res['from_store'] as List? ?? const [];
        if (fromStore.isNotEmpty) parts.add('${fromStore.length} item(s) booked from store stock — Store issues them to site');
        final prId = res['pr_id'];
        if (res['pr_number'] != null) {
          parts.add("purchase requisition ${res['pr_number']} raised for what isn't in store — Purchase has been notified");
        }
        String? uploadError;
        if (specFiles.isNotEmpty) {
          try {
            if (prId != null) {
              await uploadFiles('$_base/raise-pr/$prId/attachments', specFiles, fields: {'doc_type': 'specification'});
            } else {
              await uploadFiles('$_base/attachments', specFiles);
              parts.add("documents saved in this SR's Attachments tab");
              widget.onAttachmentsChanged();
            }
          } catch (e) {
            uploadError = 'Material was requested, but some files did not upload — specification documents: '
                '${ApiClient.describe(e)}. '
                '${prId != null ? 'Ask Purchase to attach them on ${res['pr_number']}.' : "Upload them in this SR's Attachments tab."}';
          }
        }
        resultMessage = uploadError ?? 'Material requested: ${parts.join('; ')}.';
      },
    );
    _load();
    if (saved && mounted) setState(() => _message = resultMessage);
  }

  String? _itemDetail(Json i) {
    final parts = [
      if ((i['make'] ?? '').toString().isNotEmpty) 'Make: ${i['make']}',
      if ((i['part_number'] ?? i['manufacturer_part_number'] ?? '').toString().isNotEmpty)
        'Part no.: ${i['part_number'] ?? i['manufacturer_part_number']}',
      if ((i['specification'] ?? i['description'] ?? '').toString().isNotEmpty) '${i['specification'] ?? i['description']}',
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }

  // ── Row actions ────────────────────────────────────────────────────────────

  Future<void> _remove(Json m) async {
    final ok = await confirmDialog(context,
        title: 'Remove this material?',
        message: 'Remove "${m['material_name']}" from this service request? Its cost is taken out of the bill total.',
        confirmLabel: 'Remove',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('$_base/materials/${m['id']}'), success: 'Material removed.')) _load();
  }

  Future<void> _receive(Json m) async {
    final ctrl = TextEditingController();
    final max = numOf(m['quantity']);
    final saved = await showFormSheet(
      context,
      title: 'Mark received',
      saveLabel: 'Mark',
      builder: (ctx, setS) => [
        Text('${m['material_name']} — received so far ${qtyText(m['received_quantity'])}/${qtyText(max)}.',
            style: const TextStyle(color: Brand.muted)),
        AppTextField(label: 'Received quantity', required: true, controller: ctrl, keyboardType: AppTextField.number),
      ],
      onSave: () async {
        final n = num.tryParse(ctrl.text.trim());
        if (n == null) throw 'Received quantity must be a number — enter digits only.';
        final q = n < 0 ? 0 : (n > max ? max : n);
        await Api.post('$_base/materials/${m['id']}/receive', data: {'received_quantity': q});
      },
    );
    if (saved) _load();
  }

  Future<void> _issue(Json m) async {
    int? locationId = (m['location_id'] as num?)?.toInt();
    String? locationLabel;
    final outstanding = numOf(m['quantity']) - numOf(m['qty_issued']);
    final qty = TextEditingController(text: qtyText(outstanding > 0 ? outstanding : 1));
    final challan = TextEditingController();
    final vehicle = TextEditingController();
    List<Option<int>>? locations;
    try {
      final p = await Api.list('$_base/store-locations');
      locations = [for (final l in p.rows) Option<int>(l['id'] as int, txt(l['label']))];
      for (final o in locations) {
        if (o.value == locationId) locationLabel = o.label;
      }
    } catch (e) {
      if (mounted) showSnack(context, 'Could not load the stores: ${ApiClient.describe(e)}', error: true);
      return;
    }
    if (!mounted) return;
    final saved = await showFormSheet(
      context,
      title: 'Issue from Store',
      saveLabel: 'Issue',
      builder: (ctx, setS) => [
        Text('${m['material_name']} — leaves Store as a Service issue on a delivery challan.',
            style: const TextStyle(color: Brand.muted)),
        const Caps('Spare'),
        AppSelect<int>(
          label: 'Store',
          required: true,
          value: locationId,
          valueLabel: locationLabel,
          enabled: m['location_id'] == null,
          options: locations!,
          onChanged: (o) => setS(() => locationId = o?.value),
        ),
        AppTextField(label: 'Qty (${m['unit'] ?? ''})', required: true, controller: qty, keyboardType: AppTextField.number),
        const Caps('Dispatch'),
        AppTextField(label: 'Delivery challan no.', required: true, controller: challan),
        AppTextField(label: 'Vehicle / courier no. (optional)', controller: vehicle),
        const Text('Spares going to site always travel on a challan.', style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        final q = num.tryParse(qty.text.trim()) ?? 0;
        if (locationId == null) throw 'Pick the store the spare leaves from.';
        if (q <= 0) throw 'Quantity must be more than 0.';
        if (challan.text.trim().isEmpty) {
          throw 'Enter the delivery challan no. — spares going to site always travel on a challan.';
        }
        await Api.post('$_base/materials/${m['id']}/issue', data: {
          'location_id': locationId,
          'quantity': q,
          'challan_number': challan.text.trim(),
          if (vehicle.text.trim().isNotEmpty) 'vehicle_number': vehicle.text.trim(),
        });
      },
    );
    if (saved) _load();
  }

  Future<void> _return(Json m) async {
    final out = m['net_issued'] != null ? numOf(m['net_issued']) : numOf(m['qty_issued']) - numOf(m['qty_returned']);
    final qty = TextEditingController(text: qtyText(out));
    final remarks = TextEditingController();
    final saved = await showFormSheet(
      context,
      title: 'Return unused',
      saveLabel: 'Return to Store',
      builder: (ctx, setS) => [
        Text(
            '${m['material_name']} — ${qtyText(out)} ${m['unit'] ?? ''} is out on this SR. It goes back into the store it was issued from.',
            style: const TextStyle(color: Brand.muted)),
        AppTextField(label: 'Qty (${m['unit'] ?? ''})', required: true, controller: qty, keyboardType: AppTextField.number),
        AppTextField(label: 'Remarks (optional)', controller: remarks),
      ],
      onSave: () async {
        final q = num.tryParse(qty.text.trim()) ?? 0;
        if (q <= 0) throw 'Quantity must be more than 0.';
        if (q > out + 1e-9) throw 'Only ${qtyText(out)} ${m['unit'] ?? ''} is still out on this SR.';
        await Api.post('$_base/materials/${m['id']}/return', data: {
          'quantity': q,
          if (remarks.text.trim().isNotEmpty) 'remarks': remarks.text.trim(),
        });
      },
    );
    if (saved) _load();
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final mats = _materials;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 10), child: ErrorBanner(_error!)),
      if (widget.canRaisePr || widget.canAdd)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(
              _message ?? 'Need a part for this job? Raise a material request — store stock is checked for you.',
              style: TextStyle(
                  fontSize: 12.5,
                  color: _message == null
                      ? Brand.muted
                      : (_message!.startsWith('Material requested') ? const Color(0xFF047857) : Brand.danger),
                  fontWeight: _message == null ? FontWeight.w400 : FontWeight.w600),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _request,
              icon: const Icon(Icons.add_shopping_cart_rounded),
              label: const Text('Material Request'),
            ),
          ]),
        ),
      if (mats == null && _error == null) const LoadingView(),
      if (mats != null && mats.isEmpty) const EmptyView('No materials added.'),
      for (final m in mats ?? const <Json>[]) _card(m),
    ]);
  }

  Widget _card(Json m) {
    final st = _materialStatus[m['status'] ?? 'pending'] ?? _materialStatus['pending']!;
    final pr = m['pr_status'] == null ? null : (_prStatus[m['pr_status']] ?? _prStatus['submitted']!);
    final canReceive = widget.canEdit && m['pr_id'] != null && m['receiving_status'] != 'received';
    final photos = (m['attachments'] as List? ?? const []).whereType<Map>().map((x) => Map<String, dynamic>.from(x)).toList();
    final expanded = _expanded == m['id'];
    final fromStore = m['store_item_id'] == null
        ? '—'
        : [
            'Issued ${qtyText(m['qty_issued'])}',
            if (numOf(m['qty_returned']) > 0) 'returned ${qtyText(m['qty_returned'])}',
            if (m['unit_price'] != null) '₹${m['unit_price']}/${m['unit']}',
            if (m['is_warranty_covered'] == true) 'warranty',
          ].join(' · ');
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(txt(m['material_name']),
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Brand.heading)),
                  if ((m['description'] ?? '').toString().isNotEmpty)
                    Text(m['description'].toString(), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ]),
              ),
              HexPill(st.$1, st.$2, solid: true),
            ]),
            const SizedBox(height: 10),
            Wrap(spacing: 16, runSpacing: 6, children: [
              _meta('Part No.', (m['part_number'] ?? '').toString().isEmpty ? 'Not provided' : m['part_number'].toString()),
              _meta('Qty', qtyText(m['quantity'])),
              _meta('Received',
                  '${qtyText(m['received_quantity'])}/${qtyText(m['quantity'])}${m['receiving_status'] == 'received' ? ' ✓' : ''}'),
              _meta('From Store', fromStore),
            ]),
            if (pr != null) ...[
              const SizedBox(height: 8),
              HexPill('${m['pr_number'] ?? ''} · ${pr.$1}', pr.$2),
            ],
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 8, children: [
              SmallButton('Photos (${photos.length}) ${expanded ? '▴' : '▾'}',
                  onPressed: () => setState(() => _expanded = expanded ? null : m['id'] as int)),
              if (canReceive) SmallButton('Mark received', onPressed: () => _receive(m)),
              if (m['store_item_id'] != null && _canIssue) SmallButton('Issue', primary: true, icon: Icons.local_shipping_outlined, onPressed: () => _issue(m)),
              if (m['store_item_id'] != null && _canReturn && numOf(m['net_issued']) > 0)
                SmallButton('Return', onPressed: () => _return(m)),
              if (widget.canDelete && numOf(m['qty_issued']) == 0)
                SmallButton('Remove', danger: true, onPressed: () => _remove(m)),
            ]),
            if (expanded)
              _PhotoGallery(
                srId: widget.srId,
                material: m,
                photos: photos,
                canAdd: widget.canAdd,
                canDelete: widget.canDelete,
                onChanged: _load,
              ),
          ]),
        ),
      ),
    );
  }

  Widget _meta(String label, String value) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: Brand.muted)),
          Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Brand.body)),
        ],
      );
}

/// Photos of one material: take / pick (JPG/PNG), thumbnails, delete.
class _PhotoGallery extends StatefulWidget {
  const _PhotoGallery({
    required this.srId,
    required this.material,
    required this.photos,
    required this.canAdd,
    required this.canDelete,
    required this.onChanged,
  });
  final int srId;
  final Json material;
  final List<Json> photos;
  final bool canAdd;
  final bool canDelete;
  final VoidCallback onChanged;

  @override
  State<_PhotoGallery> createState() => _PhotoGalleryState();
}

class _PhotoGalleryState extends State<_PhotoGallery> {
  final _staged = <MultipartFile>[];
  bool _uploading = false;
  String? _error;

  String get _base => '/erp/service-requests/${widget.srId}/materials/${widget.material['id']}/attachments';

  Future<void> _upload() async {
    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      await uploadFiles(_base, List.of(_staged));
      _staged.clear();
      widget.onChanged();
    } catch (e) {
      setState(() => _error =
          'Could not upload photos to "${widget.material['material_name']}" — only JPG/PNG images are accepted. ${ApiClient.describe(e)}');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _delete(Json a) async {
    final ok = await confirmDialog(context,
        title: 'Delete this photo?',
        message:
            'Delete photo "${a['filename']}" from material "${widget.material['material_name']}"? The file is also removed from SharePoint and can\'t be restored.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('$_base/${a['id']}'), success: 'Photo deleted.')) widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: Brand.background, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (widget.canAdd) ...[
          PickButtons(photosOnly: true, enabled: !_uploading, onPicked: (f) => setState(() => _staged.addAll(f))),
          const SizedBox(height: 6),
          Text(_uploading ? 'Uploading…' : 'Take a photo, or pick from the gallery (JPG/PNG)',
              style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
          if (_staged.isNotEmpty) ...[
            const SizedBox(height: 8),
            StagedFiles(files: _staged, onRemove: (i) => setState(() => _staged.removeAt(i))),
            const SizedBox(height: 8),
            Row(children: [
              SmallButton(_uploading ? 'Uploading…' : 'Upload ${_staged.length}',
                  primary: true, icon: Icons.cloud_upload_outlined, onPressed: _uploading ? null : _upload),
              const SizedBox(width: 8),
              SmallButton('Cancel', onPressed: _uploading ? null : () => setState(_staged.clear)),
            ]),
          ],
          const SizedBox(height: 10),
        ],
        if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 8)],
        if (widget.photos.isEmpty)
          const Text('No photos added yet.', style: TextStyle(fontSize: 12.5, color: Brand.muted))
        else
          Wrap(spacing: 10, runSpacing: 10, children: [
            for (final a in widget.photos)
              Stack(clipBehavior: Clip.none, children: [
                InkWell(
                  onTap: () => openApiFile(context, '$_base/${a['id']}/content', txt(a['filename'])),
                  child: _Thumb(path: '$_base/${a['id']}/content'),
                ),
                if (widget.canDelete)
                  Positioned(
                    top: -8,
                    right: -8,
                    child: IconButton.filled(
                      tooltip: 'Delete ${a['filename']}',
                      style: IconButton.styleFrom(
                          backgroundColor: Brand.danger, minimumSize: const Size(28, 28), padding: EdgeInsets.zero),
                      iconSize: 14,
                      onPressed: () => _delete(a),
                      icon: const Icon(Icons.close_rounded, color: Colors.white),
                    ),
                  ),
              ]),
          ]),
      ]),
    );
  }
}

/// 64px photo thumbnail loaded with the session token.
class _Thumb extends StatefulWidget {
  const _Thumb({required this.path});
  final String path;

  @override
  State<_Thumb> createState() => _ThumbState();
}

class _ThumbState extends State<_Thumb> {
  late final Future<Uint8List> _bytes = () async {
    final r = await Api.dio.get<List<int>>(widget.path, options: Options(responseType: ResponseType.bytes));
    return Uint8List.fromList(r.data ?? const []);
  }();

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        width: 64,
        height: 64,
        child: FutureBuilder<Uint8List>(
          future: _bytes,
          builder: (ctx, s) {
            if (s.hasData && s.data!.isNotEmpty) {
              return Image.memory(s.data!,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const ColoredBox(
                      color: Colors.white, child: Icon(Icons.broken_image_outlined, color: Brand.muted)));
            }
            if (s.hasError) {
              return const ColoredBox(color: Colors.white, child: Icon(Icons.broken_image_outlined, color: Brand.muted));
            }
            return const ColoredBox(color: Colors.white, child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))));
          },
        ),
      ),
    );
  }
}
