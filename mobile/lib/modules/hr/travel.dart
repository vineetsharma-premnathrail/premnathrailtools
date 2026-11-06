import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'claims.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/me/travel/page.tsx, app/dashboard/hr/travel/page.tsx,
// components/hr/admin/TravelDialogs.tsx

/// New / edit travel request. Returns the saved request or null.
Future<Json?> showTravelForm(BuildContext context, {Json? request}) async {
  final r = request;
  final purpose = TextEditingController(text: str(r?['purpose']));
  final fromCity = TextEditingController(text: str(r?['from_city']));
  final toCity = TextEditingController(text: str(r?['to_city']));
  DateTime? depart = dateOf(r?['depart_date']);
  DateTime? ret = dateOf(r?['return_date']);
  var mode = str(r?['travel_mode']).isEmpty ? 'train' : str(r?['travel_mode']);
  var stay = r?['accommodation_required'] == true;
  final cost = TextEditingController(text: r?['estimated_cost'] == null ? '' : numTxt(r?['estimated_cost']));
  final advance = TextEditingController(text: toNum(r?['advance_required']) > 0 ? numTxt(r?['advance_required']) : '');
  final project = TextEditingController(text: str(r?['project_reference']));
  Json? saved;
  final ok = await showFormSheet(
    context,
    title: r != null ? 'Edit ${r['request_no']}' : 'New travel request',
    saveLabel: r != null ? 'Save changes' : 'Submit request',
    builder: (ctx, setS) => [
      HintText(r != null
          ? '${r['from_city']} → ${r['to_city']} — changes go to the approver.'
          : 'Goes to your reporting manager for approval (or to HR if you have no manager set).'),
      AppTextField(label: 'Purpose', controller: purpose, required: true, maxLines: 2, hint: 'Customer site visit, vendor audit, training…'),
      AppTextField(label: 'From', controller: fromCity, required: true),
      AppTextField(label: 'To', controller: toCity, required: true),
      DateField(label: 'Depart', required: true, value: depart, onChanged: (d) => setS(() => depart = d)),
      DateField(label: 'Return', value: ret, onChanged: (d) => setS(() => ret = d)),
      AppSelect<String>(
          label: 'Mode', value: mode, clearable: false, options: optionsOf(travelModeLabels), onChanged: (o) => setS(() => mode = o?.value ?? mode)),
      CheckField(label: 'Accommodation required', value: stay, onChanged: (v) => setS(() => stay = v)),
      AppTextField(label: 'Estimated cost (₹)', controller: cost, keyboardType: AppTextField.number),
      AppTextField(label: 'Advance needed (₹)', controller: advance, keyboardType: AppTextField.number, hint: '0'),
      AppTextField(label: 'Project / reference', controller: project),
    ],
    onSave: () async {
      final p = <String>[];
      if (purpose.text.trim().isEmpty) p.add('Describe the purpose of the trip.');
      if (fromCity.text.trim().isEmpty) p.add('Enter the city you are travelling from.');
      if (toCity.text.trim().isEmpty) p.add('Enter the destination city.');
      if (depart == null) p.add('Pick the departure date.');
      if (depart != null && ret != null && ret!.isBefore(depart!)) p.add('Return date cannot be before the departure date.');
      if (p.isNotEmpty) throw p.join(' ');
      final payload = {
        'purpose': purpose.text.trim(), 'from_city': fromCity.text.trim(), 'to_city': toCity.text.trim(),
        'depart_date': apiDate(depart!), 'return_date': isoOrNull(ret), 'travel_mode': mode, 'accommodation_required': stay,
        'advance_required': advance.text.trim().isEmpty ? '0' : advance.text.trim(),
        'estimated_cost': textOrNull(cost.text), 'project_reference': textOrNull(project.text),
      };
      saved = mapOf(r != null ? await Api.patch('/hr/travel/${r['id']}', data: payload) : await Api.post('/hr/travel', data: payload));
    },
  );
  return ok ? saved : null;
}

String travelDates(Json t) => '${fmtDate(t['depart_date'])}${str(t['return_date']).isEmpty ? '' : ' – ${fmtDate(t['return_date'])}'}';

