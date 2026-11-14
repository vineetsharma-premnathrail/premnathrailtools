import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'employees.dart';
import 'hr_common.dart';
import 'lifecycle_detail.dart';

// Portal: app/dashboard/hr/page.tsx — HR Dashboard.

const _empStatusLabels = {'onboarding': 'Onboarding', 'probation': 'Probation', 'active': 'Active', 'notice': 'On notice', 'no_profile': 'No HR profile'};
const _empStatusHex = {'onboarding': '#0891B2', 'probation': '#D97706', 'active': '#16A34A', 'notice': '#DC2626', 'no_profile': '#78716C'};
const _attLabels = {
  'present': 'Present', 'absent': 'Absent', 'half_day': 'Half day', 'on_leave': 'On leave', 'holiday': 'Holiday',
  'weekly_off': 'Weekly off', 'on_duty': 'On duty', 'work_from_home': 'WFH', 'not_marked': 'Not marked',
};

String _daysLabel(Object? d) {
  final n = toNum(d).toInt();
  if (n < 0) return '${-n} day${n == -1 ? '' : 's'} overdue';
  if (n == 0) return 'Today';
  return 'in $n day${n == 1 ? '' : 's'}';
}

/// HR Dashboard; `goTo` switches to another HR tab by its label.
class HrDashboardPage extends StatefulWidget {
  const HrDashboardPage({super.key, required this.goTo});
  final void Function(String label) goTo;

  @override
  State<HrDashboardPage> createState() => _HrDashboardPageState();
}

class _HrDashboardPageState extends State<HrDashboardPage> {
  bool _more = false;

