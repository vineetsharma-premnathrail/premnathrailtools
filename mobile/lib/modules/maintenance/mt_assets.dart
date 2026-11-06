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
import 'mt_common.dart';
import 'mt_requests.dart';
import 'mt_schedule.dart';
import 'mt_spares.dart';
import 'mt_work_orders.dart';

// Assets - frontend/src/app/dashboard/maintenance/assets/** plus AssetForm,
// AssetImportDialog, AssetSparesPanel and AssetReadingsPanel.

class AssetsList extends StatefulWidget {
  const AssetsList({super.key, this.initialStatus, this.initialBranch});
  final String? initialStatus;
  final int? initialBranch;

  @override
  State<AssetsList> createState() => _AssetsListState();
}

class _AssetsListState extends State<AssetsList> {
  final _list = GlobalKey<ApiListViewState>();
  late String? _status = widget.initialStatus;
  late int? _branch = widget.initialBranch;
  String? _category;
  String? _crit;
  Json? _lookups;

  @override
  void initState() {
    super.initState();
    MtLookups.tryGet().then((lk) {
      if (mounted) setState(() => _lookups = lk);
    });
  }

  void _refilter(VoidCallback change) {
    setState(change);
    WidgetsBinding.instance.addPostFrameCallback((_) => _list.currentState?.reload());
  }

  @override
  Widget build(BuildContext context) {
    final branches = MtLookups.branches(_lookups);
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        MtHeader('Asset Register', actions: [
          PopupMenuButton<String>(
            tooltip: 'More',
            icon: const Icon(Icons.more_vert_rounded),
            onSelected: (v) {
              if (v == 'labels') {
                runAction(context,
                    () => Files.openInPortal('/dashboard/maintenance/assets/labels${_branch != null ? '?branch_id=$_branch' : ''}'));
              } else if (v == 'import') {
                Navigator.of(context)
                    .push(MaterialPageRoute(builder: (_) => const AssetImportScreen()))
                    .then((_) => _list.currentState?.reload());
              }
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'labels', child: Text('Print QR Labels')),
              if (Mt.can('assets', 'import')) const PopupMenuItem(value: 'import', child: Text('Import from Excel')),
            ],
          ),
        ]),
        filterRow([
          if (branches.length > 1)
            FilterSelect<int>(allLabel: 'All plants', value: _branch, options: branches, onChanged: (v) => _refilter(() => _branch = v)),
          FilterSelect<String>(
              allLabel: 'All categories',
              value: _category,
              options: optionsOf(assetCategoryLabels),
              onChanged: (v) => _refilter(() => _category = v)),
          FilterSelect<String>(
              allLabel: 'Any criticality',
              value: _crit,
              options: const [Option('A', 'A'), Option('B', 'B'), Option('C', 'C')],
              onChanged: (v) => _refilter(() => _crit = v)),
          FilterSelect<String>(
            allLabel: 'All statuses',
            value: _status,
            options: [const Option('down', 'Down (breakdown + under maintenance)'), ...optionsOf(assetStatusLabels)],
            onChanged: (v) => _refilter(() => _status = v),
          ),
        ]),
      ],
    );
    return withFab(
      ApiListView(
        key: _list,
        header: header,
        searchHint: 'Search by code, name, serial or location…',
        load: (page, search) => Api.list('/maintenance/assets', query: {
          'status': _status,
          'category': _category,
          'criticality': _crit,
          'branch_id': _branch,
          'search': search,
        }),
        emptyText: _status != null || _category != null || _crit != null || _branch != null
            ? 'No assets match these filters.'
            : 'No assets yet. Add the machines, cranes, compressors and other plant equipment you maintain.',
        itemBuilder: (ctx, a, reload) => RecordCard(
          code: str(a['asset_code']),
          title: str(a['name']),
          subtitle: str(a['parent_asset_code']).isNotEmpty ? 'part of ${a['parent_asset_code']}' : null,
          trailing: statusPill(assetStatusLabels, assetStatusHex, a['status']),
          meta: [
            ('Category', label(assetCategoryLabels, a['category'])),
            ('Plant', txt(a['branch_name'])),
            ('Location', txt(a['location_text'])),
            ('Crit.', str(a['criticality'])),
            ('Open WOs', (asInt(a['open_work_orders']) ?? 0) == 0 ? '—' : '${a['open_work_orders']}'),
          ],
          onTap: () async {
            await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => AssetDetailScreen(id: asInt(a['id'])!)));
            reload();
          },
        ),
      ),
      Mt.can('assets', 'create')
          ? CreateFab(
              label: 'New Asset',
              onPressed: () async {
                final created = await assetForm(context);
                if (created != null && context.mounted) {
                  _list.currentState?.reload();
                  openScreen(context, AssetDetailScreen(id: asInt(created['id'])!));
                }
              })
          : null,
    );
  }
}

// ── Asset form (AssetForm.tsx) ───────────────────────────────────────────────

const _manualStatuses = ['operational', 'standby', 'decommissioned'];

