import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'store_common.dart';
import 'store_widgets.dart';

// Outward: Issues (incl. the dynamic issue form, also used for job-work
// challans), Transfers, Reservations (portal: store/issues, issues/[id],
// MaterialIssueForm, transfers, transfers/new, transfers/[id], reservations).

// ── Issues ───────────────────────────────────────────────────────────────────

class IssuesTab extends StatefulWidget {
  const IssuesTab({super.key});

  @override
  State<IssuesTab> createState() => _IssuesTabState();
}

class _IssuesTabState extends State<IssuesTab> {
  final _list = GlobalKey<ApiListViewState>();

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('issues', 'create')
            ? CreateFab(
                label: 'New Issue',
                onPressed: () async {
                  final i = await openIssueForm(context);
                  if (i != null && context.mounted) {
                    _list.currentState?.reload();
                    openScreen(context, IssueDetailScreen(issueId: toInt(i['id'])!));
                  }
                })
            : null,
        body: ApiListView(
          key: _list,
          searchHint: 'Search issue no., store, type, vendor, department…',
          load: (page, q) async {
            final p = await Api.list('/store/material-issues');
            final ql = q.toLowerCase();
            if (ql.isEmpty) return p;
            return ApiPage(p.rows
                .where((i) => [
                      i['issue_number'],
                      i['p2p_number'],
                      i['location_name'],
                      i['issue_type_label'],
                      i['challan_number'],
                      i['vendor_name'],
                      i['department_name'],
                      i['project_or_work_order'],
                      i['requested_by_name'],
                      i['issued_by_name'],
                    ].any((x) => '${x ?? ''}'.toLowerCase().contains(ql)))
                .toList());
          },
          emptyText: 'No material issues yet${can('issues', 'create') ? ' — use + New Issue to hand material out of a store.' : '.'}',
          header: const StorePageHeader('Material Issues',
              subtitle: 'Material handed out of a store — to production, a project, a vendor for job work, a site or as samples.'),
          itemBuilder: (ctx, i, reload) => RecordCard(
            code: txt(i['issue_number']),
            title: txt(i['issue_type_label'] ?? 'Material issue'),
            subtitle: txt(i['location_name']),
            meta: [
              if (i['p2p_number'] != null) ('Purchase Requisition', txt(i['p2p_number'])),
              if (i['challan_number'] != null) ('Challan No.', txt(i['challan_number'])),
              if (i['vendor_name'] != null) ('Vendor', txt(i['vendor_name'])),
              if (i['department_name'] != null) ('Department', txt(i['department_name'])),
              if (i['project_or_work_order'] != null) ('Project / WO', txt(i['project_or_work_order'])),
              ('Requested By', txt(i['requested_by_name'])),
              ('Issued By', txt(i['issued_by_name'])),
              ('Date', fmtDate(i['issue_date'])),
              ('Items', '${jsonList(i['items']).length}'),
            ],
            onTap: () => openThen(ctx, IssueDetailScreen(issueId: toInt(i['id'])!), reload),
          ),
        ),
      );
}

class IssueDetailScreen extends StatelessWidget {
  const IssueDetailScreen({super.key, required this.issueId, this.onOpenJobWork});
  final int issueId;
  final VoidCallback? onOpenJobWork;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        load: () async => jsonMap(await Api.get('/store/material-issues/$issueId')),
        builder: (ctx, i, reload) {
          final items = jsonList(i['items']);
          final showLineElement =
              items.any((l) => l['order_project_element_id'] != null && l['order_project_element_id'] != i['order_project_element_id']);
          String? yesNo(Object? v) => v == null ? null : (v == true ? 'Yes' : 'No');
          final dispatch = [
            i['challan_number'], i['expected_return_date'], i['returnable'], i['destructive'], i['purpose'], i['site_address'],
            i['vehicle_number'], i['transporter'], i['lr_number'], i['scrap_buyer'],
          ].any((x) => x != null);
          return SubPage(
            title: txt(i['issue_number']),
            body: detailList([
              SummaryCard(
                title: txt(i['issue_number']),
                text:
                    '${i['issue_type_label'] ?? 'Material'} issue from ${i['location_name'] ?? 'the store'}${i['department_name'] != null ? ' to ${i['department_name']}' : ''}${i['against_label'] != null ? ' against ${i['against_label']}' : ''} — ${items.length} item line${items.length == 1 ? '' : 's'}.',
                badges: [if (i['issue_type_label'] != null) pill(txt(i['issue_type_label']), cBlue)],
                meta: [
                  'Issued ${fmtDate(i['issue_date'])}',
                  if (i['issued_by_name'] != null) 'by ${i['issued_by_name']}',
                  if (i['requested_by_name'] != null) 'Requested by ${i['requested_by_name']}',
                ],
              ),
              DetailSection('Issued To', children: [
                FieldRow('Store', i['location_name']),
                FieldRow('Department', i['department_name']),
                if (i['against_label'] != null) FieldRow('Against', i['against_label']),
                if (i['project_or_work_order'] != null) FieldRow('Work Order / Reference', i['project_or_work_order']),
                if (i['op_number'] != null)
                  FieldRow('Project',
                      '${i['op_number']}${i['element_no'] != null ? ' · ${i['element_no']}' : ''}${i['element_label'] != null ? ' — ${i['element_label']}' : ''}'),
                if (i['p2p_number'] != null) FieldRow('Purchase Requisition', i['p2p_number']),
              ]),
              if (dispatch)
                DetailSection('Dispatch & Return', children: [
                  if (i['challan_number'] != null) FieldRow('Challan No.', i['challan_number']),
                  if (i['returnable'] != null) FieldRow('Returnable', yesNo(i['returnable'])),
                  if (i['expected_return_date'] != null) FieldRow('Expected return', fmtDate(i['expected_return_date'])),
                  if (i['purpose'] != null) FieldRow('Purpose', i['purpose'] == 'trial' ? 'Trial' : 'Sample'),
                  if (i['destructive'] != null) FieldRow('Destructive test', yesNo(i['destructive'])),
                  if (i['site_address'] != null) FieldRow('Site', i['site_address']),
                  if (i['vehicle_number'] != null || i['transporter'] != null || i['lr_number'] != null)
                    FieldRow('Transport',
                        [i['transporter'], i['vehicle_number'], if (i['lr_number'] != null) 'LR ${i['lr_number']}'].where((x) => x != null).join(' · ')),
                  if (i['scrap_buyer'] != null) FieldRow('Scrap buyer', i['scrap_buyer']),
                ]),
              DetailSection('Notes', children: [
                if (i['project_stock_override_reason'] != null)
                  FieldRow('Project stock used (Store Manager override)', i['project_stock_override_reason']),
                FieldRow('Remarks', i['remarks']),
              ]),
              DetailSection('Items (${items.length})', children: [
                if (items.isEmpty) const Hint('No item lines on this issue.'),
                for (final l in items)
                  LineTile(
                    title: '${txt(l['item_code'])} — ${txt(l['item_name'])}',
                    trailing: fmtQ(l['quantity'], l['uom']),
                    facts: [
                      MiniFact('Batch', txt(l['batch_number'])),
                      if (l['bin_code'] != null) MiniFact('Bin', txt(l['bin_code'])),
                      if (l['serial_numbers'] is List && (l['serial_numbers'] as List).isNotEmpty)
                        MiniFact('Serial no.', (l['serial_numbers'] as List).join(', ')),
                      if (showLineElement) MiniFact('Vehicle / lot', txt(l['element_display'])),
                      if (l['remarks'] != null) MiniFact('Remarks', txt(l['remarks'])),
                    ],
                  ),
              ]),
              if (i['issue_type'] == 'job_work')
                DetailSection('Job Work Challan', children: [
                  const Hint('Stock at the vendor and receiving back are in Store › Outward › Job Work.'),
                  const SizedBox(height: 8),
                  ManagedDocButtons(
                    entityType: 'store_job_work_challan',
                    entityId: toInt(i['id'])!,
                    canModify: can('issues', 'edit'),
                    downloadName: 'JW-Challan-${'${i['challan_number'] ?? i['issue_number']}'.replaceAll('/', '-')}',
                  ),
                ]),
            ]),
          );
        },
      );
}

