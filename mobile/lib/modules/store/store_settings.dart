import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'store_common.dart';

// Store › Settings (gear): Item Types, Units of Measure, Categories, Stores,
// Issue Types (portal: store/settings/*, categories, locations,
// DocTypeSettings, MasterEditDialog).

class StoreSettingsScreen extends StatelessWidget {
  const StoreSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) => SubPage(
        title: 'Store settings',
        body: SubTabs(tabs: [
          if (storeTab('item_types')) ('Item Types', (_) => const _ItemTypes()),
          if (storeTab('uoms')) ('Units of Measure', (_) => const _Uoms()),
          if (storeTab('categories')) ('Categories', (_) => const _Categories()),
          if (storeTab('warehouses')) ('Stores', (_) => const _Stores()),
          if (storeTab('issue_types')) ('Issue Types', (_) => const _IssueTypes()),
        ]),
      );
}

/// Add / edit sheet for a small master (portal MasterEditDialog).
Future<bool> _masterSheet(BuildContext context,
    {required String title,
    required List<(String, String, String, bool, bool)> fields,
    required Map<String, String> initial,
    String? note,
    required Future<void> Function(Map<String, String>) onSave}) {
  final ctl = {for (final f in fields) f.$1: TextEditingController(text: initial[f.$1] ?? '')};
  return showFormSheet(
    context,
    title: title,
    builder: (ctx, setS) => [
      const Hint('Store master data — used on items and stock documents.'),
      for (final f in fields) AppTextField(label: f.$2, required: f.$4, controller: ctl[f.$1], hint: f.$3),
      if (note != null) Hint(note),
    ],
    onSave: () async {
      for (final f in fields) {
        if (f.$4 && ctl[f.$1]!.text.trim().isEmpty) throw 'Enter the ${f.$2.toLowerCase()}.';
      }
      await onSave({
        for (final f in fields) f.$1: f.$5 ? ctl[f.$1]!.text.trim().toUpperCase() : ctl[f.$1]!.text.trim(),
      });
      StoreData.clear();
    },
  );
}

Future<void> _delete(BuildContext context, String what, Future<dynamic> Function() fn, VoidCallback after) async {
  final ok = await confirmDialog(context,
      title: 'Delete this $what?', message: 'This permanently removes it. This cannot be undone.', confirmLabel: 'Delete', danger: true);
  if (!ok || !context.mounted) return;
  final done = await runAction(context, fn, success: 'Deleted.');
  if (done) {
    StoreData.clear();
    after();
  }
}

Widget _rowActions(BuildContext context, {VoidCallback? onEdit, VoidCallback? onDelete}) => Row(mainAxisSize: MainAxisSize.min, children: [
      if (onEdit != null) IconButton(tooltip: 'Edit', icon: const Icon(Icons.edit_outlined, size: 20), onPressed: onEdit),
      if (onDelete != null)
        IconButton(tooltip: 'Delete', icon: const Icon(Icons.delete_outline_rounded, size: 20, color: cRed), onPressed: onDelete),
    ]);

// Item types -------------------------------------------------------------------

class _ItemTypes extends StatefulWidget {
  const _ItemTypes();

  @override
  State<_ItemTypes> createState() => _ItemTypesState();
}

class _ItemTypesState extends State<_ItemTypes> {
  final _list = GlobalKey<ApiListViewState>();
  static const _fields = [
    ('label', 'Name', 'Spare Part', true, false),
    ('prefix', 'Code prefix (2 letters)', 'SP (blank = auto)', false, true),
  ];
  static const _note =
      'The prefix is a short 2-character tag for this type. Item codes are one running number for all items (01, 02 …) and do not use it.';

  Future<void> _edit([Json? t]) async {
    final ok = await _masterSheet(context,
        title: t == null ? 'Add Item Type' : 'Edit Item Type',
        fields: _fields,
        note: _note,
        initial: {'label': '${t?['label'] ?? ''}', 'prefix': '${t?['prefix'] ?? ''}'},
        onSave: (v) async => t == null
            ? await Api.post('/store/item-types', data: v)
            : await Api.put('/store/item-types/${Uri.encodeComponent('${t['value']}')}', data: v));
    if (ok) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('item_types', 'create') ? CreateFab(label: 'Add Item Type', onPressed: _edit) : null,
        body: ApiListView(
          key: _list,
          load: (p, s) => Api.list('/store/item-types'),
          emptyText: 'No item types yet — use + Add Item Type to create the first one.',
          header: const StorePageHeader('Item Types'),
          itemBuilder: (ctx, t, reload) => RecordCard(
            title: txt(t['label']),
            meta: [('Code Prefix', txt(t['prefix']))],
            trailing: _rowActions(ctx,
                onEdit: can('item_types', 'edit') ? () => _edit(t) : null,
                onDelete: can('item_types', 'delete')
                    ? () => _delete(ctx, 'item type', () => Api.delete('/store/item-types/${Uri.encodeComponent('${t['value']}')}'), reload)
                    : null),
          ),
        ),
      );
}

