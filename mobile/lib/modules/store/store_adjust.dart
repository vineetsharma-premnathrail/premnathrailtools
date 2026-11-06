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

// Adjustments, Reorder, Physical Count (portal: store/adjustments,
// adjustments/new, adjustments/[id], reorder, cycle-count, cycle-count/[id]).

const _adjLabel = {'pending_approval': 'Pending Approval', 'approved': 'Approved', 'rejected': 'Rejected', 'cancelled': 'Withdrawn'};
const _adjColor = {
  'pending_approval': Color(0xFFF59E0B),
  'approved': Color(0xFF22C55E),
  'rejected': cRed,
  'cancelled': Color(0xFF78716C),
};

class AdjustmentsTab extends StatefulWidget {
  const AdjustmentsTab({super.key});

  @override
  State<AdjustmentsTab> createState() => _AdjustmentsTabState();
}

class _AdjustmentsTabState extends State<AdjustmentsTab> {
  final _list = GlobalKey<ApiListViewState>();
  String? _status;
  List<Json> _all = const [];

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: can('adjustments', 'create')
            ? CreateFab(
                label: 'New Adjustment',
                onPressed: () async {
                  final a = await openAdjustmentForm(context);
                  if (a != null && context.mounted) {
                    _list.currentState?.reload();
                    openScreen(context, AdjustmentDetailScreen(adjustmentId: toInt(a['id'])!));
                  }
                })
            : null,
        body: ApiListView(
          key: _list,
          load: (page, s) async {
            final p = await Api.list('/store/stock-adjustments');
            _all = p.rows;
            if (mounted) setState(() {});
            return ApiPage(_status == null ? p.rows : p.rows.where((a) => a['status'] == _status).toList());
          },
          emptyText: _status != null
              ? 'No adjustments in this status — tap the chip again to show all.'
              : 'No stock adjustments yet${can('adjustments', 'create') ? ' — use + New Adjustment when a count differs from the books.' : '.'}',
          header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const StorePageHeader('Stock Adjustments',
                subtitle: 'Correct book stock to the physically counted quantity; the difference posts once approved.'),
            ChipRow([
              for (final e in _adjLabel.entries)
                CountChip(e.value, _all.where((a) => a['status'] == e.key).length,
                    color: _adjColor[e.key], selected: _status == e.key, onTap: () {
                  setState(() => _status = _status == e.key ? null : e.key);
                  _list.currentState?.reload();
                }),
            ]),
          ]),
          itemBuilder: (ctx, a, reload) => RecordCard(
            code: txt(a['adjustment_number']),
            title: txt(a['location_name']),
            trailing: pill(_adjLabel[a['status']] ?? humanize(a['status']), _adjColor[a['status']] ?? cGrey),
            meta: [
              ('Date', fmtDate(a['adjustment_date'])),
              ('Approver', txt(a['approved_by_name'])),
              ('Items', '${jsonList(a['items']).length}'),
            ],
            onTap: () => openThen(ctx, AdjustmentDetailScreen(adjustmentId: toInt(a['id'])!), reload),
          ),
        ),
      );
}

class _AdjLine {
  int? itemId;
  final qty = TextEditingController();
  final remarks = TextEditingController();
}

