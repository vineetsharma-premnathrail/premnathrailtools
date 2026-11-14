import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../record_router.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'home_common.dart';

/// My Approvals - the portal's /dashboard/approvals page (its own Sidebar
/// entry, open to every signed-in user): what waits for me (as approver,
/// delegate or escalation target), what I submitted, what I decided, and my
/// own out-of-office delegations. Decisions go through the central approval
/// engine (/approvals/...), same as the portal's ApprovalPanel.
class MyApprovalsScreen extends StatefulWidget {
  const MyApprovalsScreen({super.key});

  @override
  State<MyApprovalsScreen> createState() => _MyApprovalsScreenState();
}

enum _Tab { inbox, mine, decided, delegations }

const _tabLabels = {
  _Tab.inbox: 'Waiting for me',
  _Tab.mine: 'My submissions',
  _Tab.decided: 'Decided by me',
  _Tab.delegations: 'My delegations',
};

const _statusLabel = {
  'pending': 'Waiting',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned',
  'cancelled': 'Cancelled',
};
const _statusColor = {
  'pending': Color(0xFFF59E0B),
  'approved': Color(0xFF16A34A),
  'rejected': Color(0xFFDC2626),
  'returned': Color(0xFF7C3AED),
  'cancelled': Color(0xFF78716C),
};

class _MyApprovalsScreenState extends State<MyApprovalsScreen> {
  _Tab _tab = _Tab.inbox;
  int? _inboxCount;
  final _delegations = GlobalKey<LoadedState<List<Json>>>();

