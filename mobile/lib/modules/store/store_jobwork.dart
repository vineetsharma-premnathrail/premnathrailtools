import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'store_common.dart';
import 'store_outward.dart';
import 'store_widgets.dart';

// Job Work (portal: store/job-work, job-work/new): challans, stock with
// vendors, job work receipts, ITC-04, Receive processed items, Return as-is.

const _jwLabel = {'open': 'At vendor', 'due_back': 'Past expected return', 'overdue': 'Rule 45 limit passed', 'closed': 'Closed'};
const _jwColor = {'open': cBlue, 'due_back': cAmber, 'overdue': cRed, 'closed': cGreen};

double _left(Json l) => numOr0(l['quantity_outstanding']) - numOr0(l['quantity_return_pending']);

class JobWorkTab extends StatefulWidget {
  const JobWorkTab({super.key});

  @override
  State<JobWorkTab> createState() => _JobWorkTabState();
}

class _JobWorkTabState extends State<JobWorkTab> {
  String _tab = 'challans';
  bool _showAll = false;
  List<Json> _challans = const [];
  List<Json> _vendorStock = const [];
  List<Json> _receipts = const [];
  bool _loading = true;
  Object? _error;

  bool get _seeReceipts => canFeature('issues', 'job_work_receipts', 'view');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await Future.wait([
        Api.list('/store/job-work/challans', query: {'status': _showAll ? 'all' : 'open'}),
        Api.list('/store/job-work/vendor-stock'),
        if (_seeReceipts) Api.list('/store/job-work/receipts'),
      ]);
      if (!mounted) return;
      setState(() {
        _challans = r[0].rows;
        _vendorStock = r[1].rows;
        _receipts = _seeReceipts ? r[2].rows : const [];
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  List<Json> _outs(Json r) => jsonList(r['outputs']).isNotEmpty
      ? jsonList(r['outputs'])
      : [
          {
            'item_name': r['output_item_name'],
            'uom': r['uom'],
            'quantity': r['output_quantity'],
            'batch_number': r['output_batch_number'],
            'job_charge_rate': r['job_charge_rate'],
            'unit_cost': r['output_unit_cost'],
            'inspection_lot_number': r['inspection_lot_number'],
          }
        ];

  @override
  Widget build(BuildContext context) {
    if (!canFeature('issues', 'job_work', 'view')) {
      return const EmptyView(
          "You don't have View on Store › Issues › Job work (subcontracting). Ask your admin to add it to your role in Organization › Roles & Permissions.");
    }
    final seeVal = seeValues;
    final overdue = _challans.where((c) => c['status'] == 'overdue').length;
    final atVendor = _vendorStock.fold<double>(0, (a, s) => a + numOr0(s['value']));
    final body = <Widget>[];
    if (_loading) {
      body.add(const LoadingView());
    } else if (_error != null) {
      body.add(ErrorView(_error!, onRetry: _load));
    } else if (_tab == 'challans') {
      body.add(Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: CheckField(
            label: 'Show closed challans too',
            value: _showAll,
            onChanged: (v) {
              setState(() => _showAll = v);
              _load();
            }),
      ));
      if (_challans.isEmpty) {
        body.add(EmptyView(_showAll
            ? 'No job-work challans yet — use + New Challan to send material to a job worker.'
            : 'No job-work material is out at vendors — tick “Show closed challans too” to see past ones.'));
      }
      for (final c in _challans) {
        final open = c['status'] != 'closed';
        body.add(RecordCard(
          code: '${txt(c['challan_number'])} · ${txt(c['issue_number'])}',
          title: txt(c['vendor_name']),
          subtitle: [fmtDate(c['challan_date']), if (c['process'] != null) humanize(c['process'])].join(' · '),
          trailing: pill(_jwLabel[c['status']] ?? humanize(c['status']), _jwColor[c['status']] ?? cGrey),
          meta: [
            for (final l in jsonList(c['lines']))
              (
                '${txt(l['item_name'])}${l['batch_number'] != null ? ' · ${l['batch_number']}' : ''} (sent / back / used / at vendor)',
                '${fmtQ(l['quantity_sent'])} / ${fmtQ(l['quantity_returned'])} / ${fmtQ(numOr0(l['quantity_consumed']) + numOr0(l['quantity_scrap']))} / ${fmtQ(l['quantity_outstanding'], l['uom'])}'
                    '${numOr0(l['quantity_return_pending']) > 0 ? ' (${fmtQ(l['quantity_return_pending'])} return awaiting approval)' : ''}'
              ),
            if (seeVal) ('Value at vendor', fmtMoney(c['outstanding_value'])),
            ('Days out', fmtQ(c['days_out'])),
            ('Return by (Rule 45)', fmtDate(c['return_deadline'])),
          ],
          onTap: () => _challanActions(c, open),
        ));
      }
    } else if (_tab == 'vendor') {
      if (_vendorStock.isEmpty) body.add(const EmptyView('No stock is with vendors — material shows here once a job-work challan is issued.'));
      for (final s in _vendorStock) {
        body.add(RecordCard(
          title: txt(s['vendor_name']),
          subtitle: '${txt(s['item_code'])} — ${txt(s['item_name'])}',
          trailing: Text(fmtQ(s['quantity'], s['uom']), style: const TextStyle(fontWeight: FontWeight.w700, color: cPurple)),
          meta: [
            if (seeVal) ('Value', fmtMoney(s['value'])),
            ('Challans', s['challans'] is List && (s['challans'] as List).isNotEmpty ? (s['challans'] as List).join(', ') : '—'),
            ('Oldest challan', '${fmtDate(s['oldest_challan_date'])}${s['overdue'] == true ? ' · Rule 45 limit passed' : ''}'),
          ],
        ));
      }
    } else if (_tab == 'receipts') {
      if (_receipts.isEmpty) body.add(const EmptyView('No job work receipts yet — use “Receive processed items” on an open challan.'));
      for (final r in _receipts) {
        final outs = _outs(r);
        body.add(RecordCard(
          code: txt(r['receipt_number']),
          title: txt(r['vendor_name']),
          subtitle: [
            fmtDate(r['receipt_date']),
            'Challan ${r['challan_number'] ?? r['issue_number'] ?? '—'}',
            if (r['vendor_challan_number'] != null) 'Vendor DC ${r['vendor_challan_number']}',
          ].join(' · '),
          meta: [
            for (final o in outs)
              (
                '${fmtQ(o['quantity'], o['uom'])} ${txt(o['item_name'])}',
                [
                  'Batch ${txt(o['batch_number'])}',
                  'Job charge ${o['job_charge_rate'] != null ? '${fmtMoney(o['job_charge_rate'])} / ${o['uom'] ?? 'unit'}' : '—'}',
                  if (seeVal) 'Unit cost ${fmtMoney(o['unit_cost'])}',
                  'Inspection ${txt(o['inspection_lot_number'])}',
                ].join(' · ')
              ),
            if (seeVal) ('Component value', fmtMoney(r['component_value'])),
          ],
        ));
      }
    } else {
      body.add(_Itc04(canExport: canFeature('issues', 'job_work', 'export')));
    }
    return Scaffold(
      floatingActionButton: canFeature('issues', 'job_work', 'create')
          ? CreateFab(
              label: 'New Challan',
              onPressed: () async {
                final i = await openIssueForm(context, challan: true);
                if (i != null && context.mounted) {
                  _load();
                  openScreen(context, IssueDetailScreen(issueId: toInt(i['id'])!));
                }
              })
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
          const StorePageHeader('Job Work',
              subtitle:
                  'Material sent to job workers on a challan stays ours and valued (stock with vendor) until it comes back or is used in the processed item. GST Rule 45: it must be back within 1 year (inputs) / 3 years (capital goods).'),
          KpiGrid([
            KpiTile('Open challans', fmtQ(_challans.where((c) => c['status'] != 'closed').length),
                onTap: () => setState(() => _tab = 'challans')),
            if (seeVal) KpiTile('Value at vendors', fmtMoney(atVendor), onTap: () => setState(() => _tab = 'vendor')),
            KpiTile('Past Rule 45 limit', fmtQ(overdue), color: overdue > 0 ? cRed : Brand.heading),
          ]),
          ChipRow([
            for (final (k, l) in [
              ('challans', 'Challans'),
              ('vendor', 'Stock with Vendors'),
              if (_seeReceipts) ('receipts', 'Job Work Receipts'),
              ('itc04', 'ITC-04'),
            ])
              CountChip(l, null, selected: _tab == k, onTap: () => setState(() => _tab = k)),
          ]),
          ...body,
        ]),
      ),
    );
  }

  void _challanActions(Json c, bool open) {
    final canReceive = canFeature('issues', 'job_work_receipts', 'create');
    final canReturn = can('returns', 'create');
    showModalBottomSheet<void>(
      context: context,
      builder: (sheet) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: const Icon(Icons.description_outlined),
            title: const Text('Open challan (issue)'),
            onTap: () {
              Navigator.pop(sheet);
              openScreen(context, IssueDetailScreen(issueId: toInt(c['issue_id'])!));
            },
          ),
          if (open && canReceive)
            ListTile(
              leading: const Icon(Icons.inventory_2_outlined, color: Brand.primaryActive),
              title: const Text('Receive processed items'),
              onTap: () async {
                Navigator.pop(sheet);
                final r = await _receive(c);
                if (r != null && mounted) {
                  await messageDialog(
                      context,
                      'Job Work Receipt Posted',
                      '${txt(r['receipt_number'])}: ${_outs(r).map((o) => '${fmtQ(o['quantity'], o['uom'])} ${txt(o['item_name'])} received'
                          '${o['inspection_lot_number'] != null ? ' into Quality stock under lot ${o['inspection_lot_number']}' : ''}'
                          '${o['unit_cost'] != null ? ' at ${fmtMoney(o['unit_cost'])} each' : ''}').join('; ')}.');
                  _load();
                }
              },
            ),
          if (open && canReturn)
            ListTile(
              leading: const Icon(Icons.undo_rounded, color: cBlue),
              title: const Text('Return as-is'),
              onTap: () async {
                Navigator.pop(sheet);
                final msg = await _returnAsIs(c);
                if (msg != null && mounted) {
                  await messageDialog(context, 'Return Recorded', msg);
                  _load();
                }
              },
            ),
        ]),
      ),
    );
  }

  Future<Json?> _receive(Json c) async {
    final open = jsonList(c['lines']).where((l) => _left(l) > 0).toList();
    final expected = jsonList(c['output_items']).isNotEmpty
        ? jsonList(c['output_items'])
        : (c['output_item_id'] != null ? [<String, dynamic>{'item_id': c['output_item_id'], 'quantity': null}] : <Json>[]);
    List<Json> poLines = const [];
    if (c['vendor_id'] != null) {
      try {
        poLines = (await Api.list('/store/job-work/po-lines', query: {'vendor_id': c['vendor_id']})).rows;
      } catch (_) {}
    }
    await StoreData.items().catchError((_) => <Json>[]);
    if (!mounted) return null;
    final outs = <_Out>[
      for (final e in expected)
        _Out()
          ..itemId = toInt(e['item_id'])
          ..qty.text = e['quantity'] != null
              ? '${e['quantity']}'
              : (expected.length == 1 && open.length == 1 ? '${num.parse(_left(open.first).toStringAsFixed(4))}' : ''),
    ];
    if (outs.isEmpty) outs.add(_Out());
    DateTime date = DateTime.now();
    final vendorDc = TextEditingController(), remarks = TextEditingController();
    final use = {
      for (final l in open)
        toInt(l['issue_item_id'])!: (
          TextEditingController(text: '${num.parse(_left(l).toStringAsFixed(4))}'),
          TextEditingController(),
        )
    };
    Json? saved;
    final ok = await showFormSheet(
      context,
      title: 'Receive processed items',
      saveLabel: 'Post receipt',
      builder: (ctx, setS) {
        final filled = outs.where((o) => o.itemId != null || o.qty.text.trim().isNotEmpty).toList();
        final shareTotal = filled.fold<num>(0, (a, o) => a + (parseNum(o.share.text) ?? 0));
        return [
          Hint(
              'Challan ${c['challan_number'] ?? c['issue_number']} · ${txt(c['vendor_name'])} — material used leaves stock with the vendor; each processed item comes in at its share of the material value + its job charge.'),
          FormHeading('Processed Items (${outs.length})'),
          ExcelLineButtons(
            templatePath: '/store/job-work/receipts/import-outputs/template',
            templateName: 'job_work_receipt_items_template.xlsx',
            onImport: () async {
              final res = await importLines(ctx, '/store/job-work/receipts/import-outputs');
              if (res == null) return;
              await StoreData.items();
              final imported = [
                for (final x in jsonList(res['lines']))
                  _Out()
                    ..itemId = toInt(x['item_id'])
                    ..qty.text = '${x['quantity']}'
                    ..rate.text = x['job_charge_rate'] == null ? '' : '${x['job_charge_rate']}'
                    ..share.text = x['cost_share_pct'] == null ? '' : '${x['cost_share_pct']}',
              ];
              setS(() {
                outs.removeWhere((o) => o.itemId == null && o.qty.text.isEmpty);
                outs.addAll(imported);
                if (outs.isEmpty) outs.add(_Out());
              });
              if (ctx.mounted) await showImportErrors(ctx, imported.length, jsonList(res['errors']));
            },
          ),
          Hint('One line per different item that came back.${outs.length > 1 ? ' Cost share % = part of the sent material’s value each item carries; leave all blank to split by standard cost × quantity.' : ''}'),
          for (var i = 0; i < outs.length; i++)
            LineBox(
              key: ObjectKey(outs[i]),
              title: '#${i + 1}',
              onRemove: () => setS(() {
                outs.removeAt(i);
                if (outs.isEmpty) outs.add(_Out());
              }),
              children: [
                ItemSelect(label: 'Processed item', value: outs[i].itemId, onChanged: (x) => setS(() => outs[i].itemId = toInt(x?['id']))),
                AppTextField(label: 'Qty received', required: true, controller: outs[i].qty, keyboardType: AppTextField.number),
                AppSelect<int>(
                  label: poLines.isEmpty ? 'No issued PO with this vendor' : 'Job charge from PO line',
                  enabled: poLines.isNotEmpty,
                  value: outs[i].poLine,
                  options: idLabelOptions(poLines),
                  onChanged: (o) => setS(() {
                    outs[i].poLine = o?.value;
                    for (final p in poLines) {
                      if (toInt(p['id']) == o?.value && p['unit_price'] != null) outs[i].rate.text = '${p['unit_price']}';
                    }
                  }),
                ),
                AppTextField(label: 'Job charge / unit (₹)', controller: outs[i].rate, keyboardType: AppTextField.number),
                if (outs.length > 1)
                  AppTextField(
                      label: 'Cost share %',
                      controller: outs[i].share,
                      keyboardType: AppTextField.number,
                      hint: 'Auto',
                      onChanged: (_) => setS(() {})),
              ],
            ),
          AddLineButton('Add Item', onPressed: () => setS(() => outs.add(_Out()))),
          if (outs.length > 1 && filled.any((o) => o.share.text.trim().isNotEmpty))
            Hint('Cost share total: ${fmtQ(shareTotal)}%', color: (shareTotal - 100).abs() > 0.01 ? cRed : cGreen),
          FormHeading('Challan Material Used (${open.length})'),
          for (final l in open)
            LineBox(
              key: ObjectKey(l),
              title: '${txt(l['item_name'])}${l['batch_number'] != null ? ' · ${l['batch_number']}' : ''}',
              children: [
                MiniFact('At vendor', fmtQ(_left(l), l['uom'])),
                AppTextField(label: 'Used in items', controller: use[toInt(l['issue_item_id'])]!.$1, keyboardType: AppTextField.number),
                AppTextField(label: 'Process scrap', controller: use[toInt(l['issue_item_id'])]!.$2, keyboardType: AppTextField.number),
              ],
            ),
          const FormHeading('Receipt Details'),
          DateField(label: 'Receipt date', required: true, value: date, onChanged: (d) => setS(() => date = d ?? date)),
          AppTextField(label: "Vendor's DC / invoice", controller: vendorDc),
          AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
        ];
      },
      onSave: () async {
        final filled = outs.where((o) => o.itemId != null || o.qty.text.trim().isNotEmpty).toList();
        final problems = <String>[];
        if (filled.isEmpty) problems.add('Add the processed item(s) that came back (Item Master).');
        for (var i = 0; i < filled.length; i++) {
          final o = filled[i];
          final name = o.itemId == null ? 'Line ${i + 1}' : txt(StoreData.itemById[o.itemId]?['item_name']);
          if (o.itemId == null) problems.add('Line ${i + 1}: pick the processed item.');
          if ((parseNum(o.qty.text) ?? 0) <= 0) problems.add('$name: enter how many came back.');
        }
        final withShare = filled.where((o) => o.share.text.trim().isNotEmpty).length;
        final shareTotal = filled.fold<num>(0, (a, o) => a + (parseNum(o.share.text) ?? 0));
        if (filled.length > 1 && withShare > 0 && withShare != filled.length) {
          problems.add('Cost share % is filled on some items and blank on others — fill every line (total 100) or leave all blank.');
        }
        if (filled.length > 1 && withShare == filled.length && (shareTotal - 100).abs() > 0.01) {
          problems.add('Cost shares add up to ${fmtQ(shareTotal)}% — they must total 100%.');
        }
        if (problems.isNotEmpty) throw problems.join('\n');
        saved = jsonMap(await Api.post('/store/job-work/receipts', data: {
          'issue_id': c['issue_id'],
          'receipt_date': apiDate(date),
          'vendor_challan_number': blankToNull(vendorDc.text),
          'remarks': blankToNull(remarks.text),
          'outputs': [
            for (final o in filled)
              {
                'item_id': o.itemId,
                'quantity': parseNum(o.qty.text),
                'purchase_order_item_id': o.poLine,
                'job_charge_rate': parseNum(o.rate.text),
                'cost_share_pct': filled.length > 1 ? parseNum(o.share.text) : null,
              }
          ],
          'components': [
            for (final l in open)
              {
                'issue_item_id': l['issue_item_id'],
                'consumed_quantity': parseNum(use[toInt(l['issue_item_id'])]!.$1.text) ?? 0,
                'scrap_quantity': parseNum(use[toInt(l['issue_item_id'])]!.$2.text) ?? 0,
              }
          ],
        }));
      },
    );
    return ok ? saved : null;
  }

  Future<String?> _returnAsIs(Json c) async {
    final open = jsonList(c['lines']).where((l) => _left(l) > 0).toList();
    List<Json> conditions = const [];
    try {
      conditions = await docTypes('return_condition');
    } catch (_) {}
    if (!mounted) return null;
    final qty = {for (final l in open) toInt(l['issue_item_id'])!: TextEditingController()};
    final cond = <int, String?>{for (final l in open) toInt(l['issue_item_id'])!: conditions.isEmpty ? null : '${conditions.first['value']}'};
    final reason = TextEditingController(), remarks = TextEditingController();
    String? message;
    final ok = await showFormSheet(
      context,
      title: 'Return as-is',
      saveLabel: 'Record return',
      builder: (ctx, setS) => [
        Hint(
            'Challan ${c['challan_number'] ?? c['issue_number']} · ${txt(c['vendor_name'])}${c['location_name'] != null ? ' · back into ${c['location_name']}' : ''} — unprocessed material, same item at the same value, no job charge.'),
        FormHeading('Material Back (${open.length})'),
        for (final l in open)
          LineBox(
            key: ObjectKey(l),
            title: '${txt(l['item_name'])}${l['batch_number'] != null ? ' · Batch ${l['batch_number']}' : ''}',
            children: [
              MiniFact('With vendor', fmtQ(_left(l), l['uom'])),
              AppTextField(label: 'Qty back', controller: qty[toInt(l['issue_item_id'])], keyboardType: AppTextField.number, hint: '0'),
              AppSelect<String>(
                label: 'Condition',
                clearable: false,
                value: cond[toInt(l['issue_item_id'])],
                options: valueLabelOptions(conditions),
                onChanged: (o) => setS(() => cond[toInt(l['issue_item_id'])!] = o?.value),
              ),
            ],
          ),
        const FormHeading('Reason'),
        AppTextField(
            label: 'Reason', required: true, controller: reason, hint: 'Vendor could not do it / extra quantity sent / order changed…'),
        AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      ],
      onSave: () async {
        final lines = open.where((l) => (parseNum(qty[toInt(l['issue_item_id'])]!.text) ?? 0) > 0).toList();
        final problems = <String>[];
        if (lines.isEmpty) problems.add('Enter the quantity that came back on at least one line.');
        for (final l in lines) {
          if ((parseNum(qty[toInt(l['issue_item_id'])]!.text) ?? 0) > _left(l)) {
            problems.add('${txt(l['item_name'])}: only ${fmtQ(_left(l), l['uom'])} is still with the vendor.');
          }
        }
        if (reason.text.trim().isEmpty) {
          problems.add('Say why it came back unprocessed (e.g. vendor could not do it, extra sent, order changed).');
        }
        final loc = open.isEmpty ? null : open.first['location_id'];
        if (loc == null) problems.add('The store this challan was issued from is not known — use Store › Returns instead.');
        if (problems.isNotEmpty) throw problems.join('\n');
        final r = jsonMap(await Api.post('/store/material-returns', data: {
          'location_id': loc,
          'source_type': 'issue',
          'source_issue_id': c['issue_id'],
          'reason': reason.text.trim(),
          'remarks': blankToNull(remarks.text),
          'items': [
            for (final l in lines)
              {
                'item_id': l['item_id'],
                'quantity': parseNum(qty[toInt(l['issue_item_id'])]!.text),
                'condition': cond[toInt(l['issue_item_id'])] ?? 'good',
                'batch_number': l['batch_number'],
              }
          ],
        }));
        final pending = r['status'] != null && r['status'] != 'approved' && r['status'] != 'completed';
        message = '${r['return_number'] ?? 'Return'}: material back from ${c['vendor_name'] ?? 'the vendor'} on challan ${c['challan_number'] ?? c['issue_number']}'
            '${pending ? ' — waiting for approval; stock with the vendor goes down once it is approved.' : '. Stock with the vendor is reduced.'}';
      },
    );
    return ok ? message : null;
  }
}

