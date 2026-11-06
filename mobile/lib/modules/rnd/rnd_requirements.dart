import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';
import 'rnd_req_docs.dart';
import 'rnd_req_offers.dart';
import 'rnd_task_board.dart';
import 'rnd_task_detail.dart';
import 'rnd_timeline.dart';

/// R&D › Requirements (portal: app/dashboard/rnd/requirements).

const revisionStatusLabel = {
  'submitted': 'Awaiting R&D review',
  'accepted': 'Accepted by R&D',
  'returned': 'Returned to BD',
  'responded': 'Responded',
  'closed': 'Closed by R&D',
  'superseded': 'Superseded',
};
const revisionStatusHex = {
  'submitted': '#2563EB',
  'accepted': '#16A34A',
  'returned': '#DC2626',
  'responded': '#0D9488',
  'closed': '#78716c',
  'superseded': '#78716c',
};
const _shortStatus = {
  'submitted': 'Awaiting review',
  'accepted': 'Accepted',
  'returned': 'Returned',
  'responded': 'Responded',
  'closed': 'Closed',
  'superseded': 'Superseded',
};

int _dayNo(String iso) => DateTime.parse(isoDay(iso)).millisecondsSinceEpoch ~/ 86400000;
int _todayNo() => DateTime.parse(todayIso()).millisecondsSinceEpoch ~/ 86400000;

/// R&D Response in a few words, coloured by how it stands.
(String, Color) shortResponse(Json q) {
  const red = Color(0xFFB91C1C), orange = Color(0xFFC2410C), green = Color(0xFF15803D);
  const blue = Color(0xFF1D4ED8), purple = Color(0xFF6D28D9), grey = Color(0xFF78716C);
  final s = q['status'];
  if (s == 'superseded') return ('Re-sent', grey);
  if (s == 'closed') return ('Closed', grey);
  if (s == 'withdrawn') return ('Taken back', grey);
  final due = str(q, 'due_date');
  if (s == 'responded') {
    final late = (q['responded_at'] != null && due != null) ? _dayNo(str(q, 'responded_at')!) - _dayNo(due) : 0;
    return late > 0 ? ('Done · ${late}d late', orange) : ('Done on time', green);
  }
  if (jsonList(q['queries']).isNotEmpty) return ('Query raised', purple);
  if (due == null) return ('Open', blue);
  final left = _dayNo(due) - _todayNo();
  if (left < 0) return ('${-left}d late', red);
  if (left == 0) return ('Due today', orange);
  return ('${left}d left', left <= 2 ? orange : blue);
}

/// Badge of a CRM → R&D request (portal: rndRequestBadge).
(String, Color) requestBadge(Json r) {
  final s = r['status'];
  if (s == 'superseded') return ('Superseded by re-send', const Color(0xFF78716C));
  if (s == 'closed') return ('Closed by R&D', const Color(0xFF78716C));
  if (s == 'withdrawn') return ('Taken back by BD', const Color(0xFF78716C));
  if (s == 'responded') {
    return boolOf(r['is_late']) ? ('Responded late', const Color(0xFFD97706)) : ('Responded on time', const Color(0xFF16A34A));
  }
  if (jsonList(r['queries']).isNotEmpty) return ('R&D asked for details', const Color(0xFF7C3AED));
  return boolOf(r['is_late']) ? ('Overdue', const Color(0xFFDC2626)) : ('Awaiting R&D', const Color(0xFF2563EB));
}

class RequirementsList extends StatefulWidget {
  const RequirementsList({super.key, this.initialStatus});

  /// Opened from a dashboard chip (e.g. "Awaiting review" = submitted).
  final String? initialStatus;

  @override
  State<RequirementsList> createState() => _RequirementsListState();
}

class _RequirementsListState extends State<RequirementsList> {
  final _list = GlobalKey<ApiListViewState>();
  String _source = '';
  String _mine = '';
  late String? _status = widget.initialStatus;
  int _toReview = 0;
  int _awaitingMe = 0;
  int _edited = 0;

