import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';
import 'leave.dart';
import 'lifecycle.dart';
import 'lifecycle_detail.dart';

// Portal: components/hr/employee/Employee{Assignment,Lifecycle,Leave,Attendance,Assets}Tab.tsx

const _sourceLabels = {
  'backfill': 'On record', 'profile_edit': 'Profile edit', 'joining': 'Joining', 'transfer': 'Transfer', 'promotion': 'Promotion', 'manual': 'Dated change',
};

/// Assignment history (org assignment over time) + change from a date.
class AssignmentHistory extends StatefulWidget {
  const AssignmentHistory({super.key, required this.userId});
  final int userId;

  @override
  State<AssignmentHistory> createState() => _AssignmentHistoryState();
}

class _AssignmentHistoryState extends State<AssignmentHistory> {
  List<Json>? _items;
  Object? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/hr/org-assignments/${widget.userId}');
      if (mounted) setState(() { _items = rowsOf(mapOf(d)['items']); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _change() async {
    List<Option<int>> depts = [], plants = [], people = [], desigs = [], grades = [], ccs = [];
    try {
      final lk = mapOf(await Api.get('/hr/attendance/lookups'));
      depts = [for (final d in rowsOf(lk['departments'])) Option(asInt(d['id']) ?? 0, str(d['name']))];
      plants = [for (final b in rowsOf(lk['branches'])) Option(asInt(b['id']) ?? 0, str(b['name']))];
      people = [for (final e in rowsOf(lk['employees'])) if (asInt(e['user_id']) != widget.userId) Option(asInt(e['user_id']) ?? 0, str(e['user_name']))];
      desigs = [for (final d in (await Api.list('/hr/masters/designations')).rows) if (d['is_active'] != false) Option(asInt(d['id']) ?? 0, str(d['name']))];
      grades = [for (final g in (await Api.list('/hr/masters/grades')).rows) if (g['is_active'] != false) Option(asInt(g['id']) ?? 0, '${g['code']} — ${g['name']}')];
      ccs = [
        for (final c in (await Api.list('/organization/cost-centers')).rows)
          if ((str(c['status']).isEmpty ? 'active' : str(c['status'])) == 'active') Option(asInt(c['id']) ?? 0, '${c['code']} — ${c['name']}'),
      ];
    } catch (e) {
      if (mounted) showSnack(context, "Couldn't load the lists for the change form: ${ApiClient.describe(e)}", error: true);
      return;
    }
    if (!mounted) return;
    DateTime? from = DateTime.now();
    int? dept, desig, grade, plant, cc, manager;
    final reason = TextEditingController();
    String? msg;
    final ok = await showFormSheet(context,
        title: 'Change org assignment from a date',
        saveLabel: 'Save change',
        builder: (ctx, setS) => [
              const HintText('Closes the current period the day before; a future date applies automatically on that day. Blank = keep as is.'),
              DateField(label: 'Effective from', required: true, value: from, onChanged: (d) => setS(() => from = d)),
              AppSelect<int>(label: 'Department', value: dept, options: depts, onChanged: (o) => setS(() => dept = o?.value)),
              AppSelect<int>(label: 'Designation', value: desig, options: desigs, onChanged: (o) => setS(() => desig = o?.value)),
              AppSelect<int>(label: 'Grade', value: grade, options: grades, onChanged: (o) => setS(() => grade = o?.value)),
              AppSelect<int>(label: 'Plant', value: plant, options: plants, onChanged: (o) => setS(() => plant = o?.value)),
              AppSelect<int>(label: 'Cost center', value: cc, options: ccs, onChanged: (o) => setS(() => cc = o?.value)),
              AppSelect<int>(label: 'Reporting manager', value: manager, options: people, onChanged: (o) => setS(() => manager = o?.value)),
              AppTextField(label: 'Reason', controller: reason, maxLines: 3, hint: 'e.g. Shifted to Plant 2 machining cell'),
              const HintText('For a transfer or promotion with checklists and approval hand-over, raise it in HR › Lifecycle instead — it also writes this history.'),
            ],
        onSave: () async {
          if (from == null) throw 'Pick the date the change applies from.';
          final res = mapOf(await Api.post('/hr/org-assignments/${widget.userId}', data: {
            'valid_from': apiDate(from!), 'reason': reason.text.trim(),
            'department_id': ?dept, 'designation_id': ?desig, 'grade_id': ?grade,
            'branch_id': ?plant, 'cost_center_id': ?cc, 'reporting_manager_id': ?manager,
          }));
          msg = res['scheduled'] == true ? 'Change saved — it applies automatically on ${fmtDate(from)}.' : 'Change applied.';
        });
    if (ok && mounted) {
      setState(() => _notice = msg);
      _load();
    }
  }

  Future<void> _withdraw(Json s) async {
    final yes = await confirmDialog(context, title: 'Withdraw this future change?', message: 'The scheduled change from ${fmtDate(s['valid_from'])} is removed.', confirmLabel: 'Withdraw');
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.delete('/hr/org-assignments/slices/${s['id']}'), success: 'Future change withdrawn.');
    if (ok) _load();
  }

  @override
  Widget build(BuildContext context) {
    final canChange = Perm.canFeature('hr', 'employees', 'assignment', 'create');
    final canWithdraw = Perm.canFeature('hr', 'employees', 'assignment', 'cancel');
    final items = _items;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      BlockTitle('Assignment history', trailing: canChange ? LinkAction('Change from a date', _change) : null),
      if (_notice != null) padded(NoticeBanner(_notice!)),
      if (_error != null) padded(ErrorBanner(ApiClient.describe(_error!))),
      if (items == null && _error == null) const LoadingView(),
      if (items != null && items.isEmpty) padded(const HintText('No assignment history yet — it starts with the next change (use Change from a date).')),
      for (final s in items ?? const <Json>[])
        RecordCard(
          title: '${fmtDate(s['valid_from'])} → ${str(s['valid_to']).isEmpty ? 'Ongoing' : fmtDate(s['valid_to'])}',
          subtitle: '${labelOf(_sourceLabels, s['source'])}${str(s['created_by_name']).isEmpty ? '' : ' · ${s['created_by_name']}'}${str(s['reason']).isEmpty ? '' : '\n${s['reason']}'}',
          trailing: s['current'] == true ? const HrPill('Current', '#16A34A') : s['pending'] == true ? const HrPill('Scheduled', '#F59E0B') : null,
          meta: [
            ('Department', str(s['department_name']).isEmpty ? '—' : str(s['department_name'])),
            ('Designation', str(s['designation_name']).isEmpty ? '—' : str(s['designation_name'])),
            ('Grade', str(s['grade_code']).isEmpty ? '—' : str(s['grade_code'])),
            ('Plant', str(s['branch_name']).isEmpty ? '—' : str(s['branch_name'])),
            ('Cost center', str(s['cost_center_name']).isEmpty ? '—' : str(s['cost_center_name'])),
            ('Manager', str(s['reporting_manager_name']).isEmpty ? '—' : str(s['reporting_manager_name'])),
          ],
          onTap: s['pending'] == true && canWithdraw ? () => _withdraw(s) : null,
        ),
    ]);
  }
}

