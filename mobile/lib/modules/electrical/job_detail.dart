// One RRV electrical job - phone copy of
// frontend/src/app/dashboard/electrical/jobs/[id]/page.tsx: header, phase
// tracker, the job's sub-tabs (Stages, Details & Requirement, BOM, Panels,
// Cables, Drawings, Tests, Troubleshooting, QC & Handover, Documents) and the
// job status actions (Close / Resume / Hold / Cancel / Delete Draft) in the
// bottom bar.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'common.dart';
import 'job_bom.dart';
import 'job_cables.dart';
import 'job_documents.dart';
import 'job_drawings.dart';
import 'job_form.dart';
import 'job_handover.dart';
import 'job_issues.dart';
import 'job_panels.dart';
import 'job_stages.dart';
import 'job_tests.dart';

const jobTabKeys = ['stages', 'details', 'bom', 'panels', 'cables', 'drawings', 'tests', 'issues', 'handover', 'documents'];

/// Opens a job's page (optionally on one tab, with a record in focus).
void openElectricalJob(BuildContext context, Object? jobId, {String? tab, int? focusId}) {
  final id = asInt(jobId);
  if (id == null) {
    showSnack(context, 'This record has no job attached - refresh the list and try again.', error: true);
    return;
  }
  openScreen(context, ElectricalJobScreen(jobId: id, initialTab: tab, focusId: focusId));
}

class ElectricalJobScreen extends StatefulWidget {
  const ElectricalJobScreen({super.key, required this.jobId, this.initialTab, this.focusId});
  final int jobId;
  final String? initialTab;

  /// Record to open / highlight on the tab (from an approval link).
  final int? focusId;

  @override
  State<ElectricalJobScreen> createState() => _ElectricalJobScreenState();
}

