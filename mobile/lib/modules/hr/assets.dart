import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/me/assets, app/dashboard/hr/assets (+ [id]),
// components/hr/admin/AssetDialogs.tsx

/// My HR › My Assets.
class MyAssetsPage extends StatelessWidget {
  const MyAssetsPage({super.key});

  @override
  Widget build(BuildContext context) => ApiLoader<(List<Json>, List<Json>)>(
        load: () async {
          final a = (await Api.list('/hr/assets/mine')).rows;
          final h = (await Api.list('/hr/assets/mine/history')).rows.where((r) => str(r['returned_on']).isNotEmpty).toList();
          return (a, h);
        },
        builder: (ctx, data, reload) {
          final (assets, history) = data;
          final today = todayIso();
          return ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            const PageHeader('My Assets', subtitle: 'Company assets currently issued to you. If something here is wrong or missing, contact HR / Admin.'),
            if (assets.isEmpty) padded(const HintText('No company assets are issued to you right now.')),
            for (final a in assets)
              RecordCard(
                code: str(a['asset_code']),
                title: str(a['name']),
                subtitle: joinNonEmpty([a['make'], a['model']], ' '),
                trailing: HrPill(labelOf(assetCategoryLabels, a['category']), '#2563EB'),
                meta: [
                  ('Serial', str(a['serial_number']).isEmpty ? '—' : str(a['serial_number'])),
                  ('Issued', fmtDate(a['issued_on'])),
                  if (str(a['expected_return_on']).isNotEmpty)
                    ('Return by', '${fmtDate(a['expected_return_on'])}${str(a['expected_return_on']).compareTo(today) < 0 ? ' (overdue)' : ''}'),
                  ('Condition', str(a['condition']).isEmpty ? '—' : labelOf(assetConditionLabels, a['condition'])),
                ],
              ),
            if (history.isNotEmpty) ...[
              const BlockTitle('Previously held'),
              for (final r in history)
                RecordCard(
                  code: str(r['asset_code']),
                  title: str(r['asset_name']),
                  meta: [
                    ('Category', str(r['asset_category']).isEmpty ? '—' : labelOf(assetCategoryLabels, r['asset_category'])),
                    ('Issued', fmtDate(r['issued_on'])),
                    ('Returned', fmtDate(r['returned_on'])),
                    ('Condition on return', str(r['condition_on_return']).isEmpty ? '—' : labelOf(assetConditionLabels, r['condition_on_return'])),
                  ],
                ),
            ],
          ]);
        },
      );
}

Future<List<Option<int>>> _branchOptions() async =>
    [for (final b in (await Api.list('/hr/assets/lookups/branches')).rows) Option(asInt(b['id']) ?? 0, str(b['name']))];