Future<Json?> openAdjustmentForm(BuildContext context) async {
  int? loc;
  int? approver;
  final reason = TextEditingController();
  final remarks = TextEditingController();
  final lines = <_AdjLine>[_AdjLine()];
  StockSnapshot? stock;
  Json? saved;
  final ok = await showFormSheet(
    context,
    title: 'New Stock Adjustment',
    saveLabel: 'Send for Approval',
    builder: (ctx, setS) => [
      const Hint('Correct the book quantity to what is physically there — an approver signs it off before stock changes.'),
      const FormHeading('Adjustment Details'),
      LocationSelect(
        value: loc,
        onChanged: (l) {
          setS(() {
            loc = toInt(l?['id']);
            stock = null;
            lines
              ..clear()
              ..add(_AdjLine());
          });
          if (loc != null) {
            StockSnapshot.load(loc!).then((s) => setS(() => stock = s), onError: (Object e) {
              if (ctx.mounted) showSnack(ctx, "Couldn't load stock balances for this store: ${ApiClient.describe(e)}", error: true);
            });
          }
        },
      ),
      UserSelect(label: 'Approver', value: approver, onChanged: (v) => setS(() => approver = v)),
      const Hint("You can't approve your own adjustment, so you're left out of the list."),
      AppTextField(label: 'Reason', controller: reason),
      AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
      FormHeading('Items (${lines.length})'),
      if (loc == null) const Hint('Select a store first to see current system quantities.'),
      for (var i = 0; i < lines.length; i++)
        () {
          final l = lines[i];
          final existing = l.itemId == null ? null : (stock?.byItem[l.itemId]?.onHand ?? (stock == null ? null : 0.0));
          final actual = parseNum(l.qty.text);
          final diff = existing != null && actual != null ? actual - existing : null;
          return LineBox(
            key: ObjectKey(l),
            title: 'Line ${i + 1}',
            onRemove: lines.length == 1 ? null : () => setS(() => lines.remove(l)),
            children: [
              ItemSelect(value: l.itemId, enabled: loc != null, onChanged: (it) => setS(() => l.itemId = toInt(it?['id']))),
              Row(children: [
                Expanded(child: MiniFact('Existing Qty', existing == null ? '—' : fmtQ(existing))),
                Expanded(
                  child: MiniFact('Difference', diff == null ? '' : '${diff > 0 ? '+' : ''}${fmtQ(diff)}',
                      bold: true, color: diff == null || diff == 0 ? Brand.muted : (diff > 0 ? cGreen : const Color(0xFFB91C1C))),
                ),
              ]),
              AppTextField(
                  label: 'Actual Qty', required: true, controller: l.qty, keyboardType: AppTextField.number, onChanged: (_) => setS(() {})),
              AppTextField(label: 'Remarks', controller: l.remarks),
            ],
          );
        }(),
      AddLineButton('Add Item', onPressed: loc == null ? null : () => setS(() => lines.add(_AdjLine()))),
    ],
    onSave: () async {
      final problems = <String>[];
      if (loc == null) problems.add('Store is required.');
      if (approver == null) problems.add('Approver is required — pick who must approve this adjustment before it changes stock.');
      final valid = lines.where((l) => l.itemId != null && l.qty.text.trim().isNotEmpty).toList();
      if (valid.isEmpty) problems.add('At least one item is required.');
      if (valid.any((l) => (parseNum(l.qty.text) ?? 0) < 0)) problems.add('Actual quantity cannot be negative.');
      if (problems.isNotEmpty) throw problems.join('\n');
      saved = jsonMap(await Api.post('/store/stock-adjustments', data: {
        'location_id': loc,
        'approved_by_id': approver,
        'reason': blankToNull(reason.text),
        'remarks': blankToNull(remarks.text),
        'items': [
          for (final l in valid)
            {'item_id': l.itemId, 'actual_quantity': parseNum(l.qty.text), 'remarks': blankToNull(l.remarks.text)},
        ],
      }));
    },
  );
  return ok ? saved : null;
}

class AdjustmentDetailScreen extends StatefulWidget {
  const AdjustmentDetailScreen({super.key, required this.adjustmentId});
  final int adjustmentId;

  @override
  State<AdjustmentDetailScreen> createState() => _AdjustmentDetailScreenState();
}

class _AdjustmentDetailScreenState extends State<AdjustmentDetailScreen> {
  int _v = 0;

