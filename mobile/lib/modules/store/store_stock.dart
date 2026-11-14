import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'store_common.dart';
import 'store_outward.dart' show IssueDetailScreen;

// Stock, Batches, Bins, Serial Nos., Movements (portal: store/stock,
// batches, batches/[id], bins, serials, movements, StockAsOfPanel,
// StockImportDialog, StockEntryDialog).

// ── Stock ────────────────────────────────────────────────────────────────────

const _dispositions = [
  Option('scrap', 'Scrap — write it off'),
  Option('vendor_return', 'Returned to vendor'),
  Option('release', 'Release to usable stock (passed re-inspection)'),
];

class StockTab extends StatefulWidget {
  const StockTab({super.key});

  @override
  State<StockTab> createState() => _StockTabState();
}

class _StockTabState extends State<StockTab> {
  List<Json> _balances = const [];
  Map<int, Json> _items = {};
  List<Json> _locations = const [];
  Json? _plants;
  int? _inTransit;
  bool _loading = true;
  Object? _error;
  String _view = 'overview';
  String _search = '';
  int? _store;
  String? _category;
  String? _subcategory;

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
        Api.list('/store/stock/balances'),
        StoreData.items(refresh: true),
        StoreData.locations(),
      ]);
      Json? plants;
      try {
        plants = jsonMap(await Api.get('/store/settings/plant-access/me'));
      } catch (_) {}
      int? transit;
      try {
        transit = (await Api.list('/store/stock-transfers', query: {'status': 'in_transit'})).rows.length;
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _balances = (r[0] as ApiPage).rows;
        _items = {for (final i in r[1] as List<Json>) if (toInt(i['id']) != null) toInt(i['id'])!: i};
        _locations = r[2] as List<Json>;
        _plants = plants;
        _inTransit = transit;
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

  bool _matches(Json b) {
    if (_store != null && toInt(b['location_id']) != _store) return false;
    final it = _items[toInt(b['item_id'])];
    if (_category != null && it?['category'] != _category) return false;
    if (_subcategory != null && it?['subcategory'] != _subcategory) return false;
    final q = _search.trim().toLowerCase();
    if (q.isNotEmpty) {
      final hay = [b['item_code'], b['item_name'], b['location_name'], it?['category'], it?['subcategory']]
          .where((x) => x != null)
          .join(' ')
          .toLowerCase();
      if (!hay.contains(q)) return false;
    }
    return true;
  }

  double _rate(Object? itemId) {
    final it = _items[toInt(itemId)];
    for (final k in ['moving_average_cost', 'standard_cost', 'last_receipt_rate']) {
      final n = numOr0(it?[k]);
      if (n != 0) return n;
    }
    return 0;
  }

  double _total(Json b) => numOr0(b['on_hand_qty']) + numOr0(b['quality_qty']) + numOr0(b['quarantine_qty']);

  bool _low(Json b) {
    final lvl = toNum(_items[toInt(b['item_id'])]?['reorder_level']);
    return lvl != null && lvl > 0 && numOr0(b['available_qty']) <= lvl;
  }

  Future<void> _clear(Json b) async {
    final qty = TextEditingController(text: '${b['quarantine_qty']}');
    final remarks = TextEditingController();
    String disposition = 'scrap';
    final ok = await showFormSheet(
      context,
      title: 'Clear Quarantine',
      saveLabel: 'Clear',
      builder: (ctx, setS) => [
        Hint('${txt(b['item_code'])} — ${txt(b['item_name'])} at ${txt(b['location_name'])} · ${fmtQ(b['quarantine_qty'], b['uom'])} held'),
        const FormHeading('Disposition'),
        AppSelect<String>(
            label: 'What happened to it?',
            required: true,
            value: disposition,
            options: _dispositions,
            onChanged: (o) => setS(() => disposition = o?.value ?? disposition)),
        AppTextField(label: 'Quantity', required: true, controller: qty, keyboardType: AppTextField.number),
        Hint('Up to ${fmtQ(b['quarantine_qty'], b['uom'])} — what is in quarantine at this store.'),
        const FormHeading('Remarks'),
        AppTextField(label: 'Remarks', controller: remarks, hint: 'Scrap note no. / vendor return challan / QC report'),
      ],
      onSave: () async {
        final q = parseNum(qty.text) ?? 0;
        if (q <= 0) throw 'Quantity must be greater than zero.';
        if (q > numOr0(b['quarantine_qty'])) throw 'Only ${fmtQ(b['quarantine_qty'], b['uom'])} is in quarantine.';
        await Api.post('/store/stock/quarantine/clear', data: {
          'item_id': b['item_id'],
          'location_id': b['location_id'],
          'quantity': q,
          'disposition': disposition,
          'remarks': blankToNull(remarks.text),
        });
      },
    );
    if (ok) _load();
  }

  Future<void> _openingImport() async {
    final go = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Opening Stock Import'),
        content: const Text(
            'Stock already on the shelves at go-live: fill the template (item code, store, quantity, rate) and upload it. If any row has a problem nothing is posted — fix the rows and upload again.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, 'template'), child: const Text('Download template')),
          FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(88, 40)),
              onPressed: () => Navigator.pop(ctx, 'upload'),
              child: const Text('Upload file')),
        ],
      ),
    );
    if (!mounted || go == null) return;
    if (go == 'template') {
      await openApiFile(context, '/store/stock/import/template', 'opening_stock_template.xlsx');
      return;
    }
    final res = await pickAndUpload(context, '/store/stock/import', extensions: const ['xlsx', 'xlsm', 'csv']);
    if (res is! Map || !mounted) return;
    final r = jsonMap(res);
    final errors = jsonList(r['errors']);
    final posted = jsonList(r['posted']);
    await messageDialog(
        context,
        errors.isNotEmpty ? 'Nothing Posted' : 'Opening Stock Posted',
        errors.isNotEmpty
            ? 'Nothing was posted — ${errors.length} row${errors.length == 1 ? ' has a problem' : 's have problems'}. ${txt(r['would_post'])} other row(s) were fine. Fix the rows below and upload again.\n\n'
                '${errors.map((e) => 'Row ${txt(e['row'])}${e['item_code'] != null ? ' (${e['item_code']})' : ''}: ${txt(e['reason'] ?? e['error'] ?? e['message'])}').join('\n')}'
            : '${posted.length} opening-stock line${posted.length == 1 ? '' : 's'} posted.');
    if (posted.isNotEmpty) _load();
  }

  @override
  Widget build(BuildContext context) {
    final rows = _balances.where(_matches).toList();
    final cats = {for (final i in _items.values) if (i['category'] != null) i['category'].toString()}.toList()..sort();
    final seeVal = seeValues;
    final seeAsOf = canFeature('stock', 'as_of', 'view');
    final canPost = canFeature('adjustments', 'quarantine_clear', 'create');
    final header = <Widget>[
      StorePageHeader('Stock', actions: [
        if (can('stock', 'export'))
          PillButton('Export',
              icon: Icons.download_rounded,
              onPressed: () => openApiFile(context, '/store/stock/export', 'stock_${todayIso()}.xlsx', query: {
                    'search': _search.trim(),
                    'location_id': _store,
                    'category': _category,
                    'subcategory': _subcategory,
                  })),
        if (can('adjustments', 'create'))
          PillButton('Opening Stock Import', icon: Icons.upload_file_rounded, onPressed: _openingImport),
      ]),
      if (_plants?['restricted'] == true)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Hint((_plants!['plant_names'] as List?)?.isNotEmpty == true
              ? 'Showing stock of your plant: ${(_plants!['plant_names'] as List).join(', ')}'
              : 'No plant is set for you, so no stock is shown — ask an admin to set your plant in Organization › Users, or widen your Store data access in Organization › Role & Permissions.'),
        ),
      ChipRow([
        for (final (v, l) in [
          ('overview', 'Store Overview'),
          ('matrix', 'Item × Store'),
          ('balances', 'All Balances'),
          if (seeAsOf) ('asof', 'Stock on Date'),
        ])
          CountChip(l, null, selected: _view == v, onTap: () => setState(() => _view = v)),
      ]),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: Row(children: [
          Expanded(child: SearchField(hint: 'Search item code, name, store…', onChanged: (v) => setState(() => _search = v))),
          const SizedBox(width: 8),
          FilterButton(
            active: countSet([_store, if (_view != 'asof') _category, if (_view != 'asof') _subcategory]),
            onClear: () => setState(() {
              _store = null;
              _category = null;
              _subcategory = null;
            }),
            builder: (ctx, setS) {
              void upd(VoidCallback f) {
                setState(f);
                setS(() {});
              }

              final subsNow = {
                for (final i in _items.values)
                  if (i['subcategory'] != null && (_category == null || i['category'] == _category)) i['subcategory'].toString()
              }.toList()
                ..sort();
              return [
                AppSelect<int>(
                  label: 'All stores',
                  value: _store,
                  options: [for (final l in _locations) if (toInt(l['id']) != null) Option(toInt(l['id'])!, txt(l['name']))],
                  onChanged: (o) => upd(() => _store = o?.value),
                ),
                if (_view != 'asof') ...[
                  AppSelect<String>(
                    label: 'All categories',
                    value: _category,
                    options: [for (final c in cats) Option(c, c)],
                    onChanged: (o) => upd(() {
                      _category = o?.value;
                      _subcategory = null;
                    }),
                  ),
                  AppSelect<String>(
                    label: 'All subcategories',
                    value: _subcategory,
                    options: [for (final c in subsNow) Option(c, c)],
                    onChanged: (o) => upd(() => _subcategory = o?.value),
                  ),
                ],
              ];
            },
          ),
        ]),
      ),
    ];

    if (_view == 'asof' && seeAsOf) {
      return _AsOfPanel(header: header, locationId: _store, search: _search, canExport: canFeature('stock', 'as_of', 'export'));
    }

    final body = <Widget>[];
    const empty = 'No stock recorded yet — stock arrives through a GRN (or the Opening Stock Import at go-live).';
    final hasFilters = _search.isNotEmpty || _store != null || _category != null || _subcategory != null;
    if (_loading) {
      body.add(const LoadingView());
    } else if (_error != null) {
      body.add(ErrorView(_error!, onRetry: _load));
    } else if (_view == 'overview') {
      final byStore = <int, Map<String, dynamic>>{};
      for (final b in rows) {
        if (_total(b) <= 0) continue;
        final id = toInt(b['location_id']) ?? 0;
        final s = byStore.putIfAbsent(id, () => {
              'id': id,
              'name': b['location_name'] ?? 'Store $id',
              'items': 0,
              'value': 0.0,
              'available': 0.0,
              'quality': 0,
              'blocked': 0,
              'low': 0,
              'unpriced': 0,
            });
        final rate = _rate(b['item_id']);
        s['items'] += 1;
        s['value'] += _total(b) * rate;
        s['available'] += numOr0(b['available_qty']) * rate;
        if (numOr0(b['quality_qty']) > 0) s['quality'] += 1;
        if (numOr0(b['quarantine_qty']) > 0) s['blocked'] += 1;
        if (_low(b)) s['low'] += 1;
        if (rate == 0) s['unpriced'] += 1;
      }
      final stores = byStore.values.toList()..sort((a, b) => (b['value'] as double).compareTo(a['value'] as double));
      num sum(String k) => stores.fold<num>(0, (a, s) => a + (s[k] as num));
      final distinct = {for (final b in rows) if (_total(b) > 0) b['item_id']}.length;
      body.add(KpiGrid([
        if (seeVal)
          KpiTile('Stock Value', fmtInr0(sum('value')),
              hint: sum('unpriced') > 0
                  ? '${sum('unpriced')} line${sum('unpriced') == 1 ? '' : 's'} with no rate — set cost'
                  : 'At moving average / standard cost'),
        KpiTile('Stores Holding Stock', fmtQ(stores.length), hint: '$distinct distinct item${distinct == 1 ? '' : 's'}'),
        KpiTile('At / Below Reorder', sum('low') > 0 ? '${sum('low')}' : 'None',
            hint: 'Available ≤ item reorder level', color: sum('low') > 0 ? cRed : Brand.muted),
        KpiTile('In Quality', sum('quality') > 0 ? '${sum('quality')}' : 'None',
            hint: 'Waiting for the quality check decision', color: sum('quality') > 0 ? cBlue : Brand.muted),
        KpiTile('Blocked', sum('blocked') > 0 ? '${sum('blocked')}' : 'None',
            hint: 'Quarantined — cannot be issued', color: sum('blocked') > 0 ? const Color(0xFFB45309) : Brand.muted),
        if (_inTransit != null)
          KpiTile('Transfers In Transit', _inTransit! > 0 ? '$_inTransit' : 'None',
              hint: "Dispatched, not yet received — on neither store's balance",
              color: _inTransit! > 0 ? cPurple : Brand.muted),
      ]));
      body.add(const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 8), child: Caps('Stock by Store')));
      if (stores.isEmpty) body.add(EmptyView(hasFilters ? 'No stock matches the filters.' : empty));
      for (final s in stores) {
        body.add(RecordCard(
          title: txt(s['name']),
          meta: [
            ('Items', fmtQ(s['items'])),
            if (seeVal) ('Stock Value', fmtInr0(s['value'] as num)),
            if (seeVal) ('Available Value', fmtInr0(s['available'] as num)),
            ('Low stock', s['low'] == 0 ? '—' : '${s['low']}'),
            ('In quality', s['quality'] == 0 ? '—' : '${s['quality']}'),
            ('Blocked', s['blocked'] == 0 ? '—' : '${s['blocked']}'),
          ],
          onTap: () => setState(() {
            _store = s['id'] as int;
            _view = 'balances';
          }),
        ));
      }
    } else if (_view == 'matrix') {
      final m = <int, Map<String, dynamic>>{};
      for (final b in rows) {
        final id = toInt(b['item_id']) ?? 0;
        final r = m.putIfAbsent(id, () => {
              'label': '${txt(b['item_code'])} — ${txt(b['item_name'])}',
              'uom': b['uom'] ?? '',
              'by': <String, double>{},
              'total': 0.0,
            });
        final q = numOr0(b['available_qty']);
        final by = r['by'] as Map<String, double>;
        final store = txt(b['location_name']);
        by[store] = (by[store] ?? 0) + q;
        r['total'] = (r['total'] as double) + q;
      }
      final list = m.values.toList()..sort((a, b) => (a['label'] as String).compareTo(b['label'] as String));
      if (list.isEmpty) body.add(EmptyView(hasFilters ? 'No stock matches the filters.' : empty));
      body.add(const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 8), child: Caps('Item (available qty)')));
      for (final r in list) {
        final by = r['by'] as Map<String, double>;
        body.add(RecordCard(
          title: r['label'] as String,
          trailing: Text(fmtQ(r['total'], r['uom']),
              style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.primaryActive)),
          meta: [for (final e in (by.entries.toList()..sort((a, b) => a.key.compareTo(b.key)))) (e.key, fmtQ(e.value, r['uom']))],
        ));
      }
    } else {
      body.add(const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 8), child: Caps('Current Balances')));
      if (rows.isEmpty) body.add(EmptyView(hasFilters ? 'No balances match the filters.' : empty));
      for (final b in rows) {
        final u = b['uom'];
        String opt(Object? v) => numOr0(v) > 0 ? fmtQ(v, u) : '—';
        body.add(RecordCard(
          code: txt(b['item_code']),
          title: txt(b['item_name']),
          subtitle: txt(b['location_name']),
          trailing: Text(fmtQ(b['available_qty'], u),
              style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.primaryActive)),
          meta: [
            ('On Hand (Free)', fmtQ(b['on_hand_qty'], u)),
            ('Reserved', fmtQ(b['reserved_qty'], u)),
            ('Available', fmtQ(b['available_qty'], u)),
            ('Quality', opt(b['quality_qty'])),
            ('Blocked', opt(b['quarantine_qty'])),
            ('With Vendor', opt(b['vendor_qty'])),
          ],
          onTap: canPost && numOr0(b['quarantine_qty']) > 0 ? () => _clear(b) : null,
        ));
        if (canPost && numOr0(b['quarantine_qty']) > 0) {
          body.add(Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Align(
              alignment: Alignment.centerRight,
              child: PillButton('Clear blocked stock', icon: Icons.shield_outlined, color: cAmber, onPressed: () => _clear(b)),
            ),
          ));
        }
      }
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 32), children: [...header, ...body]),
    );
  }
}