  void _setTab(_Tab t) {
    if (t != _tab) setState(() => _tab = t);
  }

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'My Approvals',
      fab: _tab == _Tab.delegations
          ? CreateFab(
              label: 'New delegation',
              onPressed: () async {
                if (await showDelegationForm(context)) _delegations.currentState?.reload();
              },
            )
          : null,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: Colors.white,
            child: ChipBar(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              children: [
                for (final t in _Tab.values)
                  CountChip(
                    _tabLabels[t]!,
                    t == _Tab.inbox && _inboxCount != null ? '($_inboxCount)' : null,
                    selected: _tab == t,
                    onTap: () => _setTab(t),
                  ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: KeyedSubtree(
              key: ValueKey(_tab),
              child: _tab == _Tab.delegations
                  ? _DelegationsTab(listKey: _delegations)
                  : _RequestsTab(
                      tab: _tab,
                      onLoaded: (n) {
                        if (_tab == _Tab.inbox && mounted) setState(() => _inboxCount = n);
                      },
                      onSeeMine: () => _setTab(_Tab.mine),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Waiting for me / My submissions / Decided by me ──────────────────────────

class _RequestsTab extends StatefulWidget {
  const _RequestsTab({required this.tab, required this.onLoaded, required this.onSeeMine});
  final _Tab tab;
  final ValueChanged<int> onLoaded;
  final VoidCallback onSeeMine;

  @override
  State<_RequestsTab> createState() => _RequestsTabState();
}

class _RequestsTabState extends State<_RequestsTab> {
  final _key = GlobalKey<LoadedState<List<Json>>>();

  /// Filter by document type (type_label); null = all.
  String? _type;

  String get _path => switch (widget.tab) {
        _Tab.inbox => '/approvals/inbox',
        _Tab.mine => '/approvals/mine',
        _ => '/approvals/decided',
      };

  Future<List<Json>> _load() async {
    final rows = rowsOf(await Api.get(_path));
    widget.onLoaded(rows.length);
    return rows;
  }

  Future<void> _open(Json r) async {
    final changed = await Navigator.of(context)
        .push<bool>(MaterialPageRoute(builder: (_) => ApprovalDetailScreen(request: r)));
    if (changed == true) _key.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Loaded<List<Json>>(
      key: _key,
      load: _load,
      builder: (ctx, rows, reload) {
        if (rows.isEmpty) {
          if (widget.tab == _Tab.inbox) {
            return ListView(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
                child: Column(
                  children: [
                    const Icon(Icons.check_circle_rounded, size: 48, color: Brand.success),
                    const SizedBox(height: 10),
                    const Text('You are all caught up',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Brand.heading)),
                    const SizedBox(height: 4),
                    const Text('Approvals sent to you appear here.', style: TextStyle(color: Brand.muted)),
                    const SizedBox(height: 12),
                    OutlinedButton(onPressed: widget.onSeeMine, child: const Text('See My submissions')),
                  ],
                ),
              ),
            ]);
          }
          return ListView(children: const [EmptyView('Nothing here yet.')]);
        }
        // Document-type chips (clickable counts) - filter on the phone.
        final counts = <String, int>{};
        for (final r in rows) {
          final t = txt(r['type_label']);
          counts[t] = (counts[t] ?? 0) + 1;
        }
        final types = counts.keys.toList()..sort();
        final type = counts.containsKey(_type) ? _type : null;
        final shown = type == null ? rows : rows.where((r) => txt(r['type_label']) == type).toList();
        return ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            if (types.length > 1)
              ChipBar(children: [
                CountChip('All', rows.length, selected: type == null, onTap: () => setState(() => _type = null)),
                for (final t in types)
                  CountChip(t, counts[t],
                      selected: type == t, onTap: () => setState(() => _type = type == t ? null : t)),
              ])
            else
              const SizedBox(height: 10),
            for (final r in shown) _RequestCard(r: r, inbox: widget.tab == _Tab.inbox, onTap: () => _open(r)),
          ],
        );
      },
    );
  }
}

class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.r, required this.inbox, required this.onTap});
  final Json r;
  final bool inbox;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final status = '${r['status'] ?? ''}';
    final reference = '${r['reference'] ?? ''}';
    return RecordCard(
      code: reference.isEmpty ? null : reference,
      title: txt(r['title']),
      subtitle: txt(r['type_label']),
      trailing: Padding(
        padding: const EdgeInsets.only(left: 8),
        child: Pill(_statusLabel[status] ?? humanize(status), _statusColor[status] ?? Brand.muted),
      ),
      meta: [
        ('From', txt(r['requester_name'])),
        ('Submitted', fmtDate(r['submitted_at'])),
        if (r['amount'] != null) ('Amount', fmtMoney(r['amount'])),
        if (inbox) ('Waiting', ageText(r['submitted_at'])),
        if (r['acting_for'] != null) ('On behalf of', txt(r['acting_for'])),
        if (!inbox && r['completed_at'] != null) ('Completed', fmtDate(r['completed_at'])),
      ],
      onTap: onTap,
    );
  }
}

// ── One approval request ─────────────────────────────────────────────────────

const _reqLabel = {
  'pending': 'Waiting for approval',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned for changes',
  'cancelled': 'Cancelled',
};
const _stepLabel = {
  'waiting': 'Not yet',
  'pending': 'Waiting',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned',
  'skipped': 'Not needed',
  'cancelled': 'Cancelled',
};
const _stepColor = {
  'waiting': Color(0xFFA8A29E),
  'pending': Color(0xFFF59E0B),
  'approved': Color(0xFF16A34A),
  'rejected': Color(0xFFDC2626),
  'returned': Color(0xFF7C3AED),
  'skipped': Color(0xFFA8A29E),
  'cancelled': Color(0xFFA8A29E),
};
const _viaLabel = {'delegation': 'as delegate', 'escalation': 'after escalation', 'admin': 'admin stand-in'};

/// The document's approval: key data, the stages with every approver, and
/// Approve / Return for changes / Reject (or Withdraw for the requester) as
/// the engine allows. Pops `true` after a decision.
class ApprovalDetailScreen extends StatefulWidget {
  const ApprovalDetailScreen({super.key, required this.request});

  /// The row from the inbox / mine / decided list.
  final Json request;

  @override
  State<ApprovalDetailScreen> createState() => _ApprovalDetailScreenState();
}

