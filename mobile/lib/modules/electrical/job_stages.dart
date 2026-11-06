// Stages tab - phone copy of frontend/src/components/electrical/StagesTab.tsx:
// the 20 scope stages by phase with owner, plan, blockers and
// Start / Complete / N/A / Reopen / Plan.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'common.dart';

/// Which job tab holds the evidence a gated stage needs ("Go to …").
const _stageTab = {
  'requirement': ('details', 'Details & Requirement'),
  'schematics': ('drawings', 'Drawings'),
  'component_selection': ('bom', 'BOM'),
  'electrical_bom': ('bom', 'BOM'),
  'component_specification': ('bom', 'BOM'),
  'purchase_requirement': ('bom', 'BOM'),
  'cable_design': ('cables', 'Cables'),
  'wiring_installation': ('cables', 'Cables'),
  'panel_design': ('panels', 'Panels'),
  'panel_assembly': ('panels', 'Panels'),
  'drawing_revision': ('drawings', 'Drawings'),
  'as_built_records': ('drawings', 'Drawings'),
  'electrical_testing': ('tests', 'Tests'),
  'troubleshooting': ('issues', 'Troubleshooting'),
  'inspection_qc': ('handover', 'QC & Handover'),
  'commissioning': ('handover', 'QC & Handover'),
  'handover': ('handover', 'QC & Handover'),
  'final_documentation': ('documents', 'Documents'),
};

class StagesTab extends StatefulWidget {
  const StagesTab({super.key, required this.job, required this.canEdit, required this.onJob, required this.onGoToTab});
  final Json job;
  final bool canEdit;
  final ValueChanged<Json> onJob;
  final ValueChanged<String> onGoToTab;

  @override
  State<StagesTab> createState() => _StagesTabState();
}

class _StagesTabState extends State<StagesTab> {
  bool _busy = false;
  bool _showDone = true;

  Json get job => widget.job;
  int get jobId => asInt(job['id'])!;