  Future<ApiPage> _load(int page, String search) async {
    final rows = jsonList(
      await Api.get(
        '/rnd/requirements',
        query: {
          'search': search,
          'source': _source,
          'mine': _mine == 'respond' ? true : null,
          'needs_my_review': _mine == 'review' ? true : null,
          'status': _status,
        },
      ),
    );
    rows.sort((a, b) {
      final r = (boolOf(b['needs_my_review']) ? 1 : 0) - (boolOf(a['needs_my_review']) ? 1 : 0);
      if (r != 0) return r;
      return (str(a, 'rd_number') ?? '~').compareTo(str(b, 'rd_number') ?? '~');
    });
    if (_mine.isEmpty && mounted) {
      final me = Perm.userId;
      setState(() {
        _toReview = rows.where((r) => boolOf(r['needs_my_review'])).length;
        _awaitingMe = rows.where((r) {
          final q = jsonMap(r['rnd_request']);
          if (r['status'] != 'accepted' || q['status'] != 'open') return false;
          return q['assigned_to_id'] == null ? boolOf(r['can_respond']) : intOf(q['assigned_to_id']) == me;
        }).length;
        _edited = rows.where((r) => boolOf(r['edited_after_send'])).length;
      });
    }
    return ApiPage(rows);
  }

  void _set(VoidCallback f) {
    setState(f);
    _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final me = Perm.userId;
    return ApiListView(
      key: _list,
      load: _load,
      searchHint: 'Search by R&D ID, inquiry/tender ID, product or customer…',
      emptyText: _source.isNotEmpty || _mine.isNotEmpty || _status != null
          ? 'No requirements match your filters.'
          : 'No requirements yet — they arrive here when the business team sends a Technical Offer Request from CRM.',
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PageHeader(
            'Requirements',
            subtitle: 'Customer requirements sent from CRM, each with an R&D ID and revisions — open one and accept it.',
          ),
          if (_edited > 0) NoteBox('$_edited edited in CRM since last sent.', color: const Color(0xFFEA580C)),
          ChipRow(
            children: [
              CountChip(
                'Inquiries only',
                null,
                selected: _source == 'inquiry',
                onTap: () => _set(() => _source = _source == 'inquiry' ? '' : 'inquiry'),
              ),
              CountChip(
                'Tenders only',
                null,
                selected: _source == 'tender',
                onTap: () => _set(() => _source = _source == 'tender' ? '' : 'tender'),
              ),
            ],
          ),
          ChipRow(
            children: [
              CountChip(
                "Everyone's",
                null,
                selected: _mine.isEmpty && _status == null,
                onTap: () => _set(() {
                  _mine = '';
                  _status = null;
                }),
              ),
              CountChip(
                'Waiting for my review',
                _toReview,
                selected: _mine == 'review',
                onTap: () => _set(() => _mine = _mine == 'review' ? '' : 'review'),
              ),
              CountChip(
                'Awaiting my response',
                _awaitingMe,
                selected: _mine == 'respond',
                onTap: () => _set(() => _mine = _mine == 'respond' ? '' : 'respond'),
              ),
              if (_status != null)
                CountChip(
                  revisionStatusLabel[_status] ?? humanize(_status),
                  null,
                  selected: true,
                  onTap: () => _set(() => _status = null),
                ),
            ],
          ),
        ],
      ),
      itemBuilder: (ctx, r, reload) {
        final q = r['rnd_request'] is Map ? jsonMap(r['rnd_request']) : null;
        final st = str(r, 'status');
        final rev = str(r, 'revision_code');
        String response = 'Not assigned';
        if (q != null) {
          final who = q['assigned_to_id'] == null
              ? 'Team'
              : intOf(q['assigned_to_id']) == me
              ? 'You'
              : (str(q, 'assigned_to') ?? '').split(' ').first;
          response = '${shortResponse(q).$1} · $who · ${fmtDate(q['due_date'])}';
        }
        return RecordCard(
          code: '${str(r, 'rd_number') ?? '—'}${boolOf(r['needs_my_review']) ? '  ·  Review' : ''}',
          title: [str(r, 'org_name'), str(r, 'product')].whereType<String>().join(' · ').ifEmpty('—'),
          subtitle:
              '${r['source'] == 'inquiry' ? 'Inquiry' : 'Tender'} ${r['universal_id'] ?? ''}'
              '${str(r, 'category') != null ? ' · ${r['category']}' : ''}',
          trailing: Padding(
            padding: const EdgeInsets.only(left: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Pill(
                  st == null ? '—' : (_shortStatus[st] ?? revisionStatusLabel[st] ?? st),
                  hexColor(revisionStatusHex[st] ?? '#78716c'),
                ),
                if (isUrgent(r['priority'])) ...[const SizedBox(height: 4), Pill('Urgent', priorityColor('urgent'))],
              ],
            ),
          ),
          meta: [
            ('Rev', rev == null ? '—' : 'R${rev.split('-R').last}'),
            ('R&D Response', response),
            ('BD Owner', txt(r['bd_owner'])),
            ('Last Received', fmtDateTime(r['last_received_at'] ?? r['last_sent_at'])),
          ],
          onTap: () => openThen(
            ctx,
            RequirementDetailScreen(source: str(r, 'source') ?? 'inquiry', recordId: intOf(r['record_id']) ?? 0),
            reload,
          ),
        );
      },
    );
  }
}

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

