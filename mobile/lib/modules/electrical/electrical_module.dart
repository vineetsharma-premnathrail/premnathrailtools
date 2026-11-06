import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../modules.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'common.dart';
import 'job_detail.dart';
import 'registers.dart';

export 'job_detail.dart' show ElectricalJobScreen, openElectricalJob;

/// Electrical - native copy of frontend/src/app/dashboard/electrical/.
/// Tabs = ElectricalNav: Dashboard, RRV Jobs, Drawings, Purchase Req.,
/// Testing, Troubleshooting (each hidden when the role can't view it).
class ElectricalModuleHome extends StatelessWidget {
  const ElectricalModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  Widget build(BuildContext context) => ModuleScaffold(module: module, tabs: [
        ModuleTab(
            label: 'Dashboard',
            icon: Icons.dashboard_outlined,
            visible: Elec.tabVisible('dashboard'),
            builder: (_) => const ElecDashboard()),
        ModuleTab(
            label: 'RRV Jobs', icon: Icons.bolt_outlined, visible: Elec.tabVisible('jobs'), builder: (_) => const ElecJobsPage()),
        ModuleTab(
            label: 'Drawings',
            icon: Icons.architecture_outlined,
            visible: Elec.tabVisible('drawings'),
            builder: (_) => const ElecDrawingsPage()),
        ModuleTab(
            label: 'Purchase Req.',
            icon: Icons.shopping_cart_outlined,
            visible: Elec.tabVisible('purchase'),
            builder: (_) => const ElecPurchasePage()),
        ModuleTab(
            label: 'Testing', icon: Icons.speed_outlined, visible: Elec.tabVisible('testing'), builder: (_) => const ElecTestingPage()),
        ModuleTab(
            label: 'Troubleshooting',
            icon: Icons.build_outlined,
            visible: Elec.tabVisible('troubleshooting'),
            builder: (_) => const ElecTroubleshootingPage()),
      ]);
}

/// A register page opened from a dashboard tile.
void _openPage(BuildContext context, String title, Widget page) => openScreen(context, SubPage(title: title, body: page));

// ── Dashboard ────────────────────────────────────────────────────────────────

class ElecDashboard extends StatefulWidget {
  const ElecDashboard({super.key});

  @override
  State<ElecDashboard> createState() => _ElecDashboardState();
}

