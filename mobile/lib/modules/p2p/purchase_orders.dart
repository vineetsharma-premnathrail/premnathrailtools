import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';
import 'pr_detail.dart';
import 'requisitions.dart';

// Purchase Orders tab (portal app/dashboard/p2p/purchase-orders): Before PO,
// Approvals and Tracking. POs are made in Tally and uploaded on the requisition.

class PurchaseOrdersTab extends StatefulWidget {
  const PurchaseOrdersTab({super.key, required this.poApprover});
  final bool poApprover;

  @override
  State<PurchaseOrdersTab> createState() => _PurchaseOrdersTabState();
}

class _PurchaseOrdersTabState extends State<PurchaseOrdersTab> {
  String? _picked;
  String _bucket = 'pending';

  @override
  Widget build(BuildContext context) {
    final purchase = P2pAccess.isPurchaseTeam || P2pAccess.isAdmin;
    final views = [
      if (purchase && P2pAccess.can('purchase_orders', 'create')) ('before_po', 'Before PO'),
      if (widget.poApprover) ('approvals', 'Approvals'),
      if (purchase) ('tracking', 'Tracking'),
    ];
    if (views.isEmpty) return const EmptyView('Purchase Orders are for the purchase team and the PO approvers.');
    final view = views.any((v) => v.$1 == _picked) ? _picked! : views.first.$1;
    final top = <Widget>[
      const PageHeader('Purchase Orders'),
      SegmentRow(
        items: [for (final v in views) (v.$1, v.$2, null)],
        selected: view,
        onTap: (v) => setState(() => _picked = v),
      ),
    ];
    switch (view) {
      case 'before_po':
        return BeforePoList(key: const ValueKey('before'), top: top);
      case 'approvals':
        const buckets = {
          'pending': ('Waiting for approval', ['po_raised'], 'No PO is waiting for approval.'),
          'approved': ('Approved', ['po_approved', 'partially_received', 'received', 'closed'], 'No approved POs yet.'),
          'rejected': ('Rejected', ['rejected'], 'No rejected POs.'),
          'all': ('All', ['po_raised', 'po_approved', 'partially_received', 'received', 'closed', 'rejected'], 'No POs found.'),
        };
        final b = buckets[_bucket]!;
        return PrList(
          key: ValueKey('po-appr-$_bucket'),
          statuses: b.$2,
          emptyLabel: b.$3,
          contextKey: 'po-approval',
          queue: 'po-approval',
          top: [
            ...top,
            SegmentRow(
              items: [for (final e in buckets.entries) (e.key, e.value.$1, null)],
              selected: _bucket,
              onTap: (v) => setState(() => _bucket = v),
            ),
          ],
        );
      default:
        return PoTrackingList(key: const ValueKey('tracking'), top: top);
    }
  }
}

// ── Before PO (goods received before their PO existed) ───────────────────────

class BeforePoList extends StatefulWidget {
  const BeforePoList({super.key, required this.top});
  final List<Widget> top;

  @override
  State<BeforePoList> createState() => _BeforePoListState();
}

class _BeforePoListState extends State<BeforePoList> {
  final _key = GlobalKey<ApiListViewState>();
  int _count = 0;

  Future<ApiPage> _load(int page, String search) async {
    final rows = asList(await Api.get('/p2p/pre-po-receipts/pending'))
      ..sort((a, b) => naturalCompare(jStr(a, 'receipt_number') ?? '', jStr(b, 'receipt_number') ?? ''));
    if (mounted) setState(() => _count = rows.length);
    final q = search.toLowerCase();
    return ApiPage(rows
        .where((r) =>
            q.isEmpty ||
            [r['receipt_number'], r['vendor_name'], r['delivery_challan_number'], r['vendor_invoice_number'], ...jList(r, 'items').map((i) => i['item_name'])]
                .any((x) => (x ?? '').toString().toLowerCase().contains(q)))
        .toList());
  }