class _ApprovalDetailScreenState extends State<ApprovalDetailScreen> {
  late Future<Json> _future = _load();
  bool _busy = false;
  bool _changed = false;
  bool _showHistory = false;

  Future<Json> _load() async {
    final r = widget.request;
    final d = await Api.get('/approvals/entity/${r['entity_type']}/${r['entity_id']}');
    return d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};
  }

  void _reload() => setState(() => _future = _load());

  Future<void> _decide(Json req, String decision) async {
    final standIn = req['can_decide'] != true && req['can_stand_in'] == true;
    final needs = decision != 'approve' || standIn;
    final title = switch (decision) {
      'approve' => 'Approve ${txt(req['reference'] ?? req['title'])}?',
      'return' => 'Return for changes?',
      _ => 'Reject ${txt(req['reference'] ?? req['title'])}?',
    };
    final comment = await promptDialog(
      context,
      title: title,
      message: switch (decision) {
        'approve' => standIn
            ? 'You are not an approver of this stage - as an admin you can stand in; a comment is required.'
            : 'Add a comment if you want - it is saved with the approval.',
        'return' => 'The requester gets it back to change and submit again. Say what to change.',
        _ => 'Rejecting ends this approval. Say why - the requester sees your reason.',
      },
      label: needs ? 'Comment' : 'Comment (optional)',
      required: needs,
      confirmLabel: switch (decision) { 'approve' => 'Approve', 'return' => 'Return', _ => 'Reject' },
    );
    if (comment == null || !mounted) return;
    setState(() => _busy = true);
    final ok = await runAction(
      context,
      () => Api.post('/approvals/requests/${req['id']}/decide',
          data: {'decision': decision, 'comment': comment.isEmpty ? null : comment}),
      success: switch (decision) {
        'approve' => 'Approved.',
        'return' => 'Returned for changes.',
        _ => 'Rejected.',
      },
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      _changed = true;
      Navigator.of(context).pop(true);
    }
  }

  Future<void> _withdraw(Json req) async {
    final yes = await confirmDialog(context,
        title: 'Withdraw approval request?',
        message: 'The approvers will no longer see it. You can submit it again later.',
        confirmLabel: 'Withdraw',
        danger: true);
    if (!yes || !mounted) return;
    setState(() => _busy = true);
    final ok = await runAction(context, () => Api.post('/approvals/requests/${req['id']}/cancel', data: {}),
        success: 'Approval request withdrawn.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      _changed = true;
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final row = widget.request;
    final url = '${row['url'] ?? ''}';
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: FutureBuilder<Json>(
        future: _future,
        builder: (ctx, s) {
          final data = s.data;
          final cur = data?['current'] is Map ? Map<String, dynamic>.from(data!['current'] as Map) : null;
          final req = cur ?? row;
          final canAct = req['status'] == 'pending' && (req['can_decide'] == true || req['can_stand_in'] == true);
          final canWithdraw = req['status'] == 'pending' && req['can_cancel'] == true;
          Widget body;
          if (s.connectionState != ConnectionState.done) {
            body = const LoadingView();
          } else if (s.hasError) {
            body = ErrorView(s.error!, onRetry: _reload);
          } else {
            body = RefreshIndicator(
              onRefresh: () async => _reload(),
              child: _detailBody(req, rowsOf(data?['history'])),
            );
          }
          return SubPage(
            title: txt(row['reference'] ?? row['type_label']),
            actions: [
              if (url.isNotEmpty)
                TextButton(
                  onPressed: () => runAction(context, () async {
                    // The document's own screen in the app; the web portal only
                    // for the few pages the app does not have.
                    if (!await openPortalLink(context, url)) await Files.openInPortal(url);
                  }),
                  child: const Text('Open document'),
                ),
            ],
            body: body,
            bottom: s.connectionState != ConnectionState.done || s.hasError
                ? null
                : canAct
                    ? Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(
                                  foregroundColor: Brand.danger, minimumSize: const Size.fromHeight(48)),
                              onPressed: _busy ? null : () => _decide(req, 'reject'),
                              child: const Text('Reject'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton(
                              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                              onPressed: _busy ? null : () => _decide(req, 'return'),
                              child: const Text('Return', maxLines: 1),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: FilledButton(
                              onPressed: _busy ? null : () => _decide(req, 'approve'),
                              child: const Text('Approve'),
                            ),
                          ),
                        ],
                      )
                    : canWithdraw
                        ? OutlinedButton(
                            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                            onPressed: _busy ? null : () => _withdraw(req),
                            child: const Text('Withdraw approval request'),
                          )
                        : null,
          );
        },
      ),
    );
  }

  Widget _detailBody(Json req, List<Json> history) {
    final status = '${req['status'] ?? ''}';
    final revision = asInt(req['revision']);
    return ListView(
      padding: const EdgeInsets.only(top: 12, bottom: 32),
      children: [
        DetailSection(
          'Document',
          children: [
            FieldRow('Document type', req['type_label']),
            if (req['reference'] != null) FieldRow('Number', req['reference']),
            FieldRow('Title', req['title']),
            if (req['amount'] != null) FieldRow('Amount', fmtMoney(req['amount'])),
            FieldRow('Requested by', req['requester_name']),
            FieldRow('Submitted', fmtDateTime(req['submitted_at'])),
            if (status == 'pending') FieldRow('Waiting', ageText(req['submitted_at'])),
            if (req['completed_at'] != null) FieldRow('Completed', fmtDateTime(req['completed_at'])),
            if (revision > 1) FieldRow('Submission', '#$revision'),
          ],
        ),
        DetailSection(
          'Approval',
          action: Pill(_reqLabel[status] ?? humanize(status), _statusColor[status] ?? Brand.muted),
          children: [
            if (status == 'pending' && req['acting_for'] != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('You are deciding on behalf of ${req['acting_for']}.',
                    style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              ),
            if (status == 'pending' && req['can_decide'] != true && req['can_stand_in'] == true)
              const Padding(
                padding: EdgeInsets.only(bottom: 6),
                child: Text(
                    'You are not an approver of this stage - as an admin you can stand in; a comment is required.',
                    style: TextStyle(fontSize: 12.5, color: Brand.muted)),
              ),
            _StageList(req: req),
          ],
        ),
        if (history.isNotEmpty)
          DetailSection(
            'Earlier submissions (${history.length})',
            action: TextButton(
              onPressed: () => setState(() => _showHistory = !_showHistory),
              child: Text(_showHistory ? 'Hide' : 'Show'),
            ),
            children: [
              if (_showHistory)
                for (final h in history) ...[
                  const Divider(),
                  Row(children: [
                    Pill(_reqLabel[h['status']] ?? humanize(h['status']),
                        _statusColor[h['status']] ?? Brand.muted),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text('Submission #${asInt(h['revision'])} · ${fmtDateTime(h['submitted_at'])}',
                          style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    ),
                  ]),
                  const SizedBox(height: 8),
                  _StageList(req: h),
                ],
            ],
          ),
      ],
    );
  }
}

