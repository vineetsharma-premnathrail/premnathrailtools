import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';
import 'pr_actions.dart';
import 'pr_detail.dart';
import 'rfq.dart';

// My Lines — the buyer's worklist (portal app/dashboard/p2p/my-lines/page.tsx):
// one row per requisition + item category + buyer; a row opens to its lines.

const _stateOrder = [
  'awaiting_stock_decision', 'to_quote', 'quoting', 'awarded', 'po_in_approval', 'with_vendor', 'partly_received', 'received',
  'short_closed', 'issued_from_stock',
];
const _stateLabel = {
  'awaiting_stock_decision': 'Waiting for stock check', 'to_quote': 'RFQ not sent', 'quoting': 'Waiting for quotes',
  'awarded': 'Vendor chosen', 'po_in_approval': 'PO in approval', 'with_vendor': 'With vendor', 'partly_received': 'Partly received',
  'received': 'Received', 'short_closed': 'Closed short', 'issued_from_stock': 'Issued from stock',
};
const _stateHex = {
  'awaiting_stock_decision': 0xFF94A3B8, 'to_quote': 0xFFDC2626, 'quoting': 0xFFF59E0B, 'awarded': 0xFF2563EB,
  'po_in_approval': 0xFFD97706, 'with_vendor': 0xFF0891B2, 'partly_received': 0xFFD97706, 'received': 0xFF16A34A,
  'short_closed': 0xFF7C3AED, 'issued_from_stock': 0xFF64748B,
};
const _page = 100;

class MyLinesTab extends StatefulWidget {
  const MyLinesTab({super.key});

  @override
  State<MyLinesTab> createState() => _MyLinesTabState();
}

class _MyLinesTabState extends State<MyLinesTab> {
  final _key = GlobalKey<ApiListViewState>();
  Map<String, int> _counts = {};
  String _state = '';
  bool _urgent = false;
  bool _overdue = false;
  String _buyer = '';
  final _buyerNames = <String, String>{};
  final _open = <String>{};
  int _total = 0;
  String _notice = '';

  bool get _isHead => P2pAccess.feat('purchase_requisitions', 'all_lines', 'view');
  bool get _canWorkAll => P2pAccess.isAdmin || P2pAccess.feat('purchase_requisitions', 'all_lines', 'edit');
  bool get _canMove => _canWorkAll && P2pAccess.can('purchase_requisitions', 'edit') && P2pAccess.feat('purchase_requisitions', 'buyer', 'edit');
  bool get _canShort => (P2pAccess.isAdmin || P2pAccess.isPurchaseTeam) && P2pAccess.feat('purchase_requisitions', 'close', 'edit');

  @override
  void initState() {
    super.initState();
    if (_isHead) {
      Api.get('/p2p/po-reports/tracking/filters').then((o) {
        if (!mounted) return;
        setState(() {
          for (final b in jList(asJson(o), 'buyers')) {
            _buyerNames.putIfAbsent('${b['id']}', () => jStr(b, 'name') ?? '');
          }
        });
      }).catchError((_) {});
    }
  }

  Future<ApiPage> _load(int page, String search) async {
    final q = <String, dynamic>{'skip': (page - 1) * _page, 'limit': _page};
    if (_isHead) {
      if (_buyer.isEmpty) {
        q['all'] = true;
      } else {
        q['buyer_id'] = int.parse(_buyer);
      }
    }
    if (_state.isNotEmpty) q['state'] = _state;
    if (search.isNotEmpty) q['search'] = search;
    if (_urgent) q['urgent'] = true;
    if (_overdue) q['overdue'] = true;
    final d = asJson(await Api.get('/p2p/my-lines', query: q));
    final rows = jList(d, 'rows');
    // One card per requisition + category + buyer (the server keeps them adjacent).
    final groups = <String, Json>{};
    final order = <String>[];
    for (final r in rows) {
      final k = '${r['p2p_request_id']}|${r['category'] ?? ''}|${r['buyer_id'] ?? ''}';
      if (!groups.containsKey(k)) {
        groups[k] = {'_key': k, 'pr': r, 'lines': <Json>[]};
        order.add(k);
      }
      (groups[k]!['lines'] as List<Json>).add(r);
      if (r['buyer_id'] != null && jStr(r, 'buyer_name') != null) _buyerNames['${r['buyer_id']}'] = r['buyer_name'];
    }
    if (mounted) {
      setState(() {
        _counts = {for (final e in asJson(d['counts']).entries) e.key: (e.value as num).toInt()};
        _total = jInt(d, 'total') ?? rows.length;
      });
    }
    return ApiPage([for (final k in order) groups[k]!], total: jInt(d, 'total'));
  }