  Future<void> _create(Json r) async {
    final items = jList(r, 'items');
    final yes = await confirmDialog(context,
        title: 'Create requisition for ${r['receipt_number']}?',
        message: 'Create a requisition to ${r['vendor_name']} for these ${items.length} item${items.length == 1 ? '' : 's'}? '
            'It opens next — make the PO in Tally and upload it there with Upload PO.',
        confirmLabel: 'Create requisition');
    if (!yes || !mounted) return;
    try {
      final res = asJson(await Api.post('/p2p/pre-po-receipts/${r['id']}/create-requisition'));
      final prId = jInt(asJson(res['rfq']), 'p2p_request_id');
      if (!mounted) return;
      _key.currentState?.reload();
      if (prId != null) openScreen(context, PrDetailScreen(prId: prId));
    } catch (e) {
      if (mounted) {
        showSnack(context, '${ApiClient.describe(e)} Reload the list and try again.', error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = P2pAccess.can('purchase_orders', 'create');
    return ApiListView(
      key: _key,
      load: _load,
      searchHint: 'Receipt no., vendor, item...',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ...widget.top,
        ChipStrip([CountChip('Receipts waiting for a PO', _count, selected: true, color: const Color(0xFFEA580C))]),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Hint('The store already holds these goods. Create the requisition for the same vendor and items, make the PO in Tally and upload it on the '
              'requisition; the goods enter stock only when the GRN is done after the PO is approved.'),
        ),
      ]),
      emptyText: 'No goods are waiting for a PO. When the store receives material before its PO exists, it records a Before PO receipt and it appears here.',
      itemBuilder: (ctx, r, reload) {
        final items = jList(r, 'items');
        final atts = jList(r, 'attachments');
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          RecordCard(
            code: jStr(r, 'receipt_number'),
            title: jStr(r, 'vendor_name') ?? '—',
            subtitle: '${items.length} · ${items.take(2).map((i) => i['item_name']).join(', ')}${items.length > 2 ? ' +${items.length - 2} more' : ''}',
            meta: [
              ('Received on', fmtDate(r['received_date'])),
              if (jStr(r, 'delivery_challan_number') != null) ('Challan', '${r['delivery_challan_number']}'),
              if (jStr(r, 'vendor_invoice_number') != null) ('Invoice', '${r['vendor_invoice_number']}'),
              if (atts.isNotEmpty) ('Files', '${atts.length}'),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Wrap(spacing: 8, runSpacing: 6, alignment: WrapAlignment.end, children: [
              for (final a in atts)
                linkBtn('${a['filename']}', () => openApiFile(context, '/p2p/pre-po-receipts/${r['id']}/attachments/${a['id']}/content', '${a['filename']}')),
              if (r['p2p_request_id'] != null)
                secondaryBtn('Upload PO on ${r['p2p_number'] ?? 'requisition'}',
                    () => openScreen(context, PrDetailScreen(prId: jInt(r, 'p2p_request_id')!)))
              else
                secondaryBtn('Create requisition', canCreate ? () => _create(r) : null),
            ]),
          ),
        ]);
      },
    );
  }
}

// ── PO Tracking ──────────────────────────────────────────────────────────────

const stageOrder = ['draft', 'in_approval', 'with_vendor', 'partly_received', 'received', 'short_closed', 'closed', 'cancelled'];
const stageHex = {
  'draft': 0xFF94A3B8, 'in_approval': 0xFFF59E0B, 'with_vendor': 0xFF2563EB, 'partly_received': 0xFFD97706,
  'received': 0xFF16A34A, 'short_closed': 0xFF7C3AED, 'closed': 0xFF64748B, 'cancelled': 0xFFDC2626,
};
const _sortOptions = [
  Option('code', 'PO number (A → Z)'), Option('urgency', 'Most urgent first'), Option('due', 'Delivery date'),
  Option('date', 'PO date'), Option('vendor', 'Vendor'), Option('stage', 'Stage'), Option('value', 'PO value'),
  Option('progress', 'Delivered %'),
];

String _stageLabel(String s) => s == 'with_vendor' ? 'With vendor' : typeLabel(s);

Widget dueChip(Json r) {
  final d = jInt(r, 'days_to_due');
  if (d == null) return const Hint('—');
  final (text, hex) = d < 0
      ? ('late by ${-d} ${d == -1 ? 'day' : 'days'}', 0xFFDC2626)
      : d == 0
          ? ('Due today', 0xFFD97706)
          : ('In $d ${d == 1 ? 'day' : 'days'}', d <= 7 ? 0xFFD97706 : 0xFF64748B);
  return Pill(text, Color(hex));
}