// ── Detail ───────────────────────────────────────────────────────────────────

const _taskLabels = TaskLabels(
  manager: 'head',
  emptyManager: 'No tasks yet — use “Add Task” to give work to someone in R&D.',
  emptyOther: 'No tasks on this requirement yet.',
);

/// One requirement (portal: requirements/[source]/[id]): Requirement · Tasks ·
/// Technical Offers · Documents · Timeline; Accept / Respond / Close in the
/// bottom bar.
class RequirementDetailScreen extends StatefulWidget {
  const RequirementDetailScreen({super.key, required this.source, required this.recordId, this.initialTab = 'Requirement'});
  final String source;
  final int recordId;
  final String initialTab;

  @override
  State<RequirementDetailScreen> createState() => _RequirementDetailScreenState();
}

class _RequirementDetailScreenState extends State<RequirementDetailScreen> {
  Json? _data;
  Object? _error;
  late String _tab = widget.initialTab;
  int _reloadKey = 0;

  String get _path => '/rnd/requirements/${widget.source}/${widget.recordId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = jsonMap(await Api.get(_path));
      if (mounted) {
        setState(() {
          _data = d;
          _error = null;
          _reloadKey++;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  bool _see(String f) => RndPerm.feature('requirements', f, 'view');

  Future<void> _accept(Json intake) async {
    final ok = await confirmDialog(
      context,
      title: 'Accept ${intake['revision_code']}?',
      message:
          'Accepting commits R&D to this requirement. BD is told, and R&D can then give tasks, upload a Technical Offer '
          'and respond to CRM.',
      confirmLabel: 'Accept',
    );
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.post('$_path/accept', data: {'remarks': null}), success: 'Requirement accepted.')) {
      await _load();
    }
  }

  Future<void> _respond(Json req) async {
    final remarks = TextEditingController();
    final delay = TextEditingController();
    var asking = false;
    final late = todayIso().compareTo(isoDay(req['due_date'])) > 0;
    final ok = await showFormSheet(
      context,
      title: 'Respond to CRM',
      saveLabel: 'Submit',
      builder: (ctx, setS) => [
        Hint('Requested by ${req['requested_by'] ?? 'CRM'} · due ${fmtDate(req['due_date'])}'),
        Segmented<bool>(
          options: const [Option(false, 'Final response'), Option(true, 'Ask BD for more details')],
          value: asking,
          onChanged: (v) => setS(() => asking = v),
        ),
        Hint(
          asking
              ? 'The requirement stays open with its due date. BD is told and answers by updating the requirement and sending it again.'
              : 'Closes this request: BD gets your answer and can prepare the quotation.',
        ),
        AppTextField(
          label: asking ? 'Details R&D needs' : 'Response remarks',
          controller: remarks,
          required: true,
          maxLines: 5,
          hint: asking
              ? 'e.g. Axle load and track gauge are missing — please add them'
              : 'Answer, feasibility notes, deviations…',
        ),
        if (!asking && late)
          AppTextField(
            label: 'Reason for delay (was due ${fmtDate(req['due_date'])})',
            controller: delay,
            required: true,
            maxLines: 3,
            hint: "Why this couldn't be answered by the due date",
          ),
        if (!asking) const Hint('The BD owner is notified of your response.'),
      ],
      onSave: () async {
        final t = remarks.text.trim();
        if (asking) {
          if (t.length < 10) throw 'Write which details R&D needs from BD (at least 10 characters).';
          await postForm('/rnd/requirements/requests/${req['id']}/respond', {'remarks': t, 'ask_details': 'true'});
          return;
        }
        if (t.length < 10) {
          throw 'Write your response to BD (at least 10 characters), e.g. feasibility, deviations or the answer itself.';
        }
        if (late && delay.text.trim().isEmpty) {
          throw 'This response is late — it was due on ${fmtDate(req['due_date'])}. Enter the reason for the delay.';
        }
        await postForm('/rnd/requirements/requests/${req['id']}/respond', {
          'remarks': t,
          'delay_reason': late ? delay.text.trim() : null,
        });
      },
    );
    if (ok) {
      if (mounted) showSnack(context, asking ? 'Question sent to BD.' : 'Response sent to CRM.');
      await _load();
    }
  }

  Future<void> _close(Json req) async {
    final reason = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Close without response',
      saveLabel: 'Close requirement',
      builder: (ctx, setS) => [
        Hint('Requested by ${req['requested_by'] ?? 'CRM'} · due ${fmtDate(req['due_date'])}'),
        AppTextField(
          label: 'Reason',
          controller: reason,
          required: true,
          maxLines: 4,
          hint: 'e.g. Standard product — no R&D input needed',
        ),
        const Hint(
          'Use this when R&D has nothing to share — BD continues without R&D input. BD is notified and can re-send the '
          'requirement later if R&D work is needed.',
        ),
      ],
      onSave: () async {
        if (reason.text.trim().length < 10) {
          throw 'Write why R&D has nothing to share, so BD understands (at least 10 characters), e.g. "Standard product — no R&D input needed".';
        }
        await Api.post('/rnd/requirements/requests/${req['id']}/close', data: {'reason': reason.text.trim()});
      },
    );
    if (ok) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) {
      return SubPage(
        title: 'Requirement',
        body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView(),
      );
    }
    final intake = d['intake'] is Map ? jsonMap(d['intake']) : null;
    final access = jsonMap(d['my_access']);
    final accepted = intake == null || intake['status'] == 'accepted';
    final acceptFirst = !accepted
        ? 'Accept the requirement first (${intake['revision_code']} is ${(revisionStatusLabel[intake['status']] ?? '').toLowerCase()}).'
        : null;
    final movements = jsonList(d['movements']);
    final req = movements.isNotEmpty && movements.last['rnd_request'] is Map ? jsonMap(movements.last['rnd_request']) : null;
    final me = Perm.userId;
    final canRespond = boolOf(access['respond']) && RndPerm.feature('requirements', 'crm_request', 'submit');
    final team = req != null && req['assigned_to_id'] == null;
    final mine = req != null && (team ? canRespond : intOf(req['assigned_to_id']) == me);
    final reqOpen = req != null && req['status'] == 'open';
    final canReview = boolOf(access['can_review']);