// Issue form ------------------------------------------------------------------

const _lookupOf = {
  'department': 'departments',
  'maintenance_work_order': 'maintenance_work_orders',
  'asset': 'assets',
  'ncr': 'ncrs',
  'inspection_lot': 'inspection_lots',
  'customer': 'customers',
  'vendor': 'vendors',
  'service_request': 'service_requests',
};

bool _condHolds(String cond, Map<String, Object?> vals) {
  final parts = cond.split('=');
  final v = vals[parts[0]];
  if (parts.length == 1) return v != null && v != '';
  return v == (parts[1] == 'true');
}

bool _isRequired(String rule) => rule == 'required' || rule.startsWith('if:') || rule == 'unless:sales_order';

class _IssueLine {
  int? itemId;
  final qty = TextEditingController();
  String batch = '';
  final batchText = TextEditingController();
  final remarks = TextEditingController();
  int? binId;
  List<String> serials = [];
}

class _BackLine {
  int? itemId;
  final qty = TextEditingController();
}

/// New Material Issue — or, with [challan], a New Job Work Challan (type
/// fixed to Job work; the plain issue form doesn't offer it).
Future<Json?> openIssueForm(BuildContext context, {bool challan = false}) async {
  List<Json> types, projects;
  Json standard;
  try {
    final r = await Future.wait<Object>([
      docTypes('issue'),
      Api.get('/store/material-issues/form-standard').then((v) => v as Object),
      Api.list('/store/material-issues/dispatch-projects').then((p) => p.rows, onError: (Object _) => <Json>[]),
      StoreData.items(),
    ]);
    types = r[0] as List<Json>;
    standard = jsonMap(r[1]);
    projects = r[2] as List<Json>;
  } catch (e) {
    if (context.mounted) showSnack(context, "Couldn't load the issue form: ${ApiClient.describe(e)}", error: true);
    return null;
  }
  if (!context.mounted) return null;
  final storeManager = Perm.isAdmin || Perm.user['is_store_manager'] == true;
  String? issueType = challan ? 'job_work' : null;
  int? loc;
  final vals = <String, Object?>{};
  final textCtl = <String, TextEditingController>{};
  final lookups = <String, List<Json>>{};
  final remarks = TextEditingController();
  final override = TextEditingController();
  ProjectUnit? unit;
  final lines = <_IssueLine>[_IssueLine()];
  final back = <_BackLine>[_BackLine()];
  StockSnapshot? stock;
  String? stockError;
  Json? saved;
  final typeChoices = types.where((t) => t['value'] != 'job_work' && t['allowed'] != false).toList();

  Json? spec() => issueType == null ? null : (standard[issueType] is Map ? jsonMap(standard[issueType]) : null);
  List<Json> shownFields() =>
      jsonList(spec()?['fields']).where((f) => !'${f['rule']}'.startsWith('if:') || _condHolds('${f['rule']}'.substring(3), vals)).toList();

  void loadLookups(StateSetter setS) {
    for (final f in jsonList(spec()?['fields'])) {
      final list = _lookupOf[f['kind']];
      if (list != null && !lookups.containsKey(list)) {
        lookups[list] = const [];
        Api.list('/store/material-issues/lookups/$list').then((p) => setS(() => lookups[list] = p.rows), onError: (Object _) {});
      }
    }
  }

  void loadStock(StateSetter setS) {
    if (loc == null) return;
    StockSnapshot.load(loc!).then((s) => setS(() {
          stock = s;
          stockError = null;
        }), onError: (Object e) => setS(() => stockError = "Could not load the store's stock. ${ApiClient.describe(e)}"));
  }

  Map<int, double> demand() {
    final m = <int, double>{};
    for (final l in lines) {
      final q = parseNum(l.qty.text) ?? 0;
      if (l.itemId != null && q > 0) m[l.itemId!] = (m[l.itemId!] ?? 0) + q;
    }
    return m;
  }

  String lineState(_IssueLine l) {
    if (loc == null || stock == null || l.itemId == null || (parseNum(l.qty.text) ?? 0) <= 0) return 'none';
    final avail = stock!.byItem[l.itemId]?.available ?? 0;
    if (avail <= 0) return 'out';
    return (demand()[l.itemId] ?? 0) - avail > 1e-9 ? 'short' : 'ok';
  }

  Widget fieldWidget(Json f, StateSetter setS) {
    final key = '${f['key']}';
    final rule = '${f['rule']}';
    final req = _isRequired(rule);
    final label = '${f['label']}${rule.startsWith('one_of:') ? ' (or the other)' : ''}';
    final v = vals[key];
    switch (f['kind']) {
      case 'bool':
        return AppSelect<bool>(
            label: label,
            required: req,
            value: v is bool ? v : null,
            options: const [Option(true, 'Yes'), Option(false, 'No')],
            onChanged: (o) => setS(() => vals[key] = o?.value));
      case 'choice':
        final opts = f['options'] is Map ? (f['options'] as Map) : const {};
        return AppSelect<String>(
            label: label,
            required: req,
            value: v?.toString(),
            options: [for (final e in opts.entries) Option('${e.key}', '${e.value}')],
            onChanged: (o) => setS(() => vals[key] = o?.value));
      case 'date':
        return DateField(
            label: label,
            required: req,
            value: v is String ? DateTime.tryParse(v) : null,
            firstDate: DateTime.now().subtract(const Duration(days: 1)),
            onChanged: (d) => setS(() => vals[key] = d == null ? null : apiDate(d)));
      case 'erp_project':
        return AppSelect<int>(
            label: label,
            required: req,
            value: toInt(v),
            options: [
              for (final p in projects)
                if (toInt(p['id']) != null)
                  Option(toInt(p['id'])!,
                      '${txt(p['label'])}${issueType == 'dispatch' && p['third_party_inspection_required'] == true ? ' · inspection required' : ''}'),
            ],
            onChanged: (o) => setS(() => vals[key] = o?.value));
      default:
        final list = _lookupOf[f['kind']];
        if (list != null) {
          return AppSelect<int>(
              label: label,
              required: req,
              value: toInt(v),
              options: idLabelOptions(lookups[list]),
              onChanged: (o) => setS(() => vals[key] = o?.value));
        }
        final c = textCtl.putIfAbsent(key, () => TextEditingController(text: v?.toString() ?? ''));
        return AppTextField(
            label: label, required: req, controller: c, maxLines: key == 'site_address' ? 2 : 1, onChanged: (x) => vals[key] = x);
    }
  }

  Widget lineBox(int idx, StateSetter setS) {
    final l = lines[idx];
    final it = l.itemId == null ? null : StoreData.itemById[l.itemId];
    final st = lineState(l);
    final bad = st == 'short' || st == 'out';
    final b = l.itemId == null ? null : stock?.byItem[l.itemId];
    final need = l.itemId == null ? 0.0 : (demand()[l.itemId] ?? 0);
    return LineBox(
      key: ObjectKey(l),
      title: '#${idx + 1}',
      danger: bad,
      onRemove: () => setS(() {
        lines.remove(l);
        if (lines.isEmpty) lines.add(_IssueLine());
      }),
      children: [
        ItemSelect(
            value: l.itemId,
            onChanged: (x) => setS(() {
                  l.itemId = toInt(x?['id']);
                  l.batch = '';
                  l.binId = null;
                  l.serials = [];
                })),
        AppTextField(
            label: 'Quantity${it?['uom'] != null ? ' (${it!['uom']})' : ''}',
            required: true,
            controller: l.qty,
            keyboardType: AppTextField.number,
            onChanged: (_) => setS(() {})),
        if (loc != null && l.itemId != null)
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${fmtQ(b?.available ?? 0, it?['uom'])} available',
                style: TextStyle(fontWeight: FontWeight.w700, color: bad ? const Color(0xFFB91C1C) : const Color(0xFF15803D))),
            if (st == 'out') const Hint('Not in stock', color: Color(0xFFB91C1C)),
            if (st == 'short')
              Hint(
                  'Short by ${fmtQ(need - (b?.available ?? 0))}${need != (parseNum(l.qty.text) ?? 0) ? ' (all lines of this item)' : ''}',
                  color: const Color(0xFFB91C1C)),
            if (b != null && b.reserved > 0) Hint('${fmtQ(b.onHand)} on hand, ${fmtQ(b.reserved)} reserved'),
            if (b != null && b.held > 0) Hint('${fmtQ(b.held)} held in Quality / Blocked', color: cAmber),
          ]),
        if (it?['batch_controlled'] == true && loc != null)
          BatchPicker(
              itemId: l.itemId!,
              locationId: loc!,
              quantity: parseNum(l.qty.text) ?? 0,
              value: l.batch,
              onChanged: (v) => setS(() => l.batch = v))
        else
          AppTextField(label: 'Batch', controller: l.batchText),
        if (it != null && loc != null)
          BinSerialPicker(
            key: ValueKey('bins-$loc-${l.itemId}'),
            locationId: loc!,
            itemId: l.itemId!,
            serialised: it['serial_controlled'] == true,
            quantity: parseNum(l.qty.text) ?? 0,
            binId: l.binId,
            serials: l.serials,
            onChanged: (bin, s) => setS(() {
              l.binId = bin;
              l.serials = s;
            }),
          ),
        AppTextField(label: 'Remarks', controller: l.remarks),
      ],
    );
  }

  final ok = await showFormSheet(
    context,
    title: challan ? 'New Job Work Challan' : 'New Material Issue',
    saveLabel: challan ? 'Create Challan' : 'Issue Material',
    builder: (ctx, setS) {
      final sp = spec();
      final problems = lines.where((l) => ['short', 'out'].contains(lineState(l))).length;
      final selectedProject = projects.where((p) => toInt(p['id']) == toInt(vals['erp_project_id'])).firstOrNull;
      return [
        Hint(challan
            ? 'Material sent to a job-work vendor — it stays ours, in With-vendor stock, until it comes back.'
            : 'Stock leaving the store — pick the issue type; its fields follow.'),
        const FormHeading('Issue Details'),
        LocationSelect(
            value: loc,
            onChanged: (l) {
              setS(() {
                loc = toInt(l?['id']);
                stock = null;
                for (final x in lines) {
                  x.binId = null;
                  x.serials = [];
                  x.batch = '';
                }
              });
              loadStock(setS);
            }),
        if (!challan)
          AppSelect<String>(
            label: 'Issue Type',
            required: true,
            value: issueType,
            options: valueLabelOptions(typeChoices),
            onChanged: (o) => setS(() {
              issueType = o?.value;
              vals.clear();
              textCtl.clear();
              unit = null;
              loadLookups(setS);
            }),
          ),
        if (sp != null) ...[
          for (final f in shownFields()) fieldWidget(f, setS),
          if (sp['order_project'] == true) ...[
            ProjectUnitSelect(
                label: issueType == 'dispatch'
                    ? 'Project unit (the vehicle / lot being dispatched)'
                    : 'Project unit (required for an RRV order)',
                value: unit,
                onChanged: (v) => setS(() => unit = v)),
            const Hint("Filled from the RRV build / work order no. when it has one. The vehicle's project stock is issued first."),
          ],
        ],
        const FormHeading('Remarks'),
        AppTextField(
            label: sp?['remarks_label']?.toString() ?? 'Remarks',
            required: sp?['remarks_label'] != null,
            controller: remarks,
            maxLines: 3),
        if (storeManager)
          AppTextField(
              label: 'Reason for using project stock (Store Manager)',
              controller: override,
              hint: 'Only if stock held for another vehicle must be issued here'),
        if (sp?['leaves_factory'] == true) const Hint('This material leaves the factory, so it travels on a delivery challan.'),
        if (sp?['manager_only'] == true)
          const Hint('A write-off — only a Store Manager or admin can post it.', color: Color(0xFFB45309)),
        if (issueType == 'dispatch')
          Hint(
              'Dispatch checks (Quality rule 8): each finished-goods line needs its batch / serial and an accepted final inspection'
              '${selectedProject?['third_party_inspection_required'] == true ? ', and this order needs an accepted ${'${selectedProject!['inspection_agency'] ?? 'third-party'}'.toUpperCase()} inspection certificate' : ''}.'),
        FormHeading('${challan ? 'Items to send' : 'Items'} (${lines.length})'),
        Hint(loc == null
            ? 'Pick the store to see live available stock on each line.'
            : stockError ??
                (stock == null
                    ? 'Loading stock…'
                    : 'Live stock of this store · updated ${TimeOfDay.fromDateTime(stock!.loadedAt).format(ctx)}')),
        Wrap(spacing: 8, runSpacing: 8, children: [
          if (loc != null) PillButton('Refresh stock', icon: Icons.refresh_rounded, onPressed: () => loadStock(setS)),
          ExcelLineButtons(
            templatePath: '/store/material-issues/import-lines/template',
            templateName: 'material_issue_lines_template.xlsx',
            onImport: () async {
              final res = await importLines(ctx, '/store/material-issues/import-lines');
              if (res == null) return;
              await StoreData.items();
              final imported = [
                for (final x in jsonList(res['lines']))
                  _IssueLine()
                    ..itemId = toInt(x['item_id'])
                    ..qty.text = '${x['quantity']}'
                    ..batchText.text = x['batch_number']?.toString() ?? ''
                    ..batch = x['batch_number']?.toString() ?? ''
                    ..remarks.text = x['remarks']?.toString() ?? '',
              ];
              setS(() {
                lines.removeWhere((l) => l.itemId == null && l.qty.text.isEmpty);
                lines.addAll(imported);
                if (lines.isEmpty) lines.add(_IssueLine());
              });
              if (ctx.mounted) await showImportErrors(ctx, imported.length, jsonList(res['errors']));
            },
          ),
        ]),
        if (problems > 0)
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
                color: cRed.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: cRed.withValues(alpha: 0.2))),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text("$problems line(s) can't be issued in full from this store — remove them, or issue only what is available.",
                  style: const TextStyle(fontSize: 13, color: Color(0xFFB91C1C))),
              Wrap(spacing: 8, children: [
                TextButton(
                    onPressed: () => setS(() {
                          final left = <int, double>{};
                          final out = <_IssueLine>[];
                          for (final l in lines) {
                            final q = parseNum(l.qty.text) ?? 0;
                            if (l.itemId == null || q <= 0) {
                              out.add(l);
                              continue;
                            }
                            left.putIfAbsent(l.itemId!, () => stock?.byItem[l.itemId]?.available ?? 0);
                            final c = q < left[l.itemId]! ? q : left[l.itemId]!;
                            if (c > 0) {
                              l.qty.text = '${num.parse(c.toStringAsFixed(4))}';
                              left[l.itemId!] = left[l.itemId]! - c;
                              out.add(l);
                            }
                          }
                          lines
                            ..clear()
                            ..addAll(out.isEmpty ? [_IssueLine()] : out);
                        }),
                    child: const Text("Issue only what's available")),
                TextButton(
                    onPressed: () => setS(() {
                          final kept = lines.where((l) => !['short', 'out'].contains(lineState(l))).toList();
                          lines
                            ..clear()
                            ..addAll(kept.isEmpty ? [_IssueLine()] : kept);
                        }),
                    child: const Text('Remove short lines', style: TextStyle(color: cRed))),
              ]),
            ]),
          ),
        for (var i = 0; i < lines.length; i++) lineBox(i, setS),
        AddLineButton('Add Item', onPressed: () => setS(() => lines.add(_IssueLine()))),
        if (challan) ...[
          FormHeading('Items to receive back (${back.length})'),
          const Hint(
              'What the vendor sends back — it can be different items (plate sent, flange + ring back). Leave empty if the same items come back (plating, heat treatment).'),
          for (var i = 0; i < back.length; i++)
            LineBox(
              key: ObjectKey(back[i]),
              title: '#${i + 1}',
              onRemove: () => setS(() {
                back.removeAt(i);
                if (back.isEmpty) back.add(_BackLine());
              }),
              children: [
                ItemSelect(required: false, value: back[i].itemId, onChanged: (x) => setS(() => back[i].itemId = toInt(x?['id']))),
                AppTextField(label: 'Expected quantity', controller: back[i].qty, keyboardType: AppTextField.number),
              ],
            ),
          AddLineButton('Add Item', onPressed: () => setS(() => back.add(_BackLine()))),
        ],
      ];
    },
    onSave: () async {
      final sp = spec();
      final problems = <String>[];
      if (loc == null) problems.add('Store is required.');
      if (issueType == null) problems.add('Issue Type is required.');
      bool filled(String k) => vals[k] != null && vals[k] != '';
      final shown = shownFields();
      for (final f in shown) {
        if (_isRequired('${f['rule']}') && !filled('${f['key']}')) problems.add('${f['label']} is required for this issue type.');
      }
      final oneOf = jsonList(sp?['fields']).where((f) => '${f['rule']}'.startsWith('one_of:')).toList();
      if (oneOf.isNotEmpty && !oneOf.any((f) => filled('${f['key']}'))) {
        problems.add('Pick what this issue is against — ${oneOf.map((f) => f['label']).join(' or ')}.');
      }
      if (sp?['remarks_label'] != null && remarks.text.trim().isEmpty) {
        problems.add('Remarks are required — ${'${sp!['remarks_label']}'.toLowerCase()}.');
      }
      final ret = vals['expected_return_date'];
      if (ret is String && ret.isNotEmpty && ret.compareTo(todayIso()) < 0) {
        problems.add('Expected return date cannot be before today (the issue date).');
      }
      final valid = lines.where((l) => l.itemId != null && l.qty.text.trim().isNotEmpty).toList();
      if (valid.isEmpty) problems.add('At least one item is required.');
      for (final l in valid) {
        if ((parseNum(l.qty.text) ?? 0) <= 0) {
          problems.add('${txt(StoreData.itemById[l.itemId]?['item_name'])}: quantity must be greater than zero.');
        }
      }
      final validBack = challan ? back.where((l) => l.itemId != null).toList() : <_BackLine>[];
      for (final l in validBack) {
        if (l.qty.text.trim().isNotEmpty && (parseNum(l.qty.text) ?? 0) <= 0) {
          problems.add(
              'Items to receive back — ${txt(StoreData.itemById[l.itemId]?['item_name'])}: quantity must be greater than zero, or leave it blank.');
        }
      }
      final short = lines.where((l) => ['short', 'out'].contains(lineState(l))).length;
      if (short > 0) {
        problems.add(
            "$short line(s) don't have enough stock in this store — remove them or use \"Issue only what's available\" (the red lines).");
      }
      if (problems.isNotEmpty) throw problems.join('\n');
      final payload = <String, dynamic>{
        'location_id': loc,
        'issue_type': issueType,
        for (final f in shown)
          if (filled('${f['key']}'))
            '${f['key']}': vals['${f['key']}'] is bool
                ? vals['${f['key']}']
                : (_lookupOf.containsKey(f['kind']) || f['kind'] == 'erp_project' || f['kind'] == 'item')
                    ? toInt(vals['${f['key']}'])
                    : '${vals['${f['key']}']}'.trim(),
        'remarks': blankToNull(remarks.text),
        if (validBack.isNotEmpty)
          'output_items': [for (final l in validBack) {'item_id': l.itemId, 'quantity': parseNum(l.qty.text)}],
        if (sp?['order_project'] == true && unit != null) ...{
          'order_project_id': unit!.projectId,
          'order_project_element_id': unit!.elementId,
        },
        if (override.text.trim().isNotEmpty) 'project_stock_override_reason': override.text.trim(),
        'items': [
          for (final l in valid)
            {
              'item_id': l.itemId,
              'quantity': parseNum(l.qty.text),
              'batch_number': StoreData.itemById[l.itemId]?['batch_controlled'] == true && loc != null
                  ? blankToNull(l.batch)
                  : blankToNull(l.batchText.text),
              'remarks': blankToNull(l.remarks.text),
              'bin_id': l.binId,
              if (l.serials.isNotEmpty) 'serials': l.serials,
            },
        ],
      };
      try {
        saved = jsonMap(await Api.post('/store/material-issues', data: payload));
      } catch (_) {
        if (loc != null) {
          try {
            stock = await StockSnapshot.load(loc!);
          } catch (_) {}
        }
        rethrow;
      }
    },
  );
  return ok ? saved : null;
}

