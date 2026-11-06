import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'comparison.dart';
import 'p2p_common.dart';
import 'pr_actions.dart';
import 'pr_detail.dart';
import 'requisitions.dart' show naturalCompare;

// R.F.Q tab (portal app/dashboard/p2p/rfq/page.tsx, rfq/new, rfq/[id]).

const _listLabels = {'draft': 'Draft', 'locked': 'Closed - vendor chosen'};
const _listHex = {'draft': 0xFFF59E0B, 'locked': 0xFF22C55E};

class RfqTab extends StatefulWidget {
  const RfqTab({super.key});

  @override
  State<RfqTab> createState() => _RfqTabState();
}

class _RfqTabState extends State<RfqTab> {
  final _key = GlobalKey<ApiListViewState>();
  List<Json> _prs = [];
  List<Json> _rfqs = [];
  bool _useCache = false;
  String _status = 'all';
  String _vendors = 'all';
  ({int pending, int rfqs, int single, int draft, int locked}) _c = (pending: 0, rfqs: 0, single: 0, draft: 0, locked: 0);

  bool get _canStart => P2pAccess.isPurchaseTeam && P2pAccess.can('rfq', 'create');

  Future<ApiPage> _load(int page, String search) async {
    if (!_useCache) {
      final res = await Future.wait([
        Api.get('/p2p/my-lines', query: {'state': 'to_quote', 'limit': 500}),
        Api.get('/p2p/rfqs', query: {'limit': 1000}),
      ]);
      final ready = jList(asJson(res[0]), 'rows').map((r) => jInt(r, 'p2p_request_id')).toSet();
      final prs = ready.isEmpty ? <Json>[] : (await Api.list('/p2p/requests', query: {'limit': 1000})).rows;
      _prs = prs.where((p) => ready.contains(jInt(p, 'id'))).toList();
      _rfqs = ApiPage.from(res[1]).rows;
    }
    _useCache = false;
    final q = search.toLowerCase();
    bool has(List<Object?> v) => q.isEmpty || v.any((x) => (x ?? '').toString().toLowerCase().contains(q));
    final chipPending = _prs.where((p) => has([p['p2p_number'], p['project_label'], p['category_label'], p['category_code']])).toList();
    final chipRfqs = _rfqs.where((r) => has([r['rfq_number'], r['p2p_number']])).toList();
    final c = (
      pending: chipPending.length,
      rfqs: chipRfqs.length,
      single: chipRfqs.where((r) => jBool(r, 'is_single_quotation')).length,
      draft: chipRfqs.where((r) => jStr(r, 'status') == 'draft').length,
      locked: chipRfqs.where((r) => jStr(r, 'status') == 'locked').length,
    );
    if (mounted) setState(() => _c = c);
    final pend = (_status == 'all' || _status == 'pending') && _vendors == 'all' ? chipPending : <Json>[];
    final rf = chipRfqs.where((r) {
      final okStatus = _status == 'all' || _status == 'sent' || jStr(r, 'status') == _status;
      final single = jBool(r, 'is_single_quotation');
      final okV = _vendors == 'all' || (_vendors == 'single' ? single : !single);
      return okStatus && okV;
    }).toList();
    return ApiPage([
      for (final p in pend) {...p, '_pending': true},
      ...rf,
    ]);
  }

  void _refilter() {
    _useCache = true;
    _key.currentState?.reload();
  }

  void _toggle(String v) {
    setState(() => _status = _status == v ? 'all' : v);
    _refilter();
  }

  Future<void> _filters() async {
    var st = _status;
    var vd = _vendors;
    final ok = await showFormSheet(context,
        title: 'Filters',
        saveLabel: 'Apply Filters',
        builder: (ctx, setS) => [
              const Hint('Narrow the quotation requests, then press Apply.'),
              AppSelect<String>(
                label: 'RFQ status (requests sent)',
                value: st,
                clearable: false,
                options: const [
                  Option('all', 'All Statuses'),
                  Option('pending', 'RFQ pending'),
                  Option('sent', 'RFQs sent (all)'),
                  Option('draft', 'Draft'),
                  Option('locked', 'Closed - vendor chosen'),
                ],
                onChanged: (o) => setS(() => st = o?.value ?? 'all'),
              ),
              AppSelect<String>(
                label: 'Vendors (requests sent)',
                value: vd,
                clearable: false,
                options: const [
                  Option('all', 'One vendor or several'),
                  Option('single', 'One vendor only'),
                  Option('multi', 'Several vendors'),
                ],
                onChanged: (o) => setS(() => vd = o?.value ?? 'all'),
              ),
            ],
        onSave: () async {});
    if (!ok) return;
    setState(() {
      _status = st;
      _vendors = vd;
    });
    _refilter();
  }