/// Add / edit asset. Returns the saved asset or null.
Future<Json?> showAssetForm(BuildContext context, {Json? asset}) async {
  List<Option<int>> branches = [];
  try {
    branches = await _branchOptions();
  } catch (_) {}
  if (!context.mounted) return null;
  final a = asset;
  final code = TextEditingController(text: str(a?['asset_code']));
  final name = TextEditingController(text: str(a?['name']));
  var category = str(a?['category']).isEmpty ? 'laptop' : str(a?['category']);
  final make = TextEditingController(text: str(a?['make']));
  final model = TextEditingController(text: str(a?['model']));
  final serial = TextEditingController(text: str(a?['serial_number']));
  DateTime? purchase = dateOf(a?['purchase_date']);
  final cost = TextEditingController(text: a?['purchase_cost'] == null ? '' : str(a?['purchase_cost']));
  DateTime? warranty = dateOf(a?['warranty_until']);
  final vendor = TextEditingController(text: str(a?['vendor_name']));
  final invoice = TextEditingController(text: str(a?['invoice_no']));
  int? branch = asInt(a?['branch_id']);
  String? condition = textOrNull(str(a?['condition'])) ?? (a == null ? 'new' : null);
  final remarks = TextEditingController(text: str(a?['remarks']));
  Json? saved;
  final ok = await showFormSheet(context,
      title: a != null ? 'Edit ${a['asset_code']}' : 'Add asset',
      saveLabel: a != null ? 'Save' : 'Add asset',
      builder: (ctx, setS) => [
            HintText(a != null ? '${a['name']} — changes apply to the asset register.' : 'Leave the asset code blank to auto-number it (AST-0001, AST-0002…).'),
            AppTextField(label: 'Asset code', controller: code, hint: a == null ? 'Auto' : null),
            AppTextField(label: 'Name', controller: name, required: true, hint: 'Dell Latitude 5440'),
            AppSelect<String>(label: 'Category', value: category, clearable: false, options: optionsOf(assetCategoryLabels),
                onChanged: (o) => setS(() => category = o?.value ?? category)),
            AppTextField(label: 'Make', controller: make, hint: 'Dell'),
            AppTextField(label: 'Model', controller: model),
            AppTextField(label: 'Serial / IMEI', controller: serial),
            DateField(label: 'Purchase date', value: purchase, onChanged: (d) => setS(() => purchase = d)),
            AppTextField(label: 'Cost (₹)', controller: cost, keyboardType: AppTextField.number),
            DateField(label: 'Warranty until', value: warranty, onChanged: (d) => setS(() => warranty = d)),
            AppTextField(label: 'Vendor', controller: vendor),
            AppTextField(label: 'Invoice no.', controller: invoice),
            AppSelect<int>(label: 'Plant', value: branch, options: branches, onChanged: (o) => setS(() => branch = o?.value)),
            AppSelect<String>(label: 'Condition', value: condition, options: optionsOf(assetConditionLabels), onChanged: (o) => setS(() => condition = o?.value)),
            AppTextField(label: 'Remarks', controller: remarks, maxLines: 2),
          ],
      onSave: () async {
        final p = <String>[];
        if (name.text.trim().isEmpty) p.add('Asset name is required, e.g. "Dell Latitude 5440".');
        if (cost.text.trim().isNotEmpty && !(toNum(cost.text) >= 0 && num.tryParse(cost.text.trim()) != null)) {
          p.add('Purchase cost must be a number of rupees (0 or more).');
        }
        if (a != null && code.text.trim().isEmpty) p.add('Asset code cannot be blank on an existing asset.');
        if (p.isNotEmpty) throw p.join(' ');
        final payload = <String, dynamic>{
          'name': name.text.trim(), 'category': category, 'make': textOrNull(make.text), 'model': textOrNull(model.text),
          'serial_number': textOrNull(serial.text), 'purchase_date': isoOrNull(purchase), 'purchase_cost': textOrNull(cost.text),
          'vendor_name': textOrNull(vendor.text), 'invoice_no': textOrNull(invoice.text), 'warranty_until': isoOrNull(warranty),
          'branch_id': branch, 'condition': condition, 'remarks': textOrNull(remarks.text),
        };
        if (a != null || code.text.trim().isNotEmpty) payload['asset_code'] = code.text.trim();
        saved = mapOf(a != null ? await Api.patch('/hr/assets/${a['id']}', data: payload) : await Api.post('/hr/assets', data: payload));
      });
  return ok ? saved : null;
}

/// HR › Assets register.
class HrAssetsPage extends StatefulWidget {
  const HrAssetsPage({super.key});

  @override
  State<HrAssetsPage> createState() => _HrAssetsPageState();
}

