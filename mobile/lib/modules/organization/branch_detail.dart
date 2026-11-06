import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'branch_forms.dart';
import 'org_common.dart';

/// Organization › Branches › one branch - native copy of plants/[id]/page.tsx
/// with the editing of plants/[id]/edit/page.tsx folded into each tab
/// (Edit buttons and per-entry Add / Edit / Delete, shown with Edit rights).
class BranchDetailScreen extends StatefulWidget {
  const BranchDetailScreen({super.key, required this.branchId, required this.name});
  final int branchId;
  final String name;

  @override
  State<BranchDetailScreen> createState() => _BranchDetailScreenState();
}

class _BranchData {
  _BranchData(this.branch, this.addresses, this.assignments, this.departments, this.stores, this.costCenters,
      this.documents);
  final Json branch;
  final List<Json> addresses, assignments, departments, stores, costCenters, documents;
}

const _tabs = [
  ('basic', 'Basic'),
  ('address', 'Address'),
  ('operations', 'Operations'),
  ('users', 'Users'),
  ('departments', 'Departments'),
  ('stores', 'Stores'),
  ('cost_centers', 'Cost Centers'),
  ('documents', 'Documents'),
];

const _green = Color(0xFF047857);
const _red = Color(0xFFB91C1C);

bool _feat(String feature, String action) => Perm.canFeature('organization', 'branches', feature, action);

class _BranchDetailScreenState extends State<BranchDetailScreen> {
  String _tab = 'basic';
  late Future<_BranchData> _future = _load();

  // Plant features (core/features/organization.py): Branch Users / Branch Documents.
  bool get _seeUsers => _feat('user_assignments', 'view');
  bool get _seeDocs => _feat('documents', 'view');
  bool get _canEdit => orgCan('branches', 'edit');
  // The edit page shows Branch Users only with its Edit.
  bool get _editUsers => _canEdit && _feat('user_assignments', 'edit');

  bool _seeTab(String t) => t == 'users' ? _seeUsers : (t == 'documents' ? _seeDocs : true);

  int get _id => widget.branchId;

  Future<List<Json>> _rows(String path, {Map<String, dynamic>? query, bool lenient = false}) async {
    try {
      return (await Api.list(path, query: query)).rows;
    } catch (_) {
      if (lenient) return <Json>[];
      rethrow;
    }
  }

  Future<_BranchData> _load() async {
    final r = await Future.wait<dynamic>([
      Api.get('/organization/branches/$_id'),
      _rows('/organization/branches/$_id/addresses'),
      _seeUsers ? _rows('/organization/branches/$_id/user-assignments') : Future.value(<Json>[]),
      _rows('/organization/departments', query: {'branch_id': _id}),
      // Store / cost-center lists belong to other modules - an empty list if the role lacks them.
      _rows('/store/locations', query: {'branch_id': _id}, lenient: true),
      _rows('/organization/cost-centers', query: {'branch_id': _id}, lenient: true),
      _seeDocs ? _rows('/organization/branches/$_id/documents') : Future.value(<Json>[]),
    ]);
    return _BranchData(jsonMap(r[0]), r[1] as List<Json>, r[2] as List<Json>, r[3] as List<Json>,
        r[4] as List<Json>, r[5] as List<Json>, r[6] as List<Json>);
  }

  void _reload() => setState(() => _future = _load());

  Future<void> _after(Future<bool> sheet, String message) async {
    if (await sheet) {
      if (mounted) showSnack(context, message);
      _reload();
    }
  }