  Future<void> _run(Future<dynamic> Function() fn, {String? success}) async {
    setState(() => _busy = true);
    try {
      final res = await fn();
      if (res is Map) widget.onJob(asJson(res));
      if (mounted && success != null) showSnack(context, success);
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _path(Json s) => '/electrical/jobs/$jobId/stages/${s['stage_key']}';

  Future<void> _complete(Json s) async {
    final note = TextEditingController();
    final label = str(s['label']);
    Json? out;
    final ok = await showFormSheet(
      context,
      title: "Complete '$label'?",
      saveLabel: 'Complete Stage',
      builder: (ctx, setS) => [
        Muted(str(job['job_number'])),
        Text(
          s['stage_key'] == 'handover'
              ? 'This records the RRV electrical system as handed over to the customer. The job moves to Handed Over.'
              : 'Mark this stage as completed. It can be reopened later if something changes.',
          style: const TextStyle(fontSize: 14, color: Brand.body),
        ),
        AppTextField(label: 'Completion Note (optional)', controller: note, maxLines: 3),
      ],
      onSave: () async {
        out = asJson(await Api.post('${_path(s)}/complete', data: {'remarks': strOrNull(note.text)}));
      },
    );
    note.dispose();
    if (ok && out != null) widget.onJob(out!);
  }

  Future<void> _reopen(Json s) async {
    final ok = await confirmDialog(
      context,
      title: "Reopen '${s['label']}'?",
      message: s['stage_key'] == 'handover' && job['status'] == 'handed_over'
          ? 'The job goes back to In Progress until the handover stage is completed again.'
          : 'The stage goes back to in progress and has to be completed again.',
      confirmLabel: 'Reopen',
    );
    if (ok) await _run(() => Api.post('${_path(s)}/reopen'));
  }

  Future<void> _notApplicable(Json s) async {
    final reason = await promptDialog(
      context,
      title: "Mark '${s['label']}' not applicable",
      message: "Say why this stage doesn't apply to this RRV — it's kept on the record.",
      confirmLabel: 'Mark N/A',
    );
    if (reason == null || reason.trim().isEmpty) return;
    await _run(() => Api.post('${_path(s)}/not-applicable', data: {'reason': reason.trim()}));
  }

  Future<void> _plan(Json s) async {
    int? assignee = asInt(s['assignee_id']);
    String? assigneeLabel = str(s['assignee_name']).isEmpty ? null : str(s['assignee_name']);
    DateTime? start = parseDate(s['planned_start_date']);
    DateTime? end = parseDate(s['planned_end_date']);
    final remarks = TextEditingController(text: str(s['remarks']));
    final label = str(s['label']);
    Json? out;
    final ok = await showFormSheet(
      context,
      title: 'Plan — $label',
      builder: (ctx, setS) => [
        Muted('${phaseLabels[str(s['phase'])] ?? str(s['phase'])} · ${job['job_number']}'),
        const FormHeading('Owner'),
        AppSelect<int>(
          label: 'Owner',
          value: assignee,
          valueLabel: assigneeLabel,
          loadOptions: (q) => userOptions(ruleKey: 'electrical:jobs.stages', keep: asInt(s['assignee_id']), search: q),
          onChanged: (o) => setS(() {
            assignee = o?.value;
            assigneeLabel = o?.label;
          }),
        ),
        const FormHeading('Schedule'),
        DateField(label: 'Planned Start', value: start, onChanged: (d) => setS(() => start = d)),
        DateField(label: 'Planned End', value: end, onChanged: (d) => setS(() => end = d)),
        const FormHeading('Remarks'),
        AppTextField(label: 'Remarks (optional)', controller: remarks, maxLines: 3),
      ],
      onSave: () async {
        if (start != null && end != null && end!.isBefore(start!)) {
          throw "'$label' can't end before it starts — check the planned dates.";
        }
        out = asJson(await Api.patch(_path(s), data: {
          'assignee_id': assignee,
          'planned_start_date': start == null ? null : apiDate(start!),
          'planned_end_date': end == null ? null : apiDate(end!),
          'remarks': strOrNull(remarks.text),
        }));
      },
    );
    remarks.dispose();
    if (ok && out != null) widget.onJob(out!);
  }

  @override
  Widget build(BuildContext context) {
    final stages = rowsOf(job['stages']);
    bool isDone(Json s) => s['status'] == 'completed' || s['status'] == 'not_applicable';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Muted("Stages can run in parallel. A stage completes once its evidence is in place — what's still missing "
                  'is listed under it.', size: 13),
              CheckField(label: 'Show completed stages', value: _showDone, onChanged: (v) => setState(() => _showDone = v)),
            ],
          ),
        ),
        for (final phase in phaseOrder) _phase(phase, stages, isDone),
      ],
    );
  }

  Widget _phase(String phase, List<Json> stages, bool Function(Json) isDone) {
    final status = str(job['status']);
    final planEditable = status != 'closed' && status != 'cancelled' && Elec.jf('stages', 'edit');
    final list = stages.where((s) => s['phase'] == phase).toList();
    final done = list.where(isDone).length;
    final visible = _showDone ? list : list.where((s) => !isDone(s)).toList();
    return DetailSection(
      phaseLabels[phase]!,
      action: tagPill('$done/${list.length} done', done == list.length ? cGreen : phaseHex[phase]!),
      children: [
        Container(height: 3, color: phaseHex[phase]),
        if (visible.isEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 10),
            child: Muted('All stages in this phase are done.', size: 13),
          ),
        for (final s in visible) _stageRow(s, isDone(s), planEditable),
      ],
    );
  }

  Widget _stageRow(Json s, bool done, bool planEditable) {
    final st = str(s['status']);
    final color = stageStatusHex[st] ?? cStone;
    final problems = (s['gate_problems'] is List) ? (s['gate_problems'] as List).map(str).toList() : <String>[];
    final blocked = !done && problems.isNotEmpty;
    final shortcut = _stageTab[str(s['stage_key'])];
    final canEdit = widget.canEdit;
    final buttons = <Widget>[
      if (canEdit && st == 'not_started')
        smallBtn('Start', _busy ? null : () => _run(() => Api.post('${_path(s)}/start'))),
      if (canEdit && !done)
        smallBtn('Complete', _busy || blocked ? null : () => _complete(s), color: blocked ? null : cGreenDark),
      if (canEdit && !done && !asBool(s['is_mandatory'])) smallBtn('N/A', _busy ? null : () => _notApplicable(s)),
      if (canEdit && done) smallBtn('Reopen', _busy ? null : () => _reopen(s)),
      if (planEditable) smallBtn('Plan', _busy ? null : () => _plan(s)),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x14000000)))),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(shape: BoxShape.circle, color: done ? color : color.withValues(alpha: 0.1)),
            child: Text(st == 'completed' ? '✓' : str(s['sequence']),
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: done ? Colors.white : color)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(str(s['label']),
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.heading)),
                    pill(st, stageStatusLabels, stageStatusHex),
                    if (asBool(s['is_mandatory'])) const Muted('Required', size: 11),
                    if (asBool(s['is_overdue'])) tagPill('Overdue', cRed),
                  ],
                ),
                const SizedBox(height: 4),
                Muted('Owner: ${txt(s['assignee_name'])}', size: 12),
                Muted('Plan: ${fmtDate(s['planned_start_date'])} → ${fmtDate(s['planned_end_date'])}', size: 12),
                if (s['completed_at'] != null)
                  Muted('${st == 'not_applicable' ? 'Waived' : 'Completed'} ${fmtDateTime(s['completed_at'])}'
                      '${str(s['completed_by_name']).isNotEmpty ? ' by ${s['completed_by_name']}' : ''}', size: 12),
                if (str(s['remarks']).isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(str(s['remarks']), style: const TextStyle(fontSize: 12.5, color: Brand.body)),
                  ),
                if (blocked)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: NoteBox(
                      '',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final p in problems)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 3),
                              child: Text('• $p', style: const TextStyle(fontSize: 12.5, color: Color(0xFF92400E))),
                            ),
                          if (shortcut != null)
                            InkWell(
                              onTap: () => widget.onGoToTab(shortcut.$1),
                              child: Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text('Go to ${shortcut.$2} →',
                                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: cOrange)),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                if (buttons.isNotEmpty) ...[const SizedBox(height: 8), btnWrap(buttons)],
              ],
            ),
          ),
        ],
      ),
    );
  }
}