  Future<void> _start(Json pr) async {
    final id = await openRaiseRfq(context, prId: jInt(pr, 'id'));
    if (id != null && mounted) {
      _key.currentState?.reload();
      openScreen(context, RfqDetailScreen(rfqId: id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final active = [_status, _vendors].where((v) => v != 'all').length;
    return Scaffold(
      floatingActionButton: _canStart
          ? CreateFab(
              label: 'Raise RFQ',
              onPressed: () async {
                final id = await openRaiseRfq(context);
                if (id != null && context.mounted) {
                  _key.currentState?.reload();
                  openScreen(context, RfqDetailScreen(rfqId: id));
                }
              })
          : null,
      body: ApiListView(
        key: _key,
        load: _load,
        searchHint: 'RFQ#, PR#, project...',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Quotation requests (RFQ)'),
          ChipStrip([
            CountChip('RFQ pending', _c.pending, selected: _status == 'pending', color: const Color(0xFFDC2626), onTap: () => _toggle('pending')),
            CountChip('RFQs', _c.rfqs, selected: _status == 'sent', color: const Color(0xFF3B82F6), onTap: () => _toggle('sent')),
            CountChip('Single vendor', _c.single, selected: _vendors == 'single', color: const Color(0xFFEA580C), onTap: () {
              setState(() => _vendors = _vendors == 'single' ? 'all' : 'single');
              _refilter();
            }),
            CountChip('Draft', _c.draft, selected: _status == 'draft', color: const Color(0xFFCA8A04), onTap: () => _toggle('draft')),
            CountChip('Closed', _c.locked, selected: _status == 'locked', color: const Color(0xFF16A34A), onTap: () => _toggle('locked')),
          ]),
          FilterBar(count: active, onOpen: _filters, onClear: () {
            setState(() {
              _status = 'all';
              _vendors = 'all';
            });
            _refilter();
          }),
        ]),
        emptyText: _rfqs.isEmpty && _prs.isEmpty
            ? 'Nothing to quote yet. An approved requisition appears here as "RFQ pending" once every line\'s stock decision is made and at least one line is sent to procurement.'
            : 'No quotation request matches the search and filters — change or clear them.',
        itemBuilder: (ctx, r, reload) {
          if (r['_pending'] == true) {
            return RecordCard(
              code: '—',
              title: '${r['p2p_number']}',
              subtitle: jStr(r, 'project_label'),
              trailing: const Padding(padding: EdgeInsets.only(left: 8), child: Pill('RFQ pending', Color(0xFFDC2626))),
              meta: [('Created On', fmtDate(r['created_at']))],
              onTap: _canStart
                  ? () => _start(r)
                  : () => showSnack(context, 'Only the Purchase team with Create on R.F.Q can start the quotation request.'),
            );
          }
          final st = jStr(r, 'status') ?? '';
          return RecordCard(
            code: jStr(r, 'rfq_number'),
            title: 'PR ${r['p2p_number'] ?? '—'}',
            trailing: Padding(
                padding: const EdgeInsets.only(left: 8), child: Pill(_listLabels[st] ?? st, Color(_listHex[st] ?? 0xFF78716C))),
            meta: [
              ('Vendors', jBool(r, 'is_single_quotation') ? 'One vendor only' : 'Several vendors'),
              ('Created On', fmtDate(r['created_at'])),
            ],
            onTap: () async {
              await Navigator.of(context).push(MaterialPageRoute(builder: (_) => RfqDetailScreen(rfqId: jInt(r, 'id')!)));
              _key.currentState?.reload();
            },
          );
        },
      ),
    );
  }
}

// ── Raise RFQ (portal rfq/new) ───────────────────────────────────────────────

/// Raise and send an RFQ for the buyer's own lines; returns the RFQ id.
Future<int?> openRaiseRfq(BuildContext context, {int? prId}) async {
  if (!P2pAccess.isPurchaseTeam) {
    showSnack(context, 'Only the Purchase team can raise an RFQ.', error: true);
    return null;
  }
  if (!P2pAccess.can('rfq', 'create')) {
    showSnack(context,
        "You don't have 'Create' permission on Procurement › R.F.Q. Ask an admin to add it to one of your roles in Organization › Role & Permissions.",
        error: true);
    return null;
  }
  final me = P2pAccess.me;
  final base = await withLoading(context, () async {
    final r = await Future.wait([
      Api.get('/p2p/my-lines', query: {'limit': 500}),
      loadActiveVendors(),
      Api.get('/p2p/settings').catchError((_) => <String, dynamic>{}),
    ]);
    return r;
  });
  if (base == null || !context.mounted) return null;
  final byPr = <int, ({String number, String? purpose, int lines})>{};
  for (final r in jList(asJson(base[0]), 'rows')) {
    if (!(jD(r, 'open_to_order') > 0) || jStr(r, 'state') != 'to_quote') continue;
    final id = jInt(r, 'p2p_request_id')!;
    final cur = byPr[id];
    byPr[id] = (number: jStr(r, 'p2p_number') ?? '', purpose: jStr(r, 'purpose_label'), lines: (cur?.lines ?? 0) + 1);
  }
  final prOptions = byPr.entries.toList()..sort((a, b) => naturalCompare(a.value.number, b.value.number));
  final vendorMaster = base[1] as List<Json>;
  final settings = asJson(asJson(base[2])['values']);
  var minVendors = 3;
  final mv = toDouble(settings['rfq_min_vendors']);
  if (mv != null && mv > 0) minVendors = mv.toInt();
  var quoteDays = 3;
  final qd = toDouble(settings['rfq_quote_days']);
  if (qd != null && qd >= 0) quoteDays = qd.toInt();
  final now = DateTime.now();
  DateTime? quoteBy = DateTime(now.year, now.month, now.day).add(Duration(days: quoteDays));

  int? selPr = prId;
  Json? pr;
  List<Json>? lineRows;
  String? prError;
  var loadingPr = false;
  final unticked = <int>{};
  final picked = <int>[];
  final late = TextEditingController();
  final note = TextEditingController();
  final reason = TextEditingController();
  List<({int id, String name, List<String> items, double? total})> suggestions = [];
  int? created;

  Future<void> loadPr(StateSetter setS) async {
    if (selPr == null) return;
    loadingPr = true;
    prError = null;
    try {
      setS(() {});
    } catch (_) {}
    try {
      final p = asJson(await Api.get('/p2p/requests/$selPr'));
      List<Json>? rows;
      try {
        rows = jList(asJson(await Api.get('/p2p/my-lines', query: {'p2p_request_id': selPr, 'limit': 500})), 'rows');
      } catch (_) {}
      pr = p;
      lineRows = rows;
      // Vendors whose catalog has these items (by Item Master id).
      final buy = jList(p, 'items')
          .where((it) => jStr(it, 'fulfillment_status') == 'sent_to_procurement' && it['store_item_id'] != null &&
              (jInt(it, 'buyer_id') ?? jInt(p, 'assigned_buyer_id')) == me)
          .take(8)
          .toList();
      final map = <int, ({int id, String name, List<String> items, double? total})>{};
      for (final it in buy) {
        List<Json> hits = const [];
        try {
          hits = asList(await Api.get('/p2p/vendors/for-item', query: {'store_item_id': it['store_item_id']}));
        } catch (_) {}
        final seen = <int>{};
        for (final h in hits) {
          final vid = jInt(h, 'vendor_id')!;
          if (!seen.add(vid)) continue;
          final row = map[vid] ?? (id: vid, name: jStr(h, 'vendor_name') ?? '', items: <String>[], total: 0.0);
          final price = jNum(h, 'unit_price');
          map[vid] = (id: vid, name: row.name, items: [...row.items, jStr(it, 'item_name') ?? ''], total: price != null && row.total != null ? row.total! + price : null);
        }
      }
      suggestions = map.values.toList()
        ..sort((a, b) => b.items.length != a.items.length ? b.items.length - a.items.length : (a.total ?? double.infinity).compareTo(b.total ?? double.infinity));
    } catch (e) {
      pr = null;
      lineRows = null;
      prError = '${ApiClient.describe(e)} Check that it still exists and that you have access to it.';
    }
    loadingPr = false;
    try {
      setS(() {});
    } catch (_) {}
  }

  ({List<(Json, double, String?)> list, List<(Json, double)> ready}) lines() {
    final p = pr;
    if (p == null) return (list: const [], ready: const []);
    final byItem = {for (final r in lineRows ?? const <Json>[]) jInt(r, 'pr_item_id'): r};
    final list = <(Json, double, String?)>[];
    for (final it in jList(p, 'items').where((it) => jStr(it, 'fulfillment_status') != 'stock_issued')) {
      final row = byItem[jInt(it, 'id')];
      final buyerId = jInt(it, 'buyer_id') ?? jInt(p, 'assigned_buyer_id');
      final open = row != null ? jD(row, 'open_to_order') : (jD(it, 'quantity') - jD(it, 'issued_qty') - jD(it, 'short_closed_qty')).clamp(0, double.infinity).toDouble();
      String? why;
      if (jStr(it, 'fulfillment_status') == 'pending') {
        why = 'Waiting for the stock check';
      } else if (buyerId != me) {
        why = buyerId != null
            ? 'Bought by ${jStr(it, 'buyer_name') ?? jStr(p, 'assigned_buyer_name') ?? 'another buyer'}'
            : 'No buyer yet - ask the Purchase head to assign one';
      } else if (!(open > 0)) {
        why = 'Nothing left to order';
      } else if (row != null && jStr(row, 'state') != 'to_quote') {
        why = jStr(row, 'state_label');
      }
      list.add((it, open, why));
    }
    return (list: list, ready: [for (final l in list) if (l.$3 == null) (l.$1, l.$2)]);
  }

  if (selPr != null) await loadPr((fn) => fn());
  if (!context.mounted) return null;

  final ok = await showFormSheet(
    context,
    title: 'Raise RFQ',
    saveLabel: 'Send RFQ',
    builder: (ctx, setS) {
      final l = lines();
      final chosen = l.ready.where((x) => !unticked.contains(jInt(x.$1, 'id'))).toList();
      final pickedV = [for (final id in picked) ...vendorMaster.where((v) => jInt(v, 'id') == id)];
      final limited = pickedV.length < minVendors;
      return [
        const Hint('Pick the vendors to ask, set the quote-by date and terms — the RFQ is emailed to each vendor.'),
        const FormHeading('1. Purchase Requisition'),
        if (prId != null)
          Text(pr != null ? '${pr!['p2p_number']} — ${pr!['category_label'] ?? pr!['category_code']}' : 'Loading…',
              style: const TextStyle(fontWeight: FontWeight.w600))
        else ...[
          AppSelect<int>(
            label: 'Requisition',
            required: true,
            value: selPr,
            options: [
              for (final e in prOptions)
                Option(e.key, '${e.value.number}${e.value.purpose != null ? ' — ${e.value.purpose}' : ''} · ${e.value.lines} line${e.value.lines == 1 ? '' : 's'} to quote'),
            ],
            onChanged: (o) {
              selPr = o?.value;
              pr = null;
              unticked.clear();
              loadPr(setS);
            },
          ),
          if (prOptions.isEmpty)
            const Hint('None of your requisition lines is waiting for an RFQ. Lines appear here once an approved requisition is assigned to you and its stock check is done.'),
        ],
        if (prError != null) Hint(prError!, color: Brand.danger),
        if (loadingPr) const Hint('Loading the requisition…'),
        if (pr != null) ...[
          Hint(jStr(pr, 'project_label') ?? 'No project specified'),
          InnerCard(color: Brand.background, children: [
            const Caps('Lines for this RFQ'),
            if (l.list.isEmpty) const Text('This requisition has no lines to buy.'),
            for (final (it, open) in l.ready)
              CheckboxListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: !unticked.contains(jInt(it, 'id')),
                onChanged: (v) => setS(() => v == true ? unticked.remove(jInt(it, 'id')) : unticked.add(jInt(it, 'id')!)),
                title: Text('${jStr(it, 'item_code') != null ? '${it['item_code']} — ' : ''}${it['item_name']} — ${fmtQty(open)} ${jStr(it, 'unit') ?? ''}'),
                subtitle: jD(it, 'issued_qty') > 0 || jD(it, 'short_closed_qty') > 0
                    ? Text('(of ${fmtQty(it['quantity'])}${jD(it, 'issued_qty') > 0 ? '; ${fmtQty(it['issued_qty'])} issued from stock' : ''}'
                        '${jD(it, 'short_closed_qty') > 0 ? '; ${fmtQty(it['short_closed_qty'])} written off' : ''})')
                    : null,
              ),
            for (final (it, _, why) in l.list.where((x) => x.$3 != null))
              Hint('${jStr(it, 'item_code') != null ? '${it['item_code']} — ' : ''}${it['item_name']}: $why'),
            if (l.ready.isNotEmpty) const Hint('Only the ticked lines go on this RFQ. Other buyers raise their own RFQ for their lines.'),
          ]),
        ],
        const FormHeading('2. Vendors to ask for a quotation'),
        AppSelect<int>(
          label: 'Add vendor',
          required: true,
          value: null,
          options: [
            for (final v in vendorMaster.where((v) => !picked.contains(jInt(v, 'id'))))
              Option(jInt(v, 'id')!, '${v['name']} (${v['code']})${jStr(v, 'city') != null ? ' — ${v['city']}' : ''}'),
          ],
          onChanged: (o) => setS(() {
            if (o != null && !picked.contains(o.value)) picked.add(o.value);
          }),
        ),
        for (final v in pickedV)
          InnerCard(children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${v['name']} (${v['code']})', style: const TextStyle(fontWeight: FontWeight.w600)),
                  (jStr(v, 'contact_email') ?? '').trim().isNotEmpty
                      ? Hint('${v['contact_email']}')
                      : const Hint('No email — add it in Procurement › Vendors', color: Brand.danger),
                ]),
              ),
              IconButton(
                  tooltip: 'Remove ${v['name']}',
                  icon: const Icon(Icons.close_rounded, color: Brand.danger),
                  onPressed: () => setS(() => picked.remove(jInt(v, 'id')))),
            ]),
          ]),
        if (pickedV.isEmpty) Hint('No vendors picked yet — Procurement › Settings asks for at least $minVendors.', color: const Color(0xFFB45309)),
        const Hint("The RFQ is emailed to each vendor. Their replies come to your mailbox — record them on the RFQ's comparison page."),
        if (suggestions.isNotEmpty) ...[
          const Text('Vendors whose catalog has these items (most items, then lowest catalog price first)',
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Color(0xFF1E40AF))),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final sg in suggestions.take(8))
              Builder(builder: (_) {
                final added = picked.contains(sg.id);
                final active = vendorMaster.any((m) => jInt(m, 'id') == sg.id);
                return ActionChip(
                  avatar: Icon(added ? Icons.check_rounded : Icons.add_rounded, size: 16),
                  label: Text('${added ? 'Added' : 'Add'} · ${sg.name} · ${sg.items.length} item${sg.items.length == 1 ? '' : 's'}'
                      '${sg.total != null ? ' · ${money(sg.total)}' : ''}'),
                  onPressed: added || !active ? null : () => setS(() => picked.add(sg.id)),
                );
              }),
          ]),
        ],
        const FormHeading('3. Quote & terms'),
        DateField(label: 'Quote by', required: true, value: quoteBy, onChanged: (d) => setS(() => quoteBy = d)),
        const Hint('Last day for vendors to send their quotation.'),
        AppTextField(label: 'Late Delivery Clause', required: true, controller: late, maxLines: 3, hint: 'e.g. 0.5% of the order value per week of delay, max 10%'),
        const Hint('Sent in the RFQ email and printed on the PO.'),
        AppTextField(label: 'Note to vendors', controller: note, maxLines: 3, hint: 'e.g. Urgent — needed at site by 5 Nov'),
        if (limited)
          NoteBox(
            'Only ${pickedV.length} vendor${pickedV.length == 1 ? '' : 's'} picked — Procurement › Settings asks for at least $minVendors. Add more vendors, or write the reason.',
            tone: NoteTone.warn,
            child: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: AppTextField(label: 'Reason for a limited quotation', required: true, controller: reason, maxLines: 2,
                  hint: 'e.g. Proprietary item — only the OEM supplies it'),
            ),
          ),
        NoteBox('Sending emails the RFQ to ${pickedV.length} vendor${pickedV.length == 1 ? '' : 's'} and locks it.', tone: NoteTone.warn),
        if (chosen.isEmpty && l.ready.isNotEmpty) const SizedBox.shrink(),
      ];
    },
    onSave: () async {
      final l = lines();
      final chosen = l.ready.where((x) => !unticked.contains(jInt(x.$1, 'id'))).toList();
      final pickedV = [for (final id in picked) ...vendorMaster.where((v) => jInt(v, 'id') == id)];
      final missing = pickedV.where((v) => (jStr(v, 'contact_email') ?? '').trim().isEmpty).toList();
      final limited = pickedV.length < minVendors;
      if (selPr == null) throw 'Select the Purchase Requisition this RFQ is for.';
      if (loadingPr || pr == null) throw 'The requisition is still loading. Wait a moment and send again.';
      if (l.ready.isEmpty) {
        throw 'None of your lines on this requisition is ready for an RFQ. See the reasons under Lines for this RFQ; lines still waiting for the stock check, or bought by another buyer, are not yours to quote.';
      }
      if (chosen.isEmpty) throw 'Tick at least one line for this RFQ.';
      if (pickedV.isEmpty) throw 'Pick at least one vendor to ask for a quotation (add new vendors in Procurement › Vendors).';
      if (missing.isNotEmpty) {
        throw 'No email in the vendor master for ${missing.map((v) => v['name']).join(', ')} — add it under Procurement › Vendors, or remove ${missing.length == 1 ? 'that vendor' : 'those vendors'} from this RFQ.';
      }
      if (quoteBy == null) throw 'Set the Quote by date — the last day vendors can send their quotation.';
      final today = DateTime(now.year, now.month, now.day);
      if (quoteBy!.isBefore(today)) throw 'The Quote by date is in the past — pick today or a later date.';
      if (late.text.trim().isEmpty) {
        throw 'Late delivery clause is required — write the penalty for late supply. It goes out in the RFQ email and is printed on the PO.';
      }
      if (limited && reason.text.trim().isEmpty) {
        throw 'Only ${pickedV.length} vendor${pickedV.length == 1 ? '' : 's'} picked — Procurement › Settings asks for at least $minVendors. Add more vendors, or write the reason for a limited quotation.';
      }
      final rfq = asJson(await Api.post('/p2p/rfqs', data: {
        'p2p_request_id': selPr,
        'requires_technical_evaluation': false,
        'pr_item_ids': [for (final c in chosen) jInt(c.$1, 'id')],
      }));
      final rid = jInt(rfq, 'id')!;
      final why = limited ? reason.text.trim() : '';
      await Api.patch('/p2p/rfqs/$rid', data: {
        'single_quotation_reason': why.isEmpty ? null : why,
        'comments': why.isEmpty ? null : why,
        'late_delivery_clause': late.text.trim(),
      });
      await Api.put('/p2p/rfqs/$rid/invites', data: {
        'vendor_ids': picked,
        'quote_due_date': apiDate(quoteBy!),
        'invite_message': note.text.trim().isEmpty ? null : note.text.trim(),
      });
      await Api.post('/p2p/rfqs/$rid/submit');
      created = rid;
    },
  );
  return ok ? created : null;
}

