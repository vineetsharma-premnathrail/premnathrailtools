import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'claims.dart';
import 'hr_common.dart';
import 'leave.dart';
import 'lifecycle.dart';

// Portal: app/dashboard/hr/approvals/page.tsx + components/hr/approvals/*.tsx
// + components/hr/lifecycle/MyChecklistTasks.tsx

/// Everything waiting for the signed-in user's decision.
class HrApprovalsPage extends StatefulWidget {
  const HrApprovalsPage({super.key});

  @override
  State<HrApprovalsPage> createState() => _HrApprovalsPageState();
}

class _HrApprovalsPageState extends State<HrApprovalsPage> {
  List<Json>? _leave, _regs, _travel, _claims, _ot, _tasks;
  final _errors = <String>[];
  String? _notice;
  final _otMinutes = <int, String>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<List<Json>?> _get(String path, String what, [Map<String, dynamic>? q]) async {
    try {
      return (await Api.list(path, query: q)).rows;
    } catch (e) {
      _errors.add('Could not load $what: ${ApiClient.describe(e)}');
      return [];
    }
  }

  Future<void> _load() async {
    _errors.clear();
    final r = await Future.wait([
      _get('/hr/leave/requests/pending-for-me', 'leave approvals'),
      _get('/hr/attendance/regularizations/pending-for-me', 'attendance corrections'),
      _get('/hr/travel/approvals', 'travel approvals'),
      _get('/hr/expenses/approvals', 'expense claim approvals'),
      _get('/hr/time-evaluation/overtime/pending-for-me', 'overtime claims'),
      _get('/hr/lifecycle/my-tasks', 'your checklist tasks', {'status': 'pending'}),
    ]);
    if (!mounted) return;
    setState(() {
      _leave = r[0];
      _regs = r[1];
      _travel = r[2];
      _claims = r[3];
      _ot = r[4];
      _tasks = r[5];
    });
  }

  Future<void> _decide({
    required String kind,
    required String no,
    required String who,
    required String message,
    required String path,
    Map<String, dynamic> extra = const {},
    String? approveHint,
  }) async {
    final approve = kind == 'approve';
    final remarks = await promptDialog(context,
        title: '${approve ? 'Approve' : 'Reject'} $no?',
        message: '$message${approve ? (approveHint ?? '') : ' A reason is required.'}',
        label: approve ? 'Remarks (optional)' : 'Reason for rejecting',
        required: !approve,
        confirmLabel: approve ? 'Approve' : 'Reject');
    if (remarks == null || !mounted) return;
    final ok = await runAction(context, () => Api.post('$path/$kind', data: {'remarks': textOrNull(remarks), ...extra}));
    if (ok && mounted) {
      setState(() => _notice = '$no ${approve ? 'approved' : 'rejected'}. $who has been notified.');
      _load();
    }
  }

  Widget _decideButtons(void Function(String kind) on) => Wrap(spacing: 8, children: [
        LinkAction('Approve', () => on('approve'), color: Brand.success),
        LinkAction('Reject', () => on('reject'), color: Brand.danger),
      ]);