class PoTrackingList extends StatefulWidget {
  const PoTrackingList({super.key, required this.top});
  final List<Widget> top;

  @override
  State<PoTrackingList> createState() => _PoTrackingListState();
}

class _PoTrackingListState extends State<PoTrackingList> {
  final _key = GlobalKey<ApiListViewState>();
  Json? _data;
  String _stage = '';
  bool _overdue = false;
  bool _dueSoon = false;
  int? _vendorId;
  int? _buyerId;
  DateTime? _from;
  DateTime? _to;
  ProjectPick? _project;
  String _sort = 'code';
  bool _desc = false;
  List<Json> _vendors = [];
  List<Json> _buyers = [];

  @override
  void initState() {
    super.initState();
    Api.get('/p2p/po-reports/tracking/filters').then((o) {
      if (mounted) {
        setState(() {
          _vendors = jList(asJson(o), 'vendors');
          _buyers = jList(asJson(o), 'buyers');
        });
      }
    }).catchError((e) {
      if (mounted) showSnack(context, '${ApiClient.describe(e)} The Vendor and Buyer filters are empty until it loads.', error: true);
    });
  }

  Future<ApiPage> _load(int page, String search) async {
    final p = _project;
    final d = asJson(await Api.get('/p2p/po-reports/tracking', query: {
      'stage': _stage,
      'search': search,
      'vendor_id': _vendorId,
      'buyer_id': _buyerId,
      'overdue_only': _overdue ? true : null,
      'due_soon_only': _dueSoon ? true : null,
      'date_from': _from == null ? null : apiDate(_from!),
      'date_to': _to == null ? null : apiDate(_to!),
      if (p != null) (p.elementId != null ? 'order_project_element_id' : 'order_project_id'): p.elementId ?? p.projectId,
      'sort': _sort,
      'desc': _desc,
      'skip': (page - 1) * 50,
      'limit': 50,
    }));
    if (mounted) setState(() => _data = d);
    return ApiPage(jList(d, 'rows'), total: jInt(d, 'total'));
  }

  void _reload() => _key.currentState?.reload();

  int get _active => [_stage.isNotEmpty, _vendorId != null, _buyerId != null, _overdue || _dueSoon, _from != null, _to != null, _project != null]
      .where((x) => x)
      .length;

  void _chip(String c) {
    final chipOverdue = _overdue && _stage.isEmpty;
    final chipDue = _dueSoon && _stage.isEmpty;
    final chipWith = _stage == 'with_vendor' && !_overdue && !_dueSoon;
    setState(() {
      _stage = c == 'with_vendor' && !chipWith ? 'with_vendor' : '';
      _overdue = c == 'overdue' && !chipOverdue;
      _dueSoon = c == 'due_soon' && !chipDue;
    });
    _reload();
  }

  void _clear() {
    setState(() {
      _stage = '';
      _overdue = false;
      _dueSoon = false;
      _vendorId = null;
      _buyerId = null;
      _from = null;
      _to = null;
      _project = null;
      _sort = 'code';
      _desc = false;
    });
    _reload();
  }