/// New / edit asset. Returns the saved asset, null when cancelled.
Future<Json?> assetForm(BuildContext context, {Json? initial}) async {
  Json lk;
  try {
    lk = await MtLookups.get();
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return null;
  }
  if (!context.mounted) return null;
  final isEdit = initial != null;
  TextEditingController c(String k) => TextEditingController(text: str(initial?[k]));
  final code = c('asset_code'), name = c('name'), location = c('location_text'), make = c('make'), model = c('model');
  final serial = c('serial_number'), year = c('year_of_manufacture'), cost = c('purchase_cost'), meterUnit = c('meter_unit');
  final meterReading = c('current_meter_reading'), description = c('description'), remarks = c('remarks');
  var category = str(initial?['category']).isEmpty ? 'production_machine' : str(initial!['category']);
  var criticality = str(initial?['criticality']).isEmpty ? 'B' : str(initial!['criticality']);
  var status = str(initial?['status']).isEmpty ? 'operational' : str(initial!['status']);
  final statusIsSystem = isEdit && !_manualStatuses.contains(str(initial['status']));
  int? branch = asInt(initial?['branch_id']);
  int? dept = asInt(initial?['department_id']);
  int? workstation = asInt(initial?['workstation_id']);
  int? parent = asInt(initial?['parent_asset_id']);
  int? supplier = asInt(initial?['supplier_vendor_id']);
  int? amcVendor = asInt(initial?['amc_vendor_id']);
  DateTime? purchaseDate = parseDate(initial?['purchase_date']);
  DateTime? warranty = parseDate(initial?['warranty_expiry']);
  DateTime? amcExpiry = parseDate(initial?['amc_expiry']);
  DateTime? commissioned = parseDate(initial?['commissioned_on']);
  DateTime? decommissioned = parseDate(initial?['decommissioned_on']);
  Json? saved;
  final vendors = MtLookups.vendors(lk);
  final hasDepts = lk['departments'] is List;
  final hasWs = lk['workstations'] is List;

  final ok = await showFormSheet(
    context,
    title: isEdit ? 'Edit ${initial['asset_code']}' : 'New Asset',
    saveLabel: isEdit ? 'Save Changes' : 'Create Asset',
    builder: (ctx, setS) {
      final depts = [
        for (final d in asList(lk['departments']))
          if (branch == null || d['branch_id'] == null || asInt(d['branch_id']) == branch) Option(asInt(d['id'])!, str(d['name'])),
      ];
      final wss = [
        for (final w in asList(lk['workstations']))
          if ((branch == null || w['branch_id'] == null || asInt(w['branch_id']) == branch) &&
              (w['linked_asset_id'] == null || asInt(w['linked_asset_id']) == asInt(initial?['id'])))
            Option(asInt(w['id'])!, '${w['code']} — ${w['name']}'),
      ];
      return [
        hintText(isEdit
            ? str(initial['name'])
            : 'Register a machine or utility — it gets a QR label, PM plans, spares and a breakdown history.'),
        sheetSection('Identification'),
        AppTextField(label: 'Asset Code', controller: code, hint: isEdit ? null : 'Auto (EQ-0001)'),
        AppTextField(label: 'Name', required: true, controller: name, hint: 'CNC Lathe — LMW LL20'),
        AppSelect<String>(
            label: 'Category', value: category, clearable: false, options: optionsOf(assetCategoryLabels),
            onChanged: (o) => setS(() => category = o?.value ?? category)),
        AppSelect<String>(
            label: 'Criticality', value: criticality, clearable: false, options: optionsOf(criticalityLabels),
            onChanged: (o) => setS(() => criticality = o?.value ?? criticality)),
        if (isEdit)
          statusIsSystem
              ? AppTextField(label: 'Status', initialValue: label(assetStatusLabels, initial['status']), enabled: false)
              : AppSelect<String>(
                  label: 'Status', value: status, clearable: false, options: optionsOf(assetStatusLabels, _manualStatuses),
                  onChanged: (o) => setS(() => status = o?.value ?? status)),
        if (!isEdit) hintText("Use the plant's existing machine number as the code if it has one. Leave it blank to auto-number."),
        if (statusIsSystem)
          hintText("Status is set automatically while a breakdown or work order is open, and returns to Operational when it's closed."),
        sheetSection('Location'),
        AppSelect<int>(
          label: 'Plant',
          required: true,
          value: branch,
          options: MtLookups.branches(lk),
          onChanged: (o) => setS(() {
            branch = o?.value;
            dept = null;
            workstation = null;
          }),
        ),
        if (hasDepts)
          AppSelect<int>(label: 'Department', value: dept, options: depts, onChanged: (o) => setS(() => dept = o?.value)),
        AppTextField(label: 'Location in Plant', controller: location, hint: 'Bay 3, Line 2'),
        if (hasWs)
          AppSelect<int>(
              label: 'Production Workstation', value: workstation, options: wss, onChanged: (o) => setS(() => workstation = o?.value)),
        AppSelect<int>(
          label: 'Part Of (Parent Asset)',
          value: parent,
          valueLabel: parent == null ? null : (assetCache[parent] != null ? assetLabel(assetCache[parent]!) : str(initial?['parent_asset_code'])),
          loadOptions: (q) => loadAssetOptions(q, excludeId: asInt(initial?['id'])),
          onChanged: (o) => setS(() => parent = o?.value),
        ),
        if (hasWs) hintText('Linking a workstation blocks it in Production while this asset is broken down or under maintenance.'),
        sheetSection('Make & Purchase'),
        AppTextField(label: 'Make', controller: make),
        AppTextField(label: 'Model', controller: model),
        AppTextField(label: 'Serial Number', controller: serial),
        AppTextField(label: 'Year Built', controller: year, keyboardType: TextInputType.number),
        AppSelect<int>(
            label: 'Supplier', value: supplier, valueLabel: str(initial?['supplier_vendor_name']), options: vendors,
            onChanged: (o) => setS(() => supplier = o?.value)),
        DateField(label: 'Purchase Date', value: purchaseDate, onChanged: (d) => setS(() => purchaseDate = d)),
        AppTextField(label: 'Purchase Cost (₹)', controller: cost, keyboardType: AppTextField.number),
        DateField(label: 'Commissioned On', value: commissioned, onChanged: (d) => setS(() => commissioned = d)),
        sheetSection('Warranty, AMC & Meter'),
        DateField(label: 'Warranty Expiry', value: warranty, onChanged: (d) => setS(() => warranty = d)),
        AppSelect<int>(
            label: 'AMC Vendor', value: amcVendor, valueLabel: str(initial?['amc_vendor_name']), options: vendors,
            onChanged: (o) => setS(() => amcVendor = o?.value)),
        DateField(label: 'AMC Expiry', value: amcExpiry, onChanged: (d) => setS(() => amcExpiry = d)),
        AppTextField(label: 'Meter Unit', controller: meterUnit, hint: 'hours'),
        AppTextField(label: 'Meter Reading', controller: meterReading, keyboardType: AppTextField.number),
        if (isEdit && status == 'decommissioned')
          DateField(label: 'Decommissioned On', value: decommissioned, onChanged: (d) => setS(() => decommissioned = d)),
        sheetSection('Notes', extra: '(optional)'),
        AppTextField(label: 'Description / Technical Specs', controller: description, maxLines: 4, hint: 'Capacity, power rating, key specs…'),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      ];
    },
    onSave: () async {
      if (name.text.trim().isEmpty) throw 'Asset name is required.';
      if (branch == null) throw 'Pick the plant this asset is at.';
      for (final (ctrl, lbl) in [(cost, 'Purchase cost'), (meterReading, 'Meter reading'), (year, 'Year of manufacture')]) {
        final n = numOrNull(ctrl.text);
        if (n != null && (n.isNaN || n < 0)) throw '$lbl must be a positive number.';
      }
      final y = numOrNull(year.text);
      if (y != null && (y < 1900 || y > DateTime.now().year + 1)) {
        throw "Year of manufacture ${year.text.trim()} doesn't look right — enter a 4-digit year.";
      }
      String? t(TextEditingController x) => x.text.trim().isEmpty ? null : x.text.trim();
      String? d(DateTime? x) => x == null ? null : apiDate(x);
      final payload = <String, dynamic>{
        'asset_code': t(code)?.toUpperCase(),
        'name': name.text.trim(),
        'category': category,
        'criticality': criticality,
        'branch_id': branch,
        'department_id': dept,
        'location_text': t(location),
        'workstation_id': workstation,
        'parent_asset_id': parent,
        'make': t(make),
        'model': t(model),
        'serial_number': t(serial),
        'year_of_manufacture': y?.toInt(),
        'supplier_vendor_id': supplier,
        'purchase_date': d(purchaseDate),
        'purchase_cost': numOrNull(cost.text),
        'warranty_expiry': d(warranty),
        'amc_vendor_id': amcVendor,
        'amc_expiry': d(amcExpiry),
        'meter_unit': t(meterUnit),
        'current_meter_reading': numOrNull(meterReading.text),
        'commissioned_on': d(commissioned),
        'description': t(description),
        'remarks': t(remarks),
      };
      if (isEdit) {
        if (payload['asset_code'] == null) payload.remove('asset_code');
        if (!statusIsSystem) payload['status'] = status;
        payload['decommissioned_on'] = d(decommissioned);
        saved = asMap(await Api.patch('/maintenance/assets/${initial['id']}', data: payload));
      } else {
        saved = asMap(await Api.post('/maintenance/assets', data: payload));
      }
    },
  );
  for (final x in [code, name, location, make, model, serial, year, cost, meterUnit, meterReading, description, remarks]) {
    x.dispose();
  }
  return ok ? saved : null;
}

