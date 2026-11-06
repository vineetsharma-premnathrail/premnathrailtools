import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';
import 'leave.dart';

// Portal: app/dashboard/hr/leave/page.tsx (Requests / Balances, apply on
// behalf, allot year, adjust balance)

class HrLeavePage extends StatefulWidget {
  const HrLeavePage({super.key});

  @override
  State<HrLeavePage> createState() => _HrLeavePageState();
}

class _HrLeavePageState extends State<HrLeavePage> {
  int _tab = 0;
  int _rev = 0;
  String _status = '';
  int? _type;
  DateTime? _from, _to;
  int _year = DateTime.now().year;
  int? _balType;
  List<Json> _types = [];
  List<Option<int>> _employees = [];
  String? _notice;

  bool get _canAllot => Perm.canFeature('hr', 'leave', 'balance_admin', 'create');
  bool get _canAdjust => Perm.canFeature('hr', 'leave', 'balance_admin', 'edit');

  @override
  void initState() {
    super.initState();
    _setup();
  }

  Future<void> _setup() async {
    try {
      final t = (await Api.list('/hr/leave/types', query: {'include_inactive': true})).rows;
      final l = mapOf(await Api.get('/hr/attendance/lookups'));
      if (!mounted) return;
      setState(() {
        _types = t;
        _employees = [
          for (final e in rowsOf(l['employees']))
            Option(asInt(e['user_id']) ?? 0, '${e['user_name']}${str(e['employee_code']).isEmpty ? '' : ' (${e['employee_code']})'}', subtitle: str(e['user_email'])),
        ];
      });
    } catch (e) {
      if (mounted) setState(() => _notice = null);
      if (mounted) showSnack(context, 'Could not load leave setup: ${ApiClient.describe(e)}', error: true);
    }
  }

  List<Json> get _active => _types.where((t) => t['is_active'] != false).toList();
  void _refresh(String msg) => setState(() { _notice = msg; _rev++; });

  Future<void> _applyOnBehalf() async {
    int? uid;
    final picked = await showFormSheet(context,
        title: 'Apply leave on behalf',
        saveLabel: 'Next',
        builder: (ctx, setS) => [
              const HintText('Pick the employee to apply leave for. It still goes to their reporting manager for approval.'),
              AppSelect<int>(label: 'Employee', required: true, value: uid, loadOptions: (q) async => filterOptions(_employees, q), onChanged: (o) => setS(() => uid = o?.value)),
            ],
        onSave: () async {
          if (uid == null) throw 'Pick the employee.';
        });
    if (!picked || uid == null || !mounted) return;
    final no = await showLeaveApplyForm(context, types: _active, userId: uid, title: 'Apply leave on behalf');
    if (no != null && mounted) _refresh("$no was submitted and sent to the employee's approver.");
  }

  Future<void> _decide(String kind, Json r) async {
    final v = await promptDialog(context,
        title: '${kind == 'approve' ? 'Approve' : kind == 'reject' ? 'Reject' : 'Cancel'} ${r['request_no']}?',
        message: '${r['user_name']} · ${r['leave_type_name']} · ${numTxt(r['days'])} day(s) from ${fmtDate(r['from_date'])}.'
            '${kind == 'reject' ? ' A reason is required.' : kind == 'cancel' ? ' Approved days go back to the balance.' : ''}',
        label: kind == 'reject' ? 'Reason for rejecting' : 'Remarks (optional)',
        required: kind == 'reject',
        confirmLabel: kind == 'approve' ? 'Approve' : kind == 'reject' ? 'Reject' : 'Cancel leave');
    if (v == null || !mounted) return;
    final ok = await runAction(context, () => Api.post('/hr/leave/requests/${r['id']}/$kind', data: {'remarks': textOrNull(v)}));
    if (ok && mounted) _refresh('${r['request_no']} ${kind == 'approve' ? 'approved' : kind == 'reject' ? 'rejected' : 'cancelled'}. ${r['user_name']} has been notified.');
  }