  Future<void> _deleteRow(String title, String message, String path, String done) async {
    final yes = await confirmDialog(context, title: title, message: message, confirmLabel: 'Delete', danger: true);
    if (!yes || !mounted) return;
    if (await runAction(context, () => Api.delete(path), success: done)) _reload();
  }

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'Branch Details',
      body: FutureBuilder<_BranchData>(
        future: _future,
        builder: (ctx, s) {
          if (s.connectionState != ConnectionState.done) return const LoadingView();
          if (s.hasError) {
            return ErrorView(
                '${ApiClient.describe(s.error!)}\nCould not load this branch. Pull to retry; if it keeps failing, '
                'check you still have access to Organization › Branches.',
                onRetry: _reload);
          }
          return RefreshIndicator(onRefresh: () async => _reload(), child: _body(s.data!));
        },
      ),
    );
  }

  Widget _body(_BranchData d) {
    final b = d.branch;
    final addrs = d.addresses;
    Json? primary;
    for (final a in addrs) {
      if (a['is_primary'] == true && a['is_active'] == true) primary = a;
    }
    primary ??= addrs.where((a) => a['is_active'] == true).firstOrNull;
    final place = primary == null
        ? ''
        : [primary['city'], primary['state']].where((v) => str(v).isNotEmpty).join(', ');
    final counts = <String, int>{
      'address': addrs.length,
      'users': d.assignments.length,
      'departments': d.departments.length,
      'stores': d.stores.length,
      'cost_centers': d.costCenters.length,
      'documents': d.documents.length,
    };
    final tabs = _tabs.where((t) => _seeTab(t.$1)).toList();
    final tab = _seeTab(_tab) ? _tab : 'basic';

    return ListView(
      padding: const EdgeInsets.only(top: 12, bottom: 32),
      children: [
        // Summary (DetailSummary)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Caps('Organization › Branches'),
                  const SizedBox(height: 4),
                  Text(str(b['name']),
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Brand.heading)),
                  if (str(b['description']).isNotEmpty || place.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(str(b['description']).isNotEmpty ? str(b['description']) : place,
                        style: const TextStyle(fontSize: 13, color: Brand.muted)),
                  ],
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      StatusBadge(branchStatusLabel(b['status']), color: branchStatusColor(b['status'])),
                      _metaText('Code ${str(b['code'])}'),
                      if (str(b['plant_type']).isNotEmpty) _metaText(str(b['plant_type'])),
                      if (str(b['manager_user_name']).isNotEmpty) _metaText('Manager: ${str(b['manager_user_name'])}'),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
        // Inner tabs
        SizedBox(
          height: 44,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              for (final t in tabs)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    label: Text(counts[t.$1] == null ? t.$2 : '${t.$2}  ${counts[t.$1]}'),
                    selected: tab == t.$1,
                    showCheckmark: false,
                    selectedColor: Brand.primary,
                    labelStyle: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: tab == t.$1 ? Colors.white : Brand.body),
                    onSelected: (_) => setState(() => _tab = t.$1),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        ..._tabBody(tab, d),
      ],
    );
  }

  Widget _metaText(String t) => Text(t, style: const TextStyle(fontSize: 12.5, color: Brand.muted));

  Widget _editBtn(VoidCallback onTap, {String label = 'Edit'}) =>
      TextButton(onPressed: onTap, child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)));

  Widget _addBtn(String label, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        child: Align(
          alignment: Alignment.centerLeft,
          child: PillButton(label, icon: Icons.add_rounded, onPressed: onTap),
        ),
      );

  Widget _hint(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        child: Text(text, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
      );

  Widget _empty(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Text(text, style: const TextStyle(fontSize: 13, color: Brand.muted)),
      );

  Widget _tag(String label, Color c) => Padding(
        padding: const EdgeInsets.only(left: 6),
        child: StatusBadge(label, color: c),
      );

  /// One list entry with optional Edit / Delete menu.
  Widget _item({
    required String title,
    String? sub,
    List<Widget> tags = const [],
    String? body,
    VoidCallback? onEdit,
    VoidCallback? onDelete,
    String deleteLabel = 'Delete',
    VoidCallback? onOpen,
  }) {
    final menu = <PopupMenuEntry<String>>[
      if (onOpen != null) const PopupMenuItem(value: 'open', child: Text('Open')),
      if (onEdit != null) const PopupMenuItem(value: 'edit', child: Text('Edit')),
      if (onDelete != null) PopupMenuItem(value: 'delete', child: Text(deleteLabel, style: const TextStyle(color: _red))),
    ];
    return RecordCard(
      code: sub,
      title: title,
      subtitle: body == null || body.isEmpty ? null : body,
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        ...tags,
        if (menu.isNotEmpty)
          PopupMenuButton<String>(
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.more_vert_rounded, size: 20),
            itemBuilder: (_) => menu,
            onSelected: (v) => v == 'open' ? onOpen!() : (v == 'edit' ? onEdit!() : onDelete!()),
          ),
      ]),
      onTap: onOpen ?? onEdit,
    );
  }

  String _titleCase(Object? v) => str(v).isEmpty ? '' : humanize(v);

  List<Widget> _tabBody(String tab, _BranchData d) {
    final b = d.branch;
    switch (tab) {
      case 'address':
        return [
          if (_canEdit) _addBtn('Add Address', () => _after(showBranchAddressSheet(context, _id), 'Address saved.')),
          if (d.addresses.isEmpty)
            _empty(_canEdit ? 'No addresses added yet — tap Add Address to add this branch’s address.' : 'No addresses added yet.'),
          for (final a in d.addresses)
            _item(
              title: str(a['address_type']).isEmpty ? 'Address' : str(a['address_type']),
              tags: [
                if (a['is_primary'] == true) _tag('Primary', _green),
                if (a['is_active'] != true) _tag('Inactive', _red),
              ],
              body: [
                a['address_line1'], a['address_line2'], a['landmark'], a['city'], a['district'], a['state'],
                a['country'], a['pincode'],
              ].where((v) => str(v).isNotEmpty).join(', '),
              onEdit: _canEdit
                  ? () => _after(showBranchAddressSheet(context, _id, address: a), 'Address saved.')
                  : null,
              onDelete: _canEdit
                  ? () => _deleteRow(
                      'Delete this address?',
                      'Delete the "${str(a['address_type']).isEmpty ? 'address' : str(a['address_type'])}" record? This cannot be undone.',
                      '/organization/branches/$_id/addresses/${a['id']}',
                      'Address deleted.')
                  : null,
            ),
        ];

      case 'operations':
        return [
          DetailSection('Working time',
              action: _canEdit
                  ? _editBtn(() => _after(showBranchOperationsSheet(context, b, d.stores, d.costCenters), 'Branch saved.'))
                  : null,
              children: [
                FieldRow('Working calendar', b['working_calendar']),
                FieldRow('Working days', b['working_days']),
                FieldRow('Working hours', b['working_hours']),
                FieldRow('Time zone', b['timezone']),
              ]),
          DetailSection('Defaults', children: [
            FieldRow('Default store', b['default_warehouse_name']),
            FieldRow('Default cost center', b['default_cost_center_name']),
            FieldRow('Default profit center', b['default_profit_center']),
            FieldRow('Currency', b['currency']),
          ]),
          DetailSection('GST', children: [
            FieldRow('GSTIN', b['gstin']),
            FieldRow('State code', b['state_code']),
          ]),
        ];

      case 'users':
        return [
          if (_editUsers)
            _addBtn('Add Branch User',
                () => _after(showBranchUserSheet(context, _id, d.departments), 'Branch user saved.')),
          if (d.assignments.isEmpty)
            _empty(_editUsers ? 'No users assigned to this branch yet — tap Add Branch User to assign people.' : 'No users assigned to this branch yet.'),
          for (final a in d.assignments)
            _item(
              title: str(a['user_name']).isEmpty ? 'User #${a['user_id']}' : str(a['user_name']),
              sub: str(a['role']).isEmpty ? null : str(a['role']),
              tags: [if (a['is_primary_branch'] == true) _tag('Primary branch', _green)],
              body: [a['designation'], a['department_name'], a['access_level'], a['employee_id']]
                  .where((v) => str(v).isNotEmpty)
                  .join(' · ')
                  .ifEmpty('—'),
              onEdit: _editUsers
                  ? () => _after(showBranchUserSheet(context, _id, d.departments, assignment: a), 'Branch user saved.')
                  : null,
              onDelete: _editUsers
                  ? () => _deleteRow(
                      'Remove this branch user?',
                      'Remove "${str(a['user_name'])}" from this branch? This cannot be undone.',
                      '/organization/branches/$_id/user-assignments/${a['id']}',
                      'Branch user removed.')
                  : null,
              deleteLabel: 'Remove',
            ),
        ];

      case 'departments':
        return [
          _hint('Departments are managed from Organization › Department.'),
          if (d.departments.isEmpty) _empty('No departments under this branch yet.'),
          for (final dep in d.departments)
            _item(
              title: str(dep['name']),
              sub: str(dep['code']).isEmpty ? null : str(dep['code']),
              body: str(dep['head_user_name']).isEmpty ? 'No head set' : 'Head: ${str(dep['head_user_name'])}',
            ),
        ];

      case 'stores':
        // Stores are Store-module records — the server checks Store › Stores permissions, not Branches.
        final storeCreate = _canEdit && Perm.can('store', 'warehouses', 'create');
        final storeEdit = _canEdit && Perm.can('store', 'warehouses', 'edit');
        final storeDelete = _canEdit && Perm.can('store', 'warehouses', 'delete');
        return [
          if (storeCreate)
            _addBtn('Add Store', () => _after(showBranchStoreSheet(context, _id), 'Store saved.'))
          else if (_canEdit)
            _hint('You can see this branch\'s stores but not add or change them — that needs Create/Edit on Store › '
                'Stores. Ask an admin to add it to one of your roles in Organization › Role & Permissions.'),
          if (d.stores.isEmpty) _empty('No stores under this branch yet — stores are added from the Store module.'),
          for (final w in d.stores)
            _item(
              title: str(w['name']),
              sub: str(w['code']).isEmpty ? null : str(w['code']),
              tags: [if (asInt(b['default_warehouse_id']) == asInt(w['id'])) _tag('Default', _green)],
              body: [
                _titleCase(w['warehouse_type']),
                str(w['manager_user_name']).isEmpty ? '' : 'Manager: ${str(w['manager_user_name'])}',
                _titleCase(w['status']),
              ].where((v) => v.isNotEmpty).join(' · ').ifEmpty('—'),
              onEdit: storeEdit ? () => _after(showBranchStoreSheet(context, _id, store: w), 'Store saved.') : null,
              onDelete: storeDelete
                  ? () => _deleteRow('Delete this store?', 'Delete "${str(w['name'])}"? This cannot be undone.',
                      '/store/locations/${w['id']}', 'Store deleted.')
                  : null,
            ),
        ];

      case 'cost_centers':
        return [
          if (_canEdit)
            _addBtn('Add Cost Center',
                () => _after(showBranchCostCenterSheet(context, _id, d.departments, d.costCenters), 'Cost center saved.')),
          if (d.costCenters.isEmpty) _empty('No cost centers under this branch yet.'),
          for (final cc in d.costCenters)
            _item(
              title: str(cc['name']),
              sub: str(cc['code']).isEmpty ? null : str(cc['code']),
              tags: [if (asInt(b['default_cost_center_id']) == asInt(cc['id'])) _tag('Default', _green)],
              body: [
                _titleCase(cc['cost_center_type']),
                str(cc['department_name']),
                str(cc['head_user_name']).isEmpty ? '' : 'Head: ${str(cc['head_user_name'])}',
              ].where((v) => v.isNotEmpty).join(' · ').ifEmpty('—'),
              onEdit: _canEdit
                  ? () => _after(
                      showBranchCostCenterSheet(context, _id, d.departments, d.costCenters, costCenter: cc),
                      'Cost center saved.')
                  : null,
              onDelete: _canEdit
                  ? () => _deleteRow('Delete this cost center?', 'Delete "${str(cc['name'])}"? This cannot be undone.',
                      '/organization/cost-centers/${cc['id']}', 'Cost center deleted.')
                  : null,
            ),
        ];

      case 'documents':
        final mayUpload = _canEdit && _feat('documents', 'create');
        final mayDelete = _canEdit && _feat('documents', 'delete');
        final mayOpen = _feat('documents', 'export');
        return [
          if (mayUpload)
            _addBtn('Add Branch Document', () => _after(showBranchDocumentSheet(context, _id), 'Document uploaded.')),
          if (d.documents.isEmpty)
            _empty(mayUpload
                ? 'No documents uploaded yet — tap Add Branch Document to upload licences and certificates.'
                : 'No documents uploaded yet.'),
          for (final doc in d.documents)
            _item(
              title: str(doc['document_name']),
              tags: [_tag(str(doc['document_type']), const Color(0xFF2563EB))],
              body: [
                str(doc['filename']),
                str(doc['expiry_date']).isEmpty ? '' : 'Expires ${fmtDate(doc['expiry_date'])}',
                str(doc['version']).isEmpty ? '' : 'v${str(doc['version'])}',
              ].where((v) => v.isNotEmpty).join(' · '),
              onOpen: mayOpen && str(doc['sharepoint_url']).isNotEmpty
                  ? () => runAction(
                      context,
                      () => Files.downloadAndOpen('/organization/branches/$_id/documents/${doc['id']}/content',
                          str(doc['filename']).isEmpty ? 'document' : str(doc['filename'])))
                  : null,
              onDelete: mayDelete
                  ? () => _deleteRow(
                      'Delete this document?',
                      'Delete "${str(doc['document_name'])}"? This cannot be undone.',
                      '/organization/branches/$_id/documents/${doc['id']}',
                      'Document deleted.')
                  : null,
            ),
        ];

      default: // basic
        return [
          DetailSection('Basic information',
              action: _canEdit ? _editBtn(() => _after(showBranchBasicSheet(context, b), 'Branch saved.')) : null,
              children: [
                FieldRow('Company', b['company_name']),
                FieldRow('Branch type', b['plant_type']),
                FieldRow('Industry / function', b['industry_function']),
                FieldRow('Established on', str(b['established_date']).isEmpty ? null : fmtDate(b['established_date'])),
                FieldRow('Active from', str(b['active_from']).isEmpty ? null : fmtDate(b['active_from'])),
              ]),
          DetailSection('People', children: [
            FieldRow('Branch head', b['head_user_name']),
            FieldRow('Branch manager', b['manager_user_name']),
          ]),
          DetailSection('Notes', children: [
            FieldRow('Description', b['description']),
            FieldRow('Remarks', b['remarks']),
          ]),
        ];
    }
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}