// UOMs ---------------------------------------------------------------------------

class _Uoms extends StatefulWidget {
  const _Uoms();

  @override
  State<_Uoms> createState() => _UomsState();
}

class _UomsState extends State<_Uoms> {
  final _list = GlobalKey<ApiListViewState>();
  static const _fields = [
    ('code', 'Unit code', 'KG', true, true),
    ('label', 'Unit name', 'Kilogram', false, false),
  ];

  // The API returns options ({value: 'KG', label: 'KG — Kilogram'}).
  String _name(Json o) {
    final l = '${o['label'] ?? ''}';
    final p = '${o['value']} — ';
    return l.startsWith(p) ? l.substring(p.length) : '';
  }

  Future<void> _edit([Json? u]) async {
    final ok = await _masterSheet(context,
        title: u == null ? 'Add Unit of Measure' : 'Edit Unit of Measure',
        fields: _fields,
        note: u != null
            ? 'Renaming the code also moves every item on this unit to the new code.'
            : 'Units are shared by Store items and Purchase Request lines.',
        initial: {'code': '${u?['value'] ?? ''}', 'label': u == null ? '' : _name(u)},
        onSave: (v) async => u == null
            ? await Api.post('/store/uoms', data: v)
            : await Api.put('/store/uoms/${Uri.encodeComponent('${u['value']}')}', data: v));
    if (ok) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('uoms', 'create') ? CreateFab(label: 'Add Unit', onPressed: _edit) : null,
        body: ApiListView(
          key: _list,
          load: (p, s) => Api.list('/store/uoms'),
          emptyText: 'No units yet — use + Add Unit to create the first one.',
          header: const StorePageHeader('Units of Measure'),
          itemBuilder: (ctx, u, reload) => RecordCard(
            code: txt(u['value']),
            title: _name(u).isEmpty ? '—' : _name(u),
            trailing: _rowActions(ctx,
                onEdit: can('uoms', 'edit') ? () => _edit(u) : null,
                onDelete: can('uoms', 'delete')
                    ? () => _delete(ctx, 'unit', () => Api.delete('/store/uoms/${Uri.encodeComponent('${u['value']}')}'), reload)
                    : null),
          ),
        ),
      );
}

// Categories ---------------------------------------------------------------------

class _Categories extends StatefulWidget {
  const _Categories();

  @override
  State<_Categories> createState() => _CategoriesState();
}

class _CategoriesState extends State<_Categories> {
  final _list = GlobalKey<ApiListViewState>();
  List<Json> _rows = const [];
  Json _meta = const {};

  @override
  void initState() {
    super.initState();
    StoreData.meta().then((m) {
      if (mounted) setState(() => _meta = m);
    }, onError: (Object _) {});
  }

  String _typeLabel(Object? v) {
    if (v == null) return 'All types';
    for (final t in jsonList(_meta['item_types'])) {
      if (t['value'] == v) return txt(t['label']);
    }
    return humanize(v);
  }

