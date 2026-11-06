import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';
import 'pr_detail.dart';
import 'pr_form.dart';

// Purchase Requisitions tab (portal app/dashboard/p2p/page.tsx + components/p2p/P2PRequestList.tsx).

const _segments = <String, (String, List<String>?, String)>{
  'waiting': ('Waiting for me', ['submitted'], 'Nothing is waiting for your approval.'),
  'approved': (
    'Approved',
    [
      'approved', 'vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected', 'po_drafted',
      'po_raised', 'po_approved', 'partially_received', 'received', 'closed',
    ],
    'No approved requisitions yet.'
  ),
  'rejected': ('Rejected', ['rejected'], 'No rejected requisitions.'),
  'all': ('All', null, 'No Purchase Requisitions yet.'),
};

class RequisitionsTab extends StatefulWidget {
  const RequisitionsTab({super.key, required this.prApprover});
  final bool prApprover;

  @override
  State<RequisitionsTab> createState() => _RequisitionsTabState();
}

class _RequisitionsTabState extends State<RequisitionsTab> {
  String? _picked;
  int? _waitingCount;
  int _listKey = 0;

  bool get _canApprove => widget.prApprover && P2pAccess.feat('purchase_requisitions', 'approvals', 'view');
  bool get _canMine => P2pAccess.feat('purchase_requisitions', 'my_requisitions', 'view');
  bool get _canAll => P2pAccess.feat('purchase_requisitions', 'all_requisitions', 'view');

  List<String> get _views => [
        if (_canApprove) 'waiting',
        if (_canMine) ...['approved', 'rejected'],
        if (_canAll) 'all',
      ];

  String get _view {
    final v = _views;
    if (_picked != null && v.contains(_picked)) return _picked!;
    if (v.contains('all')) return 'all';
    return v.isEmpty ? 'all' : v.first;
  }

  @override
  void initState() {
    super.initState();
    if (_canApprove) _loadWaiting();
  }

  Future<void> _loadWaiting() async {
    try {
      final rows = (await Api.list('/p2p/requests', query: {'limit': 1000, 'queue': 'pr-approval'})).rows;
      final n = rows.where((pr) => jStr(pr, 'status') == 'submitted' && pendingOnViewer(pr)).length;
      if (mounted) setState(() => _waitingCount = n);
    } catch (_) {/* badge only */}
  }

  Future<void> _newPr() async {
    final created = await openPrForm(context);
    if (created != null && mounted) {
      setState(() => _listKey++);
      openScreen(context, PrDetailScreen(prId: created));
    }
  }

  Future<void> _import() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Import purchase requisitions',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading)),
            const SizedBox(height: 8),
            const Text(
                'One row per item. Rows with the same PR Ref become one requisition. Category Code, Project Type (existing / new), Project, '
                'Item Name, Quantity and Project / Inhouse are required. Each one goes for approval like a requisition raised by hand '
                '(Organization › Approval Workflows).'),
            const SizedBox(height: 14),
            Wrap(spacing: 8, runSpacing: 8, children: [
              secondaryBtn('Download template', () {
                Navigator.pop(ctx);
                openApiFile(context, '/p2p/requests/import/template', 'purchase_requisition_import_template.csv');
              }, icon: Icons.download_outlined),
              primaryBtn('Pick file & import', () {
                Navigator.pop(ctx);
                _doImport();
              }, icon: Icons.upload_file_outlined),
            ]),
          ]),
        ),
      ),
    );
  }

  Future<void> _doImport() async {
    final f = await Files.pickFile(extensions: ['csv', 'xlsx']);
    if (f == null || !mounted) return;
    final r = await withLoading(context, () async => asJson(await Api.post('/p2p/requests/import', data: formData({'file': f}))));
    if (r == null || !mounted) return;
    final created = jList(r, 'created');
    final errors = jList(r, 'errors');
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Import finished'),
        content: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text('Requisitions created: ${created.length}'
                '${created.isEmpty ? '' : ' (${created.map((c) => c['p2p_number']).join(', ')})'}'),
            for (final e in errors)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('PR Ref ${e['ref']} (row ${e['row']}): ${e['reason']}', style: const TextStyle(color: Brand.danger)),
              ),
          ]),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );
    if (mounted) setState(() => _listKey++);
  }

  @override
  Widget build(BuildContext context) {
    final views = _views;
    final view = _view;
    final seg = _segments[view]!;
    final canCreate = P2pAccess.can('purchase_requisitions', 'create');
    final header = <Widget>[
      PageHeader('Purchase Requisitions', actions: [
        if (P2pAccess.can('purchase_requisitions', 'export'))
          IconButton(
            tooltip: 'Export',
            icon: const Icon(Icons.download_outlined),
            onPressed: () => openApiFile(context, '/p2p/requests/export', 'purchase_requisitions.xlsx'),
          ),
        if (canCreate) IconButton(tooltip: 'Import', icon: const Icon(Icons.upload_outlined), onPressed: _import),
      ]),
      if (views.length > 1)
        SegmentRow(
          items: [for (final v in views) (v, _segments[v]!.$1, v == 'waiting' ? _waitingCount : null)],
          selected: view,
          onTap: (v) => setState(() {
            _picked = v;
            _listKey++;
          }),
        ),
    ];
    return Scaffold(
      floatingActionButton: canCreate ? CreateFab(label: 'New Purchase Requisition', onPressed: _newPr) : null,
      body: views.isEmpty
          ? ListView(children: [
              ...header,
              const EmptyView(
                  'Your role does not show any requisition tab. Ask an administrator to switch one on for your role '
                  '(Organization › Role & Permissions › Purchase Requisitions).'),
            ])
          : PrList(
              key: ValueKey('$view-$_listKey'),
              statuses: seg.$2,
              emptyLabel: seg.$3,
              queue: view == 'waiting' ? 'pr-approval' : null,
              contextKey: view == 'waiting' ? 'approval' : null,
              onlyPendingForViewer: view == 'waiting',
              showFilters: true,
              mineToggle: true,
              showChips: true,
              top: header,
            ),
    );
  }
}

