import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/app_frame.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'crm_common.dart';
import 'crm_inquiries_list.dart';
import 'crm_inquiry_detail.dart';
import 'crm_organizations.dart';
import 'crm_record_tabs.dart';

/// CRM Dashboard (crm/page.tsx).
class CrmDashboardTab extends StatelessWidget {
  const CrmDashboardTab({super.key});

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      load: () async => Map<String, dynamic>.from(await Api.get('/crm/dashboard') as Map),
      builder: (ctx, d, reload) {
        void push(String title, Widget w) => openScreen(ctx, SubPage(title: title, body: w));
        final cards = <(String, Object?, Color, VoidCallback)>[
          ('Organizations', d['total_organizations'], const Color(0xFF3B82F6), () => push('Customer Organizations', const OrganizationsTab())),
          ('Inquiries', d['total_inquiries'], const Color(0xFFFF7A45), () => push('Inquiries & Tenders', const InquiriesTab())),
          ('Tenders', d['total_tenders'], const Color(0xFF8B5CF6), () => push('Inquiries & Tenders', const InquiriesTab(initialType: 'tender'))),
          ('Open follow-ups', d['open_followups'], const Color(0xFF10B981), () => openScreen(ctx, const FollowUpsScreen(bucket: 'open'))),
          ('Overdue follow-ups', d['overdue_followups'], const Color(0xFFDC2626), () => openScreen(ctx, const FollowUpsScreen(bucket: 'overdue'))),
          ('Due today', d['today_activities'], const Color(0xFF06B6D4), () => openScreen(ctx, const FollowUpsScreen(bucket: 'today'))),
          ('Pending tenders', d['pending_tenders'], const Color(0xFFEAB308),
              () => push('Inquiries & Tenders', const InquiriesTab(initialType: 'tender', initialStat: InqStat.pending))),
        ];
        return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
          PageHeader('CRM Dashboard',
              subtitle: 'Welcome back, ${str(Perm.user['name']).isEmpty ? 'there' : str(Perm.user['name'])}. Here is the state of your business development pipeline.'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 1.9,
              children: [
                for (final c in cards)
                  Card(
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      onTap: c.$4,
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                          Caps(c.$1),
                          Text(fmtNumber(c.$2 ?? 0), style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: c.$3)),
                        ]),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          _recent(ctx, 'Recently Viewed Customer Organizations', jsonList(d['recent_organizations']),
              (o) => (str(o['name']), joinNonEmpty([o['city'] ?? o['org_type']]).isEmpty ? '—' : joinNonEmpty([o['city'] ?? o['org_type']])),
              (o) => openScreen(ctx, OrganizationScreen(id: asInt(o['id'])!)),
              () => push('Customer Organizations', const OrganizationsTab())),
          _recent(ctx, 'Recently Viewed Inquiries', jsonList(d['recent_inquiries']), (i) => (str(i['universal_id']), str(i['status'])),
              (i) => openCrmRecord(ctx, CrmKind.inquiry, asInt(i['id'])!), () => push('Inquiries & Tenders', const InquiriesTab())),
          _recent(ctx, 'Recently Viewed Tenders', jsonList(d['recent_tenders']), (t) => (str(t['universal_id']), str(t['status'])),
              (t) => openCrmRecord(ctx, CrmKind.tender, asInt(t['id'])!), () => push('Inquiries & Tenders', const InquiriesTab(initialType: 'tender'))),
          DetailSection('Recent Follow Ups', children: [
            if (jsonList(d['recent_activities']).isEmpty) const Note('No records yet.'),
            for (final a in jsonList(d['recent_activities']))
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(str(a['activity_type']).isEmpty ? 'Follow Up' : str(a['activity_type']),
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text('${stripHtml(a['remarks']).isEmpty ? '—' : stripHtml(a['remarks'])} · ${str(a['status'])}',
                    maxLines: 2, overflow: TextOverflow.ellipsis),
                onTap: _relatedOpener(ctx, a),
              ),
          ]),
        ]);
      },
    );
  }

  Widget _recent(BuildContext context, String title, List<Json> rows, (String, String) Function(Json) text, void Function(Json) open,
      VoidCallback viewAll) {
    return DetailSection(
      title,
      action: TextButton(onPressed: viewAll, child: const Text('View all →')),
      children: [
        if (rows.isEmpty) const Note('No records yet.') else const Note('Showing the newest.'),
        for (final r in rows.take(5))
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(text(r).$1, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text(text(r).$2),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: () => open(r),
          ),
      ],
    );
  }
}

VoidCallback? _relatedOpener(BuildContext context, Json a) {
  final id = asInt(a['related_id']);
  if (id == null) return null;
  if (a['related_module'] == 'inquiry') return () => openCrmRecord(context, CrmKind.inquiry, id);
  if (a['related_module'] == 'tender') return () => openCrmRecord(context, CrmKind.tender, id);
  return null;
}

/// Follow-ups (crm/followups/page.tsx): Open / Overdue / Today's.
class FollowUpsScreen extends StatefulWidget {
  const FollowUpsScreen({super.key, required this.bucket});
  final String bucket;

  @override
  State<FollowUpsScreen> createState() => _FollowUpsScreenState();
}

class _FollowUpsScreenState extends State<FollowUpsScreen> {
  late String _bucket = widget.bucket;
  static const _buckets = [('open', 'Open Follow-ups'), ('overdue', 'Overdue Follow-ups'), ('today', "Today's Follow-ups")];

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'Follow-ups',
      body: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SubTabs(
          tabs: [for (final b in _buckets) b.$2],
          index: _buckets.indexWhere((b) => b.$1 == _bucket),
          onChanged: (i) => setState(() => _bucket = _buckets[i].$1),
        ),
        Expanded(
          child: ApiListView(
            key: ValueKey(_bucket),
            emptyText: 'No follow-ups found.',
            load: (page, search) async {
              final q = <String, dynamic>{
                'limit': 10000,
                if (_bucket == 'overdue') 'overdue': true,
                if (_bucket == 'today') 'due_today': true,
                if (_bucket == 'open') 'status': 'Open',
              };
              final rows = (await Api.list('/crm/activities', query: q)).rows
                ..sort((a, b) => str(a['next_followup']).compareTo(str(b['next_followup'])));
              return ApiPage(rows);
            },
            itemBuilder: (ctx, a, reload) => RecordCard(
              title: str(a['activity_type']).isEmpty ? 'Follow Up' : str(a['activity_type']),
              code: str(a['related_label']).isEmpty ? null : str(a['related_label']),
              subtitle: joinNonEmpty([a['org_name'], stripHtml(a['remarks'])], '\n'),
              status: a['status'],
              meta: [
                ('Due Date', str(a['next_followup']).isEmpty ? 'To Be Decided' : fmtDate(a['next_followup'])),
                ('Assigned To', txt(a['assigned_to'])),
              ],
              onTap: _relatedOpener(ctx, a) ??
                  () => openScreen(ctx, ActivityScreen(activity: a, orgName: a['org_name'] as String?, onChanged: reload)),
            ),
          ),
        ),
      ]),
    );
  }
}