class _ElectricalJobScreenState extends State<ElectricalJobScreen> {
  Json? _job;
  ElecMeta? _meta;
  Object? _error;
  String? _lookupError;
  late String _tab = jobTabKeys.contains(widget.initialTab) ? widget.initialTab! : 'stages';
  int _refresh = 0;
  bool _busy = false;
  final _vis = Vis('electrical:jobs');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      ElecMeta.load().then((m) {
        if (mounted) setState(() => _meta = m);
      }, onError: (Object e) {
        if (mounted) {
          setState(() {
            _meta = ElecMeta(const {});
            _lookupError = "Couldn't load the electrical stage and category lists — stage and category names may show blank; "
                'pull down to try again. (${ApiClient.describe(e)})';
          });
        }
      });
      final j = asJson(await Api.get('/electrical/jobs/${widget.jobId}'));
      if (mounted) {
        setState(() {
          _job = j;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _pullRefresh() async {
    await _load();
    if (mounted) setState(() => _refresh++);
  }

  void _setJob(Json j) => setState(() => _job = j);

  /// Re-fetches the job (counts, stage gates) after a tab changed something.
  Future<void> _reloadJob() async {
    try {
      final j = asJson(await Api.get('/electrical/jobs/${widget.jobId}'));
      if (mounted) setState(() => _job = j);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  bool _tabVisible(String t) {
    switch (t) {
      case 'details':
        return true;
      case 'bom':
        return Elec.sees('bom') || Elec.can('purchase', 'view');
      case 'drawings':
        return Elec.sees('drawings') || Elec.can('drawings', 'view');
      case 'tests':
        return Elec.sees('tests') || Elec.can('testing', 'view');
      case 'issues':
        return Elec.sees('issues') || Elec.can('troubleshooting', 'view');
      default:
        return Elec.sees(t);
    }
  }

  void _goToTab(String t) {
    if (jobTabKeys.contains(t) && _tabVisible(t)) setState(() => _tab = t);
  }

  Future<void> _act(Future<dynamic> Function() fn, String success) async {
    setState(() => _busy = true);
    try {
      final res = await fn();
      if (!mounted) return;
      if (res is Map) _setJob(asJson(res));
      showSnack(context, success);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _tabLabel(String t, Json job) {
    final s = asJson(job['summary']);
    int n(String k) => asInt(s[k]) ?? 0;
    switch (t) {
      case 'stages':
        return 'Stages (${job['done_stages']}/${job['total_stages']})';
      case 'details':
        return 'Details & Requirement';
      case 'bom':
        return 'BOM (${n('bom_count')})';
      case 'panels':
        return 'Panels (${n('panel_count')})';
      case 'cables':
        return 'Cables (${n('cable_count')})';
      case 'drawings':
        return 'Drawings (${n('drawing_count')})';
      case 'tests':
        return 'Tests (${n('factory_tests') + n('commissioning_tests')})';
      case 'issues':
        return n('open_issues') > 0 ? 'Troubleshooting (${n('open_issues')} open)' : 'Troubleshooting';
      case 'handover':
        return 'QC & Handover';
      case 'documents':
        return 'Documents (${n('document_count')})';
    }
    return t;
  }

  @override
  Widget build(BuildContext context) {
    final job = _job;
    if (job == null) {
      return SubPage(
        title: 'Electrical Job',
        body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView(),
      );
    }
    final status = str(job['status']);
    final isWorking = workingStatuses.contains(status);
    final canHoldClose = Elec.jf('job_status', 'edit');
    final canCancelJob = Elec.jf('job_status', 'cancel');
    final jobNo = str(job['job_number']);

    final actions = <Widget>[
      if (canHoldClose && status == 'handed_over')
        barBtn('Close Job', _busy ? null : _confirmClose, primary: true),
      if (canHoldClose && status == 'on_hold') barBtn('Resume Job', _busy ? null : _confirmResume, primary: true),
      if (canHoldClose && (status == 'draft' || status == 'in_progress'))
        barBtn('Put On Hold', _busy ? null : () => _reason(hold: true)),
      if (canCancelJob && ['draft', 'in_progress', 'on_hold'].contains(status))
        barBtn('Cancel Job', _busy ? null : () => _reason(hold: false), danger: true),
      if (status == 'draft' && asInt(job['done_stages']) == 0 && Elec.canDelete('jobs', job['created_by_id']))
        barBtn('Delete Draft', _busy ? null : _confirmDelete, danger: true),
    ];

    final visibleTabs = jobTabKeys.where(_tabVisible).toList();
    final active = _tabVisible(_tab) ? _tab : (visibleTabs.isEmpty ? 'details' : visibleTabs.first);

    return SubPage(
      title: jobNo.isEmpty ? 'Electrical Job' : jobNo,
      bottom: actions.isEmpty ? null : bottomActions(actions),
      body: RefreshIndicator(
        onRefresh: _pullRefresh,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            if (_vis.showSection('detail_header')) _header(job),
            if (_lookupError != null)
              Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 10), child: ErrorBanner(_lookupError!)),
            if (status == 'on_hold' && str(job['hold_reason']).isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: NoteBox('On hold: ${job['hold_reason']}', color: cPurple, textColor: const Color(0xFF7E22CE)),
              ),
            if (status == 'cancelled' && str(job['cancel_reason']).isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: NoteBox('Cancelled: ${job['cancel_reason']}', color: cRed, textColor: const Color(0xFFB91C1C)),
              ),
            if (_vis.showSection('detail_phase_tracker')) _PhaseTracker(job: job),
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                children: [for (final t in visibleTabs) segment(_tabLabel(t, job), active == t, () => _goToTab(t))],
              ),
            ),
            const Divider(height: 1),
            const SizedBox(height: 12),
            if (_meta == null) const LoadingView() else _tabBody(active, job, _meta!, isWorking),
          ],
        ),
      ),
    );
  }

  Widget _header(Json job) {
    final rest = [job['rrv_model'], job['vehicle_number'], job['customer_name']]
        .map(str)
        .where((s) => s.isNotEmpty)
        .map((s) => ' · $s')
        .join();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Caps('Electrical Module · RRV Electrical Job'),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(str(job['job_number']),
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
              pill(job['status'], jobStatusLabels, jobStatusHex),
              tagPill('${priorityLabel(job['priority'])} priority', priorityHex[normalizePriority(job['priority'])]!),
              if (asBool(job['is_overdue'])) tagPill('Overdue', cRed),
            ],
          ),
          const SizedBox(height: 6),
          Text.rich(TextSpan(children: [
            TextSpan(text: str(job['title'])),
            TextSpan(text: rest, style: const TextStyle(color: Brand.muted)),
          ]), style: const TextStyle(fontSize: 14, color: Brand.body)),
        ],
      ),
    );
  }

  Widget _tabBody(String tab, Json job, ElecMeta meta, bool isWorking) {
    final key = ValueKey('$tab#$_refresh');
    bool editFor(String f) => isWorking && Elec.jf(f, 'edit');
    switch (tab) {
      case 'stages':
        return StagesTab(key: key, job: job, canEdit: editFor('stages'), onJob: _setJob, onGoToTab: _goToTab);
      case 'details':
        return _DetailsTab(key: key, job: job, onJob: _setJob);
      case 'bom':
        return BomTab(key: key, job: job, meta: meta, canEdit: editFor('bom'), onChanged: _reloadJob, focusId: widget.focusId);
      case 'panels':
        return PanelsTab(key: key, job: job, meta: meta, canEdit: editFor('panels'), onChanged: _reloadJob);
      case 'cables':
        return CablesTab(key: key, job: job, canEdit: editFor('cables'), onChanged: _reloadJob);
      case 'drawings':
        return DrawingsTab(
            key: key, job: job, meta: meta, canEdit: editFor('drawings'), onChanged: _reloadJob, focusId: widget.focusId);
      case 'tests':
        return TestsTab(key: key, job: job, meta: meta, canEdit: isWorking, onChanged: _reloadJob);
      case 'issues':
        return IssuesTab(key: key, job: job, meta: meta, canEdit: isWorking, onChanged: _reloadJob);
      case 'handover':
        return HandoverTab(key: ValueKey('handover#$_refresh#${job['updated_at']}'), job: job, canEdit: isWorking, onJob: _setJob);
      case 'documents':
        return DocumentsTab(
          key: key,
          job: job,
          meta: meta,
          canEdit: isWorking && (Elec.jf('documents', 'create') || Elec.jf('documents', 'delete')),
          onChanged: _reloadJob,
        );
    }
    return const SizedBox.shrink();
  }

  // ── Job status actions ──

  Future<void> _confirmResume() async {
    if (await confirmDialog(context, title: 'Resume this job?', message: 'Stage work can continue again.', confirmLabel: 'Resume')) {
      await _act(() => Api.post('/electrical/jobs/${widget.jobId}/resume'), 'Job resumed.');
    }
  }

  Future<void> _confirmClose() async {
    final ok = await confirmDialog(context,
        title: 'Close this job?',
        message: "Every stage is done and the RRV is handed over. Closing makes the job's records final — nothing can be "
            'changed afterwards.',
        confirmLabel: 'Close Job');
    if (ok) await _act(() => Api.post('/electrical/jobs/${widget.jobId}/close'), "Job closed. Its records are now final.");
  }

  Future<void> _confirmDelete() async {
    final no = str(_job?['job_number']);
    final ok = await confirmDialog(context,
        title: 'Delete this draft job?',
        message: '${no.isEmpty ? 'This job' : no} and its empty stage list will be removed.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      await Api.delete('/electrical/jobs/${widget.jobId}');
      if (!mounted) return;
      showSnack(context, '${no.isEmpty ? 'Job' : no} deleted.');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        showSnack(context, ApiClient.describe(e), error: true);
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _reason({required bool hold}) async {
    final reason = await promptDialog(
      context,
      title: hold ? 'Put job on hold' : 'Cancel job',
      message: hold
          ? 'Stage work is frozen until the job is resumed. Why is it on hold?'
          : "A cancelled job can't be reopened. Why is it being cancelled?",
      confirmLabel: hold ? 'Put On Hold' : 'Cancel Job',
    );
    if (reason == null || reason.trim().isEmpty) return;
    if (hold) {
      await _act(() => Api.post('/electrical/jobs/${widget.jobId}/hold', data: {'reason': reason.trim()}), 'Job put on hold.');
    } else {
      await _act(() => Api.post('/electrical/jobs/${widget.jobId}/cancel', data: {'reason': reason.trim()}), 'Job cancelled.');
    }
  }
}

/// "X% complete · d of t stages", next stage, and one bar per phase.
class _PhaseTracker extends StatelessWidget {
  const _PhaseTracker({required this.job});
  final Json job;

  @override
  Widget build(BuildContext context) {
    final stages = rowsOf(job['stages']);
    final next = str(job['current_stage_label']);
    final target = job['target_handover_date'];
    return DetailSection(
      '${job['progress_percent']}% complete · ${job['done_stages']} of ${job['total_stages']} stages',
      children: [
        Text.rich(
          TextSpan(children: [
            if (next.isNotEmpty) ...[
              const TextSpan(text: 'Next up: '),
              TextSpan(text: next, style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.body)),
            ] else
              const TextSpan(text: 'Every stage is done.'),
            TextSpan(text: target != null ? ' · Target handover ${fmtDate(target)}' : ' · Target handover not set'),
          ]),
          style: const TextStyle(fontSize: 12.5, color: Brand.muted),
        ),
        const SizedBox(height: 10),
        for (final phase in phaseOrder)
          () {
            final list = stages.where((s) => s['phase'] == phase).toList();
            final done = list.where((s) => s['status'] == 'completed' || s['status'] == 'not_applicable').length;
            final current = job['current_phase'] == phase;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  SizedBox(
                    width: 150,
                    child: Text('${phaseLabels[phase]} $done/${list.length}',
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: current ? FontWeight.w700 : FontWeight.w500,
                          color: current ? phaseHex[phase] : Brand.muted,
                        )),
                  ),
                  Expanded(child: Bar(list.isEmpty ? 0 : done / list.length, color: phaseHex[phase]!)),
                ],
              ),
            );
          }(),
      ],
    );
  }
}