/// My HR › Travel.
class MyTravelPage extends StatefulWidget {
  const MyTravelPage({super.key, required this.openClaims});
  final VoidCallback openClaims;

  @override
  State<MyTravelPage> createState() => _MyTravelPageState();
}

class _MyTravelPageState extends State<MyTravelPage> {
  final _list = GlobalKey<ApiListViewState>();
  String _status = '';
  String? _notice;

  Future<void> _form([Json? t]) async {
    final saved = await showTravelForm(context, request: t);
    if (saved != null && mounted) {
      setState(() => _notice = t != null
          ? '${saved['request_no']} updated.'
          : '${saved['request_no']} submitted${str(saved['approver_name']).isNotEmpty ? ' to ${saved['approver_name']}' : ' to HR'} for approval.');
      _list.currentState?.reload();
    }
  }

  Future<void> _cancel(Json t) async {
    final remarks = await promptDialog(context,
        title: 'Cancel ${t['request_no']}?',
        message: t['status'] == 'approved'
            ? 'This trip is already approved; your approver will be told it is cancelled.'
            : 'The request will be withdrawn.',
        label: 'Reason (optional)',
        required: false,
        confirmLabel: 'Cancel request');
    if (remarks == null || !mounted) return;
    final ok = await runAction(context, () => Api.post('/hr/travel/${t['id']}/cancel', data: {'remarks': textOrNull(remarks)}));
    if (ok && mounted) {
      setState(() => _notice = '${t['request_no']} cancelled.');
      _list.currentState?.reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = Perm.can('hr', 'me', 'create');
    return ApiListView(
      key: _list,
      load: (_, _) => Api.list('/hr/travel/mine', query: {'status': _status}),
      emptyText: _status.isNotEmpty ? 'No travel requests with this status.' : 'You have not raised any travel requests yet.',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        PageHeader('My Travel',
            subtitle: 'Request approval for business trips. After the trip, claim your expenses under Expense Claims and link them to the trip.',
            actions: [if (canCreate) headerButton('New Travel Request', () => _form())]),
        if (_notice != null) padded(NoticeBanner(_notice!)),
        ChipRow([
          CountChip('All statuses', null, selected: _status.isEmpty, onTap: () { setState(() => _status = ''); _list.currentState?.reload(); }),
          for (final e in travelStatusLabels.entries)
            CountChip(e.value, null, selected: _status == e.key, onTap: () {
              setState(() => _status = _status == e.key ? '' : e.key);
              _list.currentState?.reload();
            }),
        ]),
      ]),
      itemBuilder: (ctx, t, reload) => RecordCard(
        code: str(t['request_no']),
        title: '${t['from_city']} → ${t['to_city']}',
        subtitle: str(t['purpose']),
        trailing: statusPill(t['status'], travelStatusLabels, travelStatusHex),
        meta: [
          ('Dates', travelDates(t)),
          ('Mode', labelOf(travelModeLabels, t['travel_mode'])),
          ('Est. cost', '${fmtMoney(t['estimated_cost'])}${toNum(t['advance_required']) > 0 ? ' · Advance ${fmtMoney(t['advance_required'])}' : ''}'),
          ('Approver', '${str(t['decided_by_name']).isNotEmpty ? t['decided_by_name'] : str(t['approver_name']).isNotEmpty ? t['approver_name'] : (t['status'] == 'pending' ? 'HR' : '—')}'
              '${str(t['decision_remarks']).isEmpty ? '' : ' “${t['decision_remarks']}”'}'),
        ],
        onTap: () {
          final acts = <Widget>[
            if (t['can_edit'] == true) LinkAction('Edit', () { Navigator.pop(context); _form(t); }),
            if (t['status'] == 'approved' || t['status'] == 'completed')
              LinkAction('Claim expenses', () { Navigator.pop(context); widget.openClaims(); }),
            if (t['can_cancel'] == true) LinkAction('Cancel', () { Navigator.pop(context); _cancel(t); }, color: Brand.danger),
          ];
          if (acts.isEmpty) return;
          showModalBottomSheet<void>(
              context: context, builder: (_) => SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: actionRow(acts))));
        },
      ),
    );
  }
}