// ── RFQ detail (portal rfq/[id]) ─────────────────────────────────────────────

const _rfqLabels = {'draft': 'Draft', 'locked': 'Locked', 'cancelled': 'Cancelled'};
const _rfqHex = {'draft': 0xFFF59E0B, 'locked': 0xFF22C55E, 'cancelled': 0xFF94A3B8};
const _poStatus = {
  'draft': ('Draft - not sent for approval', 0xFFD97706),
  'issued': ('Approved, with vendor', 0xFF16A34A),
  'acknowledged': ('Approved, with vendor', 0xFF16A34A),
  'partially_fulfilled': ('Partly received', 0xFFD97706),
  'fulfilled': ('Received', 0xFF16A34A),
  'cancelled': ('Cancelled', 0xFF94A3B8),
};
const _quoteHex = {'quoted': 0xFF16A34A, 'waiting': 0xFFD97706, 'overdue': 0xFFDC2626, 'not_sent': 0xFF64748B};
const _quoteLabels = {'quoted': 'Quoted', 'waiting': 'Waiting', 'overdue': 'Overdue', 'not_sent': 'Not sent'};

class RfqDetailScreen extends StatefulWidget {
  const RfqDetailScreen({super.key, required this.rfqId});
  final int rfqId;

  @override
  State<RfqDetailScreen> createState() => _RfqDetailScreenState();
}

