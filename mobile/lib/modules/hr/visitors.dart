import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/visitors/page.tsx + components/hr/admin/VisitorDialogs.tsx

String _time(Object? iso) {
  final d = parseDate(iso);
  return d == null ? '—' : DateFormat('h:mm a').format(d);
}

/// IST wall-clock date + time → ISO string the backend stores.
String? _istIso(DateTime? date, String? time) =>
    date == null ? null : '${apiDate(date)}T${(time == null || time.isEmpty) ? '09:00' : time}:00+05:30';

Future<List<Option<int>>> _branches() async =>
    [for (final b in (await Api.list('/hr/assets/lookups/branches')).rows) Option(asInt(b['id']) ?? 0, str(b['name']))];

/// Register / pre-register (new) or edit a visit. Returns the saved visit.
Future<Json?> showVisitorForm(BuildContext context, {Json? visit, required bool isHr}) async {
  List<Option<int>> branches = [];
  try {
    branches = await _branches();
  } catch (_) {}
  if (!context.mounted) return null;
  final v = visit;
  final expectedAt = parseDate(v?['expected_at']);
  final name = TextEditingController(text: str(v?['visitor_name']));
  final company = TextEditingController(text: str(v?['visitor_company']));
  final phone = TextEditingController(text: str(v?['visitor_phone']));
  final email = TextEditingController(text: str(v?['visitor_email']));
  final persons = TextEditingController(text: v == null ? '1' : numTxt(v['number_of_persons'] ?? 1));
  final purpose = TextEditingController(text: str(v?['purpose']));
  int? host = asInt(v?['host_user_id']) ?? (isHr ? null : myUserId);
  String? hostName = textOrNull(str(v?['host_name']));
  int? branch = asInt(v?['branch_id']);
  DateTime? expDate = v == null ? DateTime.now() : expectedAt;
  String? expTime = expectedAt == null ? null : DateFormat('HH:mm').format(expectedAt);
  var walkIn = false;
  final badge = TextEditingController(text: str(v?['badge_no']));
  String? idType = textOrNull(str(v?['id_proof_type']));
  final idLast4 = TextEditingController(text: str(v?['id_proof_last4']));
  final vehicle = TextEditingController(text: str(v?['vehicle_no']));
  final items = TextEditingController(text: str(v?['items_carried']));
  final remarks = TextEditingController(text: str(v?['remarks']));
  final expected = v == null || v['status'] == 'expected';
  Json? saved;
  final ok = await showFormSheet(context,
      title: v != null ? 'Edit visit ${v['visit_no']}' : (isHr ? 'Register visitor' : 'Pre-register a visitor'),
      saveLabel: v != null ? 'Save changes' : 'Register visitor',
      builder: (ctx, setS) => [
            HintText(v != null
                ? (isHr ? 'Correct the entry. Changing the host notifies the new host.' : 'You can change the details until reception checks the visitor in.')
                : (isHr
                    ? 'Pre-register an expected visitor, or tick “Walk-in” to check them in right away. The host is notified on check-in.'
                    : 'Reception will see this visitor on the gate board and notify you when they check in.')),
            AppTextField(label: 'Visitor name', controller: name, required: true),
            AppTextField(label: 'Company', controller: company),
            AppTextField(label: 'Phone', controller: phone, keyboardType: TextInputType.phone),
            AppTextField(label: 'Email', controller: email, keyboardType: TextInputType.emailAddress),
            AppTextField(label: 'Persons', controller: persons, keyboardType: TextInputType.number),
            AppTextField(label: 'Purpose of visit', controller: purpose, maxLines: 2),
            if (isHr)
              AppSelect<int>(label: 'Host (meeting)', required: true, value: host, valueLabel: hostName, loadOptions: directoryOptions,
                  onChanged: (o) => setS(() { host = o?.value; hostName = o?.label; })),
            AppSelect<int>(label: 'Plant', value: branch, options: branches, onChanged: (o) => setS(() => branch = o?.value)),
            if (isHr && v == null) CheckField(label: 'Walk-in — check the visitor in now', value: walkIn, onChanged: (x) => setS(() => walkIn = x)),
            if (expected && !walkIn) ...[
              DateField(label: 'Expected date', value: expDate, onChanged: (d) => setS(() => expDate = d)),
              TimeField(label: 'Time', value: expTime, onChanged: (t) => setS(() => expTime = t)),
            ],
            if (isHr && (walkIn || v != null)) AppTextField(label: 'Badge no.', controller: badge),
            AppSelect<String>(label: 'ID proof', value: idType, options: [for (final t in idProofTypes) Option(t, t)], onChanged: (o) => setS(() => idType = o?.value)),
            AppTextField(label: 'ID last 4', controller: idLast4),
            AppTextField(label: 'Vehicle no.', controller: vehicle),
            AppTextField(label: 'Items carried', controller: items),
            AppTextField(label: 'Remarks', controller: remarks, maxLines: 2),
          ],
      onSave: () async {
        final p = <String>[];
        if (name.text.trim().isEmpty) p.add("Enter the visitor's name.");
        if (isHr && host == null) p.add('Pick the employee the visitor is meeting (host).');
        final n = int.tryParse(persons.text.trim());
        if (n == null || n < 1) p.add('Number of persons must be a whole number, 1 or more.');
        if (idLast4.text.trim().isNotEmpty && idLast4.text.trim().length != 4) {
          p.add('Enter exactly the last 4 characters of the ID proof, or leave it blank.');
        }
        if (p.isNotEmpty) throw p.join(' ');
        if (v == null) {
          saved = mapOf(await Api.post('/hr/visitors', data: {
            'visitor_name': name.text.trim(), 'visitor_company': textOrNull(company.text), 'visitor_phone': textOrNull(phone.text),
            'visitor_email': textOrNull(email.text), 'purpose': textOrNull(purpose.text), 'host_user_id': isHr ? host : myUserId,
            'branch_id': branch, 'expected_at': walkIn ? null : _istIso(expDate, expTime), 'number_of_persons': n,
            'vehicle_no': textOrNull(vehicle.text), 'id_proof_type': idType, 'id_proof_last4': textOrNull(idLast4.text),
            'items_carried': textOrNull(items.text), 'remarks': textOrNull(remarks.text), 'check_in_now': isHr && walkIn,
            'badge_no': textOrNull(badge.text),
          }));
        } else {
          final payload = <String, dynamic>{
            'visitor_name': name.text.trim(), 'visitor_company': textOrNull(company.text), 'visitor_phone': textOrNull(phone.text),
            'visitor_email': textOrNull(email.text), 'purpose': textOrNull(purpose.text), 'number_of_persons': n,
            'vehicle_no': textOrNull(vehicle.text), 'id_proof_type': idType, 'id_proof_last4': textOrNull(idLast4.text),
            'items_carried': textOrNull(items.text), 'remarks': textOrNull(remarks.text),
            'branch_id': ?branch,
            if (isHr) 'badge_no': textOrNull(badge.text),
            if (isHr && host != asInt(v['host_user_id'])) 'host_user_id': host,
            if (expected) 'expected_at': _istIso(expDate, expTime),
          };
          saved = mapOf(await Api.patch('/hr/visitors/${v['id']}', data: payload));
        }
      });
  return ok ? saved : null;
}