  @override
  Widget build(BuildContext context) => ApiLoader<(Json, bool?)>(
        key: ValueKey(_v),
        load: () async {
          final a = jsonMap(await Api.get('/store/stock-adjustments/${widget.adjustmentId}'));
          bool? onEngine;
          try {
            onEngine = jsonMap(await Api.get('/approvals/entity/stock_adjustment/${widget.adjustmentId}'))['current'] != null;
          } catch (_) {}
          return (a, onEngine);
        },
        builder: (ctx, data, reload) {
          final (a, onEngine) = data;
          final status = a['status'];
          // Adjustments raised before Approval Workflows keep the named-approver buttons.
          final pending = status == 'pending_approval' && onEngine == false;
          final isCreator = a['created_by_id'] == Perm.userId;
          final canDecide = pending && !isCreator && (a['approved_by_id'] == Perm.userId || Perm.isAdmin);
          final items = jsonList(a['items']);
          return SubPage(
            title: txt(a['adjustment_number']),
            bottom: canDecide
                ? actionBar([
                    if (can('adjustments', 'reject'))
                      secondaryAction('Reject', () async {
                        final reason = await promptDialog(ctx,
                            title: 'Reject this adjustment?',
                            label: 'Reason — e.g. recount bin A-3, count sheet missing',
                            confirmLabel: 'Reject');
                        if (reason == null || !ctx.mounted) return;
                        final ok = await runAction(
                            ctx, () => Api.post('/store/stock-adjustments/${a['id']}/reject', data: {'reason': reason}));
                        if (ok) setState(() => _v++);
                      }, color: cRed),
                    if (can('adjustments', 'approve'))
                      primaryAction('Approve & Post', () async {
                        final ok = await confirmDialog(ctx,
                            title: 'Approve and post this adjustment?',
                            message: "Each line's difference will be posted to stock at this store. This can't be undone from here.",
                            confirmLabel: 'Approve & Post');
                        if (!ok || !ctx.mounted) return;
                        final done = await runAction(ctx, () => Api.post('/store/stock-adjustments/${a['id']}/approve'));
                        if (done) setState(() => _v++);
                      }),
                  ])
                : null,
            body: detailList([
              if (pending)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                  child: InfoNote(
                      canDecide
                          ? "This adjustment has not changed stock yet. Approving posts each line's difference to stock."
                          : isCreator
                              ? "Waiting for ${a['approved_by_name'] ?? 'the named approver'} to approve — you can't approve an adjustment you created. Stock is unchanged until then."
                              : 'Waiting for ${a['approved_by_name'] ?? 'the named approver'} to approve. Stock is unchanged until then.',
                      color: const Color(0xFFF59E0B)),
                ),
              if (onEngine == true) ApprovalPanel(entityType: 'stock_adjustment', entityId: toInt(a['id'])!, onChanged: () => setState(() => _v++)),
              SummaryCard(
                title: txt(a['adjustment_number']),
                text:
                    'Corrects the book stock of ${items.length} item line${items.length == 1 ? '' : 's'} at ${a['location_name'] ?? 'the store'} to the physically counted quantity${a['reason'] != null ? ' — ${a['reason']}' : ''}.',
                badges: [pill(_adjLabel[status] ?? humanize(status), _adjColor[status] ?? cGrey)],
                meta: [fmtDate(a['adjustment_date']), if (a['created_by_name'] != null) 'Raised by ${a['created_by_name']}'],
              ),
              DetailSection('Adjustment', children: [
                FieldRow('Store', a['location_name']),
                FieldRow('Reason', a['reason']),
                FieldRow(status == 'pending_approval' ? 'Approver' : (status == 'rejected' ? 'Rejected By' : 'Approved By'),
                    a['approved_by_name']),
                if (status == 'rejected') FieldRow('Rejection Reason', a['rejected_reason']),
                FieldRow('Remarks', a['remarks']),
              ]),
              DetailSection('Items (${items.length})', children: [
                for (final l in items)
                  () {
                    final d = numOr0(l['difference']);
                    return LineTile(
                      title: '${txt(l['item_code'])} — ${txt(l['item_name'])}',
                      facts: [
                        MiniFact('Qty at Count', fmtQ(l['existing_quantity'], l['uom'])),
                        MiniFact('Counted Qty', fmtQ(l['actual_quantity'], l['uom'])),
                        MiniFact('Difference', '${d > 0 ? '+' : ''}${fmtQ(d)}',
                            bold: true, color: d == 0 ? Brand.muted : (d > 0 ? const Color(0xFF15803D) : const Color(0xFFB91C1C))),
                        if (l['remarks'] != null) MiniFact('Remarks', txt(l['remarks'])),
                      ],
                    );
                  }(),
              ]),
            ]),
          );
        },
      );
}

// ── Reorder ──────────────────────────────────────────────────────────────────

class ReorderTab extends StatefulWidget {
  const ReorderTab({super.key});