  void _reload() => _key.currentState?.reload();

  LineRef _ref(Json l) => (
        prItemId: jInt(l, 'pr_item_id')!,
        itemName: jStr(l, 'item_name') ?? '',
        unit: jStr(l, 'unit'),
        openToOrder: jD(l, 'open_to_order'),
        buyerId: jInt(l, 'buyer_id'),
      );

  @override
  Widget build(BuildContext context) {
    if (!P2pAccess.feat('purchase_requisitions', 'my_lines', 'view')) {
      return const EmptyView(
          'My Lines is not on your role. Ask an admin to tick Procurement › Purchase Requisitions › My Lines tab (view) for you (Organization › Roles).');
    }
    final countTotal = _counts.values.fold<int>(0, (a, b) => a + b);
    final filtered = _state.isNotEmpty || _urgent || _overdue || _buyer.isNotEmpty;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    return ApiListView(
      key: _key,
      load: _load,
      paged: true,
      pageSize: _page,
      searchHint: 'PR no., item code or name, project...',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        PageHeader('My Lines',
            subtitle: _isHead
                ? 'Requisition lines of every buyer, and lines that have no buyer yet. One row per requisition, item category and buyer; open a row to see its lines. Lines of one requisition go on one RFQ; lines of different requisitions cannot share an RFQ.'
                : 'Requisition lines you buy: what is still to quote, to order, or waiting for goods. One row per requisition and item category; open a row to see its lines. Lines of different requisitions cannot share an RFQ.'),
        if (_notice.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: NoteBox(_notice, tone: NoteTone.ok)),
        ChipStrip([
          CountChip('All', countTotal, selected: _state.isEmpty, onTap: () {
            setState(() => _state = '');
            _reload();
          }),
          for (final s in _stateOrder.where((s) => (_counts[s] ?? 0) > 0 || _state == s))
            CountChip(_stateLabel[s] ?? s, _counts[s] ?? 0, selected: _state == s, color: Color(_stateHex[s] ?? 0xFF64748B), onTap: () {
              setState(() => _state = _state == s ? '' : s);
              _reload();
            }),
        ]),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
          child: Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
            FilterChip(label: const Text('Urgent only'), selected: _urgent, onSelected: (v) {
              setState(() => _urgent = v);
              _reload();
            }),
            FilterChip(label: const Text('Overdue'), selected: _overdue, onSelected: (v) {
              setState(() => _overdue = v);
              _reload();
            }),
            if (_isHead)
              SizedBox(
                width: 220,
                child: AppSelect<String>(
                  label: 'Buyer',
                  value: _buyer.isEmpty ? null : _buyer,
                  options: [
                    const Option('0', 'Unassigned (no buyer yet)'),
                    ...(_buyerNames.entries.toList()..sort((a, b) => a.value.compareTo(b.value))).map((e) => Option(e.key, e.value)),
                  ],
                  onChanged: (o) {
                    setState(() => _buyer = o?.value ?? '');
                    _reload();
                  },
                ),
              ),
            if (filtered)
              secondaryBtn('Clear', () {
                setState(() {
                  _state = '';
                  _urgent = false;
                  _overdue = false;
                  _buyer = '';
                });
                _reload();
              }),
          ]),
        ),
        if (_urgent || _overdue)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
            child: Hint('Stage counts above are for ${[if (_urgent) 'urgent', if (_overdue) 'overdue'].join(' and ')} lines only.'),
          ),
        if (_total > 0) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 6), child: Hint('$_total lines')),
      ]),
      emptyText: filtered
          ? 'No line matches these filters. Tap Clear to show all.'
          : _isHead
              ? 'No requisition line is waiting for a buyer. Lines appear here once a requisition is approved and sent to procurement.'
              : 'No line is assigned to you. Lines appear here when an approved requisition has an item you buy; if you expected one, ask the Purchase head.',
      itemBuilder: (ctx, g, reload) {
        final r = asJson(g['pr']);
        final lines = (g['lines'] as List).cast<Json>();
        final key = '${g['_key']}';
        final open = _open.contains(key);
        final units = lines.map((l) => (jStr(l, 'unit') ?? '').trim().toLowerCase()).toSet();
        final same = units.length == 1;
        String sum(String f) => same ? fmtQty(lines.fold<double>(0, (a, l) => a + jD(l, f))) : 'mixed';
        final states = _stateOrder.where((s) => lines.any((l) => jStr(l, 'state') == s)).toList();
        final hasOpen = lines.any((l) => jD(l, 'open_to_order') > 1e-6);
        final req = parseDate(r['required_date']);
        final late = req != null && req.isBefore(today) && hasOpen;
        final buyerId = jInt(r, 'buyer_id');
        final groupMine = buyerId != null && buyerId == P2pAccess.me;
        final canRaise = P2pAccess.can('rfq', 'create') && states.contains('to_quote') && buyerId != null && (groupMine || _canWorkAll);
        final rfqs = {for (final l in lines) for (final q in jList(l, 'rfqs')) jInt(q, 'id'): q}.values.toList();
        final pos = {for (final l in lines) for (final p in jList(l, 'pos')) jInt(p, 'id'): p}.values.toList();
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Card(
            color: late ? const Color(0xFFFFF5F5) : null,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(
                    child: InkWell(
                      onTap: () => openScreen(context, PrDetailScreen(prId: jInt(r, 'p2p_request_id')!)),
                      child: Text('${r['p2p_number']}', style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.primaryActive)),
                    ),
                  ),
                  if (isUrgent(r['priority'])) const Pill('Urgent', Color(0xFFDC2626)),
                ]),
                InkWell(
                  onTap: () => setState(() => open ? _open.remove(key) : _open.add(key)),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${open ? '▾' : '▸'} ${jStr(r, 'category') ?? 'No category'} · ${lines.length} item${lines.length == 1 ? '' : 's'}',
                          style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                      Hint('${lines.take(3).map((l) => l['item_name']).join(', ')}${lines.length > 3 ? ' +${lines.length - 3} more' : ''}'
                          '${jStr(r, 'charged_to') != null ? ' · ${r['charged_to']}' : ''}'),
                    ]),
                  ),
                ),
                Wrap(spacing: 6, runSpacing: 4, children: [
                  for (final s in states) Pill(_stateLabel[s] ?? s, Color(_stateHex[s] ?? 0xFF64748B)),
                  if (lines.any((l) => jBool(l, 'po_rejected'))) const Pill('PO rejected — upload again', Color(0xFFD97706)),
                ]),
                const SizedBox(height: 8),
                MiniGrid([
                  MiniField('To buy', same ? '${sum('buy_qty')} ${jStr(lines.first, 'unit') ?? ''}' : 'mixed'),
                  MiniField('Not yet ordered', sum('open_to_order')),
                  MiniField('Ordered', sum('ordered_qty')),
                  MiniField('Received', sum('accepted_qty')),
                  MiniField('Pending', sum('pending_receipt')),
                  MiniField('Required by', req == null ? '—' : '${fmtDate(req)}${late ? ' · late' : ''}'),
                  MiniField('Priority', priorityLabel(r['priority'])),
                  MiniField('Requester', jStr(r, 'requester_name')),
                  if (_isHead) MiniField('Buyer', jStr(r, 'buyer_name') ?? 'Unassigned'),
                  MiniField(
                      'RFQ',
                      rfqs.isEmpty
                          ? '—'
                          : Wrap(spacing: 6, children: [
                              for (final q in rfqs)
                                groupMine || _canWorkAll
                                    ? linkBtn('${q['rfq_number']}', () => openScreen(context, RfqDetailScreen(rfqId: jInt(q, 'id')!)))
                                    : Text('${q['rfq_number']}'),
                            ])),
                  MiniField(
                      'PO',
                      pos.isEmpty
                          ? '—'
                          : Wrap(spacing: 6, children: [
                              for (final p in pos)
                                linkBtn('${p['po_number']}',
                                    () => openScreen(context, PrDetailScreen(prId: jInt(r, 'p2p_request_id')!, contextKey: 'po-approval', poId: jInt(p, 'id')))),
                            ])),
                ]),
                if (canRaise)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: secondaryBtn('Raise RFQ', () async {
                      final id = await openRaiseRfq(context, prId: jInt(r, 'p2p_request_id'));
                      if (id != null && context.mounted) {
                        _reload();
                        openScreen(context, RfqDetailScreen(rfqId: id));
                      }
                    }),
                  ),
                if (open)
                  for (final l in lines) _lineRow(l),
              ]),
            ),
          ),
        );
      },
    );
  }

  Widget _lineRow(Json l) {
    final open = jD(l, 'open_to_order') > 1e-6;
    final mine = jInt(l, 'buyer_id') != null && jInt(l, 'buyer_id') == P2pAccess.me;
    final canMove = _canMove && open;
    final canClose = _canShort && open && (mine || _canWorkAll);
    final prId = jInt(l, 'p2p_request_id')!;
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: Brand.background, borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${l['item_name']}', style: const TextStyle(fontWeight: FontWeight.w600)),
        Hint(jStr(l, 'item_code') ?? 'No item code'),
        Wrap(spacing: 6, children: [
          Pill(jStr(l, 'state_label') ?? '', Color(_stateHex[jStr(l, 'state')] ?? 0xFF64748B)),
          if (jBool(l, 'po_rejected')) const Pill('PO rejected — upload again', Color(0xFFD97706)),
        ]),
        const SizedBox(height: 6),
        MiniGrid([
          MiniField('To buy', '${fmtQty(l['buy_qty'])} ${jStr(l, 'unit') ?? ''}'),
          MiniField('Not yet ordered', fmtQty(l['open_to_order'])),
          MiniField('Ordered', fmtQty(l['ordered_qty'])),
          MiniField('Received', fmtQty(l['accepted_qty'])),
          MiniField('Pending', fmtQty(l['pending_receipt'])),
          MiniField('RFQ / PO', '${jList(l, 'rfqs').map((q) => q['rfq_number']).join(', ')} ${jList(l, 'pos').map((p) => p['po_number']).join(', ')}'.trim()),
        ]),
        if (canMove || canClose)
          Wrap(spacing: 8, children: [
            if (canMove)
              secondaryBtn('Reassign', () async {
                if (await reassignLine(context, prId, _ref(l)) && mounted) {
                  setState(() => _notice = '${l['item_name']} moved to its new buyer. The old buyer, the new buyer and the requester have been told.');
                  _reload();
                }
              }),
            if (canClose)
              secondaryBtn('Short-close', () async {
                if (await shortCloseLine(context, prId, _ref(l)) && mounted) {
                  setState(() => _notice = '${l['item_name']} short-closed. The requester has been told.');
                  _reload();
                }
              }),
          ]),
      ]),
    );
  }
}