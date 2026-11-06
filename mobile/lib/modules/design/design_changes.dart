import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'design_boms.dart';
import 'design_common.dart';
import 'design_documents.dart';
import 'design_ecn.dart';

export 'design_ecn.dart' show DesignChangeNoticeDetail, showEcnForm;

/// Changes - portal design/change-notices (ECR + ECN register),
/// change-requests/new and change-requests/[id]. ECN screens: design_ecn.dart.

const _ecrStatusColors = {
  'open': Color(0xFFF59E0B),
  'impact_checked': Color(0xFF7C3AED),
  'approved': Color(0xFF16A34A),
  'rejected': Color(0xFFDC2626),
  'deferred': Color(0xFF78716C),
  'withdrawn': Color(0xFFA8A29E),
};
const _urgencyColors = {'low': Color(0xFF78716C), 'normal': Color(0xFF2563EB), 'high': Color(0xFFF59E0B), 'critical': Color(0xFFDC2626)};
const _voteLabels = {'approve': 'Approve', 'reject': 'Reject', 'defer': 'Defer'};
const _voteColors = {'approve': Color(0xFF16A34A), 'reject': Color(0xFFDC2626), 'defer': Color(0xFF78716C)};

Widget ecrStatusBadge(Object? s) => StatusBadge(labelOf(ecrStatusLabels, s), color: _ecrStatusColors[str(s)]);

const _ecnTabs = <(String, String)>[
  ('draft,submitted,approved,implemented', 'Open'),
  ('approved', 'Open — revising'),
  ('implemented', 'Released — acknowledging'),
  ('closed', 'Closed'),
  ('draft,submitted', 'Draft / Awaiting approval'),
  ('rejected,cancelled', 'Rejected / Cancelled'),
  ('', 'All'),
];
const _ecrTabs = <(String, String)>[
  ('open,impact_checked', 'Undecided'),
  ('open', 'Impact check'),
  ('impact_checked', 'With change board'),
  ('approved', 'Approved'),
  ('rejected,deferred,withdrawn', 'Rejected / Deferred / Withdrawn'),
  ('', 'All'),
];

// ── Tab ──────────────────────────────────────────────────────────────────────

class DesignChangesTab extends StatefulWidget {
  const DesignChangesTab({super.key});

  @override
  State<DesignChangesTab> createState() => _DesignChangesTabState();
}

class _DesignChangesTabState extends State<DesignChangesTab> {
  final _list = GlobalKey<ApiListViewState>();
  String _section = 'ecr';
  String _ecrTab = _ecrTabs.first.$1;
  String _ecnTab = _ecnTabs.first.$1;
  String? _source;
  bool _mine = false;
  Json _me = const {};

  @override
  void initState() {
    super.initState();
    DesignMe.load().then((m) {
      if (mounted) setState(() => _me = m);
    });
  }

  void _reload() => _list.currentState?.reload();