  @override
  State<ReorderTab> createState() => _ReorderTabState();
}

class _ReorderTabState extends State<ReorderTab> {
  final _list = GlobalKey<ApiListViewState>();
  String? _category;
  bool _dueOnly = true;
  int _due = 0;
  List<Json> _cats = const [];

  @override
  void initState() {
    super.initState();
    StoreData.categories().then((c) {
      if (mounted) setState(() => _cats = c);
    }, onError: (Object _) {});
  }

  @override
  Widget build(BuildContext context) => ApiListView(
        key: _list,
        load: (page, s) async {
          final p = await Api.list('/store/reorder', query: {'category': _category, 'due_only': _dueOnly});
          if (mounted) setState(() => _due = p.rows.where((r) => r['due'] == true).length);
          return p;
        },
        emptyText: _dueOnly
            ? 'Nothing is due for reorder — every item is above its reorder level.'
            : 'No items have a reorder level or minimum stock set yet — set them on the item (Planning / plant data).',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const StorePageHeader('Reorder',
              subtitle:
                  "Items whose projected stock — available plus what is already on order (open requisitions and POs) — is at or below their reorder level. Levels come from the item's plant data (per plant, that plant's stores) or, without plant data, from the Item Master."),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
            child: AppSelect<String>(
              label: 'All categories',
              value: _category,
              options: [for (final c in _cats) Option(c['name'].toString(), txt(c['name']))],
              onChanged: (o) {
                setState(() => _category = o?.value);
                _list.currentState?.reload();
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: CheckField(
                label: 'Only items due for reorder · $_due due',
                value: _dueOnly,
                onChanged: (v) {
                  setState(() => _dueOnly = v);
                  _list.currentState?.reload();
                }),
          ),
        ]),
        itemBuilder: (ctx, r, reload) {
          final docs = r['on_order_docs'] is List ? (r['on_order_docs'] as List) : const [];
          return RecordCard(
            code: txt(r['item_code']),
            title: '${txt(r['item_name'])}${r['uom'] != null ? ' (${r['uom']})' : ''}',
            subtitle: txt(r['plant_name'] ?? 'All plants'),
            trailing: Text(fmtQ(r['projected']),
                style: TextStyle(fontWeight: FontWeight.w700, color: r['due'] == true ? cRed : Brand.body)),
            meta: [
              ('Available', '${fmtQ(r['available'])}${numOr0(r['reserved']) > 0 ? ' (${fmtQ(r['reserved'])} reserved)' : ''}'),
              ('On order', '${fmtQ(r['on_order'])}${docs.isNotEmpty ? ' · ${docs.join(', ')}' : ''}'),
              ('Projected', fmtQ(r['projected'])),
              ('Reorder level', fmtQ(r['reorder_level'])),
              ('Min / Max', '${fmtQ(r['minimum_stock'])} / ${fmtQ(r['maximum_stock'])}'),
              ('Lead time', r['lead_time_days'] != null ? '${r['lead_time_days']} day${r['lead_time_days'] == 1 ? '' : 's'}' : '—'),
              if (r['due'] == true) ('Order qty', fmtQ(r['suggested_qty'])),
            ],
          );
        },
      );
}

// ── Physical count ───────────────────────────────────────────────────────────

const _countLabel = {
  'counting': 'Counting (stock frozen)',
  'submitted': 'Awaiting approval',
  'posted': 'Posted',
  'cancelled': 'Cancelled',
};
const _countColor = {'counting': cAmber, 'submitted': cBlue, 'posted': cGreen, 'cancelled': Color(0xFF94A3B8)};

class PhysicalCountTab extends StatefulWidget {
  const PhysicalCountTab({super.key});

  @override
  State<PhysicalCountTab> createState() => _PhysicalCountTabState();
}

class _PhysicalCountTabState extends State<PhysicalCountTab> {
  final _list = GlobalKey<ApiListViewState>();