// ── Asset detail (assets/[id]) ───────────────────────────────────────────────

const _historyHex = <String, Color>{...requestStatusHex, ...woStatusHex};

class AssetDetailScreen extends StatefulWidget {
  const AssetDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<AssetDetailScreen> createState() => _AssetDetailScreenState();
}

class _AssetDetailScreenState extends State<AssetDetailScreen> {
  Json? _asset;
  Object? _error;
  String _tab = 'overview';

  bool _af(String key, [String action = 'view']) => Mt.feat('assets', key, action);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/maintenance/assets/${widget.id}');
      if (mounted) {
        setState(() {
          _asset = asMap(d);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  List<(String, String)> get _tabs => [
        ('overview', 'Overview'),
        if (_af('history')) ('history', 'History'),
        if (_af('pm_plans')) ('pm', 'PM Plans'),
        if (_af('spare_parts')) ('spares', 'Spares'),
        if (_af('readings')) ('readings', 'Counters & Readings'),
        if (_af('documents')) ('documents', 'Documents'),
      ];

  Future<void> _delete(Json a) async {
    final ok = await confirmDialog(context,
        title: 'Delete asset?',
        message: '${a['asset_code']} will be removed from the register. Its request and work-order history stays on record.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    final done = await runAction(context, () => Api.delete('/maintenance/assets/${widget.id}'), success: 'Asset deleted.');
    if (done && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final a = _asset;
    final actions = <BarAction>[];
    if (a != null) {
      if (a['status'] != 'decommissioned') {
        actions.add(BarAction('Report Breakdown', () => reportBreakdown(context, asset: a), primary: true));
        if (Mt.can('work_orders', 'create')) actions.add(BarAction('New Work Order', () => newWorkOrder(context, asset: a)));
      }
      actions.add(BarAction('QR Label',
          () => runAction(context, () => Files.openInPortal('/dashboard/maintenance/assets/labels?ids=${str(a['id_ref'])}'))));
      if (Mt.can('assets', 'edit')) {
        actions.add(BarAction('Edit', () async {
          final saved = await assetForm(context, initial: a);
          if (saved != null && mounted) setState(() => _asset = saved);
        }));
      }
      final owner = asInt(a['created_by_id']);
      if (Mt.can('assets', 'delete') && (Perm.isAdmin || owner == null || owner == Perm.userId)) {
        actions.add(BarAction('Delete', () => _delete(a), danger: true));
      }
    }
    return SubPage(
      title: a == null ? 'Asset' : '${a['asset_code']} — ${a['name']}',
      bottom: actions.isEmpty ? null : ActionBar(actions),
      body: a == null ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()) : _body(a),
    );
  }

  Widget _body(Json a) {
    final isDown = a['status'] == 'breakdown' || a['status'] == 'under_maintenance';
    final open = asInt(a['open_work_orders']) ?? 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          color: Colors.white,
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            children: [
              for (final (k, l) in _tabs)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    label: Text(l),
                    selected: _tab == k,
                    showCheckmark: false,
                    selectedColor: Brand.primary,
                    labelStyle: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _tab == k ? Colors.white : Brand.body),
                    onSelected: (_) => setState(() => _tab = k),
                  ),
                ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                MtHeader('${a['asset_code']} — ${a['name']}', caps: 'Maintenance Asset', actions: [statusPill(assetStatusLabels, assetStatusHex, a['status'])]),
                if (isDown)
                  NoteBanner(
                    '${a['down_since'] != null ? 'Down since ${fmtDateTime(a['down_since'])}. ' : ''}'
                    '${open > 0 ? '$open open work order${open > 1 ? 's' : ''}.' : 'No work order raised yet.'}'
                    '${str(a['workstation_code']).isNotEmpty ? ' Workstation ${a['workstation_code']} is blocked in Production until this is closed.' : ''}',
                    color: kRed,
                  ),
                if (_tab == 'overview') ..._overview(a),
                if (_tab == 'history') _HistoryTab(assetId: widget.id),
                if (_tab == 'pm') _PmTab(asset: a),
                if (_tab == 'spares')
                  BomSection(
                    assetId: widget.id,
                    canEdit: a['status'] != 'decommissioned' && Mt.can('assets', 'edit') && _af('spare_parts', 'edit'),
                  ),
                if (_tab == 'readings') ReadingsSection(assetId: widget.id, onChanged: _load),
                if (_tab == 'documents')
                  AttachmentsSection(
                    title: 'Manuals, drawings & photos',
                    entityType: 'asset',
                    entityId: widget.id,
                    defaultDocType: 'manual',
                    canUpload: _af('documents', 'create'),
                    canDelete: _af('documents', 'delete'),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _overview(Json a) {
    final makeModel = [str(a['make']), str(a['model'])].where((s) => s.isNotEmpty).join(' ');
    final open = asInt(a['open_work_orders']) ?? 0;
    return [
      DetailSection('${a['asset_code']} — ${a['name']}', children: [
        Text(str(a['description']).isNotEmpty
            ? str(a['description'])
            : '${label(assetCategoryLabels, a['category'])}${makeModel.isNotEmpty ? ' — $makeModel' : ''}.'),
        const SizedBox(height: 6),
        smallText('Criticality ${label(criticalityLabels, a['criticality'])} · $open open work order${open == 1 ? '' : 's'}'
            '${str(a['branch_name']).isNotEmpty ? ' · ${a['branch_name']}' : ''}'),
      ]),
      DetailSection('Identification', children: [
        FieldRow('Asset Code', a['asset_code']),
        FieldRow('Category', label(assetCategoryLabels, a['category'])),
      ]),
      DetailSection('Location', children: [
        FieldRow('Plant', a['branch_name']),
        FieldRow('Department', a['department_name']),
        FieldRow('Location', a['location_text']),
        FieldRow('Part Of', a['parent_asset_code']),
        FieldRow(
            'Production Workstation',
            str(a['workstation_code']).isEmpty
                ? 'Not linked'
                : '${a['workstation_code']}${str(a['workstation_status']).isNotEmpty ? ' (${str(a['workstation_status']).replaceAll('_', ' ')})' : ''}'),
      ]),
      DetailSection('Make & Purchase', children: [
        FieldRow('Make', a['make']),
        FieldRow('Model', a['model']),
        FieldRow('Serial Number', a['serial_number']),
        FieldRow('Year Built', a['year_of_manufacture']),
        FieldRow('Supplier', a['supplier_vendor_name']),
        FieldRow('Purchase Date', a['purchase_date'] == null ? null : fmtDate(a['purchase_date'])),
        FieldRow('Purchase Cost', a['purchase_cost'] == null ? null : formatInr(a['purchase_cost'])),
        FieldRow('Commissioned On', a['commissioned_on'] == null ? null : fmtDate(a['commissioned_on'])),
        if (a['status'] == 'decommissioned')
          FieldRow('Decommissioned On', a['decommissioned_on'] == null ? null : fmtDate(a['decommissioned_on'])),
      ]),
      DetailSection('Warranty, AMC & Meter', children: [
        FieldRow('Warranty Expiry', a['warranty_expiry'] == null ? null : fmtDate(a['warranty_expiry'])),
        FieldRow('AMC Vendor', a['amc_vendor_name']),
        FieldRow('AMC Expiry', a['amc_expiry'] == null ? null : fmtDate(a['amc_expiry'])),
        FieldRow('Current Meter Reading',
            a['current_meter_reading'] == null ? null : '${fmtNumber(a['current_meter_reading'])} ${str(a['meter_unit'])}'.trim()),
      ]),
      if (str(a['remarks']).isNotEmpty) DetailSection('Notes', children: [FieldRow('Remarks', a['remarks'])]),
    ];
  }
}

class _HistoryTab extends StatelessWidget {
  const _HistoryTab({required this.assetId});
  final int assetId;

  @override
  Widget build(BuildContext context) {
    final showCosts = Mt.showCosts;
    return ApiLoader<List<Json>>(
      load: () async => (await Api.list('/maintenance/assets/$assetId/history')).rows,
      builder: (ctx, rows, reload) => DetailSection('History', children: [
        if (rows.isEmpty) mutedText('No requests or work orders on this asset yet.'),
        for (final h in rows)
          LineItem(
            title: '${h['number']} · ${fmtDate(h['date'])}',
            subtitle: str(h['title']),
            badges: [
              statusPill(h['kind'] == 'request' ? requestStatusLabels : woStatusLabels, _historyHex, h['status']),
              smallText('Downtime ${formatMinutes(h['downtime_minutes'])}'),
              if (showCosts) smallText('Cost ${(asNum(h['total_cost']) ?? 0) != 0 ? formatInr(h['total_cost']) : '—'}'),
            ],
            onTap: () => openScreen(
                ctx,
                h['kind'] == 'request'
                    ? RequestDetailScreen(id: asInt(h['id'])!)
                    : WorkOrderDetailScreen(id: asInt(h['id'])!)),
          ),
      ]),
    );
  }
}

class _PmTab extends StatefulWidget {
  const _PmTab({required this.asset});
  final Json asset;

  @override
  State<_PmTab> createState() => _PmTabState();
}

class _PmTabState extends State<_PmTab> {
  int _key = 0;

  @override
  Widget build(BuildContext context) {
    final a = widget.asset;
    return ApiLoader<List<Json>>(
      key: ValueKey(_key),
      load: () async => (await Api.list('/maintenance/pm-plans', query: {'asset_id': a['id']})).rows,
      builder: (ctx, plans, reload) => DetailSection(
        'Preventive maintenance plans',
        action: a['status'] != 'decommissioned' && Mt.can('schedule', 'create')
            ? smallBtn('+ New PM Plan', () async {
                final p = await pmPlanForm(ctx, presetAsset: a);
                if (p != null && mounted) setState(() => _key++);
              })
            : null,
        children: [
          if (plans.isEmpty) mutedText('No PM plan on this asset yet. Add one so servicing is raised automatically before it falls due.'),
          for (final p in plans)
            Builder(builder: (_) {
              final st = str(p['due_state']).isNotEmpty ? str(p['due_state']) : (p['is_active'] == true ? 'scheduled' : 'inactive');
              return LineItem(
                title: '${p['plan_code']} · ${p['title']}',
                subtitle: 'Every ${p['frequency_value']} ${label(pmFrequencyUnitLabels, p['frequency_unit'])} · '
                    '${label(pmScheduleBasisLabels, p['schedule_basis'])}\nNext due ${fmtDate(p['next_due_date'])} · Last done ${fmtDate(p['last_done_date'])}',
                badges: [statusPill(pmDueStateLabels, dueHex, st)],
                onTap: () async {
                  await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => PmPlanDetailScreen(id: asInt(p['id'])!)));
                  if (mounted) setState(() => _key++);
                },
              );
            }),
        ],
      ),
    );
  }
}

// ── Bill of spares (AssetSparesPanel.tsx) ────────────────────────────────────

class BomSection extends StatefulWidget {
  const BomSection({super.key, required this.assetId, required this.canEdit});
  final int assetId;
  final bool canEdit;

  @override
  State<BomSection> createState() => _BomSectionState();
}

class _BomLine {
  _BomLine(this.itemId, this.code, this.name, this.uom, String qty, this.critical, String remarks)
      : qty = TextEditingController(text: qty),
        remarks = TextEditingController(text: remarks);
  final int itemId;
  final String code, name, uom;
  final TextEditingController qty, remarks;
  bool critical;
}

class _BomSectionState extends State<BomSection> {
  List<Json>? _lines;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await Api.list('/maintenance/assets/${widget.assetId}/spares');
      if (mounted) {
        setState(() {
          _lines = p.rows;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _edit() async {
    final draft = [
      for (final l in _lines ?? <Json>[])
        _BomLine(asInt(l['store_item_id'])!, str(l['item_code']), str(l['item_name']), str(l['uom']), fmtQty(l['qty_per_replacement']),
            l['is_critical'] == true, str(l['remarks'])),
    ];
    String? note;
    final saved = await showFormSheet(
      context,
      title: 'Bill of Spares',
      builder: (ctx, setS) => [
        hintText('Store items this asset consumes. Mark a spare critical to get an alert when Store stock drops below its minimum.'),
        AppSelect<int>(
          key: ValueKey('bom-add-${draft.length}'),
          label: 'Add a spare — search Store items by code, name or part number…',
          value: null,
          loadOptions: (q) => loadStoreItemOptions(q),
          onChanged: (o) => setS(() {
            if (o == null) return;
            final it = storeItemCache[o.value]!;
            if (draft.any((d) => d.itemId == o.value)) {
              note = "'${it['item_name']}' (${it['item_code']}) is already on this bill of spares — change its quantity instead.";
              return;
            }
            note = null;
            draft.add(_BomLine(o.value, str(it['item_code']), str(it['item_name']), str(it['uom']), '1', false, ''));
          }),
        ),
        if (note != null) Text(note!, style: const TextStyle(color: kRed, fontSize: 12.5)),
        if (draft.isEmpty) hintText('No spares on the list. Search above to add one, or Save to clear the list.'),
        for (var i = 0; i < draft.length; i++)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(12)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('${draft[i].code} ${draft[i].name}', style: const TextStyle(fontWeight: FontWeight.w600))),
                TextButton(onPressed: () => setS(() => draft.removeAt(i)), child: const Text('Remove', style: TextStyle(color: kRed))),
              ]),
              AppTextField(
                  label: 'Qty / Replacement${draft[i].uom.isNotEmpty ? ' (${draft[i].uom})' : ''}',
                  controller: draft[i].qty,
                  keyboardType: AppTextField.number),
              CheckField(label: 'Critical', value: draft[i].critical, onChanged: (v) => setS(() => draft[i].critical = v)),
              AppTextField(label: 'Remarks', controller: draft[i].remarks, hint: 'e.g. Spindle front bearing'),
            ]),
          ),
      ],
      onSave: () async {
        for (final d in draft) {
          final q = numOrNull(d.qty.text);
          if (q == null || q.isNaN || q <= 0) {
            throw "Quantity per replacement for '${d.name}' (${d.code}) must be a number greater than 0.";
          }
        }
        await Api.put('/maintenance/assets/${widget.assetId}/spares', data: {
          'lines': [
            for (final d in draft)
              {
                'store_item_id': d.itemId,
                'qty_per_replacement': num.parse(d.qty.text.trim()),
                'is_critical': d.critical,
                'remarks': d.remarks.text.trim().isEmpty ? null : d.remarks.text.trim(),
              },
          ],
        });
      },
    );
    for (final d in draft) {
      d.qty.dispose();
      d.remarks.dispose();
    }
    if (saved) _load();
  }