/// Lifecycle events of one employee + raise a new one.
class EmployeeLifecycleTab extends StatelessWidget {
  const EmployeeLifecycleTab({super.key, required this.userId, required this.userName});
  final int userId;
  final String userName;

  @override
  Widget build(BuildContext context) => ApiLoader<List<Json>>(
        load: () async => (await Api.list('/hr/lifecycle/users/$userId/events')).rows,
        builder: (ctx, events, reload) {
          final exited = events.any((e) => e['event_type'] == 'exit' && e['status'] == 'completed');
          final types = exited
              ? const [('joining', 'Rehire (joining)')]
              : const [('transfer', 'Transfer'), ('promotion', 'Promotion'), ('confirmation', 'Confirmation'), ('exit', 'Exit')];
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const BlockTitle('Lifecycle'),
            if (Perm.can('hr', 'lifecycle', 'create'))
              padded(Wrap(spacing: 4, children: [
                for (final t in types)
                  LinkAction('+ ${t.$2}', () async {
                    final ev = await showNewEventForm(context, type: t.$1, userId: userId, userName: userName);
                    if (ev != null && context.mounted) {
                      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => LifecycleDetailScreen(eventId: asInt(ev['id']) ?? 0)));
                      reload();
                    }
                  }, color: hexColor(lcTypeHex[t.$1]!)),
              ])),
            if (events.isEmpty) padded(const HintText('No lifecycle events yet for this employee.')),
            for (final e in events)
              RecordCard(
                code: str(e['event_no']),
                title: labelOf(lcTypeLabels, e['event_type']),
                subtitle: e['status'] == 'completed' && str(e['completed_at']).isNotEmpty
                    ? 'completed ${fmtDate(e['completed_at'])}'
                    : 'effective ${fmtDate(e['effective_date'])}',
                trailing: statusPill(e['status'], lcStatusLabels, lcStatusHex),
                meta: [
                  if ((e['status'] == 'draft' || e['status'] == 'in_progress') && toNum(e['items_total']) > 0)
                    ('Checklist', '${toNum(e['items_total']) - toNum(e['items_pending'])} / ${numTxt(e['items_total'])} closed'),
                ],
                onTap: () async {
                  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => LifecycleDetailScreen(eventId: asInt(e['id']) ?? 0)));
                  reload();
                },
              ),
          ]);
        },
      );
}