class _AsOfPanel extends StatefulWidget {
  const _AsOfPanel({required this.header, required this.locationId, required this.search, required this.canExport});
  final List<Widget> header;
  final int? locationId;
  final String search;
  final bool canExport;

  @override
  State<_AsOfPanel> createState() => _AsOfPanelState();
}

const _rateBasis = {
  'average_on_date': 'Average on date',
  'current_average': "Today's average",
  'standard': 'Standard cost',
  'none': 'No cost',
};

class _AsOfPanelState extends State<_AsOfPanel> {
  DateTime _to = DateTime.now();
  late DateTime _from = DateTime(_to.year, _to.month, 1);
  Json? _report;
  Object? _error;
  bool _loading = false;
  String _key = '';

  Map<String, dynamic> get _params =>
      {'date': apiDate(_to), 'from_date': apiDate(_from), 'location_id': widget.locationId};

  void _load() {
    final k = '$_params';
    if (k == _key) return;
    _key = k;
    setState(() {
      _loading = true;
      _error = null;
    });
    Api.get('/store/stock/as-of', query: _params).then((r) {
      if (mounted) {
        setState(() {
          _report = jsonMap(r);
          _loading = false;
        });
      }
    }, onError: (Object e) {
      if (mounted) {
        setState(() {
          _report = null;
          _error = e;
          _loading = false;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    _load();
    final q = widget.search.trim().toLowerCase();
    final rows = jsonList(_report?['rows'])
        .where((r) => q.isEmpty || '${r['item_code']} ${r['item_name']} ${r['location_name']}'.toLowerCase().contains(q))
        .toList();
    return ListView(padding: const EdgeInsets.only(bottom: 32), children: [
      ...widget.header,
      const Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Hint(
            'Stock as it stood at the end of a date, rebuilt from every posted movement — what Finance values as closing stock for a period. Closing includes Free, Quality, Blocked and stock with a job-work vendor (all still ours).'),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Row(children: [
          Expanded(
              child: DateField(
                  label: 'Movements from', required: true, value: _from, onChanged: (d) => setState(() => _from = d ?? _from))),
          const SizedBox(width: 8),
          Expanded(
              child: DateField(label: 'Stock as of', required: true, value: _to, onChanged: (d) => setState(() => _to = d ?? _to))),
        ]),
      ),
      if (widget.canExport || _report != null)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            if (widget.canExport)
              PillButton('Export Excel',
                  icon: Icons.download_rounded,
                  onPressed: _report == null
                      ? null
                      : () => openApiFile(context, '/store/stock/as-of/export', 'stock_on_${apiDate(_to)}.xlsx', query: _params)),
            if (_report != null)
              Text(
                  'Opening value ${fmtMoney(_report!['total_opening_value'])} · Closing value ${fmtMoney(_report!['total_closing_value'])}',
                  style: const TextStyle(fontSize: 12.5, color: Brand.body)),
          ]),
        ),
      if (_error != null) Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(ApiClient.describe(_error!))),
      if (_loading) const LoadingView(),
      if (!_loading && _error == null && rows.isEmpty) const EmptyView('No stock or movements for this date range.'),
      if (!_loading)
        for (final r in rows)
          RecordCard(
            code: txt(r['item_code']),
            title: txt(r['item_name']),
            subtitle: txt(r['location_name']),
            trailing: Text(fmtQ(r['closing_qty'], r['uom']), style: const TextStyle(fontWeight: FontWeight.w700)),
            meta: [
              ('Opening', fmtQ(r['opening_qty'], r['uom'])),
              ('Receipts', fmtQ(r['receipt_qty'])),
              ('Issues', fmtQ(r['issue_qty'])),
              ('Free', fmtQ(r['closing_free_qty'])),
              ('Quality', fmtQ(r['closing_quality_qty'])),
              ('Blocked', fmtQ(r['closing_blocked_qty'])),
              ('With vendor', fmtQ(r['closing_vendor_qty'] ?? 0)),
              ('Rate', fmtMoney(r['closing_rate'])),
              ('Closing value', fmtMoney(r['closing_value'])),
              ('Rate basis', _rateBasis[r['rate_source']] ?? txt(r['rate_source'])),
            ],
          ),
    ]);
  }
}

