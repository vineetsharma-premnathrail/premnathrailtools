// Create / edit form of an RRV electrical job - phone copy of
// frontend/src/components/electrical/JobForm.tsx (RRV & Job, Ownership &
// Schedule, Electrical Requirement, Remarks).
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import 'common.dart';

const _textFields = [
  'title', 'rrv_model', 'vehicle_number', 'customer_name', 'system_voltage', 'battery_spec', 'alternator_spec',
  'applicable_standards', 'customer_spec_ref', 'requirement_notes', 'remarks',
];

/// Opens the job form. Returns the saved job (created or updated), null when cancelled.
Future<Json?> showJobForm(BuildContext context, {Json? initial}) async {
  final vis = Vis('electrical:jobs');
  final editing = initial != null;
  final c = {for (final f in _textFields) f: TextEditingController(text: str(initial?[f]))};
  int? erpProjectId = asInt(initial?['erp_project_id']);
  String? erpProjectLabel = initial == null ? null : str(initial['project_label']);
  int? branchId = asInt(initial?['branch_id']);
  String? branchLabel = initial == null ? null : str(initial['branch_name']);
  int? leadId = asInt(initial?['lead_engineer_id']);
  String? leadLabel = initial == null ? null : str(initial['lead_engineer_name']);
  DateTime? plannedStart = parseDate(initial?['planned_start_date']);
  DateTime? targetHandover = parseDate(initial?['target_handover_date']);
  int? opProjectId = asInt(initial?['order_project_id']);
  int? opElementId = asInt(initial?['order_project_element_id']);
  String? opLabel;
  if (opProjectId != null) {
    final tail = str(initial?['order_project_element_no']).split('/').last;
    final lbl = str(initial?['order_project_element_label']);
    opLabel = str(initial?['order_project_display']).isNotEmpty
        ? str(initial?['order_project_display'])
        : '${str(initial?['order_project_number'])}${tail.isNotEmpty && initial?['order_project_element_no'] != null ? ' / $tail' : ''}${lbl.isNotEmpty ? ' · $lbl' : ''}';
  }

  // Priority values the role offers; an edit keeps the saved priority.
  var priority = initial == null ? 'standard' : str(initial['priority']).isEmpty ? 'standard' : str(initial['priority']);
  final choices = vis.options('priority', priorityLabels.entries.toList(), (e) => e.key);
  final priorityOptions = [for (final e in choices) Option(e.key, e.value)];
  if (editing && !priorityOptions.any((o) => o.value == priority)) {
    priorityOptions.add(Option(priority, priorityLabels[priority] ?? priority));
  }
  if (!editing && choices.isNotEmpty && !choices.any((e) => e.key == priority)) priority = choices.first.key;

  // Lookup rows remembered for prefill when a machine / project is picked.
  final projectRows = <int, Json>{};
  final opRows = <String, Json>{};

  Json? saved;
  final ok = await showFormSheet(
    context,
    title: editing ? 'Edit ${str(initial['job_number'])}' : 'New RRV Electrical Job',
    saveLabel: editing ? 'Save Changes' : 'Create Job',
    builder: (ctx, setS) => [
      if (!editing)
        const Muted('The job is created with all 20 scope stages — from Electrical Requirement to As-Built Records — ready to plan.'),
      if (vis.showSection('rrv_job')) ...[
        const FormHeading('RRV & Job'),
        AppTextField(label: 'Job Title', controller: c['title'], required: true, hint: 'e.g. RRV-450 electrical — Northern Railway'),
        AppSelect<String>(
          label: 'Priority',
          value: priority,
          clearable: false,
          options: priorityOptions,
          onChanged: (o) => setS(() => priority = o?.value ?? priority),
        ),
        AppSelect<String>(
          label: 'Project / Unit (optional)',
          value: opProjectId == null ? null : '$opProjectId:${opElementId ?? ''}',
          valueLabel: opLabel,
          loadOptions: (q) async {
            final rows = rowsOf(await Api.get('/projects/units/lookup',
                query: {'q': q.trim(), 'kind': 'vehicle', 'include_projects': true}));
            return [
              for (final r in rows)
                () {
                  final key = '${asInt(r['project_id'])}:${asInt(r['element_id']) ?? ''}';
                  opRows[key] = r;
                  return Option(key, str(r['display']));
                }(),
            ];
          },
          onChanged: (o) => setS(() {
            if (o == null) {
              opProjectId = null;
              opElementId = null;
              opLabel = null;
              return;
            }
            final r = opRows[o.value];
            opProjectId = asInt(r?['project_id']);
            opElementId = asInt(r?['element_id']);
            opLabel = o.label;
            final client = str(r?['client_name']);
            if (client.isNotEmpty && c['customer_name']!.text.trim().isEmpty) c['customer_name']!.text = client;
          }),
        ),
        AppSelect<int>(
          label: 'RRV / Machine (ERP) (optional)',
          value: erpProjectId,
          valueLabel: erpProjectLabel,
          loadOptions: (q) async {
            final rows = rowsOf(await Api.get('/electrical/lookups/projects', query: {'search': q.trim()}));
            return [
              for (final r in rows)
                if (asInt(r['id']) != null)
                  () {
                    projectRows[asInt(r['id'])!] = r;
                    return Option(asInt(r['id'])!, str(r['label']));
                  }(),
            ];
          },
          onChanged: (o) => setS(() {
            erpProjectId = o?.value;
            erpProjectLabel = o?.label;
            final p = o == null ? null : projectRows[o.value];
            if (p == null) return;
            if (c['vehicle_number']!.text.trim().isEmpty) c['vehicle_number']!.text = str(p['code']);
            if (c['customer_name']!.text.trim().isEmpty) c['customer_name']!.text = str(p['extra']);
          }),
        ),
        const Muted('Picking a machine fills in the serial number and customer when those are still blank.', size: 12),
        AppTextField(label: 'RRV Model', controller: c['rrv_model'], hint: 'e.g. RRV-450'),
        AppTextField(label: 'Vehicle / Serial No.', controller: c['vehicle_number']),
        AppTextField(label: 'Customer', controller: c['customer_name']),
      ],
      if (vis.showSection('ownership_schedule')) ...[
        const FormHeading('Ownership & Schedule'),
        AppSelect<int>(
          label: 'Plant',
          value: branchId,
          valueLabel: branchLabel,
          loadOptions: (q) async {
            final rows = rowsOf(await Api.get('/electrical/lookups/branches'));
            final s = q.trim().toLowerCase();
            return [
              for (final r in rows)
                if (asInt(r['id']) != null && (s.isEmpty || str(r['label']).toLowerCase().contains(s)))
                  Option(asInt(r['id'])!, str(r['label'])),
            ];
          },
          onChanged: (o) => setS(() {
            branchId = o?.value;
            branchLabel = o?.label;
          }),
        ),
        AppSelect<int>(
          label: 'Lead Engineer',
          value: leadId,
          valueLabel: leadLabel,
          loadOptions: (q) => userOptions(
              ruleKey: 'electrical:jobs.lead_engineer', keep: asInt(initial?['lead_engineer_id']), search: q),
          onChanged: (o) => setS(() {
            leadId = o?.value;
            leadLabel = o?.label;
          }),
        ),
        DateField(label: 'Planned Start', value: plannedStart, onChanged: (d) => setS(() => plannedStart = d)),
        DateField(label: 'Target Handover', value: targetHandover, onChanged: (d) => setS(() => targetHandover = d)),
      ],
      if (vis.showSection('requirement')) ...[
        const FormHeading('Electrical Requirement'),
        AppTextField(label: 'System Voltage', controller: c['system_voltage'], hint: 'e.g. 24 V DC'),
        AppTextField(label: 'Battery', controller: c['battery_spec'], hint: 'e.g. 2 × 12 V 150 Ah'),
        AppTextField(label: 'Alternator / Charger', controller: c['alternator_spec'], hint: 'e.g. 28 V 100 A'),
        AppTextField(
            label: 'Applicable Standards', controller: c['applicable_standards'], hint: 'e.g. RDSO spec, IS/IEC references'),
        AppTextField(label: 'Customer Spec Ref.', controller: c['customer_spec_ref']),
        AppTextField(
          label: 'Requirement',
          controller: c['requirement_notes'],
          maxLines: 5,
          hint: 'Loads and circuits the customer needs — lighting, beacons, horns, cab controls, instruments, interlocks…',
        ),
      ],
      if (vis.showSection('remarks')) ...[
        const FormHeading('Remarks'),
        AppTextField(label: 'Remarks (optional)', controller: c['remarks'], maxLines: 3),
      ],
    ],
    onSave: () async {
      if (c['title']!.text.trim().isEmpty) {
        throw 'Enter a title for the job, e.g. "RRV-450 electrical — Northern Railway".';
      }
      if (plannedStart != null && targetHandover != null && targetHandover!.isBefore(plannedStart!)) {
        throw "Target handover date can't be before the planned start date.";
      }
      final payload = <String, dynamic>{
        for (final f in _textFields) f: f == 'title' ? c[f]!.text.trim() : strOrNull(c[f]!.text),
        'erp_project_id': erpProjectId,
        'branch_id': branchId,
        'lead_engineer_id': leadId,
        'priority': priority,
        'planned_start_date': plannedStart == null ? null : apiDate(plannedStart!),
        'target_handover_date': targetHandover == null ? null : apiDate(targetHandover!),
        'order_project_id': opProjectId,
        'order_project_element_id': opElementId,
      };
      final res = editing
          ? await Api.patch('/electrical/jobs/${initial['id']}', data: payload)
          : await Api.post('/electrical/jobs', data: payload);
      saved = asJson(res);
    },
  );
  for (final ctrl in c.values) {
    ctrl.dispose();
  }
  return ok ? saved : null;
}