  Future<void> _filters() async {
    var stage = _stage;
    var delivery = _overdue ? 'overdue' : _dueSoon ? 'due_soon' : '';
    var vendor = _vendorId;
    var buyer = _buyerId;
    var from = _from;
    var to = _to;
    var project = _project;
    var sort = _sort;
    final days = jInt(_data, 'due_soon_days') ?? 7;
    final ok = await showFormSheet(context, title: 'Filters', saveLabel: 'Apply Filters', builder: (ctx, setS) => [
          const Hint('Narrow the purchase orders, then press Apply.'),
          AppSelect<String>(
            label: 'Stage',
            value: stage.isEmpty ? null : stage,
            options: [for (final s in stageOrder) Option(s, _stageLabel(s))],
            onChanged: (o) => setS(() => stage = o?.value ?? ''),
          ),
          AppSelect<String>(
            label: 'Delivery',
            value: delivery.isEmpty ? null : delivery,
            options: [const Option('overdue', 'Overdue'), Option('due_soon', 'Due in $days days')],
            onChanged: (o) => setS(() => delivery = o?.value ?? ''),
          ),
          AppSelect<int>(
            label: 'Vendor',
            value: vendor,
            options: [for (final v in _vendors) Option(jInt(v, 'id')!, jStr(v, 'name') ?? '')],
            onChanged: (o) => setS(() => vendor = o?.value),
          ),
          AppSelect<int>(
            label: 'Buyer',
            value: buyer,
            options: [for (final b in _buyers) Option(jInt(b, 'id')!, jStr(b, 'name') ?? '')],
            onChanged: (o) => setS(() => buyer = o?.value),
          ),
          AppSelect<String>(
            label: 'Project',
            value: project == null ? null : '${project!.projectId}:${project!.elementId ?? ''}',
            valueLabel: project?.label,
            loadOptions: projectUnitOptions,
            onChanged: (o) => setS(() {
              if (o == null) {
                project = null;
              } else {
                final parts = o.value.split(':');
                project = (projectId: int.parse(parts[0]), elementId: int.tryParse(parts.length > 1 ? parts[1] : ''), label: o.label);
              }
            }),
          ),
          DateField(label: 'PO date from', value: from, onChanged: (d) => setS(() => from = d)),
          DateField(label: 'PO date to', value: to, onChanged: (d) => setS(() => to = d)),
          AppSelect<String>(label: 'Sort by', value: sort, clearable: false, options: _sortOptions, onChanged: (o) => setS(() => sort = o?.value ?? 'code')),
        ], onSave: () async {});
    if (!ok) return;
    setState(() {
      _stage = stage;
      _overdue = delivery == 'overdue';
      _dueSoon = delivery == 'due_soon';
      _vendorId = vendor;
      _buyerId = buyer;
      _from = from;
      _to = to;
      _project = project;
      if (sort != _sort) {
        _sort = sort;
        _desc = false;
      }
    });
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final counts = asJson(d?['counts']);
    return ApiListView(
      key: _key,
      load: _load,
      paged: true,
      pageSize: 50,
      searchHint: 'PO no., vendor, item, requisition...',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ...widget.top,
        ChipStrip([
          CountChip('Purchase orders', jInt(d, 'all') ?? 0,
              selected: _stage.isEmpty && !_overdue && !_dueSoon, color: const Color(0xFF3B82F6), onTap: () => _chip('all')),
          CountChip('Overdue', jInt(d, 'overdue') ?? 0, selected: _overdue && _stage.isEmpty, color: const Color(0xFFDC2626), onTap: () => _chip('overdue')),
          CountChip('Due in ${jInt(d, 'due_soon_days') ?? 7} days', jInt(d, 'due_soon') ?? 0,
              selected: _dueSoon && _stage.isEmpty, color: const Color(0xFFCA8A04), onTap: () => _chip('due_soon')),
          CountChip('With vendor', counts['with_vendor'] ?? 0,
              selected: _stage == 'with_vendor' && !_overdue && !_dueSoon, color: const Color(0xFF16A34A), onTap: () => _chip('with_vendor')),
        ]),
        if (d?['open_value'] != null)
          Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 6), child: Hint('Open value ${money(d!['open_value'])}')),
        FilterBar(count: _active, onOpen: _filters, onClear: _clear, trailing: [
          secondaryBtn('${_sortOptions.firstWhere((o) => o.value == _sort).label.split(' (').first} ${_desc ? '↓' : '↑'}', () {
            setState(() => _desc = !_desc);
            _reload();
          }),
        ]),
      ]),
      emptyText: _active > 0
          ? 'No purchase order matches these filters. Tap Clear to show all.'
          : 'No purchase orders yet — they appear here once a PO is drafted from an approved requisition.',
      itemBuilder: (ctx, r, reload) {
        final stage = jStr(r, 'stage') ?? '';
        final pct = (toDouble(r['received_pct']) ?? 0).clamp(0, 100).toDouble();
        final showProgress = !['draft', 'in_approval', 'cancelled'].contains(stage);
        return RecordCard(
          code: '${r['po_number']}${(jInt(r, 'amendment_no') ?? 0) > 0 ? ' · Rev ${r['amendment_no']}' : ''}',
          title: jStr(r, 'vendor_name') ?? 'No vendor',
          subtitle: [jStr(r, 'p2p_number'), jStr(r, 'purpose_label'), jStr(r, 'charged_to')].whereType<String>().join(' · '),
          trailing: Padding(
              padding: const EdgeInsets.only(left: 8), child: Pill(jStr(r, 'stage_label') ?? stage, Color(stageHex[stage] ?? 0xFF64748B))),
          meta: [
            ('PO date', fmtDate(r['po_date'])),
            ('Delivery', r['expected_delivery'] != null ? fmtDate(r['expected_delivery']) : 'Not set'),
            if (r['days_to_due'] != null) ('Due', _dueText(r)),
            if (showProgress)
              (
                'Delivered',
                '${pct.round()}% · ${r['ordered_qty'] != null && r['delivered_qty'] != null ? '${fmtQty(r['delivered_qty'])} / ${fmtQty(r['ordered_qty'])} ${jStr(r, 'unit') ?? ''}' : '${r['lines_complete']} of ${r['lines']} lines'}'
              ),
            if (jStr(r, 'buyer_name') != null) ('Buyer', '${r['buyer_name']}'),
            if (r['total_value'] != null) ('Value', money(r['total_value'])),
            if (r['last_activity'] != null) ('Last activity', fmtDate(r['last_activity'])),
          ],
          onTap: () => openScreen(context, PoTrackingDetailScreen(row: r)),
        );
      },
    );
  }

  String _dueText(Json r) {
    final d = jInt(r, 'days_to_due')!;
    return d < 0 ? 'late by ${-d} ${d == -1 ? 'day' : 'days'}' : d == 0 ? 'Due today' : 'In $d ${d == 1 ? 'day' : 'days'}';
  }
}

