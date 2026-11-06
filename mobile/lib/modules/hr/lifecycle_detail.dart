import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'employees.dart';
import 'hr_common.dart';
import 'lifecycle.dart';
import 'lifecycle_complete.dart';

// Portal: app/dashboard/hr/lifecycle/[id]/page.tsx + ChecklistPanel / ScheduledEventPanel

const _itemStatusLabels = {'pending': 'Pending', 'done': 'Done', 'not_applicable': 'Not applicable'};
const _itemStatusHex = {'pending': '#F59E0B', 'done': '#16A34A', 'not_applicable': '#78716C'};

/// One lifecycle event: details, checklist, completion.
class LifecycleDetailScreen extends StatefulWidget {
  const LifecycleDetailScreen({super.key, required this.eventId});
  final int eventId;

  @override
  State<LifecycleDetailScreen> createState() => _LifecycleDetailScreenState();
}

class _LifecycleDetailScreenState extends State<LifecycleDetailScreen> {
  Json? _e;
  Json? _meta;
  Object? _error;
  bool _busy = false;
  late final bool _isHr = hrStaffFor('lifecycle');
  bool get _canEdit => _isHr && Perm.can('hr', 'lifecycle', 'edit');
  bool get _canComplete => _isHr && Perm.can('hr', 'lifecycle', 'approve');

  @override
  void initState() {
    super.initState();
    _load();
    if (_isHr) {
      lifecycleMeta().then((m) {
        if (mounted) setState(() => _meta = m);
      }, onError: (_) {});
    }
  }

