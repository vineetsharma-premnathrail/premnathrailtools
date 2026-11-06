import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';

// Portal: components/hr/employee/EmployeeProfileForm.tsx — the dynamic
// workforce form. Which fields show and which are required come from
// GET /hr/employees/form-rules, so the phone and the server always agree.

enum EmployeeFormMode { user, worker, newWorker }

const _fields = [
  'employee_code', 'full_name', 'worker_type', 'employment_type', 'designation_id', 'employment_status', 'date_of_joining',
  'branch_id', 'department_id', 'grade_id', 'reporting_manager_id', 'work_location', 'probation_status', 'probation_end_date',
  'confirmation_date', 'contract_start_date', 'contract_end_date', 'shift_id', 'weekly_off', 'attendance_policy',
  'personal_phone', 'personal_email', 'date_of_birth', 'gender', 'blood_group', 'marital_status', 'current_address', 'permanent_address',
  'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone',
  'work_email', 'portal_role_id', 'link_user_id',
  'contractor_name', 'contractor_worker_id', 'contractor_contact_person', 'contractor_contact_phone', 'contractor_agreement_ref', 'contractor_verification',
  'pan_number', 'aadhaar_last4', 'uan_number', 'esic_number', 'safety_induction_status', 'safety_induction_date',
  'medical_clearance_status', 'medical_fitness_date', 'date_of_exit', 'exit_reason', 'notes',
];
const _personal = [
  'personal_phone', 'personal_email', 'date_of_birth', 'gender', 'blood_group', 'marital_status', 'current_address', 'permanent_address',
  'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone',
];
const _statutory = ['pan_number', 'aadhaar_last4', 'uan_number', 'esic_number'];
const _bools = ['portal_access', 'ot_eligible', 'exit_clearance_done'];
const _ids = ['department_id', 'designation_id', 'grade_id', 'branch_id', 'shift_id', 'reporting_manager_id', 'portal_role_id', 'link_user_id'];
const _noLoginOnly = ['full_name', 'work_email', 'portal_access', 'portal_role_id', 'link_user_id'];
const _dates = [
  'date_of_joining', 'probation_end_date', 'confirmation_date', 'contract_start_date', 'contract_end_date', 'date_of_birth',
  'safety_induction_date', 'medical_fitness_date', 'date_of_exit',
];
const _multiline = ['current_address', 'permanent_address', 'notes', 'exit_reason'];
const _bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const _marital = {'single': 'Single', 'married': 'Married', 'divorced': 'Divorced', 'widowed': 'Widowed', 'other': 'Other'};
const _genders = {'male': 'Male', 'female': 'Female', 'other': 'Other'};
const _weekdays = {'mon': 'Mon', 'tue': 'Tue', 'wed': 'Wed', 'thu': 'Thu', 'fri': 'Fri', 'sat': 'Sat', 'sun': 'Sun'};

/// Same evaluation as backend workforce_rules.matches / applies.
bool _matches(Object? cond, Map<String, Object?> ctx) {
  if (cond == null) return true;
  if (cond is! List) return true;
  return cond.whereType<Map>().any((clause) => clause.entries.every((e) => (e.value is List) && (e.value as List).contains(ctx[e.key])));
}

bool _applies(Object? cond, Map<String, Object?> ctx) => cond == null || (cond is List && cond.isNotEmpty && _matches(cond, ctx));