    const featureOf = {'Tasks': 'tasks', 'Timeline': 'history', 'Technical Offers': 'technical_offers', 'Documents': 'documents'};
    final tabs = [
      'Requirement',
      'Tasks',
      'Technical Offers',
      'Documents',
      'Timeline',
    ].where((t) => featureOf[t] == null || _see(featureOf[t]!)).toList();
    final tab = tabs.contains(_tab) ? _tab : 'Requirement';

    final actions = <(String, IconData, VoidCallback?)>[
      if (intake != null && canReview && intake['status'] == 'submitted') ('Accept', Icons.check_rounded, () => _accept(intake)),
      if (mine && reqOpen && _see('crm_request')) ...[
        ('Respond to CRM', Icons.send_rounded, acceptFirst != null ? null : () => _respond(req)),
        ('Close without response', Icons.close_rounded, acceptFirst != null && !canReview ? null : () => _close(req)),
      ],
    ];

    final source = str(d, 'source') ?? widget.source;
    final recordId = intOf(d['record_id']) ?? widget.recordId;

    return SubPage(
      title: str(intake, 'rd_number') ?? str(d, 'offer_number') ?? 'Requirement',
      bottom: actions.isEmpty ? null : ActionBar(actions: actions),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SubTabs(tabs: tabs, current: tab, onTap: (t) => setState(() => _tab = t)),
          const Divider(height: 1),
          Expanded(
            child: KeyedSubtree(
              key: ValueKey('$tab-$_reloadKey'),
              child: switch (tab) {
                'Tasks' => TasksBoard(
                  api: RndTaskApi.requirement(source, recordId),
                  canManage: boolOf(access['is_head']),
                  canCreate: boolOf(access['view']) && RndPerm.feature('requirements', 'tasks', 'create'),
                  createDisabledHint: acceptFirst,
                  labels: _taskLabels,
                  rights: TaskRights(
                    create: RndPerm.feature('requirements', 'tasks', 'create'),
                    edit: RndPerm.feature('requirements', 'tasks', 'edit'),
                    approve: RndPerm.feature('requirements', 'tasks', 'approve'),
                    cancel: RndPerm.feature('requirements', 'tasks', 'cancel'),
                  ),
                ),
                'Technical Offers' => TechnicalOffersTab(
                  source: source,
                  recordId: recordId,
                  access: access,
                  acceptedHint: acceptFirst,
                ),
                'Documents' => RequirementDocumentsTab(
                  source: source,
                  recordId: recordId,
                  canUpload: boolOf(access['upload']) && RndPerm.feature('requirements', 'documents', 'create'),
                  canDownload: boolOf(access['download']) && RndPerm.feature('requirements', 'documents', 'export'),
                ),
                'Timeline' => RndTimeline(path: '/rnd/requirement-work/$source/$recordId/history'),
                _ => RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.only(bottom: 32),
                    children: _requirementTab(d, intake, req, acceptFirst, mine, canReview, team),
                  ),
                ),
              },
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _requirementTab(Json d, Json? intake, Json? req, String? acceptFirst, bool mine, bool canReview, bool team) {
    final revisions = jsonList(d['revisions']);
    final org = jsonMap(d['organization']);
    final contact = d['contact'] is Map ? jsonMap(d['contact']) : null;
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              [
                str(intake, 'rd_number') ?? str(d, 'offer_number'),
                '${d['source'] == 'inquiry' ? 'Inquiry' : 'Tender'} ${d['universal_id'] ?? ''}',
              ].whereType<String>().join('  ·  '),
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.primary),
            ),
            const SizedBox(height: 2),
            Text(
              str(d, 'title') ?? '',
              style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700, color: Brand.heading),
            ),
            const SizedBox(height: 2),
            Text(
              '${org['name'] ?? 'Unknown customer'} · last sent ${fmtDateTime(d['last_sent_at'])}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted),
            ),
          ],
        ),
      ),
      if (intake != null) _reviewCard(intake, revisions, canReview),
      if (req != null) _requestCard(req, acceptFirst, mine, team),
      if (boolOf(d['edited_after_send']))
        NoteBox(
          'CRM has edited this requirement since it was last sent to R&D. The Requirement tab shows the current CRM values. '
          'Ask the BD owner${d['bd_owner'] != null ? ' (${d['bd_owner']})' : ''} to re-send if the changes affect the offer.',
          color: const Color(0xFFEA580C),
        ),
      if (_see('product_requirement'))
        DetailSection(
          d['source'] == 'inquiry' ? 'Product Requirement' : 'Tender Details',
          children: [
            if (jsonList(d['requirement']).isEmpty) const FieldRow('Details', null),
            for (final f in jsonList(d['requirement'])) FieldRow(str(f, 'label') ?? '', f['value']),
          ],
        ),
      if (_see('customer')) ...[
        DetailSection(
          'Customer',
          children: [
            FieldRow('Organization', org['name']),
            FieldRow('Type', org['type']),
            FieldRow('City / State', [str(org, 'city'), str(org, 'state')].whereType<String>().join(', ')),
          ],
        ),
        if (contact != null)
          DetailSection(
            'Contact Person',
            children: [
              FieldRow('Name', contact['name']),
              FieldRow('Designation', contact['designation']),
              FieldRow('Department', contact['department']),
              FieldRow('Mobile', contact['mobile']),
              FieldRow('Email', contact['email']),
            ],
          ),
      ],
      if (_see('crm_info'))
        DetailSection(
          'From CRM',
          children: [
            FieldRow('BD Owner', d['bd_owner']),
            FieldRow('CRM Status', d['crm_status']),
            FieldRow('Priority', d['priority'] == null ? null : priorityLabel(d['priority'])),
            FieldRow('Last sent to R&D', d['last_sent_at'] == null ? null : fmtDateTime(d['last_sent_at'])),
          ],
        ),
      if (revisions.isNotEmpty) _RevisionList(source: widget.source, recordId: widget.recordId, revisions: revisions),
    ];
  }

  Widget _reviewCard(Json intake, List<Json> revisions, bool canReview) {
    Json? latest;
    for (final r in revisions) {
      if (intOf(r['revision_no']) == intOf(intake['current_revision'])) latest = r;
    }
    latest ??= revisions.isNotEmpty ? revisions.last : null;
    final status = str(intake, 'status') ?? '';
    final color = hexColor(revisionStatusHex[status] ?? '#78716c');
    return _BarCard(
      color: color,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              str(intake, 'rd_number') ?? '',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Brand.heading),
            ),
            Text(
              'Revision ${(str(intake, 'revision_code') ?? '').split('-').last} · ${intake['revision_code'] ?? ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted, fontWeight: FontWeight.w600),
            ),
            Pill(revisionStatusLabel[status] ?? status, color),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          [
            if (latest?['submitted_by'] != null) 'Sent by ${latest!['submitted_by']}',
            fmtDateTime(latest?['submitted_at'] ?? intake['last_received_at']),
            if (latest?['reviewed_by'] != null && latest?['reviewed_at'] != null)
              '${status == 'returned' ? 'Returned' : 'Reviewed'} by ${latest!['reviewed_by']} ${fmtDateTime(latest['reviewed_at'])}',
          ].join(' · '),
          style: const TextStyle(fontSize: 12.5, color: Brand.muted),
        ),
        if (status == 'returned' && latest?['return_reason'] != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              'Returned to BD: ${latest!['return_reason']}',
              style: const TextStyle(fontSize: 12.5, color: Color(0xFFB91C1C)),
            ),
          ),
        if (status == 'submitted' && !canReview)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              'Waiting for the R&D head to accept it. Tasks, offers and the response open after it is accepted.',
              style: TextStyle(fontSize: 12.5, color: Brand.muted),
            ),
          ),
        if (revisions.length > 1)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final r in revisions)
                  Pill(
                    'R${r['revision_no']} ${revisionStatusLabel[r['status']] ?? ''}',
                    hexColor(revisionStatusHex[r['status']] ?? '#78716c'),
                  ),
              ],
            ),
          ),
        if (status == 'submitted' && canReview)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text(
              'Use Accept below to take this requirement into R&D.',
              style: TextStyle(fontSize: 12.5, color: Brand.body),
            ),
          ),
      ],
    );
  }

  Widget _requestCard(Json req, String? acceptFirst, bool mine, bool team) {
    final (badge, color) = requestBadge(req);
    final open = req['status'] == 'open';
    final closed = req['status'] == 'closed';
    final daysLeft = _dayNo(str(req, 'due_date') ?? todayIso()) - _todayNo();
    final title = closed
        ? 'Closed by R&D — no response needed'
        : !open
        ? 'Response sent to CRM'
        : acceptFirst != null
        ? 'Waiting for R&D to accept this requirement'
        : mine
        ? 'CRM is waiting for your response'
        : team
        ? 'Waiting for the R&D head to respond'
        : 'Waiting for ${req['assigned_to'] ?? 'the assigned engineer'} to respond';
    final dueNote = !open
        ? null
        : daysLeft < 0
        ? '${-daysLeft} day${daysLeft == -1 ? '' : 's'} overdue'
        : daysLeft == 0
        ? 'due today'
        : '$daysLeft day${daysLeft == 1 ? '' : 's'} left';
    final queries = jsonList(req['queries']);
    return _BarCard(
      color: color,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading),
              ),
            ),
            Pill(badge, color),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          '${req['requested_by'] != null ? 'Requested by ${req['requested_by']} · ' : ''}Due ${fmtDate(req['due_date'])}'
          '${dueNote != null ? ' ($dueNote)' : ''}',
          style: TextStyle(fontSize: 12.5, color: open && daysLeft < 0 ? const Color(0xFFDC2626) : Brand.muted),
        ),
        if (req['crm_remarks'] != null) ...[
          const SizedBox(height: 8),
          Caps('CRM remark${req['requested_by'] != null ? ' — ${req['requested_by']}' : ''}'),
          Text(str(req, 'crm_remarks') ?? '', style: const TextStyle(fontSize: 13, color: Brand.body)),
        ],
        for (final q in queries) ...[
          const SizedBox(height: 8),
          Caps('R&D asked for more details — ${q['asked_by'] ?? 'R&D'} · ${fmtDateTime(q['asked_at'])}'),
          Text(str(q, 'remarks') ?? '', style: const TextStyle(fontSize: 13, color: Brand.body)),
        ],
        if (req['response_remarks'] != null) ...[
          const SizedBox(height: 8),
          Caps(
            'R&D response${req['responded_by'] != null ? ' — ${req['responded_by']} · ${fmtDateTime(req['responded_at'])}' : ''}',
          ),
          Text(str(req, 'response_remarks') ?? '', style: const TextStyle(fontSize: 13, color: Brand.body)),
        ],
        if (req['delay_reason'] != null)
          Text('Reason for delay: ${req['delay_reason']}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        if (mine && open && acceptFirst != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(acceptFirst, style: const TextStyle(fontSize: 12.5, color: Color(0xFFB45309))),
          ),
      ],
    );
  }
}