  Future<void> _start() async {
    int? loc;
    String? category;
    bool blind = true;
    final remarks = TextEditingController();
    final cats = await StoreData.categories().catchError((_) => <Json>[]);
    if (!mounted) return;
    Json? saved;
    final ok = await showFormSheet(
      context,
      title: 'Start a Count',
      saveLabel: 'Start count',
      builder: (ctx, setS) => [
        const Hint('Book stock is snapshotted and the counted items are frozen at that store until the count is submitted or cancelled.'),
        const FormHeading('Scope'),
        LocationSelect(value: loc, onChanged: (l) => setS(() => loc = toInt(l?['id']))),
        AppSelect<String>(
          label: 'Category (blank = all stocked items)',
          value: category,
          options: [for (final c in cats) Option(c['name'].toString(), txt(c['name']))],
          onChanged: (o) => setS(() => category = o?.value),
        ),
        CheckField(label: "Blind count (counters don't see book stock)", value: blind, onChanged: (v) => setS(() => blind = v)),
        const Hint('Blind is recommended — counters count what is really there instead of confirming the system figure.'),
        const FormHeading('Remarks'),
        AppTextField(label: 'Remarks', controller: remarks, hint: 'e.g. Year-end count 2026-27'),
      ],
      onSave: () async {
        if (loc == null) throw 'Pick the store to count.';
        saved = jsonMap(await Api.post('/store/physical-counts',
            data: {'location_id': loc, 'category': category, 'blind': blind, 'remarks': blankToNull(remarks.text)}));
      },
    );
    if (ok && saved != null && mounted) {
      _list.currentState?.reload();
      openThen(context, PhysicalCountScreen(countId: toInt(saved!['id'])!), () => _list.currentState?.reload());
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = canFeature('adjustments', 'cycle_count', 'create');
    return Scaffold(
      floatingActionButton: canCreate ? CreateFab(label: 'Start Count', onPressed: _start) : null,
      body: ApiListView(
        key: _list,
        load: (page, s) => Api.list('/store/physical-counts'),
        emptyText: 'No physical counts yet${canCreate ? ' — use + Start Count to count a store against the books.' : '.'}',
        header: const StorePageHeader('Physical Count',
            subtitle:
                'Count what is on the shelf against the books. Counted items are frozen at that store while counting; differences go to a Store Manager for approval before stock changes.'),
        itemBuilder: (ctx, c, reload) => RecordCard(
          code: txt(c['count_number']),
          title: txt(c['location_name']),
          subtitle: txt(c['scope'] ?? 'All stocked items'),
          trailing: pill(_countLabel[c['status']] ?? humanize(c['status']), _countColor[c['status']] ?? cGrey),
          meta: [
            ('Date', fmtDate(c['count_date'])),
            ('Lines', '${fmtQ(c['lines_counted'])} / ${fmtQ(c['lines_total'])} counted'),
            ('Adjustment', txt(c['adjustment_number'])),
          ],
          onTap: () => openThen(ctx, PhysicalCountScreen(countId: toInt(c['id'])!), reload),
        ),
      ),
    );
  }
}

class PhysicalCountScreen extends StatefulWidget {
  const PhysicalCountScreen({super.key, required this.countId});
  final int countId;

  @override
  State<PhysicalCountScreen> createState() => _PhysicalCountScreenState();
}

class _PhysicalCountScreenState extends State<PhysicalCountScreen> {
  Json? _count;
  Object? _error;
  bool _busy = false;
  final Map<int, (TextEditingController, TextEditingController)> _entries = {};
  int? _addItem;
  int? _approver;
  final _reason = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _apply(Json c) {
    _entries.clear();
    for (final l in jsonList(c['items'])) {
      _entries[toInt(l['id'])!] = (
        TextEditingController(text: l['counted_quantity'] == null ? '' : '${l['counted_quantity']}'),
        TextEditingController(text: l['remarks']?.toString() ?? ''),
      );
    }
    setState(() => _count = c);
  }

