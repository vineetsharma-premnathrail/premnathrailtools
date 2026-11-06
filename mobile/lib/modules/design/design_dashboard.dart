import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'design_boms.dart';
import 'design_changes.dart';
import 'design_common.dart';
import 'design_documents.dart';
import 'design_links.dart';
import 'design_my_work.dart';
import 'design_requests.dart';
import 'design_reviews.dart';

/// Dashboard - portal design/page.tsx ("Engineering Document Control").
class DesignDashboardTab extends StatelessWidget {
  const DesignDashboardTab({super.key});

  void _go(BuildContext context, String title, Widget tab) =>
      openScreen(context, SubPage(title: title, body: tab));

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      load: () async => jsonMap(await Api.get('/design/dashboard')),
      builder: (ctx, d, reload) {
        Color? hex(bool on, Color c) => on ? c : null;
        int n(String k) => asInt(d[k]) ?? 0;
        final customers = jsonList(d['customer_pending_list']);
        final releases = jsonList(d['recent_releases']);
        final overdue = jsonList(d['overdue']);
        final workload = jsonList(d['workload']);
        return ListView(padding: const EdgeInsets.only(bottom: 32), children: [
          PageHeader('Engineering Document Control',
              subtitle: 'Your role: ${labelOf(teamRoleLabels, d['my_role'])}',
              actions: [
                if (str(d['my_role']) != 'viewer' && str(d['my_role']).isNotEmpty)
                  FilledButton(
                    style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                    onPressed: () async {
                      final id = await showNewDocumentForm(ctx);
                      if (id != null && ctx.mounted) openScreen(ctx, DesignDocumentDetail(id: id));
                    },
                    child: const Text('+ New Document'),
                  ),
              ]),
          const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 8), child: Caps('My work')),
          StatGrid([
            StatTile('Waiting on me', d['waiting_on_me'],
                color: hex(n('waiting_on_me') > 0, Brand.primary),
                hint: 'checks, approvals, votes & returns',
                onTap: () => _go(ctx, 'My Work', const DesignMyWorkTab())),
            StatTile('My PM tasks this week', d['my_pm_tasks_due'],
                color: hex(n('my_pm_tasks_overdue') > 0, Brand.danger),
                hint: '${n('my_pm_tasks_overdue')} overdue',
                onTap: () => _go(ctx, 'My Work', const DesignMyWorkTab())),
            StatTile('Requests waiting on Design', d['requests_waiting'],
                color: hex(n('requests_overdue') > 0, Brand.danger),
                hint: '${n('requests_overdue')} overdue',
                onTap: () => _go(ctx, 'Requests', const DesignRequestsTab())),
            StatTile('Customer approvals pending', d['customer_pending'],
                color: n('customer_overdue') > 0 ? Brand.danger : (n('customer_pending') > 0 ? const Color(0xFF0891B2) : null),
                hint: '${n('customer_overdue')} overdue${n('customer_pending') > 0 ? ' · oldest ${n('oldest_customer_days')}d' : ''}',
                onTap: () => _go(ctx, 'Reviews & Approvals', const DesignReviewsTab())),
          ]),
          const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 8), child: Caps('Drawings')),
          StatGrid([
            StatTile('Active documents', d['active_documents'],
                hint: '${n('released_documents')} released', onTap: () => _go(ctx, 'Drawings', const DesignDocumentsTab())),
            StatTile('Released this month', d['released_this_month'], color: hex(n('released_this_month') > 0, Brand.success)),
            StatTile('Drafts', d['drafts'], onTap: () => _go(ctx, 'Drawings', const DesignDocumentsTab(initialStatus: 'draft'))),
            StatTile('In review', d['in_review'],
                color: hex(n('in_review') > 0, const Color(0xFF2563EB)),
                onTap: () => _go(ctx, 'Drawings', const DesignDocumentsTab(initialStatus: 'in_review'))),
            StatTile('In approval', d['in_approval'],
                color: hex(n('in_approval') > 0, const Color(0xFF7C3AED)),
                onTap: () => _go(ctx, 'Drawings', const DesignDocumentsTab(initialStatus: 'in_approval'))),
            StatTile('Stuck > ${n('overdue_days')} days', d['overdue_in_workflow'],
                color: hex(n('overdue_in_workflow') > 0, Brand.danger), hint: 'in review or approval'),
            StatTile('BOMs in workflow', d['boms_in_workflow'],
                color: hex(n('boms_in_workflow') > 0, const Color(0xFF2563EB)),
                hint: '${n('released_boms')} released BOMs',
                onTap: () => _go(ctx, 'BOMs', const DesignBomsTab())),
            StatTile('Open change notices', d['open_ecns'], onTap: () => _go(ctx, 'Changes', const DesignChangesTab())),
          ]),
          const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 8), child: Caps('Changes')),
          StatGrid([
            StatTile('Open change requests (ECR)', d['open_ecrs'],
                color: hex(n('open_ecrs') > 0, Brand.warning),
                hint: 'impact check or board vote',
                onTap: () => _go(ctx, 'Changes', const DesignChangesTab())),
            StatTile('ECNs awaiting acknowledgement', d['ecns_awaiting_ack'],
                color: hex(n('ecns_awaiting_ack') > 0, const Color(0xFF0F766E)),
                hint: 'released, departments to confirm',
                onTap: () => _go(ctx, 'Changes', const DesignChangesTab())),
          ]),
          DetailSection('Waiting on me', children: [
            DesignTaskRows(jsonList(d['my_tasks']), empty: 'Nothing needs your action right now.', onReturn: reload),
          ]),
          DetailSection('Recently released', children: [
            if (releases.isEmpty)
              const Text('No revisions released yet. Create a document, upload its drawing and submit it for check.',
                  style: TextStyle(fontSize: 13, color: Brand.muted)),
            for (final r in releases)
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                onTap: () => openScreen(ctx, DesignDocumentDetail(id: asInt(r['document_id'])!)),
                title: Text('${r['doc_number']} ${r['revision_label']}', style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                subtitle: Text(str(r['title']), maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: Text(
                    '${fmtDate(r['released_at'])}${str(r['approved_by_name']).isEmpty ? '' : '\n${r['approved_by_name']}'}',
                    textAlign: TextAlign.right,
                    style: const TextStyle(fontSize: 11, color: Brand.muted)),
              ),
          ]),
          if (customers.isNotEmpty)
            DetailSection('Waiting on customers', children: [
              for (final c in customers)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  onTap: () => openScreen(ctx, DesignSubmissionDetail(id: asInt(c['id'])!)),
                  title: Text(str(c['submission_number']), style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                  subtitle: Text(str(c['customer_name'])),
                  trailing: Text(
                    '${(asInt(c['days_waiting']) ?? 0) == 0 ? 'sent today' : '${c['days_waiting']} day${c['days_waiting'] == 1 ? '' : 's'}'}${c['overdue'] == true ? ' · overdue' : ''}',
                    style: TextStyle(
                        fontSize: 11.5,
                        color: c['overdue'] == true ? Brand.danger : Brand.muted,
                        fontWeight: c['overdue'] == true ? FontWeight.w700 : FontWeight.w400),
                  ),
                ),
            ]),
          if (overdue.isNotEmpty)
            DetailSection('Stuck in workflow (over ${n('overdue_days')} days)', children: [
              DesignTaskRows(overdue, empty: '', onReturn: reload),
            ]),
          if (workload.isNotEmpty)
            DetailSection('Team workload (${workload.length})', children: [
              for (final w in workload)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${txt(w['name'])} · ${labelOf(teamRoleLabels, w['role'])}',
                        style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                    Text.rich(TextSpan(style: const TextStyle(fontSize: 12.5, color: Brand.body), children: [
                      TextSpan(text: 'Open PM tasks ${w['open_tasks']} · '),
                      TextSpan(
                          text: 'Overdue ${w['overdue_tasks']}',
                          style: TextStyle(
                              color: (asInt(w['overdue_tasks']) ?? 0) > 0 ? Brand.danger : null,
                              fontWeight: (asInt(w['overdue_tasks']) ?? 0) > 0 ? FontWeight.w700 : null)),
                      TextSpan(text: ' · Draft revisions ${w['drafts']} · Drawings to check ${w['to_check']}'),
                    ])),
                  ]),
                ),
            ]),
        ]);
      },
    );
  }
}