  (String, Color) _stock(Json l) {
    final reorder = asNum(l['reorder_level']);
    final min = l['minimum_stock'] ?? l['reorder_level'];
    if (l['below_min'] == true) return ('Below min', kRed);
    if (reorder != null && (asNum(l['on_hand_total']) ?? 0) <= reorder) return ('At reorder', kAmber);
    if (min == null) return ('No min set', kGrey);
    return ('OK', kGreen);
  }

  @override
  Widget build(BuildContext context) {
    final lines = _lines;
    return DetailSection(
      'Bill of Spares',
      action: widget.canEdit && lines != null ? smallBtn(lines.isEmpty ? '+ Add spares' : 'Edit', _edit) : null,
      children: [
        hintText('Store items this asset consumes. Mark a spare critical to get an alert when Store stock drops below its minimum.'),
        const SizedBox(height: 4),
        Align(
          alignment: Alignment.centerLeft,
          child: smallBtn('Spares stock', () => openScreen(context, const SubPage(title: 'Spares', body: SparesList()))),
        ),
        if (_error != null) ErrorBanner(_error!),
        if (lines == null && _error == null) mutedText('Loading…'),
        if (lines != null && lines.isEmpty) mutedText('No spares listed for this asset yet.'),
        for (final l in lines ?? <Json>[])
          Builder(builder: (_) {
            final (st, color) = _stock(l);
            return LineItem(
              title: '${l['item_code']} ${str(l['item_name'])}',
              subtitle: 'Qty / Replacement ${fmtQty(l['qty_per_replacement'])} ${str(l['uom'])} · '
                  'On hand (all stores) ${fmtQty(l['on_hand_total'])} · Min / Reorder ${fmtQty(l['minimum_stock'])} / ${fmtQty(l['reorder_level'])}'
                  '${str(l['remarks']).isNotEmpty ? ' · ${l['remarks']}' : ''}',
              badges: [if (l['is_critical'] == true) const Pill('Critical', kRed), Pill(st, color)],
            );
          }),
      ],
    );
  }
}