class _BarCard extends StatelessWidget {
  const _BarCard({required this.color, required this.children});
  final Color color;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      border: Border(
        left: BorderSide(color: color, width: 4),
        top: const BorderSide(color: Brand.border),
        right: const BorderSide(color: Brand.border),
        bottom: const BorderSide(color: Brand.border),
      ),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
  );
}

/// Revisions with "See changes" - before / now per changed field.
class _RevisionList extends StatefulWidget {
  const _RevisionList({required this.source, required this.recordId, required this.revisions});
  final String source;
  final int recordId;
  final List<Json> revisions;

  @override
  State<_RevisionList> createState() => _RevisionListState();
}

class _RevisionListState extends State<_RevisionList> {
  Map<String, List<Json>> _changes = {};
  int? _shown;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.revisions.any(
      (r) =>
          jsonList(r['changed_fields']).isNotEmpty || (r['changed_fields'] is List && (r['changed_fields'] as List).isNotEmpty),
    )) {
      Api.get('/rnd/requirement-work/${widget.source}/${widget.recordId}/history').then(
        (h) {
          final by = <String, List<Json>>{};
          for (final e in jsonList(h)) {
            if (e['kind'] == 'revision' && e['revision_code'] != null) by[str(e, 'revision_code')!] = jsonList(e['changes']);
          }
          if (mounted) setState(() => _changes = by);
        },
        onError: (_) {
          if (mounted) {
            setState(() => _error = 'The before / now values could not be loaded — open the Timeline tab to see the changes.');
          }
        },
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final revs = [...widget.revisions]..sort((a, b) => (intOf(b['revision_no']) ?? 0) - (intOf(a['revision_no']) ?? 0));
    return DetailSection(
      'Revisions',
      children: [
        for (final r in revs) ...[
          const Divider(height: 16),
          Text(
            str(r, 'revision_code') ?? '',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.heading),
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Pill(revisionStatusLabel[r['status']] ?? txt(r['status']), hexColor(revisionStatusHex[r['status']] ?? '#78716c')),
              Text(
                'Sent ${fmtDateTime(r['submitted_at'])}${r['submitted_by'] != null ? ' by ${r['submitted_by']}' : ''}',
                style: const TextStyle(fontSize: 12.5),
              ),
            ],
          ),
          if (r['reviewed_by'] != null)
            Text(
              '${r['status'] == 'returned' ? 'Returned' : 'Reviewed'} by ${r['reviewed_by']}${r['reviewed_at'] != null ? ' · ${fmtDateTime(r['reviewed_at'])}' : ''}'
              '${r['review_remarks'] != null ? ' — ${r['review_remarks']}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted),
            ),
          if (r['return_reason'] != null)
            Text('Reason: ${r['return_reason']}', style: const TextStyle(fontSize: 12.5, color: Color(0xFFB91C1C))),
          if (r['changed_fields'] is List && (r['changed_fields'] as List).isNotEmpty) ...[
            Text(
              'Changed from R${(intOf(r['revision_no']) ?? 1) - 1}: ${(r['changed_fields'] as List).join(', ')}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted),
            ),
            if ((_changes[r['revision_code']] ?? const []).isNotEmpty)
              TextButton(
                style: TextButton.styleFrom(padding: EdgeInsets.zero, alignment: Alignment.centerLeft),
                onPressed: () => setState(() => _shown = _shown == intOf(r['revision_no']) ? null : intOf(r['revision_no'])),
                child: Text(_shown == intOf(r['revision_no']) ? 'Hide changes' : 'See changes'),
              ),
            if (_error != null) Text(_error!, style: const TextStyle(fontSize: 12.5, color: Color(0xFFB45309))),
            if (_shown == intOf(r['revision_no']))
              for (final c in _changes[r['revision_code']] ?? const <Json>[]) ...[
                const SizedBox(height: 8),
                Caps(str(c, 'label') ?? ''),
                _diffBox('R${(intOf(r['revision_no']) ?? 1) - 1} (before)', c['old'], const Color(0xFFB91C1C)),
                _diffBox('R${r['revision_no']} (now)', c['new'], const Color(0xFF15803D)),
              ],
          ],
        ],
      ],
    );
  }

  Widget _diffBox(String label, Object? value, Color color) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(top: 4),
    padding: const EdgeInsets.all(8),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.06),
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: color.withValues(alpha: 0.2)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color),
        ),
        Text(txt(value), style: const TextStyle(fontSize: 13)),
      ],
    ),
  );
}