class _HrAssetsPageState extends State<HrAssetsPage> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = '';
  String? _category;
  int? _branch;
  int? _holder;
  String? _holderName;
  List<Json> _all = [];
  List<Option<int>> _branches = [];
  String? _notice;

  @override
  void initState() {
    super.initState();
    _branchOptions().then((b) { if (mounted) setState(() => _branches = b); }).catchError((_) {});
  }

  void _reload() => _list.currentState?.reload();

  void _toggle(String s) {
    setState(() => _status = _status == s ? '' : s);
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    int count(String s) => _all.where((a) => a['status'] == s).length;
    final filtered = _category != null || _branch != null || _holder != null;
    return ApiListView(
      key: _list,
      searchHint: 'Search code, name, serial, invoice, holder…',
      load: (_, q) async {
        final page = await Api.list('/hr/assets', query: {'search': q, 'category': _category, 'branch_id': _branch, 'holder_id': _holder});
        _all = page.rows;
        if (mounted) setState(() {});
        final shown = _status.isEmpty
            ? page.rows
            : _status == 'lost_retired'
                ? page.rows.where((a) => a['status'] == 'lost' || a['status'] == 'retired').toList()
                : page.rows.where((a) => a['status'] == _status).toList();
        return ApiPage(shown);
      },
      emptyText: filtered || _status.isNotEmpty ? 'No assets match these filters.' : 'No assets registered yet. Use “+ Add Asset” to register the first one.',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        PageHeader('Assets',
            subtitle: 'Company asset register — laptops, phones, SIMs, ID and access cards, vehicles. Issue to employees and record returns.',
            actions: [
              if (Perm.can('hr', 'assets', 'create'))
                headerButton('Add Asset', () async {
                  final a = await showAssetForm(context);
                  if (a != null && mounted) {
                    setState(() => _notice = '${a['asset_code']} — ${a['name']} added to the register.');
                    _reload();
                  }
                }),
            ]),
        if (_notice != null) padded(NoticeBanner(_notice!)),
        TileGrid([
          StatTile(label: filtered ? 'Matching' : 'Total assets', value: '${_all.length}', onTap: () => setState(() { _status = ''; _reload(); })),
          StatTile(label: 'In stock', value: '${count('in_stock')}', color: hexColor(assetStatusHex['in_stock']!), selected: _status == 'in_stock', onTap: () => _toggle('in_stock')),
          StatTile(label: 'Issued', value: '${count('issued')}', color: hexColor(assetStatusHex['issued']!), selected: _status == 'issued', onTap: () => _toggle('issued')),
          StatTile(label: 'Under repair', value: '${count('under_repair')}', color: hexColor(assetStatusHex['under_repair']!), selected: _status == 'under_repair', onTap: () => _toggle('under_repair')),
          StatTile(label: 'Lost / retired', value: '${count('lost') + count('retired')}', color: hexColor(assetStatusHex['lost']!), selected: _status == 'lost_retired', onTap: () => _toggle('lost_retired')),
        ]),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Column(children: [
            AppSelect<String>(label: 'All categories', value: _category, options: optionsOf(assetCategoryLabels),
                onChanged: (o) { setState(() => _category = o?.value); _reload(); }),
            const SizedBox(height: 8),
            AppSelect<int>(label: 'All plants', value: _branch, options: _branches, onChanged: (o) { setState(() => _branch = o?.value); _reload(); }),
            const SizedBox(height: 8),
            AppSelect<int>(label: 'Any holder', value: _holder, valueLabel: _holderName, loadOptions: directoryOptions,
                onChanged: (o) { setState(() { _holder = o?.value; _holderName = o?.label; }); _reload(); }),
          ]),
        ),
      ]),
      itemBuilder: (ctx, a, reload) => RecordCard(
        code: str(a['asset_code']),
        title: str(a['name']),
        subtitle: joinNonEmpty([a['make'], a['model']], ' '),
        trailing: statusPill(a['status'], assetStatusLabels, assetStatusHex),
        meta: [
          ('Category', labelOf(assetCategoryLabels, a['category'])),
          ('Serial', str(a['serial_number']).isEmpty ? '—' : str(a['serial_number'])),
          ('Plant', str(a['branch_name']).isEmpty ? '—' : str(a['branch_name'])),
          ('Held by', str(a['current_holder_name']).isEmpty
              ? '—'
              : '${a['current_holder_name']} since ${fmtDate(a['issued_on'])}${str(a['expected_return_on']).isNotEmpty && str(a['expected_return_on']).compareTo(todayIso()) < 0 ? ' · return overdue' : ''}'),
          ('Condition', str(a['condition']).isEmpty ? '—' : labelOf(assetConditionLabels, a['condition'])),
        ],
        onTap: () async {
          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => AssetDetailScreen(assetId: asInt(a['id']) ?? 0)));
          reload();
        },
      ),
    );
  }
}

/// One asset with issue / return / status actions and its issue history.
class AssetDetailScreen extends StatefulWidget {
  const AssetDetailScreen({super.key, required this.assetId});
  final int assetId;

  @override
  State<AssetDetailScreen> createState() => _AssetDetailScreenState();
}