// ── Batches ──────────────────────────────────────────────────────────────────

class BatchesTab extends StatefulWidget {
  const BatchesTab({super.key});

  @override
  State<BatchesTab> createState() => _BatchesTabState();
}

class _BatchesTabState extends State<BatchesTab> {
  final _list = GlobalKey<ApiListViewState>();
  bool _inStock = true;

  @override
  Widget build(BuildContext context) => ApiListView(
        key: _list,
        searchHint: 'Search batch, heat no., TC no., vendor or item…',
        load: (page, q) => Api.list('/store/batches', query: {'q': q, 'in_stock': _inStock}),
        emptyText: _inStock
            ? 'No batches with stock — untick “Only batches with stock” to see all.'
            : 'No batches yet — batches are created when a GRN receives a batch-tracked item.',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 0, 16, 0),
            child: Hint(
                'Batch-tracked items (Item Master “Batch tracked”) carry the vendor\'s heat number and mill TC from the GRN. Open a batch to trace where it went.'),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Row(children: [
              Expanded(child: Hint(_inStock ? 'Showing only batches with stock.' : 'Showing every batch.')),
              FilterButton(
                active: countSet([_inStock]),
                onClear: () {
                  setState(() => _inStock = false);
                  _list.currentState?.reload();
                },
                builder: (ctx, setS) => [
                  CheckField(
                      label: 'Only batches with stock',
                      value: _inStock,
                      onChanged: (v) {
                        setState(() => _inStock = v);
                        setS(() {});
                        _list.currentState?.reload();
                      }),
                ],
              ),
            ]),
          ),
        ]),
        itemBuilder: (ctx, b, reload) {
          final t = jsonMap(b['total']);
          return RecordCard(
            code: txt(b['batch_number']),
            title: '${txt(b['item_code'])} — ${txt(b['item_name'])}',
            subtitle: [
              if (b['heat_number'] != null) 'Heat ${b['heat_number']}',
              txt(b['vendor_name']),
              if (b['grn_number'] != null) b['grn_number'],
            ].join(' · '),
            trailing: pill(b['status'] == 'blocked' ? 'Blocked' : 'Active', b['status'] == 'blocked' ? cRed : cGreen),
            meta: [
              ('Received', '${fmtQ(b['received_qty'], b['uom'])} · ${fmtDate(b['received_date'])}'),
              if (b['expiry_date'] != null) ('Expires', fmtDate(b['expiry_date'])),
              ('Mill TC', '${txt(b['tc_number'])}${b['has_tc_document'] == true ? ' · scan' : ''}'),
              ('Free', numOr0(t['free']) > 0 ? fmtQ(t['free']) : '—'),
              ('Quality', numOr0(t['quality']) > 0 ? fmtQ(t['quality']) : '—'),
              ('Blocked', numOr0(t['blocked']) > 0 ? fmtQ(t['blocked']) : '—'),
              ('With vendor', numOr0(t['vendor']) > 0 ? fmtQ(t['vendor']) : '—'),
            ],
            onTap: () => openThen(ctx, BatchTraceScreen(batchId: toInt(b['id'])!), reload),
          );
        },
      );
}

const _txnLabels = {
  'receipt': 'Receipt',
  'issue': 'Issue',
  'quality_in': 'Into Quality',
  'quality_release': 'Quality → Free',
  'quality_block': 'Quality → Blocked',
  'jobwork_out': 'To job worker',
  'jobwork_in': 'Back from job worker',
  'jobwork_to_quality': 'Back → Quality',
  'jobwork_to_blocked': 'Back → Blocked',
  'jobwork_consume': 'Used at job worker',
  'return_in': 'Returned to store',
  'return_out': 'Out to vendor',
  'transfer_in': 'Transfer in',
  'transfer_out': 'Transfer out',
  'quarantine_out': 'Out of Blocked',
  'blocked_release': 'Blocked → Free',
  'adjustment_in': 'Adjustment +',
  'adjustment_out': 'Adjustment −',
};

class BatchTraceScreen extends StatefulWidget {
  const BatchTraceScreen({super.key, required this.batchId});
  final int batchId;

  @override
  State<BatchTraceScreen> createState() => _BatchTraceScreenState();
}