/// "Pending" in the approval queue = pending on THE VIEWER.
bool pendingOnViewer(Json pr) {
  if (P2pAccess.isAdmin) return true;
  final me = P2pAccess.me;
  final engine = pr['engine_approval'] is Map ? asJson(pr['engine_approval']) : null;
  if (engine != null) return jStr(engine, 'status') == 'pending' && jBool(engine, 'can_decide');
  final approvals = jList(pr, 'approvals');
  if (approvals.isNotEmpty) return approvals.any((a) => jInt(a, 'approver_id') == me && a['approved_at'] == null);
  if (jInt(pr, 'approver_id') == me && pr['department_head_approved_at'] == null) return true;
  if (jInt(pr, 'project_head_id') == me && pr['project_head_approved_at'] == null) return true;
  if (jInt(pr, 'plant_head_id') == me && pr['plant_head_approved_at'] == null) return true;
  return false;
}

const _groups = <String, (String, List<String>)>{
  'pending': ('Pending approval', ['submitted']),
  'progress': ('In progress (all stages)', inProgressStatuses),
  'closed': ('Closed (received / closed)', ['received', 'closed']),
};

bool _matchesStatus(String status, String filter) {
  if (filter.isEmpty) return true;
  if (filter.startsWith('group:')) return _groups[filter.substring(6)]?.$2.contains(status) ?? false;
  return status == filter;
}

typedef ProjectPick = ({int projectId, int? elementId, String label});

/// The requisition list (portal P2PRequestList): search, Filters popup,
/// count chips, PR number sort, and the PO-approval inline decisions.
class PrList extends StatefulWidget {
  const PrList({
    super.key,
    this.statuses,
    required this.emptyLabel,
    this.contextKey,
    this.queue,
    this.onlyPendingForViewer = false,
    this.showFilters = false,
    this.mineToggle = false,
    this.showChips = false,
    this.top = const [],
  });

  final List<String>? statuses;
  final String emptyLabel;

  /// 'approval' | 'po-approval' | null - how the detail opens.
  final String? contextKey;
  final String? queue;
  final bool onlyPendingForViewer;
  final bool showFilters;
  final bool mineToggle;
  final bool showChips;
  final List<Widget> top;

  @override
  State<PrList> createState() => _PrListState();
}

class _PrListState extends State<PrList> {
  final _listKey = GlobalKey<ApiListViewState>();
  List<Json>? _all;
  bool _useCache = false;
  String _search = '';
  bool _sortAsc = true;
  String _status = '';
  String _category = '';
  String _buyer = '';
  bool _mine = false;
  ProjectPick? _project;
  ({int total, int pending, int progress, int closed}) _stats = (total: 0, pending: 0, progress: 0, closed: 0);