// ── Transfers ────────────────────────────────────────────────────────────────

const _trColor = {
  'pending_approval': Color(0xFFF59E0B),
  'approved': cBlue,
  'in_transit': cPurple,
  'received': cGreen,
  'rejected': cRed,
  'cancelled': Color(0xFF78716C),
};
const _trFilters = [
  ('pending_approval', 'Pending approval'),
  ('approved', 'To dispatch'),
  ('in_transit', 'In transit'),
  ('received', 'Received'),
  ('rejected', 'Rejected'),
  ('cancelled', 'Cancelled'),
];

class TransfersTab extends StatefulWidget {
  const TransfersTab({super.key});

  @override
  State<TransfersTab> createState() => _TransfersTabState();
}

class _TransfersTabState extends State<TransfersTab> {
  final _list = GlobalKey<ApiListViewState>();
  List<Json> _all = const [];
  String? _status;

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('transfers', 'create')
            ? CreateFab(
                label: 'New Transfer',
                onPressed: () async {
                  final t = await openTransferForm(context);
                  if (t != null && context.mounted) {
                    _list.currentState?.reload();
                    openScreen(context, TransferDetailScreen(transferId: toInt(t['id'])!));
                  }
                })
            : null,
        body: ApiListView(
          key: _list,
          load: (page, s) async {
            final p = await Api.list('/store/stock-transfers');
            _all = p.rows;
            if (mounted) setState(() {});
            return ApiPage(_status == null ? p.rows : p.rows.where((t) => t['status'] == _status).toList());
          },
          emptyText: _status != null
              ? 'No transfers in this status — pick another status above.'
              : 'No stock transfers yet${can('transfers', 'create') ? ' — use + New Transfer to move stock between stores.' : '.'}',
          header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const StorePageHeader('Stock Transfers',
                subtitle: 'Move stock between stores: approve, dispatch, then the receiving store confirms receipt.'),
            ChipRow([
              CountChip('All', _all.length, selected: _status == null, onTap: () {
                setState(() => _status = null);
                _list.currentState?.reload();
              }),
              for (final (v, l) in _trFilters)
                CountChip(l, _all.where((t) => t['status'] == v).length, color: _trColor[v], selected: _status == v, onTap: () {
                  setState(() => _status = _status == v ? null : v);
                  _list.currentState?.reload();
                }),
            ]),
          ]),
          itemBuilder: (ctx, t, reload) => RecordCard(
            code: txt(t['transfer_number']),
            title: '${txt(t['from_location_name'])} → ${txt(t['to_location_name'])}',
            trailing: pill(txt(t['status_label'] ?? humanize(t['status'])), _trColor[t['status']] ?? cGrey),
            meta: [('Date', fmtDate(t['transfer_date'])), ('Items', '${jsonList(t['items']).length}')],
            onTap: () => openThen(ctx, TransferDetailScreen(transferId: toInt(t['id'])!), reload),
          ),
        ),
      );
}