// ── Counters & readings (AssetReadingsPanel.tsx) ─────────────────────────────

const _limitLabels = {'ok': 'Within limits', 'below_limit': 'Below limit', 'above_limit': 'Above limit'};
const _sourceLabels = {'manual': 'Manual', 'scan': 'QR scan', 'wo_completion': 'WO completion'};

class ReadingsSection extends StatefulWidget {
  const ReadingsSection({super.key, required this.assetId, this.onChanged});
  final int assetId;
  final VoidCallback? onChanged;

  @override
  State<ReadingsSection> createState() => _ReadingsSectionState();
}

class _ReadingsSectionState extends State<ReadingsSection> {
  Json? _points;
  List<Json> _docs = [];
  String? _error;
  String? _notice;

  bool get _canRead =>
      Mt.feat('assets', 'readings', 'create') && (Mt.can('assets', 'edit') || Mt.can('work_orders', 'edit'));
  bool get _canPoints => Mt.feat('assets', 'readings', 'edit');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = asMap(await Api.get('/maintenance/assets/${widget.assetId}/measuring-points'));
      final d = await Api.list('/maintenance/assets/${widget.assetId}/readings', query: {'limit': 2000});
      if (mounted) {
        setState(() {
          _points = p;
          _docs = d.rows;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _enterReading() async {
    final main = asMap(_points?['main_counter']);
    final points = asList(_points?['points']).where((p) => p['is_active'] == true).toList();
    final hasMain = str(main?['meter_unit']).isNotEmpty;
    int? point = hasMain ? null : (points.isEmpty ? null : asInt(points.first['id']));
    final reading = TextEditingController(), remarks = TextEditingController(), override = TextEditingController();
    Json? doc;
    final saved = await showFormSheet(
      context,
      title: 'Enter reading',
      saveLabel: 'Save reading',
      builder: (ctx, setS) => [
        hintText('A reading outside the limits raises an abnormality request; a main-counter reading can raise a PM job.'),
        AppSelect<int?>(
          label: 'Measuring point',
          value: point,
          clearable: false,
          options: [
            if (hasMain) Option<int?>(null, 'Main counter (${main!['meter_unit']})'),
            for (final p in points) Option<int?>(asInt(p['id']), '${p['name']} (${p['unit']})'),
          ],
          onChanged: (o) => setS(() => point = o?.value),
        ),
        AppTextField(label: 'Reading', required: true, controller: reading, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true)),
        AppTextField(label: 'Remarks (optional)', controller: remarks),
        if (Perm.user['role'] == 'admin') ...[
          sheetSection('Counter reset', extra: '(optional)'),
          AppTextField(
              label: 'Counter reset reason (admin — only when the reading is lower than the last)',
              controller: override,
              hint: 'e.g. Hour meter replaced'),
        ],
      ],
      onSave: () async {
        doc = asMap(await Api.post('/maintenance/assets/${widget.assetId}/readings', data: {
          'reading': numOrNull(reading.text),
          'measuring_point_id': point,
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text,
          'override_reason': override.text.trim().isEmpty ? null : override.text,
        }));
      },
    );
    for (final c in [reading, remarks, override]) {
      c.dispose();
    }
    if (!saved || doc == null) return;
    final bits = ['Reading ${fmtQty(doc!['reading'])} saved.'];
    if (str(doc!['request_number']).isNotEmpty) bits.add('Outside its limits — request ${doc!['request_number']} raised.');
    final gen = asList(doc!['generated_work_orders']);
    if (gen.isNotEmpty) bits.add('PM job ${gen.map((w) => w['wo_number']).join(', ')} raised.');
    setState(() => _notice = bits.join(' '));
    _load();
    widget.onChanged?.call();
  }

  Future<void> _addPoint() async {
    final name = TextEditingController(), unit = TextEditingController();
    final lo = TextEditingController(), hi = TextEditingController(), target = TextEditingController();
    var counter = false;
    final saved = await showFormSheet(
      context,
      title: 'Add measuring point',
      saveLabel: 'Add point',
      builder: (ctx, setS) => [
        hintText('An extra point to read on this asset, with optional limits.'),
        sheetSection('Point'),
        AppTextField(label: 'Name', required: true, controller: name, hint: 'Hydraulic oil temperature'),
        AppTextField(label: 'Unit', required: true, controller: unit, hint: '°C'),
        CheckField(label: 'Counter (only goes up — running hours, km, strokes)', value: counter, onChanged: (v) => setS(() => counter = v)),
        sheetSection('Limits', extra: '(optional)'),
        AppTextField(label: 'Lower limit', controller: lo, keyboardType: AppTextField.number),
        AppTextField(label: 'Upper limit', controller: hi, keyboardType: AppTextField.number),
        AppTextField(label: 'Target', controller: target, keyboardType: AppTextField.number),
      ],
      onSave: () async {
        await Api.post('/maintenance/assets/${widget.assetId}/measuring-points', data: {
          'name': name.text,
          'unit': unit.text,
          'is_counter': counter,
          'lower_limit': numOrNull(lo.text),
          'upper_limit': numOrNull(hi.text),
          'target_value': numOrNull(target.text),
        });
      },
    );
    for (final c in [name, unit, lo, hi, target]) {
      c.dispose();
    }
    if (saved) _load();
  }

  @override
  Widget build(BuildContext context) {
    final main = asMap(_points?['main_counter']);
    final points = asList(_points?['points']);
    return DetailSection(
      'Counters & measuring points',
      children: [
        Text.rich(TextSpan(style: const TextStyle(fontSize: 13), children: [
          const TextSpan(text: 'Main counter: '),
          TextSpan(
            text: str(main?['meter_unit']).isNotEmpty
                ? '${fmtQty(main!['current_reading'])} ${main['meter_unit']}'
                : 'none (set the meter unit on the asset)',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          if (main?['updated_at'] != null) TextSpan(text: ' · ${fmtDateTime(main!['updated_at'])}', style: const TextStyle(color: Brand.muted)),
        ])),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (_canRead) smallBtn('+ Enter reading', _enterReading),
          if (_canPoints) smallBtn('+ Measuring point', _addPoint),
        ]),
        if (_error != null) ...[const SizedBox(height: 8), ErrorBanner(_error!)],
        if (_notice != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_notice!, style: const TextStyle(color: kGreen, fontSize: 12.5))),
        if (points.isNotEmpty) ...[
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final p in points)
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(border: Border.all(color: const Color(0x1F000000)), borderRadius: BorderRadius.circular(12)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  smallText('${p['name']}${p['is_counter'] == true ? ' (counter)' : ''}', weight: FontWeight.w600),
                  Text('${fmtQty(p['current_reading'])} ${p['unit']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  smallText('Limits ${fmtQty(p['lower_limit'])} – ${fmtQty(p['upper_limit'])}'),
                  if (p['limit_state'] != null)
                    Pill(_limitLabels[p['limit_state']] ?? str(p['limit_state']), p['limit_state'] == 'ok' ? kGreen : kRed),
                ]),
              ),
          ]),
        ],
        const SizedBox(height: 8),
        if (_docs.isEmpty) mutedText('No readings yet.'),
        for (final d in _docs)
          LineItem(
            title: '${d['point_name']}: ${fmtQty(d['reading'])} ${str(d['unit']).isNotEmpty ? d['unit'] : str(main?['meter_unit'])}',
            subtitle: [
              fmtDateTime(d['read_at']),
              if (d['difference'] != null) 'Change ${(asNum(d['difference']) ?? 0) > 0 ? '+' : ''}${fmtQty(d['difference'])}',
              _sourceLabels[d['source']] ?? str(d['source']),
              txt(d['read_by_name']),
              if (d['limit_breach'] != null) '${d['limit_breach'] == 'high' ? 'Above' : 'Below'} limit',
              if (str(d['override_reason']).isNotEmpty) 'Counter reset: ${d['override_reason']}',
              if (str(d['remarks']).isNotEmpty) str(d['remarks']),
            ].join(' · '),
          ),
      ],
    );
  }
}