  Future<List<Json>> _fetch() async {
    final q = <String, dynamic>{'limit': 1000, 'queue': widget.queue};
    final p = _project;
    if (p != null) {
      if (p.elementId != null) {
        q['order_project_element_id'] = p.elementId;
      } else {
        q['order_project_id'] = p.projectId;
      }
    }
    final rows = (await Api.list('/p2p/requests', query: q)).rows;
    final st = widget.statuses;
    return st == null ? rows : rows.where((pr) => st.contains(jStr(pr, 'status'))).toList();
  }

  Future<ApiPage> _load(int page, String search) async {
    if (_all == null || !_useCache) _all = await _fetch();
    _useCache = false;
    _search = search;
    final me = P2pAccess.me;
    final q = search.toLowerCase();
    final anyStatus = _all!.where((pr) {
      if (widget.onlyPendingForViewer && !pendingOnViewer(pr)) return false;
      if (_mine && jInt(pr, 'requested_by_id') != me) return false;
      if (_category.isNotEmpty && jStr(pr, 'category_code') != _category) return false;
      if (_buyer.isNotEmpty) {
        final b = jInt(pr, 'assigned_buyer_id');
        if (_buyer == 'none' ? b != null : '$b' != _buyer) return false;
      }
      if (q.isNotEmpty &&
          ![pr['p2p_number'], pr['category_label'], pr['project_label'], pr['requested_by_name'], pr['assigned_buyer_name']]
              .any((x) => (x ?? '').toString().toLowerCase().contains(q))) {
        return false;
      }
      return true;
    }).toList();
    final shown = anyStatus.where((pr) => _matchesStatus(jStr(pr, 'status') ?? '', _status)).toList()
      ..sort((a, b) => (_sortAsc ? 1 : -1) * naturalCompare(jStr(a, 'p2p_number') ?? '', jStr(b, 'p2p_number') ?? ''));
    final stats = (
      total: anyStatus.length,
      pending: anyStatus.where((pr) => jStr(pr, 'status') == 'submitted').length,
      progress: anyStatus.where((pr) => inProgressStatuses.contains(jStr(pr, 'status'))).length,
      closed: anyStatus.where((pr) => const ['received', 'closed'].contains(jStr(pr, 'status'))).length,
    );
    if (mounted) setState(() => _stats = stats);
    return ApiPage(shown);
  }

  /// Re-filter what is loaded (no server call).
  void _refilter() {
    _useCache = true;
    _listKey.currentState?.reload();
  }

  /// Read again from the server.
  void _refetch() {
    _useCache = false;
    _listKey.currentState?.reload();
  }

  void _toggleChip(String? group) {
    setState(() => _status = group == null || _status == 'group:$group' ? '' : 'group:$group');
    _refilter();
  }

  int get _activeCount =>
      [_category, _buyer, _status].where((v) => v.isNotEmpty).length + (_project != null ? 1 : 0) + (_mine ? 1 : 0);

