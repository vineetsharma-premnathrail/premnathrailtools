import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/form.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';
import 'lifecycle.dart';

// Portal: components/hr/lifecycle/CompletionPanel.tsx — impact preview and the
// options of completing a joining / confirmation / transfer / promotion / exit.

/// Shows the completion form; returns the completed event or null.
Future<Json?> showCompletionForm(BuildContext context, Json e, Json? meta0) async {
  final t = str(e['event_type']);
  Json meta;
  try {
    meta = meta0 ?? await lifecycleMeta();
  } catch (err) {
    if (context.mounted) showSnack(context, ApiClient.describe(err), error: true);
    return null;
  }
  Json? impact;
  if ((t == 'exit' || t == 'transfer' || t == 'promotion') && e['user_id'] != null) {
    try {
      impact = mapOf(await Api.get('/hr/lifecycle/events/${e['id']}/impact'));
    } catch (err) {
      if (context.mounted) showSnack(context, ApiClient.describe(err), error: true);
      return null;
    }
  }
  if (!context.mounted) return null;
  final blockers = mapOf(impact?['blockers']);
  final blocked = toNum(blockers['pending_checklist_items']) > 0 || toNum(blockers['unreturned_assets']) > 0;
  int? handover = asInt(e['handover_to_id']);
  var force = false;
  final forceReason = TextEditingController();
  var employmentType = 'permanent';
  final code = TextEditingController(text: str(e['employee_code']));
  DateTime? probationEnd;
  final clearFlags = <String>{};
  var headSlots = 'keep';
  var reassign = false;
  final headFlags = rowsOf(impact?['role_flags']).where((f) => ['is_department_head', 'is_project_head', 'is_plant_head'].contains(f['flag'])).toList();
  final fromDeptHeaded = rowsOf(impact?['departments_headed']).where((d) => d['id'] == e['from_department_id']).firstOrNull;
  final pendingApprovals = rowsOf(impact?['pending_p2p_approvals']).length + rowsOf(impact?['pending_workflow_approvals']).length;
  final users = lcUserOpts(meta, except: asInt(e['user_id']));
  final needsHandover = impact?['needs_handover'] == true;

  String group(String title, String key, String Function(Json) line) {
    final rows = rowsOf(impact?[key]);
    return rows.isEmpty ? '' : '$title (${rows.length}):\n${rows.map((r) => '• ${line(r)}').join('\n')}';
  }

  final warnings = impact?['warnings'] is List ? (impact!['warnings'] as List) : const [];
  final impactText = impact == null
      ? ''
      : [
          if (t == 'exit') group('Pending checklist items', 'pending_checklist_items', (i) => '${i['title']} (${str(i['owner_name']).isEmpty ? 'unassigned' : i['owner_name']})'),
          if (t == 'exit') group('Company assets not returned', 'unreturned_assets', (a) => '${a['asset_code']} — ${a['name']}'),
          if (t == 'exit') group('Direct reportees', 'direct_reportees', (r) => '${r['name']}${str(r['designation']).isEmpty ? '' : ' — ${r['designation']}'}'),
          group('Department head slots', 'departments_headed', (d) => str(d['name'])),
          group('Pending P2P approvals', 'pending_p2p_approvals', (p) => '${p['p2p_number']}'),
          group('Open approvals (all modules)', 'pending_workflow_approvals', (a) => '${a['type_label']} ${a['ref']} — ${a['stage']}'),
          group('Approval roles', 'role_flags', (f) => str(f['label'])),
          if (t == 'exit') group('Pending HR approvals', 'pending_hr_approvals', (a) => '${a['label']} ${a['ref']}'),
          if (t == 'exit') group('Open PRs as buyer', 'p2p_buyer_requests', (p) => '${p['p2p_number']}'),
          if (t == 'exit') group('Tasks on other checklists', 'checklist_items_owned', (i) => '${i['title']} (${i['event_no']})'),
          if (t == 'exit')
            group('Their own open requests', 'own_open_requests', (o) => '${o['label']} ${o['ref']} — ${o['status']} ${o['action'] == 'cancel' ? 'will be cancelled' : 'kept'}'),
          for (final w in warnings) '⚠ $w',
        ].where((s) => s.isNotEmpty).join('\n\n');
  final who = str(e['subject_name']).isEmpty ? 'this employee' : str(e['subject_name']);
  final types = meta['employment_types'] is List ? (meta['employment_types'] as List) : employmentTypeLabels.keys.toList();
  Json? done;
  final ok = await showFormSheet(context,
      title: t == 'exit' ? 'Complete exit' : t == 'joining' ? 'Complete joining' : t == 'confirmation' ? 'Confirm employee' : 'Apply $t',
      saveLabel: t == 'exit' ? 'Complete exit' : 'Complete',
      builder: (ctx, setS) => [
            HintText(t == 'exit'
                ? 'Review everything the leaver still holds. Completion reassigns it to the handover person, all in one go.'
                : t == 'joining'
                    ? 'Once the checklist is done and the portal user is linked, complete the joining to set up the employee record.'
                    : 'Review, then complete to apply the change.'),
            if (impactText.isNotEmpty) DetailSection('What this affects', children: [Text(impactText, style: const TextStyle(fontSize: 13))]),
            if (t == 'joining') ...[
              AppSelect<String>(
                  label: 'Employment type', value: employmentType, clearable: false,
                  options: [for (final x in types) Option(str(x), labelOf(employmentTypeLabels, x))],
                  onChanged: (o) => setS(() => employmentType = o?.value ?? employmentType)),
              AppTextField(label: 'Employee code', controller: code, hint: 'e.g. PRL-1042'),
              DateField(label: 'Probation ends', value: probationEnd, onChanged: (d) => setS(() => probationEnd = d)),
              const HintText('Probation, trainee and intern types (or a probation end date) start the employee on probation; others start active.'),
            ],
            if (t == 'exit') ...[
              AppSelect<int>(
                  label: needsHandover ? 'Handover to (required)' : 'Handover to', value: handover, options: users,
                  onChanged: (o) => setS(() => handover = o?.value)),
              if (impact != null && !needsHandover) const HintText('Nothing needs reassigning — a handover person is optional.'),
              if (blocked) CheckField(label: 'Complete anyway, with items still open', value: force, onChanged: (v) => setS(() => force = v)),
              if (force)
                AppTextField(label: 'Why', controller: forceReason, maxLines: 2, hint: 'e.g. employee absconded, laptop to be recovered via courier (kept on record)'),
            ],
            if (t == 'transfer' || t == 'promotion') ...[
              for (final fl in headFlags)
                CheckField(
                    label: "Remove approval role that doesn't carry over: ${fl['label']}",
                    value: clearFlags.contains(fl['flag']),
                    onChanged: (v) => setS(() => v ? clearFlags.add(str(fl['flag'])) : clearFlags.remove(fl['flag']))),
              if (fromDeptHeaded != null)
                AppSelect<String>(
                    label: 'Head slot in ${fromDeptHeaded['name']} (the old department)', value: headSlots, clearable: false,
                    options: const [Option('keep', 'Keep'), Option('remove', 'Remove them'), Option('reassign', 'Give it to the successor')],
                    onChanged: (o) => setS(() => headSlots = o?.value ?? 'keep')),
              if (pendingApprovals > 0)
                CheckField(
                    label: "Move the $pendingApprovals pending approval(s) (P2P and every module's open approval steps) to the successor",
                    value: reassign,
                    onChanged: (v) => setS(() => reassign = v)),
              if (headSlots == 'reassign' || reassign)
                AppSelect<int>(label: 'Successor', value: handover, options: users, onChanged: (o) => setS(() => handover = o?.value)),
            ],
            HintText(t == 'exit'
                ? "This closes $who's employment in one step: their approvals, reportees and department head slots move to the handover person, their own pending requests are cancelled, the portal account is deactivated and every signed-in session is ended. It can't be undone — a rehire needs a new joining event."
                : t == 'joining'
                    ? "This creates/updates $who's employee profile, sets the date of joining and applies the department, designation, plant and manager. The portal account is activated."
                    : t == 'confirmation'
                        ? '$who will be confirmed and moved from probation to active.'
                        : "The new department, plant, designation, grade and manager on this event will be applied to $who's profile and portal account."),
          ],
      onSave: () async {
        if (t == 'exit') {
          if (blocked && !force) throw 'There are pending checklist items or unreturned assets. Close them first, or tick "Complete anyway" and give the reason.';
          if (force && forceReason.text.trim().isEmpty) throw 'Write why the exit is being completed with items still open.';
          if (needsHandover && handover == null) throw 'Pick the handover person — the leaver still holds work that has to be reassigned.';
        }
        if ((t == 'transfer' || t == 'promotion') && (headSlots == 'reassign' || reassign) && handover == null) {
          throw 'Pick the successor to hand the department head slot / pending approvals to.';
        }
        if (t == 'joining' && e['user_id'] == null) throw 'Link the portal user first.';
        final payload = <String, dynamic>{};
        if (t == 'exit') payload.addAll({'handover_to_id': handover, 'force': force, 'force_reason': force ? forceReason.text.trim() : null});
        if (t == 'joining') {
          payload.addAll({'employment_type': employmentType, 'employee_code': textOrNull(code.text), 'probation_end_date': isoOrNull(probationEnd)});
        }
        if (t == 'transfer' || t == 'promotion') {
          payload.addAll({
            'clear_head_flags': clearFlags.toList(), 'department_head_slots': headSlots,
            'reassign_pending_approvals': reassign, 'handover_to_id': handover,
          });
        }
        done = mapOf(await Api.post('/hr/lifecycle/events/${e['id']}/complete', data: payload));
      });
  return ok ? done : null;
}