/// HR › Visitors (gate board + all visits) or, for everyone else, My Visitors.
class VisitorsPage extends StatefulWidget {
  const VisitorsPage({super.key});

  @override
  State<VisitorsPage> createState() => _VisitorsPageState();
}

class _VisitorsPageState extends State<VisitorsPage> {
  late final bool _isHr = hrStaffFor('visitors');
  int _tab = 0;
  int _rev = 0;
  DateTime _boardDate = DateTime.now();
  int? _boardBranch;
  String _status = '';
  DateTime? _from;
  DateTime? _to;
  int? _host;
  String? _hostName;
  List<Option<int>> _branchOpts = [];
  String? _notice;

  bool get _hrCreate => _isHr && Perm.can('hr', 'visitors', 'create');
  bool get _hrEdit => _isHr && Perm.can('hr', 'visitors', 'edit');
  bool get _gate => _isHr && Perm.canFeature('hr', 'visitors', 'gate_desk', 'edit');

  @override
  void initState() {
    super.initState();
    _branches().then((b) { if (mounted) setState(() => _branchOpts = b); }).catchError((_) {});
  }

  bool _canEdit(Json v) =>
      (_hrEdit && v['status'] != 'cancelled') ||
      (Perm.can('hr', 'me', 'edit') && v['status'] == 'expected' && (v['host_user_id'] == myUserId || v['created_by_id'] == myUserId));
  bool _canCancel(Json v) =>
      v['status'] == 'expected' &&
      (_hrEdit || (Perm.can('hr', 'me', 'edit') && (v['host_user_id'] == myUserId || v['created_by_id'] == myUserId)));

  void _refresh([String? msg]) => setState(() { _rev++; if (msg != null) _notice = msg; });

  Future<void> _register() async {
    final v = await showVisitorForm(context, isHr: _hrCreate);
    if (v != null && mounted) {
      _refresh(v['status'] == 'checked_in'
          ? '${v['visitor_name']} checked in (${v['visit_no']}). ${v['host_name']} has been notified.'
          : '${v['visitor_name']} registered as ${v['visit_no']}.');
    }
  }