  Future<void> _allot() async {
    var year = _year;
    final picked = <int>{};
    var prorate = true;
    Json? result;
    final ok = await showFormSheet(context,
        title: 'Allot annual leave',
        saveLabel: 'Allot',
        builder: (ctx, setS) => [
              const HintText("Sets each active employee's allotted days to the type's annual quota and brings forward carry-forward balances."),
              AppSelect<int>(label: 'Year', value: year, clearable: false, options: yearOptions(back: 1), onChanged: (o) => setS(() => year = o?.value ?? year)),
              CheckField(label: 'Pro-rate for employees who join during the year', value: prorate, onChanged: (v) => setS(() => prorate = v)),
              const Caps('Leave Types — none ticked = all active'),
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final t in _active)
                  FilterChip(
                    label: Text('${t['code']} · ${t['is_paid'] == false ? 'unpaid' : '${numTxt(t['annual_quota'])}/yr'}${t['carry_forward'] == true ? ' · carry ≤ ${numTxt(t['max_carry_forward'])}' : ''}'),
                    selected: picked.contains(asInt(t['id'])),
                    onSelected: (on) => setS(() => on ? picked.add(asInt(t['id'])!) : picked.remove(asInt(t['id']))),
                  ),
              ]),
              const HintText('Safe to run again — manual adjustments and days already used are never touched. Types with a quota of 0 and nothing to carry are skipped.'),
            ],
        onSave: () async {
          result = mapOf(await Api.post('/hr/leave/balances/allot',
              data: {'year': year, 'leave_type_ids': picked.isEmpty ? null : picked.toList(), 'prorate_joiners': prorate}));
        });
    if (!ok || result == null || !mounted) return;
    final r = result!;
    setState(() => _year = year);
    _refresh('${r['year']} leave (${(r['leave_types'] is List ? r['leave_types'] as List : const []).join(', ')}) for ${r['employees']} active employees: '
        '${r['created']} new balance rows, ${r['updated']} updated, ${r['unchanged']} already up to date'
        '${toNum(r['skipped_gender']) > 0 ? ', ${r['skipped_gender']} skipped (gender-restricted type)' : ''}'
        '${toNum(r['skipped_not_joined']) > 0 ? ', ${r['skipped_not_joined']} skipped (joining date after ${r['year']})' : ''}.');
  }

  Future<void> _adjust([Json? b]) async {
    int? uid = asInt(b?['user_id']);
    int? typeId = asInt(b?['leave_type_id']) ?? (_active.isEmpty ? null : asInt(_active.first['id']));
    final year = asInt(b?['year']) ?? _year;
    final delta = TextEditingController();
    final reason = TextEditingController();
    Json? res;
    final ok = await showFormSheet(context,
        title: 'Adjust leave balance',
        saveLabel: 'Save adjustment',
        builder: (ctx, setS) => [
              HintText(b != null
                  ? '${b['user_name']} · ${b['leave_type_name']} · ${b['year']} (available ${numTxt(b['available'])})'
                  : "Add or take away days on one employee's balance."),
              AppSelect<int>(label: 'Employee', required: true, value: uid, valueLabel: str(b?['user_name']),
                  loadOptions: (q) async => filterOptions(_employees, q), onChanged: (o) => setS(() => uid = o?.value)),
              AppSelect<int>(label: 'Leave type', required: true, value: typeId,
                  options: [for (final t in _active) Option(asInt(t['id']) ?? 0, '${t['name']} (${t['code']})')], onChanged: (o) => setS(() => typeId = o?.value)),
              AppTextField(label: 'Days (+ add / − deduct)', controller: delta, required: true, keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), hint: 'e.g. 1 or -0.5'),
              AppTextField(label: 'Reason', controller: reason, required: true, hint: 'e.g. Comp-off for Sunday dispatch work'),
            ],
        onSave: () async {
          final p = <String>[];
          if (uid == null) p.add('Pick the employee.');
          if (typeId == null) p.add('Pick the leave type.');
          final d = num.tryParse(delta.text.trim());
          if (d == null || d == 0) {
            p.add('Enter the days to add (e.g. 2) or deduct (e.g. -1.5).');
          } else if ((d * 2) % 1 != 0) {
            p.add('Adjust in steps of 0.5 day.');
          }
          if (reason.text.trim().length < 3) p.add('Give a reason — it is kept in the audit log and shown to the employee.');
          if (p.isNotEmpty) throw p.join(' ');
          res = mapOf(await Api.post('/hr/leave/balances/adjust',
              data: {'user_id': uid, 'leave_type_id': typeId, 'year': year, 'delta': d, 'reason': reason.text.trim()}));
        });
    if (ok && res != null && mounted) _refresh("${res!['user_name']}'s ${res!['leave_type_name']} for ${res!['year']} is now ${numTxt(res!['available'])} days.");
  }

  @override
  Widget build(BuildContext context) {
    final header = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      PageHeader('Leave', subtitle: 'All leave requests and employee leave balances.', actions: [
        if (_tab == 0 && Perm.can('hr', 'leave', 'create')) headerButton('Apply on behalf', _applyOnBehalf),
      ]),
      if (_tab == 1 && (_canAllot || _canAdjust))
        padded(Wrap(spacing: 8, children: [
          if (_canAdjust) headerButton('Adjust balance', () => _adjust(), primary: false),
          if (_canAllot) headerButton('Allot year', _allot, icon: Icons.event_available_rounded),
        ])),
      SubTabs(labels: const ['Requests', 'Balances'], index: _tab, onChanged: (i) => setState(() => _tab = i)),
      if (_notice != null) padded(NoticeBanner(_notice!)),
    ]);
    final typeOpts = [for (final t in _types) Option(asInt(t['id']) ?? 0, str(t['name']))];
    if (_tab == 1) {
      return ApiListView(
        key: ValueKey('bal_${_year}_${_balType}_$_rev'),
        searchHint: 'Search employee…',
        load: (_, q) => Api.list('/hr/leave/balances', query: {'year': _year, 'leave_type_id': _balType, 'search': q}),
        emptyText: 'No balances for $_year yet. Use “Allot year” to give every active employee their annual quota.',
        header: Column(children: [
          header,
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(children: [
              Expanded(child: AppSelect<int>(label: 'Year', value: _year, clearable: false, options: yearOptions(), onChanged: (o) => setState(() => _year = o?.value ?? _year))),
              const SizedBox(width: 8),
              Expanded(child: AppSelect<int>(label: 'All leave types', value: _balType, options: typeOpts, onChanged: (o) => setState(() => _balType = o?.value))),
            ]),
          ),
        ]),
        itemBuilder: (ctx, b, reload) => RecordCard(
          title: str(b['user_name']),
          subtitle: joinNonEmpty([b['employee_code'], b['department_name']]),
          trailing: Text(b['is_paid'] == false ? '—' : numTxt(b['available']), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Brand.heading)),
          meta: [
            ('Leave type', '${b['leave_type_name']} ${str(b['leave_type_code'])}'),
            ('Carried', numTxt(b['opening'])),
            ('Allotted', numTxt(b['allotted'])),
            ('Adjusted', '${toNum(b['adjusted']) > 0 ? '+' : ''}${numTxt(b['adjusted'])}'),
            ('Used', numTxt(b['used'])),
            ('Pending', numTxt(b['pending'])),
          ],
          onTap: _canAdjust ? () => _adjust(b) : null,
        ),
      );
    }
    return ApiListView(
      key: ValueKey('req_${_status}_${_type}_${_from}_${_to}_$_rev'),
      searchHint: 'Search employee or request no…',
      load: (_, q) => Api.list('/hr/leave/requests', query: {
        'limit': 2000, 'status': _status, 'leave_type_id': _type, 'search': q, 'date_from': isoOrNull(_from), 'date_to': isoOrNull(_to),
      }),
      emptyText: 'No leave requests match these filters.',
      header: Column(children: [
        header,
        ChipRow([
          CountChip('All statuses', null, selected: _status.isEmpty, onTap: () => setState(() => _status = '')),
          for (final e in requestStatusLabels.entries)
            CountChip(e.value, null, selected: _status == e.key, onTap: () => setState(() => _status = _status == e.key ? '' : e.key)),
        ]),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Column(children: [
            AppSelect<int>(label: 'All leave types', value: _type, options: typeOpts, onChanged: (o) => setState(() => _type = o?.value)),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: DateField(label: 'From', value: _from, onChanged: (d) => setState(() => _from = d))),
              const SizedBox(width: 8),
              Expanded(child: DateField(label: 'To', value: _to, onChanged: (d) => setState(() => _to = d))),
            ]),
          ]),
        ),
      ]),
      itemBuilder: (ctx, r, reload) => RecordCard(
        code: str(r['request_no']),
        title: '${r['user_name']} · ${r['leave_type_name']}',
        subtitle: joinNonEmpty([r['employee_code'], r['department_name'], r['reason']]),
        trailing: statusPill(r['status'], requestStatusLabels, requestStatusHex),
        meta: [
          ('Dates', leaveDates(r)),
          ('Days', numTxt(r['days'])),
          ('Approver / decision',
              '${r['status'] == 'pending' ? (str(r['approver_name']).isEmpty ? 'HR (no manager)' : r['approver_name']) : (str(r['decided_by_name']).isEmpty ? '—' : r['decided_by_name'])}'
              '${str(r['decision_remarks']).isEmpty ? '' : ' “${r['decision_remarks']}”'}'),
          ('Applied', fmtDate(r['created_at'])),
        ],
        onTap: () {
          final acts = <Widget>[
            if (str(r['attachment_path']).isNotEmpty)
              LinkAction('File', () { Navigator.pop(context); openApiFile(context, '/hr/leave/requests/${r['id']}/attachment', '${r['request_no']}_attachment'); }),
            if (r['can_decide'] == true) LinkAction('Approve', () { Navigator.pop(context); _decide('approve', r); }, color: Brand.success),
            if (r['can_decide'] == true) LinkAction('Reject', () { Navigator.pop(context); _decide('reject', r); }, color: Brand.danger),
            if (r['can_cancel'] == true) LinkAction('Cancel', () { Navigator.pop(context); _decide('cancel', r); }, color: Brand.muted),
          ];
          if (acts.isEmpty) return;
          showModalBottomSheet<void>(context: context, builder: (_) => SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: actionRow(acts))));
        },
      ),
    );
  }
}