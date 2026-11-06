import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';

// Item Rates (portal app/dashboard/p2p/info-records): pick an item, see who
// supplies it and at what rate; rate contracts and approved vendors.

const _sourceLabel = {'contract': 'rate contract', 'quote': 'quotation', 'last_po': 'last PO'};
const _green = Color(0xFF15803D);

class ItemRatesTab extends StatefulWidget {
  const ItemRatesTab({super.key});

  @override
  State<ItemRatesTab> createState() => _ItemRatesTabState();
}

class _ItemRatesTabState extends State<ItemRatesTab> {
  List<Json> _items = [];
  List<Json> _vendors = [];
  List<Json> _unlinked = [];
  int? _itemId;
  String? _itemLabel;
  Json? _ov;
  bool _loading = false;
  String _error = '';
  String? _view; // contract | approved
  bool _showHistory = true;
  bool _showUnlinked = false;
  final _linkPick = <int, int>{};

  bool get _seeInfo => !P2pAccess.can('vendors', 'view') || P2pAccess.feat('vendors', 'info_records', 'view');
  bool get _canEdit => P2pAccess.can('vendors', 'edit') && P2pAccess.feat('vendors', 'info_records', 'edit');

  @override
  void initState() {
    super.initState();
    loadActiveItems().then((v) {
      if (mounted) setState(() => _items = v);
    }).catchError((_) {});
    loadActiveVendors().then((v) {
      if (mounted) setState(() => _vendors = v);
    }).catchError((_) {});
    if (_seeInfo) {
      Api.get('/p2p/info-records', query: {'unlinked': true, 'limit': 2000}).then((v) {
        if (mounted) setState(() => _unlinked = asList(v));
      }).catchError((_) {});
    }
  }