/// Details & Requirement - the job's facts as label / value rows, Edit opens the form.
class _DetailsTab extends StatelessWidget {
  const _DetailsTab({super.key, required this.job, required this.onJob});
  final Json job;
  final ValueChanged<Json> onJob;

  @override
  Widget build(BuildContext context) {
    final vis = Vis('electrical:jobs');
    final status = str(job['status']);
    final canEditDetails = Elec.can('jobs', 'edit') && status != 'closed' && status != 'cancelled';
    final opNo = str(job['order_project_number']);
    final tail = str(job['order_project_element_no']).split('/').last;
    final opLabel = str(job['order_project_element_label']);
    final opText = '$opNo${job['order_project_element_no'] != null && tail.isNotEmpty ? ' / $tail' : ''}'
        '${opLabel.isNotEmpty ? ' · $opLabel' : ''}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DetailSection(
          str(job['title']),
          action: canEditDetails
              ? smallBtn('Edit', () async {
                  final saved = await showJobForm(context, initial: job);
                  if (saved != null && context.mounted) {
                    onJob(saved);
                    showSnack(context, 'Job details saved.');
                  }
                })
              : null,
          children: [
            Muted('Lead: ${str(job['lead_engineer_name']).isEmpty ? 'Not assigned' : job['lead_engineer_name']}'
                ' · ${job['planned_start_date'] != null ? 'Planned start ${fmtDate(job['planned_start_date'])}' : 'Start not planned'}'
                '${job['started_at'] != null ? ' · Started ${fmtDate(job['started_at'])}' : ''}'),
          ],
        ),
        if (vis.showSection('detail_rrv'))
          DetailSection('RRV & Job', children: [
            if (opNo.isNotEmpty)
              FieldRow(
                'Project / Unit',
                str(job['order_project_id_ref']).isEmpty
                    ? Text(opText)
                    : InkWell(
                        onTap: () => runAction(
                            context, () => Files.openInPortal('/dashboard/projects/${job['order_project_id_ref']}')),
                        child: Text('$opText  →',
                            style: const TextStyle(color: Color(0xFF1D4ED8), fontWeight: FontWeight.w600)),
                      ),
              ),
            FieldRow('RRV / Machine (ERP)', job['project_label']),
            FieldRow('RRV Model', job['rrv_model']),
            FieldRow('Vehicle / Serial No.', job['vehicle_number']),
            FieldRow('Customer', job['customer_name']),
            FieldRow('Plant', job['branch_name']),
          ]),
        if (Elec.sees('requirement') && vis.showSection('detail_requirement'))
          DetailSection('Electrical Requirement', children: [
            FieldRow('System Voltage', job['system_voltage']),
            FieldRow('Battery', job['battery_spec']),
            FieldRow('Alternator / Charger', job['alternator_spec']),
            FieldRow('Applicable Standards', job['applicable_standards']),
            FieldRow('Customer Spec Ref.', job['customer_spec_ref']),
            FieldRow('Requirement', str(job['requirement_notes']).isEmpty ? 'Not written down yet.' : job['requirement_notes']),
          ]),
        if (vis.showSection('detail_remarks')) DetailSection('Remarks', children: [FieldRow('Remarks', job['remarks'])]),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Muted('Created by ${txt(job['created_by_name'])}'
              '${job['created_at'] != null ? ' on ${fmtDateTime(job['created_at'])}' : ''}', size: 12),
        ),
      ],
    );
  }
}