  Future<void> _edit([Json? c]) async {
    final name = TextEditingController(text: '${c?['name'] ?? ''}');
    final code = TextEditingController(text: '${c?['code'] ?? ''}');
    int? parent = toInt(c?['parent_id']);
    String type = '${c?['item_type'] ?? 'material'}';
    bool active = c?['is_active'] != false;
    int? pGl = toInt(c?['purchase_gl_account_id']);
    int? sGl = toInt(c?['sales_gl_account_id']);
    final top = _rows.where((x) => x['parent_id'] == null).toList();
    List<Option<int>> ledgers(String k) => [
          for (final o in jsonList(_meta[k]))
            if (toInt(o['value']) != null) Option(toInt(o['value'])!, txt(o['label'])),
        ];
    final ok = await showFormSheet(
      context,
      title: c == null ? 'Add Category' : 'Edit Category',
      saveLabel: 'Save Category',
      builder: (ctx, setS) => [
        Hint(c == null
            ? 'Group items for reports, codes and Finance ledgers.'
            : '“${c['name']}” (${c['code']}) — code and parent are fixed once created.'),
        const FormHeading('Basic Information'),
        AppTextField(label: 'Name', required: true, controller: name, hint: 'Raw Materials'),
        AppTextField(label: 'Code', controller: code, enabled: c == null, hint: 'ELE'),
        AppSelect<int>(
          label: 'Parent Category (blank = top-level)',
          enabled: c == null,
          value: parent,
          options: [for (final p in top) Option(toInt(p['id'])!, txt(p['name']))],
          onChanged: (o) => setS(() => parent = o?.value),
        ),
        Hint(c != null
            ? 'Code and parent are fixed once created.'
            : 'Leave the code blank to generate one. Picking a parent makes this a subcategory.'),
        if (parent == null) ...[
          const FormHeading('Item Type'),
          AppSelect<String>(
              label: 'Item Type',
              value: type,
              clearable: false,
              options: valueLabelOptions(_meta['item_types']),
              onChanged: (o) => setS(() => type = o?.value ?? type)),
          if (c != null) const Hint('Its subcategories follow this item type.'),
          const FormHeading('Finance Ledgers'),
          AppSelect<int>(
              label: 'Purchase ledger (blank = Finance default)',
              value: pGl,
              options: ledgers('purchase_ledgers'),
              onChanged: (o) => setS(() => pGl = o?.value)),
          AppSelect<int>(
              label: 'Sales ledger (blank = Finance default)',
              value: sGl,
              options: ledgers('sales_ledgers'),
              onChanged: (o) => setS(() => sGl = o?.value)),
          const Hint('Every item in this category books to these ledgers unless the item sets its own. Agree them with Finance.'),
        ],
        if (c != null) CheckField(label: 'Active', value: active, onChanged: (v) => setS(() => active = v)),
      ],
      onSave: () async {
        if (name.text.trim().isEmpty) throw 'Name is required.';
        final ledgerPayload = {'purchase_gl_account_id': pGl, 'sales_gl_account_id': sGl};
        if (c != null) {
          await Api.patch('/store/categories/${c['id']}', data: {
            'name': name.text.trim(),
            'is_active': active,
            if (c['parent_id'] == null) ...{'item_type': type, ...ledgerPayload},
          });
        } else {
          await Api.post('/store/categories', data: {
            'name': name.text.trim(),
            'code': blankToNull(code.text.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '')),
            'parent_id': parent,
            if (parent == null) ...{'item_type': type, ...ledgerPayload},
          });
        }
        StoreData.clear();
      },
    );
    if (ok) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('categories', 'create') ? CreateFab(label: 'Add Category', onPressed: _edit) : null,
        body: ApiListView(
          key: _list,
          load: (p, s) async {
            final r = await Api.list('/store/categories');
            _rows = r.rows;
            return r;
          },
          emptyText: 'No categories yet — use + Add Category to create the first one.',
          header: const StorePageHeader('Categories'),
          itemBuilder: (ctx, c, reload) => Padding(
            padding: EdgeInsets.only(left: c['parent_id'] != null ? 16 : 0),
            child: RecordCard(
              code: txt(c['code']),
              title: '${c['parent_id'] != null ? '↳ ' : ''}${txt(c['name'])}',
              subtitle: _typeLabel(c['item_type']),
              meta: [
                ('Parent', txt(c['parent_name'])),
                ('Purchase Ledger', c['parent_id'] != null ? 'Same as parent' : txt(c['purchase_gl_account_name'] ?? 'Finance default')),
                ('Status', c['is_active'] == true ? 'Active' : 'Inactive'),
              ],
              trailing: _rowActions(ctx,
                  onEdit: can('categories', 'edit') ? () => _edit(c) : null,
                  onDelete: can('categories', 'delete')
                      ? () => _delete(ctx, 'category', () => Api.delete('/store/categories/${c['id']}'), reload)
                      : null),
            ),
          ),
        ),
      );
}

// Stores -------------------------------------------------------------------------

class _Stores extends StatefulWidget {
  const _Stores();

  @override
  State<_Stores> createState() => _StoresState();
}

class _StoresState extends State<_Stores> {
  final _list = GlobalKey<ApiListViewState>();