  Future<void> _checkIn(Json v) async {
    final badge = TextEditingController(text: str(v['badge_no']));
    String? idType = textOrNull(str(v['id_proof_type']));
    final last4 = TextEditingController(text: str(v['id_proof_last4']));
    final vehicle = TextEditingController(text: str(v['vehicle_no']));
    final items = TextEditingController(text: str(v['items_carried']));
    Json? res;
    final ok = await showFormSheet(context,
        title: 'Check in ${v['visitor_name']}',
        saveLabel: 'Check in',
        builder: (ctx, setS) => [
              HintText('Meeting ${str(v['host_name']).isEmpty ? 'host' : v['host_name']}${str(v['visitor_company']).isEmpty ? '' : ' · ${v['visitor_company']}'}. The host gets a notification.'),
              AppTextField(label: 'Badge no.', controller: badge),
              AppSelect<String>(label: 'ID proof', value: idType, options: [for (final t in idProofTypes) Option(t, t)], onChanged: (o) => setS(() => idType = o?.value)),
              AppTextField(label: 'ID last 4', controller: last4),
              AppTextField(label: 'Vehicle no.', controller: vehicle),
              AppTextField(label: 'Items carried', controller: items),
            ],
        onSave: () async {
          res = mapOf(await Api.post('/hr/visitors/${v['id']}/check-in', data: {
            'badge_no': badge.text.trim(), 'id_proof_type': idType ?? '', 'id_proof_last4': last4.text.trim(),
            'vehicle_no': vehicle.text.trim().toUpperCase(), 'items_carried': items.text.trim(),
          }));
        });
    if (ok && res != null && mounted) _refresh('${res!['visitor_name']} checked in. ${res!['host_name']} has been notified.');
  }

  Future<void> _pending(String kind, Json v) async {
    final remarks = await promptDialog(context,
        title: kind == 'cancel' ? 'Cancel visit by ${v['visitor_name']}?' : 'Check out ${v['visitor_name']}?',
        message: kind == 'cancel'
            ? 'The host will be told the visit is cancelled. Add a reason (optional).'
            : 'Records the exit time as now. Collect the badge before they leave.',
        label: kind == 'cancel' ? 'Reason (optional)' : 'Remarks (optional)',
        required: false,
        confirmLabel: kind == 'cancel' ? 'Cancel visit' : 'Check out');
    if (remarks == null || !mounted) return;
    final ok = await runAction(context,
        () => Api.post('/hr/visitors/${v['id']}/${kind == 'cancel' ? 'cancel' : 'check-out'}', data: {'remarks': textOrNull(remarks)}));
    if (ok && mounted) {
      _refresh(kind == 'cancel' ? 'Visit ${v['visit_no']} by ${v['visitor_name']} cancelled.' : '${v['visitor_name']} checked out.');
    }
  }