  Future<void> _load() async {
    try {
      final e = mapOf(await Api.get('/hr/lifecycle/events/${widget.eventId}'));
      if (mounted) setState(() { _e = e; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _call(Future<dynamic> Function() f) async {
    setState(() => _busy = true);
    try {
      final r = await f();
      if (r is Map && r['event_no'] != null) {
        if (mounted) setState(() => _e = mapOf(r));
      } else {
        await _load();
      }
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit() async {
    final e = _e!;
    final meta = _meta;
    if (meta == null) return;
    final f = EventForm(e);
    final type = str(e['event_type']);
    Json? res;
    final ok = await showFormSheet(context,
        title: 'Edit ${labelOf(lcTypeLabels, type)} event',
        saveLabel: 'Save changes',
        builder: (ctx, setS) => [
              const HintText('Changes apply to the event; the checklist already raised is kept.'),
              if (type == 'joining' && e['user_id'] == null) ...[
                AppTextField(label: 'Full name', controller: f.candidateName),
                AppTextField(label: 'Work email', controller: f.candidateEmail),
              ],
              ...f.fields(type, meta, setS, subject: asInt(e['user_id'])),
            ],
        onSave: () async {
          if (type == 'exit' && f.lwd == null) throw 'Enter the last working day.';
          res = mapOf(await Api.patch('/hr/lifecycle/events/${e['id']}', data: f.payload(type)));
        });
    if (ok && res != null && mounted) setState(() => _e = res);
  }

  Future<void> _cancel() async {
    final e = _e!;
    final reason = await promptDialog(context,
        title: 'Cancel ${e['event_no']}?',
        message: 'The event and its checklist are kept, marked cancelled. An exit that is withdrawn puts the employee back to active.',
        confirmLabel: 'Cancel event');
    if (reason == null || !mounted) return;
    await _call(() => Api.post('/hr/lifecycle/events/${e['id']}/cancel', data: {'reason': reason.trim()}));
  }

  Future<void> _applyNow() async {
    final e = _e!;
    final reason = await promptDialog(context,
        title: 'Apply ${e['event_no']} now?',
        message: 'The change takes effect today instead of ${fmtDate(e['effective_date'])}. Say why — it is kept in the audit trail.',
        confirmLabel: 'Apply now');
    if (reason == null || !mounted) return;
    await _call(() => Api.post('/hr/lifecycle/events/${e['id']}/apply-now', data: {'reason': reason.trim()}));
  }

  Future<void> _item(Json it, Map<String, dynamic> payload) => _call(() => Api.patch('/hr/lifecycle/items/${it['id']}', data: payload));

  Future<void> _itemMenu(Json it, bool open, bool hrEdit) async {
    final editable = it['can_edit'] == true && open;
    final acts = <Widget>[
      if (editable && it['status'] == 'pending') ...[
        LinkAction('✓ Done', () { Navigator.pop(context); _item(it, {'status': 'done'}); }, color: Brand.success),
        LinkAction('N/A', () async {
          Navigator.pop(context);
          final r = await promptDialog(context,
              title: 'Mark as not applicable', message: "Why doesn't “${it['title']}” apply here? The reason is kept on the checklist.", confirmLabel: 'Mark N/A');
          if (r != null) _item(it, {'status': 'not_applicable', 'remarks': r.trim()});
        }),
      ],
      if (editable && it['status'] != 'pending') LinkAction('Reopen', () { Navigator.pop(context); _item(it, {'status': 'pending'}); }),
      if (editable)
        LinkAction('Remark', () async {
          Navigator.pop(context);
          final r = await promptDialog(context,
              title: 'Add a remark', message: 'Replaces the current remark on “${it['title']}”.', label: 'Remark', required: false, confirmLabel: 'Save remark');
          if (r != null) _item(it, {'remarks': textOrNull(r)});
        }),
      if (hrEdit && open && _meta != null)
        LinkAction('Change owner', () async {
          Navigator.pop(context);
          int? owner = asInt(it['owner_user_id']);
          await showFormSheet(context,
              title: 'Owner of “${it['title']}”',
              saveLabel: 'Save',
              builder: (ctx, setS) => [
                    AppSelect<int>(label: 'Owner', value: owner, valueLabel: str(it['owner_name']), options: lcUserOpts(_meta!),
                        onChanged: (o) => setS(() => owner = o?.value)),
                  ],
              onSave: () async {
                await Api.patch('/hr/lifecycle/items/${it['id']}', data: {'owner_user_id': owner});
              });
          _load();
        }),
      if (hrEdit && open)
        LinkAction('Remove', () async {
          Navigator.pop(context);
          final yes = await confirmDialog(context, title: 'Remove checklist item?', message: '“${it['title']}” is removed from this event.', confirmLabel: 'Remove', danger: true);
          if (yes) _call(() => Api.delete('/hr/lifecycle/items/${it['id']}'));
        }, color: Brand.danger),
    ];
    if (acts.isEmpty) return;
    await showModalBottomSheet<void>(context: context, builder: (_) => SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: actionRow(acts))));
  }

  Future<void> _addItem() async {
    final e = _e!;
    var category = 'hr';
    final title = TextEditingController();
    int? owner;
    final cats = rowsOf(_meta?['categories']);
    await showFormSheet(context,
        title: 'Add a checklist item',
        saveLabel: 'Add item',
        builder: (ctx, setS) => [
              HintText('Added to ${e['event_no']} only — the template in HR > Masters is not changed.'),
              AppSelect<String>(
                  label: 'Category', value: category, clearable: false,
                  options: cats.isEmpty ? optionsOf(checklistCategoryLabels) : [for (final c in cats) Option(str(c['value']), str(c['label']))],
                  onChanged: (o) => setS(() => category = o?.value ?? category)),
              AppTextField(label: 'What needs doing', controller: title, required: true, hint: 'e.g. Hand over site keys'),
              if (_meta != null) AppSelect<int>(label: 'Owner', value: owner, options: lcUserOpts(_meta!), onChanged: (o) => setS(() => owner = o?.value)),
            ],
        onSave: () async {
          if (title.text.trim().isEmpty) throw 'Enter what needs to be done for the new checklist item.';
          await Api.post('/hr/lifecycle/events/${e['id']}/items', data: {'category': category, 'title': title.text.trim(), 'owner_user_id': owner});
        });
    _load();
  }

  Widget _checklist(Json e) {
    final open = e['status'] == 'draft' || e['status'] == 'in_progress';
    final hrEdit = _canEdit && Perm.canFeature('hr', 'lifecycle', 'checklist', 'edit');
    final items = rowsOf(e['items']);
    final done = items.where((i) => i['status'] != 'pending').length;
    const order = ['hr', 'manager', 'it', 'admin', 'store', 'finance'];
    int rank(String c) => order.contains(c) ? order.indexOf(c) : 99;
    final cats = items.map((i) => str(i['category'])).toSet().toList()..sort((a, b) => rank(a).compareTo(rank(b)));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      BlockTitle('Checklist · $done/${items.length} done', trailing: hrEdit && open ? LinkAction('+ Add item', _addItem) : null),
      if (items.isEmpty) padded(const HintText('No checklist items.')),
      for (final c in cats) ...[
        padded(Caps(
            '${labelOf(checklistCategoryLabels, c)} · ${items.where((i) => i['category'] == c && i['status'] != 'pending').length}/${items.where((i) => i['category'] == c).length}')),
        for (final it in items.where((i) => i['category'] == c))
          RecordCard(
            title: str(it['title']),
            subtitle: [
              'Owner: ${str(it['owner_name']).isEmpty ? 'unassigned' : it['owner_name']}',
              if (it['status'] != 'pending' && str(it['done_by_name']).isNotEmpty)
                '${labelOf(_itemStatusLabels, it['status'])} by ${it['done_by_name']} ${fmtDateTime(it['done_at'])}',
              if (str(it['remarks']).isNotEmpty) '“${it['remarks']}”',
            ].join('\n'),
            trailing: statusPill(it['status'], _itemStatusLabels, _itemStatusHex),
            onTap: _busy ? null : () => _itemMenu(it, open, hrEdit),
          ),
      ],
    ]);
  }

  Future<void> _link(bool byEmail) async {
    final e = _e!;
    int? uid;
    if (!byEmail) {
      final meta = _meta ?? await lifecycleMeta();
      if (!mounted) return;
      final ok = await showFormSheet(context,
          title: 'Link the portal user',
          saveLabel: 'Link',
          builder: (ctx, setS) => [
                AppSelect<int>(label: 'Portal user', required: true, value: uid, options: lcUserOpts(meta), onChanged: (o) => setS(() => uid = o?.value)),
              ],
          onSave: () async {
            if (uid == null) throw 'Pick the portal user.';
          });
      if (!ok || uid == null) return;
    }
    await _call(() => Api.post('/hr/lifecycle/events/${e['id']}/link-user', data: byEmail ? {} : {'user_id': uid}));
  }

  List<Widget> _summary(Json summary) {
    List l(String k) => summary[k] is List ? summary[k] as List : const [];
    return [
      for (final c in l('changes')) Text('✓ $c'),
      if (l('changes').isEmpty) const Text('No changes were needed.'),
      for (final c in l('conflicts')) Text('✕ $c', style: const TextStyle(color: Brand.danger)),
      if (l('outstanding_assets').isNotEmpty)
        Text('Assets still with the employee: ${l('outstanding_assets').join(', ')}', style: const TextStyle(color: Brand.danger)),
      if (l('pending_checklist_items').isNotEmpty)
        Text('Checklist items left open: ${l('pending_checklist_items').join('; ')}', style: const TextStyle(color: Color(0xFFB45309))),
      if (summary['forced'] == true) Text('Completed with open items — reason: ${summary['force_reason']}', style: const TextStyle(color: Color(0xFFB45309))),
      for (final w in l('warnings')) Text('⚠ $w', style: const TextStyle(color: Color(0xFF92400E))),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final e = _e;
    if (e == null) return SubPage(title: 'Lifecycle event', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    final t = str(e['event_type']);
    final open = e['status'] == 'draft' || e['status'] == 'in_progress';
    final summary = mapOf(e['completion_summary']);
    FieldRow move(String label, Object? from, Object? to) => FieldRow(label, str(to).isEmpty ? from : '${str(from).isEmpty ? '—' : from} → $to');
    final completeTitle = t == 'exit' ? 'Complete exit' : t == 'joining' ? 'Complete joining' : t == 'confirmation' ? 'Confirm employee' : 'Apply $t';
    return SubPage(
      title: str(e['event_no']),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 40), children: [
          DetailSection(str(e['subject_name']).isEmpty ? '—' : str(e['subject_name']),
              action: Wrap(spacing: 4, children: [statusPill(t, lcTypeLabels, lcTypeHex), statusPill(e['status'], lcStatusLabels, lcStatusHex)]),
              children: [
                HintText(joinNonEmpty([e['employee_code'], e['subject_email']])),
                if (_isHr && e['user_id'] != null)
                  Align(
                      alignment: Alignment.centerLeft,
                      child: LinkAction('Employee record', () => openScreen(context, EmployeeDetailScreen(userId: asInt(e['user_id']) ?? 0)))),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  if (_canEdit && e['status'] == 'draft')
                    headerButton('Start checklist', _busy ? null : () => _call(() => Api.patch('/hr/lifecycle/events/${e['id']}', data: {'status': 'in_progress'})),
                        icon: Icons.play_arrow_rounded),
                  if (_canEdit && open && _meta != null) headerButton('Edit details', _edit, primary: false),
                  if (_canEdit && (open || e['status'] == 'scheduled')) headerButton('Cancel event', _cancel, primary: false),
                ]),
              ]),
          if (e['status'] == 'cancelled' && str(e['cancelled_reason']).isNotEmpty) DetailSection('Cancelled', children: [Text(str(e['cancelled_reason']))]),
          if (e['status'] == 'completed')
            DetailSection('Completed', children: [
              HintText('${str(e['completed_by_name']).isEmpty ? '' : 'by ${e['completed_by_name']} '}${str(e['completed_at']).isEmpty ? '' : 'on ${fmtDate(e['completed_at'])}'}'),
              if (summary.isEmpty) const HintText('Completion details are visible to HR.') else ..._summary(summary),
            ]),
          if (t == 'exit')
            DetailSection('Exit', children: [
              FieldRow('Exit type', str(e['exit_type']).isEmpty ? null : labelOf(exitTypeLabels, e['exit_type'])),
              if (e['is_hr_view'] == true) FieldRow('Resignation date', str(e['resignation_date']).isEmpty ? null : fmtDate(e['resignation_date'])),
              FieldRow('Last working day', fmtDate(e['last_working_day'] ?? e['effective_date'])),
              if (e['is_hr_view'] == true) FieldRow('Notice period', e['notice_period_days'] == null ? null : '${e['notice_period_days']} days'),
              FieldRow('Handover to', e['handover_to_name']),
              if (e['is_hr_view'] == true && str(e['exit_reason']).isNotEmpty) FieldRow('Exit reason', e['exit_reason']),
              FieldRow('Department', e['from_department_name']),
              FieldRow('Designation', e['from_designation_name']),
              FieldRow('Reporting manager', e['from_manager_name']),
            ])
          else
            DetailSection(t == 'joining' ? 'Joining' : t == 'confirmation' ? 'Confirmation' : 'What changes', children: [
              FieldRow(t == 'joining' ? 'Date of joining' : t == 'confirmation' ? 'Confirmation date' : 'Effective from', fmtDate(e['effective_date'])),
              if (t != 'confirmation') ...[
                move('Department', e['from_department_name'], e['to_department_name']),
                move('Plant', e['from_branch_name'], e['to_branch_name']),
                move('Designation', e['from_designation_name'], e['to_designation_name']),
                move('Grade', e['from_grade_name'], e['to_grade_name']),
                move('Reporting manager', e['from_manager_name'], e['to_manager_name']),
              ],
              if (t == 'transfer' || t == 'promotion') FieldRow('Successor', e['handover_to_name']),
            ]),
          DetailSection('Record', children: [
            FieldRow('Raised by', '${str(e['created_by_name'])} · ${fmtDate(e['created_at'])}'),
            if (e['is_hr_view'] == true && str(e['remarks']).isNotEmpty) FieldRow('Remarks', e['remarks']),
          ]),
          _checklist(e),
          if (e['status'] == 'scheduled')
            DetailSection('Scheduled for ${fmtDate(e['effective_date'])}', children: [
              HintText(
                  'HR completed this event before its effective date, so nothing has changed yet. It is applied automatically early on ${fmtDate(e['effective_date'])} with the options chosen at completion, and the assignment history gets a new period from that date.'),
              if (_canComplete) Align(alignment: Alignment.centerLeft, child: headerButton('Apply now', _applyNow, primary: false)),
            ]),
          if (_canComplete && e['status'] == 'in_progress')
            DetailSection(completeTitle, children: [
              if (t == 'joining' && e['user_id'] == null) ...[
                const Text('Step 1 — link the portal user', style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF92400E))),
                HintText(
                    "The joiner's portal account appears after their first Microsoft sign-in (or an admin Azure sync).${str(e['candidate_email']).isEmpty ? ' Pick the user below.' : ' Search by ${e['candidate_email']}, or pick the user.'}"),
                Wrap(spacing: 8, children: [
                  if (str(e['candidate_email']).isNotEmpty) headerButton('Find by email', _busy ? null : () => _link(true), primary: false),
                  headerButton('Pick user & link', _busy ? null : () => _link(false), primary: false),
                ]),
                const SizedBox(height: 8),
              ],
              Align(
                alignment: Alignment.centerLeft,
                child: headerButton(
                  t == 'exit' ? 'Complete exit' : 'Review & complete',
                  _busy || (t == 'joining' && e['user_id'] == null)
                      ? null
                      : () async {
                          final r = await showCompletionForm(context, e, _meta);
                          if (r != null && mounted) setState(() => _e = r);
                        },
                  icon: Icons.check_rounded,
                ),
              ),
            ]),
          if (_isHr && e['status'] == 'draft')
            padded(const HintText("This event is a draft — checklist owners haven't been notified yet. Use Start checklist when it's ready.")),
        ]),
      ),
    );
  }
}