class _BatchTraceScreenState extends State<BatchTraceScreen> {
  int _v = 0;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        key: ValueKey(_v),
        load: () async => jsonMap(await Api.get('/store/batches/${widget.batchId}')),
        builder: (ctx, t, reload) {
          final u = t['uom'];
          final total = jsonMap(t['total']);
          final blocked = t['status'] == 'blocked';
          Future<void> setStatus(String status, String? reason) async {
            final ok = await runAction(ctx, () => Api.post('/store/batches/${t['id']}/status', data: {'status': status, 'reason': reason}));
            if (ok) setState(() => _v++);
          }

          return SubPage(
            title: '${txt(t['batch_number'])}${t['heat_number'] != null ? ' · heat ${t['heat_number']}' : ''}',
            bottom: actionBar([
              if (t['has_tc_document'] == true)
                secondaryAction('Open mill TC',
                    () => openApiFile(ctx, '/store/batches/${t['id']}/tc', t['tc_file_name']?.toString() ?? 'mill_tc_${t['batch_number']}.pdf')),
              if (canFeature('grn', 'mill_tc', 'create'))
                secondaryAction(t['has_tc_document'] == true ? 'Replace mill TC' : 'Attach mill TC', () async {
                  final r = await pickAndUpload(ctx, '/store/batches/${t['id']}/tc', extensions: const ['pdf', 'jpg', 'jpeg', 'png']);
                  if (r != null) setState(() => _v++);
                }),
              if (canFeature('adjustments', 'batch_status', 'edit'))
                blocked
                    ? primaryAction('Release batch', () => setStatus('active', 'Released for use'))
                    : secondaryAction('Block batch', () async {
                        final reason = await promptDialog(ctx,
                            title: 'Block this batch',
                            message: 'Issues will refuse this batch until it is released. Say why (shown to anyone who tries to issue it).',
                            confirmLabel: 'Block batch');
                        if (reason != null) await setStatus('blocked', reason);
                      }, color: cRed),
            ]),
            body: detailList([
              SummaryCard(
                title: '${txt(t['item_name'])}${t['item_code'] != null ? '  ${t['item_code']}' : ''}',
                text:
                    'Batch received from ${t['vendor_name'] ?? 'an unknown vendor'}${t['grn_number'] != null ? ' on GRN ${t['grn_number']}' : ''}. Below: where it went, what is left and every movement.',
                badges: [pill(blocked ? 'Blocked' : 'Active', blocked ? cRed : cGreen)],
                meta: ['Received ${fmtDate(t['received_date'])}', 'Free stock ${fmtQ(total['free'], u)}'],
              ),
              DetailSection('Receipt', children: [
                FieldRow('Vendor', t['vendor_name']),
                FieldRow('GRN', t['grn_number']),
                FieldRow('Heat no.', t['heat_number']),
                FieldRow('Received', '${fmtQ(t['received_qty'], u)} on ${fmtDate(t['received_date'])}'),
                if (t['accepted_qty'] != null) FieldRow('Accepted', fmtQ(t['accepted_qty'], u)),
                if (t['mfg_date'] != null) FieldRow('Manufactured on', fmtDate(t['mfg_date'])),
                if (t['expiry_date'] != null) FieldRow('Expires on', fmtDate(t['expiry_date'])),
              ]),
              DetailSection('Mill test certificate', children: [
                FieldRow('TC no.', t['tc_number']),
                FieldRow('TC document', t['has_tc_document'] == true ? (t['tc_file_name'] ?? 'Attached') : 'Not attached'),
              ]),
              DetailSection('Stock now', children: [
                FieldRow('Free', fmtQ(total['free'], u)),
                FieldRow('In quality', fmtQ(total['quality'], u)),
                FieldRow('Blocked', fmtQ(total['blocked'], u)),
                FieldRow('With vendor', fmtQ(total['vendor'], u)),
                if (blocked) FieldRow('Why it is blocked', t['remarks']),
              ]),
              DetailSection('Where it went — issues', children: [
                if (jsonList(t['issues']).isEmpty) const Hint('Nothing issued from this batch yet.'),
                for (final i in jsonList(t['issues']))
                  LineTile(
                    title: txt(i['issue_number']),
                    trailing: fmtQ(i['quantity'], u),
                    subtitle: '${fmtDate(i['issue_date'])} · ${humanize(i['issue_type'])}',
                    facts: [
                      MiniFact('Work order', txt(i['work_order'])),
                      MiniFact('Machine / project', txt(i['project'])),
                      MiniFact('Job worker',
                          i['vendor_name'] != null ? '${i['vendor_name']}${i['challan_number'] != null ? ' (${i['challan_number']})' : ''}' : '—'),
                    ],
                    onTap: toInt(i['issue_id']) == null ? null : () => openScreen(ctx, IssueDetailScreen(issueId: toInt(i['issue_id'])!)),
                  ),
              ]),
              if (jsonList(t['made_from']).isNotEmpty || jsonList(t['made_into']).isNotEmpty)
                DetailSection('Job work genealogy', children: [
                  for (final m in jsonList(t['made_from']))
                    LineTile(
                      title:
                          'Made from ${txt(m['item_name'])} batch ${txt(m['batch_number'])}${m['heat_number'] != null ? ' (heat ${m['heat_number']})' : ''}',
                      subtitle: 'by ${txt(m['vendor_name'])} on ${txt(m['receipt_number'])}',
                      onTap: toInt(m['batch_id']) == null ? null : () => openScreen(ctx, BatchTraceScreen(batchId: toInt(m['batch_id'])!)),
                    ),
                  for (final m in jsonList(t['made_into']))
                    LineTile(
                      title: 'Used in ${txt(m['item_name'])} batch ${txt(m['batch_number'])}',
                      subtitle: 'by ${txt(m['vendor_name'])} on ${txt(m['receipt_number'])}',
                      onTap: toInt(m['batch_id']) == null ? null : () => openScreen(ctx, BatchTraceScreen(batchId: toInt(m['batch_id'])!)),
                    ),
                ]),
              if (jsonList(t['inspection_lots']).isNotEmpty || jsonList(t['ncrs']).isNotEmpty)
                DetailSection('Quality', children: [
                  for (final l in jsonList(t['inspection_lots']))
                    LineTile(
                      title: 'Lot ${txt(l['lot_number'])}',
                      subtitle:
                          '${humanize(l['status'])}${l['decision'] != null ? ' · ${humanize(l['decision'])}' : ''}${l['accepted_qty'] != null ? ' · accepted ${fmtQ(l['accepted_qty'])}, rejected ${fmtQ(l['rejected_qty'] ?? 0)}' : ''}',
                    ),
                  for (final n in jsonList(t['ncrs'])) LineTile(title: 'NCR ${txt(n['ncr_number'])}', subtitle: humanize(n['status'])),
                ]),
              DetailSection('Stock by store', children: [
                if (jsonList(t['stock']).isEmpty) const Hint('No stock of this batch left.'),
                for (final s in jsonList(t['stock']))
                  LineTile(title: txt(s['location_name']), facts: [
                    MiniFact('Free', fmtQ(s['free'])),
                    MiniFact('Quality', fmtQ(s['quality'])),
                    MiniFact('Blocked', fmtQ(s['blocked'])),
                    MiniFact('With vendor', fmtQ(s['vendor'])),
                  ]),
              ]),
              DetailSection('All movements', children: [
                if (jsonList(t['movements']).isEmpty) const Hint('No movements recorded for this batch yet.'),
                for (final m in jsonList(t['movements']))
                  LineTile(
                    title: _txnLabels[m['transaction_type']] ?? humanize(m['transaction_type']),
                    trailing: fmtQ(m['quantity'], u),
                    subtitle: '${fmtDate(m['date'])} · ${txt(m['location_name'])} · ${txt(m['reference_number'])}',
                    facts: [if (m['remarks'] != null) MiniFact('Remarks', txt(m['remarks']))],
                  ),
              ]),
            ]),
          );
        },
      );
}

// ── Bins ─────────────────────────────────────────────────────────────────────

const _binTypeLabel = {'rack': 'Rack', 'shelf': 'Shelf', 'bin': 'Bin'};
const _binTypeColor = {'rack': cPurple, 'shelf': Color(0xFF0891B2), 'bin': Color(0xFFFF6A2A)};
const _binParents = {'rack': <String>[], 'shelf': ['rack'], 'bin': ['rack', 'shelf']};
const _binCodeHint = {'rack': 'R1', 'shelf': 'R1-S2', 'bin': 'R1-S2-B3'};

class BinsTab extends StatefulWidget {
  const BinsTab({super.key});

  @override
  State<BinsTab> createState() => _BinsTabState();
}

class _BinsTabState extends State<BinsTab> {
  List<Json> _locations = const [];
  int? _loc;
  List<Json> _bins = const [];
  List<Json> _stock = const [];
  List<Json> _moves = const [];
  String? _movesError;
  String? _error;
  bool _loading = false;
  String? _type;
  String _search = '';
  bool _inactive = false;
  final Set<int> _open = {};

  @override
  void initState() {
    super.initState();
    StoreData.locations().then((l) {
      if (!mounted) return;
      final active = l.where((x) => x['is_active'] != false).toList();
      setState(() => _locations = active);
      if (active.length == 1) _pick(toInt(active.first['id']));
    }, onError: (Object e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    });
  }

  void _pick(int? id) {
    setState(() {
      _loc = id;
      _bins = const [];
      _stock = const [];
      _open.clear();
    });
    _load();
  }