/// Leave balances + requests of one employee for a year.
class EmployeeLeaveTab extends StatefulWidget {
  const EmployeeLeaveTab({super.key, required this.userId});
  final int userId;

  @override
  State<EmployeeLeaveTab> createState() => _EmployeeLeaveTabState();
}

class _EmployeeLeaveTabState extends State<EmployeeLeaveTab> {
  int _year = DateTime.now().year;

  @override
  Widget build(BuildContext context) => ApiLoader<(List<Json>, List<Json>)>(
        key: ValueKey(_year),
        load: () async {
          final b = (await Api.list('/hr/leave/balances', query: {'year': _year, 'user_id': widget.userId})).rows;
          final r = (await Api.list('/hr/leave/requests', query: {'user_id': widget.userId, 'date_from': '$_year-01-01', 'date_to': '$_year-12-31'})).rows;
          return (b, r);
        },
        builder: (ctx, d, reload) {
          final (bal, reqs) = d;
          return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            BlockTitle('Leave',
                trailing: SizedBox(
                    width: 120,
                    child: AppSelect<int>(label: 'Year', value: _year, options: yearOptions(), clearable: false, onChanged: (o) => setState(() => _year = o?.value ?? _year)))),
            if (bal.isEmpty) padded(HintText('No leave balances for $_year.')),
            if (bal.isNotEmpty)
              TileGrid([
                for (final b in bal)
                  StatTile(
                    label: '${b['leave_type_name']} · ${b['leave_type_code']}',
                    value: b['is_paid'] == false ? '—' : numTxt(b['available']),
                    sub: '${numTxt(b['used'])} used · ${numTxt(b['pending'])} pending · ${numTxt(b['allotted'])} allotted',
                  ),
              ]),
            if (reqs.isEmpty) padded(HintText('No leave requests in $_year.')),
            for (final r in reqs)
              RecordCard(
                code: str(r['request_no']),
                title: str(r['leave_type_name']),
                trailing: statusPill(r['status'], requestStatusLabels, requestStatusHex),
                meta: [('Dates', leaveDates(r)), ('Days', numTxt(r['days'])), ('Decided by', str(r['decided_by_name']).isEmpty ? '—' : str(r['decided_by_name']))],
              ),
          ]);
        },
      );
}

/// Month calendar of one employee.
class EmployeeAttendanceTab extends StatefulWidget {
  const EmployeeAttendanceTab({super.key, required this.userId});
  final int userId;

  @override
  State<EmployeeAttendanceTab> createState() => _EmployeeAttendanceTabState();
}

class _EmployeeAttendanceTabState extends State<EmployeeAttendanceTab> {
  int _y = DateTime.now().year;
  int _m = DateTime.now().month;

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        key: ValueKey('$_y-$_m'),
        load: () async => mapOf(await Api.get('/hr/attendance/month', query: {'user_id': widget.userId, 'year': _y, 'month': _m})),
        builder: (ctx, d, reload) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const BlockTitle('Attendance'),
          Center(child: MonthBar(year: _y, month: _m, onChanged: (y, m) => setState(() { _y = y; _m = m; }))),
          padded(AttendanceLegend(counts: mapOf(d['counts']))),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: AttendanceCalendar(year: _y, month: _m, days: rowsOf(d['days']))),
        ]),
      );
}

/// Asset issue history of one employee.
class EmployeeAssetsTab extends StatelessWidget {
  const EmployeeAssetsTab({super.key, required this.userId});
  final int userId;

  @override
  Widget build(BuildContext context) => ApiLoader<List<Json>>(
        load: () async => (await Api.list('/hr/assets/by-user/$userId')).rows,
        builder: (ctx, rows, reload) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const BlockTitle('Assets'),
          if (rows.isEmpty) padded(const HintText('No assets have ever been issued to this employee.')),
          for (final r in rows)
            RecordCard(
              code: str(r['asset_code']),
              title: str(r['asset_name']),
              trailing: str(r['returned_on']).isEmpty ? const HrPill('With employee', '#2563EB') : null,
              meta: [
                ('Category', str(r['asset_category']).isEmpty ? '—' : labelOf(assetCategoryLabels, r['asset_category'])),
                ('Serial', str(r['serial_number']).isEmpty ? '—' : str(r['serial_number'])),
                ('Issued', fmtDate(r['issued_on'])),
                ('Returned', str(r['returned_on']).isEmpty ? '—' : fmtDate(r['returned_on'])),
                ('Condition (out → in)',
                    '${str(r['condition_on_issue']).isEmpty ? '—' : labelOf(assetConditionLabels, r['condition_on_issue'])} → ${str(r['condition_on_return']).isEmpty ? '—' : labelOf(assetConditionLabels, r['condition_on_return'])}'),
              ],
            ),
        ]),
      );
}
