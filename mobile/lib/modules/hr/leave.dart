import 'dart:async';

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

// Portal: app/dashboard/hr/me/leave/page.tsx + components/hr/leave/LeaveApplyForm.tsx

/// Dates line of a leave request ("5 Nov 2026 (1st half) → 7 Nov 2026").
String leaveDates(Json r) {
  final from = '${fmtDate(r['from_date'])}${sessionShort[str(r['from_session'])] ?? ''}';
  if (str(r['to_date']) == str(r['from_date'])) return from;
  return '$from → ${fmtDate(r['to_date'])}${sessionShort[str(r['to_session'])] ?? ''}';
}

/// Apply-for-leave form with the server's live day count / balance / approver.
/// Returns the new request no. or null. `userId` = HR applying on behalf.
Future<String?> showLeaveApplyForm(BuildContext context,
    {required List<Json> types, int? userId, String title = 'Apply for leave'}) async {
  if (types.isEmpty) {
    showSnack(context, 'No active leave types are set up yet — HR adds them under HR › Masters › Leave Types.', error: true);
    return null;
  }
  int? typeId = asInt(types.first['id']);
  DateTime? from;
  DateTime? to;
  var fromSession = 'full';
  var toSession = 'full';
  final reason = TextEditingController();
  final contact = TextEditingController();
  MultipartFile? file;
  String? fileName;
  Json? preview;
  String? requestNo;

  Json? typeOf(int? id) => types.where((t) => asInt(t['id']) == id).firstOrNull;

  final saved = await showFormSheet(
    context,
    title: title,
    saveLabel: 'Submit request',
    builder: (ctx, setS) {
      final lt = typeOf(typeId);
      final single = from != null && (to == null || apiDate(to!) == apiDate(from!));
      final halfOk = lt?['allow_half_day'] != false;
      if (!single && fromSession == 'first_half') fromSession = 'full';
      final fromOpts = <Option<String>>[
        const Option('full', 'Full day'),
        if (halfOk && single) const Option('first_half', 'First half'),
        if (halfOk) Option('second_half', single ? 'Second half' : 'From second half'),
      ];
      final toOpts = <Option<String>>[
        const Option('full', 'Full day'),
        if (halfOk) const Option('first_half', 'Till first half'),
      ];
      return [
        const HintText('Weekly offs and plant holidays are not counted. The request goes to the approver shown below.'),
        AppSelect<int>(
          label: 'Leave type',
          required: true,
          value: typeId,
          options: [
            for (final t in types)
              Option(asInt(t['id']) ?? 0, '${t['name']} (${t['code']})${t['is_paid'] == false ? ' — unpaid' : ''}'),
          ],
          onChanged: (o) => setS(() => typeId = o?.value),
        ),
        DateField(
          label: 'From',
          required: true,
          value: from,
          onChanged: (d) => setS(() {
            from = d;
            if (d != null && to != null && to!.isBefore(d)) to = d;
          }),
        ),
        AppSelect<String>(
          label: single ? 'Session' : 'Start session',
          value: fromSession,
          options: fromOpts,
          clearable: false,
          onChanged: (o) => setS(() => fromSession = o?.value ?? 'full'),
        ),
        DateField(label: 'To', value: to, onChanged: (d) => setS(() => to = d)),
        if (!single)
          AppSelect<String>(
            label: 'End session',
            value: toSession,
            options: toOpts,
            clearable: false,
            onChanged: (o) => setS(() => toSession = o?.value ?? 'full'),
          ),
        AppTextField(label: 'Reason', controller: reason, required: true, maxLines: 3, hint: 'e.g. Family function in hometown'),
        AppTextField(label: 'Contact during leave', controller: contact, hint: 'Phone / email'),
        DetailSection('Days & Balance', children: [
          _LeavePreview(
            key: ValueKey('${typeId}_${from}_${to}_${fromSession}_${toSession}_${file != null}'),
            payload: typeId == null || from == null
                ? null
                : {
                    'leave_type_id': typeId,
                    'from_date': apiDate(from!),
                    'to_date': apiDate(to ?? from!),
                    'from_session': fromSession,
                    'to_session': (to == null || apiDate(to!) == apiDate(from!)) ? fromSession : toSession,
                    'has_attachment': file != null,
                    'user_id': userId,
                  },
            onResult: (p) => preview = p,
          ),
        ]),
        DetailSection(
          'Supporting Document',
          children: [
            if (lt?['requires_document_after_days'] != null)
              HintText('Required for ${lt?['name']} longer than ${daysTxt(lt?['requires_document_after_days'])} (e.g. a medical certificate).'),
            if (fileName != null) Text(fileName!, style: const TextStyle(fontSize: 13.5)),
            Wrap(spacing: 8, children: [
              LinkAction('Take photo', () async {
                final f = await Files.takePhoto();
                if (f != null) setS(() { file = f; fileName = f.filename; });
              }),
              LinkAction('Choose file', () async {
                final f = await Files.pickFile(extensions: ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx']);
                if (f != null) setS(() { file = f; fileName = f.filename; });
              }),
              if (file != null) LinkAction('Remove', () => setS(() { file = null; fileName = null; }), color: Brand.danger),
            ]),
          ],
        ),
      ];
    },
    onSave: () async {
      final missing = <String>[];
      if (typeId == null) missing.add('Pick a leave type.');
      if (from == null) missing.add('Pick the first day of leave.');
      if (reason.text.trim().isEmpty) missing.add('Give a short reason for the leave.');
      if (missing.isNotEmpty) throw missing.join(' ');
      final errs = preview?['errors'] is List ? (preview!['errors'] as List).map(str).toList() : <String>[];
      if (errs.isNotEmpty) throw errs.join(' ');
      final f = from!;
      final t = to ?? f;
      final sameDay = apiDate(t) == apiDate(f);
      final fields = <String, dynamic>{
        'leave_type_id': '$typeId',
        'from_date': apiDate(f),
        'to_date': apiDate(t),
        'from_session': fromSession,
        'to_session': sameDay ? fromSession : toSession,
        'reason': reason.text.trim(),
        'user_id': ?userId?.toString(),
      };
      final c = contact.text.trim();
      if (c.isNotEmpty) fields['contact_during_leave'] = c;
      final form = FormData.fromMap(fields);
      if (file != null) form.files.add(MapEntry('attachment', file!));
      final res = mapOf(await Api.post('/hr/leave/requests', data: form));
      requestNo = str(res['request_no']);
    },
  );
  return saved ? requestNo : null;
}

/// Live preview from POST /hr/leave/requests/preview.
class _LeavePreview extends StatefulWidget {
  const _LeavePreview({super.key, required this.payload, required this.onResult});
  final Json? payload;
  final ValueChanged<Json?> onResult;

  @override
  State<_LeavePreview> createState() => _LeavePreviewState();
}

class _LeavePreviewState extends State<_LeavePreview> {
  Json? _p;
  String? _error;
  bool _loading = false;
  Timer? _t;

  @override
  void initState() {
    super.initState();
    widget.onResult(null);
    if (widget.payload != null) {
      _loading = true;
      _t = Timer(const Duration(milliseconds: 300), _load);
    }
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = mapOf(await Api.post('/hr/leave/requests/preview', data: widget.payload));
      widget.onResult(d);
      if (mounted) setState(() { _p = d; _loading = false; });
    } catch (e) {
      widget.onResult(null);
      if (mounted) setState(() { _error = ApiClient.describe(e); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.payload == null) {
      return const HintText('Pick the dates to see the day count, the balance and the approver.');
    }
    if (_loading) return const HintText('Working out the days…');
    if (_error != null) return ErrorBanner(_error!);
    final p = _p ?? const <String, dynamic>{};
    final skipped = rowsOf(p['breakdown']).where((d) => d['kind'] != 'working' && toNum(d['portion']) == 0).toList();
    final errors = p['errors'] is List ? (p['errors'] as List).map(str).toList() : <String>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(daysTxt(p['days']), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Brand.heading)),
        if (p['balance_checked'] == true && p['balance_available'] != null)
          Text('Balance ${daysTxt(p['balance_available'])}${toNum(p['balance_pending']) > 0 ? ' (${daysTxt(p['balance_pending'])} in pending requests)' : ''}'),
        if (p['balance_checked'] != true) const Text('No balance needed (unpaid leave)'),
        Text('Approver: ${str(p['approver_name']).isEmpty ? 'HR (no reporting manager set)' : p['approver_name']}',
            style: const TextStyle(color: Brand.muted)),
        if (skipped.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 4, children: [
            const Text('Not counted:', style: TextStyle(fontSize: 12, color: Brand.muted)),
            for (final d in skipped)
              HrPill('${fmtDate(d['date'])} ${d['kind'] == 'holiday' ? str(d['holiday_name']) : 'weekly off'}',
                  d['kind'] == 'holiday' ? '#0369A1' : '#475569'),
          ]),
        ],
        if (errors.isNotEmpty) ...[
          const SizedBox(height: 8),
          for (final e in errors) Text('• $e', style: const TextStyle(color: Brand.danger, fontSize: 13)),
        ],
      ],
    );
  }
}