/// Opens the employee record form. Returns the saved record or null.
Future<Json?> openEmployeeForm(BuildContext context, {required EmployeeFormMode mode, int? id}) async {
  final isWorker = mode != EmployeeFormMode.user;
  final isNew = mode == EmployeeFormMode.newWorker;
  Json? emp;
  Json lookups, rules;
  try {
    lookups = mapOf(await Api.get('/hr/masters/lookups', query: {'include_inactive': true}));
    rules = mapOf(await Api.get('/hr/employees/form-rules'));
    if (!isNew) emp = mapOf(await Api.get(isWorker ? '/hr/employees/workers/$id' : '/hr/employees/$id'));
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return null;
  }
  if (!context.mounted) return null;

  // Form state ('' = empty), same as the portal's toForm().
  final f = <String, String>{};
  for (final k in _fields) {
    final v = k == 'full_name' ? (emp?['name']) : (emp?[k]);
    f[k] = v == null ? '' : '$v';
  }
  for (final k in _bools) {
    final b = emp == null ? null : emp[k];
    f[k] = b == true ? 'true' : b == false ? 'false' : '';
  }
  if (f['employment_status']!.isEmpty) f['employment_status'] = 'active';
  if (f['worker_type']!.isEmpty) f['worker_type'] = emp != null ? 'office' : 'factory';
  if (f['probation_status']!.isEmpty) f['probation_status'] = 'not_applicable';
  var orgLocked = emp?['has_profile'] == true ? emp!['org_fields_locked'] != false : true;
  void applyDefaults(String wt) {
    final d = mapOf(mapOf(rules['defaults'])[wt]);
    d.forEach((k, v) => f[k] = '$v');
  }

  if (isNew) applyDefaults(f['worker_type']!);
  if (emp != null && emp['has_profile'] != true) {
    String norm(Object? x) => str(x).trim().toLowerCase();
    final dept = rowsOf(lookups['departments']).where((d) => norm(d['name']) == norm(emp!['user_department'])).firstOrNull;
    final desig = rowsOf(lookups['designations']).where((d) => norm(d['name']) == norm(emp!['user_designation'])).firstOrNull;
    if (dept != null && f['department_id']!.isEmpty) f['department_id'] = str(dept['id']);
    if (desig != null && f['designation_id']!.isEmpty) f['designation_id'] = str(desig['id']);
  }
  final initial = Map<String, String>.from(f);
  final initialLocked = orgLocked;
  final ctrls = <String, TextEditingController>{
    for (final k in _fields)
      if (!_dates.contains(k) && !_ids.contains(k)) k: TextEditingController(text: f[k]),
  };
  var draft = false;
  final hasProfile = !isNew && emp?['has_profile'] == true;
  final act = isNew || !hasProfile ? 'create' : 'edit';
  final hidden = <String>{
    if (!Perm.canFeature('hr', 'employees', 'personal', act)) ..._personal,
    if (!Perm.canFeature('hr', 'employees', 'statutory_ids', act)) ..._statutory,
    if (!Perm.canFeature('hr', 'employees', 'hr_notes', 'view')) 'notes',
  };
  final ruleBy = {for (final r in rowsOf(rules['fields'])) str(r['key']): r};
  Json? saved;

  String val(String k) => ctrls.containsKey(k) ? ctrls[k]!.text : (f[k] ?? '');
  Map<String, Object?> ctx() => {
        'worker_type': val('worker_type').isEmpty ? 'office' : val('worker_type'),
        'employment_type': val('employment_type').isEmpty ? null : val('employment_type'),
        'employment_status': val('employment_status').isEmpty ? null : val('employment_status'),
        'portal_access': f['portal_access'] == 'true',
        'has_login': !isWorker,
        'probation_status': val('probation_status').isEmpty ? 'not_applicable' : val('probation_status'),
        'safety_induction_status': val('safety_induction_status').isEmpty ? null : val('safety_induction_status'),
        'medical_clearance_status': val('medical_clearance_status').isEmpty ? null : val('medical_clearance_status'),
      };
  bool visible(String k) {
    if (hidden.contains(k)) return false;
    final r = ruleBy[k];
    return r == null || _matches(r['visible'], ctx());
  }

  bool required(String k) {
    final r = ruleBy[k];
    return r != null && visible(k) && _applies(r['required'], ctx());
  }

  String label(String k, [String? override]) => override ?? (ruleBy[k] == null ? humanize(k) : str(ruleBy[k]!['label']));

  List<Option<String>> idOpts(String key, String current, {bool withCode = false}) => [
        for (final o in rowsOf(lookups[key]))
          if (o['is_active'] != false || str(o['id']) == current)
            Option(str(o['id']), '${withCode && str(o['code']).isNotEmpty ? '${o['code']} · ' : ''}${o['name']}${o['is_active'] == false ? ' (inactive)' : ''}'),
      ];
  final selfUser = isWorker ? 0 : (id ?? 0);
  List<Option<String>> userOpts({bool all = false}) => [
        for (final u in rowsOf(lookups['users']))
          if ((all || asInt(u['id']) != selfUser) && (u['is_active'] != false || str(u['id']) == f['reporting_manager_id']))
            Option(str(u['id']), '${u['name']}${str(u['designation']).isEmpty ? '' : ' — ${u['designation']}'}${u['is_active'] == false ? ' (deactivated)' : ''}'),
      ];
  Map<String, String> coded(Object? m) => {for (final e in mapOf(m).entries) e.key: str(e.value)};

  final ok = await showFormSheet(context,
      title: isNew ? 'Add Employee' : '${isWorker || hasProfile ? 'Edit' : 'Create'} HR Record — ${emp?['name'] ?? ''}',
      saveLabel: isNew ? 'Create Employee' : hasProfile ? 'Save Changes' : 'Create Record',
      builder: (ctx0, setS) {
        Widget? text(String k, {String? hint, String? lbl, TextInputType? kb}) => !visible(k)
            ? null
            : AppTextField(
                label: label(k, lbl), controller: ctrls[k], required: required(k), hint: hint, keyboardType: kb,
                maxLines: _multiline.contains(k) ? 3 : 1, onChanged: (_) {});
        Widget? date(String k) => !visible(k)
            ? null
            : DateField(label: label(k), required: required(k), value: dateOf(f[k]), onChanged: (d) => setS(() => f[k] = d == null ? '' : apiDate(d)));
        Widget? choice(String k, Map<String, String> opts, {String? lbl, bool live = false}) => !visible(k)
            ? null
            : AppSelect<String>(
                label: label(k, lbl), required: required(k), value: val(k).isEmpty ? null : val(k), options: optionsOf(opts),
                onChanged: (o) => setS(() {
                      if (ctrls.containsKey(k)) {
                        ctrls[k]!.text = o?.value ?? '';
                      } else {
                        f[k] = o?.value ?? '';
                      }
                    }));
        Widget? idSel(String k, List<Option<String>> opts) => !visible(k)
            ? null
            : AppSelect<String>(label: label(k), required: required(k), value: f[k]!.isEmpty ? null : f[k], options: opts, onChanged: (o) => setS(() => f[k] = o?.value ?? ''));
        Widget? yesNo(String k, {bool unset = false}) => !visible(k)
            ? null
            : AppSelect<String>(
                label: label(k), required: required(k), value: f[k]!.isEmpty ? null : f[k],
                options: const [Option('true', 'Yes'), Option('false', 'No')], clearable: unset, onChanged: (o) => setS(() => f[k] = o?.value ?? ''));
        Widget head(String key, String n) => Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('$n${str(mapOf(rules['sections'])[key]).isEmpty ? humanize(key) : mapOf(rules['sections'])[key]}',
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Brand.heading)));
        final types = {...coded(rules['employment_types'])};
        if (val('employment_type').isNotEmpty && !types.containsKey(val('employment_type'))) {
          types[val('employment_type')] = labelOf(employmentTypeLabels, val('employment_type'));
        }
        final statuses = {
          for (final k in (rules['employment_statuses'] is List ? rules['employment_statuses'] as List : const []))
            if (isWorker || (initial['employment_status'] == 'exited' ? k == 'exited' : k != 'exited')) str(k): labelOf(employmentStatusLabels, k),
        };
        final relations = {for (final r in (rules['emergency_relations'] is List ? rules['emergency_relations'] as List : const [])) str(r): str(r)};
        if (val('emergency_contact_relation').isNotEmpty) relations[val('emergency_contact_relation')] = val('emergency_contact_relation');
        final exitLocked = !isWorker && val('employment_status') != 'exited';
        final clear = mapOf(rules['clearance_statuses']);
        final w = <Widget?>[
          const HintText('* required to save · hover-free summary: the server checks the same rules.'),
          head('classification', '1. '),
          text('employee_code', hint: 'Auto: WF-00001'),
          if (isWorker) text('full_name', hint: 'As on Aadhaar'),
          if (visible('worker_type'))
            AppSelect<String>(
                label: label('worker_type'), required: true, value: val('worker_type'), clearable: false, options: optionsOf(coded(rules['worker_types'])),
                onChanged: (o) => setS(() {
                      ctrls['worker_type']!.text = o?.value ?? 'office';
                      if (isNew) {
                        applyDefaults(ctrls['worker_type']!.text);
                        for (final e in mapOf(mapOf(rules['defaults'])[ctrls['worker_type']!.text]).entries) {
                          if (ctrls.containsKey(e.key)) ctrls[e.key]!.text = str(e.value);
                        }
                      }
                    })),
          choice('employment_type', types),
          idSel('designation_id', idOpts('designations', f['designation_id']!)),
          choice('employment_status', statuses),
          if (visible('employment_status') && !isWorker)
            HintText(val('employment_status') == 'exited' ? 'To rehire, raise a joining event in HR > Lifecycle.' : 'To record an exit, raise an exit event in HR > Lifecycle.'),
          date('date_of_joining'),
          head('organization', '2. '),
          idSel('branch_id', idOpts('branches', f['branch_id']!)),
          idSel('department_id', idOpts('departments', f['department_id']!)),
          idSel('grade_id', idOpts('grades', f['grade_id']!, withCode: true)),
          idSel('reporting_manager_id', userOpts()),
          if (visible('reporting_manager_id'))
            HintText(isWorker ? 'The portal user responsible for this person (internal supervisor).' : 'Leave, attendance, travel and expense approvals go to this person.'),
          text('work_location', hint: 'Shop floor / Office, Bay 2'),
          choice('probation_status', coded(rules['probation_statuses'])),
          date('probation_end_date'),
          date('confirmation_date'),
          date('contract_start_date'),
          date('contract_end_date'),
          idSel('shift_id', idOpts('shifts', f['shift_id']!, withCode: true)),
          choice('attendance_policy', {for (final k in mapOf(rules['attendance_policies']).keys) k: attendancePolicyLabels[k] ?? str(mapOf(rules['attendance_policies'])[k])}),
          yesNo('ot_eligible', unset: true),
          if (visible('weekly_off'))
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label('weekly_off'), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              Wrap(spacing: 6, children: [
                for (final d in _weekdays.entries)
                  FilterChip(
                    label: Text(d.value),
                    selected: val('weekly_off').split(',').contains(d.key),
                    onSelected: (on) => setS(() {
                      final cur = val('weekly_off').split(',').where((x) => x.isNotEmpty).toSet();
                      on ? cur.add(d.key) : cur.remove(d.key);
                      ctrls['weekly_off']!.text = _weekdays.keys.where(cur.contains).join(',');
                    }),
                  ),
              ]),
              if (val('weekly_off').isEmpty) const HintText('None picked = the plant’s working days decide.'),
            ]),
          if (_personal.any(visible)) head('personal', '3. '),
          text('personal_phone', hint: '+91 98765 43210', kb: TextInputType.phone),
          text('personal_email', hint: 'name@gmail.com', kb: TextInputType.emailAddress),
          date('date_of_birth'),
          choice('gender', _genders),
          choice('blood_group', {for (final b in _bloodGroups) b: b}),
          choice('marital_status', _marital),
          text('current_address'),
          text('permanent_address'),
          if (visible('permanent_address')) Align(alignment: Alignment.centerLeft, child: LinkAction('Same as current', () => setS(() => ctrls['permanent_address']!.text = ctrls['current_address']!.text))),
          text('emergency_contact_name'),
          choice('emergency_contact_relation', relations, lbl: 'Relationship'),
          text('emergency_contact_phone', lbl: 'Emergency Phone', kb: TextInputType.phone),
          if (visible('portal_access')) ...[
            head('access', '4. '),
            yesNo('portal_access'),
            if (f['portal_access'] == 'true')
              AppSelect<String>(
                  label: 'Linked User Account', value: f['link_user_id']!.isEmpty ? null : f['link_user_id'], options: userOpts(all: true),
                  onChanged: (o) => setS(() {
                        f['link_user_id'] = o?.value ?? '';
                        if (o != null) ctrls['work_email']!.text = '';
                      })),
            if (f['link_user_id']!.isEmpty) text('work_email', hint: 'name@premnathrail.com', kb: TextInputType.emailAddress),
            if (visible('portal_role_id'))
              AppSelect<String>(
                  label: label('portal_role_id'), required: required('portal_role_id'), value: f['portal_role_id']!.isEmpty ? null : f['portal_role_id'],
                  options: [for (final r in rowsOf(rules['roles'])) Option(str(r['id']), str(r['name']))],
                  onChanged: (o) => setS(() => f['portal_role_id'] = o?.value ?? '')),
            HintText('Login provisioning: ${labelOf(loginStatusLabels, str(emp?['login_status']).isNotEmpty ? emp!['login_status'] : (f['portal_access'] == 'true' ? 'not_provisioned' : 'not_required'))} (system-managed)'),
          ],
          if (visible('contractor_name')) ...[
            head('contractor', '5. '),
            text('contractor_name', hint: 'Contractor firm name'),
            text('contractor_worker_id'),
            text('contractor_agreement_ref', hint: 'WO-2026-014'),
            choice('contractor_verification', coded(rules['verification_statuses'])),
            text('contractor_contact_person'),
            text('contractor_contact_phone', hint: '+91 98765 43210', kb: TextInputType.phone),
          ],
          head('compliance', '7. '),
          text('pan_number', hint: 'ABCDE1234F'),
          text('aadhaar_last4', hint: '1234', kb: TextInputType.number),
          text('uan_number'),
          text('esic_number'),
          choice('safety_induction_status', coded(clear['safety_induction_status'])),
          date('safety_induction_date'),
          choice('medical_clearance_status', coded(clear['medical_clearance_status'])),
          date('medical_fitness_date'),
          const HintText('Statutory IDs are visible to HR and the employee only. Payroll stays in ADP — these are kept for reference and compliance checks.'),
          if (visible('date_of_exit') || visible('exit_reason')) ...[
            head('exit', ''),
            if (visible('date_of_exit')) exitLocked ? const HintText('Last working day: set when an Exit event is completed in HR > Lifecycle.') : date('date_of_exit'),
            text('exit_reason'),
            yesNo('exit_clearance_done'),
          ],
          head('admin', '8. '),
          text('notes'),
          if (!isWorker)
            CheckField(label: 'HR owns department, designation, manager and plant', value: orgLocked, onChanged: (v) => setS(() => orgLocked = v)),
          if (!isWorker)
            const HintText('When ticked, Azure AD login and "Sync Azure Users" won\'t overwrite these fields. Untick to let Azure keep them in step again.'),
          const Divider(),
          CheckField(label: 'Save as draft (skip the required-field checks)', value: draft, onChanged: (v) => setS(() => draft = v)),
          const HintText('A draft record shows as Draft until saved normally. Documents are uploaded on the Documents tab after saving.'),
        ];
        return w.whereType<Widget>().toList();
      },
      onSave: () async {
        for (final e in ctrls.entries) {
          f[e.key] = e.value.text;
        }
        final p = <String>[];
        if (isWorker && f['full_name']!.trim().isEmpty) p.add('Full name is required — even a draft needs to say who it is.');
        if (!draft) {
          final missing = [
            for (final r in rowsOf(rules['fields']))
              if (r['key'] != 'documents' && required(str(r['key'])))
                if (!(r['key'] == 'work_email' && f['link_user_id']!.isNotEmpty))
                  if (_bools.contains(r['key']) ? f[str(r['key'])] != 'true' : (f[str(r['key'])] ?? '').trim().isEmpty) str(r['label']),
          ];
          if (missing.isNotEmpty) {
            p.add('Required for ${workerTypeLabels[f['worker_type']] ?? 'this worker category'}: ${missing.join(', ')}. Fill them in, or tick Save as draft to finish later.');
          }
        }
        if (f['aadhaar_last4']!.isNotEmpty && !RegExp(r'^\d{4}$').hasMatch(f['aadhaar_last4']!)) {
          p.add('Aadhaar: enter only the last 4 digits. The full Aadhaar number is never stored.');
        }
        if (f['pan_number']!.isNotEmpty && !RegExp(r'^[A-Za-z]{5}\d{4}[A-Za-z]$').hasMatch(f['pan_number']!.replaceAll(' ', ''))) {
          p.add('PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).');
        }
        for (final k in const [('personal_email', 'Personal email'), ('work_email', 'Work email')]) {
          if (f[k.$1]!.isNotEmpty && !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(f[k.$1]!)) p.add('${k.$2} is not a valid email address.');
        }
        if (f['contract_start_date']!.isNotEmpty && f['contract_end_date']!.isNotEmpty && f['contract_end_date']!.compareTo(f['contract_start_date']!) < 0) {
          p.add('Contract end date is before the contract start date.');
        }
        for (final k in const [('probation_end_date', 'Probation end date'), ('confirmation_date', 'Confirmation date'), ('date_of_exit', 'Last working day')]) {
          if (f['date_of_joining']!.isNotEmpty && f[k.$1]!.isNotEmpty && f[k.$1]!.compareTo(f['date_of_joining']!) < 0) p.add('${k.$2} is before the date of joining.');
        }
        if (f['date_of_birth']!.isNotEmpty && f['date_of_birth']!.compareTo(todayIso()) >= 0) p.add('Date of birth must be in the past.');
        if (p.isNotEmpty) throw p.join(' ');
        final payload = <String, dynamic>{};
        for (final k in _fields) {
          if (!isWorker && _noLoginOnly.contains(k)) continue;
          if (hidden.contains(k)) continue;
          if (hasProfile && f[k] == initial[k]) continue;
          final raw = f[k]!.trim();
          payload[k] = _ids.contains(k) ? (raw.isEmpty ? null : int.tryParse(raw)) : (raw.isEmpty ? null : raw);
        }
        for (final k in _bools) {
          if (!isWorker && _noLoginOnly.contains(k)) continue;
          if (hasProfile && f[k] == initial[k]) continue;
          payload[k] = f[k]!.isEmpty ? null : f[k] == 'true';
        }
        for (final k in _fields) {
          if (RegExp(r'^contract(or)?_|^work_email$|^portal_role_id$').hasMatch(k) && !visible(k) && ((initial[k] ?? '').isNotEmpty || (f[k] ?? '').isNotEmpty)) {
            payload[k] = null;
          }
        }
        if (payload['link_user_id'] == null) payload.remove('link_user_id');
        if (!isWorker && (!hasProfile || orgLocked != initialLocked)) payload['org_fields_locked'] = orgLocked;
        if (payload['employment_status'] == null && !hasProfile) payload['employment_status'] = f['employment_status']!.isEmpty ? 'active' : f['employment_status'];
        payload['is_draft'] = draft;
        saved = mapOf(isNew
            ? await Api.post('/hr/employees/workers', data: payload)
            : await Api.patch(isWorker ? '/hr/employees/workers/$id' : '/hr/employees/$id', data: payload));
      });
  return ok ? saved : null;
}