class _AssetDetailScreenState extends State<AssetDetailScreen> {
  Json? _a;
  Object? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final a = mapOf(await Api.get('/hr/assets/${widget.assetId}'));
      if (mounted) setState(() { _a = a; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _done(Json a, String msg) => setState(() { _a = a; _notice = msg; });

  Future<void> _issue() async {
    final a = _a!;
    int? userId;
    String? userName;
    DateTime? issuedOn = DateTime.now();
    DateTime? expected;
    String? condition = textOrNull(str(a['condition'])) ?? 'good';
    final remarks = TextEditingController();
    Json? res;
    final ok = await showFormSheet(context,
        title: 'Issue ${a['asset_code']}',
        saveLabel: 'Issue',
        builder: (ctx, setS) => [
              HintText('${a['name']} will be recorded against the employee and listed under their My Assets.'),
              AppSelect<int>(label: 'Employee', required: true, value: userId, valueLabel: userName, loadOptions: directoryOptions,
                  onChanged: (o) => setS(() { userId = o?.value; userName = o?.label; })),
              DateField(label: 'Issued on', value: issuedOn, onChanged: (d) => setS(() => issuedOn = d)),
              DateField(label: 'Expected return', value: expected, onChanged: (d) => setS(() => expected = d)),
              AppSelect<String>(label: 'Condition', value: condition, options: optionsOf(assetConditionLabels), onChanged: (o) => setS(() => condition = o?.value)),
              AppTextField(label: 'Remarks', controller: remarks, maxLines: 2),
            ],
        onSave: () async {
          if (userId == null) throw 'Pick the employee who is receiving this asset.';
          res = mapOf(await Api.post('/hr/assets/${a['id']}/issue', data: {
            'user_id': userId, 'issued_on': isoOrNull(issuedOn), 'expected_return_on': isoOrNull(expected),
            'condition_on_issue': condition, 'remarks': textOrNull(remarks.text),
          }));
        });
    if (ok && res != null && mounted) _done(res!, '${res!['asset_code']} issued to ${res!['current_holder_name'] ?? userName}.');
  }

  Future<void> _return() async {
    final a = _a!;
    DateTime? returnedOn = DateTime.now();
    var condition = textOrNull(str(a['condition'])) ?? 'good';
    var next = 'in_stock';
    final remarks = TextEditingController();
    Json? res;
    final ok = await showFormSheet(context,
        title: 'Receive back ${a['asset_code']}',
        saveLabel: 'Record return',
        builder: (ctx, setS) => [
              HintText('From ${str(a['current_holder_name']).isEmpty ? 'the employee' : a['current_holder_name']}${str(a['issued_on']).isEmpty ? '' : ', issued ${fmtDate(a['issued_on'])}'}.'),
              DateField(label: 'Returned on', value: returnedOn, onChanged: (d) => setS(() => returnedOn = d)),
              AppSelect<String>(label: 'Condition on return', value: condition, clearable: false, options: optionsOf(assetConditionLabels),
                  onChanged: (o) => setS(() {
                        condition = o?.value ?? condition;
                        if (condition == 'damaged' && next == 'in_stock') next = 'under_repair';
                      })),
              AppSelect<String>(label: 'Send to', value: next, clearable: false,
                  options: const [Option('in_stock', 'In stock'), Option('under_repair', 'Under repair'), Option('retired', 'Retired')],
                  onChanged: (o) => setS(() => next = o?.value ?? next)),
              AppTextField(label: 'Remarks', controller: remarks, maxLines: 2, hint: 'Missing charger, screen scratch…'),
            ],
        onSave: () async {
          res = mapOf(await Api.post('/hr/assets/${a['id']}/return', data: {
            'returned_on': isoOrNull(returnedOn), 'condition_on_return': condition, 'next_status': next, 'remarks': textOrNull(remarks.text),
          }));
        });
    if (ok && res != null && mounted) _done(res!, 'Return recorded. ${res!['asset_code']} is now ${labelOf(assetStatusLabels, res!['status']).toLowerCase()}.');
  }

  Future<void> _status(String status, String label, String title, String message, bool danger) async {
    final a = _a!;
    final remarks = await promptDialog(context, title: title, message: message, label: 'Remarks', required: false, confirmLabel: label);
    if (remarks == null || !mounted) return;
    try {
      final r = mapOf(await Api.post('/hr/assets/${a['id']}/status', data: {'status': status, 'remarks': textOrNull(remarks)}));
      if (mounted) _done(r, '${r['asset_code']} is now ${labelOf(assetStatusLabels, r['status'])}.');
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  Future<void> _delete() async {
    final a = _a!;
    final yes = await confirmDialog(context,
        title: 'Delete ${a['asset_code']}?', message: 'It will be removed from the register. Its issue history is kept for audit.', confirmLabel: 'Delete', danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.delete('/hr/assets/${a['id']}'), success: '${a['asset_code']} deleted.');
    if (ok && mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final a = _a;
    if (a == null) return SubPage(title: 'Asset', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    final canEdit = Perm.can('hr', 'assets', 'edit');
    final st = str(a['status']);
    final statusActions = <(String, String, String, String, bool)>[
      if (st == 'in_stock') ('under_repair', 'Send for repair', 'Send for repair?', 'Add where it went and what is wrong (optional).', false),
      if (st == 'in_stock') ('retired', 'Retire', 'Retire this asset?', 'Retired assets can no longer be issued. Add a reason (optional).', true),
      if (st == 'under_repair' || st == 'retired' || st == 'lost')
        ('in_stock', 'Back to stock', 'Move back to stock?', 'The asset becomes available to issue again. Add a note (optional).', false),
      if (st == 'under_repair') ('retired', 'Retire', 'Retire this asset?', 'Retired assets can no longer be issued. Add a reason (optional).', true),
      if (st != 'lost' && st != 'retired')
        ('lost', 'Mark lost', 'Mark as lost?',
            st == 'issued'
                ? 'This closes the issue to ${str(a['current_holder_name']).isEmpty ? 'the employee' : a['current_holder_name']} and clears them as holder. Describe what happened.'
                : 'Describe what happened (optional).',
            true),
    ];
    final history = rowsOf(a['assignments']);
    return SubPage(
      title: 'Asset ${a['asset_code']}',
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 40), children: [
          if (_notice != null) padded(NoticeBanner(_notice!)),
          DetailSection(str(a['name']), action: statusPill(st, assetStatusLabels, assetStatusHex), children: [
            Text(st == 'issued'
                ? 'With ${a['current_holder_name']} since ${fmtDate(a['issued_on'])}${str(a['expected_return_on']).isEmpty ? '' : ', due back ${fmtDate(a['expected_return_on'])}'}.'
                : st == 'in_stock'
                    ? 'In stock and available to issue.'
                    : 'Not available to issue while ${labelOf(assetStatusLabels, st).toLowerCase()}.'),
            HintText(joinNonEmpty([labelOf(assetCategoryLabels, a['category']), joinNonEmpty([a['make'], a['model']], ' '), a['branch_name']])),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (canEdit && st == 'in_stock') headerButton('Issue to employee', _issue, icon: Icons.person_add_alt_rounded),
              if (canEdit && st == 'issued') headerButton('Record return', _return, icon: Icons.undo_rounded),
              if (canEdit)
                for (final s in statusActions) headerButton(s.$2, () => _status(s.$1, s.$2, s.$3, s.$4, s.$5), primary: false),
              if (canEdit)
                headerButton('Edit', () async {
                  final r = await showAssetForm(context, asset: a);
                  if (r != null && mounted) _done(r, '${r['asset_code']} saved.');
                }, primary: false),
              if (st != 'issued' && Perm.can('hr', 'assets', 'delete')) headerButton('Delete', _delete, primary: false),
            ]),
          ]),
          DetailSection('Details', children: [
            FieldRow('Serial / IMEI', a['serial_number']),
            FieldRow('Condition', str(a['condition']).isEmpty ? null : labelOf(assetConditionLabels, a['condition'])),
            FieldRow('Plant', a['branch_name']),
            FieldRow('Added by', a['created_by_name']),
          ]),
          DetailSection('Purchase', children: [
            FieldRow('Purchase date', str(a['purchase_date']).isEmpty ? null : fmtDate(a['purchase_date'])),
            FieldRow('Cost', a['purchase_cost'] == null ? null : fmtMoney(a['purchase_cost'])),
            FieldRow('Vendor', a['vendor_name']),
            FieldRow('Invoice no.', a['invoice_no']),
            FieldRow('Warranty until', str(a['warranty_until']).isEmpty ? null : fmtDate(a['warranty_until'])),
            if (str(a['remarks']).isNotEmpty) FieldRow('Remarks', a['remarks']),
          ]),
          BlockTitle('Issue history (${history.length})'),
          if (history.isEmpty) padded(const HintText('Never issued yet — use Issue to employee above.')),
          for (final r in history)
            RecordCard(
              title: str(r['user_name']).isEmpty ? 'User #${r['user_id']}' : str(r['user_name']),
              subtitle: str(r['remarks']),
              trailing: str(r['returned_on']).isEmpty ? const HrPill('With employee', '#2563EB') : null,
              meta: [
                ('Issued', '${fmtDate(r['issued_on'])}${str(r['issued_by_name']).isEmpty ? '' : ' by ${r['issued_by_name']}'}'),
                ('Expected back', fmtDate(r['expected_return_on'])),
                if (str(r['returned_on']).isNotEmpty)
                  ('Returned', '${fmtDate(r['returned_on'])}${str(r['received_by_name']).isEmpty ? '' : ' to ${r['received_by_name']}'}'),
                ('Condition (out → in)',
                    '${str(r['condition_on_issue']).isEmpty ? '—' : labelOf(assetConditionLabels, r['condition_on_issue'])} → ${str(r['condition_on_return']).isEmpty ? '—' : labelOf(assetConditionLabels, r['condition_on_return'])}'),
              ],
            ),
        ]),
      ),
    );
  }
}