  List<Widget> _section(String title, List<Json>? rows, Widget Function(Json r) card, {String? footer}) {
    if (rows == null || rows.isEmpty) return const [];
    return [
      BlockTitle(title, trailing: Text('${rows.length} pending', style: const TextStyle(color: Color(0xFFF59E0B), fontWeight: FontWeight.w700, fontSize: 12))),
      for (final r in rows) card(r),
      if (footer != null) padded(HintText(footer)),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final loaded = _leave != null;
    final empty = loaded && [_leave, _regs, _travel, _claims, _ot, _tasks].every((l) => l == null || l.isEmpty);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 88), children: [
        const PageHeader('Approvals',
            subtitle: 'Leave, attendance corrections, travel and expense claims waiting for your decision, plus lifecycle checklist tasks assigned to you. Sections with nothing pending are hidden.'),
        padded(const HintText(
            "Who approves is set in Organization › Approval Workflows (default: the employee's reporting manager, plus HR approvers). Delegations and the approval trail of every module are in My Approvals.")),
        for (final e in _errors) padded(ErrorBanner(e)),
        if (_notice != null) padded(NoticeBanner(_notice!)),
        if (!loaded) const LoadingView(),
        if (empty) const EmptyView('Nothing is waiting for your decision.', icon: Icons.task_alt_rounded),
        ..._section('Leave requests', _leave, (r) => RecordCard(
              code: str(r['request_no']),
              title: '${r['user_name']} · ${r['leave_type_name']}',
              subtitle: joinNonEmpty([r['employee_code'], r['department_name'], if (r['approver_id'] == null) 'No reporting manager — HR decides']),
              meta: [
                ('Dates', leaveDates(r)),
                ('Days', numTxt(r['days'])),
                ('Reason', str(r['reason']).isEmpty ? '—' : str(r['reason'])),
                if (str(r['contact_during_leave']).isNotEmpty) ('Contact', str(r['contact_during_leave'])),
                ('Applied', fmtDate(r['created_at'])),
              ],
              trailing: Column(children: [
                if (r['can_decide'] == true)
                  _decideButtons((k) => _decide(
                        kind: k, no: str(r['request_no']), who: str(r['user_name']), path: '/hr/leave/requests/${r['id']}',
                        message: '${r['user_name']} · ${r['leave_type_name']} · ${numTxt(r['days'])} day(s) from ${fmtDate(r['from_date'])}.',
                        approveHint: ' Their balance is deducted and the days are marked on leave.',
                      )),
                if (str(r['attachment_path']).isNotEmpty)
                  LinkAction('View attachment', () => openApiFile(context, '/hr/leave/requests/${r['id']}/attachment', '${r['request_no']}_attachment')),
              ]),
            )),
        ..._section('Attendance corrections', _regs, (r) => RecordCard(
              code: str(r['request_no']),
              title: str(r['user_name']),
              subtitle: joinNonEmpty([r['employee_code'], if (r['approver_id'] == null) 'No reporting manager — HR decides']),
              meta: [
                ('Date', fmtDate(r['attendance_date'])),
                ('Currently', str(r['current_status']).isEmpty ? 'Not marked' : labelOf(attLabels, r['current_status'])),
                ('Asked for', labelOf(attLabels, r['requested_status'])),
                ('Times', '${str(r['check_in_time']).isEmpty ? '--' : r['check_in_time']} – ${str(r['check_out_time']).isEmpty ? '--' : r['check_out_time']}'),
                ('Reason', str(r['reason'])),
              ],
              trailing: r['can_decide'] == true
                  ? _decideButtons((k) => _decide(
                        kind: k, no: str(r['request_no']), who: str(r['user_name']), path: '/hr/attendance/regularizations/${r['id']}',
                        message: '${r['user_name']} · ${fmtDate(r['attendance_date'])} → ${labelOf(attLabels, r['requested_status'])}.',
                        approveHint: ' The attendance for that day will be overwritten.',
                      ))
                  : null,
            )),
        ..._section('Travel requests', _travel, (t) => RecordCard(
              code: str(t['request_no']),
              title: '${t['user_name']} · ${t['from_city']} → ${t['to_city']}',
              subtitle: str(t['purpose']),
              meta: [
                ('Dates', '${fmtDate(t['depart_date'])}${str(t['return_date']).isEmpty ? '' : ' – ${fmtDate(t['return_date'])}'}'),
                ('Mode', '${labelOf(travelModeLabels, t['travel_mode'])}${t['accommodation_required'] == true ? ' · stay needed' : ''}'),
                ('Est.', '${fmtMoney(t['estimated_cost'])}${toNum(t['advance_required']) > 0 ? ' · advance ${fmtMoney(t['advance_required'])}' : ''}'),
                if (str(t['project_reference']).isNotEmpty) ('Reference', str(t['project_reference'])),
              ],
              trailing: _decideButtons((k) => _decide(
                    kind: k, no: str(t['request_no']), who: str(t['user_name']), path: '/hr/travel/${t['id']}',
                    message: '${t['user_name']}: ${t['from_city']} → ${t['to_city']}.',
                  )),
            )),
        ..._section('Expense claims', _claims, (c) => RecordCard(
              code: str(c['claim_no']),
              title: '${c['user_name']} · ${c['title']}',
              subtitle: joinNonEmpty([
                c['user_department'],
                'submitted ${fmtDateTime(c['submitted_at'])}',
                if (c['approver_id'] == null) 'No manager set — any HR user can decide',
              ]),
              meta: [
                ('Amount', fmtMoney(c['total_amount'])),
                ('Lines', numTxt(c['item_count'])),
                ('Claim date', fmtDate(c['claim_date'])),
                if (str(c['travel_request_no']).isNotEmpty) ('Trip', '${c['travel_request_no']} (${c['travel_route']})'),
                if (rowsOf(c['items']).any((i) => i['receipt_required'] == true && i['has_receipt'] != true))
                  ('Receipts', '${rowsOf(c['items']).where((i) => i['receipt_required'] == true && i['has_receipt'] != true).length} line(s) have no receipt'),
              ],
              trailing: _decideButtons((k) => _decide(
                    kind: k, no: str(c['claim_no']), who: str(c['user_name']), path: '/hr/expenses/${c['id']}',
                    message: '${c['user_name']} · ${fmtMoney(c['total_amount'])}.',
                  )),
              onTap: () async {
                await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ClaimDetailScreen(claimId: asInt(c['id']) ?? 0)));
                _load();
              },
            ), footer: 'Tap a claim to see its lines and receipts. Approving does not pay the employee — HR records the payment after it is made.'),
        ..._section('Overtime', _ot, (o) {
          final id = asInt(o['id']) ?? 0;
          return RecordCard(
            code: str(o['request_no']),
            title: str(o['user_name']),
            subtitle: str(o['reason']),
            meta: [
              ('Date', fmtDate(o['work_date'])),
              ('In – Out', '${str(o['check_in_time']).isEmpty ? '--' : o['check_in_time']} – ${str(o['check_out_time']).isEmpty ? '--' : o['check_out_time']}'),
              ('Worked', o['worked_minutes'] == null ? '—' : hhmm(o['worked_minutes'])),
              ('OT claimed', hhmm(o['claimed_minutes'])),
              if (o['current_ot_minutes'] != null && o['current_ot_minutes'] != o['claimed_minutes'])
                ('Punches now give', hhmm(o['current_ot_minutes'])),
              if (_otMinutes[id] != null) ('Approve (min)', _otMinutes[id]!),
            ],
            trailing: o['can_decide'] == true
                ? Column(children: [
                    LinkAction('Minutes', () async {
                      final m = await promptDialog(context,
                          title: 'Minutes to approve', label: 'Approve (min)', confirmLabel: 'Set',
                          message: 'Claimed ${numTxt(o['claimed_minutes'])} min. Approving fewer minutes than claimed needs a reason.');
                      final n = int.tryParse((m ?? '').trim());
                      if (n != null && mounted) setState(() => _otMinutes[id] = '$n');
                    }),
                    _decideButtons((k) {
                      final m = int.tryParse(_otMinutes[id] ?? '');
                      _decide(
                        kind: k, no: str(o['request_no']), who: str(o['user_name']), path: '/hr/time-evaluation/overtime/$id',
                        message: '${o['user_name']} · ${fmtDate(o['work_date'])}.',
                        approveHint: ' Approving fewer minutes than claimed needs a reason.',
                        extra: k == 'approve' ? {'approved_minutes': m != null && m != asInt(o['claimed_minutes']) ? m : null} : const {},
                      );
                    }),
                  ])
                : null,
          );
        }),
        if (_tasks != null && _tasks!.isNotEmpty) ...[
          BlockTitle('Your onboarding / offboarding tasks (${_tasks!.length} pending)'),
          for (final t in _tasks!) checklistTaskCard(context, t, _load),
        ],
      ]),
    );
  }
}