class _ElecDashboardState extends State<ElecDashboard> {
  int _seq = 0;

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      key: ValueKey(_seq),
      load: () async => asJson(await Api.get('/electrical/dashboard')),
      builder: (ctx, data, reload) {
        final k = asJson(data['kpis']);
        int n(String key) => asInt(k[key]) ?? 0;
        final byPhase = rowsOf(data['by_phase']);
        final maxPhase = byPhase.fold<int>(1, (m, p) => (asInt(p['jobs']) ?? 0) > m ? asInt(p['jobs'])! : m);
        final canCreate = Elec.can('jobs', 'create');
        return ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            const ElecPageHeader('Electrical Dashboard', 'Where every RRV electrical job stands — tap a tile or a job to open it.'),
            if (canCreate)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: primaryBtn('New RRV Electrical Job',
                      () => createElectricalJob(context, onCreated: () => setState(() => _seq++))),
                ),
              ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: LayoutBuilder(builder: (ctx, c) {
                final w = (c.maxWidth - 10) / 2;
                Widget tile(String label, int value, String sub, {Color? color, VoidCallback? onTap}) =>
                    SizedBox(width: w, child: _Kpi(label: label, value: value, sub: sub, color: color, onTap: onTap));
                return Wrap(spacing: 10, runSpacing: 10, children: [
                  tile('Active Jobs', n('in_progress'), '${n('draft')} draft · ${n('on_hold')} on hold',
                      color: cAmber, onTap: () => _openPage(context, 'RRV Jobs', const ElecJobsPage())),
                  tile('Overdue', n('overdue'), 'Past target handover', color: n('overdue') > 0 ? cRed : null),
                  tile('Handed Over', n('handed_over'), 'Awaiting as-built / close', color: cBlue),
                  tile('Awaiting QC', n('awaiting_qc'), 'Inspections pending in Quality', color: n('awaiting_qc') > 0 ? cBlue : null),
                  tile('Drawings to Approve', n('drawings_pending_approval'), 'Revisions awaiting a decision',
                      color: n('drawings_pending_approval') > 0 ? cAmber : null,
                      onTap: () => _openPage(context, 'Drawings', const ElecDrawingsPage())),
                  tile('Components to Buy', n('purchase_pending'), 'BOM lines with no PR yet',
                      color: n('purchase_pending') > 0 ? cRed : null,
                      onTap: () => _openPage(context, 'Purchase Requirements', const ElecPurchasePage())),
                  tile('Failed Tests', n('open_failures'), 'Awaiting a passing retest',
                      color: n('open_failures') > 0 ? cRed : null,
                      onTap: () => _openPage(context, 'Testing', const ElecTestingPage())),
                  tile('Open Issues', n('open_issues'),
                      n('critical_issues') > 0 ? '${n('critical_issues')} critical' : 'Troubleshooting log',
                      color: n('critical_issues') > 0 ? cRed : null,
                      onTap: () => _openPage(context, 'Troubleshooting', const ElecTroubleshootingPage())),
                ]);
              }),
            ),
            const SizedBox(height: 14),
            DetailSection('Open jobs by phase', children: [
              for (final p in byPhase)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(children: [
                    SizedBox(width: 150, child: Text(str(p['label']), overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13))),
                    Expanded(
                      child: Bar((asInt(p['jobs']) ?? 0) / maxPhase, color: phaseHex[str(p['phase'])] ?? cStone, height: 10),
                    ),
                    SizedBox(
                      width: 32,
                      child: Text('${p['jobs']}',
                          textAlign: TextAlign.right,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.heading)),
                    ),
                  ]),
                ),
            ]),
            DetailSection('Handover due in the next 14 days',
                children: _jobRows(context, rowsOf(data['due_soon']), 'No handovers due in the next two weeks.')),
            DetailSection('Recent jobs',
                children: _jobRows(context, rowsOf(data['recent']),
                    "No electrical jobs yet — create one for each RRV whose electrical system you're building.")),
          ],
        );
      },
    );
  }

  List<Widget> _jobRows(BuildContext context, List<Json> rows, String empty) {
    if (rows.isEmpty) return [Muted(empty, size: 13)];
    return [
      for (final j in rows)
        InkWell(
          onTap: () async {
            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ElectricalJobScreen(jobId: asInt(j['id'])!)));
            if (mounted) setState(() => _seq++);
          },
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x14000000)))),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(str(j['job_number']), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.heading)),
                  Text.rich(
                    TextSpan(children: [
                      TextSpan(text: str(j['title'])),
                      if (str(j['current_stage_label']).isNotEmpty)
                        TextSpan(text: ' · ${j['current_stage_label']}', style: const TextStyle(color: Brand.muted)),
                    ]),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13, color: Brand.body),
                  ),
                  Text(
                    '${j['done_stages']}/${j['total_stages']} stages · '
                    '${j['target_handover_date'] == null ? '—' : fmtDate(j['target_handover_date'])}',
                    style: TextStyle(
                        fontSize: 12,
                        color: asBool(j['is_overdue']) ? cRed : Brand.muted,
                        fontWeight: asBool(j['is_overdue']) ? FontWeight.w600 : null),
                  ),
                ]),
              ),
              pill(j['status'], jobStatusLabels, jobStatusHex),
            ]),
          ),
        ),
    ];
  }
}

class _Kpi extends StatelessWidget {
  const _Kpi({required this.label, required this.value, required this.sub, this.color, this.onTap});
  final String label;
  final int value;
  final String sub;
  final Color? color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Caps(label),
              const SizedBox(height: 6),
              Text('$value', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: color ?? Brand.heading)),
              const SizedBox(height: 2),
              Text(sub, style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
          ),
        ),
      );
}

// ── Approval links ───────────────────────────────────────────────────────────

/// Landing for Electrical approval links (My Approvals, notifications) -
/// frontend/src/app/dashboard/electrical/approval/[entityType]/[id]: a drawing
/// revision or BOM line has no page of its own, so this finds its job and tab
/// and opens it with the record in focus. [ref] is the record id or its signed ref.
class ElectricalApprovalLinkScreen extends StatefulWidget {
  const ElectricalApprovalLinkScreen({super.key, required this.entityType, required this.ref});
  final String entityType;
  final String ref;

  @override
  State<ElectricalApprovalLinkScreen> createState() => _ElectricalApprovalLinkScreenState();
}

class _ElectricalApprovalLinkScreenState extends State<ElectricalApprovalLinkScreen> {
  String? _error;

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  Future<void> _resolve() async {
    try {
      var id = int.tryParse(widget.ref);
      id ??= asInt(asJson(await Api.get('/refs/${Uri.encodeComponent(widget.ref)}'))['id']);
      if (id == null) {
        throw 'This link is invalid — it was changed or copied incompletely. Open the record from its list, or ask the sender for the link again.';
      }
      final t = asJson(await Api.get('/electrical/lookups/approval-target/${widget.entityType}/$id'));
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => ElectricalJobScreen(jobId: asInt(t['job_id'])!, initialTab: str(t['tab']), focusId: id),
      ));
    } catch (e) {
      if (mounted) {
        setState(() => _error = e is String
            ? e
            : 'Could not open this approval — the record may have been deleted. ${ApiClient.describe(e)}');
      }
    }
  }

  @override
  Widget build(BuildContext context) => SubPage(
        title: 'Opening approval…',
        body: _error == null ? const LoadingView() : ErrorView(_error!),
      );
}