  Future<void> _load() async {
    if (_loc == null) return;
    setState(() => _loading = true);
    try {
      final bins = (await Api.list('/store/bins', query: {'location_id': _loc})).rows;
      List<Json> stock = const [];
      String? err;
      try {
        stock = (await Api.list('/store/bin-stock', query: {'location_id': _loc})).rows.where((r) => numOr0(r['quantity']) != 0).toList();
      } catch (e) {
        err = 'Could not load the stock in the bins — the bin list is shown without it. ${ApiClient.describe(e)}';
      }
      List<Json> moves = const [];
      String? mErr;
      try {
        moves = (await Api.list('/store/bin-stock/moves', query: {'location_id': _loc})).rows;
      } catch (e) {
        mErr = ApiClient.describe(e);
      }
      if (!mounted) return;
      setState(() {
        _bins = bins;
        _stock = stock;
        _moves = moves;
        _movesError = mErr;
        _error = err;
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Could not load the bins of this store. ${ApiClient.describe(e)}';
          _loading = false;
        });
      }
    }
  }

  Json? _byId(Object? id) {
    for (final b in _bins) {
      if (b['id'] == id) return b;
    }
    return null;
  }

  Map<int, List<Json>> get _stockByBin {
    final q = _search.trim().toLowerCase();
    final m = <int, List<Json>>{};
    for (final r in _stock) {
      if (q.isNotEmpty && !'${r['item_code']} ${r['item_name']}'.toLowerCase().contains(q)) continue;
      m.putIfAbsent(toInt(r['bin_id']) ?? 0, () => []).add(r);
    }
    return m;
  }

  List<(Json, int)> _tree(Map<int, List<Json>> sb) {
    var visible = _bins.where((b) => (_inactive || b['is_active'] == true) && (_type == null || b['bin_type'] == _type)).toList();
    if (_search.trim().isNotEmpty) {
      final keep = <int>{};
      for (final id in sb.keys) {
        var cur = _byId(id);
        while (cur != null && !keep.contains(cur['id'])) {
          keep.add(toInt(cur['id'])!);
          cur = cur['parent_id'] == null ? null : _byId(cur['parent_id']);
        }
      }
      visible = visible.where((b) => keep.contains(b['id'])).toList();
    }
    final ids = {for (final b in visible) b['id']};
    final kids = <Object?, List<Json>>{};
    for (final b in visible) {
      final p = b['parent_id'] != null && ids.contains(b['parent_id']) ? b['parent_id'] : null;
      kids.putIfAbsent(p, () => []).add(b);
    }
    const order = ['rack', 'shelf', 'bin'];
    final out = <(Json, int)>[];
    void walk(Object? parent, int depth) {
      final list = (kids[parent] ?? [])
        ..sort((a, b) {
          final t = order.indexOf(a['bin_type']).compareTo(order.indexOf(b['bin_type']));
          return t != 0 ? t : a['code'].toString().compareTo(b['code'].toString());
        });
      for (final b in list) {
        out.add((b, depth));
        walk(b['id'], depth + 1);
      }
    }

    walk(null, 0);
    return out;
  }

  Future<void> _form({Json? bin, String type = 'bin', Json? parent}) async {
    String binType = bin?['bin_type']?.toString() ?? type;
    int? parentId = toInt(bin?['parent_id']) ?? toInt(parent?['id']);
    final code = TextEditingController(text: bin?['code']?.toString() ?? (parent != null ? '${parent['code']}-' : ''));
    final name = TextEditingController(text: bin?['name']?.toString() ?? '');
    final store = _locations.firstWhere((l) => toInt(l['id']) == _loc, orElse: () => {});
    final ok = await showFormSheet(
      context,
      title: '${bin != null ? 'Edit' : 'Add'} ${_binTypeLabel[binType]}',
      builder: (ctx, setS) {
        final parents = _bins
            .where((b) => b['is_active'] == true && b['id'] != bin?['id'] && (_binParents[binType] ?? const []).contains(b['bin_type']))
            .toList();
        return [
          Hint('Store: ${txt(store['name'])} — a bin belongs to this store only.'),
          const FormHeading('Position'),
          AppSelect<String>(
            label: 'Type',
            required: true,
            value: binType,
            options: [for (final e in _binTypeLabel.entries) Option(e.key, e.value)],
            onChanged: (o) => setS(() {
              binType = o?.value ?? binType;
              final p = _byId(parentId);
              if (p == null || !(_binParents[binType] ?? const []).contains(p['bin_type'])) parentId = null;
            }),
          ),
          if (binType != 'rack')
            AppSelect<int>(
              label: binType == 'shelf' ? 'In rack' : 'In rack / shelf (none = directly in the store)',
              required: binType == 'shelf',
              value: parentId,
              options: [
                for (final p in parents)
                  Option(toInt(p['id'])!, '${_binTypeLabel[p['bin_type']]} ${p['code']}${p['name'] != null ? ' — ${p['name']}' : ''}'),
              ],
              onChanged: (o) => setS(() => parentId = o?.value),
            ),
          const FormHeading('Identification'),
          AppTextField(label: 'Code', required: true, controller: code, hint: _binCodeHint[binType]),
          AppTextField(label: 'Name / Description', controller: name, hint: 'Fasteners, top shelf…'),
        ];
      },
      onSave: () async {
        if (code.text.trim().isEmpty) throw 'Code is required — e.g. ${_binCodeHint[binType]}.';
        if (binType == 'shelf' && parentId == null) throw 'A shelf must sit in a rack — pick the rack.';
        final payload = {
          'bin_type': binType,
          'parent_id': parentId,
          'code': code.text.trim().toUpperCase(),
          'name': blankToNull(name.text),
        };
        if (bin != null) {
          await Api.patch('/store/bins/${bin['id']}', data: payload);
        } else {
          await Api.post('/store/bins', data: {...payload, 'location_id': _loc});
        }
      },
    );
    if (ok) _load();
  }

  Future<void> _move(String mode, List<Json> sources, Json? to) async {
    final live = sources.where((r) => numOr0(r['quantity']) > 0).toList();
    String rk(Json r) => '${r['item_id']}-${r['bin_id'] ?? 'u'}';
    String? src = live.length == 1 ? rk(live.first) : null;
    int? toBin = toInt(to?['id']);
    final qty = TextEditingController(text: live.length == 1 ? '${live.first['quantity']}' : '');
    final remarks = TextEditingController();
    Json? moved;
    Json? from() {
      for (final r in live) {
        if (rk(r) == src) return r;
      }
      return null;
    }

    final ok = await showFormSheet(
      context,
      title: mode == 'putaway' ? 'Put away${to != null ? ' into ${to['code']}' : ' into a bin'}' : 'Move from ${txt(live.isEmpty ? null : live.first['bin_code'])}',
      saveLabel: 'Move',
      builder: (ctx, setS) => [
        const FormHeading('Item'),
        AppSelect<String>(
          label: mode == 'putaway' ? 'Unassigned item' : 'Item in this bin',
          required: true,
          value: src,
          options: [
            for (final r in live) Option(rk(r), '${txt(r['item_code'])} — ${txt(r['item_name'])} (${fmtQ(r['quantity'], r['uom'])})'),
          ],
          onChanged: (o) => setS(() {
            src = o?.value;
            qty.text = from() == null ? '' : '${from()!['quantity']}';
          }),
        ),
        const FormHeading('Destination'),
        AppSelect<int>(
          label: mode == 'move' ? 'To bin (blank = Unassigned, take out of the bin)' : 'To bin',
          required: mode == 'putaway',
          enabled: to == null,
          value: toBin,
          options: [
            for (final b in _bins)
              if (b['is_active'] == true && b['id'] != from()?['bin_id'])
                Option(toInt(b['id'])!, '${_binTypeLabel[b['bin_type']]} ${b['code']}${b['name'] != null ? ' — ${b['name']}' : ''}'),
          ],
          onChanged: (o) => setS(() => toBin = o?.value),
        ),
        AppTextField(label: 'Quantity', required: true, controller: qty, keyboardType: AppTextField.number),
        const Hint("Moves stock inside this store only — bins of other stores can't be picked."),
        const FormHeading('Remarks'),
        AppTextField(label: 'Remarks', controller: remarks, hint: 'Why it is moved (re-slotting, rack repair…)'),
      ],
      onSave: () async {
        final f = from();
        if (f == null) throw mode == 'putaway' ? 'Pick the item to put away.' : 'Pick the item to move.';
        if (mode == 'putaway' && toBin == null) throw 'Pick the bin to put the item into.';
        final q = parseNum(qty.text) ?? 0;
        if (q <= 0) throw 'Enter the quantity to move — more than 0.';
        if (q > numOr0(f['quantity'])) {
          throw 'Only ${fmtQ(f['quantity'], f['uom'])} is in ${f['bin_code'] ?? 'Unassigned'} — enter that much or less.';
        }
        if (toBin == toInt(f['bin_id'])) throw 'Pick a different destination bin.';
        moved = jsonMap(await Api.post('/store/bin-stock/moves', data: {
          'item_id': f['item_id'],
          'location_id': f['location_id'],
          'from_bin_id': f['bin_id'],
          'to_bin_id': toBin,
          'quantity': q,
          'remarks': blankToNull(remarks.text),
        }));
      },
    );
    if (ok && mounted && moved != null) {
      showSnack(context,
          '${txt(moved!['move_number'])}: ${fmtQ(moved!['quantity'], moved!['uom'])} moved ${moved!['from_bin_code'] ?? 'Unassigned'} → ${moved!['to_bin_code'] ?? 'Unassigned'}.');
      _load();
    }
  }

  Future<void> _binAction(String a, Json b, List<Json> rows, List<Json> unassignedAll) async {
    switch (a) {
      case 'putaway':
        return _move('putaway', unassignedAll, b);
      case 'move':
        return _move('move', rows, null);
      case 'shelf':
        return _form(type: 'shelf', parent: b);
      case 'bin':
        return _form(type: 'bin', parent: b);
      case 'edit':
        return _form(bin: b);
      case 'toggle':
        final ok = await runAction(context, () => Api.patch('/store/bins/${b['id']}', data: {'is_active': b['is_active'] != true}));
        if (ok) _load();
        return;
      case 'delete':
        final ok = await confirmDialog(context,
            title: "Delete ${_binTypeLabel[b['bin_type']]!.toLowerCase()} '${b['code']}'?",
            message: 'Only a bin that never held stock can be deleted. One that was used can be deactivated instead, once it is empty.',
            confirmLabel: 'Delete',
            danger: true);
        if (!ok || !mounted) return;
        final done = await runAction(context, () => Api.delete('/store/bins/${b['id']}'));
        if (done) _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = can('bins', 'create');
    final canEdit = can('bins', 'edit');
    final canDel = can('bins', 'delete');
    final canMove = canFeature('transfers', 'bin_moves', 'create');
    final sb = _stockByBin;
    final tree = _loc == null ? <(Json, int)>[] : _tree(sb);
    final unassigned = sb[0] ?? const <Json>[];
    final unassignedAll = _stock.where((r) => r['bin_id'] == null && numOr0(r['quantity']) > 0).toList();
    int count(String t) => _bins.where((b) => b['is_active'] == true && b['bin_type'] == t).length;
    final store = _locations.firstWhere((l) => toInt(l['id']) == _loc, orElse: () => {});
    bool isOpen(int k) => _search.trim().isNotEmpty || _open.contains(k);

    Widget holding(int k, List<Json> rows, bool isBin) => rows.isEmpty
        ? Text(isBin ? 'Empty' : '—', style: const TextStyle(fontSize: 12.5, color: Brand.muted))
        : InkWell(
            onTap: () => setState(() => _open.contains(k) ? _open.remove(k) : _open.add(k)),
            child: Text('${isOpen(k) ? '▾' : '▸'} ${rows.length} item${rows.length > 1 ? 's' : ''}',
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFFC2410C))),
          );
    List<Widget> stockRows(List<Json> rows) => [
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(children: [
                Expanded(child: Text('${txt(r['item_code'])} — ${txt(r['item_name'])}', style: const TextStyle(fontSize: 12.5))),
                Text(fmtQ(r['quantity'], r['uom']),
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: numOr0(r['quantity']) < 0 ? cRed : Brand.body)),
              ]),
            ),
        ];

    return Scaffold(
      floatingActionButton: canCreate
          ? CreateFab(
              label: 'Add',
              onPressed: () => _loc == null
                  ? showSnack(context, 'Pick the store first — racks and bins belong to one store.', error: true)
                  : _form(type: count('rack') > 0 ? 'bin' : 'rack'))
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
          StorePageHeader('Bins',
              subtitle:
                  'Racks, shelves and bins inside each store, and what each bin holds. Every bin belongs to one store only — put away on the GRN, pick on the issue / transfer, move between bins here.',
              actions: [
                if (_loc != null && can('stock', 'export'))
                  PillButton('Export Excel',
                      icon: Icons.download_rounded,
                      onPressed: () => openApiFile(context, '/store/bin-stock/export', 'stock_by_bin.xlsx', query: {'location_id': _loc})),
              ]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              AppSelect<int>(
                label: '— Pick a store —',
                value: _loc,
                options: [
                  for (final l in _locations)
                    Option(toInt(l['id'])!, '${txt(l['name'])}${l['code'] != null ? ' (${l['code']})' : ''}'),
                ],
                onChanged: (o) => _pick(o?.value),
              ),
              if (_loc != null) ...[
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: SearchField(hint: 'Find an item — code or name', onChanged: (v) => setState(() => _search = v))),
                  const SizedBox(width: 8),
                  FilterButton(
                    active: countSet([_type, _inactive]),
                    onClear: () => setState(() {
                      _type = null;
                      _inactive = false;
                    }),
                    builder: (ctx, setS) => [
                      AppSelect<String>(
                        label: 'Racks, shelves & bins',
                        value: _type,
                        options: const [Option('rack', 'Racks only'), Option('shelf', 'Shelves only'), Option('bin', 'Bins only')],
                        onChanged: (o) {
                          setState(() => _type = o?.value);
                          setS(() {});
                        },
                      ),
                      CheckField(
                          label: 'Show inactive',
                          value: _inactive,
                          onChanged: (v) {
                            setState(() => _inactive = v);
                            setS(() {});
                          }),
                    ],
                  ),
                ]),
                const SizedBox(height: 6),
                Hint('${count('rack')} racks · ${count('shelf')} shelves · ${count('bin')} bins'),
              ],
            ]),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: ErrorBanner(_error!)),
          if (_loc == null) const EmptyView('Pick a store to see its bins and what they hold.'),
          if (_loc != null && _loading) const LoadingView(),
          if (_loc != null && !_loading && unassigned.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      const Expanded(
                          child: Text('Unassigned', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.heading))),
                      pill('No bin', cAmber),
                    ]),
                    const Hint('In the store but not put away in any bin'),
                    const SizedBox(height: 4),
                    Row(children: [
                      holding(0, unassigned, true),
                      const Spacer(),
                      if (canMove) TextButton(onPressed: () => _move('putaway', unassignedAll, null), child: const Text('Put away')),
                    ]),
                    if (isOpen(0)) ...stockRows(unassigned),
                  ]),
                ),
              ),
            ),
          if (_loc != null && !_loading && tree.isEmpty)
            EmptyView(_search.trim().isNotEmpty
                ? "No bin in ${store['name'] ?? 'this store'} holds an item matching '${_search.trim()}'."
                : 'No bins in ${store['name'] ?? 'this store'} yet.${canCreate ? ' Use + Add: start with a rack, add shelves to it, then bins — or add bins directly for a small store.' : ''}'),
          if (_loc != null && !_loading)
            for (final (b, depth) in tree)
              () {
                final id = toInt(b['id'])!;
                final rows = sb[id] ?? const <Json>[];
                final active = b['is_active'] == true;
                final actions = <(String, String)>[
                  if (canMove && active && unassignedAll.isNotEmpty) ('putaway', 'Put away'),
                  if (canMove && rows.any((r) => numOr0(r['quantity']) > 0)) ('move', 'Move'),
                  if (canCreate && active && b['bin_type'] == 'rack') ('shelf', '+ Shelf'),
                  if (canCreate && active && b['bin_type'] != 'bin') ('bin', '+ Bin'),
                  if (canEdit) ('edit', 'Edit'),
                  if (canEdit) ('toggle', active ? 'Deactivate' : 'Reactivate'),
                  if (canDel) ('delete', 'Delete'),
                ];
                return Opacity(
                  opacity: active ? 1 : 0.55,
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(16.0 + depth * 14, 0, 16, 8),
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(12, 8, 4, 10),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            if (depth > 0) const Text('└ ', style: TextStyle(color: Brand.muted)),
                            Text(txt(b['code']), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
                            const SizedBox(width: 8),
                            pill(_binTypeLabel[b['bin_type']] ?? txt(b['bin_type']), _binTypeColor[b['bin_type']] ?? cGrey),
                            const SizedBox(width: 6),
                            pill(active ? 'Active' : 'Inactive', active ? cGreen : cGrey),
                            const Spacer(),
                            if (actions.isNotEmpty)
                              PopupMenuButton<String>(
                                tooltip: 'Actions',
                                onSelected: (a) => _binAction(a, b, rows, unassignedAll),
                                itemBuilder: (_) => [for (final (k, l) in actions) PopupMenuItem(value: k, child: Text(l))],
                              ),
                          ]),
                          if (b['name'] != null) Text(txt(b['name']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                          const SizedBox(height: 4),
                          holding(id, rows, b['bin_type'] == 'bin'),
                          if (rows.isNotEmpty && isOpen(id)) ...stockRows(rows),
                        ]),
                      ),
                    ),
                  ),
                );
              }(),
          if (_loc != null) ...[
            const Padding(padding: EdgeInsets.fromLTRB(16, 12, 16, 8), child: Caps('Moves & Put-aways')),
            if (_movesError != null) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: ErrorBanner(_movesError!)),
            if (_movesError == null && _moves.isEmpty)
              EmptyView('No bin moves or put-aways in ${store['name'] ?? 'this store'} yet.'),
            for (final m in _moves)
              RecordCard(
                code: txt(m['move_number']),
                title: '${txt(m['item_code'])} — ${txt(m['item_name'])}',
                subtitle: '${m['from_bin_code'] ?? 'Unassigned'} → ${m['to_bin_code'] ?? 'Unassigned'}',
                trailing: pill(m['from_bin_code'] == null ? 'Put away' : (m['to_bin_code'] != null ? 'Move' : 'Taken out'),
                    m['from_bin_code'] == null ? cGreen : const Color(0xFF0891B2)),
                meta: [
                  ('Date', fmtDate(m['move_date'])),
                  ('Quantity', fmtQ(m['quantity'], m['uom'])),
                  ('By', txt(m['created_by_name'])),
                  if (m['remarks'] != null) ('Remarks', txt(m['remarks'])),
                ],
              ),
          ],
        ]),
      ),
    );
  }
}

