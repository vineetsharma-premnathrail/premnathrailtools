import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/me/attendance/page.tsx + components/hr/time/MyTimeEvaluation.tsx

const _otLabels = {'pending': 'OT pending', 'approved': 'OT approved', 'rejected': 'OT rejected', 'cancelled': 'OT cancelled'};
const _otHex = {'pending': '#F59E0B', 'approved': '#16A34A', 'rejected': '#DC2626', 'cancelled': '#78716C'};

/// Attendance correction (regularisation) request form. True when sent.
Future<bool> showCorrectionForm(BuildContext context, {Json? day, void Function(String msg)? onDone}) async {
  DateTime? date = dateOf(day?['date']);
  var status = 'present';
  String? inT = textOrNull(str(day?['check_in_time']));
  String? outT = textOrNull(str(day?['check_out_time']));
  final reason = TextEditingController();
  return showFormSheet(
    context,
    title: 'Request an attendance correction',
    saveLabel: 'Submit request',
    builder: (ctx, setS) => [
      const HintText('Corrections can be requested for the last 60 days. Your reporting manager (or HR) approves them.'),
      DateField(label: 'Date', required: true, value: date, lastDate: DateTime.now(), onChanged: (d) => setS(() => date = d)),
      AppSelect<String>(
        label: 'Correct status',
        required: true,
        value: status,
        options: const [
          Option('present', 'Present'),
          Option('half_day', 'Half day'),
          Option('on_duty', 'On duty (outside office)'),
          Option('work_from_home', 'Work from home'),
        ],
        onChanged: (o) => setS(() => status = o?.value ?? 'present'),
      ),
      TimeField(
          label: 'Check-in',
          required: status == 'present' || status == 'half_day',
          value: inT,
          onChanged: (v) => setS(() => inT = v)),
      TimeField(label: 'Check-out', value: outT, onChanged: (v) => setS(() => outT = v)),
      AppTextField(label: 'Reason', controller: reason, required: true, hint: 'e.g. Forgot to check in; was at vendor site'),
    ],
    onSave: () async {
      final missing = <String>[];
      if (date == null) missing.add('Pick the date to correct.');
      if (reason.text.trim().isEmpty) missing.add('Explain what happened (e.g. forgot to check in, client visit).');
      if ((status == 'present' || status == 'half_day') && (inT ?? '').isEmpty) {
        missing.add('Enter the time you actually checked in.');
      }
      if (missing.isNotEmpty) throw missing.join(' ');
      final r = mapOf(await Api.post('/hr/attendance/regularizations', data: {
        'attendance_date': apiDate(date!),
        'requested_status': status,
        'check_in': inT,
        'check_out': outT,
        'reason': reason.text.trim(),
      }));
      onDone?.call('${r['request_no']} was sent to ${str(r['approver_name']).isEmpty ? 'HR' : r['approver_name']} for approval.');
    },
  );
}

/// My HR › Attendance.
class MyAttendancePage extends StatefulWidget {
  const MyAttendancePage({super.key});

  @override
  State<MyAttendancePage> createState() => _MyAttendancePageState();
}

class _MyAttendancePageState extends State<MyAttendancePage> {
  final _now = DateTime.now();
  late int _year = _now.year;
  late int _month = _now.month;
  late int _tYear = _now.year;
  late int _tMonth = _now.month;
  Json? _today;
  Json? _monthData;
  List<Json> _regs = [];
  Json? _time;
  Object? _error;
  String? _notice;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  Future<void> _loadAll() async {
    await Future.wait([_loadToday(), _loadMonth(), _loadRegs(), _loadTime()]);
  }