/// The stages of one request, each with its approvers (portal StageList).
class _StageList extends StatelessWidget {
  const _StageList({required this.req});
  final Json req;

  @override
  Widget build(BuildContext context) {
    final steps = rowsOf(req['steps']);
    final stages = <int, List<Json>>{};
    for (final s in steps) {
      stages.putIfAbsent(asInt(s['sequence']), () => []).add(s);
    }
    final current = req['current_sequence'];
    if (stages.isEmpty) {
      return const Text('No approval stages recorded.', style: TextStyle(color: Brand.muted, fontSize: 13));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final e in stages.entries)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
              border: Border(
                left: BorderSide(
                    width: 3, color: e.key == current ? const Color(0xFFF59E0B) : const Color(0xFFE2E8F0)),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(TextSpan(children: [
                  TextSpan(
                      text: '${e.key}. ${txt(e.value.first['stage_name'])}',
                      style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading, fontSize: 13)),
                  if (e.value.length > 1)
                    TextSpan(
                        text: e.value.first['approval_mode'] == 'all'
                            ? ' - every one must approve'
                            : ' - any one approves',
                        style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
                ])),
                const SizedBox(height: 4),
                for (final s in e.value) _StepLine(s: s),
              ],
            ),
          ),
      ],
    );
  }
}

