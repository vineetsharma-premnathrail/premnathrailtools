import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';
import 'rnd_projects.dart';
import 'rnd_requirements.dart';
import 'rnd_tasks_tab.dart';

/// R&D › Dashboard (portal: app/dashboard/rnd/page.tsx).
class RndDashboard extends StatefulWidget {
  const RndDashboard({super.key});

  @override
  State<RndDashboard> createState() => _RndDashboardState();
}

class _RndDashboardState extends State<RndDashboard> {
  Json? _data;
  List<Json>? _reqs;
  List<Json>? _tasks;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = jsonMap(await Api.get('/rnd/dashboard'));
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
    try {
      final r = jsonList(await Api.get('/rnd/requirements'));
      if (mounted) setState(() => _reqs = r);
    } catch (_) {
      if (mounted) setState(() => _reqs = null);
    }
    final mine = <Json>[];
    try {
      mine.addAll(jsonList(await Api.get('/rnd/requirement-work/tasks/mine')));
    } catch (_) {}
    try {
      mine.addAll(jsonList(await Api.get('/rnd/project-tasks/mine')));
    } catch (_) {}
    if (mounted) setState(() => _tasks = mine);
  }

  void _push(String title, Widget body) => openThen(context, SubPage(title: title, body: body), _load);

  @override
  Widget build(BuildContext context) {
    final reqs = _reqs;
    final data = _data;
    final tasks = _tasks;
    final awaiting = (reqs ?? []).where((r) => r['status'] == 'submitted').length;
    final today = todayIso();
    final overdue = (tasks ?? []).where((t) => t['status'] == 'open' && isoDay(t['due_date']).compareTo(today) < 0).length;
    final me = '${Perm.userId ?? ''}';
    final projects = jsonMap(data?['projects']);
    final recent = jsonList(data?['recent_projects']);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          const PageHeader(
            'Research & Development',
            subtitle: 'Requirements from the business team, ongoing projects and your tasks at a glance.',
          ),
          if (_error != null)
            Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(ApiClient.describe(_error!))),
          ChipRow(
            children: [
              if (reqs != null) ...[
                CountChip(
                  'Requirements',
                  reqs.length,
                  color: const Color(0xFF3B82F6),
                  onTap: () => _push('Requirements', const RequirementsList()),
                ),
                CountChip(
                  'Awaiting review',
                  awaiting,
                  color: const Color(0xFFEA580C),
                  onTap: () => _push('Requirements', const RequirementsList(initialStatus: 'submitted')),
                ),
              ],
              if (data != null) ...[
                CountChip(
                  'Ongoing projects',
                  projects['ongoing'],
                  onTap: () => _push('Prototype / Research', const ProjectsList(initialStatus: 'active')),
                ),
                CountChip(
                  'On hold',
                  projects['on_hold'],
                  onTap: () => _push('Prototype / Research', const ProjectsList(initialStatus: 'on_hold')),
                ),
              ],
              if (tasks != null) ...[
                CountChip(
                  'My open tasks',
                  tasks.length,
                  onTap: () => _push('R&D Tasks', RndTasksTab(initial: {'assigned_to_id': me, 'status': 'pending'})),
                ),
                CountChip(
                  'Overdue',
                  overdue,
                  color: Brand.danger,
                  onTap: () => _push('R&D Tasks', RndTasksTab(initial: {'assigned_to_id': me, 'status': 'overdue'})),
                ),
              ],
            ],
          ),
          if (reqs != null)
            DetailSection(
              'Recently Received Requirements',
              action: TextButton(onPressed: () => _push('Requirements', const RequirementsList()), child: const Text('View all')),
              children: [
                if (reqs.isEmpty)
                  const Text(
                    'No requirements yet — they arrive, with an R&D ID, when the business team sends a Technical Offer Request.',
                    style: TextStyle(color: Brand.muted),
                  ),
                for (final r in reqs.take(6))
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(
                      [str(r, 'org_name'), str(r, 'product')].whereType<String>().join(' · ').isEmpty
                          ? '—'
                          : [str(r, 'org_name'), str(r, 'product')].whereType<String>().join(' · '),
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text('${r['rd_number'] ?? r['universal_id'] ?? ''} · ${fmtDate(r['last_sent_at'])}'),
                    trailing: r['status'] != null
                        ? Pill(
                            revisionStatusLabel[r['status']] ?? txt(r['status']),
                            hexColor(revisionStatusHex[r['status']] ?? '#78716c'),
                          )
                        : const Pill('Not sent to R&D', Color(0xFF78716C)),
                    onTap: () => openThen(
                      context,
                      RequirementDetailScreen(source: str(r, 'source') ?? 'inquiry', recordId: intOf(r['record_id']) ?? 0),
                      _load,
                    ),
                  ),
              ],
            ),
          if (data != null)
            DetailSection(
              'Ongoing Projects',
              action: TextButton(
                onPressed: () => _push('Prototype / Research', const ProjectsList()),
                child: const Text('View all'),
              ),
              children: [
                if (recent.isEmpty)
                  const Text(
                    'No ongoing R&D projects — start one from Projects › + New Project.',
                    style: TextStyle(color: Brand.muted),
                  ),
                for (final p in recent)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(str(p, 'title') ?? '', style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text('${p['project_number'] ?? ''} · ${p['lead_name'] ?? '—'}'),
                    trailing: Pill(stageLabels[p['stage']] ?? txt(p['stage']), hexColor(stageHex[p['stage']] ?? '#78716c')),
                    onTap: () => openThen(context, ProjectDetailScreen(projectId: intOf(p['id']) ?? 0), _load),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