  Future<void> _guard(Future<void> Function() f) async {
    try {
      await f();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _loadToday() => _guard(() async {
        final d = mapOf(await Api.get('/hr/attendance/me/today'));
        if (mounted) setState(() => _today = d);
      });
  Future<void> _loadMonth() => _guard(() async {
        final d = mapOf(await Api.get('/hr/attendance/me/month', query: {'year': _year, 'month': _month}));
        if (mounted) setState(() => _monthData = d);
      });
  Future<void> _loadRegs() => _guard(() async {
        final d = (await Api.list('/hr/attendance/regularizations/me')).rows;
        if (mounted) setState(() => _regs = d);
      });
  Future<void> _loadTime() => _guard(() async {
        final d = mapOf(await Api.get('/hr/time-evaluation/me', query: {'year': _tYear, 'month': _tMonth}));
        if (mounted) setState(() => _time = d);
      });

  Future<void> _punch(bool isIn) async {
    setState(() { _busy = true; _notice = null; });
    try {
      final res = mapOf(await Api.post(isIn ? '/hr/attendance/me/check-in' : '/hr/attendance/me/check-out', data: {'remarks': null}));
      final day = mapOf(res['day']);
      if (mounted) {
        setState(() {
          _today = res;
          _notice = isIn ? 'Checked in at ${day['check_in_time']}.' : 'Checked out at ${day['check_out_time']}.';
        });
      }
      _loadMonth();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _correction([Json? day]) async {
    await showCorrectionForm(context, day: day, onDone: (m) {
      if (mounted) setState(() => _notice = m);
    });
    _loadRegs();
  }

  Future<void> _cancelReg(Json r) async {
    final yes = await confirmDialog(context,
        title: 'Cancel this correction request?',
        message: '${r['request_no']} for ${fmtDate(r['attendance_date'])} will be withdrawn.',
        confirmLabel: 'Withdraw request',
        danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.post('/hr/attendance/regularizations/${r['id']}/cancel', data: {}),
        success: '${r['request_no']} was cancelled.');
    if (ok) _loadRegs();
  }

  Future<void> _claimOt(Json d) async {
    final reason = await promptDialog(context,
        title: 'Claim ${hhmm(d['ot_minutes'])} h overtime',
        message: 'For ${fmtDate(d['date'])}. Your reporting manager approves it; only approved hours go to payroll.',
        label: 'What you worked on',
        confirmLabel: 'Send claim');
    if (reason == null || !mounted) return;
    if (reason.trim().length < 3) {
      showSnack(context, 'Say what the overtime was for (at least a few words) so your manager can approve it.', error: true);
      return;
    }
    try {
      final ot = mapOf(await Api.post('/hr/time-evaluation/overtime/me', data: {'work_date': d['date'], 'reason': reason.trim()}));
      if (mounted) setState(() => _notice = '${ot['request_no']} sent to your reporting manager for ${hhmm(ot['claimed_minutes'])} h overtime.');
      _loadTime();
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  Widget _todayCard() {
    final t = _today;
    if (t == null) return const LoadingView();
    final d = mapOf(t['day']);
    final shift = t['shift'] is Map ? mapOf(t['shift']) : null;
    Widget? action;
    if (t['on_leave'] == true) {
      action = const Text("You're on approved leave today.", style: TextStyle(color: Brand.muted));
    } else if (t['can_check_in'] == true && Perm.can('hr', 'me', 'create')) {
      action = FilledButton(onPressed: _busy ? null : () => _punch(true), child: Text(_busy ? 'Saving…' : 'Check in'));
    } else if (t['can_check_out'] == true && Perm.can('hr', 'me', 'edit')) {
      action = FilledButton(onPressed: _busy ? null : () => _punch(false), child: Text(_busy ? 'Saving…' : 'Check out'));
    } else if (str(d['check_out_time']).isNotEmpty) {
      action = const Text('Done for today', style: TextStyle(color: Brand.success, fontWeight: FontWeight.w600));
    }
    final late = d['late_minutes'];
    return DetailSection('Today · ${fmtDate(t['date'])}', children: [
      Text('${attLabels[str(d['status'])] ?? 'Not marked'}${str(d['holiday_name']).isEmpty ? '' : ' · ${d['holiday_name']}'}',
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Brand.heading)),
      const SizedBox(height: 4),
      HintText(shift != null
          ? '${shift['name']}: ${shift['start_time']}–${shift['end_time']} (${shift['grace_minutes']} min grace)'
          : 'No shift assigned — late marks are not calculated. HR sets your shift in your employee profile.'),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(
          child: FieldRow('Check-in', Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(str(d['check_in_time']).isEmpty ? '--:--' : str(d['check_in_time']),
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            if (late != null && str(d['check_in_time']).isNotEmpty)
              toNum(late) > 0 ? HrPill('Late by ${numTxt(late)} min', '#DC2626') : const HrPill('On time', '#16A34A'),
          ])),
        ),
        Expanded(
          child: FieldRow('Check-out', Text(str(d['check_out_time']).isEmpty ? '--:--' : str(d['check_out_time']),
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
        ),
      ]),
      if (action != null) ...[const SizedBox(height: 8), action],
    ]);
  }

  Widget _timeSection() {
    final t = _time;
    if (t == null) return const SizedBox.shrink();
    final rules = mapOf(t['rules']);
    final tot = mapOf(t['totals']);
    final days = rowsOf(t['days']).where((d) => (str(d['status']).isNotEmpty && d['status'] != 'unmarked') || d['has_punches'] == true).toList();
    final canClaim = Perm.can('hr', 'me', 'create');
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      BlockTitle('Time evaluation & overtime',
          trailing: MonthBar(year: _tYear, month: _tMonth, onChanged: (y, m) {
            setState(() { _tYear = y; _tMonth = m; });
            _loadTime();
          })),
      padded(HintText(
          'Overtime = work beyond ${hhmm(rules['ot_daily_threshold_minutes'])} h a day or ${hhmm(rules['ot_weekly_threshold_minutes'])} h a week (Factories Act s.59), after a ${numTxt(rules['rest_interval_minutes'])}-minute rest interval. Claim it here; only approved hours go to payroll.')),
      TileGrid([
        StatTile(label: 'Worked', value: hhmm(tot['worked_minutes'])),
        StatTile(label: 'Planned', value: hhmm(tot['planned_minutes'])),
        StatTile(label: 'Short', value: '${hhmm(tot['short_minutes'])} (${numTxt(tot['short_days'])} d)'),
        StatTile(label: 'Late', value: '${numTxt(tot['late_days'])} day(s)'),
        StatTile(label: 'Early leaving', value: '${numTxt(tot['early_days'])} day(s)'),
        StatTile(label: 'OT worked', value: hhmm(tot['ot_minutes'])),
        StatTile(label: 'OT approved', value: hhmm(tot['ot_approved_minutes'])),
        StatTile(label: 'OT pending', value: hhmm(tot['ot_pending_minutes'])),
      ]),
      if (days.isEmpty) const EmptyView('No attendance this month yet.'),
      for (final d in days)
        RecordCard(
          title: '${fmtDate(d['date'])} · ${attLabels[str(d['status'])] ?? (str(d['status']).isEmpty ? '—' : d['status'])}'
              '${d['day_kind'] != 'working' && d['has_punches'] == true ? ' · off-day work' : ''}',
          subtitle: '${str(d['check_in_time']).isEmpty ? '--' : d['check_in_time']} – ${str(d['check_out_time']).isEmpty ? '--' : d['check_out_time']}'
              '${d['missing_check_out'] == true ? ' · no check-out' : ''}',
          trailing: str(d['ot_status']).isEmpty
              ? null
              : HrPill('${_otLabels[str(d['ot_status'])] ?? d['ot_status']}${d['ot_status'] == 'approved' && d['ot_approved_minutes'] != null ? ' ${hhmm(d['ot_approved_minutes'])}' : ''}',
                  _otHex[str(d['ot_status'])] ?? '#64748B'),
          meta: [
            ('Planned', toNum(d['planned_minutes']) > 0 ? hhmm(d['planned_minutes']) : '—'),
            ('Worked', toNum(d['worked_minutes']) > 0 ? '${hhmm(d['worked_minutes'])}${d['has_punches'] != true ? ' (assumed)' : ''}' : '—'),
            ('Short', toNum(d['short_minutes']) > 0 ? hhmm(d['short_minutes']) : '—'),
            ('Late', toNum(d['late_minutes']) > 0 ? '${numTxt(d['late_minutes'])} min' : '—'),
            ('Early', toNum(d['early_minutes']) > 0 ? '${numTxt(d['early_minutes'])} min' : '—'),
            ('Overtime', toNum(d['ot_minutes']) > 0 ? '${hhmm(d['ot_minutes'])}${toNum(d['ot_weekly_minutes']) > 0 ? ' (48 h week)' : ''}' : '—'),
          ],
          onTap: canClaim && toNum(d['ot_minutes']) > 0 && (str(d['ot_status']).isEmpty || d['ot_status'] == 'cancelled')
              ? () => _claimOt(d)
              : null,
        ),
      if (canClaim) padded(const HintText('Tap a day with unclaimed overtime to claim it.')),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = Perm.can('hr', 'me', 'create');
    final todayIso0 = str(_today?['date']);
    return RefreshIndicator(
      onRefresh: _loadAll,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 88),
        children: [
          PageHeader('My Attendance',
              subtitle: 'Check in and out, see your month, and ask for a correction if a day is wrong.',
              actions: [if (canCreate) headerButton('Request correction', () => _correction(), primary: false)]),
          if (_error != null) padded(ErrorBanner(ApiClient.describe(_error!))),
          if (_notice != null) padded(NoticeBanner(_notice!)),
          _todayCard(),
          Center(
            child: MonthBar(year: _year, month: _month, onChanged: (y, m) {
              setState(() { _year = y; _month = m; _monthData = null; });
              _loadMonth();
            }),
          ),
          padded(AttendanceLegend(counts: _monthData == null ? null : mapOf(_monthData!['counts']))),
          if (_monthData == null)
            const LoadingView()
          else
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: AttendanceCalendar(
                year: _year,
                month: _month,
                days: rowsOf(_monthData!['days']),
                onDayTap: (d) {
                  if (canCreate && str(d['date']).compareTo(todayIso0) <= 0 && d['source'] != 'leave') _correction(d);
                },
              ),
            ),
          padded(const Padding(padding: EdgeInsets.only(top: 6), child: HintText('Tap a past day to ask for a correction.'))),
          const BlockTitle('My correction requests'),
          if (_regs.isEmpty)
            padded(const HintText('No correction requests yet — tap a past day in the calendar above, or use Request correction.')),
          for (final r in _regs)
            RecordCard(
              code: str(r['request_no']),
              title: '${fmtDate(r['attendance_date'])} → ${attLabels[str(r['requested_status'])] ?? r['requested_status']}',
              subtitle: str(r['reason']),
              trailing: statusPill(r['status'], requestStatusLabels, requestStatusHex),
              meta: [
                ('Times', '${str(r['check_in_time']).isEmpty ? '--' : r['check_in_time']} – ${str(r['check_out_time']).isEmpty ? '--' : r['check_out_time']}'),
                if (str(r['decision_remarks']).isNotEmpty) ('Decision', '“${r['decision_remarks']}”'),
              ],
              onTap: r['can_cancel'] == true ? () => _cancelReg(r) : null,
            ),
          _timeSection(),
        ],
      ),
    );
  }
}