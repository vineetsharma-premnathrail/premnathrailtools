import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';
import 'lifecycle_detail.dart';

// Portal: app/dashboard/hr/lifecycle (list, new, [id]) + components/hr/lifecycle/*

/// One checklist task assigned to me (portal MyChecklistTasks row).
Widget checklistTaskCard(BuildContext context, Json t, VoidCallback onChanged) => RecordCard(
      code: str(t['event_no']),
      title: str(t['title']),
      subtitle: joinNonEmpty([t['subject_name'], labelOf(checklistCategoryLabels, t['category'])]),
      trailing: statusPill(t['event_type'], lcTypeLabels, lcTypeHex),
      onTap: () => showModalBottomSheet<void>(
        context: context,
        builder: (ctx) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: actionRow([
              LinkAction('Open', () async {
                Navigator.pop(ctx);
                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => LifecycleDetailScreen(eventId: asInt(t['event_id']) ?? 0)));
                onChanged();
              }),
              LinkAction('✓ Mark done', () async {
                Navigator.pop(ctx);
                final ok = await runAction(context, () => Api.patch('/hr/lifecycle/items/${t['id']}', data: {'status': 'done'}));
                if (ok) onChanged();
              }, color: Brand.success),
            ]),
          ),
        ),
      ),
    );

Json? _meta;
Future<Json> lifecycleMeta({int? includeUserId}) async {
  if (includeUserId != null) return mapOf(await Api.get('/hr/lifecycle/meta', query: {'include_user_id': includeUserId}));
  return _meta ??= mapOf(await Api.get('/hr/lifecycle/meta'));
}

List<Option<int>> _metaOpts(Json meta, String key, {bool withCode = false}) => [
      for (final r in rowsOf(meta[key]))
        Option(asInt(r['id']) ?? 0, withCode && str(r['code']).isNotEmpty ? '${r['code']} — ${r['name']}' : str(r['name'])),
    ];

List<Option<int>> lcUserOpts(Json meta, {int? except}) => [
      for (final u in rowsOf(meta['users']))
        if (asInt(u['id']) != except)
          Option(asInt(u['id']) ?? 0, str(u['name']), subtitle: str(u['designation']).isNotEmpty ? str(u['designation']) : str(u['email'])),
    ];

/// Mutable event fields (portal EventFormState).
class EventForm {
  EventForm([Json? e]) {
    candidateName.text = str(e?['candidate_name']);
    candidateEmail.text = str(e?['candidate_email']);
    effective = dateOf(e?['effective_date']);
    dept = asInt(e?['to_department_id']);
    branch = asInt(e?['to_branch_id']);
    desig = asInt(e?['to_designation_id']);
    grade = asInt(e?['to_grade_id']);
    manager = asInt(e?['to_manager_id']);
    resignation = dateOf(e?['resignation_date']);
    lwd = dateOf(e?['last_working_day']);
    exitType = textOrNull(str(e?['exit_type']));
    exitReason.text = str(e?['exit_reason']);
    notice.text = str(e?['notice_period_days']);
    handover = asInt(e?['handover_to_id']);
    remarks.text = str(e?['remarks']);
  }
  final candidateName = TextEditingController();
  final candidateEmail = TextEditingController();
  DateTime? effective, resignation, lwd;
  int? dept, branch, desig, grade, manager, handover;
  String? exitType;
  final exitReason = TextEditingController();
  final notice = TextEditingController();
  final remarks = TextEditingController();

  Map<String, dynamic> payload(String type) {
    final p = <String, dynamic>{'effective_date': isoOrNull(effective), 'remarks': textOrNull(remarks.text)};
    if (type == 'joining') {
      p['candidate_name'] = textOrNull(candidateName.text);
      p['candidate_email'] = textOrNull(candidateEmail.text);
    }
    if (type == 'joining' || type == 'transfer' || type == 'promotion') {
      p.addAll({'to_department_id': dept, 'to_branch_id': branch, 'to_designation_id': desig, 'to_grade_id': grade, 'to_manager_id': manager});
    }
    if (type == 'transfer' || type == 'promotion' || type == 'exit') p['handover_to_id'] = handover;
    if (type == 'exit') {
      p.addAll({
        'resignation_date': isoOrNull(resignation), 'last_working_day': isoOrNull(lwd), 'exit_type': exitType,
        'exit_reason': textOrNull(exitReason.text), 'notice_period_days': int.tryParse(notice.text.trim()),
      });
    }
    return p;
  }