  Future<void> _raise() async {
    final id = await showCreateEcrFormId(context);
    if (id != null && mounted) {
      _reload();
      openScreen(context, DesignChangeRequestDetail(id: id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final ecr = _section == 'ecr';
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: CreateFab(label: 'Raise ECR', onPressed: _raise),
      body: ApiListView(
        key: _list,
        searchHint: ecr ? 'Search by ECR number or title…' : 'Search by ECN number, title or description…',
        emptyText: ecr
            ? 'No change requests here — use + Raise ECR to ask for a change to a released drawing or BOM.'
            : 'No change notices here — they are created from an approved change request (“Create ECN”).',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Changes',
              subtitle:
                  'Anyone raises a change request (ECR) against a released drawing or BOM → Design checks the impact → the change board votes → an approved ECR becomes a change notice (ECN).'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'ecr', label: Text('Change requests (ECR)')),
                ButtonSegment(value: 'ecn', label: Text('Change notices (ECN)')),
              ],
              selected: {_section},
              showSelectedIcon: false,
              onSelectionChanged: (s) {
                setState(() => _section = s.first);
                _reload();
              },
            ),
          ),
          if (!ecr && DesignMe.isHead(_me))
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const InfoNote(
                    'ECNs normally come from an approved change request — open the ECR and use “Create ECN”. Raise one directly only for a change that skips the change board.'),
                const SizedBox(height: 6),
                OutlinedButton(
                  onPressed: () async {
                    final id = await showEcnForm(context);
                    if (id != null && context.mounted) {
                      _reload();
                      openScreen(context, DesignChangeNoticeDetail(id: id));
                    }
                  },
                  child: const Text('+ New ECN'),
                ),
              ]),
            ),
          ChipRow(children: [
            for (final t in ecr ? _ecrTabs : _ecnTabs)
              CountChip(t.$2, null, selected: (ecr ? _ecrTab : _ecnTab) == t.$1, onTap: () {
                setState(() => ecr ? _ecrTab = t.$1 : _ecnTab = t.$1);
                _reload();
              }),
          ]),
          if (ecr) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
              child: AppSelect<String>(
                  label: 'All sources',
                  value: _source,
                  options: optionsOf(ecrSourceLabels),
                  onChanged: (o) {
                    setState(() => _source = o?.value);
                    _reload();
                  }),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: CheckField(
                  label: 'Raised by me',
                  value: _mine,
                  onChanged: (v) {
                    setState(() => _mine = v);
                    _reload();
                  }),
            ),
          ],
        ]),
        load: (p, s) => ecr
            ? Api.list('/design/change-requests', query: {'status': _ecrTab, 'source': _source, 'mine': _mine ? true : null, 'search': s})
            : Api.list('/design/change-notices', query: {'status': _ecnTab, 'search': s}),
        itemBuilder: (ctx, r, reload) => ecr ? _ecrCard(ctx, r, reload) : _ecnCard(ctx, r, reload),
      ),
    );
  }

  Widget _ecrCard(BuildContext ctx, Json r, VoidCallback reload) => RecordCard(
        code: str(r['ecr_number']),
        title: str(r['title']),
        trailing: Padding(padding: const EdgeInsets.only(left: 8), child: ecrStatusBadge(r['status'])),
        meta: [
          ('Source', labelOf(ecrSourceLabels, r['source'])),
          ('Urgency', labelOf(ecrUrgencyLabels, r['urgency'])),
          ('Items', '${jsonList(r['items']).length}'),
          ('Raised by', txt(r['raised_by_name'])),
          if ((asInt(r['votes_needed']) ?? 0) > 0) ('Votes', '${r['votes_cast']} / ${r['votes_needed']}'),
          if (const ['open', 'impact_checked'].contains(str(r['status']))) ('Days open', '${r['days_open']}'),
          if (str(r['ecn_number']).isNotEmpty) ('ECN', str(r['ecn_number'])),
        ],
        onTap: () async {
          await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => DesignChangeRequestDetail(id: asInt(r['id'])!)));
          reload();
        },
      );

  Widget _ecnCard(BuildContext ctx, Json e, VoidCallback reload) {
    final total = (asInt(e['document_count']) ?? jsonList(e['documents']).length) + jsonList(e['boms']).length;
    final acks = jsonList(e['acknowledgements']).length;
    return RecordCard(
      code: str(e['ecn_number']),
      title: str(e['title']),
      trailing: Padding(padding: const EdgeInsets.only(left: 8), child: ecnStatusBadge(e['status'])),
      meta: [
        if (str(e['ecr_number']).isNotEmpty) ('ECR', str(e['ecr_number'])),
        ('Reason', labelOf(ecnReasonLabels, e['reason'])),
        ('Priority', priorityLabel(e['priority'])),
        ('Items', const ['approved', 'implemented', 'closed'].contains(str(e['status'])) ? '${e['released_count']} / $total released' : '$total'),
        ('Raised by', txt(e['created_by_name'])),
        ('Target', fmtDate(e['target_date'])),
        ('Acknowledged', acks > 0 ? '${e['acknowledged_count']} / $acks' : '—'),
      ],
      onTap: () async {
        await Navigator.of(ctx).push(MaterialPageRoute(builder: (_) => DesignChangeNoticeDetail(id: asInt(e['id'])!)));
        reload();
      },
    );
  }
}

// ── ECR create / edit ────────────────────────────────────────────────────────

class _Item {
  _Item(this.kind, this.id, this.label, String note) : note = TextEditingController(text: note);
  final String kind; // document | bom
  final int id;
  final String label;
  final TextEditingController note;
}

/// "Raise ECR" from a drawing / BOM (prefilled). True when one was raised.
Future<bool> showCreateEcrForm(BuildContext context, {int? documentId, int? bomId}) async {
  final id = await showCreateEcrFormId(context, documentId: documentId, bomId: bomId);
  if (id != null && context.mounted) openScreen(context, DesignChangeRequestDetail(id: id));
  return id != null;
}