class _TrLine {
  int? itemId;
  final qty = TextEditingController();
  final batch = TextEditingController();
}

Future<Json?> openTransferForm(BuildContext context) async {
  int? from, to;
  final reason = TextEditingController(), remarks = TextEditingController();
  final lines = <_TrLine>[_TrLine()];
  Json? saved;
  final ok = await showFormSheet(
    context,
    title: 'New Stock Transfer',
    saveLabel: 'Submit for Approval',
    builder: (ctx, setS) => [
      const Hint('Move stock from one store to another — approval, dispatch, then receipt.'),
      const FormHeading('Transfer Details'),
      LocationSelect(label: 'From Store', value: from, onChanged: (l) => setS(() => from = toInt(l?['id']))),
      // Destination may be another plant's store (inter-unit transfer).
      LocationSelect(label: 'To Store', allPlants: true, value: to, onChanged: (l) => setS(() => to = toInt(l?['id']))),
      AppTextField(label: 'Reason', controller: reason),
      AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      const InfoNote(
          "Nothing moves yet: the transfer goes to the sending store's manager for approval, then the sending store dispatches it with the Stock Transfer Note and the receiving store confirms receipt.",
          color: cBlue),
      FormHeading('Items (${lines.length})'),
      for (var i = 0; i < lines.length; i++)
        LineBox(
          key: ObjectKey(lines[i]),
          title: 'Line ${i + 1}',
          onRemove: lines.length == 1 ? null : () => setS(() => lines.removeAt(i)),
          children: [
            ItemSelect(value: lines[i].itemId, onChanged: (x) => setS(() => lines[i].itemId = toInt(x?['id']))),
            AppTextField(label: 'Quantity', required: true, controller: lines[i].qty, keyboardType: AppTextField.number),
            AppTextField(label: 'Batch #', controller: lines[i].batch),
          ],
        ),
      AddLineButton('Add Item', onPressed: () => setS(() => lines.add(_TrLine()))),
    ],
    onSave: () async {
      final problems = <String>[];
      if (from == null) problems.add('Source store is required.');
      if (to == null) problems.add('Destination store is required.');
      if (from != null && from == to) problems.add('Source and destination store must be different.');
      final valid = lines.where((l) => l.itemId != null && l.qty.text.trim().isNotEmpty).toList();
      if (valid.isEmpty) problems.add('At least one item is required.');
      if (valid.any((l) => (parseNum(l.qty.text) ?? 0) <= 0)) problems.add('Every item quantity must be greater than zero.');
      if (problems.isNotEmpty) throw problems.join('\n');
      saved = jsonMap(await Api.post('/store/stock-transfers', data: {
        'from_location_id': from,
        'to_location_id': to,
        'reason': blankToNull(reason.text),
        'remarks': blankToNull(remarks.text),
        'items': [
          for (final l in valid) {'item_id': l.itemId, 'quantity': parseNum(l.qty.text), 'batch_number': blankToNull(l.batch.text)},
        ],
      }));
    },
  );
  return ok ? saved : null;
}

