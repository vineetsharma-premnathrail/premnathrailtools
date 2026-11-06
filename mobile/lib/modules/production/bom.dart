import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'prod_common.dart';
import 'work_orders.dart';

/// Production › BOM & Routing - portal bom/ (list, new, [id]), BomForm.tsx,
/// BomEngineeringSections.tsx and DesignBomLink.tsx.

const _bomStatusLabels = <String, String>{'draft': 'Draft', 'scheduled': 'Scheduled', 'active': 'Active', 'obsolete': 'Obsolete'};
const _bomStatusHex = <String, Color>{'draft': cAmber, 'scheduled': cBlue, 'active': cGreen, 'obsolete': cGrey};
const _catLabels = <String, String>{'stock': 'Stock', 'non_stock': 'Non-stock', 'text': 'Text', 'document': 'Document'};
const _catHex = <String, Color>{'stock': cBlue, 'non_stock': cViolet, 'text': cGrey, 'document': cTeal};
const _keyLabels = <String, String>{'internal': 'Internal', 'external': 'External (job work)'};
const _confirmLabels = <String, String>{'optional': 'Optional', 'required': 'Required', 'none': 'None (milestone)'};
const _confirmShort = <String, String>{'required': 'Required', 'optional': 'Optional', 'none': 'None'};
const _stateLabels = <String, String>{'none': 'No production BOM', 'outdated': 'Design changed', 'draft': 'Draft taken', 'current': 'Up to date'};
const _stateHex = <String, Color>{'none': cRed, 'outdated': cAmber, 'draft': cBlue, 'current': cGreen};
const _changeLabels = <String, String>{'design_only': 'Missing here', 'qty_changed': 'Qty differs', 'production_only': 'Production only', 'same': 'Same'};
const _changeHex = <String, Color>{'design_only': cRed, 'qty_changed': cAmber, 'production_only': cBlue, 'same': cGreen};

Widget _bomPill(Object? s) => Pill(_bomStatusLabels['$s'] ?? humanize(s), _bomStatusHex['$s'] ?? cGrey);

num _unitCost(Json b) => (n(b['standard_material_cost']) + n(b['standard_labour_cost'])) / (n(b['base_quantity']) == 0 ? 1 : n(b['base_quantity']));

class BomTab extends StatefulWidget {
  const BomTab({super.key});

  @override
  State<BomTab> createState() => _BomTabState();
}

class _BomTabState extends State<BomTab> {
  final _list = GlobalKey<ApiListViewState>();
  final _vis = Vis('production:bom');
  String _status = '';

  void _reload() => _list.currentState?.reload();

  @override
  Widget build(BuildContext context) {
    final seeCosts = ProdPerm.feat('bom', 'costs', 'view');
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: ProdPerm.can('bom', 'create')
          ? CreateFab(
              label: 'New BOM',
              onPressed: () async {
                final id = await showBomForm(context);
                if (id != null) {
                  _reload();
                  if (context.mounted) openScreen(context, BomDetail(id: id));
                }
              })
          : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search by BOM number or product…',
        emptyText: 'No BOMs match this view — change the filters, or use “+ New BOM” to set up a product’s material list and routing.',
        load: (p, s) => Api.list('/production/boms', query: {'status': _status, 'search': s}),
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (ProdPerm.feat('bom', 'design_link', 'view')) _DesignSourcesPanel(canTransfer: ProdPerm.feat('bom', 'design_link', 'create')),
          ChipRow([
            CountChip('All statuses', null, selected: _status.isEmpty, onTap: () {
              setState(() => _status = '');
              _reload();
            }),
            for (final k in const ['draft', 'active', 'obsolete'])
              CountChip(_bomStatusLabels[k]!, null, selected: _status == k, color: _bomStatusHex[k], onTap: () {
                setState(() => _status = _status == k ? '' : k);
                _reload();
              }),
          ]),
          const SizedBox(height: 6),
        ]),
        itemBuilder: (ctx, b, reload) => RecordCard(
          code: '${b['bom_number']}',
          title: '${txt(b['product_code'])} — ${txt(b['product_name'])}',
          subtitle: b['design_bom_number'] != null
              ? '${b['design_bom_number']} ${b['design_revision_label'] ?? ''}${b['design_outdated'] == true ? ' · Design changed (${b['latest_design_revision_label']})' : ''}'
              : null,
          trailing: _bomPill(b['status']),
          meta: [
            if (_vis.column('boms', 'version')) ('Version', 'v${b['version']}'),
            if (_vis.column('boms', 'components')) ('Components', '${rowsOf(b['items']).length}'),
            if (_vis.column('boms', 'operations')) ('Operations', '${rowsOf(b['operations']).length}'),
            if (seeCosts) ('Std Cost / Unit', inr(_unitCost(b))),
            if (_vis.column('boms', 'work_orders')) ('Work Orders', fq(b['work_order_count'])),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => BomDetail(id: idOf(b['id'])!)));
            reload();
          },
        ),
      ),
    );
  }
}

/// Released Design BOMs and where Production stands on each.
class _DesignSourcesPanel extends StatefulWidget {
  const _DesignSourcesPanel({required this.canTransfer});
  final bool canTransfer;

  @override
  State<_DesignSourcesPanel> createState() => _DesignSourcesPanelState();
}