/// My HR › Leave.
class MyLeavePage extends StatefulWidget {
  const MyLeavePage({super.key});

  @override
  State<MyLeavePage> createState() => _MyLeavePageState();
}

class _MyLeavePageState extends State<MyLeavePage> {
  int _year = DateTime.now().year;
  String _status = '';
  final _list = GlobalKey<ApiListViewState>();
  List<Json> _types = [];
  List<Json> _balances = [];
  String? _notice;
  Object? _balError;

  @override
  void initState() {
    super.initState();
    _loadBalances();
  }

  Future<void> _loadBalances() async {
    try {
      final t = (await Api.list('/hr/leave/types')).rows;
      final b = (await Api.list('/hr/leave/balances/me', query: {'year': _year})).rows;
      if (mounted) setState(() { _types = t; _balances = b; _balError = null; });
    } catch (e) {
      if (mounted) setState(() => _balError = e);
    }
  }

  void _reload() {
    _loadBalances();
    _list.currentState?.reload();
  }

  Future<void> _apply() async {
    final no = await showLeaveApplyForm(context, types: _types);
    if (no != null && mounted) {
      setState(() => _notice = '$no was submitted and sent to your approver.');
      _reload();
    }
  }

  Future<void> _cancel(Json r) async {
    final yes = await confirmDialog(context,
        title: 'Cancel this leave?',
        message: '${r['request_no']} (${fmtDate(r['from_date'])} to ${fmtDate(r['to_date'])}, ${numTxt(r['days'])} days) will be cancelled.'
            '${r['status'] == 'approved' ? ' The days go back to your balance and your approver is told.' : ''}',
        confirmLabel: 'Cancel leave',
        danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.post('/hr/leave/requests/${r['id']}/cancel', data: {'remarks': null}));
    if (ok && mounted) {
      setState(() => _notice = '${r['request_no']} was cancelled${r['status'] == 'approved' ? ' and the days were returned to your balance' : ''}.');
      _reload();
    }
  }