const _grnHex = {'draft': 0xFFF59E0B, 'completed': 0xFF16A34A, 'reversed': 0xFF94A3B8};
const _grnLabel = {'draft': 'In inspection', 'completed': 'Completed', 'reversed': 'Reversed'};
const _eventHex = {'grn': 0xFF2563EB, 'rtv': 0xFFDC2626, 'invoice': 0xFF16A34A, 'service_entry': 0xFF7C3AED};

/// One purchase order of PO Tracking: Items · Receipts · Approval · Documents · Timeline.
class PoTrackingDetailScreen extends StatefulWidget {
  const PoTrackingDetailScreen({super.key, required this.row});
  final Json row;

  @override
  State<PoTrackingDetailScreen> createState() => _PoTrackingDetailScreenState();
}

class _PoTrackingDetailScreenState extends State<PoTrackingDetailScreen> {
  String _tab = 'items';
  Json? _po;
  String? _poError;
  Json? _history;
  String? _historyError;
  List<Json>? _grns;
  String? _grnError;
  List<(String, String, String?, int)>? _events;
  String _eventsNote = '';
  Json? _doc;

  int get _poId => jInt(widget.row, 'po_id')!;

  @override
  void initState() {
    super.initState();
    Api.get('/p2p/purchase-orders/$_poId').then((d) {
      if (mounted) setState(() => _po = asJson(d));
    }).catchError((e) {
      if (mounted) setState(() => _poError = ApiClient.describe(e));
    });
    Api.get('/p2p/po-reports/$_poId/history').then((d) {
      if (mounted) setState(() => _history = asJson(d));
    }).catchError((e) {
      if (mounted) setState(() => _historyError = ApiClient.describe(e));
    });
  }

  void _openTab(String t) {
    setState(() => _tab = t);
    if (t == 'receipts' && _grns == null) _loadGrns();
    if (t == 'timeline' && _events == null) _loadTimeline();
    if (t == 'documents' && _doc == null) {
      Api.get('/managed-documents/p2p_purchase_order/$_poId').then((d) {
        if (mounted) setState(() => _doc = asJson(d));
      }).catchError((_) {
        if (mounted) setState(() => _doc = {});
      });
    }
  }

  Future<void> _loadGrns() async {
    setState(() => _grnError = null);
    try {
      final g = (await Api.list('/p2p/goods-receipts', query: {'purchase_order_id': _poId})).rows;
      if (mounted) setState(() => _grns = g);
    } catch (e) {
      if (mounted) setState(() => _grnError = ApiClient.describe(e));
    }
  }