/// HR › Travel & Claims (every employee's trips and claims).
class HrTravelPage extends StatefulWidget {
  const HrTravelPage({super.key});

  @override
  State<HrTravelPage> createState() => _HrTravelPageState();
}

class _HrTravelPageState extends State<HrTravelPage> {
  int _tab = 0;
  final _list = GlobalKey<ApiListViewState>();
  String _travelStatus = '';
  String _claimStatus = '';
  DateTime? _from;
  DateTime? _to;
  String? _notice;
  int _rev = 0;
  List<Json> _allClaims = [];

  Map<String, dynamic> get _common => {'date_from': isoOrNull(_from), 'date_to': isoOrNull(_to)};

  Future<void> _act(String kind, Json t) async {
    final remarks = await promptDialog(context,
        title: '${kind == 'approve' ? 'Approve' : kind == 'reject' ? 'Reject' : 'Mark completed —'} ${t['request_no']}?',
        message: kind == 'reject'
            ? "${t['user_name']}'s trip ${t['from_city']} → ${t['to_city']}. Say why (required) so they can re-plan."
            : kind == 'approve'
                ? "${t['user_name']}'s trip ${t['from_city']} → ${t['to_city']} on ${fmtDate(t['depart_date'])}."
                : 'Closes the trip. The employee can still link it to an expense claim.',
        label: kind == 'reject' ? 'Reason for rejection' : 'Remarks (optional)',
        required: kind == 'reject',
        confirmLabel: kind == 'approve' ? 'Approve' : kind == 'reject' ? 'Reject' : 'Mark completed');
    if (remarks == null || !mounted) return;
    final ok = await runAction(context, () => Api.post('/hr/travel/${t['id']}/$kind', data: {'remarks': textOrNull(remarks)}));
    if (ok && mounted) {
      setState(() {
        _notice = '${t['request_no']} ${kind == 'approve' ? 'approved' : kind == 'reject' ? 'rejected' : 'marked completed'}.';
        _rev++;
      });
    }
  }