  Widget _balanceTiles() {
    if (_balError != null) return padded(ErrorBanner(ApiClient.describe(_balError!)));
    final shown = [
      for (final t in _types)
        if (_balances.any((b) => b['leave_type_id'] == t['id']) || t['is_paid'] == false)
          (t, _balances.where((b) => b['leave_type_id'] == t['id']).firstOrNull),
    ];
    if (shown.isEmpty) {
      return padded(HintText(
          "No leave has been allotted to you for $_year yet. HR allots the year's leave — ask HR if you expected a balance."));
    }
    return TileGrid([
      for (final (t, b) in shown)
        t['is_paid'] == false
            ? StatTile(label: '${t['name']} · ${t['code']}', value: numTxt(b?['used']), sub: 'days taken · unpaid, no balance needed')
            : StatTile(
                label: '${t['name']} · ${t['code']}',
                value: numTxt(b?['available']),
                sub: 'available · ${numTxt(b?['used'])} used${toNum(b?['pending']) > 0 ? ' · ${numTxt(b?['pending'])} pending' : ''}\n'
                    '${toNum(b?['opening']) > 0 ? '${numTxt(b?['opening'])} carried + ' : ''}${numTxt(b?['allotted'])} allotted'
                    '${toNum(b?['adjusted']) != 0 ? ' ${toNum(b?['adjusted']) > 0 ? '+' : ''}${numTxt(b?['adjusted'])} adjusted' : ''}',
              ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = Perm.can('hr', 'me', 'create');
    return ApiListView(
      key: _list,
      load: (page, _) => Api.list('/hr/leave/requests/me', query: {'year': _year, 'status': _status}),
      emptyText: 'No leave requests in $_year${canCreate ? ' — use + Apply Leave to request time off' : ''}.',
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PageHeader('My Leave',
              subtitle: 'Apply for leave, see your balances and track your requests.',
              actions: [if (canCreate) headerButton('Apply Leave', _apply)]),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: AppSelect<int>(
              label: 'Year',
              value: _year,
              options: yearOptions(),
              clearable: false,
              onChanged: (o) {
                setState(() => _year = o?.value ?? _year);
                _reload();
              },
            ),
          ),
          const SizedBox(height: 8),
          if (_notice != null) padded(NoticeBanner(_notice!)),
          _balanceTiles(),
          const BlockTitle('My requests'),
          ChipRow([
            CountChip('All statuses', null, selected: _status.isEmpty, onTap: () {
              setState(() => _status = '');
              _list.currentState?.reload();
            }),
            for (final e in requestStatusLabels.entries)
              CountChip(e.value, null, selected: _status == e.key, onTap: () {
                setState(() => _status = _status == e.key ? '' : e.key);
                _list.currentState?.reload();
              }),
          ]),
        ],
      ),
      itemBuilder: (ctx, r, reload) => RecordCard(
        code: str(r['request_no']),
        title: str(r['leave_type_name']),
        subtitle: str(r['reason']),
        trailing: statusPill(r['status'], requestStatusLabels, requestStatusHex),
        meta: [
          ('Dates', leaveDates(r)),
          ('Days', numTxt(r['days'])),
          ('Approver / decision',
              '${r['status'] == 'pending' ? (str(r['approver_name']).isEmpty ? 'HR' : r['approver_name']) : (str(r['decided_by_name']).isEmpty ? '—' : r['decided_by_name'])}'
              '${str(r['decision_remarks']).isEmpty ? '' : ' “${r['decision_remarks']}”'}'),
        ],
        onTap: () => _actions(r),
      ),
    );
  }

  void _actions(Json r) {
    final acts = <Widget>[
      if (str(r['attachment_path']).isNotEmpty)
        LinkAction('Attachment', () => openApiFile(context, '/hr/leave/requests/${r['id']}/attachment', '${r['request_no']}_attachment')),
      if (r['can_cancel'] == true) LinkAction('Cancel', () { Navigator.pop(context); _cancel(r); }, color: Brand.danger),
    ];
    if (acts.isEmpty) return;
    showModalBottomSheet<void>(
      context: context,
      builder: (_) => SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: actionRow(acts))),
    );
  }
}