class _Out {
  int? itemId;
  final qty = TextEditingController();
  int? poLine;
  final rate = TextEditingController();
  final share = TextEditingController();
}

class _Itc04 extends StatefulWidget {
  const _Itc04({required this.canExport});
  final bool canExport;

  @override
  State<_Itc04> createState() => _Itc04State();
}

class _Itc04State extends State<_Itc04> {
  late DateTime _from;
  late DateTime _to;
  Json? _data;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final d = DateTime.now();
    final q = (d.month - 1) ~/ 3;
    _from = DateTime(d.year, q * 3 + 1, 1);
    _to = DateTime(d.year, q * 3 + 4, 0);
  }

  Future<void> _run() async {
    setState(() => _busy = true);
    try {
      final d = jsonMap(await Api.get('/store/job-work/itc04', query: {'from': apiDate(_from), 'to': apiDate(_to)}));
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final sent = jsonList(d?['sent']);
    final received = jsonList(d?['received']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: DateField(label: 'From', required: true, value: _from, onChanged: (v) => setState(() => _from = v ?? _from))),
            const SizedBox(width: 8),
            Expanded(child: DateField(label: 'To', required: true, value: _to, onChanged: (v) => setState(() => _to = v ?? _to))),
          ]),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40), textStyle: const TextStyle(fontSize: 14)),
                onPressed: _busy ? null : _run,
                child: Text(_busy ? 'Building…' : 'Show report')),
            if (widget.canExport)
              PillButton('Download Excel',
                  icon: Icons.download_rounded,
                  onPressed: () => openApiFile(context, '/store/job-work/itc04', 'ITC-04_${apiDate(_from)}_${apiDate(_to)}.xlsx',
                      query: {'from': apiDate(_from), 'to': apiDate(_to), 'format': 'xlsx'})),
          ]),
        ]),
      ),
      if (d != null) ...[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Hint(
              'Table 4 (sent): ${sent.length} line${sent.length == 1 ? '' : 's'} · Table 5A (received back / used): ${received.length} line${received.length == 1 ? '' : 's'} · Outstanding at job workers: ${jsonList(d['outstanding']).length}'
              '${jsonList(d['overdue']).isNotEmpty ? ' · ${jsonList(d['overdue']).length} past the Rule 45 limit' : ''}'),
        ),
        DetailSection('4 · Sent', children: [
          if (sent.isEmpty) const Hint('Nothing sent in this period.'),
          for (final r in sent)
            LineTile(
              title: '${txt(r['challan_number'])} · ${txt(r['item_name'])}',
              trailing: fmtQ(r['quantity_sent'], r['uom']),
              subtitle: '${fmtDate(r['challan_date'])} · ${txt(r['vendor_name'])}',
              facts: [
                MiniFact('HSN', txt(r['hsn_code'])),
                MiniFact('Taxable value', fmtMoney(r['taxable_value'])),
                MiniFact('Type', r['goods_type'] == 'capital_goods' ? 'Capital goods' : 'Inputs'),
              ],
            ),
        ]),
        DetailSection('5A · Received back / used', children: [
          if (received.isEmpty) const Hint('Nothing received back in this period.'),
          for (final r in received)
            LineTile(
              title: '${txt(r['challan_number'])} · ${txt(r['item_name'])}',
              trailing: fmtQ(r['quantity'], r['uom']),
              subtitle: '${txt(r['document'])} · ${fmtDate(r['document_date'])} · ${txt(r['nature'])}',
              facts: [MiniFact('Taxable value', fmtMoney(r['taxable_value']))],
            ),
        ]),
      ],
    ]);
  }
}