  Future<void> _add() async {
    List<Json> branches = const [];
    try {
      branches = (await Api.list('/organization/branches')).rows;
    } catch (_) {}
    if (!mounted) return;
    final name = TextEditingController(), code = TextEditingController(), type = TextEditingController(), address = TextEditingController();
    int? branch;
    final ok = await showFormSheet(
      context,
      title: 'Add Store',
      saveLabel: 'Save Store',
      builder: (ctx, setS) => [
        const Hint('A physical store / warehouse that holds stock.'),
        const FormHeading('Basic Information'),
        AppTextField(label: 'Name', required: true, controller: name, hint: 'Main Store — Plant 1'),
        AppTextField(label: 'Code', required: true, controller: code, hint: 'WH-01'),
        AppSelect<int>(
          label: 'Branch',
          value: branch,
          options: [for (final b in branches) if (toInt(b['id']) != null) Option(toInt(b['id'])!, txt(b['name']))],
          onChanged: (o) => setS(() => branch = o?.value),
        ),
        AppTextField(label: 'Store Type', controller: type, hint: 'Raw Material, Finished Goods…'),
        const FormHeading('Address'),
        AppTextField(label: 'Address', controller: address, maxLines: 3),
      ],
      onSave: () async {
        final p = <String>[];
        if (name.text.trim().isEmpty) p.add('Name is required.');
        if (code.text.trim().isEmpty) p.add('Code is required.');
        if (p.isNotEmpty) throw p.join('\n');
        await Api.post('/store/locations', data: {
          'name': name.text.trim(),
          'code': code.text.trim(),
          'branch_id': branch,
          'warehouse_type': blankToNull(type.text),
          'address': blankToNull(address.text),
        });
        StoreData.clear();
      },
    );
    if (ok) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('warehouses', 'create') ? CreateFab(label: 'Add Store', onPressed: _add) : null,
        body: ApiListView(
          key: _list,
          load: (p, s) => Api.list('/store/locations'),
          emptyText: 'No stores yet — use + Add Store to create the first one.',
          header: const StorePageHeader('Stores'),
          itemBuilder: (ctx, l, reload) => RecordCard(
            code: txt(l['code']),
            title: txt(l['name']),
            subtitle: [l['branch_name'], l['warehouse_type']].where((x) => x != null).join(' · '),
            meta: [('Status', l['is_active'] == true ? 'Active' : 'Inactive')],
            trailing: _rowActions(ctx,
                onDelete: can('warehouses', 'delete')
                    ? () => _delete(ctx, 'store', () => Api.delete('/store/locations/${l['id']}'), reload)
                    : null),
          ),
        ),
      );
}

// Issue types ------------------------------------------------------------------

class _IssueTypes extends StatefulWidget {
  const _IssueTypes();

  @override
  State<_IssueTypes> createState() => _IssueTypesState();
}

class _IssueTypesState extends State<_IssueTypes> {
  final _list = GlobalKey<ApiListViewState>();

  Future<void> _edit([Json? t]) async {
    final label = TextEditingController(text: '${t?['label'] ?? ''}');
    bool active = t?['is_active'] != false;
    final ok = await showFormSheet(
      context,
      title: t == null ? 'Add issue type' : 'Edit issue type',
      builder: (ctx, setS) => [
        Hint(t == null ? 'A new issue type for the Issue Types list.' : '“${t['label']}” — changes apply to new documents.'),
        AppTextField(label: 'Name', required: true, controller: label),
        if (t != null)
          CheckField(
              label: "Active (inactive types stay on old documents but can't be picked on new ones)",
              value: active,
              onChanged: (v) => setS(() => active = v)),
      ],
      onSave: () async {
        if (label.text.trim().isEmpty) throw 'Enter the issue type name.';
        final payload = {
          'label': label.text.trim(),
          'stock_effect': null,
          'requires_issue': t?['requires_issue'] == true,
          'approver_rule': 'none',
          'approver_user_ids': <int>[],
          'is_active': active,
        };
        if (t == null) {
          await Api.post('/store/doc-types/issue', data: payload);
        } else {
          await Api.put('/store/doc-types/issue/${Uri.encodeComponent('${t['value']}')}', data: payload);
        }
      },
    );
    if (ok) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('issue_types', 'create') ? CreateFab(label: 'Add Issue Type', onPressed: _edit) : null,
        body: ApiListView(
          key: _list,
          load: (p, s) async => ApiPage(await docTypes('issue', includeInactive: true)),
          emptyText: 'No issue types yet.',
          header: const StorePageHeader('Issue Types',
              subtitle:
                  'Why material was issued (Production, Maintenance, Project…). Picked on every Material Issue, used for consumption reports.'),
          itemBuilder: (ctx, t, reload) => Opacity(
            opacity: t['is_active'] == true ? 1 : 0.55,
            child: RecordCard(
              title: txt(t['label']),
              meta: [('Status', t['is_active'] == true ? 'Active' : 'Inactive')],
              trailing: _rowActions(ctx,
                  onEdit: can('issue_types', 'edit') ? () => _edit(t) : null,
                  onDelete: can('issue_types', 'delete')
                      ? () => _delete(ctx, 'issue type',
                          () => Api.delete('/store/doc-types/issue/${Uri.encodeComponent('${t['value']}')}'), reload)
                      : null),
            ),
          ),
        ),
      );
}