  /// Portal EventFields for one event type.
  List<Widget> fields(String type, Json meta, StateSetter setS, {int? subject}) {
    final users = lcUserOpts(meta, except: subject);
    final isMove = type == 'joining' || type == 'transfer' || type == 'promotion';
    final j = type == 'joining';
    final dateLabel = j ? 'Date of joining' : type == 'confirmation' ? 'Confirmation date' : 'Effective from';
    return [
      if (type != 'exit') DateField(label: dateLabel, value: effective, onChanged: (d) => setS(() => effective = d)),
      if (isMove) ...[
        HintText(j
            ? 'Where the new joiner will sit. Applied to their employee profile when the joining is completed.'
            : 'Only fill what changes — blank fields stay as they are. Applied when the event is completed.'),
        AppSelect<int>(label: j ? 'Department' : 'New department', value: dept, options: _metaOpts(meta, 'departments'), onChanged: (o) => setS(() => dept = o?.value)),
        AppSelect<int>(label: j ? 'Plant' : 'New plant', value: branch, options: _metaOpts(meta, 'branches'), onChanged: (o) => setS(() => branch = o?.value)),
        AppSelect<int>(label: j ? 'Designation' : 'New designation', value: desig, options: _metaOpts(meta, 'designations'), onChanged: (o) => setS(() => desig = o?.value)),
        AppSelect<int>(label: j ? 'Grade' : 'New grade', value: grade, options: _metaOpts(meta, 'grades', withCode: true), onChanged: (o) => setS(() => grade = o?.value)),
        AppSelect<int>(label: j ? 'Reporting manager' : 'New reporting manager', value: manager, options: users, onChanged: (o) => setS(() => manager = o?.value)),
      ],
      if (type == 'transfer' || type == 'promotion') ...[
        AppSelect<int>(label: 'Successor (optional)', value: handover, options: users, onChanged: (o) => setS(() => handover = o?.value)),
        const HintText('Needed only if the old department head slot or pending P2P approvals should move to someone else on completion.'),
      ],
      if (type == 'exit') ...[
        AppSelect<String>(
            label: 'Exit type', value: exitType,
            options: [for (final t in (meta['exit_types'] is List ? meta['exit_types'] as List : exitTypeLabels.keys.toList())) Option(str(t), labelOf(exitTypeLabels, t))],
            onChanged: (o) => setS(() => exitType = o?.value)),
        DateField(label: 'Resignation date', value: resignation, onChanged: (d) => setS(() => resignation = d)),
        DateField(label: 'Last working day', required: true, value: lwd, onChanged: (d) => setS(() => lwd = d)),
        AppTextField(label: 'Notice (days)', controller: notice, keyboardType: TextInputType.number, hint: 'e.g. 30'),
        AppSelect<int>(label: 'Handover to (successor)', value: handover, options: users, onChanged: (o) => setS(() => handover = o?.value)),
        AppTextField(label: 'Exit reason', controller: exitReason, maxLines: 3, hint: 'Why the employee is leaving (HR-only)'),
      ],
      AppTextField(label: 'Remarks', controller: remarks, maxLines: 2, hint: 'Anything HR should know about this event (HR-only)'),
    ];
  }
}

const lcTypes = [
  ('joining', 'Joining', 'New hire or rehire — onboarding checklist'),
  ('confirmation', 'Confirmation', 'Probation completed → confirmed'),
  ('transfer', 'Transfer', 'Department, plant or manager change'),
  ('promotion', 'Promotion', 'New designation or grade'),
  ('exit', 'Exit', 'Resignation, termination… — offboarding'),
];