const _trSteps = [('pending_approval', 'Approval'), ('approved', 'Dispatch'), ('in_transit', 'In transit'), ('received', 'Received')];

class TransferDetailScreen extends StatefulWidget {
  const TransferDetailScreen({super.key, required this.transferId});
  final int transferId;

  @override
  State<TransferDetailScreen> createState() => _TransferDetailScreenState();
}

class _TransferDetailScreenState extends State<TransferDetailScreen> {
  int _v = 0;

  Future<void> _dispatch(Json t) async {
    final f = {
      for (final k in ['vehicle_number', 'transporter_name', 'driver_name', 'driver_phone', 'eway_bill_number']) k: TextEditingController()
    };
    final ok = await showFormSheet(
      context,
      title: 'Dispatch ${txt(t['transfer_number'])}',
      saveLabel: 'Dispatch',
      builder: (ctx, setS) => [
        Hint('${txt(t['from_location_name'])} → ${txt(t['to_location_name'])} · stock is in transit until the receiving store confirms.'),
        const FormHeading('Vehicle & E-way Bill'),
        AppTextField(label: 'Vehicle Number', controller: f['vehicle_number'], hint: 'e.g. HR55 AB 1234'),
        AppTextField(label: 'Transporter', controller: f['transporter_name'], hint: 'Own vehicle / transporter name'),
        AppTextField(label: 'Driver Name', controller: f['driver_name']),
        AppTextField(label: 'Driver Phone', controller: f['driver_phone'], keyboardType: TextInputType.phone),
        AppTextField(
            label: 'E-way Bill Number', controller: f['eway_bill_number'], hint: '12 digits — required when the plants are in different states'),
        const Hint(
            'These details are printed on the Stock Transfer Note. Between plants with different GSTINs the note becomes a tax invoice at average cost (GST from the Item Master); within one GSTIN it is a delivery challan.'),
      ],
      onSave: () async {
        await Api.post('/store/stock-transfers/${t['id']}/dispatch', data: {for (final e in f.entries) e.key: blankToNull(e.value.text)});
      },
    );
    if (ok) setState(() => _v++);
  }