  Future<void> _load() async {
    try {
      _apply(jsonMap(await Api.get('/store/physical-counts/${widget.countId}')));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _run(Future<dynamic> Function() fn, [String? done]) async {
    setState(() => _busy = true);
    try {
      final r = await fn();
      if (r is Map) _apply(jsonMap(r));
      if (done != null && mounted) showSnack(context, done);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  List<Json> get _changed => [
        for (final l in jsonList(_count?['items']))
          if (_entries[toInt(l['id'])] != null &&
              _entries[toInt(l['id'])]!.$1.text.trim().isNotEmpty &&
              (parseNum(_entries[toInt(l['id'])]!.$1.text) != toNum(l['counted_quantity']) ||
                  _entries[toInt(l['id'])]!.$2.text != (l['remarks'] ?? '')))
            l,
      ];

  @override
  Widget build(BuildContext context) {
    final c = _count;
    if (c == null) {
      return SubPage(
          title: 'Physical Count', body: _error == null ? const LoadingView() : ErrorView(_error!, onRetry: _load));
    }
    final canEdit = canFeature('adjustments', 'cycle_count', 'edit');
    final canSubmit = canFeature('adjustments', 'cycle_count', 'submit');
    final canCancel = canFeature('adjustments', 'cycle_count', 'cancel');
    final counting = c['status'] == 'counting';
    final editable = counting && canEdit;
    final items = jsonList(c['items']);
    final changed = _changed;
    return SubPage(
      title: txt(c['count_number']),
      bottom: counting && (canEdit || canSubmit || canCancel)
          ? actionBar([
              if (canCancel)
                secondaryAction('Cancel count', _busy
                    ? null
                    : () async {
                        final r = await promptDialog(context,
                            title: 'Cancel ${txt(c['count_number'])}?',
                            message: 'Nothing is posted and the frozen items can move again.',
                            label: 'Why is it being cancelled?',
                            confirmLabel: 'Cancel count');
                        if (r != null) {
                          await _run(() => Api.post('/store/physical-counts/${c['id']}/cancel', data: {'reason': r}), 'Count cancelled.');
                        }
                      }, color: cRed),
              if (canEdit)
                secondaryAction('Save counts', _busy || changed.isEmpty
                    ? null
                    : () {
                        final bad = changed.where((l) => (parseNum(_entries[toInt(l['id'])]!.$1.text) ?? -1) < 0).toList();
                        if (bad.isNotEmpty) {
                          showSnack(context, "'${txt(bad.first['item_name'])}': enter a quantity of 0 or more.", error: true);
                          return;
                        }
                        _run(
                            () => Api.put('/store/physical-counts/${c['id']}/counts', data: {
                                  'lines': [
                                    for (final l in changed)
                                      {
                                        'line_id': l['id'],
                                        'counted_quantity': parseNum(_entries[toInt(l['id'])]!.$1.text),
                                        'remarks': blankToNull(_entries[toInt(l['id'])]!.$2.text),
                                      }
                                  ]
                                }),
                            'Counts saved.');
                      }),
              if (canSubmit)
                primaryAction('Submit count', _busy
                    ? null
                    : () {
                        if (changed.isNotEmpty) {
                          showSnack(context, 'Save the counts you entered first.', error: true);
                          return;
                        }
                        _run(
                            () => Api.post('/store/physical-counts/${c['id']}/submit',
                                data: {'approver_id': _approver ?? 0, 'reason': blankToNull(_reason.text)}),
                            'Count submitted. If there were differences, the Store Manager approves them before stock changes.');
                      }),
            ])
          : null,
      body: RefreshIndicator(
        onRefresh: _load,
        child: detailList([
          SummaryCard(
            title: txt(c['count_number']),
            text:
                'Physical count of ${c['scope'] ?? 'all stocked items'} at ${txt(c['location_name'])} — ${fmtQ(c['lines_counted'])} of ${fmtQ(c['lines_total'])} lines counted${c['book_hidden'] == true ? ' (blind count)' : ''}.',
            badges: [pill(_countLabel[c['status']] ?? humanize(c['status']), _countColor[c['status']] ?? cGrey)],
            meta: [fmtDate(c['count_date'])],
          ),
          DetailSection('Count', children: [
            FieldRow('Store', c['location_name']),
            FieldRow('Scope', c['scope'] ?? 'All stocked items'),
            FieldRow('Lines counted', '${fmtQ(c['lines_counted'])} of ${fmtQ(c['lines_total'])}'),
            if (c['lines_with_difference'] != null) FieldRow('Lines with difference', fmtQ(c['lines_with_difference'])),
            if (c['adjustment_number'] != null)
              FieldRow(
                  'Stock Adjustment',
                  InkWell(
                    onTap: toInt(c['adjustment_id']) == null
                        ? null
                        : () => openScreen(context, AdjustmentDetailScreen(adjustmentId: toInt(c['adjustment_id'])!)),
                    child: Text(
                        '${c['adjustment_number']}${c['adjustment_status'] != null ? ' (${_adjLabel[c['adjustment_status']] ?? c['adjustment_status']})' : ''}',
                        style: const TextStyle(fontWeight: FontWeight.w700, color: cBlue)),
                  )),
            if (c['cancel_reason'] != null) FieldRow('Cancelled because', c['cancel_reason']),
            if (counting)
              Hint(
                  "These items can't be received, issued or transferred at ${txt(c['location_name'])} until this count is submitted or cancelled."
                  '${c['book_hidden'] == true ? ' Blind count — book stock is hidden; count what is physically there, and enter 0 for anything not found.' : ''}',
                  color: const Color(0xFFB45309)),
          ]),
          DetailSection('Count Lines (${items.length})', children: [
            for (final l in items)
              () {
                final e = _entries[toInt(l['id'])];
                final d = toNum(l['difference']);
                return LineTile(
                  title: '${txt(l['item_code'])} — ${txt(l['item_name'])}',
                  subtitle: txt(l['uom']),
                  facts: [
                    MiniFact('Book', l['book_quantity'] != null ? fmtQ(l['book_quantity']) : 'hidden'),
                    if (!editable) MiniFact('Counted', fmtQ(l['counted_quantity'])),
                    MiniFact('First count', (toInt(l['count_rounds']) ?? 0) > 1 ? fmtQ(l['first_counted_quantity']) : '—'),
                    MiniFact('Difference', d == null ? '—' : (d > 0 ? '+${fmtQ(d)}' : fmtQ(d)),
                        bold: true, color: d == null || d == 0 ? Brand.muted : (d > 0 ? cGreen : cRed)),
                    if (!editable && l['remarks'] != null) MiniFact('Remarks', txt(l['remarks'])),
                  ],
                  extra: editable && e != null
                      ? Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Row(children: [
                            Expanded(
                                child: AppTextField(
                                    label: 'Counted', controller: e.$1, keyboardType: AppTextField.number, onChanged: (_) => setState(() {}))),
                            const SizedBox(width: 8),
                            Expanded(
                                flex: 2,
                                child: AppTextField(
                                    label: 'Remarks', controller: e.$2, hint: 'e.g. 2 pcs damaged', onChanged: (_) => setState(() {}))),
                          ]),
                        )
                      : null,
                );
              }(),
            if (editable) ...[
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: ItemSelect(
                    label: 'Found something not on the list? Add item…',
                    required: false,
                    activeOnly: true,
                    where: (i) => !items.any((l) => l['item_id'] == i['id']),
                    value: _addItem,
                    onChanged: (it) => setState(() => _addItem = toInt(it?['id'])),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filledTonal(
                  tooltip: 'Add to count',
                  icon: const Icon(Icons.add_rounded),
                  onPressed: _addItem == null || _busy
                      ? null
                      : () {
                          final id = _addItem;
                          setState(() => _addItem = null);
                          _run(() => Api.post('/store/physical-counts/${c['id']}/items', data: {'item_id': id}));
                        },
                ),
              ]),
            ],
          ]),
          if (counting && canSubmit)
            DetailSection('Submit Count', children: [
              const Hint(
                  'Every line must be counted. Differences become one Stock Adjustment that a Store Manager (not you) approves; stock changes only on approval. With no difference the count closes at once.'),
              const SizedBox(height: 10),
              UserSelect(
                  label: 'Store Manager to approve differences',
                  required: false,
                  value: _approver,
                  onChanged: (v) => setState(() => _approver = v)),
              const SizedBox(height: 10),
              AppTextField(label: 'Reason', controller: _reason, hint: 'e.g. Year-end physical count'),
              const SizedBox(height: 6),
              const Hint('Save the counts first, then submit with the button below.'),
            ]),
        ]),
      ),
    );
  }
}