/// New lifecycle event. Returns the new event or null.
Future<Json?> showNewEventForm(BuildContext context, {String type = 'joining', int? userId, String? userName}) async {
  Json meta;
  try {
    meta = await lifecycleMeta(includeUserId: userId);
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return null;
  }
  if (!context.mounted) return null;
  var t = type;
  var mode = userId != null ? 'user' : 'candidate';
  int? uid = userId;
  final f = EventForm();
  var start = true;
  Json? created;
  final ok = await showFormSheet(context,
      title: 'New Lifecycle Event',
      saveLabel: 'Create',
      builder: (ctx, setS) {
        final needsUser = t != 'joining' || mode == 'user';
        return [
          const HintText('The checklist is copied from the templates in HR > Masters > Checklist Templates.'),
          AppSelect<String>(
              label: 'Event type', value: t, clearable: false,
              options: [for (final x in lcTypes) Option(x.$1, x.$2, subtitle: x.$3)],
              onChanged: (o) => setS(() => t = o?.value ?? t)),
          if (t == 'joining')
            AppSelect<String>(
                label: 'New joiner', value: mode, clearable: false,
                options: const [Option('candidate', 'Not in the portal yet'), Option('user', 'Already has a portal account')],
                onChanged: (o) => setS(() => mode = o?.value ?? mode)),
          if (t == 'joining' && mode == 'candidate') ...[
            AppTextField(label: 'Full name', controller: f.candidateName, required: true, hint: 'As on the offer letter'),
            AppTextField(label: 'Work email', controller: f.candidateEmail, keyboardType: TextInputType.emailAddress, hint: 'name@premnathrail.com'),
            const HintText('Once IT creates the Microsoft account and the joiner signs in once, use Link user on the event — the portal user is found by this email.'),
          ],
          if (needsUser)
            AppSelect<int>(
                label: 'Employee', required: true, value: uid, valueLabel: userName,
                options: [for (final o in lcUserOpts(meta)) if (o.value != myUserId) o],
                onChanged: (o) => setS(() => uid = o?.value)),
          ...f.fields(t, meta, setS, subject: needsUser ? uid : null),
          CheckField(label: 'Start the checklist now (unticked = save as draft)', value: start, onChanged: (v) => setS(() => start = v)),
          HintText(start
              ? 'Create & start checklist copies the ${lcTypeLabels[t]!.toLowerCase()} checklist and notifies each task owner.'
              : 'Save as draft keeps the event without starting the checklist.'),
        ];
      },
      onSave: () async {
        final needsUser = t != 'joining' || mode == 'user';
        if (needsUser && uid == null) throw 'Pick the employee this event is for.';
        if (t == 'joining' && mode == 'candidate' && f.candidateName.text.trim().isEmpty) throw "Enter the new joiner's name.";
        final em = f.candidateEmail.text.trim();
        if (t == 'joining' && mode == 'candidate' && em.isNotEmpty && !RegExp(r'^\S+@\S+\.\S+$').hasMatch(em)) {
          throw "The work email doesn't look right — check it, or leave it blank and link the portal user later.";
        }
        if (t == 'exit' && f.lwd == null) throw 'Enter the last working day.';
        final payload = {...f.payload(t), 'event_type': t, 'status': start ? 'in_progress' : 'draft'};
        if (needsUser) payload['user_id'] = uid;
        if (t == 'joining' && mode == 'user') {
          payload['candidate_name'] = null;
          payload['candidate_email'] = null;
        }
        created = mapOf(await Api.post('/hr/lifecycle/events', data: payload));
      });
  return ok ? created : null;
}

/// HR › Lifecycle list.
class LifecyclePage extends StatefulWidget {
  const LifecyclePage({super.key});

  @override
  State<LifecyclePage> createState() => _LifecyclePageState();
}

class _LifecyclePageState extends State<LifecyclePage> {
  String _type = '';
  String _status = 'open';
  int _rev = 0;
  Json? _counts;
  List<Json> _tasks = [];