  Widget _filters() => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: Row(children: [
          Expanded(child: DateField(label: 'From', value: _from, onChanged: (d) { setState(() => _from = d); _list.currentState?.reload(); })),
          const SizedBox(width: 8),
          Expanded(child: DateField(label: 'To', value: _to, onChanged: (d) { setState(() => _to = d); _list.currentState?.reload(); })),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final header = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const PageHeader('Travel & Claims',
          subtitle: "Every employee's travel requests and expense claims. Approvals for your own reports also appear under Approvals."),
      if (_notice != null) padded(NoticeBanner(_notice!)),
      SubTabs(labels: const ['Travel requests', 'Expense claims'], index: _tab, onChanged: (i) => setState(() => _tab = i)),
      _filters(),
    ]);
    if (_tab == 0) {
      return ApiListView(
        key: ValueKey('travel_${_travelStatus}_${_from}_${_to}_$_rev'),
        searchHint: 'Search no., employee, city, purpose…',
        load: (_, q) => Api.list('/hr/travel', query: {..._common, 'search': q, 'status': _travelStatus}),
        emptyText: 'No travel requests match these filters.',
        header: Column(children: [
          header,
          ChipRow([
            CountChip('All statuses', null, selected: _travelStatus.isEmpty, onTap: () => setState(() => _travelStatus = '')),
            for (final e in travelStatusLabels.entries)
              CountChip(e.value, null, selected: _travelStatus == e.key, onTap: () => setState(() => _travelStatus = _travelStatus == e.key ? '' : e.key)),
          ]),
        ]),
        itemBuilder: (ctx, t, reload) => RecordCard(
          code: str(t['request_no']),
          title: '${t['user_name']} · ${t['from_city']} → ${t['to_city']}',
          subtitle: str(t['purpose']),
          trailing: statusPill(t['status'], travelStatusLabels, travelStatusHex),
          meta: [
            ('Dates', travelDates(t)),
            ('Mode', labelOf(travelModeLabels, t['travel_mode'])),
            ('Est. / Advance', '${fmtMoney(t['estimated_cost'])} / ${fmtMoney(t['advance_required'])}'),
            ('Approver', str(t['decided_by_name']).isNotEmpty ? str(t['decided_by_name']) : (str(t['approver_name']).isEmpty ? 'HR' : str(t['approver_name']))),
          ],
          onTap: () {
            final acts = <Widget>[
              if (t['can_decide'] == true) LinkAction('Approve', () { Navigator.pop(context); _act('approve', t); }),
              if (t['can_decide'] == true) LinkAction('Reject', () { Navigator.pop(context); _act('reject', t); }, color: Brand.danger),
              if (t['status'] == 'approved' && Perm.canFeature('hr', 'travel', 'complete_trip', 'edit'))
                LinkAction('Mark completed', () { Navigator.pop(context); _act('complete', t); }),
            ];
            if (acts.isEmpty) return;
            showModalBottomSheet<void>(
                context: context, builder: (_) => SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: actionRow(acts))));
          },
        ),
      );
    }
    double sum(String s) => _allClaims.where((c) => c['status'] == s).fold(0.0, (a, c) => a + toNum(c['total_amount']));
    return ApiListView(
      key: _list,
      searchHint: 'Search no., employee, title, payment ref…',
      load: (_, q) async {
        final page = await Api.list('/hr/expenses', query: {..._common, 'search': q});
        _allClaims = page.rows;
        if (mounted) setState(() {});
        return ApiPage(_claimStatus.isEmpty ? page.rows : page.rows.where((c) => c['status'] == _claimStatus).toList());
      },
      emptyText: 'No expense claims match these filters.',
      header: Column(children: [
        header,
        TileGrid([
          StatTile(label: 'Awaiting approval', value: fmtMoney(sum('submitted')), color: hexColor('#F59E0B'),
              selected: _claimStatus == 'submitted', onTap: () { setState(() => _claimStatus = _claimStatus == 'submitted' ? '' : 'submitted'); _list.currentState?.reload(); }),
          StatTile(label: 'Approved — to pay', value: fmtMoney(sum('approved')), color: hexColor('#16A34A'),
              selected: _claimStatus == 'approved', onTap: () { setState(() => _claimStatus = _claimStatus == 'approved' ? '' : 'approved'); _list.currentState?.reload(); }),
          StatTile(label: 'Paid', value: fmtMoney(sum('paid')), color: hexColor('#2563EB'),
              selected: _claimStatus == 'paid', onTap: () { setState(() => _claimStatus = _claimStatus == 'paid' ? '' : 'paid'); _list.currentState?.reload(); }),
        ]),
      ]),
      itemBuilder: (ctx, c, reload) => claimCard(context, c, showEmployee: true, onChanged: reload),
    );
  }
}

/// Card used by My Expense Claims and HR › Travel & Claims.
Widget claimCard(BuildContext context, Json c, {bool showEmployee = false, VoidCallback? onChanged}) => RecordCard(
      code: str(c['claim_no']),
      title: showEmployee ? '${c['user_name']} · ${c['title']}' : str(c['title']),
      subtitle: c['status'] == 'rejected' && str(c['decision_remarks']).isNotEmpty ? '“${c['decision_remarks']}”' : null,
      trailing: statusPill(c['status'], claimStatusLabels, claimStatusHex),
      meta: [
        ('Date', fmtDate(c['claim_date'])),
        ('Trip', str(c['travel_request_no']).isEmpty ? '—' : '${c['travel_request_no']} ${str(c['travel_route'])}'),
        ('Lines', numTxt(c['item_count'])),
        ('Amount', fmtMoney(c['total_amount'])),
        if (c['status'] == 'paid' && str(c['paid_on']).isNotEmpty) ('Paid on', fmtDate(c['paid_on'])),
      ],
      onTap: () async {
        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ClaimDetailScreen(claimId: asInt(c['id']) ?? 0)));
        onChanged?.call();
      },
    );

/// Wrapper so My HR can open the claim list from Travel.
class SubPageLauncher extends StatelessWidget {
  const SubPageLauncher({super.key, required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => SubPage(title: title, body: child);
}