class _DesignSourcesPanelState extends State<_DesignSourcesPanel> {
  List<Json> _rows = [];
  bool _loading = true;
  bool _open = false;
  bool _all = false;
  int? _busyId;
  Object? _error;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/production/boms/design-sources', query: {'search': _search});
      if (mounted) {
        setState(() {
        _rows = rowsOf(d);
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

  Future<void> _transfer(Json r) async {
    if (r['mbom_state'] != 'none') {
      final ok = await confirmDialog(context,
          title: 'Take ${r['design_bom_number']} ${r['revision_label']} into production?',
          message: r['mbom_status'] == 'draft'
              ? 'The open draft ${r['mbom_number']} gets Design\'s current components. Its routing, scrap % and the lines Production added itself are kept.'
              : 'A new draft version is started with Design\'s components and the routing of ${r['mbom_number'] ?? 'the active version'}. The active version stays in use until the draft is activated.',
          confirmLabel: 'Transfer');
      if (!ok) return;
    }
    setState(() {
      _busyId = idOf(r['design_bom_revision_id']);
      _error = null;
    });
    try {
      final b = mapOf(await Api.post('/production/boms/from-design', data: {'design_bom_revision_id': r['design_bom_revision_id']}));
      if (mounted) openScreen(context, BomDetail(id: idOf(b['id'])!));
      _load();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = _rows.where((r) => r['mbom_state'] == 'none' || r['mbom_state'] == 'outdated').toList();
    final visible = _all ? _rows : pending;
    return DetailSection(
      'Released Design BOMs (${_loading ? '…' : pending.length} to take into production)',
      action: IconButton(
          icon: Icon(_open ? Icons.expand_less_rounded : Icons.expand_more_rounded), onPressed: () => setState(() => _open = !_open)),
      children: [
        if (_open) ...[
          const Hint(
              'Components come from Design\'s released BOM — Production adds scrap %, shop consumables and the routing, then activates. A product with a released Design BOM can\'t be keyed in by hand.'),
          const SizedBox(height: 8),
          SearchField(
              hint: 'Search Design BOM / product…',
              onChanged: (v) {
                _search = v.trim();
                _load();
              }),
          TextButton(onPressed: () => setState(() => _all = !_all), child: Text(_all ? 'Show to-do only' : 'Show all (${_rows.length})')),
          if (_error != null) errorLine(_error!),
          if (!_loading && visible.isEmpty)
            emptyLine(_rows.isEmpty ? 'No released Design BOMs yet.' : 'Every released Design BOM is already in production.'),
          for (final r in visible)
            LineCard(
              title: '${r['design_bom_number']} ${r['revision_label'] ?? ''}',
              subtitle: '${txt(r['title'])} · ${txt(r['product_code'])} — ${txt(r['product_name'])}',
              trailing: Pill(_stateLabels['${r['mbom_state']}'] ?? humanize(r['mbom_state']), _stateHex['${r['mbom_state']}'] ?? cGrey),
              lines: [
                KV('Released', fmtDateTime(r['released_at'])),
                KV('Lines', fq(r['line_count'])),
                if (r['mbom_id'] != null)
                  InkWell(
                    onTap: () => openScreen(context, BomDetail(id: idOf(r['mbom_id'])!)),
                    child: KV('Production BOM',
                        '${r['mbom_number']} v${r['mbom_version']}${r['mbom_revision_label'] != null ? ' (from ${r['mbom_revision_label']})' : ' (keyed by hand)'}',
                        color: Brand.primary),
                  ),
              ],
              actions: [
                if (widget.canTransfer && r['mbom_state'] != 'current')
                  miniBtn(
                      _busyId == idOf(r['design_bom_revision_id'])
                          ? 'Transferring…'
                          : (r['mbom_state'] == 'none'
                              ? 'Transfer to Production'
                              : (r['mbom_state'] == 'draft' ? 'Refresh draft' : 'Take new revision')),
                      _busyId != null ? null : () => _transfer(r),
                      primary: true),
              ],
            ),
        ],
      ],
    );
  }
}

// ── BOM form (new / edit draft) ──────────────────────────────────────────────

class _ItemRow {
  String category = 'stock';
  final item = Pick();
  String? uom;
  final doc = Pick();
  final text = TextEditingController();
  final qty = TextEditingController(text: '1');
  final scrap = TextEditingController(text: '0');
  final remarks = TextEditingController();
  String? makeBuy;
  String? sourceTag;
}

class _OpRow {
  final seq = TextEditingController();
  final name = TextEditingController();
  final ws = Pick();
  final setup = TextEditingController(text: '0');
  final run = TextEditingController(text: '0');
  bool gate = false;
  String controlKey = 'internal';
  String confirmation = 'optional';
  bool print = true;
  final vendor = Pick();
  final cost = TextEditingController();
  final instructions = TextEditingController();
}

/// Portal BomForm. Returns the BOM id when saved.
Future<int?> showBomForm(BuildContext context, {Json? initial}) async {
  final vis = Vis('production:bom');
  final seeCosts = ProdPerm.feat('bom', 'costs', 'view');
  final cats = vis.options('item_category', _catLabels.keys.toList(), (v) => v);
  final keys = vis.options('control_key', _keyLabels.keys.toList(), (v) => v);
  final confirms = vis.options('confirmation', _confirmLabels.keys.toList(), (v) => v);
  String pickDefault(List<String> allowed, String pref) => allowed.contains(pref) ? pref : (allowed.isEmpty ? pref : allowed.first);
  final heldCats = {for (final i in rowsOf(initial?['items'])) '${i['item_category'] ?? 'stock'}'};
  final heldKeys = {for (final o in rowsOf(initial?['operations'])) '${o['control_key'] ?? 'internal'}'};
  final heldConfirms = {for (final o in rowsOf(initial?['operations'])) '${o['confirmation'] ?? 'optional'}'};

  final product = Pick(idOf(initial?['product_item_id']), initial == null ? null : '${initial['product_code']} — ${initial['product_name']}');
  final baseQty = TextEditingController(text: fq(initial?['base_quantity'] ?? 1));
  final description = TextEditingController(text: initial?['description']?.toString() ?? '');
  final remarks = TextEditingController(text: initial?['remarks']?.toString() ?? '');
  DateTime? validFrom = parseDate(initial?['valid_from']);
  DateTime? validTo = parseDate(initial?['valid_to']);
  final change = TextEditingController(text: initial?['change_number']?.toString() ?? '');

  final items = <_ItemRow>[
    for (final i in rowsOf(initial?['items']))
      _ItemRow()
        ..category = '${i['item_category'] ?? 'stock'}'
        ..item.id = idOf(i['component_item_id'])
        ..item.label = i['component_item_id'] == null ? null : '${i['item_code']} — ${i['item_name']}'
        ..uom = i['uom']?.toString()
        ..doc.id = idOf(i['document_id'])
        ..doc.label = i['document_number']?.toString()
        ..text.text = i['line_text']?.toString() ?? ''
        ..qty.text = fq(i['quantity'])
        ..scrap.text = fq(i['scrap_percent'])
        ..remarks.text = i['remarks']?.toString() ?? ''
        ..makeBuy = i['make_buy']?.toString()
        ..sourceTag = i['source_tag']?.toString(),
  ];
  if (initial == null) items.add(_ItemRow()..category = pickDefault(cats, 'stock'));
  final ops = <_OpRow>[
    for (final o in rowsOf(initial?['operations']))
      _OpRow()
        ..seq.text = '${o['sequence']}'
        ..name.text = o['operation_name']?.toString() ?? ''
        ..ws.id = idOf(o['workstation_id'])
        ..ws.label = o['workstation_name']?.toString()
        ..setup.text = fq(o['setup_hours'])
        ..run.text = fq(o['run_hours_per_unit'])
        ..gate = o['requires_inspection'] == true
        ..controlKey = '${o['control_key'] ?? 'internal'}'
        ..confirmation = '${o['confirmation'] ?? 'optional'}'
        ..print = o['print_on_job_card'] != false
        ..vendor.id = idOf(o['vendor_id'])
        ..vendor.label = o['vendor_name']?.toString()
        ..cost.text = o['external_cost'] == null ? '' : fq(o['external_cost'])
        ..instructions.text = o['instructions']?.toString() ?? '',
  ];

  final workstations = LookupCache('/production/lookups/workstations');
  Future<List<Option<int>>> items0(String s) =>
      lookupOptions('/production/lookups/items', query: {'search': s.trim(), 'limit': 50});
  Future<List<Option<int>>> vendors(String s) => lookupOptions('/production/lookups/vendors', query: {'search': s.trim()});
  Future<List<Option<int>>> docs(String s) => lookupOptions('/production/lookups/design-documents', query: {'search': s.trim()});

  bool filled(_ItemRow r) => r.category == 'text'
      ? r.text.text.trim().isNotEmpty
      : (r.category == 'document' ? r.doc.id != null : r.item.id != null);

  Widget itemCard(BuildContext ctx, StateSetter setS, _ItemRow r) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(
              child: AppSelect<String>(
                label: 'Category',
                value: r.category,
                clearable: false,
                options: [
                  for (final e in _catLabels.entries)
                    if (cats.contains(e.key) || (heldCats.contains(e.key) && r.category == e.key)) Option(e.key, e.value),
                ],
                onChanged: (o) => setS(() => r.category = o?.value ?? r.category),
              ),
            ),
            IconButton(
                tooltip: 'Remove component',
                icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
                onPressed: () => setS(() => items.remove(r))),
          ]),
          const SizedBox(height: 10),
          if (r.category == 'text')
            AppTextField(label: 'Text', controller: r.text, hint: 'Assembly note, e.g. torque all M16 to 210 Nm')
          else if (r.category == 'document')
            AppSelect<int>(
                label: 'Design document',
                value: r.doc.id,
                valueLabel: r.doc.label,
                loadOptions: docs,
                onChanged: (o) => setS(() => r.doc.set(o)))
          else
            AppSelect<int>(
              label: 'Component${r.sourceTag != null ? ' · ${r.sourceTag}' : ''}',
              value: r.item.id,
              valueLabel: r.item.label,
              loadOptions: items0,
              onChanged: (o) => setS(() {
                r.item.set(o);
                r.uom = o?.subtitle;
              }),
            ),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(
                child: AppTextField(
                    label: 'Qty${r.uom != null && r.uom!.isNotEmpty ? ' (${r.uom})' : ''}', controller: r.qty, keyboardType: AppTextField.number)),
            const SizedBox(width: 10),
            Expanded(child: AppTextField(label: 'Scrap %', controller: r.scrap, keyboardType: AppTextField.number)),
          ]),
          const SizedBox(height: 10),
          AppTextField(label: 'Remarks', controller: r.remarks),
        ]),
      ),
    );
  }

  Widget opCard(BuildContext ctx, StateSetter setS, _OpRow o) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            SizedBox(width: 90, child: AppTextField(label: 'Seq', controller: o.seq, keyboardType: TextInputType.number)),
            const SizedBox(width: 10),
            Expanded(child: AppTextField(label: 'Operation', required: true, controller: o.name, hint: 'Cutting, Welding, Assembly…')),
            IconButton(
                tooltip: 'Remove operation',
                icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
                onPressed: () => setS(() => ops.remove(o))),
          ]),
          const SizedBox(height: 10),
          lookupSelect('Workstation', workstations, o.ws, setS),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: AppTextField(label: 'Setup hrs', controller: o.setup, keyboardType: AppTextField.number)),
            const SizedBox(width: 10),
            Expanded(child: AppTextField(label: 'Run hrs/unit', controller: o.run, keyboardType: AppTextField.number)),
          ]),
          const SizedBox(height: 10),
          AppSelect<String>(
            label: 'Control key',
            value: o.controlKey,
            clearable: false,
            options: [
              for (final e in _keyLabels.entries)
                if (keys.contains(e.key) || (heldKeys.contains(e.key) && o.controlKey == e.key)) Option(e.key, e.value),
            ],
            onChanged: (v) => setS(() => o.controlKey = v?.value ?? o.controlKey),
          ),
          const SizedBox(height: 10),
          AppSelect<String>(
            label: 'Confirmation',
            value: o.confirmation,
            clearable: false,
            options: [
              for (final e in _confirmLabels.entries)
                if (confirms.contains(e.key) || (heldConfirms.contains(e.key) && o.confirmation == e.key)) Option(e.key, e.value),
            ],
            onChanged: (v) => setS(() => o.confirmation = v?.value ?? o.confirmation),
          ),
          CheckField(label: 'Quality gate', value: o.gate, onChanged: (v) => setS(() => o.gate = v)),
          CheckField(label: 'Print on job card', value: o.print, onChanged: (v) => setS(() => o.print = v)),
          if (o.controlKey == 'external') ...[
            AppSelect<int>(
                label: 'Job-work vendor',
                required: true,
                value: o.vendor.id,
                valueLabel: o.vendor.label,
                loadOptions: vendors,
                onChanged: (v) => setS(() => o.vendor.set(v))),
            if (seeCosts) ...[
              const SizedBox(height: 10),
              AppTextField(label: 'Charge / unit (₹)', controller: o.cost, keyboardType: AppTextField.number),
            ],
            const SizedBox(height: 10),
          ],
          AppTextField(label: 'Work instructions', controller: o.instructions, hint: 'Drawing ref, torque values, WPS number…'),
        ]),
      ),
    );
  }

  int? savedId;
  final saved = await showFormSheet(
    context,
    title: initial == null ? 'New BOM' : 'Edit ${initial['bom_number']} · v${initial['version']}',
    saveLabel: initial == null ? 'Save Draft BOM' : 'Save Changes',
    builder: (ctx, setS) => [
      Hint(initial == null
          ? 'Components and routing for one finished / semi-finished Store item. It saves as a draft until activated.'
          : '${initial['product_code']} — ${initial['product_name']}. Only a draft can be edited; an active BOM changes through a New Version.'),
      if (vis.section('product')) ...[
        const Caps('Product'),
        if (initial == null)
          AppSelect<int>(
              label: 'Product (Store item)',
              required: true,
              value: product.id,
              valueLabel: product.label,
              loadOptions: items0,
              onChanged: (o) => setS(() => product.set(o)))
        else
          FieldRow('Product (Store item)', product.label),
        AppTextField(label: 'Base Quantity', required: true, controller: baseQty, keyboardType: AppTextField.number),
        Hint('Component quantities below are per ${baseQty.text.isEmpty ? '1' : baseQty.text} unit(s) of the product. The product must exist in the Store item master.'),
      ],
      if (vis.section('validity_change')) ...[
        const Caps('Validity & Change (optional)'),
        DateField(label: 'Valid From', value: validFrom, onChanged: (d) => setS(() => validFrom = d)),
        DateField(label: 'Valid To', value: validTo, onChanged: (d) => setS(() => validTo = d)),
        AppTextField(label: 'Change Number', controller: change, hint: 'ECN no. or change ref'),
        const Hint(
            'Work orders can only use this version when their planned start falls inside its validity. A future "Valid From" keeps the current version in force until the day before.'),
      ],
      if (vis.section('notes')) ...[
        const Caps('Notes (optional)'),
        AppTextField(label: 'Description', controller: description, maxLines: 3),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      ],
      if (vis.section('components')) ...[
        Caps('Components (${items.where(filled).length})'),
        for (final r in items) itemCard(ctx, setS, r),
        if (items.isEmpty) const Hint('No components yet — a BOM needs at least one before it can be activated.'),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
          onPressed: () => setS(() => items.add(_ItemRow()..category = pickDefault(cats, 'stock'))),
          icon: const Icon(Icons.add_rounded),
          label: const Text('Add Component'),
        ),
      ],
      if (vis.section('routing')) ...[
        Caps('Routing Operations (${ops.length})'),
        const Hint(
            'Planned hours on a work order = setup + run hours × quantity. Tick "Quality gate" to require a passed Quality inspection before the step can be completed.'),
        for (final o in ops) opCard(ctx, setS, o),
        if (ops.isEmpty) const Hint('No operations yet. A work order needs at least one operation before it can be released.'),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
          onPressed: () => setS(() {
            final maxSeq = ops.fold<int>(0, (m, o) => (int.tryParse(o.seq.text) ?? 0) > m ? int.tryParse(o.seq.text)! : m);
            ops.add(_OpRow()
              ..seq.text = '${maxSeq + 10}'
              ..controlKey = pickDefault(keys, 'internal')
              ..confirmation = pickDefault(confirms, 'optional'));
          }),
          icon: const Icon(Icons.add_rounded),
          label: const Text('Add Operation'),
        ),
      ],
    ],
    onSave: () async {
      if (product.id == null) throw 'Pick the product this BOM builds.';
      final base = numOf(baseQty.text) ?? 0;
      if (!(base > 0)) throw 'Base quantity must be more than zero.';
      final filledItems = items.where(filled).toList();
      if (filledItems.any((r) => !((numOf(r.qty.text) ?? 0) > 0))) throw 'Every component needs a quantity above zero.';
      if (validFrom != null && validTo != null && validTo!.isBefore(validFrom!)) {
        throw "'Valid to' is before 'Valid from' — clear it or pick a later date.";
      }
      for (final o in ops) {
        if (o.controlKey == 'external' && o.vendor.id == null) {
          throw 'Operation ${o.seq.text} is external (subcontracted) — pick the job-work vendor.';
        }
      }
      if (filledItems.any((r) => (numOf(r.scrap.text) ?? 0) < 0 || (numOf(r.scrap.text) ?? 0) >= 100)) throw 'Scrap % must be between 0 and 99.';
      if (ops.any((o) => o.name.text.trim().isEmpty)) throw 'Every routing operation needs a name — remove empty operation rows.';
      if (ops.any((o) => !((int.tryParse(o.seq.text.trim()) ?? 0) >= 1))) throw 'Every routing operation needs a sequence number of 1 or more.';
      String? t(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
      final payload = {
        if (initial == null) 'product_item_id': product.id,
        'base_quantity': base,
        'description': t(description),
        'remarks': t(remarks),
        'valid_from': validFrom == null ? null : apiDate(validFrom!),
        'valid_to': validTo == null ? null : apiDate(validTo!),
        'change_number': t(change),
        'items': [
          for (final r in filledItems)
            {
              'component_item_id': r.category == 'text' ? null : r.item.id,
              'quantity': numOf(r.qty.text),
              'scrap_percent': numOf(r.scrap.text) ?? 0,
              'remarks': t(r.remarks),
              'item_category': r.category,
              'line_text': t(r.text),
              'document_id': r.category == 'document' ? r.doc.id : null,
              'make_buy': r.makeBuy,
              'source_tag': r.sourceTag,
            },
        ],
        'operations': [
          for (final o in ops)
            {
              'sequence': int.tryParse(o.seq.text.trim()),
              'operation_name': o.name.text.trim(),
              'workstation_id': o.ws.id,
              'setup_hours': numOf(o.setup.text) ?? 0,
              'run_hours_per_unit': numOf(o.run.text) ?? 0,
              'requires_inspection': o.gate,
              'instructions': t(o.instructions),
              'control_key': o.controlKey,
              'confirmation': o.confirmation,
              'print_on_job_card': o.print,
              'vendor_id': o.controlKey == 'external' ? o.vendor.id : null,
              'external_cost': o.controlKey == 'external' ? numOf(o.cost.text) : null,
            },
        ],
      };
      final r = initial == null
          ? await Api.post('/production/boms', data: payload)
          : await Api.patch('/production/boms/${initial['id']}', data: payload);
      savedId = idOf(mapOf(r)['id']) ?? idOf(initial?['id']);
    },
  );
  return saved ? savedId : null;
}