// ── Serial numbers ───────────────────────────────────────────────────────────

const _serialColor = {
  'quality': cAmber,
  'in_stock': cGreen,
  'blocked': cRed,
  'in_transit': cBlue,
  'issued': cPurple,
  'returned_to_vendor': Color(0xFF6B7280),
  'cancelled': Color(0xFF9CA3AF),
};

Future<ApiPage> _pagedWithTotal(String path, Map<String, dynamic> query) async {
  final clean = <String, dynamic>{};
  query.forEach((k, v) {
    if (v != null && !(v is String && v.isEmpty)) clean[k] = v;
  });
  final r = await Api.dio.get(path, queryParameters: clean);
  final page = ApiPage.from(r.data);
  return ApiPage(page.rows, total: int.tryParse(r.headers.value('x-total-count') ?? ''));
}

class SerialsTab extends StatefulWidget {
  const SerialsTab({super.key});

  @override
  State<SerialsTab> createState() => _SerialsTabState();
}

class _SerialsTabState extends State<SerialsTab> {
  final _list = GlobalKey<ApiListViewState>();
  List<Json> _statuses = const [];
  String? _status;
  int? _loc;
  int? _total;
  bool _filtered = false;

  @override
  void initState() {
    super.initState();
    Api.list('/store/serials/statuses').then((p) {
      if (mounted) setState(() => _statuses = p.rows);
    }, onError: (Object _) {});
  }