  @override
  void initState() {
    super.initState();
    _side();
  }

  Future<void> _side() async {
    try {
      final c = mapOf(await Api.get('/hr/lifecycle/events/counts'));
      final t = (await Api.list('/hr/lifecycle/my-tasks', query: {'status': 'pending'})).rows;
      if (mounted) setState(() { _counts = c; _tasks = t; });
    } catch (_) {}
  }

  void _refresh() {
    setState(() => _rev++);
    _side();
  }

  @override
  Widget build(BuildContext context) {
    final byType = mapOf(_counts?['open_by_type']);
    const statusOpts = [
      ('open', 'Open (draft + in progress)'), ('', 'All statuses'), ('draft', 'Draft'), ('in_progress', 'In Progress'),
      ('completed', 'Completed'), ('cancelled', 'Cancelled'),
    ];
    return ApiListView(
      key: ValueKey('lc_${_type}_${_status}_$_rev'),
      searchHint: 'Search event no, employee or candidate…',
      load: (_, q) => Api.list('/hr/lifecycle/events', query: {
        'limit': 1000, 'event_type': _type, 'q': q,
        if (_status == 'open') 'open_only': true else 'status': _status,
      }),
      emptyText: _type.isNotEmpty || _status != 'open'
          ? 'No lifecycle events match these filters.'
          : 'No open lifecycle events. Use + New Event to start a joining, transfer or exit.',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        PageHeader('Lifecycle',
            subtitle: 'Joining, confirmation, transfer, promotion and exit events with their checklists.',
            actions: [
              if (Perm.can('hr', 'lifecycle', 'create'))
                headerButton('New Event', () async {
                  final ev = await showNewEventForm(context);
                  if (ev != null && context.mounted) {
                    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => LifecycleDetailScreen(eventId: asInt(ev['id']) ?? 0)));
                    _refresh();
                  }
                }),
            ]),
        TileGrid([
          for (final x in lcTypes)
            StatTile(
              label: x.$2,
              value: _counts == null ? '—' : numTxt(byType[x.$1]),
              sub: 'open',
              color: hexColor(lcTypeHex[x.$1]!),
              selected: _type == x.$1,
              onTap: () => setState(() { _type = _type == x.$1 ? '' : x.$1; _status = 'open'; }),
            ),
        ]),
        if (_tasks.isNotEmpty) ...[
          BlockTitle('Your onboarding / offboarding tasks (${_tasks.length} pending)'),
          for (final t in _tasks) checklistTaskCard(context, t, _refresh),
        ],
        ChipRow([for (final s in statusOpts) CountChip(s.$2, null, selected: _status == s.$1, onTap: () => setState(() => _status = s.$1))]),
      ]),
      itemBuilder: (ctx, e, reload) {
        final total = toNum(e['items_total']).toInt();
        final done = total - toNum(e['items_pending']).toInt();
        return RecordCard(
          code: str(e['event_no']),
          title: str(e['subject_name']).isEmpty ? '—' : str(e['subject_name']),
          subtitle: joinNonEmpty([e['employee_code'], e['subject_email'], if (e['event_type'] == 'joining' && e['user_id'] == null) 'not linked yet']),
          trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            statusPill(e['event_type'], lcTypeLabels, lcTypeHex),
            const SizedBox(height: 4),
            statusPill(e['status'], lcStatusLabels, lcStatusHex),
          ]),
          meta: [
            ('Effective', fmtDate(e['event_type'] == 'exit' ? (e['last_working_day'] ?? e['effective_date']) : e['effective_date'])),
            ('Checklist', total > 0 ? '$done / $total done' : 'No items'),
            ('Raised', '${fmtDate(e['created_at'])} ${str(e['created_by_name'])}'),
          ],
          onTap: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => LifecycleDetailScreen(eventId: asInt(e['id']) ?? 0)));
            reload();
          },
        );
      },
    );
  }
}