// ── Detail ───────────────────────────────────────────────────────────────────

class BomDetail extends StatefulWidget {
  const BomDetail({super.key, required this.id});
  final int id;

  @override
  State<BomDetail> createState() => _BomDetailState();
}

class _BomDetailState extends State<BomDetail> {
  final _vis = Vis('production:bom');
  Json? _bom;
  bool _loading = true;
  bool _busy = false;
  Object? _error;

  bool _f(String f, String a) => ProdPerm.feat('bom', f, a);
  bool get _canApprove => _f('lifecycle', 'approve');
  bool get _canSubmit => _f('lifecycle', 'submit');
  bool get _canNewVersion => _f('lifecycle', 'create');
  bool get _seeCosts => _f('costs', 'view');
  bool get _seeRouting => _f('routing', 'view');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = mapOf(await Api.get('/production/boms/${widget.id}'));
      if (mounted) {
        setState(() {
        _bom = d;
        _loading = false;
        _error = null;
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

  Future<void> _run(Future<dynamic> Function() fn) async {
    setState(() => _busy = true);
    try {
      final r = await fn();
      if (r is Map && r['id'] != null && mounted) setState(() => _bom = mapOf(r));
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _newVersion() async {
    setState(() => _busy = true);
    try {
      final created = mapOf(await Api.post('/production/boms/${widget.id}/new-version'));
      if (mounted) Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => BomDetail(id: idOf(created['id'])!)));
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  List<BarAction> _actions(Json b) {
    final s = '${b['status']}';
    return [
      if (s == 'draft' && (_canApprove || _canSubmit))
        BarAction(_canApprove ? 'Activate BOM' : 'Submit for Activation', primary: true, () async {
          final ok = await confirmDialog(context,
              title: _canApprove ? 'Activate this BOM?' : 'Submit this BOM for activation?',
              message: _canApprove
                  ? 'It becomes the active version for this product and locks for editing. Any currently active version becomes obsolete. Existing work orders keep their own material list.'
                  : 'A BOM approver is asked to activate it. It stays a draft (and locked for editing) until they decide.',
              confirmLabel: _canApprove ? 'Activate' : 'Submit');
          if (ok) await _run(() => Api.post('/production/boms/${widget.id}/activate'));
        }),
      if (s == 'draft' && ProdPerm.can('bom', 'edit'))
        BarAction('Edit', () async {
          final id = await showBomForm(context, initial: b);
          if (id != null) _load();
        }),
      if (s == 'draft' && ProdPerm.canDeleteOwn('bom', b['created_by_id']))
        BarAction('Delete Draft', danger: true, () async {
          final ok = await confirmDialog(context, title: 'Delete draft BOM?', message: 'This draft will be removed.', confirmLabel: 'Delete', danger: true);
          if (!ok || !mounted) return;
          final done = await runAction(context, () => Api.delete('/production/boms/${widget.id}'));
          if (done && mounted) Navigator.of(context).pop();
        }),
      if (s == 'active' && ProdPerm.can('work_orders', 'create'))
        BarAction('+ Raise Work Order', primary: true,
            () => openNewWorkOrder(context, bomId: widget.id, bomLabel: '${b['product_code']} — ${b['product_name']} (${b['bom_number']} v${b['version']})')),
      if (s == 'active' && _canNewVersion) BarAction('New Version', _newVersion),
      if (s == 'active' && _canApprove)
        BarAction('Mark Obsolete', danger: true, () async {
          final ok = await confirmDialog(context,
              title: 'Mark BOM obsolete?',
              message: 'No new work orders can be raised from it. Existing work orders are not affected.',
              confirmLabel: 'Mark Obsolete',
              danger: true);
          if (ok) await _run(() => Api.post('/production/boms/${widget.id}/obsolete'));
        }),
      if (s == 'obsolete' && _canNewVersion) BarAction('New Version from this', _newVersion),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final b = _bom;
    final actions = b == null ? const <BarAction>[] : _actions(b);
    return SubPage(
      title: b == null ? 'BOM' : '${b['bom_number']} · v${b['version']}',
      bottom: actions.isEmpty ? null : BottomActions(actions, busy: _busy),
      body: DetailBody(loading: _loading, error: _error, onRefresh: _load, children: b == null ? const [] : _body(b)),
    );
  }

  List<Widget> _body(Json b) {
    final items = rowsOf(b['items']);
    final ops = rowsOf(b['operations']);
    const ct = 'detail_components';
    const rt = 'detail_routing';
    return [
      if (_vis.section('detail_summary'))
        DetailSection('${txt(b['product_code'])} — ${txt(b['product_name'])}', children: [
          Text(
              txt(b['description'] ??
                  'Material list${_seeRouting ? ' and routing' : ''} to make ${fq(b['base_quantity'])} ${b['product_uom'] ?? 'unit(s)'} of this product — ${items.length} component(s)${_seeRouting ? ', ${ops.length} operation(s)' : ''}.'),
              style: const TextStyle(fontSize: 13.5)),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [_bomPill(b['status']), Pill('Version ${b['version']}', cGrey)]),
          const SizedBox(height: 6),
          KV('Valid', '${b['valid_from'] != null ? fmtDate(b['valid_from']) : 'from activation'} → ${b['valid_to'] != null ? fmtDate(b['valid_to']) : 'open'}'),
          KV('Used by', '${fq(b['work_order_count'])} work order(s)', bold: true),
          if (b['status'] == 'scheduled')
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Hint(
                  'Approved, in force from ${fmtDate(b['valid_from'])}. Until then the current active version is used; work orders starting on or after that date use this one.',
                  color: const Color(0xFF1D4ED8)),
            ),
        ]),
      if (_vis.section('detail_quantity_change'))
        DetailSection('Quantity & change control', children: [
          FieldRow('Base quantity', '${fq(b['base_quantity'])} ${b['product_uom'] ?? ''}'),
          FieldRow('Change number', b['ecn_number'] ?? b['change_number']),
          if (b['effective_serial'] != null) FieldRow('Effective from serial', b['effective_serial']),
        ]),
      if (_seeCosts)
        DetailSection('Standard cost', children: [
          KV('Material', inr(b['standard_material_cost'])),
          KV('Labour', inr(b['standard_labour_cost'])),
          KV('Cost per unit', inr(_unitCost(b)), bold: true),
          const SizedBox(height: 4),
          const Hint('Standard costs use each component\'s Store standard cost (or moving-average cost) and each workstation\'s hourly rate.'),
        ]),
      if (_vis.section('detail_record'))
        DetailSection('Record', children: [
          FieldRow('Created by', b['created_by_name']),
          FieldRow('Activated', b['activated_at'] != null ? '${fmtDateTime(b['activated_at'])} by ${txt(b['activated_by_name'])}' : null),
          if (b['remarks'] != null) FieldRow('Remarks', b['remarks']),
        ]),
      ApprovalSection(entityType: 'production_bom', entityId: widget.id, title: 'Activation approval', onChanged: _load),
      if (b['design_bom_id'] != null && _f('design_link', 'view'))
        _DesignDiff(
            key: ValueKey('diff-${b['design_bom_revision_id']}-${items.length}'),
            bom: b,
            canTransfer: _f('design_link', 'create'),
            onChanged: (nb) {
              if (idOf(nb['id']) == widget.id) {
                setState(() => _bom = nb);
              } else {
                Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => BomDetail(id: idOf(nb['id'])!)));
              }
            }),
      if (_vis.section('detail_components'))
        DetailSection('Components (${items.length})', children: [
          if (items.isEmpty) emptyLine('No components on this BOM yet.'),
          for (final i in items)
            LineCard(
              title: i['item_category'] == 'text'
                  ? txt(i['line_text'])
                  : (i['item_category'] == 'document'
                      ? '${i['document_number'] ?? 'Document #${i['document_id']}'}'
                      : '${txt(i['item_code'])} — ${txt(i['item_name'])}'),
              subtitle: '${i['has_bom'] == true ? 'SUB-ASSEMBLY' : ''}${i['source_tag'] != null ? '${i['has_bom'] == true ? ' · ' : ''}${i['source_tag']}' : ''}',
              trailing: Text('${fq(i['quantity'])} ${_vis.column(ct, 'uom') ? (i['uom'] ?? '') : ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
              lines: [
                if (_vis.column(ct, 'category')) KV('Category', _catLabels['${i['item_category'] ?? 'stock'}'] ?? humanize(i['item_category'])),
                if (_vis.column(ct, 'make_buy')) KV('Make / Buy', i['make_buy'] == null ? '—' : (i['make_buy'] == 'make' ? 'Make' : 'Buy')),
                if (_vis.column(ct, 'scrap')) KV('Scrap %', '${fq(i['scrap_percent'])}%'),
                if (_seeCosts) ...[
                  KV('Unit Cost', n(i['unit_cost']) > 0 ? inr(i['unit_cost']) : 'not set', color: n(i['unit_cost']) > 0 ? null : cBrown),
                  KV('Line Cost', inr(n(i['quantity']) * (1 + n(i['scrap_percent']) / 100) * n(i['unit_cost']))),
                ],
                if (_vis.column(ct, 'remarks') && i['remarks'] != null) KV('Remarks', txt(i['remarks'])),
              ],
            ),
        ]),
      if (_seeRouting && _vis.section('detail_routing'))
        DetailSection('Routing (${ops.length})', children: [
          if (ops.isEmpty) emptyLine('No routing operations — a work order needs at least one before it can be released.'),
          for (final o in ops)
            LineCard(
              title: '${o['sequence']} · ${txt(o['operation_name'])}',
              subtitle: _vis.column(rt, 'instructions') ? o['instructions']?.toString() : null,
              trailing: Wrap(spacing: 4, children: [
                if (_vis.column(rt, 'control_key') && o['control_key'] == 'external') const Pill('External', cViolet),
                if (_vis.column(rt, 'quality_gate') && o['requires_inspection'] == true) const Pill('Inspection', cTeal),
              ]),
              lines: [
                if (_vis.column(rt, 'workstation'))
                  KV(
                      o['control_key'] == 'external' ? 'Vendor' : 'Workstation',
                      o['control_key'] == 'external'
                          ? '${txt(o['vendor_name'])}${_seeCosts && n(o['external_cost']) > 0 ? ' · ${inr(o['external_cost'])}/unit' : ''}'
                          : txt(o['workstation_name'])),
                if (_vis.column(rt, 'setup')) KV('Setup hrs', fq(o['setup_hours'])),
                if (_vis.column(rt, 'run')) KV('Run hrs / unit', fq(o['run_hours_per_unit'])),
                if (_vis.column(rt, 'confirmation')) KV('Confirmation', _confirmShort['${o['confirmation'] ?? 'optional'}'] ?? '—'),
                if (_vis.column(rt, 'print')) KV('Print', o['print_on_job_card'] == false ? 'No' : 'Yes'),
              ],
            ),
        ]),
      if (_f('discipline_merge', 'view'))
        _MergeSection(
            bom: b,
            canEdit: _f('discipline_merge', 'create'),
            canRemove: _f('discipline_merge', 'delete'),
            onChanged: (nb) => setState(() => _bom = nb)),
      if (_f('explosion', 'view')) _Explosion(bom: b, showCosts: _seeCosts),
    ];
  }
}

class _DesignDiff extends StatefulWidget {
  const _DesignDiff({super.key, required this.bom, required this.canTransfer, required this.onChanged});
  final Json bom;
  final bool canTransfer;
  final ValueChanged<Json> onChanged;

  @override
  State<_DesignDiff> createState() => _DesignDiffState();
}

class _DesignDiffState extends State<_DesignDiff> {
  Json? _diff;
  Object? _error;
  bool _busy = false;
  bool _same = false;

  @override
  void initState() {
    super.initState();
    Api.get('/production/boms/${widget.bom['id']}/design-diff').then((d) {
      if (mounted) setState(() => _diff = mapOf(d));
    }).catchError((Object e) {
      if (mounted) setState(() => _error = e);
    });
  }

  Future<void> _refresh() async {
    final b = widget.bom;
    final draft = b['status'] == 'draft';
    final ok = await confirmDialog(context,
        title: draft ? 'Refresh this draft from Design?' : 'Take ${b['latest_design_revision_label']} into a new version?',
        message: draft
            ? 'Design\'s current components replace this draft\'s Design lines. The routing, scrap % and lines Production added itself are kept.'
            : 'A new draft version is started with Design\'s current components and this version\'s routing. This version stays active until the draft is activated.',
        confirmLabel: 'Refresh');
    if (!ok) return;
    setState(() => _busy = true);
    try {
      final r = mapOf(await Api.post('/production/boms/from-design', data: {'design_bom_revision_id': b['latest_design_revision_id']}));
      widget.onChanged(r);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.bom;
    final d = _diff;
    final rows = rowsOf(d?['rows']).where((r) => _same || r['change'] != 'same').toList();
    final live = b['status'] == 'draft' || b['status'] == 'active';
    return DetailSection('Design BOM link', children: [
      Text(
          'Taken from ${b['design_bom_number']} ${b['design_revision_label'] ?? ''}${b['transferred_at'] != null ? ' on ${fmtDateTime(b['transferred_at'])}${b['transferred_by_name'] != null ? ' by ${b['transferred_by_name']}' : ''}' : ''}${b['latest_design_revision_label'] != null ? ' · Design\'s current release: ${b['latest_design_revision_label']}' : ''}',
          style: const TextStyle(fontSize: 13)),
      const SizedBox(height: 6),
      Row(children: [
        b['design_outdated'] == true ? const Pill('Design changed', cAmber) : const Pill('Up to date', cGreen),
        const Spacer(),
        if (widget.canTransfer && live && b['design_outdated'] == true)
          miniBtn(
              _busy ? 'Refreshing…' : (b['status'] == 'draft' ? 'Refresh from Design' : 'Take ${b['latest_design_revision_label']} into a new version'),
              _busy ? null : _refresh,
              primary: true),
      ]),
      if (_error != null) errorLine(_error!),
      if (d != null) ...[
        const SizedBox(height: 6),
        Hint(n(d['differences']) == 0
            ? 'Components match ${d['design_bom_number']} ${d['compared_revision_label']}.'
            : '${d['differences']} difference(s) against ${d['design_bom_number']} ${d['compared_revision_label']}. "Production only" lines are ones Production added itself (e.g. shop consumables) and are kept on refresh.'),
        CheckField(label: 'Show matching lines', value: _same, onChanged: (v) => setState(() => _same = v)),
        for (final r in rows)
          LineCard(
            title: '${txt(r['item_code'])} — ${txt(r['item_name'])}',
            trailing: Pill(_changeLabels['${r['change']}'] ?? humanize(r['change']), _changeHex['${r['change']}'] ?? cGrey),
            lines: [
              KV('Design qty / unit', r['design_qty'] != null ? '${fq(r['design_qty'])} ${r['uom'] ?? ''}' : '—'),
              KV('Production qty / unit', r['production_qty'] != null ? '${fq(r['production_qty'])} ${r['uom'] ?? ''}' : '—'),
              KV('Make / Buy', r['design_make_buy'] != null ? humanize(r['design_make_buy']) : '—'),
            ],
          ),
      ],
    ]);
  }
}

class _MergeSection extends StatefulWidget {
  const _MergeSection({required this.bom, required this.canEdit, required this.canRemove, required this.onChanged});
  final Json bom;
  final bool canEdit;
  final bool canRemove;
  final ValueChanged<Json> onChanged;

  @override
  State<_MergeSection> createState() => _MergeSectionState();
}

class _MergeSectionState extends State<_MergeSection> {
  bool _busy = false;

  Future<void> _merge() async {
    final b = widget.bom;
    List<Json>? sources;
    String? pick;
    final mult = TextEditingController(text: '1');
    Json? result;
    final saved = await showFormSheet(
      context,
      title: 'Merge Electrical / Hydraulic BOM',
      saveLabel: 'Merge into BOM',
      builder: (ctx, setS) {
        if (sources == null) {
          sources = const [];
          Api.get('/production/boms/discipline-sources/list').then((d) {
            try {
              setS(() => sources = rowsOf(d));
            } catch (_) {}
          }).catchError((_) {});
        }
        Json? chosen;
        for (final s in sources!) {
          if ('${s['source_type']}:${s['source_id']}' == pick) chosen = s;
        }
        return [
          Hint('Into ${b['bom_number']} · v${b['version']}'),
          AppSelect<String>(
            label: 'Electrical job / hydraulic BOM',
            value: pick,
            options: [
              for (final s in sources!)
                Option('${s['source_type']}:${s['source_id']}',
                    '${s['label']}${s['title'] != null ? ' — ${s['title']}' : ''}${s['mergeable'] == true ? '' : ' (not ready)'}'),
            ],
            onChanged: (o) => setS(() => pick = o?.value),
          ),
          if (chosen != null && chosen['mergeable'] != true) Hint(txt(chosen['problem']), color: cBrown),
          AppTextField(label: 'Sets per unit', controller: mult, keyboardType: AppTextField.number),
          const Hint('Its lines are added per Item Master code, multiplied by the sets per unit, and tagged with their source.'),
        ];
      },
      onSave: () async {
        Json? chosen;
        for (final s in sources ?? const <Json>[]) {
          if ('${s['source_type']}:${s['source_id']}' == pick) chosen = s;
        }
        if (chosen == null) throw 'Pick the electrical job or hydraulic BOM to merge.';
        if (chosen['mergeable'] != true) throw '${chosen['problem'] ?? 'This BOM cannot be merged yet.'}';
        result = mapOf(await Api.post('/production/boms/${b['id']}/merge-discipline',
            data: {'source_type': chosen['source_type'], 'source_id': chosen['source_id'], 'multiplier': numOf(mult.text) ?? 1}));
      },
    );
    if (saved && result != null) widget.onChanged(result!);
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.bom;
    final merges = rowsOf(b['discipline_merges']);
    final draft = b['status'] == 'draft';
    if (merges.isEmpty && !(draft && widget.canEdit)) return const SizedBox.shrink();
    return DetailSection('Electrical & Hydraulic BOMs (${merges.length})',
        action: draft && widget.canEdit ? miniBtn('+ Merge BOM', _busy ? null : _merge) : null,
        children: [
          const Hint(
              'Released discipline BOMs merged into this manufacturing BOM, so their parts are reserved, issued and planned with the rest. Lines are added per Item Master code and tagged with their source.'),
          for (final m in merges)
            LineCard(
              title: txt(m['source_label']),
              subtitle: m['merged_at'] != null ? '${fmtDateTime(m['merged_at'])} by ${txt(m['merged_by_name'])}' : null,
              trailing: Text('${fq(m['line_count'])} items'),
              actions: [
                if (draft && widget.canRemove)
                  miniBtn('Remove', _busy
                      ? null
                      : () async {
                          final ok = await confirmDialog(context,
                              title: 'Remove this merged BOM?',
                              message: 'Its quantities are taken back off the components it added to. You can merge it again later.',
                              confirmLabel: 'Remove',
                              danger: true);
                          if (!ok) return;
                          setState(() => _busy = true);
                          try {
                            widget.onChanged(mapOf(await Api.delete('/production/boms/${b['id']}/discipline-merges/${m['id']}')));
                          } catch (e) {
                            if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
                          } finally {
                            if (mounted) setState(() => _busy = false);
                          }
                        }, danger: true),
              ],
            ),
        ]);
  }
}

class _Explosion extends StatefulWidget {
  const _Explosion({required this.bom, required this.showCosts});
  final Json bom;
  final bool showCosts;

  @override
  State<_Explosion> createState() => _ExplosionState();
}

class _ExplosionState extends State<_Explosion> {
  late final _qty = TextEditingController(text: fq(n(widget.bom['base_quantity']) == 0 ? 1 : widget.bom['base_quantity']));
  bool _open = false;
  bool _loading = false;
  Json? _data;
  Object? _error;

  Future<void> _load() async {
    final q = numOf(_qty.text) ?? 0;
    if (!(q > 0)) {
      setState(() => _error = 'Enter a quantity above zero to explode.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = mapOf(await Api.get('/production/boms/${widget.bom['id']}/explosion', query: {'qty': q}));
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return DetailSection('Multi-level Explosion (Indented BOM)',
        action: miniBtn(_open ? 'Hide' : 'Show tree', () {
          if (!_open && d == null) _load();
          setState(() => _open = !_open);
        }),
        children: [
          if (_open) ...[
            Row(children: [
              Expanded(child: AppTextField(label: 'For qty', controller: _qty, keyboardType: AppTextField.number)),
              const SizedBox(width: 10),
              miniBtn(_loading ? 'Exploding…' : 'Explode', _loading ? null : _load),
            ]),
            if (_error != null) errorLine(_error!),
            if (d != null) ...[
              const SizedBox(height: 8),
              Hint(
                  '${rowsOf(d['rows']).length} line(s) over ${d['max_level']} level(s) for ${fq(d['quantity'])} × ${d['product_code']}.${widget.showCosts && d['total_material_cost'] != null ? ' Material cost from purchased (leaf) items: ${inr(d['total_material_cost'])}.' : ''} Sub-assemblies use their own valid Production BOM.'),
              if (rowsOf(d['rows']).isEmpty) emptyLine('No components.'),
              for (final r in rowsOf(d['rows']))
                LineCard(
                  indent: ((n(r['level']) - 1).clamp(0, 6)) * 14.0,
                  title:
                      '${r['item_category'] == 'text' ? txt(r['line_text']) : '${r['item_code'] ?? ''} — ${r['item_name'] ?? ''}'}${r['cycle'] == true ? ' · cycle — not exploded' : ''}',
                  subtitle: 'Level ${r['level']} (${r['path']})${r['source_tag'] != null ? ' · ${r['source_tag']}' : ''}',
                  trailing: Pill(_catLabels['${r['item_category']}'] ?? humanize(r['item_category']), _catHex['${r['item_category']}'] ?? cGrey),
                  lines: [
                    KV('Qty / parent', r['item_category'] == 'text' ? '—' : fq(r['quantity_per'])),
                    KV('Total qty',
                        r['item_category'] == 'text' || r['item_category'] == 'document' ? '—' : '${fq(r['total_quantity'])} ${r['uom'] ?? ''}'),
                    KV('Make / Buy', r['make_buy'] == null ? '—' : (r['make_buy'] == 'make' ? 'Make' : 'Buy')),
                    KV('Sub-BOM', txt(r['bom_number'])),
                    if (widget.showCosts) KV('Ext. cost', n(r['extended_cost']) > 0 ? inr(r['extended_cost']) : '—'),
                  ],
                ),
            ],
          ],
        ]);
  }
}