  Future<void> _receive(Json t) async {
    final remarks = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Confirm Receipt',
      saveLabel: 'Confirm Receipt',
      builder: (ctx, setS) => [
        Hint('${txt(t['transfer_number'])} · ${jsonList(t['items']).length} line(s) into ${txt(t['to_location_name'])}'),
        Text(
            "All ${jsonList(t['items']).length} line(s) are added to ${txt(t['to_location_name'])}'s stock at the quantities dispatched. If anything arrived short or damaged, receive it and then raise a Stock Adjustment at ${txt(t['to_location_name'])} for the difference."),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3, hint: 'Condition on arrival, gate entry no. …'),
      ],
      onSave: () async {
        await Api.post('/store/stock-transfers/${t['id']}/receive', data: {'remarks': blankToNull(remarks.text)});
      },
    );
    if (ok) setState(() => _v++);
  }

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        key: ValueKey(_v),
        load: () async => jsonMap(await Api.get('/store/stock-transfers/${widget.transferId}')),
        builder: (ctx, t, reload) {
          final status = '${t['status'] ?? ''}';
          final stepIndex = _trSteps.indexWhere((s) => s.$1 == status);
          final closed = status == 'rejected' || status == 'cancelled';
          final noteReady = ['approved', 'in_transit', 'received'].contains(status);
          final items = jsonList(t['items']);
          String inr(Object? n) => fmtMoney(n ?? 0);
          return SubPage(
            title: txt(t['transfer_number']),
            bottom: actionBar([
              if (t['can_cancel'] == true)
                secondaryAction('Cancel Transfer', () async {
                  final ok = await confirmDialog(ctx,
                      title: 'Cancel this transfer?',
                      message:
                          "${txt(t['transfer_number'])} will be closed without moving any stock. This can't be undone — raise a new transfer if it is needed later.",
                      confirmLabel: 'Cancel Transfer',
                      danger: true);
                  if (!ok || !ctx.mounted) return;
                  final done = await runAction(ctx, () => Api.post('/store/stock-transfers/${t['id']}/cancel'));
                  if (done) setState(() => _v++);
                }, color: cRed),
              if (t['can_dispatch'] == true) primaryAction('Dispatch', () => _dispatch(t)),
              if (t['can_receive'] == true) primaryAction('Confirm Receipt', () => _receive(t), color: cGreen),
            ]),
            body: detailList([
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Row(children: [
                  for (var i = 0; i < _trSteps.length; i++) ...[
                    if (i > 0) const SizedBox(width: 4),
                    Expanded(
                      child: () {
                        final done = !closed && (i < stepIndex || status == 'received');
                        final current = !closed && i == stepIndex && status != 'received';
                        return Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(10),
                            color: done
                                ? cGreen.withValues(alpha: 0.1)
                                : current
                                    ? Brand.primary.withValues(alpha: 0.12)
                                    : const Color(0x08000000),
                          ),
                          child: Text('${done ? '✓ ' : '${i + 1}. '}${_trSteps[i].$2}',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w600,
                                  color: done ? cGreen : (current ? Brand.primaryActive : Brand.muted))),
                        );
                      }(),
                    ),
                  ],
                ]),
              ),
              if (closed && t['rejected_reason'] != null)
                Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: InfoNote('Rejected: ${t['rejected_reason']}', color: cRed)),
              SummaryCard(
                title: txt(t['transfer_number']),
                text:
                    'Moves ${items.length} item line${items.length == 1 ? '' : 's'} from ${txt(t['from_location_name'])} to ${txt(t['to_location_name'])}${t['reason'] != null ? ' — ${t['reason']}' : ''}.',
                badges: [pill(txt(t['status_label'] ?? humanize(status)), _trColor[status] ?? cGrey)],
                meta: [fmtDate(t['transfer_date']), if (t['transferred_by_name'] != null) 'Raised by ${t['transferred_by_name']}'],
              ),
              DetailSection('Transfer', children: [
                FieldRow('From Store', t['from_location_name']),
                FieldRow('To Store', t['to_location_name']),
                FieldRow('Reason', t['reason']),
                FieldRow('Approved By',
                    t['approved_by_name'] != null && status != 'rejected' ? '${t['approved_by_name']}, ${fmtDateTime(t['decided_at'])}' : null),
              ]),
              if (t['dispatched_at'] != null || status == 'in_transit' || status == 'received')
                DetailSection('Dispatch', children: [
                  FieldRow('Dispatched', t['dispatched_at'] == null ? null : '${t['dispatched_by_name'] ?? '—'}, ${fmtDateTime(t['dispatched_at'])}'),
                  FieldRow('Vehicle / Transporter', [t['vehicle_number'], t['transporter_name']].where((x) => x != null).join(' · ')),
                  FieldRow('Driver / E-way Bill',
                      [t['driver_name'], t['driver_phone'], if (t['eway_bill_number'] != null) 'EWB ${t['eway_bill_number']}'].where((x) => x != null).join(' · ')),
                ]),
              if (t['document_type'] != null)
                DetailSection('GST', children: [
                  FieldRow(
                      'GST document',
                      t['document_type'] == 'tax_invoice'
                          ? 'Tax invoice ${t['tax_invoice_number'] ?? ''}${t['inter_state'] == true ? ' (inter-state)' : ''}'
                          : 'Delivery challan (same GSTIN)'),
                  FieldRow('GSTIN from → to', '${txt(t['from_gstin'])} → ${txt(t['to_gstin'])}'),
                  if (t['document_type'] == 'tax_invoice')
                    FieldRow(
                        'Taxable / GST',
                        '${inr(t['taxable_value'])} + ${t['inter_state'] == true ? 'IGST ${inr(t['igst_amount'])}' : 'CGST ${inr(t['cgst_amount'])} + SGST ${inr(t['sgst_amount'])}'}'),
                ]),
              if (t['received_at'] != null)
                DetailSection('Receipt', children: [
                  FieldRow('Received', '${t['received_by_name'] ?? '—'}, ${fmtDateTime(t['received_at'])}'),
                  FieldRow('Receipt Remarks', t['receipt_remarks']),
                ]),
              DetailSection('Remarks', children: [FieldRow('Remarks', t['remarks'])]),
              if (status == 'pending_approval' || (closed && status != 'cancelled'))
                ApprovalPanel(entityType: 'stock_transfer', entityId: toInt(t['id'])!, onChanged: () => setState(() => _v++)),
              DetailSection('Items (${items.length})', children: [
                for (final l in items)
                  LineTile(
                    title: '${txt(l['item_code'])} — ${txt(l['item_name'])}',
                    trailing: fmtQ(l['quantity'], l['uom']),
                    facts: [
                      MiniFact('Batch', txt(l['batch_number'])),
                      if (l['from_bin_code'] != null) MiniFact('From bin', txt(l['from_bin_code'])),
                      if (l['to_bin_code'] != null) MiniFact('To bin', txt(l['to_bin_code'])),
                      if (l['serial_numbers'] is List && (l['serial_numbers'] as List).isNotEmpty)
                        MiniFact('Serial no.', (l['serial_numbers'] as List).join(', ')),
                      if (l['remarks'] != null) MiniFact('Remarks', txt(l['remarks'])),
                    ],
                  ),
              ]),
              DetailSection('Stock Transfer Note', children: [
                Hint(noteReady
                    ? 'Print it and send it with the material; the receiving store signs it on arrival. It refreshes after dispatch (vehicle details) and after receipt.'
                    : 'Available once the transfer is approved.'),
                if (noteReady) ...[
                  const SizedBox(height: 8),
                  ManagedDocButtons(
                    entityType: 'store_stock_transfer_note',
                    entityId: toInt(t['id'])!,
                    canModify: can('transfers', 'edit'),
                    downloadName: 'Stock-Transfer-Note-${t['transfer_number']}',
                    extra: [
                      PillButton('Print / Download PDF',
                          icon: Icons.picture_as_pdf_outlined,
                          onPressed: () => openApiFile(ctx, '/store/stock-transfers/${t['id']}/transfer-note.pdf',
                              'Stock-Transfer-Note-${t['transfer_number']}.pdf')),
                    ],
                  ),
                ],
              ]),
            ]),
          );
        },
      );
}