/// Raise Change Request (ECR) or edit one ([existing]). Returns the ECR id.
Future<int?> showCreateEcrFormId(BuildContext context, {int? documentId, int? bomId, Json? existing}) async {
  final e = existing;
  final items = <_Item>[
    for (final i in jsonList(e?['items']))
      _Item(i['bom_id'] != null ? 'bom' : 'document', asInt(i['bom_id'] ?? i['document_id'])!,
          '${txt(i['number'])} — ${txt(i['title'])}', str(i['note'])),
  ];
  String? preError;
  if (e == null && (documentId != null || bomId != null)) {
    try {
      if (documentId != null) {
        final rows = await designLookup('released-documents', '');
        final d0 = rows.where((o) => o.value == documentId).firstOrNull;
        if (d0 != null) {
          items.add(_Item('document', d0.value, d0.label, ''));
        } else {
          preError = "That drawing has no released revision, so an ECR can't be raised against it yet — change it through its open revision instead.";
        }
      }
      if (bomId != null) {
        final rows = await designLookup('boms', '', query: {'released_only': true});
        final b0 = rows.where((o) => o.value == bomId).firstOrNull;
        if (b0 != null) {
          items.add(_Item('bom', b0.value, b0.label, ''));
        } else {
          preError = "That BOM has no released revision, so an ECR can't be raised against it yet — change it through its open revision instead.";
        }
      }
    } catch (err) {
      preError = ApiClient.describe(err);
    }
  }
  if (!context.mounted) return null;
  final title = TextEditingController(text: str(e?['title']));
  final reason = TextEditingController(text: str(e?['reason']));
  final proposed = TextEditingController(text: str(e?['proposed_change']));
  final sourceRef = TextEditingController(text: str(e?['source_reference']));
  String source = str(e?['source']).isEmpty ? 'design' : str(e?['source']);
  String urgency = str(e?['urgency']).isEmpty ? 'normal' : str(e?['urgency']);
  int? qualityId = asInt(e?['quality_ncr_id'] ?? e?['quality_capa_id']);
  String? qualityL = nullIfEmpty(str(e?['ncr_number'] ?? e?['capa_number']));
  int? projectId = asInt(e?['pm_project_id']), machineId = asInt(e?['erp_project_id']);
  String? projectL = nullIfEmpty(str(e?['pm_project_label'])), machineL = nullIfEmpty(str(e?['erp_project_label']));
  int? resultId;
  await showFormSheet(
    context,
    title: e == null ? 'Raise Change Request (ECR)' : 'Edit change request',
    saveLabel: e == null ? 'Raise ECR' : 'Save',
    builder: (ctx, setS) => [
      InfoNote(e == null
          ? 'Ask Design to change a released drawing or BOM. Design checks the impact, then the change board decides.'
          : '${e['ecr_number']} — ${e['title']}'),
      if (preError != null) ErrorBanner(preError),
      const Caps('Request'),
      AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Bracket cracks at weld toe — thicken gusset'),
      AppSelect<String>(
          label: 'Source',
          clearable: false,
          value: source,
          options: optionsOf(ecrSourceLabels),
          onChanged: (o) => setS(() {
                source = o?.value ?? source;
                qualityId = null;
                qualityL = null;
              })),
      AppSelect<String>(
          label: 'Urgency', clearable: false, value: urgency, options: optionsOf(ecrUrgencyLabels), onChanged: (o) => setS(() => urgency = o?.value ?? urgency)),
      AppTextField(label: 'Reason — what is wrong today', controller: reason, required: true, maxLines: 3),
      AppTextField(label: 'Proposed change', controller: proposed, required: true, maxLines: 3),
      const Caps('Source details'),
      if (source == 'ncr' || source == 'capa')
        AppSelect<int>(
          key: ValueKey('q$source'),
          label: source == 'ncr' ? 'NCR' : 'CAPA',
          value: qualityId,
          valueLabel: qualityL,
          loadOptions: (s) => designLookup('quality-records', s, query: {'kind': source}, sendSearch: true),
          onChanged: (o) => setS(() {
            qualityId = o?.value;
            qualityL = o?.label;
          }),
        ),
      AppTextField(label: 'Source reference', controller: sourceRef, hint: 'e.g. customer letter no., field report no.'),
      const Caps('Associations'),
      AppSelect<int>(
          label: 'Project',
          value: projectId,
          valueLabel: projectL,
          loadOptions: (s) => designLookup('projects', s),
          onChanged: (o) => setS(() {
                projectId = o?.value;
                projectL = o?.label;
              })),
      AppSelect<int>(
          label: 'Machine',
          value: machineId,
          valueLabel: machineL,
          loadOptions: (s) => designLookup('machines', s),
          onChanged: (o) => setS(() {
                machineId = o?.value;
                machineL = o?.label;
              })),
      const Caps('Affected drawings & BOMs *'),
      for (final it in items)
        Container(
          padding: const EdgeInsets.fromLTRB(12, 6, 4, 8),
          decoration: BoxDecoration(color: Brand.background, border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text(it.kind == 'bom' ? 'BOM  ' : 'DRAWING  ',
                  style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: it.kind == 'bom' ? const Color(0xFF7C3AED) : const Color(0xFF2563EB))),
              Expanded(child: Text(it.label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13))),
              IconButton(icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger, size: 20), onPressed: () => setS(() => items.remove(it))),
            ]),
            Padding(padding: const EdgeInsets.only(right: 8), child: AppTextField(label: 'What should change here (optional)', controller: it.note)),
          ]),
        ),
      AppSelect<int>(
        key: ValueKey('d${items.length}'),
        label: 'Add a released drawing',
        value: null,
        loadOptions: (s) async => (await designLookup('released-documents', s))
            .where((o) => !items.any((i) => i.kind == 'document' && i.id == o.value))
            .toList(),
        onChanged: (o) {
          if (o != null) setS(() => items.add(_Item('document', o.value, o.label, '')));
        },
      ),
      AppSelect<int>(
        key: ValueKey('b${items.length}'),
        label: 'Add a released BOM',
        value: null,
        loadOptions: (s) async =>
            (await designLookup('boms', s, query: {'released_only': true})).where((o) => !items.any((i) => i.kind == 'bom' && i.id == o.value)).toList(),
        onChanged: (o) {
          if (o != null) setS(() => items.add(_Item('bom', o.value, o.label, '')));
        },
      ),
    ],
    onSave: () async {
      if (title.text.trim().length < 3) throw 'Give the change request a title (at least 3 characters).';
      if (reason.text.trim().length < 3) throw 'Explain the reason for the change — what problem it solves.';
      if (proposed.text.trim().length < 3) throw 'Describe the proposed change.';
      if (items.isEmpty) {
        throw e == null ? 'Add at least one released drawing or BOM this change affects.' : 'Keep at least one released drawing or BOM on the change request.';
      }
      final payload = {
        'title': title.text.trim(),
        'source': source,
        'quality_ncr_id': source == 'ncr' ? qualityId : null,
        'quality_capa_id': source == 'capa' ? qualityId : null,
        'source_reference': nullIfEmpty(sourceRef.text),
        'urgency': urgency,
        'reason': reason.text.trim(),
        'proposed_change': proposed.text.trim(),
        'pm_project_id': projectId,
        'erp_project_id': machineId,
        'items': [
          for (final i in items)
            {'document_id': i.kind == 'document' ? i.id : null, 'bom_id': i.kind == 'bom' ? i.id : null, 'note': nullIfEmpty(i.note.text)},
        ],
      };
      final out = jsonMap(e == null ? await Api.post('/design/change-requests', data: payload) : await Api.patch('/design/change-requests/${e['id']}', data: payload));
      resultId = asInt(out['id']);
    },
  );
  return resultId;
}