  Future<void> _loadTimeline() async {
    final row = widget.row;
    final out = <(String, String, String?, int)>[];
    final notes = <String>[];
    final po = _po;
    if (po?['created_at'] != null) out.add(('${po!['created_at']}', 'PO drafted', jStr(po, 'created_by_name') != null ? 'by ${po['created_by_name']}' : null, 0xFF94A3B8));
    try {
      final a = asJson(await Api.get('/approvals/entity/p2p_purchase_order/$_poId'));
      final all = [...jList(a, 'history').reversed, if (a['current'] is Map) asJson(a['current'])];
      for (final r in all) {
        out.add(('${r['submitted_at']}', (jInt(r, 'revision') ?? 1) > 1 ? 'Sent for approval again (#${r['revision']})' : 'Sent for approval',
            jStr(r, 'requester_name') != null ? 'by ${r['requester_name']}' : null, 0xFFF59E0B));
        for (final s in jList(r, 'steps')) {
          if (s['decided_at'] == null) continue;
          final st = jStr(s, 'status');
          final verb = st == 'approved' ? 'approved' : st == 'rejected' ? 'rejected' : st == 'returned' ? 'returned it' : st;
          out.add(('${s['decided_at']}', '${s['stage_name']}: $verb',
              [jStr(s, 'decided_by_name') ?? jStr(s, 'approver_name'), if (jStr(s, 'comment') != null) '"${s['comment']}"'].whereType<String>().join(' — '),
              st == 'approved' ? 0xFF16A34A : 0xFFDC2626));
        }
      }
    } catch (e) {
      notes.add(ApiClient.describe(e));
    }
    if (row['p2p_request_id'] != null) {
      try {
        for (final a in asList(await Api.get('/p2p/requests/${row['p2p_request_id']}/audit'))) {
          final summary = jStr(a, 'summary') ?? '';
          final action = jStr(a, 'action');
          if (a['performed_at'] != null && (summary.contains('${row['po_number']}') || action == 'short_closed' || action == 'closed')) {
            out.add(('${a['performed_at']}', action == 'short_closed' ? 'Requisition short-closed' : action == 'closed' ? 'Requisition closed' : 'Requisition note',
                summary, 0xFF64748B));
          }
        }
      } catch (e) {
        notes.add(ApiClient.describe(e));
      }
    }
    for (final l in jList(_history, 'lines')) {
      for (final e in jList(l, 'events')) {
        if (e['date'] == null) continue;
        final st = jStr(e, 'status');
        out.add(('${e['date']}', '${e['label']} ${e['document_number']}',
            '${l['item_name']}: ${e['quantity']}${jStr(l, 'unit') != null ? ' ${l['unit']}' : ''}${st != null ? ' · ${jStr(e, 'type') == 'grn' ? _grnLabel[st] ?? st : st}' : ''}',
            _eventHex[jStr(e, 'type')] ?? 0xFF6B7280));
      }
    }
    out.sort((a, b) => (parseDate(a.$1) ?? DateTime(0)).compareTo(parseDate(b.$1) ?? DateTime(0)));
    if (mounted) {
      setState(() {
        _events = out;
        _eventsNote = notes.join(' ');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final row = widget.row;
    final seeDoc = P2pAccess.feat('purchase_orders', 'po_document', 'view');
    final tabs = [('items', 'Items'), ('receipts', 'Receipts'), ('approval', 'Approval'), if (seeDoc) ('documents', 'Documents'), ('timeline', 'Timeline')];
    final stage = jStr(row, 'stage') ?? '';
    return SubPage(
      title: '${row['po_number']}',
      bottom: row['p2p_request_id'] != null
          ? secondaryBtn('Open requisition & this PO', () => openScreen(context,
              PrDetailScreen(prId: jInt(row, 'p2p_request_id')!, contextKey: 'po-approval', poId: _poId)))
          : null,
      body: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Pill(jStr(row, 'stage_label') ?? stage, Color(stageHex[stage] ?? 0xFF64748B)),
            const SizedBox(height: 4),
            Hint('${jStr(row, 'vendor_name') ?? 'No vendor'} · PO date ${fmtDate(row['po_date'])} · due ${row['expected_delivery'] != null ? fmtDate(row['expected_delivery']) : 'not set'}'),
            if (row['p2p_number'] != null || row['purpose_label'] != null)
              Hint([if (row['p2p_number'] != null) 'Requisition ${row['p2p_number']}', jStr(row, 'purpose_label'), jStr(row, 'charged_to')].whereType<String>().join(' · ')),
          ]),
        ),
        SegmentRow(items: [for (final t in tabs) (t.$1, t.$2, null)], selected: _tab, onTap: _openTab),
        if (_poError != null) Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(_poError!)),
        ..._body(row, stage),
      ]),
    );
  }

  List<Widget> _body(Json row, String stage) {
    switch (_tab) {
      case 'receipts':
        if (_grnError != null) {
          return [Padding(padding: const EdgeInsets.all(16), child: ErrorView(_grnError!, onRetry: _loadGrns))];
        }
        if (_grns == null) return [const LoadingView()];
        if (_grns!.isEmpty) return [const Padding(padding: EdgeInsets.all(16), child: Text('Nothing has been received against this PO yet.'))];
        return [
          for (final g in _grns!)
            RecordCard(
              code: jStr(g, 'grn_number'),
              title: fmtDate(g['received_date']),
              trailing: Pill(_grnLabel[jStr(g, 'status')] ?? '${g['status']}', Color(_grnHex[jStr(g, 'status')] ?? 0xFF64748B)),
              meta: [
                ('Received', fmtQty(jList(g, 'items').fold<double>(0, (a, i) => a + jD(i, 'received_quantity')))),
                ('Accepted', jStr(g, 'status') == 'draft' ? '—' : fmtQty(jList(g, 'items').fold<double>(0, (a, i) => a + jD(i, 'accepted_quantity')))),
                ('Vendor invoice', jStr(g, 'vendor_invoice_number') ?? '—'),
              ],
            ),
        ];
      case 'approval':
        if (stage == 'draft') {
          return [const Padding(padding: EdgeInsets.all(16), child: Text('This PO is still a draft — it has not been sent for approval.'))];
        }
        return [EngineApprovalSection(entityType: 'p2p_purchase_order', entityId: _poId, title: 'Approval of ${row['po_number']}')];
      case 'documents':
        final doc = _doc;
        if (doc == null) return [const LoadingView()];
        final name = 'PO-${row['po_number']}'.replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '-');
        return [
          DetailSection('Purchase order document', children: [
            if (doc['document'] == null) const Text('No document has been made for this purchase order yet.'),
            secondaryBtn('Download Word document', () => openApiFile(context, '/managed-documents/p2p_purchase_order/$_poId/docx', '$name.docx'),
                icon: Icons.description_outlined),
          ]),
        ];
      case 'timeline':
        if (_events == null) return [const LoadingView()];
        return [
          if (_eventsNote.isNotEmpty) Padding(padding: const EdgeInsets.all(16), child: Hint('Some steps are missing: $_eventsNote')),
          if (_events!.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Nothing has happened on this PO yet.')),
          for (final e in _events!)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                    width: 10, height: 10, margin: const EdgeInsets.only(top: 5, right: 10),
                    decoration: BoxDecoration(color: Color(e.$4), shape: BoxShape.circle)),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${e.$2} · ${fmtDate(e.$1)}', style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                    if (e.$3 != null && e.$3!.isNotEmpty) Hint(e.$3!),
                  ]),
                ),
              ]),
            ),
        ];
      default:
        final po = _po;
        if (po == null) return [if (_poError == null) const LoadingView()];
        final items = jList(po, 'items');
        if (items.isEmpty) return [const Padding(padding: EdgeInsets.all(16), child: Text('This purchase order has no lines.'))];
        final summary = {for (final l in jList(_history, 'lines')) if (l['summary'] is Map) jInt(l, 'po_item_id'): asJson(l['summary'])};
        return [
          if (_historyError != null)
            Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Hint('Delivered / open quantities are not shown: $_historyError')),
          for (final it in items)
            Builder(builder: (_) {
              final s = summary[jInt(it, 'id')];
              return RecordCard(
                code: jStr(it, 'item_code'),
                title: '${it['item_name']}',
                meta: [
                  ('Ordered', '${fmtQty(it['quantity'])} ${jStr(it, 'unit') ?? ''}'),
                  if (_history != null) ('Delivered', s == null ? '—' : fmtQty(s['delivered_qty'])),
                  if (_history != null) ('Open', s == null ? '—' : (stage == 'short_closed' ? '${fmtQty(s['open_qty'])} written off' : fmtQty(s['open_qty']))),
                  if (row['total_value'] != null) ('Line total', money(it['line_total'])),
                ],
              );
            }),
        ];
    }
  }
}