// ── Reservations ─────────────────────────────────────────────────────────────

const _resLabel = {'active': 'Active', 'fulfilled': 'Fulfilled', 'cancelled': 'Cancelled'};
const _resColor = {'active': cBlue, 'fulfilled': cGreen, 'cancelled': cGrey};

class ReservationsTab extends StatefulWidget {
  const ReservationsTab({super.key});

  @override
  State<ReservationsTab> createState() => _ReservationsTabState();
}

class _ReservationsTabState extends State<ReservationsTab> {
  final _list = GlobalKey<ApiListViewState>();
  String _view = 'all';
  ProjectUnit? _filter;

  Future<void> _act(Json r, String type) async {
    final cancel = type == 'cancel';
    final ok = await confirmDialog(context,
        title: cancel ? 'Cancel this reservation?' : 'Mark this reservation as fulfilled?',
        message: cancel
            ? 'This releases the reserved quantity back to available stock.'
            : 'This releases the earmark, assuming the material has already been issued separately via a Material Issue. It does not itself reduce stock.',
        confirmLabel: cancel ? 'Cancel Reservation' : 'Mark Fulfilled',
        danger: cancel);
    if (!ok || !mounted) return;
    final done = await runAction(context, () => Api.post('/store/stock-reservations/${r['id']}/$type'));
    if (done) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('reservations', 'create')
            ? CreateFab(
                label: 'New Reservation',
                onPressed: () async {
                  final ok = await openReservationForm(context);
                  if (ok) _list.currentState?.reload();
                })
            : null,
        body: ApiListView(
          key: _list,
          load: (page, s) => Api.list('/store/stock-reservations', query: {
            if (_filter != null) 'order_project_id': _filter!.projectId,
            if (_filter?.elementId != null) 'order_project_element_id': _filter!.elementId,
            if (_filter == null && _view == 'project') 'project_stock': true,
          }),
          emptyText: _view == 'project'
              ? 'No project stock reservations match this filter.'
              : 'No stock reservations yet — use + New Reservation to earmark stock for a project or production order.',
          header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const StorePageHeader('Stock Reservations'),
            ChipRow([
              for (final (k, l) in [('all', 'All reservations'), ('project', 'Project stock')])
                CountChip(l, null, selected: _view == k, onTap: () {
                  setState(() {
                    _view = k;
                    if (k == 'all') _filter = null;
                  });
                  _list.currentState?.reload();
                }),
            ]),
            if (_view == 'project')
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: ProjectUnitSelect(
                  label: 'Every project — or pick one / a unit',
                  requireElement: false,
                  value: _filter,
                  onChanged: (v) {
                    setState(() => _filter = v);
                    _list.currentState?.reload();
                  },
                ),
              ),
          ]),
          itemBuilder: (ctx, r, reload) => RecordCard(
            code: txt(r['reservation_number']),
            title: '${txt(r['item_code'])} — ${txt(r['item_name'])}',
            subtitle: txt(r['location_name']),
            trailing: pill(_resLabel[r['status']] ?? humanize(r['status']), _resColor[r['status']] ?? cGrey),
            meta: [
              ('Quantity', fmtQ(r['quantity'], r['uom'])),
              (
                'Project / PO',
                r['op_number'] != null
                    ? '${r['op_number']}${r['element_no'] != null ? ' · ${r['element_no']}' : ''}${r['source_reference'] != null ? ' (held from ${r['source_reference']})' : ''}'
                    : ([r['project'], r['production_order']].where((x) => x != null && '$x'.isNotEmpty).join(' / ').isEmpty
                        ? '—'
                        : [r['project'], r['production_order']].where((x) => x != null && '$x'.isNotEmpty).join(' / '))
              ),
              ('Required Date', fmtDate(r['required_date'])),
            ],
            onTap: r['status'] == 'active' && can('reservations', 'edit')
                ? () => showModalBottomSheet<void>(
                      context: ctx,
                      builder: (sheet) => SafeArea(
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          ListTile(
                            leading: const Icon(Icons.check_circle_outline_rounded, color: cGreen),
                            title: const Text('Fulfill'),
                            onTap: () {
                              Navigator.pop(sheet);
                              _act(r, 'fulfill');
                            },
                          ),
                          ListTile(
                            leading: const Icon(Icons.cancel_outlined, color: cRed),
                            title: const Text('Cancel'),
                            onTap: () {
                              Navigator.pop(sheet);
                              _act(r, 'cancel');
                            },
                          ),
                        ]),
                      ),
                    )
                : null,
          ),
        ),
      );
}