// ── ECR detail ───────────────────────────────────────────────────────────────

const _ecrEventLabels = {
  'ecr_raised': 'raised the change request',
  'ecr_updated': 'edited it',
  'ecr_impact_checked': 'recorded the impact check',
  'ecr_vote': 'voted',
  'ecr_approved': 'approved it',
  'ecr_rejected': 'rejected it',
  'ecr_deferred': 'deferred it',
  'ecr_reopened': 'reopened it for the board',
  'ecr_withdrawn': 'withdrew it',
  'ecn_created_from_ecr': 'created the change notice',
  'comment': 'commented',
};

class DesignChangeRequestDetail extends StatefulWidget {
  const DesignChangeRequestDetail({super.key, required this.id});
  final int id;

  @override
  State<DesignChangeRequestDetail> createState() => _DesignChangeRequestDetailState();
}

class _DesignChangeRequestDetailState extends State<DesignChangeRequestDetail> {
  Json? _ecr;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = jsonMap(await Api.get('/design/change-requests/${widget.id}'));
      if (mounted) setState(() => (_ecr = d, _error = null));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  bool _can(String a) => strList(_ecr?['allowed_actions']).contains(a);

  Future<void> _act(Future<dynamic> Function() fn, String done) async {
    setState(() => _busy = true);
    Json? out;
    final ok = await runAction(context, () async {
      final r = await fn();
      if (r is Map) out = jsonMap(r);
    }, success: done);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (ok && out != null && out!.containsKey('ecr_number')) _ecr = out;
    });
  }

  Future<void> _prompt(String which) async {
    final r = _ecr!;
    final (title, message, label, required) = switch (which) {
      'vote_approve' => ('Vote to approve', 'Your vote is recorded on the change board. You can change it until the head decides.', 'Vote Approve', false),
      'vote_reject' => ('Vote to reject', 'Say why — the board and the person who raised it see your comment.', 'Vote Reject', true),
      'vote_defer' => ('Vote to defer', 'Say why it should wait and until when.', 'Vote Defer', true),
      'decide_approved' => (
          'Approve the change request',
          'The ECR is approved — next, create the ECN with its effectivity and stock/WIP disposition.',
          'Approve ECR',
          false
        ),
      'decide_rejected' => ('Reject the change request', 'This is final — the person who raised it sees your reason.', 'Reject ECR', true),
      'decide_deferred' => ('Defer the change request', 'Deferred ECRs can be reopened for the board later.', 'Defer ECR', true),
      _ => ('Withdraw the change request', 'The ECR is closed as withdrawn and stays on record.', 'Withdraw', true),
    };
    final v = await promptDialog(context,
        title: title, message: '${r['ecr_number']} — $message', label: required ? 'Reason' : 'Comment', required: required, confirmLabel: label);
    if (v == null || !mounted) return;
    final c = nullIfEmpty(v);
    if (which.startsWith('vote_')) {
      final vote = which.substring(5);
      await _act(() => Api.post('/design/change-requests/${r['id']}/vote', data: {'vote': vote, 'comment': c}), 'Your vote (${_voteLabels[vote]}) is recorded.');
    } else if (which.startsWith('decide_')) {
      final d = which.substring(7);
      await _act(() => Api.post('/design/change-requests/${r['id']}/decide', data: {'decision': d, 'comment': c}), '${r['ecr_number']} ${labelOf(ecrStatusLabels, d).toLowerCase()}.');
    } else {
      await _act(() => Api.post('/design/change-requests/${r['id']}/withdraw', data: {'comment': v}), '${r['ecr_number']} withdrawn.');
    }
  }

  Future<void> _reopen() async {
    final r = _ecr!;
    if (!await confirmDialog(context,
            title: 'Reopen for the change board?', message: '${r['ecr_number']} goes back to the change board for a new vote.', confirmLabel: 'Reopen') ||
        !mounted) {
      return;
    }
    await _act(() => Api.post('/design/change-requests/${r['id']}/reopen'), '${r['ecr_number']} reopened for the board.');
  }

  Future<void> _impact() async {
    final r = _ecr!;
    final summary = TextEditingController(text: str(r['impact_summary']));
    final stock = TextEditingController(text: str(r['impact_stock']));
    final orders = TextEditingController(text: str(r['impact_open_orders']));
    final cost = TextEditingController(text: r['impact_cost'] == null ? '' : '${r['impact_cost']}');
    final days = TextEditingController(text: r['impact_delivery_days'] == null ? '' : '${r['impact_delivery_days']}');
    final board = <int, String>{
      for (final b in jsonList(r['board_members'])) asInt(b['user_id'])!: str(b['name']).isEmpty ? 'User #${b['user_id']}' : str(b['name']),
    };
    var touched = false;
    final seeCost = designFeature('change_notices', 'cost_impact', 'view');
    final saved = await showFormSheet(context, title: str(r['status']) == 'open' ? 'Record impact' : 'Update impact', builder: (ctx, setS) => [
          InfoNote('${r['ecr_number']} — ${r['title']}'),
          const Caps('Impact'),
          AppTextField(label: 'Impact summary', controller: summary, required: true, maxLines: 3),
          AppTextField(label: 'Stock affected', controller: stock, maxLines: 2, hint: 'e.g. 12 brackets in store, 4 in paint shop'),
          AppTextField(label: 'Open orders affected', controller: orders, maxLines: 2, hint: 'e.g. PO-2026-0412 (plates), 3 machines in production'),
          const Caps('Cost & delivery'),
          if (seeCost) AppTextField(label: 'Cost impact (₹)', controller: cost, keyboardType: AppTextField.number, hint: 'e.g. 25000'),
          AppTextField(label: 'Delivery impact (days)', controller: days, keyboardType: TextInputType.number, hint: 'e.g. 7'),
          const Caps('Change board — who votes'),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final en in board.entries)
              InputChip(
                  label: Text(en.value),
                  onDeleted: () => setS(() {
                        board.remove(en.key);
                        touched = true;
                      })),
          ]),
          AppSelect<int>(
            key: ValueKey('board${board.length}'),
            label: 'Search people to add to the board…',
            value: null,
            loadOptions: (s) async => (await designUsers(s)).where((o) => !board.containsKey(o.value)).toList(),
            onChanged: (o) {
              if (o != null) {
                setS(() {
                  board[o.value] = o.label;
                  touched = true;
                });
              }
            },
          ),
        ], onSave: () async {
      if (summary.text.trim().length < 3) throw 'Summarise the impact — which drawings/BOMs change and what it means for production.';
      final c = cost.text.trim().isEmpty ? null : num.tryParse(cost.text.trim());
      if (cost.text.trim().isNotEmpty && c == null) throw 'Cost impact must be a number in rupees, e.g. 25000.';
      final d = days.text.trim().isEmpty ? null : int.tryParse(days.text.trim());
      if (days.text.trim().isNotEmpty && d == null) throw 'Delivery impact must be a whole number of days, e.g. 7.';
      final sendBoard = touched || jsonList(r['board_members']).isNotEmpty || board.isNotEmpty;
      final out = await Api.post('/design/change-requests/${r['id']}/impact', data: {
        'impact_summary': summary.text.trim(),
        'impact_stock': nullIfEmpty(stock.text),
        'impact_open_orders': nullIfEmpty(orders.text),
        'impact_cost': seeCost ? c : r['impact_cost'],
        'impact_delivery_days': d,
        if (sendBoard) 'board_member_ids': board.keys.toList(),
      });
      if (mounted && out is Map) setState(() => _ecr = jsonMap(out));
    });
    if (saved && mounted) showSnack(context, 'Impact recorded for ${r['ecr_number']}.');
  }

  Future<void> _createEcn() async {
    final r = _ecr!;
    final eff = EcnEffectivity();
    DateTime? target;
    int? ecnId;
    await showFormSheet(context, title: 'Create change notice', saveLabel: 'Create ECN', builder: (ctx, setS) => [
          InfoNote('From ${r['ecr_number']} — ${r['title']}'),
          DateField(label: 'Target date', value: target, onChanged: (d) => setS(() => target = d)),
          const Caps('Effectivity'),
          ...eff.fields(setS, projectHint: "Applies to the ECR's Project / Machine"),
        ], onSave: () async {
      if (eff.type == 'date' && eff.date == null) throw 'Effectivity is "From a date" — pick the date the change takes effect.';
      if (eff.type == 'serial' && eff.serial.text.trim().isEmpty) throw 'Effectivity is "From a serial number" — enter the first serial number it applies to.';
      final out = jsonMap(await Api.post('/design/change-requests/${r['id']}/ecn', data: {'target_date': apiDateOrNull(target), ...eff.payload()}));
      ecnId = asInt(out['id']);
    });
    if (ecnId != null && mounted) {
      _load();
      openScreen(context, DesignChangeNoticeDetail(id: ecnId!));
    }
  }

  List<DAction> _actions(Json r) {
    final canApprove = designFeature('change_notices', 'ecr_decision', 'approve');
    final canReject = designFeature('change_notices', 'ecr_decision', 'reject');
    return [
      if (_can('impact')) DAction(str(r['status']) == 'open' ? 'Record Impact' : 'Update Impact', _impact, primary: true),
      if (_can('vote')) DAction('Vote Approve', () => _prompt('vote_approve'), primary: true),
      if (_can('vote')) DAction('Vote Reject', () => _prompt('vote_reject'), danger: true),
      if (_can('vote')) DAction('Vote Defer', () => _prompt('vote_defer')),
      if (_can('decide') && canApprove) DAction('Approve ECR', () => _prompt('decide_approved'), primary: true),
      if (_can('decide') && canReject) DAction('Reject ECR', () => _prompt('decide_rejected'), danger: true),
      if (_can('decide') && canReject) DAction('Defer ECR', () => _prompt('decide_deferred')),
      if (_can('create_ecn')) DAction('Create ECN', _createEcn, primary: true),
      if (_can('reopen')) DAction('Reopen for Board', _reopen),
      if (_can('edit'))
        DAction('Edit', () async {
          final id = await showCreateEcrFormId(context, existing: r);
          if (id != null && mounted) {
            showSnack(context, '${r['ecr_number']} saved.');
            _load();
          }
        }),
      if (_can('withdraw')) DAction('Withdraw', () => _prompt('withdraw'), danger: true),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final r = _ecr;
    return SubPage(
      title: r == null ? 'Change request' : str(r['ecr_number']),
      bottom: r == null ? null : actionBar(context, _actions(r), busy: _busy),
      body: r == null ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()) : RefreshIndicator(onRefresh: _load, child: _body(r)),
    );
  }

  Widget _body(Json r) {
    final items = jsonList(r['items']);
    final votes = jsonList(r['votes']);
    final board = jsonList(r['board_members']);
    final events = jsonList(r['events']);
    final seeCost = designFeature('change_notices', 'cost_impact', 'view');
    final seeBoard = designFeature('change_notices', 'ecr_vote', 'view');
    return ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
      DetailSection(str(r['title']), children: [
        Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          ecrStatusBadge(r['status']),
          StatusBadge(labelOf(ecrUrgencyLabels, r['urgency']), color: _urgencyColors[str(r['urgency'])]),
          Text('Raised by ${txt(r['raised_by_name'])} · ${fmtDate(r['created_at'])}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          if (const ['open', 'impact_checked'].contains(str(r['status'])))
            Text('${r['days_open']} days open', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
      ]),
      DetailSection('Request', children: [
        FieldRow('Reason', r['reason']),
        FieldRow('Proposed change', r['proposed_change']),
      ]),
      DetailSection('Where it came from', children: [
        FieldRow('Source', labelOf(ecrSourceLabels, r['source'])),
        if (str(r['ncr_number']).isNotEmpty) FieldRow('NCR', r['ncr_number']),
        if (str(r['capa_number']).isNotEmpty) FieldRow('CAPA', r['capa_number']),
        FieldRow('Source reference', r['source_reference']),
      ]),
      DetailSection('Linked to', children: [
        FieldRow('Project', r['pm_project_label']),
        FieldRow('Machine', r['erp_project_label']),
        FieldRow(
            'Change notice',
            r['ecn_id'] == null
                ? null
                : InkWell(
                    onTap: () => openScreen(context, DesignChangeNoticeDetail(id: asInt(r['ecn_id'])!)),
                    child: Text(txt(r['ecn_number']), style: const TextStyle(color: Brand.primaryActive, fontWeight: FontWeight.w600)),
                  )),
      ]),
      DetailSection('Affected items & where used', children: [
        if (items.isEmpty) const Text('No affected items listed.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final i in items)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(12)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              InkWell(
                onTap: () => openScreen(
                    context, i['bom_id'] != null ? DesignBomDetail(id: asInt(i['bom_id'])!) : DesignDocumentDetail(id: asInt(i['document_id'])!)),
                child: Text.rich(TextSpan(children: [
                  TextSpan(
                      text: i['bom_id'] != null ? 'BOM  ' : 'DRAWING  ',
                      style: TextStyle(
                          fontSize: 10.5, fontWeight: FontWeight.w700, color: i['bom_id'] != null ? const Color(0xFF7C3AED) : const Color(0xFF2563EB))),
                  TextSpan(text: txt(i['number']), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.primaryActive)),
                  TextSpan(text: '  ${txt(i['title'])}'),
                  if (str(i['released_revision_label']).isNotEmpty)
                    TextSpan(text: '  released ${i['released_revision_label']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ])),
              ),
              if (str(i['note']).isNotEmpty) Text(str(i['note']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              const SizedBox(height: 4),
              if (jsonList(i['where_used']).isEmpty) const Text('Not used in any BOM.', style: TextStyle(fontSize: 12, color: Brand.muted)),
              for (final w in jsonList(i['where_used']))
                InkWell(
                  onTap: () => openScreen(context, DesignBomDetail(id: asInt(w['bom_id'])!)),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Text(
                        'Used in ${w['bom_number']} ${w['revision_label']} (${labelOf(bomStatusLabels, w['revision_status'])}) · Qty ${txt(w['quantity'])}'
                        '${[str(w['pm_project_label']), str(w['erp_project_label'])].where((s) => s.isNotEmpty).map((s) => ' · $s').join()}',
                        style: const TextStyle(fontSize: 12.5)),
                  ),
                ),
            ]),
          ),
      ]),
      DetailSection('Impact', children: [
        if (r['impact_checked_at'] == null)
          const Text('Design has not recorded the impact yet.', style: TextStyle(fontSize: 13, color: Brand.muted))
        else ...[
          FieldRow('Summary', r['impact_summary']),
          FieldRow('Stock affected', r['impact_stock']),
          FieldRow('Open orders affected', r['impact_open_orders']),
          if (seeCost) FieldRow('Cost impact', r['impact_cost'] == null ? null : fmtMoney(r['impact_cost'])),
          FieldRow('Delivery impact',
              r['impact_delivery_days'] == null ? null : '${r['impact_delivery_days']} day${r['impact_delivery_days'] == 1 ? '' : 's'}'),
          FieldRow('Checked by', '${txt(r['impact_checked_by_name'])} · ${fmtDateTime(r['impact_checked_at'])}'),
        ],
      ]),
      DetailSection('Change board', children: [
        if (!seeBoard)
          const Text("Your role doesn't include the change board view (Design › Changes › Change board vote).",
              style: TextStyle(fontSize: 13, color: Brand.muted))
        else if (board.isEmpty)
          const Text('The board is set when the impact is recorded.', style: TextStyle(fontSize: 13, color: Brand.muted))
        else
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final b in board)
              Chip(
                label: Text(
                    '${str(b['name']).isEmpty ? 'User #${b['user_id']}' : b['name']} · ${b['vote'] == null ? 'not voted' : labelOf(_voteLabels, b['vote'])}'),
                side: BorderSide(color: _voteColors[str(b['vote'])] ?? Brand.border),
              ),
          ]),
        if (seeBoard)
          for (final v in votes)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                StatusBadge(labelOf(_voteLabels, v['vote']), color: _voteColors[str(v['vote'])]),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('${txt(v['user_name'])} · ${fmtDateTime(v['updated_at'])}${str(v['comment']).isEmpty ? '' : '\n${v['comment']}'}',
                      style: const TextStyle(fontSize: 12.5)),
                ),
              ]),
            ),
        if (r['decided_at'] != null)
          FieldRow('Decision — ${labelOf(ecrStatusLabels, r['status'])}',
              '${txt(r['decided_by_name'])} · ${fmtDate(r['decided_at'])}${str(r['decision_comment']).isEmpty ? '' : ' — ${r['decision_comment']}'}'),
      ]),
      DetailSection(
        'Timeline',
        action: TextButton.icon(
          icon: const Icon(Icons.add_comment_outlined, size: 18),
          label: const Text('Comment'),
          onPressed: () async {
            final t = await promptDialog(context, title: 'Add a comment', label: 'Comment', confirmLabel: 'Post');
            if (t == null || t.isEmpty || !mounted) return;
            await _act(() => Api.post('/design/change-requests/${r['id']}/comments', data: {'comment': t}), 'Comment added.');
          },
        ),
        children: [
          if (events.isEmpty) const Text('No activity yet.', style: TextStyle(color: Brand.muted)),
          for (final ev in events)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text.rich(TextSpan(style: const TextStyle(fontSize: 13), children: [
                  TextSpan(text: str(ev['actor_name']).isEmpty ? 'System' : str(ev['actor_name']), style: const TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(text: ' ${_ecrEventLabels[str(ev['action'])] ?? str(ev['action']).replaceAll('_', ' ')}'),
                ])),
                if (str(ev['comment']).isNotEmpty) Text(str(ev['comment']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                Text(fmtDateTime(ev['created_at']), style: const TextStyle(fontSize: 11, color: Brand.muted)),
              ]),
            ),
        ],
      ),
    ]);
  }
}