  Future<void> _openFilters() async {
    final rows = _all ?? const <Json>[];
    var status = _status;
    var category = _category;
    var buyer = _buyer;
    var mine = _mine;
    var project = _project;
    final cats = <String, String>{};
    final buyers = <String, String>{};
    final statuses = <String, String>{};
    for (final pr in rows) {
      final code = jStr(pr, 'category_code');
      if (code != null) cats[code] = jStr(pr, 'category_label') ?? code;
      final b = jInt(pr, 'assigned_buyer_id');
      if (b != null) buyers['$b'] = jStr(pr, 'assigned_buyer_name') ?? 'User #$b';
      final s = jStr(pr, 'status');
      if (s != null) statuses[s] = prStatusLabels[s] ?? humanize(s);
    }
    List<Option<String>> sorted(Map<String, String> m) =>
        (m.entries.map((e) => Option(e.key, e.value)).toList()..sort((a, b) => a.label.compareTo(b.label)));
    final applied = await showFormSheet(
      context,
      title: 'Filters',
      saveLabel: 'Apply Filters',
      builder: (ctx, setS) => [
        const Hint('Narrow the requisitions, then press Apply.'),
        AppSelect<String>(
          label: 'Status',
          value: status.isEmpty ? null : status,
          options: [
            for (final g in _groups.entries) Option('group:${g.key}', g.value.$1),
            ...sorted(statuses),
          ],
          onChanged: (o) => setS(() => status = o?.value ?? ''),
        ),
        AppSelect<String>(
          label: 'Category',
          value: category.isEmpty ? null : category,
          options: sorted(cats),
          onChanged: (o) => setS(() => category = o?.value ?? ''),
        ),
        AppSelect<String>(
          label: 'Buyer',
          value: buyer.isEmpty ? null : buyer,
          options: [...sorted(buyers), const Option('none', 'No buyer assigned')],
          onChanged: (o) => setS(() => buyer = o?.value ?? ''),
        ),
        if (widget.mineToggle) CheckField(label: 'Raised by me', value: mine, onChanged: (v) => setS(() => mine = v)),
        AppSelect<String>(
          label: 'Project',
          value: project == null ? null : '${project!.projectId}:${project!.elementId ?? ''}',
          valueLabel: project?.label,
          loadOptions: projectUnitOptions,
          onChanged: (o) => setS(() => project = o == null ? null : _pick(o)),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: secondaryBtn('Clear Filters', () {
            setS(() {
              status = '';
              category = '';
              buyer = '';
              mine = false;
              project = null;
            });
          }),
        ),
      ],
      onSave: () async {},
    );
    if (!applied) return;
    final projectChanged = project?.projectId != _project?.projectId || project?.elementId != _project?.elementId;
    setState(() {
      _status = status;
      _category = category;
      _buyer = buyer;
      _mine = mine;
      _project = project;
    });
    projectChanged ? _refetch() : _refilter();
  }

  ProjectPick _pick(Option<String> o) {
    final parts = o.value.split(':');
    return (projectId: int.parse(parts[0]), elementId: int.tryParse(parts.length > 1 ? parts[1] : ''), label: o.label);
  }

  void _clear() {
    final projectChanged = _project != null;
    setState(() {
      _status = '';
      _category = '';
      _buyer = '';
      _mine = false;
      _project = null;
    });
    projectChanged ? _refetch() : _refilter();
  }

  bool _enginePo(Json pr) {
    final e = pr['engine_approval'] is Map ? asJson(pr['engine_approval']) : null;
    return e != null && jStr(e, 'entity_type') == 'p2p_purchase_order' && jStr(e, 'status') == 'pending';
  }

  bool _canApprovePo(Json pr) {
    if (widget.contextKey != 'po-approval' || jStr(pr, 'status') != 'po_raised') return false;
    if (_enginePo(pr)) return jBool(asJson(pr['engine_approval']), 'can_decide');
    final pending = jStrings(pr, 'pending_po_approval_roles');
    return userPoRoles(pr).any(pending.contains);
  }

  bool _canRejectPo(Json pr) {
    if (widget.contextKey != 'po-approval' || jStr(pr, 'status') != 'po_raised') return false;
    if (_enginePo(pr)) return jBool(asJson(pr['engine_approval']), 'can_decide');
    return userPoRoles(pr).isNotEmpty || P2pAccess.isAdmin;
  }

  Future<void> _decidePo(Json pr, bool approve) async {
    final value = jNum(pr, 'po_value');
    final text = await promptDialog(
      context,
      title: approve ? 'Approve this PO?' : 'Reject this PO?',
      message: '${pr['p2p_number']}${value != null ? ' · ${money(value)}' : ''}\n'
          '${approve ? 'Your comment is recorded on the approval trail.' : 'The reason is sent to the buyer and recorded on the approval trail.'}',
      label: approve ? 'Comment' : 'Reason for rejecting',
      confirmLabel: approve ? 'Approve' : 'Reject',
    );
    if (text == null || !mounted) return;
    final id = jInt(pr, 'id')!;
    final ok = await runAction(context, () async {
      if (_enginePo(pr)) {
        final reqId = jInt(asJson(pr['engine_approval']), 'request_id');
        await Api.post('/approvals/requests/$reqId/decide', data: {'decision': approve ? 'approve' : 'reject', 'comment': text});
      } else if (approve) {
        await Api.post('/p2p/requests/$id/approve-po', data: {'comment': text});
      } else {
        await Api.post('/p2p/requests/$id/reject', data: {'reason': text});
      }
    }, success: approve ? 'PO approved.' : 'PO rejected.');
    if (ok) _refetch();
  }