class _ResLine {
  int? itemId;
  final qty = TextEditingController();
  final remarks = TextEditingController();
}

Future<bool> openReservationForm(BuildContext context) async {
  await StoreData.items().catchError((_) => <Json>[]);
  if (!context.mounted) return false;
  int? loc;
  StockSnapshot? stock;
  String? stockError;
  final lines = <_ResLine>[_ResLine()];
  ProjectUnit? unit;
  final project = TextEditingController(), po = TextEditingController(), remarks = TextEditingController();
  DateTime? required;
  void loadStock(StateSetter setS) {
    if (loc == null) return;
    StockSnapshot.load(loc!).then((s) => setS(() {
          stock = s;
          stockError = null;
        }), onError: (Object e) => setS(() => stockError = "Could not load the store's stock. Tap Refresh stock to try again."));
  }

  Map<int, double> demand() {
    final m = <int, double>{};
    for (final l in lines) {
      final q = parseNum(l.qty.text) ?? 0;
      if (l.itemId != null && q > 0) m[l.itemId!] = (m[l.itemId!] ?? 0) + q;
    }
    return m;
  }

  bool short(_ResLine l) =>
      loc != null && stock != null && l.itemId != null && (parseNum(l.qty.text) ?? 0) > 0 &&
      (demand()[l.itemId] ?? 0) > (stock!.byItem[l.itemId]?.available ?? 0);

  return showFormSheet(
    context,
    title: 'New Reservation',
    saveLabel: 'Reserve Stock',
    builder: (ctx, setS) => [
      const Hint('Earmark on-hand stock for a project or production order — it stops being available to others.'),
      const FormHeading('Reserve From'),
      LocationSelect(
          value: loc,
          onChanged: (l) {
            setS(() {
              loc = toInt(l?['id']);
              stock = null;
            });
            loadStock(setS);
          }),
      const Hint('Every line is held in this store.'),
      FormHeading('Items to Reserve (${lines.length})'),
      Hint(loc == null
          ? 'Pick the store to see live available stock on each line.'
          : stockError ??
              (stock == null ? 'Loading stock…' : 'Live stock · updated ${TimeOfDay.fromDateTime(stock!.loadedAt).format(ctx)}')),
      Wrap(spacing: 8, runSpacing: 8, children: [
        if (loc != null) PillButton('Refresh stock', icon: Icons.refresh_rounded, onPressed: () => loadStock(setS)),
        ExcelLineButtons(
          templatePath: '/store/stock-reservations/import-lines/template',
          templateName: 'stock_reservation_lines_template.xlsx',
          onImport: () async {
            final res = await importLines(ctx, '/store/stock-reservations/import-lines');
            if (res == null) return;
            final imported = [
              for (final x in jsonList(res['lines']))
                _ResLine()
                  ..itemId = toInt(x['item_id'])
                  ..qty.text = '${x['quantity']}'
                  ..remarks.text = x['remarks']?.toString() ?? '',
            ];
            setS(() {
              lines.removeWhere((l) => l.itemId == null && l.qty.text.isEmpty && l.remarks.text.isEmpty);
              lines.addAll(imported);
              if (lines.isEmpty) lines.add(_ResLine());
            });
            if (ctx.mounted) await showImportErrors(ctx, imported.length, jsonList(res['errors']));
          },
        ),
      ]),
      for (var i = 0; i < lines.length; i++)
        () {
          final l = lines[i];
          final it = l.itemId == null ? null : StoreData.itemById[l.itemId];
          final b = l.itemId == null ? null : stock?.byItem[l.itemId];
          final s = short(l);
          return LineBox(
            key: ObjectKey(l),
            title: '#${i + 1}',
            danger: s,
            onRemove: () => setS(() {
              lines.remove(l);
              if (lines.isEmpty) lines.add(_ResLine());
            }),
            children: [
              ItemSelect(value: l.itemId, onChanged: (x) => setS(() => l.itemId = toInt(x?['id']))),
              AppTextField(
                  label: 'Quantity${it?['uom'] != null ? ' (${it!['uom']})' : ''}',
                  required: true,
                  controller: l.qty,
                  keyboardType: AppTextField.number,
                  onChanged: (_) => setS(() {})),
              if (loc != null && l.itemId != null && stock != null)
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${fmtQ(b?.available ?? 0, it?['uom'])} available',
                      style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: s || (b?.available ?? 0) <= 0 ? const Color(0xFFB91C1C) : const Color(0xFF15803D))),
                  if (b != null && b.reserved > 0) Hint('${fmtQ(b.onHand)} on hand, ${fmtQ(b.reserved)} already reserved'),
                ]),
              AppTextField(label: 'Remarks', controller: l.remarks),
            ],
          );
        }(),
      AddLineButton('Add Item', onPressed: () => setS(() => lines.add(_ResLine()))),
      const FormHeading('Reserved For'),
      ProjectUnitSelect(value: unit, onChanged: (v) => setS(() => unit = v)),
      const Hint('Project stock can only be issued to this vehicle / lot — anyone else needs a Store Manager override with a reason.'),
      AppTextField(label: 'Project (note)', controller: project),
      AppTextField(label: 'Production Order', controller: po),
      DateField(label: 'Required Date', value: required, onChanged: (d) => setS(() => required = d)),
      AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      const Hint('Used for every line that has no remarks of its own.'),
    ],
    onSave: () async {
      final problems = <String>[];
      final filled = lines.where((l) => l.itemId != null || l.qty.text.trim().isNotEmpty || l.remarks.text.trim().isNotEmpty).toList();
      if (loc == null) problems.add('Store is required — pick the store the stock is held in.');
      if (filled.isEmpty) problems.add('Add at least one item line.');
      for (var i = 0; i < filled.length; i++) {
        final l = filled[i];
        final code = txt(StoreData.itemById[l.itemId]?['item_code']);
        if (l.itemId == null) {
          problems.add('Line ${i + 1}: pick the item.');
        } else if ((parseNum(l.qty.text) ?? 0) <= 0) {
          problems.add('Line ${i + 1} ($code): quantity must be greater than zero.');
        } else if (short(l)) {
          problems.add(
              'Line ${i + 1} ($code): only ${fmtQ(stock!.byItem[l.itemId]?.available ?? 0)} available in this store — lower the quantity or remove the line.');
        }
      }
      if (problems.isNotEmpty) throw problems.join('\n');
      await Api.post('/store/stock-reservations/bulk', data: {
        'location_id': loc,
        'lines': [
          for (final l in filled) {'item_id': l.itemId, 'quantity': parseNum(l.qty.text), 'remarks': blankToNull(l.remarks.text)},
        ],
        'project': blankToNull(project.text),
        'production_order': blankToNull(po.text),
        'order_project_id': unit?.projectId,
        'order_project_element_id': unit?.elementId,
        'required_date': required == null ? null : apiDate(required!),
        'remarks': blankToNull(remarks.text),
      });
    },
  );
}