  Future<void> _loadItem() async {
    if (_itemId == null) return;
    try {
      final ov = asJson(await Api.get('/p2p/info-records/item-overview', query: {'store_item_id': _itemId}));
      if (mounted) {
        setState(() {
          _ov = ov;
          _error = '';
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _run(Future<void> Function() fn, {String? success}) async {
    final ok = await runAction(context, fn, success: success);
    if (ok) _loadItem();
  }

  Future<void> _contract([Json? v]) async {
    final c = v?['contract'] is Map ? asJson(v!['contract']) : null;
    final id = c != null ? jInt(c, 'id') : jInt(v, 'record_id');
    int? vendorId = jInt(v, 'vendor_id');
    final price = TextEditingController(text: c?['unit_price'] != null ? '${c!['unit_price']}' : (v?['current_rate'] != null ? '${v!['current_rate']}' : ''));
    final lead = TextEditingController(
        text: c?['lead_time_days'] != null ? '${c!['lead_time_days']}' : (v?['lead_time_days'] != null && c == null ? '${v!['lead_time_days']}' : ''));
    final moq = TextEditingController(text: c?['min_order_qty'] != null ? '${c!['min_order_qty']}' : '');
    DateTime? from = parseDate(c?['valid_from']);
    DateTime? to = parseDate(c?['valid_to']);
    final ov = _ov!;
    final ok = await showFormSheet(context,
        title: c != null ? 'Edit rate contract' : 'Rate contract',
        builder: (ctx, setS) => [
              Hint('An agreed rate with a vendor (e.g. a yearly rate contract) for ${ov['item_code']}.'),
              const FormHeading('Vendor'),
              if (id != null)
                Text(jStr(v, 'vendor_name') ?? '', style: const TextStyle(fontWeight: FontWeight.w600))
              else
                AppSelect<int>(
                  label: 'Vendor',
                  required: true,
                  value: vendorId,
                  options: [for (final x in _vendors) Option(jInt(x, 'id')!, jStr(x, 'name') ?? '')],
                  onChanged: (o) => setS(() => vendorId = o?.value),
                ),
              const FormHeading('Rate & Terms'),
              AppTextField(label: 'Rate (₹)', required: true, controller: price, keyboardType: AppTextField.number),
              AppTextField(label: 'Lead days', controller: lead, keyboardType: TextInputType.number),
              AppTextField(label: 'MOQ', controller: moq, keyboardType: AppTextField.number),
              const FormHeading('Validity'),
              DateField(label: 'Valid from', value: from, onChanged: (d) => setS(() => from = d)),
              DateField(label: 'Valid to', value: to, onChanged: (d) => setS(() => to = d)),
              Hint('While valid, POs to this vendor for ${ov['item_code']} take this rate. Leave the dates empty for no end date.'),
            ],
        onSave: () async {
          final problems = <String>[];
          if (vendorId == null) problems.add('Pick the vendor.');
          if (!((double.tryParse(price.text) ?? 0) > 0)) problems.add('Enter the agreed rate.');
          if (problems.isNotEmpty) throw problems.join(' ');
          double? n(TextEditingController t) => t.text.trim().isEmpty ? null : double.tryParse(t.text.trim());
          final payload = {
            'unit_price': n(price),
            'lead_time_days': n(lead)?.toInt(),
            'min_order_qty': n(moq),
            'valid_from': from == null ? null : apiDate(from!),
            'valid_to': to == null ? null : apiDate(to!),
          };
          if (id != null) {
            await Api.patch('/p2p/info-records/$id', data: payload);
          } else {
            await Api.post('/p2p/info-records', data: {...payload, 'vendor_id': vendorId, 'store_item_id': _itemId});
          }
        });
    if (ok) _loadItem();
  }

  Future<void> _sources() async {
    final ov = _ov!;
    int? vendorId;
    DateTime? from;
    DateTime? to;
    var fixed = false;
    await showFormSheet(context,
        title: 'Approved vendors — ${ov['item_code']}',
        saveLabel: 'Close',
        builder: (ctx, setS) {
          final sources = jList(_ov, 'vendors').where((v) => v['source'] is Map).toList();
          return [
            const Hint('Optional. Once a vendor is listed, POs for this item can only go to a listed, unblocked vendor. Empty list = any vendor.'),
            const FormHeading('Approved list'),
            if (sources.isEmpty) const Text('No list — any vendor can be ordered from.'),
            for (final v in sources)
              Builder(builder: (_) {
                final s = asJson(v['source']);
                return InnerCard(children: [
                  Text('${v['vendor_name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                  if (s['valid_today'] != true && s['is_blocked'] != true) const Pill('Not valid today', Color(0xFFB45309)),
                  Hint(s['valid_from'] != null || s['valid_to'] != null
                      ? '${s['valid_from'] != null ? fmtDate(s['valid_from']) : '…'} to ${s['valid_to'] != null ? fmtDate(s['valid_to']) : '…'}'
                      : 'No end date'),
                  CheckField(
                      label: 'Preferred',
                      value: s['is_fixed'] == true,
                      onChanged: (x) async {
                        await _run(() => Api.patch('/p2p/info-records/source-list/${s['id']}', data: {'is_fixed': x}));
                        try {
                          setS(() {});
                        } catch (_) {}
                      }),
                  CheckField(
                      label: 'Blocked',
                      value: s['is_blocked'] == true,
                      onChanged: (x) async {
                        await _run(() => Api.patch('/p2p/info-records/source-list/${s['id']}', data: {'is_blocked': x}));
                        try {
                          setS(() {});
                        } catch (_) {}
                      }),
                  if (P2pAccess.can('vendors', 'delete') && P2pAccess.feat('vendors', 'info_records', 'delete'))
                    linkBtn('Remove', () async {
                      final yes = await confirmDialog(context,
                          title: 'Remove from approved vendors?',
                          message: '${v['vendor_name']} will no longer be an approved vendor for this item.',
                          confirmLabel: 'Remove',
                          danger: true);
                      if (!yes) return;
                      await _run(() => Api.delete('/p2p/info-records/source-list/${s['id']}'));
                      try {
                        setS(() {});
                      } catch (_) {}
                    }, color: Brand.danger),
                ]);
              }),
            const Hint('Preferred = first choice; Blocked = no new POs. Use it for critical items (e.g. RDSO-approved parts).'),
            const FormHeading('Add vendor'),
            AppSelect<int>(
              label: 'Vendor',
              required: true,
              value: vendorId,
              options: [for (final x in _vendors) Option(jInt(x, 'id')!, jStr(x, 'name') ?? '')],
              onChanged: (o) => setS(() => vendorId = o?.value),
            ),
            DateField(label: 'Valid from', value: from, onChanged: (d) => setS(() => from = d)),
            DateField(label: 'Valid to', value: to, onChanged: (d) => setS(() => to = d)),
            CheckField(label: 'Preferred', value: fixed, onChanged: (x) => setS(() => fixed = x)),
            primaryBtn('Add', vendorId == null
                ? null
                : () async {
                    await _run(() => Api.post('/p2p/info-records/source-list', data: {
                          'store_item_id': _itemId,
                          'vendor_id': vendorId,
                          'valid_from': from == null ? null : apiDate(from!),
                          'valid_to': to == null ? null : apiDate(to!),
                          'is_fixed': fixed,
                        }));
                    vendorId = null;
                    from = null;
                    to = null;
                    fixed = false;
                    try {
                      setS(() {});
                    } catch (_) {}
                  }),
          ];
        },
        onSave: () async {});
  }

  @override
  Widget build(BuildContext context) {
    final ov = _ov;
    final s = asJson(ov?['summary']);
    final vendors = jList(ov, 'vendors');
    final sources = vendors.where((v) => v['source'] is Map).toList();
    final shown = vendors.where((v) => _view == 'contract' ? v['contract'] is Map : _view == 'approved' ? v['source'] is Map : true).toList();
    final poPrices = vendors.map((v) => toDouble(asJson(v['last_po'])['unit_price'])).whereType<double>().toList();
    final qPrices = vendors.where((v) => asJson(v['last_quote'])['valid_today'] == true).map((v) => toDouble(asJson(v['last_quote'])['net_price'])).whereType<double>().toList();
    final lowPo = poPrices.isEmpty ? null : poPrices.reduce((a, b) => a < b ? a : b);
    final lowQ = qPrices.isEmpty ? null : qPrices.reduce((a, b) => a < b ? a : b);
    final history = jList(ov, 'history');
    return RefreshIndicator(
      onRefresh: _loadItem,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        const PageHeader('Item Rates'),
        if (ov != null)
          ChipStrip([
            CountChip('Vendors', s['vendor_count'] ?? vendors.length, selected: _view == null, color: const Color(0xFF3B82F6), onTap: () => setState(() => _view = null)),
            CountChip('Rate contracts', vendors.where((v) => v['contract'] is Map).length,
                selected: _view == 'contract', color: const Color(0xFFEA580C), onTap: () => setState(() => _view = _view == 'contract' ? null : 'contract')),
            CountChip('Approved vendors', sources.length,
                selected: _view == 'approved', color: const Color(0xFF16A34A), onTap: () => setState(() => _view = _view == 'approved' ? null : 'approved')),
            CountChip('PO lines', history.length, color: const Color(0xFFCA8A04), onTap: () => setState(() => _showHistory = true)),
          ]),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: AppSelect<int>(
            label: 'Item',
            value: _itemId,
            valueLabel: _itemLabel,
            options: [for (final i in _items) Option(jInt(i, 'id')!, itemLabel(i), subtitle: itemDetail(i))],
            onChanged: (o) {
              setState(() {
                _ov = null;
                _view = null;
                _itemId = o?.value;
                _itemLabel = o?.label;
                _loading = o != null;
              });
              _loadItem();
            },
          ),
        ),
        if (_error.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: NoteBox(_error, tone: NoteTone.error)),
        if (_canEdit && ov != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Wrap(spacing: 8, children: [
              primaryBtn('+ Rate contract', () => _contract()),
              secondaryBtn('Approved vendors (${sources.length})', _sources),
            ]),
          ),
        if (_itemId == null)
          EmptyView(
              'Pick an item above to see suppliers, rates and the last price paid.\n${_items.isNotEmpty ? '${fmtNumber(_items.length)} active items to choose from. ' : ''}'
              'Rates fill in automatically from approved POs and vendor quotations.',
              icon: Icons.search_rounded),
        if (_itemId != null && _loading && ov == null) const LoadingView(),
        if (ov != null) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Builder(builder: (_) {
                final lp = s['last_po'] is Map ? asJson(s['last_po']) : null;
                return Hint('Last bought at ${lp != null ? '${money(lp['unit_price'])} · ${lp['vendor_name']} · ${fmtDate(lp['po_date'])} · ${lp['po_number']}' : 'never on an approved PO'}');
              }),
              Builder(builder: (_) {
                final b = s['best_current'] is Map ? asJson(s['best_current']) : null;
                return Hint('Best rate today ${b != null ? '${money(b['rate'])} · ${b['vendor_name']} · from ${_sourceLabel[b['source']] ?? b['source']}' : 'no rate yet'}');
              }),
              if (s['lowest_po_price'] != null)
                Hint('PO rate range ${money(s['lowest_po_price'])} – ${money(s['highest_po_price'])}${s['avg_po_price'] != null ? ' (average ${money(s['avg_po_price'])})' : ''}'),
              Hint(s['has_source_list'] == true ? 'Approved-vendor list is ON' : 'Any vendor can be ordered from'),
            ]),
          ),
          DetailSection('Who supplies ${ov['item_code']} — ${ov['item_name']}', children: [
            const Hint('Cheapest current rate first. Green = lowest PO rate / lowest valid quote.'),
            const SizedBox(height: 8),
            if (vendors.isEmpty)
              const Text('No vendor has quoted or supplied this item yet. Rates appear here automatically once a vendor quotation is recorded on an RFQ '
                  'or a PO for this item is approved. Have an agreed rate already? Add it with + Rate contract.'),
            if (vendors.isNotEmpty && shown.isEmpty) const Text('No vendor matches this count for the item. Tap the Vendors count to show all.'),
            for (final v in shown) _vendorCard(v, lowPo, lowQ),
          ]),
          DetailSection('Purchase history (${history.length} approved PO line${history.length == 1 ? '' : 's'})',
              action: history.isNotEmpty ? linkBtn(_showHistory ? 'Hide' : 'Show', () => setState(() => _showHistory = !_showHistory), color: Brand.primaryActive) : null,
              children: [
                if (history.isEmpty) const Hint('No approved PO for this item yet — each approved PO line for it will be listed here.'),
                if (_showHistory)
                  for (final r in history)
                    InnerCard(children: [
                      Text('${r['po_number']}${(jInt(r, 'amendment_no') ?? 0) > 0 ? ' (A${r['amendment_no']})' : ''} · ${fmtDate(r['po_date'])}',
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      MiniGrid([
                        MiniField('Vendor', jStr(r, 'vendor_name')),
                        MiniField('Qty', '${fmtQty(r['quantity'])} ${jStr(r, 'unit') ?? ''}'),
                        MiniField('Rate', money(r['unit_price'])),
                        MiniField('GST %', r['tax_rate'] ?? '—'),
                        MiniField('PR No.', jStr(r, 'p2p_number')),
                      ]),
                    ]),
              ]),
        ],
        if (_unlinked.isNotEmpty && _canEdit)
          DetailSection('Old vendor catalog lines to link (${_unlinked.length})',
              action: linkBtn(_showUnlinked ? 'Hide' : 'Show', () => setState(() => _showUnlinked = !_showUnlinked), color: Brand.primaryActive),
              children: [
                const Hint("Typed by name before the Item Master — link each once to its item so its rate shows here. A link can't be changed later."),
                if (_showUnlinked)
                  for (final r in _unlinked)
                    InnerCard(children: [
                      Text('${r['item_name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      Hint('${jStr(r, 'vendor_name') ?? ''} · ${jStr(r, 'part_code') ?? '—'} · ${money(r['unit_price'])}'),
                      const SizedBox(height: 6),
                      AppSelect<int>(
                        label: 'Item Master item',
                        value: _linkPick[jInt(r, 'id')],
                        options: [for (final i in _items) Option(jInt(i, 'id')!, itemLabel(i))],
                        onChanged: (o) => setState(() {
                          if (o == null) {
                            _linkPick.remove(jInt(r, 'id'));
                          } else {
                            _linkPick[jInt(r, 'id')!] = o.value;
                          }
                        }),
                      ),
                      const SizedBox(height: 6),
                      secondaryBtn('Link', _linkPick[jInt(r, 'id')] == null
                          ? null
                          : () async {
                              final ok = await runAction(context,
                                  () => Api.post('/p2p/info-records/${r['id']}/link', data: {'store_item_id': _linkPick[jInt(r, 'id')]}),
                                  success: 'Linked.');
                              if (ok && mounted) setState(() => _unlinked.removeWhere((x) => jInt(x, 'id') == jInt(r, 'id')));
                            }),
                    ]),
              ]),
      ]),
    );
  }

  Widget _vendorCard(Json v, double? lowPo, double? lowQ) {
    final src = v['source'] is Map ? asJson(v['source']) : null;
    final blocked = src?['is_blocked'] == true;
    final lp = v['last_po'] is Map ? asJson(v['last_po']) : null;
    final lq = v['last_quote'] is Map ? asJson(v['last_quote']) : null;
    final c = v['contract'] is Map ? asJson(v['contract']) : null;
    final vs = jStr(v, 'vendor_status');
    return Opacity(
      opacity: blocked ? 0.55 : 1,
      child: InnerCard(children: [
        Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text(jStr(v, 'vendor_name') ?? '—', style: const TextStyle(fontWeight: FontWeight.w700)),
          if (src?['is_fixed'] == true) const Pill('Preferred', _green),
          if (src != null && src['is_fixed'] != true && !blocked) const Pill('Approved', Color(0xFF0891B2)),
          if (blocked) const Pill('Blocked', Color(0xFFB91C1C)),
          if (vs != null && vs != 'active') Pill(humanize(vs), const Color(0xFFB45309)),
        ]),
        const SizedBox(height: 6),
        MiniGrid([
          MiniField('Rate today',
              '${money(v['current_rate'])}${jStr(v, 'current_rate_source') != null ? ' from ${_sourceLabel[v['current_rate_source']]}' : ''}'),
          MiniField(
              'Last PO',
              lp == null
                  ? 'Never bought'
                  : Text('${money(lp['unit_price'])}\n${fmtDate(lp['po_date'])} · ${lp['po_number']} · ${fmtQty(lp['quantity'])} ${jStr(lp, 'unit') ?? ''}',
                      style: TextStyle(fontSize: 13, color: toDouble(lp['unit_price']) == lowPo ? _green : Brand.body))),
          MiniField(
              'Last quotation',
              lq == null
                  ? 'No quote'
                  : Text(
                      '${money(lq['net_price'])}${lq['is_awarded'] == true ? ' · Awarded' : ''}\n${lq['rfq_number']}${lq['quote_date'] != null ? ' · ${fmtDate(lq['quote_date'])}' : ''}'
                      '${lq['valid_today'] != true ? ' · expired ${fmtDate(lq['valid_until'])}' : ''}',
                      style: TextStyle(fontSize: 13, color: lq['valid_today'] == true && toDouble(lq['net_price']) == lowQ ? _green : Brand.body))),
          MiniField(
              'Rate contract',
              c == null
                  ? '—'
                  : '${money(c['unit_price'])}${c['valid_today'] != true ? ' · Not valid today' : ''}\n'
                      '${c['valid_from'] != null || c['valid_to'] != null ? '${c['valid_from'] != null ? fmtDate(c['valid_from']) : '…'} to ${c['valid_to'] != null ? fmtDate(c['valid_to']) : '…'}' : 'No end date'}'
                      '${c['min_order_qty'] != null ? ' · Min. order ${fmtQty(c['min_order_qty'])}' : ''}'),
          MiniField('Lead time', v['lead_time_days'] != null ? '${v['lead_time_days']} days' : '—'),
        ]),
        if (_canEdit && v['vendor_id'] != null)
          Wrap(spacing: 8, children: [
            secondaryBtn(c != null ? 'Edit contract' : 'Fix rate', () => _contract(v)),
            if (c != null)
              secondaryBtn('End', () async {
                final yes = await confirmDialog(context,
                    title: 'End this rate contract?',
                    message: 'POs to ${v['vendor_name']} will stop taking the contract rate ${money(c['unit_price'])}; the last PO rate is proposed instead. '
                        'Past POs are not changed.',
                    confirmLabel: 'End contract');
                if (yes) _run(() => Api.patch('/p2p/info-records/${c['id']}', data: {'is_active': false}));
              }),
          ]),
      ]),
    );
  }
}