  @override
  Widget build(BuildContext context) => ApiListView(
        key: _list,
        paged: true,
        pageSize: 100,
        searchHint: 'Serial no., item, vendor, issued to…',
        load: (page, q) async {
          _filtered = q.isNotEmpty || _status != null || _loc != null;
          final p = await _pagedWithTotal('/store/serials',
              {'q': q, 'status': _status, 'location_id': _loc, 'skip': (page - 1) * 100, 'limit': 100});
          if (page == 1 && mounted) setState(() => _total = p.total);
          return p;
        },
        emptyText: _filtered
            ? 'No serial numbers match these filters.'
            : 'No serial numbers yet — units are added when a GRN receives an item with “Serial numbers” ticked in the Item Master.',
        header: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Hint("Engines, pumps, gearboxes, PLCs… every unit of an item with 'Serial numbers' ticked in the Item Master."),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: Hint(_total == null ? '' : '${fmtQ(_total)} unit${_total == 1 ? '' : 's'}')),
              FilterButton(
                active: countSet([_status, _loc]),
                onClear: () {
                  setState(() {
                    _status = null;
                    _loc = null;
                  });
                  _list.currentState?.reload();
                },
                builder: (ctx, setS) => [
                  AppSelect<String>(
                    label: 'All statuses',
                    value: _status,
                    options: valueLabelOptions(_statuses),
                    onChanged: (o) {
                      setState(() => _status = o?.value);
                      setS(() {});
                      _list.currentState?.reload();
                    },
                  ),
                  LocationSelect(
                    label: 'All stores',
                    required: false,
                    value: _loc,
                    onChanged: (l) {
                      setState(() => _loc = toInt(l?['id']));
                      setS(() {});
                      _list.currentState?.reload();
                    },
                  ),
                ],
              ),
            ]),
          ]),
        ),
        itemBuilder: (ctx, r, reload) => RecordCard(
          code: txt(r['serial_no']),
          title: '${txt(r['item_code'])} — ${txt(r['item_name'])}',
          trailing: pill(r['status_label']?.toString() ?? humanize(r['status']), _serialColor[r['status']] ?? cGrey),
          meta: [
            ('Store / bin', '${txt(r['location_name'])}${r['bin_code'] != null ? ' · ${r['bin_code']}' : ''}'),
            ('From (GRN · vendor)', '${txt(r['grn_number'])}${r['vendor_name'] != null ? ' · ${r['vendor_name']}' : ''}'),
            ('Issued to', txt(r['issued_to'] ?? r['issue_number'])),
            ('Supplier warranty', fmtDate(r['vendor_warranty_until'])),
            if (r['on_transfer'] == true) ('Note', 'on transfer'),
          ],
          onTap: () => openThen(ctx, SerialDetailScreen(serialId: toInt(r['id'])!), reload),
        ),
      );
}

class SerialDetailScreen extends StatefulWidget {
  const SerialDetailScreen({super.key, required this.serialId});
  final int serialId;

  @override
  State<SerialDetailScreen> createState() => _SerialDetailScreenState();
}

class _SerialDetailScreenState extends State<SerialDetailScreen> {
  int _v = 0;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        key: ValueKey(_v),
        load: () async => jsonMap(await Api.get('/store/serials/${widget.serialId}')),
        builder: (ctx, d, reload) {
          final canDecide = d['status'] == 'quality' && canFeature('grn', 'inspection', 'approve');
          Future<void> decide(String to) async {
            final reason = await promptDialog(ctx,
                title: to == 'in_stock' ? 'Release this unit to stock?' : 'Block this unit?',
                message: 'Say which inspection lot / result this comes from — it is kept in the serial history.',
                confirmLabel: to == 'in_stock' ? 'Release to stock' : 'Block');
            if (reason == null || !ctx.mounted) return;
            final ok = await runAction(ctx,
                () => Api.post('/store/serials/${d['id']}/quality-result', data: {'status': to, 'reason': reason}));
            if (ok) setState(() => _v++);
          }

          return SubPage(
            title: txt(d['serial_no']),
            bottom: canDecide
                ? ActionBar([
                    secondaryAction('Block', () => decide('blocked'), color: cRed),
                    primaryAction('Release to stock', () => decide('in_stock')),
                  ])
                : null,
            body: detailList([
              SummaryCard(
                title: txt(d['serial_no']),
                text: '${txt(d['item_code'])} — ${txt(d['item_name'])}',
                badges: [pill(d['status_label']?.toString() ?? humanize(d['status']), _serialColor[d['status']] ?? cGrey)],
              ),
              DetailSection('Details', children: [
                FieldRow('GRN', d['grn_number']),
                FieldRow('Vendor', d['vendor_name']),
                FieldRow('Received on', d['received_date'] == null ? null : fmtDate(d['received_date'])),
                FieldRow('Supplier warranty until', d['vendor_warranty_until'] == null ? null : fmtDate(d['vendor_warranty_until'])),
                if (d['issue_number'] != null) FieldRow('Issue', d['issue_number']),
                if (d['issued_to'] != null) FieldRow('Issued to', d['issued_to']),
              ]),
              DetailSection('Serial History', children: [
                if (jsonList(d['history']).isEmpty) const Hint('No history recorded for this unit yet.'),
                for (final h in jsonList(d['history']))
                  LineTile(
                    title: humanize(h['event']),
                    subtitle: '${fmtDate(h['event_date'])} · ${txt(h['location_name'])}${h['bin_code'] != null ? ' · ${h['bin_code']}' : ''}',
                    extra: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: pill(h['to_status_label']?.toString() ?? humanize(h['to_status']), _serialColor[h['to_status']] ?? cGrey),
                    ),
                    facts: [
                      MiniFact('Document', txt(h['reference_number'])),
                      MiniFact('By', txt(h['created_by_name'])),
                      if (h['remarks'] != null) MiniFact('Remarks', txt(h['remarks'])),
                    ],
                  ),
              ]),
            ]),
          );
        },
      );
}

// ── Movements (stock ledger) ─────────────────────────────────────────────────

const _movementLabels = {
  'receipt': 'Receipt',
  'issue': 'Issue',
  'return_in': 'Return (in)',
  'return_out': 'Return (out)',
  'transfer_in': 'Transfer In',
  'transfer_out': 'Transfer Out',
  'adjustment_in': 'Adjustment (+)',
  'adjustment_out': 'Adjustment (-)',
  'damage': 'Damage',
  'manual_in': 'Stock in',
  'manual_out': 'Stock out',
  'quarantine_in': 'Quarantine (in)',
  'quarantine_out': 'Quarantine (out)',
  'quality_in': 'GRN into Quality',
  'quality_release': 'Quality → Free',
  'quality_block': 'Quality → Blocked',
  'blocked_release': 'Blocked → Free',
  'blocked_to_quality': 'Blocked → Quality',
  'free_block': 'Free → Blocked',
  'quality_hold': 'Free → Quality',
  'jobwork_out': 'Job work out',
  'jobwork_in': 'Job work back',
  'jobwork_to_quality': 'Job work → Quality',
  'jobwork_to_blocked': 'Job work → Blocked',
  'jobwork_consume': 'Job work consumed',
};
const _refLabels = {
  'p2p_request': 'PR',
  'grn': 'GRN',
  'material_issue': 'Issue',
  'material_return': 'Return',
  'quarantine': 'Quarantine',
  'stock_adjustment': 'Adjustment',
  'stock_transfer': 'Transfer',
  'stock_entry': 'Entry',
  'maintenance_work_order': 'Work Order',
};
const _inbound = {'receipt', 'return_in', 'transfer_in', 'adjustment_in', 'manual_in'};
const _outbound = {'issue', 'return_out', 'transfer_out', 'adjustment_out', 'damage', 'manual_out'};

class MovementsTab extends StatefulWidget {
  const MovementsTab({super.key});

  @override
  State<MovementsTab> createState() => _MovementsTabState();
}

class _MovementsTabState extends State<MovementsTab> {
  final _list = GlobalKey<ApiListViewState>();
  String _tab = 'all';
  int? _loc;
  String? _category;
  DateTime? _from;
  DateTime? _to;
  String? _type;
  final _ref = TextEditingController();
  final _vendor = TextEditingController();
  int? _user;
  List<Json> _users = const [];
  List<String> _cats = const [];
  int? _total;

  @override
  void initState() {
    super.initState();
    Api.list('/store/stock/transactions/posted-by').then((p) {
      if (mounted) setState(() => _users = p.rows);
    }, onError: (Object _) {});
    StoreData.items().then((rows) {
      if (mounted) {
        setState(() => _cats = {for (final i in rows) if (i['category'] != null) i['category'].toString()}.toList()..sort());
      }
    }, onError: (Object _) {});
  }