  @override
  Widget build(BuildContext context) {
    final filtersActive = _activeCount > 0 || _search.isNotEmpty;
    return ApiListView(
      key: _listKey,
      load: _load,
      searchHint: widget.showFilters ? 'Search PR no., project, requester…' : null,
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ...widget.top,
        if (widget.showChips)
          ChipStrip([
            CountChip('Requisitions', _stats.total,
                selected: _status.isEmpty, color: const Color(0xFF3B82F6), onTap: () => _toggleChip(null)),
            CountChip('Pending approval', _stats.pending,
                selected: _status == 'group:pending', color: const Color(0xFFEA580C), onTap: () => _toggleChip('pending')),
            CountChip('In progress', _stats.progress,
                selected: _status == 'group:progress', color: const Color(0xFFCA8A04), onTap: () => _toggleChip('progress')),
            CountChip('Closed', _stats.closed,
                selected: _status == 'group:closed', color: const Color(0xFF16A34A), onTap: () => _toggleChip('closed')),
          ]),
        if (widget.showFilters)
          FilterBar(
            count: _activeCount,
            onOpen: _openFilters,
            onClear: _clear,
            trailing: [
              secondaryBtn('PR No. ${_sortAsc ? '↑' : '↓'}', () {
                setState(() => _sortAsc = !_sortAsc);
                _refilter();
              }),
            ],
          ),
      ]),
      emptyText: filtersActive
          ? (widget.showChips && _status.isNotEmpty
              ? 'No requisitions match the status filter in this tab. Tap the Requisitions count to show all.'
              : 'No requisitions match the search and filters — clear them to see all.')
          : widget.emptyLabel,
      itemBuilder: (ctx, pr, reload) {
        final st = prDisplayStatus(pr);
        final showPo = widget.contextKey == 'po-approval';
        final canA = _canApprovePo(pr);
        final canR = _canRejectPo(pr);
        final card = RecordCard(
          code: jStr(pr, 'p2p_number'),
          title: jStr(pr, 'project_label') ?? jStr(pr, 'category_label') ?? jStr(pr, 'category_code') ?? '—',
          subtitle: jStr(pr, 'category_code') == 'ITM' ? null : (jStr(pr, 'category_label') ?? jStr(pr, 'category_code')),
          trailing: Padding(padding: const EdgeInsets.only(left: 8), child: Pill(st.label, st.color)),
          meta: [
            ('Required By', fmtDate(pr['required_date'])),
            ('Priority', pr['priority'] == null ? '—' : priorityLabel(pr['priority'])),
            if (showPo) ('PO Value', money(pr['po_value'])),
          ],
          onTap: () async {
            await Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => PrDetailScreen(prId: jInt(pr, 'id')!, contextKey: widget.contextKey)));
            _refetch();
          },
        );
        if (!canA && !canR) return card;
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          card,
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Wrap(spacing: 8, alignment: WrapAlignment.end, children: [
              if (canA) secondaryBtn('Approve', () => _decidePo(pr, true), color: const Color(0xFF15803D)),
              if (canR) dangerBtn('Reject', () => _decidePo(pr, false)),
            ]),
          ),
        ]);
      },
    );
  }
}

/// Natural sort for record numbers ("PR-2" before "PR-10").
int naturalCompare(String a, String b) {
  final re = RegExp(r'(\d+)|(\D+)');
  final ma = re.allMatches(a).toList();
  final mb = re.allMatches(b).toList();
  for (var i = 0; i < ma.length && i < mb.length; i++) {
    final x = ma[i].group(0)!;
    final y = mb[i].group(0)!;
    final nx = int.tryParse(x);
    final ny = int.tryParse(y);
    final c = nx != null && ny != null ? nx.compareTo(ny) : x.compareTo(y);
    if (c != 0) return c;
  }
  return ma.length.compareTo(mb.length);
}

/// Projects and their vehicles / lots (portal ProjectUnitPicker), value "projectId:elementId".
Future<List<Option<String>>> projectUnitOptions(String search) async {
  final rows = asList(await Api.get('/projects/units/lookup', query: {'q': search, 'include_projects': true}));
  return [
    for (final r in rows) Option('${r['project_id']}:${r['element_id'] ?? ''}', jStr(r, 'display') ?? '${r['project_id']}'),
  ];
}