// ── Excel import (AssetImportDialog.tsx) ─────────────────────────────────────

class AssetImportScreen extends StatefulWidget {
  const AssetImportScreen({super.key});

  @override
  State<AssetImportScreen> createState() => _AssetImportScreenState();
}

class _AssetImportScreenState extends State<AssetImportScreen> {
  MultipartFile? _file;
  Json? _result;
  String _busy = '';
  String? _error;
  String? _done;

  Future<Json> _send(bool dryRun) async {
    final fd = FormData()..files.add(MapEntry('file', _file!.clone()));
    final r = await Api.dio.post('/maintenance/assets/import',
        data: fd, queryParameters: {'dry_run': dryRun}, options: Options(receiveTimeout: const Duration(minutes: 3)));
    return Map<String, dynamic>.from(r.data as Map);
  }

  Future<void> _go(String what, Future<void> Function() fn) async {
    setState(() {
      _busy = what;
      _error = null;
    });
    try {
      await fn();
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    final rows = asList(r?['rows']);
    final bad = rows.where((x) => asList(x['errors']).isNotEmpty || (x['errors'] is List && (x['errors'] as List).isNotEmpty)).toList();
    final canImport = _file != null && r != null && asInt(r['error_rows']) == 0 && (asInt(r['total_rows']) ?? 0) > 0 && _busy.isEmpty;
    return SubPage(
      title: 'Import assets from Excel',
      bottom: ActionBar([
        BarAction(
          _busy == 'import' ? 'Importing…' : r != null && asInt(r['error_rows']) == 0 ? 'Import ${r['total_rows']} asset(s)' : 'Import',
          canImport
              ? () => _go('import', () async {
                    final res = await _send(false);
                    setState(() {
                      _done = '${res['created']} asset(s) imported into the register.';
                      _result = null;
                      _file = null;
                    });
                  })
              : null,
          primary: true,
        ),
        BarAction(_busy == 'validate' ? 'Validating…' : 'Validate',
            _file == null || _busy.isNotEmpty ? null : () => _go('validate', () async {
                  final res = await _send(true);
                  setState(() => _result = res);
                })),
      ]),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          const MtHeader('Import assets from Excel',
              subtitle: 'Load your existing machine list in one go. Validate first — nothing is saved until every row is correct, and then all rows are saved together.'),
          if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(_error!)),
          if (_done != null) NoteBanner(_done!, color: kGreen),
          DetailSection('Template & File', children: [
            const Text('1. Download the template — one machine per row; the Instructions sheet lists the allowed categories, criticality and your plant names.'),
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerLeft,
              child: smallBtn(
                _busy == 'template' ? 'Downloading…' : 'Download template',
                _busy.isNotEmpty
                    ? null
                    : () => _go('template',
                        () => Files.downloadAndOpen('/maintenance/assets/import-template', 'maintenance_asset_import_template.xlsx')),
              ),
            ),
            const SizedBox(height: 10),
            const Text('2. Choose the filled file.'),
            const SizedBox(height: 6),
            Row(children: [
              smallBtn('Choose file', _busy.isNotEmpty
                  ? null
                  : () async {
                      final f = await Files.pickFile(extensions: ['xlsx', 'xlsm']);
                      if (f != null && mounted) {
                        setState(() {
                          _file = f;
                          _result = null;
                          _done = null;
                          _error = null;
                        });
                      }
                    }),
              const SizedBox(width: 8),
              Expanded(child: Text(_file?.filename ?? 'No file chosen', overflow: TextOverflow.ellipsis)),
            ]),
            const SizedBox(height: 10),
            const Text('3. Validate, fix any rows the check reports, then Import.'),
          ]),
          if (r != null)
            DetailSection('Validation result', children: [
              Text(
                (asInt(r['error_rows']) ?? 0) > 0
                    ? '${r['error_rows']} of ${r['total_rows']} row(s) have errors — fix them in the file and validate again.'
                    : 'All ${r['total_rows']} row(s) are valid and ready to import.',
                style: TextStyle(fontWeight: FontWeight.w600, color: (asInt(r['error_rows']) ?? 0) > 0 ? kRed : kGreen),
              ),
              for (final x in bad.isNotEmpty ? bad : rows)
                LineItem(
                  title: 'Row ${x['row']} · ${str(x['asset_code']).isEmpty ? '—' : x['asset_code']}${x['auto_code'] == true ? ' (auto)' : ''}',
                  subtitle: [
                    txt(x['name']),
                    if (bad.isEmpty) '${x['plant']} · ${x['category']}',
                    for (final e in (x['errors'] is List ? x['errors'] as List : const [])) '• $e',
                  ].join('\n'),
                ),
            ]),
        ],
      ),
    );
  }
}
