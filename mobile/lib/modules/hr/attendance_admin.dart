import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/attendance/page.tsx (Daily register, Employee
// month, Monthly summary, Import, Corrections). Shift roster, biometric
// punches, payroll periods and time evaluation open in the portal.

const _sourceLabels = {'manual': 'HR', 'self': 'Self', 'regularization': 'Correction', 'leave': 'Leave', 'import': 'Import'};
const _markable = ['present', 'absent', 'half_day', 'on_duty', 'work_from_home', 'holiday', 'weekly_off'];

class HrAttendancePage extends StatefulWidget {
  const HrAttendancePage({super.key});

  @override
  State<HrAttendancePage> createState() => _HrAttendancePageState();
}

class _HrAttendancePageState extends State<HrAttendancePage> {
  int _tab = 0;
  int _rev = 0;
  Json? _lookups;
  int? _branch, _dept;
  DateTime _date = DateTime.now();
  String _statusF = '';
  final _selected = <int>{};
  int? _monthUser;
  String? _monthUserName;
  int _y = DateTime.now().year, _m = DateTime.now().month;
  String _regStatus = 'pending';
  String? _notice;
  MultipartFile? _importFile;
  Json? _importResult;

  bool get _canMark => Perm.can('hr', 'attendance', 'edit');

  List<(String, String)> get _tabs => [
        ('register', 'Daily register'),
        ('month', 'Employee month'),
        ('summary', 'Monthly summary'),
        if (Perm.can('hr', 'attendance', 'import')) ('import', 'Import'),
        ('corrections', 'Corrections'),
        if (Perm.canFeature('hr', 'attendance', 'roster', 'view')) ('roster', 'Shift roster'),
        if (Perm.canFeature('hr', 'attendance', 'punches', 'import')) ('punches', 'Biometric punches'),
        if (Perm.canFeature('hr', 'attendance', 'periods', 'view')) ('periods', 'Payroll periods'),
      ];

  @override
  void initState() {
    super.initState();
    Api.get('/hr/attendance/lookups').then((l) {
      if (mounted) setState(() => _lookups = mapOf(l));
    }, onError: (Object e) {
      if (mounted) showSnack(context, 'Could not load plants and employees: ${ApiClient.describe(e)}', error: true);
    });
  }

  void _refresh([String? msg]) => setState(() { _rev++; if (msg != null) _notice = msg; });

  List<Option<int>> get _employeeOpts => [
        for (final e in rowsOf(_lookups?['employees']))
          Option(asInt(e['user_id']) ?? 0, '${e['user_name']}${str(e['employee_code']).isEmpty ? '' : ' (${e['employee_code']})'}',
              subtitle: str(e['department_name']).isEmpty ? str(e['user_email']) : str(e['department_name'])),
      ];

  Widget _filters() => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Row(children: [
          Expanded(
            child: AppSelect<int>(
                label: 'All plants', value: _branch,
                options: [for (final b in rowsOf(_lookups?['branches'])) Option(asInt(b['id']) ?? 0, str(b['name']))],
                onChanged: (o) => setState(() { _branch = o?.value; _dept = null; })),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: AppSelect<int>(
                label: 'All departments', value: _dept,
                options: [
                  for (final d in rowsOf(_lookups?['departments']))
                    if (_branch == null || d['branch_id'] == null || d['branch_id'] == _branch) Option(asInt(d['id']) ?? 0, str(d['name'])),
                ],
                onChanged: (o) => setState(() => _dept = o?.value)),
          ),
        ]),
      );

  Future<void> _edit(int userId, String userName, Json day) async {
    if (!_canMark) return;
    final computed = day['computed'] == true;
    var status = !computed && _markable.contains(day['status']) ? str(day['status']) : 'present';
    String? inT = textOrNull(str(day['check_in_time']));
    String? outT = textOrNull(str(day['check_out_time']));
    final remarks = TextEditingController(text: str(day['remarks']));
    final id = asInt(day['id']);
    final ok = await showFormSheet(context,
        title: '$userName · ${fmtDate(day['date'])}',
        saveLabel: 'Save',
        builder: (ctx, setS) => [
              HintText(id != null ? 'Currently stored (${labelOf(_sourceLabels, day['source'])}).' : 'Nothing stored for this day yet.'),
              AppSelect<String>(label: 'Status', required: true, value: status, clearable: false,
                  options: [for (final s in _markable) Option(s, attLabels[s]!)], onChanged: (o) => setS(() => status = o?.value ?? status)),
              TimeField(label: 'Check-in', value: inT, onChanged: (v) => setS(() => inT = v)),
              TimeField(label: 'Check-out', value: outT, onChanged: (v) => setS(() => outT = v)),
              AppTextField(label: 'Remarks', controller: remarks),
              const HintText('Leave days can only be changed by cancelling the leave request.'),
              if (id != null && Perm.can('hr', 'attendance', 'delete'))
                Align(
                  alignment: Alignment.centerLeft,
                  child: LinkAction('Clear entry', () async {
                    final yes = await confirmDialog(context,
                        title: 'Clear this attendance entry?',
                        message: "$userName's entry for ${fmtDate(day['date'])} will be removed; the day then shows as not marked (or holiday / weekly off from the calendar).",
                        confirmLabel: 'Clear entry',
                        danger: true);
                    if (!yes || !ctx.mounted) return;
                    final done = await runAction(ctx, () => Api.delete('/hr/attendance/entries/$id'));
                    if (done && ctx.mounted) {
                      Navigator.pop(ctx, false);
                      _refresh('$userName: ${fmtDate(day['date'])} cleared.');
                    }
                  }, color: Brand.danger),
                ),
            ],
        onSave: () async {
          await Api.put('/hr/attendance/entries', data: {
            'user_id': userId, 'attendance_date': day['date'], 'status': status,
            'check_in': inT, 'check_out': outT, 'remarks': textOrNull(remarks.text),
          });
        });
    if (ok && mounted) _refresh('$userName: ${fmtDate(day['date'])} marked ${attLabels[status]}.');
  }

  Future<void> _bulk() async {
    var status = 'present';
    final n = _selected.length;
    Json? res;
    final ok = await showFormSheet(context,
        title: 'Mark $n employee(s)',
        saveLabel: 'Apply to $n',
        builder: (ctx, setS) => [
              AppSelect<String>(label: 'Mark as', value: status, clearable: false,
                  options: [for (final s in _markable) Option(s, attLabels[s]!)], onChanged: (o) => setS(() => status = o?.value ?? status)),
              HintText('For ${fmtDate(_date)}.'),
            ],
        onSave: () async {
          res = mapOf(await Api.put('/hr/attendance/register/bulk', data: {'attendance_date': apiDate(_date), 'user_ids': _selected.toList(), 'status': status}));
        });
    if (!ok || res == null || !mounted) return;
    final skipped = rowsOf(res!['skipped']);
    _selected.clear();
    _refresh('${numTxt(toNum(res!['created']) + toNum(res!['updated']))} marked ${attLabels[status]} for ${fmtDate(_date)}.'
        '${skipped.isEmpty ? '' : ' Skipped ${skipped.length}: ${skipped.map((s) => '${s['user_name']} — ${s['reason']}').join('; ')}'}');
  }

  Widget _register() => ApiLoader<Json>(
        key: ValueKey('reg_${_date}_${_branch}_${_dept}_$_rev'),
        load: () async => mapOf(await Api.get('/hr/attendance/register', query: {'date': apiDate(_date), 'branch_id': _branch, 'department_id': _dept})),
        builder: (ctx, reg, reload) {
          final rows = rowsOf(reg['items']).where((r) => _statusF.isEmpty || r['status'] == _statusF).toList();
          final counts = mapOf(reg['counts']);
          final allSel = rows.isNotEmpty && rows.every((r) => _selected.contains(r['user_id']));
          return ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            _head(),
            padded(DateField(label: 'Date', required: true, value: _date, onChanged: (d) { if (d != null) setState(() { _date = d; _selected.clear(); }); })),
            _filters(),
            ChipRow([
              CountChip('${numTxt(reg['total'])} employees', null, selected: _statusF.isEmpty, onTap: () => setState(() => _statusF = '')),
              for (final e in counts.entries)
                if (toNum(e.value) > 0)
                  CountChip(labelOf(attLabels, e.key), numTxt(e.value), selected: _statusF == e.key, color: hexColor(attHex[e.key] ?? '#64748B'),
                      onTap: () => setState(() => _statusF = _statusF == e.key ? '' : e.key)),
            ]),
            if (_selected.isNotEmpty && _canMark)
              padded(Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Text('${_selected.length} selected', style: const TextStyle(fontWeight: FontWeight.w700)),
                headerButton('Mark as…', _bulk, icon: Icons.done_all_rounded),
                headerButton('Clear selection', () => setState(_selected.clear), primary: false),
              ])),
            if (_canMark && rows.isNotEmpty)
              Align(
                alignment: Alignment.centerLeft,
                child: Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: LinkAction(allSel ? 'Unselect all' : 'Select all', () => setState(() {
                        if (allSel) {
                          _selected.clear();
                        } else {
                          _selected.addAll(rows.map((r) => asInt(r['user_id']) ?? 0));
                        }
                      })),
                ),
              ),
            if (rows.isEmpty) const EmptyView('No employees match these filters.'),
            for (final r in rows)
              RecordCard(
                title: str(r['user_name']),
                subtitle: joinNonEmpty([str(r['employee_code']).isEmpty ? r['user_email'] : r['employee_code'], r['department_name'], r['branch_name']]),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  str(r['status']).isEmpty ? const Text('—') : HrPill(labelOf(attLabels, r['status']), attHex[str(r['status'])] ?? '#64748B'),
                  if (_canMark)
                    Checkbox(
                      value: _selected.contains(r['user_id']),
                      onChanged: (v) => setState(() => v == true ? _selected.add(asInt(r['user_id']) ?? 0) : _selected.remove(r['user_id'])),
                    ),
                ]),
                meta: [
                  ('Shift', str(r['shift_name']).isEmpty ? '—' : str(r['shift_name'])),
                  ('In', '${str(r['check_in_time']).isEmpty ? '—' : r['check_in_time']}${toNum(r['late_minutes']) > 0 ? ' (late ${numTxt(r['late_minutes'])}m)' : ''}'),
                  ('Out', str(r['check_out_time']).isEmpty ? '—' : str(r['check_out_time'])),
                  ('Source', str(r['source']).isEmpty ? (r['computed'] == true ? 'Calendar' : '—') : labelOf(_sourceLabels, r['source'])),
                  if (str(r['holiday_name']).isNotEmpty) ('Holiday', str(r['holiday_name'])),
                ],
                onTap: _canMark && r['source'] != 'leave' ? () => _edit(asInt(r['user_id']) ?? 0, str(r['user_name']), r) : null,
              ),
          ]);
        },
      );

  Widget _month() => ListView(padding: const EdgeInsets.only(bottom: 88), children: [
        _head(),
        padded(AppSelect<int>(label: 'Pick an employee…', value: _monthUser, valueLabel: _monthUserName,
            loadOptions: (q) async => filterOptions(_employeeOpts, q),
            onChanged: (o) => setState(() { _monthUser = o?.value; _monthUserName = o?.label; }))),
        Center(child: MonthBar(year: _y, month: _m, onChanged: (y, m) => setState(() { _y = y; _m = m; }))),
        if (_monthUser == null)
          padded(const HintText('Pick an employee to see their month. Tap any day to mark or correct it.'))
        else
          ApiLoader<Json>(
            key: ValueKey('m_${_monthUser}_${_y}_${_m}_$_rev'),
            load: () async => mapOf(await Api.get('/hr/attendance/month', query: {'user_id': _monthUser, 'year': _y, 'month': _m})),
            builder: (ctx, d, reload) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              padded(Text(
                  '${d['user_name']}${str(d['employee_code']).isEmpty ? '' : ' (${d['employee_code']})'} · ${str(d['department_name']).isEmpty ? '—' : d['department_name']} · ${str(d['shift_name']).isEmpty ? 'no shift' : d['shift_name']}',
                  style: const TextStyle(fontWeight: FontWeight.w700))),
              padded(AttendanceLegend(counts: mapOf(d['counts']))),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: AttendanceCalendar(
                  year: _y, month: _m, days: rowsOf(d['days']),
                  onDayTap: (day) { if (_canMark && day['source'] != 'leave') _edit(asInt(d['user_id']) ?? 0, str(d['user_name']), day); },
                ),
              ),
            ]),
          ),
      ]);

  Widget _summary() => ApiLoader<Json>(
        key: ValueKey('s_${_y}_${_m}_${_branch}_${_dept}_$_rev'),
        load: () async => mapOf(await Api.get('/hr/attendance/summary', query: {'year': _y, 'month': _m, 'branch_id': _branch, 'department_id': _dept})),
        builder: (ctx, d, reload) {
          final rows = rowsOf(d['items']);
          return ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            _head(),
            Center(child: MonthBar(year: _y, month: _m, onChanged: (y, m) => setState(() { _y = y; _m = m; }))),
            _filters(),
            if (Perm.can('hr', 'attendance', 'export'))
              padded(Align(
                alignment: Alignment.centerLeft,
                child: headerButton('Export CSV', () => openApiFile(context, '/hr/attendance/summary/export', 'attendance_summary_${_y}_${_m.toString().padLeft(2, '0')}.csv',
                    query: {'year': _y, 'month': _m, 'branch_id': ?_branch, 'department_id': ?_dept}), primary: false),
              )),
            if (rows.isEmpty) const EmptyView('No employees match these filters.'),
            for (final s in rows)
              RecordCard(
                title: str(s['user_name']),
                subtitle: joinNonEmpty([str(s['employee_code']).isEmpty ? s['user_email'] : s['employee_code'], s['department_name']]),
                trailing: Text(numTxt(s['present_equivalent']), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                meta: [
                  ('Present', numTxt(s['present'])), ('Half day', numTxt(s['half_day'])), ('Absent', numTxt(s['absent'])),
                  ('Leave', numTxt(s['on_leave'])), ('On duty', numTxt(s['on_duty'])), ('WFH', numTxt(s['work_from_home'])),
                  ('Holiday', numTxt(s['holiday'])), ('Weekly off', numTxt(s['weekly_off'])), ('Not marked', numTxt(s['unmarked'])),
                  ('Late', numTxt(s['late_days'])),
                ],
                onTap: () => setState(() { _monthUser = asInt(s['user_id']); _monthUserName = str(s['user_name']); _tab = 1; }),
              ),
            padded(HintText(
                '${monthNames[_m - 1]} $_y. “Present eq.” (the number on the right) = present + on duty + WFH + half of half days — share it with ADP for payroll; salaries are not calculated here.')),
          ]);
        },
      );

  Future<void> _runImport(bool dryRun) async {
    final f = _importFile;
    if (f == null) {
      showSnack(context, 'Choose the CSV file to import first.', error: true);
      return;
    }
    try {
      final res = mapOf(await Api.post('/hr/attendance/import', query: {'dry_run': dryRun}, data: FormData.fromMap({'file': f.clone()})));
      if (!mounted) return;
      setState(() {
        _importResult = res;
        if (!dryRun) {
          _notice = 'Imported ${res['created']} new and ${res['updated']} updated attendance rows'
              '${rowsOf(res['errors']).isNotEmpty ? '; ${rowsOf(res['errors']).length} row(s) were skipped — see below' : ''}.';
        }
      });
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  Widget _import() => ListView(padding: const EdgeInsets.only(bottom: 88), children: [
        _head(),
        DetailSection('Import attendance from CSV', children: [
          const HintText('Download the template, fill one row per employee per day, then check it (dry run) before importing.'),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            headerButton('Download template', () => openApiFile(context, '/hr/attendance/import/template', 'attendance_import_template.csv'), primary: false),
            headerButton('Choose CSV', () async {
              final f = await Files.pickFile(extensions: ['csv']);
              if (f != null) setState(() { _importFile = f; _importResult = null; });
            }, primary: false),
          ]),
          if (_importFile != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('File: ${_importFile!.filename}')),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            headerButton('Check (dry run)', () => _runImport(true), primary: false),
            headerButton('Import', () => _runImport(false), icon: Icons.upload_rounded),
          ]),
        ]),
        if (_importResult != null)
          DetailSection('Result', children: [
            Text('Created ${_importResult!['created']} · updated ${_importResult!['updated']}'),
            for (final e in rowsOf(_importResult!['errors']))
              Text('Row ${e['row']} · ${str(e['employee'])} — ${str(e['problem'] ?? e['error'] ?? e['message'])}', style: const TextStyle(color: Brand.danger, fontSize: 13)),
          ]),
      ]);

  Future<void> _decideReg(String kind, Json r) async {
    final v = await promptDialog(context,
        title: '${kind == 'approve' ? 'Approve' : 'Reject'} ${r['request_no']}?',
        message: '${r['user_name']} · ${fmtDate(r['attendance_date'])} → ${labelOf(attLabels, r['requested_status'])}.${kind == 'reject' ? ' A reason is required.' : ''}',
        label: kind == 'reject' ? 'Reason' : 'Remarks (optional)',
        required: kind == 'reject',
        confirmLabel: kind == 'approve' ? 'Approve' : 'Reject');
    if (v == null || !mounted) return;
    final ok = await runAction(context, () => Api.post('/hr/attendance/regularizations/${r['id']}/$kind', data: {'remarks': textOrNull(v)}));
    if (ok && mounted) _refresh('${r['request_no']} ${kind == 'approve' ? 'approved' : 'rejected'}.');
  }

  Widget _corrections() => ApiListView(
        key: ValueKey('c_${_regStatus}_$_rev'),
        load: (_, _) => Api.list('/hr/attendance/regularizations', query: {'status': _regStatus}),
        emptyText: 'No correction requests with this status.',
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _head(),
          ChipRow([
            CountChip('All', null, selected: _regStatus.isEmpty, onTap: () => setState(() => _regStatus = '')),
            for (final e in requestStatusLabels.entries)
              CountChip(e.value, null, selected: _regStatus == e.key, onTap: () => setState(() => _regStatus = e.key)),
          ]),
        ]),
        itemBuilder: (ctx, r, reload) => RecordCard(
          code: str(r['request_no']),
          title: str(r['user_name']),
          subtitle: str(r['reason']),
          trailing: statusPill(r['status'], requestStatusLabels, requestStatusHex),
          meta: [
            ('Date', fmtDate(r['attendance_date'])),
            ('Currently', str(r['current_status']).isEmpty ? 'Not marked' : labelOf(attLabels, r['current_status'])),
            ('Asked for', labelOf(attLabels, r['requested_status'])),
            ('Times', '${str(r['check_in_time']).isEmpty ? '--' : r['check_in_time']} – ${str(r['check_out_time']).isEmpty ? '--' : r['check_out_time']}'),
          ],
          onTap: r['can_decide'] == true
              ? () => showModalBottomSheet<void>(
                  context: context,
                  builder: (_) => SafeArea(
                      child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: actionRow([
                            LinkAction('Approve', () { Navigator.pop(context); _decideReg('approve', r); }, color: Brand.success),
                            LinkAction('Reject', () { Navigator.pop(context); _decideReg('reject', r); }, color: Brand.danger),
                          ]))))
              : null,
        ),
      );

  Widget _head() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const PageHeader('Attendance',
            subtitle: 'Mark and correct attendance, import biometric exports and pull the monthly summary. Lighter days are worked out from the calendar — nothing is stored for those days.'),
        SubTabs(labels: [for (final t in _tabs) t.$2], index: _tab, onChanged: (i) => setState(() => _tab = i)),
        if (_notice != null) padded(NoticeBanner(_notice!)),
        if (Perm.canFeature('hr', 'attendance', 'time_evaluation', 'view'))
          Align(
            alignment: Alignment.centerLeft,
            child: LinkAction('Time evaluation & overtime (worked hours, OT approvals, ADP export) →',
                () => openPortal(context, '/dashboard/hr/attendance/time-evaluation')),
          ),
      ]);

  @override
  Widget build(BuildContext context) {
    final tabs = _tabs;
    if (_tab >= tabs.length) _tab = 0;
    switch (tabs[_tab].$1) {
      case 'month':
        return _month();
      case 'summary':
        return _summary();
      case 'import':
        return _import();
      case 'corrections':
        return _corrections();
      case 'roster':
      case 'punches':
      case 'periods':
        return ListView(children: [
          _head(),
          PortalOnlyCard(
            title: tabs[_tab].$2,
            message: 'The ${tabs[_tab].$2.toLowerCase()} is a wide grid / file workflow kept on the web portal. Open it in the portal to work on it.',
            path: '/dashboard/hr/attendance',
          ),
        ]);
      default:
        return _register();
    }
  }
}