  Widget _bars(List<Json> rows, {Map<String, String>? labels, int max = 8}) {
    if (rows.isEmpty) return const HintText('No data yet.');
    final top = rows.map((r) => toNum(r['count'])).fold<num>(1, (a, b) => b > a ? b : a);
    final rest = rows.skip(max).fold<num>(0, (a, r) => a + toNum(r['count']));
    return Column(children: [
      for (final r in rows.take(max))
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(children: [
            SizedBox(width: 120, child: Text(labels?[str(r['label'])] ?? str(r['label']), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5))),
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: LinearProgressIndicator(value: toNum(r['count']) / top, minHeight: 8, color: Brand.primary, backgroundColor: const Color(0x0D000000)),
              ),
            ),
            SizedBox(width: 36, child: Text(numTxt(r['count']), textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w700))),
          ]),
        ),
      if (rest > 0) HintText('+ ${numTxt(rest)} in ${rows.length - max} more'),
    ]);
  }

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        load: () async => mapOf(await Api.get('/hr/dashboard')),
        builder: (ctx, d, reload) {
          final a = mapOf(d['approvals']);
          int t(String k) => toNum(mapOf(a[k])['total']).toInt();
          int h(String k) => toNum(mapOf(a[k])['awaiting_hr']).toInt();
          final pending = t('leave') + t('regularization') + t('travel') + t('expense');
          final awaitingHr = h('leave') + h('regularization') + h('travel') + h('expense');
          final att = mapOf(d['attendance_today']);
          final docs = mapOf(d['documents']);
          final prob = mapOf(d['probation']);
          final head = mapOf(d['headcount']);
          final lc = mapOf(d['lifecycle']);
          final assets = mapOf(d['assets']);
          final vis = mapOf(d['visitors']);
          final onLeave = rowsOf(d['on_leave_today']);
          final amber = hexColor('#B45309');
          return ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            PageHeader('HR Dashboard',
                subtitle: 'As of ${fmtDate(d['today'])} (IST). Headcount, joiners and leavers, leave and attendance today, pending approvals.',
                actions: [IconButton(tooltip: 'Refresh', icon: const Icon(Icons.refresh_rounded), onPressed: reload)]),
            if (toNum(d['missing_profiles']) > 0)
              padded(WarnBanner('${numTxt(d['missing_profiles'])} of ${numTxt(head['total'])} employees have no HR profile yet, so their department, plant, shift and probation are not tracked. Create them under Employees.')),
            TileGrid([
              StatTile(label: 'Pending approvals', value: '$pending', sub: awaitingHr > 0 ? '$awaitingHr have no manager — HR decides' : null,
                  color: pending > 0 ? amber : null, onTap: () => widget.goTo('Approvals')),
              StatTile(label: 'Attendance today', value: '${numTxt(att['present'])}/${numTxt(att['headcount'])}',
                  sub: '${numTxt(att['absent'])} absent · ${numTxt(att['not_marked'])} not marked',
                  color: toNum(att['not_marked']) > 0 ? amber : null, onTap: () => widget.goTo('Attendance')),
              StatTile(label: 'Documents expiring', value: numTxt(docs['expiring_count']),
                  sub: toNum(docs['expired_count']) > 0 ? '${numTxt(docs['expired_count'])} already expired' : 'Next 30 days',
                  color: toNum(docs['expiring_count']) + toNum(docs['expired_count']) > 0 ? amber : null),
              StatTile(label: 'Probation ending', value: numTxt(prob['count']),
                  sub: toNum(prob['overdue_count']) > 0 ? '${numTxt(prob['overdue_count'])} past end date' : 'Next 30 days',
                  color: toNum(prob['overdue_count']) > 0 ? Brand.danger : (toNum(prob['count']) > 0 ? amber : null)),
              StatTile(label: 'Headcount', value: numTxt(head['total']), sub: 'Active, not exited', onTap: () => widget.goTo('Employees')),
            ]),
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(padding: const EdgeInsets.only(left: 8), child: LinkAction(_more ? '▾ Hide more numbers' : '▸ More numbers', () => setState(() => _more = !_more))),
            ),
            if (_more)
              TileGrid([
                StatTile(label: 'Joiners this month', value: numTxt(d['joiners_count']), onTap: () => widget.goTo('Lifecycle')),
                StatTile(label: 'Exits this month', value: numTxt(d['exits_count']), color: toNum(d['exits_count']) > 0 ? Brand.danger : null, onTap: () => widget.goTo('Lifecycle')),
                StatTile(label: 'On leave today', value: '${onLeave.length}', onTap: () => widget.goTo('Leave')),
                StatTile(label: 'Open lifecycle tasks', value: numTxt(lc['total_open']), sub: '${numTxt(a['checklist_items_pending'])} checklist tasks open', onTap: () => widget.goTo('Lifecycle')),
                StatTile(label: 'Assets issued', value: numTxt(assets['issued']), sub: '${numTxt(assets['in_stock'])} in stock · ${numTxt(assets['under_repair'])} in repair', onTap: () => widget.goTo('Assets')),
                StatTile(label: 'Visitors inside', value: numTxt(vis['inside_now']), sub: '${numTxt(vis['expected_today'])} more expected today', onTap: () => widget.goTo('Visitors')),
                StatTile(label: 'Claims to pay', value: numTxt(a['claims_to_pay']),
                    sub: toNum(a['claims_to_pay']) > 0 ? fmtMoney(a['claims_to_pay_amount']) : 'Approved, not yet paid', onTap: () => widget.goTo('Travel & Claims')),
              ]),
            DetailSection('Pending approvals', action: LinkAction('Open Approvals →', () => widget.goTo('Approvals')), children: [
              for (final x in const [('Leave', 'leave'), ('Attendance corrections', 'regularization'), ('Travel requests', 'travel'), ('Expense claims', 'expense')])
                FieldRow(x.$1, '${t(x.$2)} pending · ${h(x.$2)} with no manager (HR decides)'),
            ]),
            DetailSection('On leave today', children: [
              if (onLeave.isEmpty) const HintText('Nobody is on approved leave today.'),
              for (final l in onLeave)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text('${l['name']}${l['half_day'] == true ? ' (half day)' : ''}'),
                  subtitle: Text('${l['leave_type']} · ${fmtDate(l['from_date'])} – ${fmtDate(l['to_date'])}'),
                  onTap: () => openScreen(context, EmployeeDetailScreen(userId: asInt(l['user_id']))),
                ),
            ]),
            DetailSection('Attendance — ${fmtDate(att['date'])}', children: [
              if (att['holidays_today'] is List && (att['holidays_today'] as List).isNotEmpty)
                Text('Holiday today: ${(att['holidays_today'] as List).join(', ')}', style: const TextStyle(color: Color(0xFF2563EB))),
              _bars([...rowsOf(att['by_status']), if (toNum(att['not_marked']) > 0) {'label': 'not_marked', 'count': att['not_marked']}], labels: _attLabels, max: 10),
            ]),
            DetailSection('Open lifecycle events', children: [
              if (rowsOf(lc['events']).isEmpty) const HintText('No open joining, transfer, promotion, confirmation or exit events.'),
              for (final e in rowsOf(lc['events']))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text('${e['event_no']} · ${str(e['name']).isEmpty ? '—' : e['name']}'),
                  subtitle: Text('Due ${fmtDate(e['due_date'])}${toNum(e['items_total']) > 0 ? ' · checklist ${numTxt(e['items_done'])}/${numTxt(e['items_total'])}' : ''}'),
                  trailing: statusPill(e['event_type'], lcTypeLabels, lcTypeHex),
                  onTap: () => openScreen(context, LifecycleDetailScreen(eventId: asInt(e['id']) ?? 0)),
                ),
            ]),
            DetailSection('Joiners and exits this month', children: [
              if (rowsOf(d['joiners_this_month']).isEmpty && rowsOf(d['exits_this_month']).isEmpty) const HintText('No joiners or exits dated this month.'),
              for (final p in rowsOf(d['joiners_this_month']))
                FieldRow(str(p['name']), '${p['pending'] == true ? 'Joining (pending)' : 'Joined'} · ${fmtDate(p['date'])}${str(p['department']).isEmpty ? '' : ' · ${p['department']}'}'),
              for (final p in rowsOf(d['exits_this_month']))
                FieldRow(str(p['name']), '${p['status'] == 'scheduled' ? 'Exit scheduled' : 'Exited'} · ${fmtDate(p['date'])}${str(p['department']).isEmpty ? '' : ' · ${p['department']}'}'),
            ]),
            DetailSection('Headcount by status', children: [
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final s in rowsOf(head['by_status'])) HrPill('${labelOf(_empStatusLabels, s['label'])}: ${numTxt(s['count'])}', _empStatusHex[str(s['label'])] ?? '#78716C'),
              ]),
            ]),
            DetailSection('Headcount by department', children: [_bars(rowsOf(head['by_department']), max: 6)]),
            DetailSection('Headcount by plant', children: [_bars(rowsOf(head['by_branch']), max: 6)]),
            DetailSection('Probation ending (30 days)', children: [
              if (rowsOf(prob['items']).isEmpty) const HintText('No probation periods end in the next 30 days.'),
              for (final p in rowsOf(prob['items'])) FieldRow(str(p['name']), '${fmtDate(p['probation_end_date'])} (${_daysLabel(p['days_left'])})'),
              if (toNum(prob['overdue_count']) > 0)
                const HintText('Overdue ones are still on probation after their end date. Record a Confirmation under Lifecycle, or extend the end date on the profile.'),
            ]),
            DetailSection('Documents expiring (30 days)', children: [
              if (rowsOf(docs['items']).isEmpty) const HintText('No employee documents expire in the next 30 days.'),
              for (final x in rowsOf(docs['items'])) FieldRow(str(x['name']), '${x['document_type']} — ${x['document_name']} · ${fmtDate(x['expiry_date'])} (${_daysLabel(x['days_left'])})'),
              if (toNum(docs['expired_count']) > 0)
                Text("${numTxt(docs['expired_count'])} document(s) already expired. Open the employee's Documents tab to upload the renewed copy.", style: const TextStyle(color: Brand.danger, fontSize: 12.5)),
            ]),
            DetailSection('Visitors inside now', action: LinkAction('Visitors →', () => widget.goTo('Visitors')), children: [
              if (rowsOf(vis['inside']).isEmpty) const HintText('No visitors are checked in right now.'),
              for (final v in rowsOf(vis['inside']))
                FieldRow('${v['visitor_name']}${str(v['visitor_company']).isEmpty ? '' : ' · ${v['visitor_company']}'}', 'Host ${v['host_name']} · in ${fmtDateTime(v['check_in_at'])}${str(v['badge_no']).isEmpty ? '' : ' · badge ${v['badge_no']}'}'),
            ]),
            DetailSection('Assets', action: LinkAction('Assets →', () => widget.goTo('Assets')), children: [
              _bars([
                for (final k in const ['issued', 'in_stock', 'under_repair', 'lost', 'retired'])
                  if (toNum(assets[k]) > 0) {'label': k, 'count': assets[k]},
              ], labels: const {'issued': 'Issued', 'in_stock': 'In stock', 'under_repair': 'Under repair', 'lost': 'Lost', 'retired': 'Retired'}),
              if (toNum(assets['held_by_inactive']) > 0)
                Text('${numTxt(assets['held_by_inactive'])} issued asset(s) still held by exited or deactivated employees. Record the return on the asset page.',
                    style: const TextStyle(color: Brand.danger, fontSize: 12.5)),
            ]),
          ]);
        },
      );
}