class _RfqDetailScreenState extends State<RfqDetailScreen> {
  Json? _rfq;
  Json? _invites;
  Object? _error;
  List<Json> _pos = [];
  String? _posError;
  bool _busy = false;
  String _notice = '';
  String _poNotice = '';

  bool get _isDesk => P2pAccess.isAdmin || P2pAccess.isPurchaseTeam;
  bool get _canViewPos => P2pAccess.can('purchase_orders', 'view');
  bool get _canWorkAll => P2pAccess.isAdmin || P2pAccess.feat('purchase_requisitions', 'all_lines', 'edit');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = asJson(await Api.get('/p2p/rfqs/${widget.rfqId}'));
      Json? inv;
      String? invErr;
      try {
        inv = asJson(await Api.get('/p2p/rfqs/${widget.rfqId}/invites'));
      } catch (e) {
        invErr = ApiClient.describe(e);
      }
      var pos = <Json>[];
      String? posErr;
      if (jStr(r, 'status') == 'locked' && _canViewPos) {
        try {
          pos = (await Api.list('/p2p/purchase-orders', query: {'p2p_request_id': r['p2p_request_id']}))
              .rows
              .where((p) => jInt(p, 'rfq_id') == jInt(r, 'id'))
              .toList()
            ..sort((a, b) => naturalCompare(jStr(a, 'po_number') ?? '', jStr(b, 'po_number') ?? ''));
        } catch (e) {
          posErr = '${ApiClient.describe(e)} Pull to refresh to try again.';
        }
      }
      if (!mounted) return;
      setState(() {
        _rfq = r;
        _invites = inv;
        _pos = pos;
        _posError = posErr;
        _error = null;
      });
      if (invErr != null && mounted) showSnack(context, 'Could not load the vendors this RFQ was emailed to: $invErr', error: true);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _invAction(Future<dynamic> Function() fn, String Function(Json r) done) async {
    setState(() => _busy = true);
    try {
      final r = asJson(await fn());
      if (mounted) {
        setState(() {
          _invites = r;
          _notice = done(r);
        });
      }
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _inviteMore() async {
    final vendors = await withLoading(context, loadActiveVendors);
    if (vendors == null || !mounted) return;
    final invited = jList(_invites, 'invites');
    final invitedIds = invited.map((i) => jInt(i, 'vendor_id')).toSet();
    final picked = <int>[];
    String hint = '';
    Json? result;
    final ok = await showFormSheet(
      context,
      title: 'Invite more vendors — ${_rfq!['rfq_number']}',
      saveLabel: 'Invite & email',
      builder: (ctx, setS) {
        final available = vendors.where((v) => !invitedIds.contains(jInt(v, 'id')) && !picked.contains(jInt(v, 'id'))).toList();
        final noEmail = available.where((v) => (jStr(v, 'contact_email') ?? '').isEmpty).length;
        return [
          const Hint('The RFQ is emailed to each vendor as soon as you save, with the same quote-by date and note.'),
          AppSelect<int>(
            label: 'Add a vendor',
            value: null,
            options: [
              for (final v in available)
                Option(jInt(v, 'id')!, '${v['name']} (${v['code']})',
                    subtitle: jStr(v, 'contact_email') ?? 'no email, can’t be invited'),
            ],
            onChanged: (o) => setS(() {
              final v = vendors.where((x) => jInt(x, 'id') == o?.value).firstOrNull;
              if (v == null) return;
              if ((jStr(v, 'contact_email') ?? '').isEmpty) {
                hint = '${v['name']} has no email in the vendor master — add it in Procurement › Vendors, then invite them.';
                return;
              }
              hint = '';
              picked.add(jInt(v, 'id')!);
            }),
          ),
          if (hint.isNotEmpty) Hint(hint, color: const Color(0xFFB45309)),
          if (noEmail > 0) Hint("$noEmail vendor(s) have no email in the vendor master and can't be invited until one is added (Procurement › Vendors)."),
          for (final id in picked)
            Builder(builder: (_) {
              final v = vendors.firstWhere((x) => jInt(x, 'id') == id);
              return InnerCard(children: [
                Row(children: [
                  Expanded(child: Text('${v['name']} (${v['code']})\n${v['contact_email']}')),
                  linkBtn('Remove', () => setS(() => picked.remove(id)), color: Brand.danger),
                ]),
              ]);
            }),
          if (invited.isNotEmpty) Hint('Already invited: ${invited.map((i) => i['vendor_name']).join(', ')}'),
        ];
      },
      onSave: () async {
        if (picked.isEmpty) throw 'Pick at least one vendor to invite.';
        result = asJson(await Api.post('/p2p/rfqs/${widget.rfqId}/invites/add', data: {'vendor_ids': picked}));
      },
    );
    if (ok && result != null && mounted) {
      final failed = jList(result, 'invites').where((x) => picked.contains(jInt(x, 'vendor_id')) && jStr(x, 'email_status') != 'sent').toList();
      setState(() {
        _invites = result;
        _notice = failed.isNotEmpty
            ? 'Invited ${picked.length} vendor(s); the email did not go to ${failed.map((f) => f['vendor_name']).join(', ')} — see the Email column.'
            : 'Invited ${picked.length} vendor(s) — the RFQ was emailed to them.';
      });
    }
  }

  Future<void> _addLines(List<int> current) async {
    final rfq = _rfq!;
    final rows = await withLoading(context, () async => jList(
        asJson(await Api.get('/p2p/my-lines', query: {
          'p2p_request_id': rfq['p2p_request_id'],
          if (rfq['buyer_id'] != null) 'buyer_id': rfq['buyer_id'],
          'limit': 500,
        })),
        'rows'));
    if (rows == null || !mounted) return;
    final offered = rows.where((r) => !current.contains(jInt(r, 'pr_item_id'))).toList();
    final eligible = offered
        .where((r) => jD(r, 'open_to_order') > 1e-6 && jStr(r, 'state') == 'to_quote' && jList(r, 'rfqs').every((q) => jInt(q, 'id') == widget.rfqId))
        .toList();
    final blocked = offered.where((r) => !eligible.contains(r) && jD(r, 'open_to_order') > 1e-6).toList();
    final picked = <int>[];
    final ok = await showFormSheet(
      context,
      title: 'Add lines to this RFQ',
      saveLabel: 'Add',
      builder: (ctx, setS) => [
        Hint('${rfq['rfq_number']} · ${rfq['p2p_number'] ?? 'requisition'}${jStr(rfq, 'buyer_name') != null ? ' · buyer ${rfq['buyer_name']}' : ''}'),
        if (eligible.isEmpty)
          const Hint('No other line of this requisition is ready for an RFQ with this buyer. A line is ready when its stock check is done, it has not been ordered and it is on no other RFQ.'),
        CheckList<int>(
          options: [
            for (final r in eligible)
              Option(jInt(r, 'pr_item_id')!, '${r['item_name']}',
                  subtitle: '${jStr(r, 'item_code') ?? 'No item code'} · ${fmtQty(r['open_to_order'])} ${jStr(r, 'unit') ?? ''} not yet ordered'),
          ],
          values: picked,
          onChanged: (v) => setS(() => picked
            ..clear()
            ..addAll(v)),
        ),
        if (blocked.isNotEmpty) ...[
          const Caps('Not available now'),
          for (final r in blocked)
            Hint('${r['item_name']}: ${jList(r, 'rfqs').where((q) => jInt(q, 'id') != widget.rfqId).map((q) => 'already on RFQ ${q['rfq_number']}').firstOrNull ?? (jStr(r, 'state_label') ?? '').toLowerCase()}'),
        ],
      ],
      onSave: () async {
        if (picked.isEmpty) throw 'Tick at least one line to add.';
        await Api.patch('/p2p/rfqs/${widget.rfqId}/lines', data: {'pr_item_ids': [...current, ...picked]});
      },
    );
    if (ok) _load();
  }

  Future<void> _adminEdit(bool hasInvites) async {
    final r = _rfq!;
    final pay = TextEditingController(text: jStr(r, 'payment_terms') ?? '');
    final lead = TextEditingController(text: jStr(r, 'delivery_lead_time') ?? '');
    final late = TextEditingController(text: jStr(r, 'late_delivery_clause') ?? '');
    final single = TextEditingController(text: jStr(r, 'single_quotation_reason') ?? '');
    final comments = TextEditingController(text: jStr(r, 'comments') ?? '');
    final ok = await showFormSheet(
      context,
      title: 'Admin Edit — ${r['rfq_number']}',
      saveLabel: 'Save Changes',
      builder: (ctx, setS) => [
        const Hint('Correct the commercial terms of a locked RFQ. The quotations stay as attached.'),
        FormHeading(hasInvites ? 'Commercial Terms' : 'L1 Vendor Commercial Terms'),
        if (!hasInvites) AppTextField(label: 'Payment Terms', controller: pay),
        if (!hasInvites) AppTextField(label: 'Delivery Lead Time', controller: lead),
        AppTextField(label: 'Late Delivery Clause', controller: late, maxLines: 3),
        if (jBool(r, 'is_single_quotation')) ...[
          const FormHeading('Single Quotation'),
          AppTextField(label: 'Reason for Single Quotation', controller: single, maxLines: 3),
          AppTextField(label: 'Comments', controller: comments, maxLines: 3),
        ],
      ],
      onSave: () async {
        String? v(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
        await Api.patch('/p2p/rfqs/${widget.rfqId}', data: {
          'payment_terms': v(pay),
          'delivery_lead_time': v(lead),
          'late_delivery_clause': v(late),
          'single_quotation_reason': v(single),
          'comments': v(comments),
        });
      },
    );
    if (ok) _load();
  }

  @override
  Widget build(BuildContext context) {
    final rfq = _rfq;
    if (rfq == null) {
      return SubPage(title: 'RFQ', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    }
    final st = jStr(rfq, 'status') ?? '';
    final inviteList = jList(_invites, 'invites');
    final hasInvites = inviteList.isNotEmpty;
    final canEditRfq = P2pAccess.can('rfq', 'edit');
    final allLines = jList(rfq, 'items');
    final active = allLines.where((l) => l['withdrawn_at'] == null).toList();
    final takenOff = allLines.where((l) => l['withdrawn_at'] != null).toList();
    final closedNoLines = st == 'locked' && allLines.isNotEmpty && active.isEmpty;
    final anyOpen = active.any((l) => (toDouble(l['open_qty']) ?? 1) > 1e-6);
    final isDraft = st == 'draft';
    final iOwn = P2pAccess.me != null && P2pAccess.me == jInt(rfq, 'buyer_id');
    final canChange = isDraft && canEditRfq && (iOwn || _canWorkAll);
    final canDiscard = P2pAccess.can('purchase_orders', 'edit') && (iOwn || _canWorkAll);
    final seeCmp = _isDesk && P2pAccess.feat('rfq', 'comparison', 'view');
    final seePoPrices = P2pAccess.feat('purchase_orders', 'prices', 'view') || P2pAccess.can('purchase_orders', 'edit');
    final canCreatePo = _isDesk && P2pAccess.can('purchase_orders', 'create');
    final l1 = jList(rfq, 'attachments').where((a) => jStr(a, 'vendor_tier') == 'L1').firstOrNull ?? jList(rfq, 'attachments').firstOrNull;

    return SubPage(
      title: '${rfq['rfq_number']}',
      actions: [
        if (st == 'locked' && P2pAccess.isAdmin)
          IconButton(tooltip: 'Admin Edit', icon: const Icon(Icons.edit_outlined), onPressed: _busy ? null : () => _adminEdit(hasInvites)),
      ],
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 10), child: Hint('Request for quotation')),
          DetailSection('Quotations for purchase request ${rfq['p2p_number'] ?? rfq['p2p_request_id']}', children: [
            Text(jBool(rfq, 'is_single_quotation')
                ? 'Single-quotation RFQ — only one vendor quoted; the reason is recorded below.'
                : hasInvites
                    ? 'Emailed to ${inviteList.length} vendor${inviteList.length == 1 ? '' : 's'} for their quotes.'
                    : 'Vendor quotations (L1 = lowest) are attached below.'),
            const SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              closedNoLines ? const Pill('Closed - no lines left', Color(0xFF64748B)) : Pill(_rfqLabels[st] ?? st, Color(_rfqHex[st] ?? 0xFF64748B)),
              Hint('· Buyer ${jStr(rfq, 'buyer_name') ?? '—'}'),
              Hint('· Created ${fmtDateTime(rfq['created_at'])} by ${jStr(rfq, 'created_by_name') ?? '—'}'),
              if (rfq['locked_at'] != null) Hint('· Locked ${fmtDateTime(rfq['locked_at'])}'),
            ]),
            const Divider(height: 24),
            Caps(hasInvites ? 'Commercial Terms' : 'L1 Vendor Commercial Terms'),
            if (!hasInvites) FieldRow('Payment Terms', jStr(rfq, 'payment_terms')),
            if (!hasInvites) FieldRow('Delivery Lead Time', jStr(rfq, 'delivery_lead_time')),
            FieldRow('Late Delivery Clause', jStr(rfq, 'late_delivery_clause')),
            if (jBool(rfq, 'is_single_quotation')) ...[
              const Divider(height: 24),
              const Caps('Single Quotation'),
              FieldRow('Reason', jStr(rfq, 'single_quotation_reason')),
              FieldRow('Comments', jStr(rfq, 'comments')),
            ],
          ]),
          DetailSection('Lines on this RFQ',
              action: isDraft && canChange ? secondaryBtn('+ Add lines', _busy ? null : () => _addLines(active.map((l) => jInt(l, 'pr_item_id')!).toList())) : null,
              children: [
                Hint(isDraft
                    ? 'Vendors quote only these lines. Add or take off lines until the RFQ is sent; after that its lines are fixed.'
                    : 'Vendors quoted only these lines. Lines moved to another buyer or written off stay listed in grey.'),
                if (isDraft && !canChange)
                  Hint(canEditRfq
                      ? 'Only ${jStr(rfq, 'buyer_name') ?? 'the buyer'} or the Purchase head can change these lines.'
                      : 'Changing lines needs Edit access on Procurement › R.F.Q.'),
                const SizedBox(height: 8),
                if (allLines.isEmpty)
                  Text(isDraft
                      ? 'No line is on this RFQ yet. Add the lines you want quotes for.'
                      : 'This RFQ has no line list (it was raised before lines were tracked per RFQ). Its quotes cover the whole requisition.'),
                for (final l in [...active, ...takenOff])
                  Opacity(
                    opacity: l['withdrawn_at'] != null ? 0.55 : 1,
                    child: InnerCard(children: [
                      Text('${l['item_name']}',
                          style: TextStyle(
                              fontWeight: FontWeight.w600,
                              decoration: l['withdrawn_at'] != null ? TextDecoration.lineThrough : null)),
                      Hint(jStr(l, 'item_code') ?? 'No item code'),
                      MiniGrid([
                        MiniField('Asked', '${fmtQty(l['quantity'])} ${jStr(l, 'unit') ?? ''}'),
                        MiniField('Not yet ordered', l['withdrawn_at'] != null ? '—' : fmtQty(l['open_qty'])),
                      ]),
                      l['withdrawn_at'] != null
                          ? Hint('Taken off ${fmtDate(l['withdrawn_at'])}${jStr(l, 'withdrawn_reason') != null ? ': ${l['withdrawn_reason']}' : ''}')
                          : const Text('On this RFQ', style: TextStyle(color: Color(0xFF166534))),
                      if (l['withdrawn_at'] == null && canChange)
                        linkBtn('Remove', _busy
                            ? null
                            : () async {
                                setState(() => _busy = true);
                                final ok = await runAction(context, () => Api.patch('/p2p/rfqs/${widget.rfqId}/lines', data: {
                                      'pr_item_ids': [for (final x in active) if (jInt(x, 'pr_item_id') != jInt(l, 'pr_item_id')) jInt(x, 'pr_item_id')],
                                    }));
                                if (mounted) setState(() => _busy = false);
                                if (ok) _load();
                              }, color: Brand.danger),
                    ]),
                  ),
              ]),
          if (hasInvites) _invitesSection(canEditRfq, seeCmp),
          if (P2pAccess.feat('rfq', 'vendor_quotes', 'view') && !hasInvites && jList(rfq, 'attachments').isNotEmpty)
            DetailSection('Supplier / Vendor Quotations', children: [
              for (final tier in const ['L1', 'L2', 'L3', 'L4'])
                for (final a in jList(rfq, 'attachments').where((a) => jStr(a, 'vendor_tier') == tier).take(1))
                  InnerCard(children: [
                    Caps('$tier Vendor'),
                    Text(jStr(a, 'vendor_name') ?? '—', style: const TextStyle(fontWeight: FontWeight.w600)),
                    Hint(jStr(a, 'vendor_contact') ?? '—'),
                    linkBtn('${a['filename']}', () => openApiFile(context, '/p2p/rfqs/${widget.rfqId}/attachments/${a['id']}/content', '${a['filename']}')),
                  ]),
            ]),
          if (st == 'locked')
            DetailSection('Purchase orders of this RFQ', children: [
              if (_canViewPos && _posError != null) Hint(_posError!, color: Brand.danger),
              if (_poNotice.isNotEmpty) NoteBox(_poNotice, tone: NoteTone.ok),
              for (final po in _pos)
                Builder(builder: (_) {
                  final s = _poStatus[jStr(po, 'status')] ?? (jStr(po, 'status') ?? '', 0xFF64748B);
                  return InnerCard(children: [
                    Row(children: [
                      Expanded(child: Text('${po['po_number']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                      Pill(s.$1, Color(s.$2)),
                    ]),
                    Text(jStr(po, 'vendor_name') ?? '—'),
                    if (seePoPrices) Hint('Value (incl. tax): ${money(po['total_value'])}'),
                    Wrap(spacing: 12, children: [
                      linkBtn('Open', () => openScreen(context, PrDetailScreen(prId: jInt(rfq, 'p2p_request_id')!, contextKey: 'po-approval', poId: jInt(po, 'id')))),
                      if (jStr(po, 'status') == 'draft' && canDiscard)
                        linkBtn('Discard draft', () async {
                          final ok = await discardPoDraft(context,
                              rfqId: widget.rfqId, poId: jInt(po, 'id')!, poNumber: '${po['po_number']}', vendorName: jStr(po, 'vendor_name'));
                          if (ok && mounted) {
                            setState(() => _poNotice =
                                'Draft PO ${po['po_number']} discarded. Its quantity is open to order again and its Tally number can be used again.');
                            _load();
                          }
                        }, color: Brand.danger),
                    ]),
                  ]);
                }),
              if (_canViewPos && _posError == null && _pos.isEmpty) const Text('No PO has been uploaded on this RFQ yet.'),
              const SizedBox(height: 8),
              if (closedNoLines)
                const Text('This RFQ has no lines left: they moved to another buyer or were written off. The quotes stay readable; nothing more can be awarded or ordered here.')
              else if (!anyOpen && allLines.isNotEmpty)
                const Text('Every line of this RFQ is on a PO or short-closed, so nothing is left to order here.')
              else ...[
                Text(hasInvites
                    ? "Next: record each vendor's quote on the line quotations page and award each line there (a line can be split between vendors). Then make the PO in Tally for each awarded vendor and upload it on the requisition."
                    : 'Next: make the PO in Tally for the chosen vendor (L1 ${jStr(l1, 'vendor_name') != null ? '${l1!['vendor_name']} ' : ''}is the lowest), then upload it on the requisition with Upload PO. It goes for approval from there.'),
                const SizedBox(height: 8),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  if (seeCmp)
                    primaryBtn('Line quotes & comparison →', () async {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ComparisonScreen(rfqId: widget.rfqId)));
                      _load();
                    })
                  else
                    const Hint('Recording quotes needs the Purchase desk and R.F.Q › Quotation comparison (view) on your role.'),
                  if (canCreatePo)
                    secondaryBtn('Open requisition to upload PO →', () async {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => PrDetailScreen(prId: jInt(rfq, 'p2p_request_id')!)));
                      _load();
                    })
                  else
                    const Hint('Uploading the PO needs Create access on Procurement › Purchase Orders.'),
                ]),
              ],
              if (_pos.isNotEmpty) ...[
                const SizedBox(height: 8),
                secondaryBtn('View approval status',
                    () => openScreen(context, PrDetailScreen(prId: jInt(rfq, 'p2p_request_id')!, contextKey: 'po-approval'))),
              ],
            ]),
        ]),
      ),
    );
  }

  Widget _invitesSection(bool canEdit, bool canOpenCmp) {
    final list = jList(_invites, 'invites');
    final quoted = list.where((i) => jStr(i, 'quote_status') == 'quoted').length;
    final due = jStr(_invites, 'quote_due_date');
    final now = DateTime.now();
    final duePassed = due != null && (parseDate(due)?.isBefore(DateTime(now.year, now.month, now.day)) ?? false);
    final anyUnsent = list.any((i) => jStr(i, 'email_status') != 'sent');
    final anyRemind = list.any((i) => jStr(i, 'email_status') == 'sent' && jStr(i, 'quote_status') != 'quoted');
    final base = '/p2p/rfqs/${widget.rfqId}/invites';
    return DetailSection('Invited vendors', children: [
      Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Text('Quote by ${fmtDate(due)}'),
        if (duePassed) const Pill('Date passed', Color(0xFFDC2626)),
        Text('· $quoted of ${list.length} quoted'),
      ]),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: [
        if (canEdit && anyUnsent)
          secondaryBtn('Send pending emails', _busy
              ? null
              : () => _invAction(() => Api.post('$base/send'), (r) {
                    final failed = jList(r, 'invites').where((x) => jStr(x, 'email_status') == 'failed').length;
                    return failed > 0 ? 'Emails sent; $failed failed — see the Email column for the reason.' : 'Pending emails sent.';
                  })),
        if (canEdit && anyRemind)
          secondaryBtn('Remind all who haven’t quoted', _busy
              ? null
              : () => _invAction(() => Api.post('$base/remind'), (_) => "Reminder emailed to every vendor who hasn't quoted yet.")),
        if (canEdit) secondaryBtn('+ Invite more vendors', _busy ? null : _inviteMore),
      ]),
      if (jStr(_invites, 'invite_message') != null) NoteBox('Note to vendors: ${_invites!['invite_message']}'),
      if (_notice.isNotEmpty) Hint(_notice, color: const Color(0xFF15803D)),
      const SizedBox(height: 8),
      for (final inv in list)
        InnerCard(children: [
          Text('${inv['vendor_name']}', style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
          jStr(inv, 'email') != null ? Hint('${inv['email']}') : const Hint('no email in vendor master', color: Brand.danger),
          const SizedBox(height: 4),
          Builder(builder: (_) {
            final es = jStr(inv, 'email_status');
            return Text(
              es == 'sent'
                  ? 'Sent ${fmtDateTime(inv['sent_at'])}'
                  : es == 'failed'
                      ? 'Failed — ${jStr(inv, 'send_error') ?? 'no reason given'}'
                      : 'Not sent',
              style: TextStyle(fontSize: 12.5, color: es == 'sent' ? const Color(0xFF16A34A) : es == 'failed' ? Brand.danger : Brand.muted),
            );
          }),
          if (inv['reminder_sent_at'] != null) Hint('Reminder sent ${fmtDateTime(inv['reminder_sent_at'])}'),
          const SizedBox(height: 4),
          Pill(
            jStr(inv, 'quote_status') == 'quoted' && inv['quoted_price'] != null
                ? 'Quoted ${money(inv['quoted_price'])}'
                : _quoteLabels[jStr(inv, 'quote_status')] ?? '${inv['quote_status']}',
            Color(_quoteHex[jStr(inv, 'quote_status')] ?? 0xFF64748B),
          ),
          Wrap(spacing: 12, children: [
            if (canEdit)
              linkBtn('Resend', _busy
                  ? null
                  : () => _invAction(() => Api.post('$base/${inv['id']}/resend'), (r) {
                        final now = jList(r, 'invites').where((x) => jInt(x, 'id') == jInt(inv, 'id')).firstOrNull;
                        return jStr(now, 'email_status') == 'sent'
                            ? 'RFQ emailed again to ${inv['vendor_name']}.'
                            : '${inv['vendor_name']}: the email did not go — ${jStr(now, 'send_error') ?? 'see the Email column'}.';
                      })),
            if (canOpenCmp && jStr(inv, 'quote_status') == 'quoted')
              linkBtn('View', () => openScreen(context, ComparisonScreen(rfqId: widget.rfqId)))
            else if (canOpenCmp && canEdit)
              linkBtn('Record quote', () async {
                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ComparisonScreen(rfqId: widget.rfqId, vendorId: jInt(inv, 'vendor_id'))));
                _load();
              }),
          ]),
        ]),
    ]);
  }
}