class _StepLine extends StatelessWidget {
  const _StepLine({required this.s});
  final Json s;

  @override
  Widget build(BuildContext context) {
    final st = '${s['status'] ?? ''}';
    final bits = <String>[
      if (s['decided_by_name'] != null && s['decided_by_id'] != s['approver_id'])
        'decided by ${s['decided_by_name']}${_viaLabel[s['via']] != null ? ' (${_viaLabel[s['via']]})' : ''}',
      if (s['decided_at'] != null) fmtDateTime(s['decided_at']),
      if (st == 'pending' && s['due_at'] != null) 'escalates ${fmtDateTime(s['due_at'])}',
    ];
    final comment = '${s['comment'] ?? ''}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Pill(_stepLabel[st] ?? humanize(st), _stepColor[st] ?? Brand.muted),
              const SizedBox(width: 8),
              Expanded(child: Text(txt(s['approver_name']), style: const TextStyle(fontSize: 13, color: Brand.body))),
            ],
          ),
          if (bits.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(bits.join(' · '), style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ),
          if (comment.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text('"$comment"', style: const TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic)),
            ),
        ],
      ),
    );
  }
}

// ── My delegations ───────────────────────────────────────────────────────────

class _DelegationsTab extends StatelessWidget {
  const _DelegationsTab({required this.listKey});
  final GlobalKey<LoadedState<List<Json>>> listKey;

  Future<void> _end(BuildContext context, Json d) async {
    final yes = await confirmDialog(context,
        title: 'End this delegation now?',
        message: '${txt(d['delegate_name'])} will stop deciding your approvals from now on.',
        confirmLabel: 'End now',
        danger: true);
    if (!yes || !context.mounted) return;
    final ok = await runAction(context, () => Api.post('/organization/delegations/${d['id']}/end'),
        success: 'Delegation ended.');
    if (ok) listKey.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final me = Perm.userId;
    return Loaded<List<Json>>(
      key: listKey,
      load: () async => rowsOf(await Api.get('/organization/delegations/mine')),
      builder: (ctx, rows, reload) => ListView(
        padding: const EdgeInsets.only(top: 10, bottom: 96),
        children: [
          const HintCard(
            "While you're away, the delegate can decide anything waiting for you in the chosen dates. They still need "
            "the module's Approve permission where the workflow requires it. Every decision records that it was made "
            'on your behalf.',
            title: 'Delegate my approvals',
          ),
          if (rows.isEmpty) const EmptyView('No delegations.'),
          for (final d in rows)
            Builder(builder: (ctx) {
              final mine = d['delegator_id'] == me;
              final state = '${d['state'] ?? ''}';
              final scope = d['workflow_label'] ??
                  (d['module_label'] != null ? '${d['module_label']} (all)' : 'All approvals');
              return RecordCard(
                title: mine ? 'You → ${txt(d['delegate_name'])}' : '${txt(d['delegator_name'])} → you',
                subtitle: '${fmtDate(d['start_date'])} – ${fmtDate(d['end_date'])}',
                trailing: Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Pill(
                          humanize(state),
                          state == 'active'
                              ? Brand.success
                              : state == 'upcoming'
                                  ? const Color(0xFF2563EB)
                                  : const Color(0xFF78716C)),
                      if (state != 'ended' && mine)
                        TextButton(
                          style: TextButton.styleFrom(foregroundColor: Brand.danger),
                          onPressed: () => _end(ctx, d),
                          child: const Text('End now'),
                        ),
                    ],
                  ),
                ),
                meta: [
                  ('For', '$scope'),
                  if ('${d['reason'] ?? ''}'.isNotEmpty) ('Reason', '${d['reason']}'),
                ],
              );
            }),
        ],
      ),
    );
  }
}