  void _menu(Json v) {
    final acts = <Widget>[
      if (_gate && v['status'] == 'expected') LinkAction('Check in', () { Navigator.pop(context); _checkIn(v); }),
      if (_gate && v['status'] == 'checked_in') LinkAction('Check out', () { Navigator.pop(context); _pending('checkout', v); }),
      if (_canEdit(v))
        LinkAction('Edit', () async {
          Navigator.pop(context);
          final r = await showVisitorForm(context, visit: v, isHr: _hrEdit);
          if (r != null && mounted) _refresh('Visit ${r['visit_no']} updated.');
        }),
      if (_canCancel(v)) LinkAction('Cancel', () { Navigator.pop(context); _pending('cancel', v); }, color: Brand.danger),
    ];
    if (acts.isEmpty) return;
    showModalBottomSheet<void>(context: context, builder: (_) => SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: actionRow(acts))));
  }

  Widget _card(Json v) {
    final st = str(v['status']);
    return RecordCard(
      code: str(v['visit_no']),
      title: '${v['visitor_name']}${toNum(v['number_of_persons']) > 1 ? ' +${toNum(v['number_of_persons']).toInt() - 1}' : ''}',
      subtitle: joinNonEmpty([v['visitor_company'], v['visitor_phone']]),
      trailing: statusPill(st, visitorStatusLabels, visitorStatusHex),
      meta: [
        ('Host', '${str(v['host_name']).isEmpty ? '—' : v['host_name']}${str(v['host_department']).isEmpty ? '' : ' · ${v['host_department']}'}'),
        if (str(v['purpose']).isNotEmpty) ('Purpose', str(v['purpose'])),
        if (st == 'expected') ('Expected', str(v['expected_at']).isEmpty ? 'Time not given' : fmtDateTime(v['expected_at'])),
        if (str(v['check_in_at']).isNotEmpty) ('In', fmtDateTime(v['check_in_at'])),
        if (str(v['check_out_at']).isNotEmpty) ('Out', _time(v['check_out_at'])),
        if (str(v['badge_no']).isNotEmpty || str(v['vehicle_no']).isNotEmpty) ('Badge / Vehicle', joinNonEmpty([v['badge_no'], v['vehicle_no']], ' / ')),
        if (str(v['branch_name']).isNotEmpty) ('Plant', str(v['branch_name'])),
      ],
      onTap: () => _menu(v),
    );
  }

  @override
  Widget build(BuildContext context) {
    final header = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      PageHeader(_isHr ? 'Visitors' : 'My Visitors',
          subtitle: _isHr
              ? 'Gate register — who is expected, who is inside right now, and who has left.'
              : 'Visitors you are hosting. Pre-register them so reception can check them in quickly.',
          actions: [
            if (_hrCreate || Perm.can('hr', 'me', 'create')) headerButton(_hrCreate ? 'Register Visitor' : 'Pre-register Visitor', _register),
          ]),
      if (_notice != null) padded(NoticeBanner(_notice!)),
      if (_isHr) SubTabs(labels: const ["Today's board", 'All visits'], index: _tab, onChanged: (i) => setState(() => _tab = i)),
    ]);

    if (_isHr && _tab == 0) {
      return ApiLoader<Json>(
        key: ValueKey('board_${_boardDate}_${_boardBranch}_$_rev'),
        load: () async => mapOf(await Api.get('/hr/visitors/board', query: {'date': apiDate(_boardDate), 'branch_id': _boardBranch})),
        builder: (ctx, b, reload) {
          Widget col(String title, String key, String hex) {
            final rows = rowsOf(b[key]);
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              BlockTitle(title, trailing: Text('${rows.length}', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: hexColor(hex)))),
              if (rows.isEmpty) padded(const HintText('None.')),
              for (final v in rows) _card(v),
            ]);
          }

          return ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            header,
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Column(children: [
                DateField(label: 'Date', required: true, value: _boardDate, onChanged: (d) { if (d != null) setState(() => _boardDate = d); }),
                const SizedBox(height: 8),
                AppSelect<int>(label: 'All plants', value: _boardBranch, options: _branchOpts, onChanged: (o) => setState(() => _boardBranch = o?.value)),
              ]),
            ),
            if (apiDate(_boardDate) != todayIso())
              Align(alignment: Alignment.centerLeft, child: Padding(padding: const EdgeInsets.only(left: 8), child: LinkAction('Back to today', () => setState(() => _boardDate = DateTime.now())))),
            col('Expected', 'expected', visitorStatusHex['expected']!),
            col('Inside now', 'inside', visitorStatusHex['checked_in']!),
            col('Checked out', 'checked_out', visitorStatusHex['checked_out']!),
          ]);
        },
      );
    }

    return ApiListView(
      key: ValueKey('visits_${_status}_${_from}_${_to}_${_host}_$_rev'),
      searchHint: _isHr ? 'Search name, company, phone, badge, vehicle…' : null,
      load: (_, q) => _isHr
          ? Api.list('/hr/visitors', query: {
              'status': _status, 'date_from': isoOrNull(_from), 'date_to': isoOrNull(_to), 'host_user_id': _host, 'search': q, 'limit': 1000,
            })
          : Api.list('/hr/visitors/mine', query: {'status': _status}),
      emptyText: _isHr ? 'No visits match these filters.' : 'You have no visitors yet. Use “+ Pre-register Visitor” before someone comes to meet you.',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        header,
        if (_isHr)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(children: [
              Row(children: [
                Expanded(child: DateField(label: 'From', value: _from, onChanged: (d) => setState(() => _from = d))),
                const SizedBox(width: 8),
                Expanded(child: DateField(label: 'To', value: _to, onChanged: (d) => setState(() => _to = d))),
              ]),
              const SizedBox(height: 8),
              AppSelect<int>(label: 'Any host', value: _host, valueLabel: _hostName, loadOptions: directoryOptions,
                  onChanged: (o) => setState(() { _host = o?.value; _hostName = o?.label; })),
            ]),
          ),
        ChipRow([
          CountChip('All statuses', null, selected: _status.isEmpty, onTap: () => setState(() => _status = '')),
          for (final e in visitorStatusLabels.entries)
            CountChip(e.value, null, selected: _status == e.key, onTap: () => setState(() => _status = _status == e.key ? '' : e.key)),
        ]),
      ]),
      itemBuilder: (ctx, v, reload) => _card(v),
    );
  }
}