  Map<String, dynamic> get _server => {
        'location_id': _loc,
        'transaction_type': _type ?? (_tab == 'receipts' ? 'receipt' : (_tab == 'issues' ? 'issue' : null)),
        'date_from': _from == null ? null : apiDate(_from!),
        'date_to': _to == null ? null : apiDate(_to!),
        'reference_number': _ref.text.trim(),
        'created_by_id': _user,
        'vendor_name': _vendor.text.trim(),
      };

  void _reload() => _list.currentState?.reload();

  @override
  Widget build(BuildContext context) => ApiListView(
        key: _list,
        paged: true,
        pageSize: 200,
        searchHint: 'Search item, store, vendor, invoice / doc no., batch…',
        load: (page, q) async {
          // Free-text search runs on the rows, like the portal; with a search
          // the whole filtered ledger (up to 2000 rows) is searched at once.
          final searching = q.isNotEmpty || _category != null;
          final p = await _pagedWithTotal('/store/stock/transactions', {
            ..._server,
            'skip': searching ? 0 : (page - 1) * 200,
            'limit': searching ? 2000 : 200,
          });
          if (page == 1 && mounted) setState(() => _total = p.total);
          if (!searching) return p;
          if (page > 1) return ApiPage(const []);
          final ql = q.toLowerCase();
          final rows = p.rows.where((t) {
            final it = StoreData.itemById[toInt(t['item_id'])];
            if (_category != null && it?['category'] != _category) return false;
            final hay = [t['item_code'], t['item_name'], t['location_name'], t['vendor_name'], t['reference_number'], t['batch_number'], it?['category']]
                .where((x) => x != null)
                .join(' ')
                .toLowerCase();
            return ql.isEmpty || hay.contains(ql);
          }).toList();
          return ApiPage(rows, total: rows.length);
        },
        emptyText: 'No movements match these filters — clear a filter to see more. Movements appear here as GRNs, issues, transfers and adjustments are posted.',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          ChipRow([
            for (final (k, l) in [('all', 'All'), ('receipts', 'Receipts'), ('issues', 'Issues')])
              CountChip(l, _tab == k ? _total : null, selected: _tab == k, onTap: () {
                setState(() => _tab = k);
                _reload();
              }),
          ]),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              FilterButton(
                active: countSet([_loc, _category, _from, _to, _type, _ref.text.trim(), _vendor.text.trim(), _user]),
                onClear: () {
                  setState(() {
                    _loc = null;
                    _category = null;
                    _from = null;
                    _to = null;
                    _type = null;
                    _user = null;
                    _ref.clear();
                    _vendor.clear();
                  });
                  _reload();
                },
                builder: (ctx, setS) {
                  void upd(VoidCallback f) {
                    setState(f);
                    setS(() {});
                    _reload();
                  }

                  return [
                    LocationSelect(label: 'All stores', required: false, value: _loc, onChanged: (l) => upd(() => _loc = toInt(l?['id']))),
                    AppSelect<String>(
                      label: 'All categories',
                      value: _category,
                      options: [for (final c in _cats) Option(c, c)],
                      onChanged: (o) => upd(() => _category = o?.value),
                    ),
                    Row(children: [
                      Expanded(child: DateField(label: 'From date', value: _from, onChanged: (d) => upd(() => _from = d))),
                      const SizedBox(width: 8),
                      Expanded(child: DateField(label: 'To date', value: _to, onChanged: (d) => upd(() => _to = d))),
                    ]),
                    AppSelect<String>(
                      label: 'All movement types',
                      value: _type,
                      options: [for (final e in _movementLabels.entries) Option(e.key, e.value)],
                      onChanged: (o) => upd(() => _type = o?.value),
                    ),
                    AppTextField(label: 'Document / reference no.', controller: _ref, onChanged: (_) => upd(() {})),
                    AppTextField(label: 'Vendor', controller: _vendor, onChanged: (_) => upd(() {})),
                    AppSelect<int>(
                      label: 'All users',
                      value: _user,
                      options: idLabelOptions(_users),
                      onChanged: (o) => upd(() => _user = o?.value),
                    ),
                  ];
                },
              ),
              if (can('movements', 'export'))
                PillButton('Export Excel',
                    icon: Icons.download_rounded,
                    onPressed: () => openApiFile(context, '/store/stock/transactions/export', 'stock_movements_${todayIso()}.xlsx',
                        query: _server)),
              if (_total != null) Hint('${fmtQ(_total)} movement${_total == 1 ? '' : 's'}'),
            ]),
          ),
        ]),
        itemBuilder: (ctx, t, reload) {
          final type = t['transaction_type']?.toString() ?? '';
          final sign = _inbound.contains(type) ? '+' : (_outbound.contains(type) ? '−' : '');
          final color = sign == '+' ? const Color(0xFF15803D) : (sign == '−' ? const Color(0xFFB91C1C) : Brand.muted);
          final ref = t['reference_number'];
          return RecordCard(
            code: fmtDate(t['transaction_date']),
            title: '${txt(t['item_code'])} — ${txt(t['item_name'])}',
            subtitle: '${txt(t['location_name'])}${t['bin_code'] != null ? ' · Bin ${t['bin_code']}' : ''}',
            trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              pill(t['entry_type_label']?.toString() ?? _movementLabels[type] ?? humanize(type), color),
              const SizedBox(height: 4),
              Text('$sign${fmtQ(t['quantity'])}', style: TextStyle(fontWeight: FontWeight.w700, color: color)),
            ]),
            meta: [
              ('Value', t['value'] != null ? fmtMoney(t['value']) : '—'),
              ('Batch', txt(t['batch_number'])),
              ('Vendor', txt(t['vendor_name'])),
              ('Invoice / Document',
                  ref == null ? '—' : '${_refLabels[t['reference_type']] != null ? '${_refLabels[t['reference_type']]} ' : ''}$ref${t['reference_type'] == 'stock_entry' ? ' 📎' : ''}'),
              ('By', txt(t['created_by_name'])),
            ],
            onTap: t['reference_type'] == 'stock_entry' && ref != null
                ? () => openScreen(ctx, StockEntryScreen(entryNumber: ref.toString()))
                : null,
          );
        },
      );
}

/// One old manual stock entry (SE-…) with its documents (portal StockEntryDialog).
class StockEntryScreen extends StatefulWidget {
  const StockEntryScreen({super.key, required this.entryNumber});
  final String entryNumber;

  @override
  State<StockEntryScreen> createState() => _StockEntryScreenState();
}

class _StockEntryScreenState extends State<StockEntryScreen> {
  int _v = 0;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        key: ValueKey(_v),
        load: () async => jsonMap(await Api.get('/store/stock/entries/by-number/${Uri.encodeComponent(widget.entryNumber)}')),
        builder: (ctx, e, reload) => SubPage(
          title: widget.entryNumber,
          bottom: can('adjustments', 'create')
              ? ActionBar([
                  primaryAction('Attach document', () async {
                    final r = await pickAndUpload(ctx, '/store/stock/entries/${e['id']}/attachments', field: 'files');
                    if (r != null) setState(() => _v++);
                  }),
                ])
              : null,
          body: detailList([
            SummaryCard(
              title: widget.entryNumber,
              text: [e['entry_type_label'] ?? humanize(e['entry_type']), e['location_name']].where((x) => x != null).join(' · '),
              meta: [fmtDate(e['entry_date'] ?? e['transaction_date']), if (e['created_by_name'] != null) 'By ${e['created_by_name']}'],
            ),
            DetailSection('Entry', children: [
              for (final k in ['vendor_name', 'reference_number', 'remarks'])
                if (e[k] != null) FieldRow(humanize(k), e[k]),
            ]),
            DetailSection('Lines', children: [
              for (final l in jsonList(e['lines'] ?? e['items']))
                LineTile(
                  title: '${txt(l['item_code'])} — ${txt(l['item_name'])}',
                  trailing: fmtQ(l['quantity'], l['uom']),
                  facts: [
                    if (l['batch_number'] != null) MiniFact('Batch', txt(l['batch_number'])),
                    if (seeValues && l['value'] != null) MiniFact('Value', fmtMoney(l['value'])),
                  ],
                ),
            ]),
            DetailSection('Documents', children: [
              if (jsonList(e['attachments']).isEmpty) const Hint('No documents attached. Documents can be added later but never removed.'),
              for (final a in jsonList(e['attachments']))
                LineTile(
                  title: txt(a['filename'] ?? a['file_name']),
                  subtitle: [a['uploaded_by_name'], a['created_at'] == null ? null : fmtDateTime(a['created_at'])].where((x) => x != null).join(' · '),
                  onTap: () => openApiFile(ctx, '/store/stock/entries/${e['id']}/attachments/${a['id']}',
                      (a['filename'] ?? a['file_name'] ?? 'document').toString()),
                ),
            ]),
          ]),
        ),
      );
}