List<Json>? _directoryCache;
List<Json>? _typesCache;

/// New delegation (portal DelegationForm, forOthers = false): who approves
/// in my place, from / to, for which module or document type, reason.
Future<bool> showDelegationForm(BuildContext context) async {
  int? delegateId;
  String? delegateName;
  var start = DateTime.now();
  var end = DateTime.now();
  String scope = '';
  final reason = TextEditingController();

  Future<List<Option<int>>> people(String q) async {
    _directoryCache ??= rowsOf(await Api.get('/users/directory'));
    final me = Perm.userId;
    final s = q.trim().toLowerCase();
    return [
      for (final u in _directoryCache!)
        if (u['id'] != me &&
            (s.isEmpty ||
                '${u['name'] ?? ''} ${u['email'] ?? ''} ${u['department'] ?? ''}'.toLowerCase().contains(s)))
          Option<int>(asInt(u['id']), txt(u['name']),
              subtitle: [u['designation'], u['department']]
                  .where((x) => x != null && '$x'.isNotEmpty)
                  .join(' · ')),
    ];
  }

  Future<List<Option<String>>> scopes(String q) async {
    _typesCache ??= rowsOf(await Api.get('/approvals/types'));
    final modules = <String, String>{};
    for (final t in _typesCache!) {
      modules['${t['module_key']}'] = txt(t['module_label']);
    }
    final all = <Option<String>>[
      const Option('', 'All approvals'),
      for (final m in modules.entries) Option('m:${m.key}', '${m.value} — all'),
      for (final t in _typesCache!) Option('w:${t['key']}', '${txt(t['module_label'])} — ${txt(t['label'])}'),
    ];
    final s = q.trim().toLowerCase();
    return s.isEmpty ? all : all.where((o) => o.label.toLowerCase().contains(s)).toList();
  }

  String scopeLabel = 'All approvals';
  return showFormSheet(
    context,
    title: 'New delegation',
    saveLabel: 'Add delegation',
    builder: (ctx, setS) => [
      const Text('Someone else decides your approvals while you are away',
          style: TextStyle(fontSize: 13, color: Brand.muted)),
      const Caps('Who'),
      AppSelect<int>(
        label: 'Approved by (delegate)',
        required: true,
        value: delegateId,
        valueLabel: delegateName,
        loadOptions: people,
        onChanged: (o) => setS(() {
          delegateId = o?.value;
          delegateName = o?.label;
        }),
      ),
      const Text("The delegate still needs the module's Approve permission where the workflow requires it.",
          style: TextStyle(fontSize: 12, color: Brand.muted)),
      const Caps('When and for what'),
      DateField(label: 'From', required: true, value: start, onChanged: (d) => setS(() => start = d ?? start)),
      DateField(label: 'To', required: true, value: end, onChanged: (d) => setS(() => end = d ?? end)),
      AppSelect<String>(
        label: 'For (optional)',
        value: scope,
        valueLabel: scopeLabel,
        clearable: false,
        loadOptions: scopes,
        onChanged: (o) => setS(() {
          scope = o?.value ?? '';
          scopeLabel = o?.label ?? 'All approvals';
        }),
      ),
      AppTextField(label: 'Reason (optional)', controller: reason, hint: 'e.g. On leave'),
    ],
    onSave: () async {
      requireField(delegateId, 'Approved by (delegate)');
      if (end.isBefore(DateTime(start.year, start.month, start.day))) {
        throw 'The end date (${fmtDate(end)}) is before the start date (${fmtDate(start)}). '
            'Pick an end date on or after the start date.';
      }
      await Api.post('/organization/delegations', data: {
        'delegate_id': delegateId,
        'start_date': apiDate(start),
        'end_date': apiDate(end),
        'module_key': scope.startsWith('m:') ? scope.substring(2) : null,
        'workflow_key': scope.startsWith('w:') ? scope.substring(2) : null,
        'reason': reason.text.trim().isEmpty ? null : reason.text.trim(),
      });
    },
  );
}
