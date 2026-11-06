import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'documents.dart';
import 'employee_form.dart';
import 'employee_tabs.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/employees (list, [id], workers/[id]) +
// components/hr/employee/EmployeeProfileView.tsx

/// "2 yrs 3 mo" since joining (to the exit date for someone who left).
String? tenure(Json p) {
  final start = dateOf(p['date_of_joining']);
  if (start == null) return null;
  final end = dateOf(p['date_of_exit']) ?? DateTime.now();
  var months = (end.year - start.year) * 12 + (end.month - start.month);
  if (end.day < start.day) months -= 1;
  if (months < 0) return null;
  final y = months ~/ 12, m = months % 12;
  return [if (y > 0) '$y yr${y > 1 ? 's' : ''}', if (m > 0) '$m mo', if (y == 0 && m == 0) 'under a month'].join(' ');
}

/// Name, status and summary block (portal EmployeeHeaderSummary).
Widget employeeHeader(Json p) {
  final role = joinNonEmpty([p['designation_name'], p['department_name'], p['branch_name']]);
  final t = tenure(p);
  final facts = [
    if (str(p['employee_code']).isNotEmpty) 'ID ${p['employee_code']}',
    str(p['date_of_joining']).isNotEmpty ? 'Joined ${fmtDate(p['date_of_joining'])}${t == null ? '' : ' ($t)'}' : 'Joining date not set',
    if (str(p['reporting_manager_name']).isNotEmpty) '${p['has_login'] == false ? 'Supervisor' : 'Reports to'} ${p['reporting_manager_name']}',
  ];
  final st = str(p['employment_status']);
  return DetailSection(str(p['name']),
      action: p['has_profile'] == true || p['has_login'] == false
          ? HrPill(labelOf(employmentStatusLabels, st), employmentStatusHex[st] ?? '#64748B')
          : const HrPill('No HR profile', '#D97706'),
      children: [
        Text(role.isEmpty ? 'No designation or department set yet' : role, style: const TextStyle(fontSize: 14, color: Brand.body)),
        const SizedBox(height: 2),
        HintText(facts.join(' · ')),
        if (p['is_active'] == false && p['has_login'] != false) const Padding(padding: EdgeInsets.only(top: 6), child: HrPill('Account deactivated', '#64748B')),
      ]);
}

/// Read-only employee record (portal EmployeeProfileView). `hr` = HR view.
List<Widget> profileSections(Json p, {required bool hr}) {
  bool see(String f) => !hr || Perm.canFeature('hr', 'employees', f, 'view');
  final seePersonal = see('personal');
  final seeStat = see('statutory_ids');
  final wt = str(p['worker_type']);
  final nonOffice = wt.isNotEmpty && wt != 'office';
  final exited = str(p['date_of_exit']).isNotEmpty || str(p['exit_reason']).isNotEmpty;
  final rs = str(p['record_status']);
  String? d(Object? v) => str(v).isEmpty ? null : fmtDate(v);
  String st(Object? v) => str(v).isEmpty ? '' : humanize(v);
  return [
    if (hr && rs.isNotEmpty && rs != 'complete')
      padded(WarnBanner('Record ${labelOf(recordStatusLabels, rs)}${rs == 'draft' ? ' — saved without the required-field checks.' : ' — some details are still missing.'}'
          '${p['missing_fields'] is List && (p['missing_fields'] as List).isNotEmpty ? '\nMissing: ${(p['missing_fields'] as List).join(', ')}' : ''}')),
    DetailSection('Employment', children: [
      FieldRow('Worker category', labelOf(workerTypeLabels, wt.isEmpty ? 'office' : wt)),
      FieldRow('Employment type', str(p['employment_type']).isEmpty ? null : labelOf(employmentTypeLabels, p['employment_type'])),
      FieldRow('Grade', str(p['grade_code']).isEmpty ? null : '${p['grade_code']} · ${p['grade_name']}'),
      FieldRow('Work location', str(p['work_location']).isNotEmpty ? p['work_location'] : p['office_location']),
      FieldRow('Shift', p['shift_name']),
      FieldRow('Probation', '${labelOf(probationStatusLabels, str(p['probation_status']).isEmpty ? 'not_applicable' : p['probation_status'])}'
          '${p['probation_status'] == 'on_probation' && str(p['probation_end_date']).isNotEmpty ? ' — ends ${fmtDate(p['probation_end_date'])}' : ''}'),
      if (str(p['confirmation_date']).isNotEmpty) FieldRow('Confirmed on', fmtDate(p['confirmation_date'])),
      if (str(p['contract_start_date']).isNotEmpty || str(p['contract_end_date']).isNotEmpty)
        FieldRow('Contract period', '${fmtDate(p['contract_start_date'])} → ${fmtDate(p['contract_end_date'])}'),
      if (p['has_login'] != false) FieldRow('Direct reports', numTxt(p['direct_reports_count'])),
    ]),
    if (exited)
      DetailSection('Exit', children: [
        FieldRow('Last working day', d(p['date_of_exit'])),
        FieldRow('Exit reason', p['exit_reason']),
        if (p['has_login'] == false && p['employment_status'] == 'exited') FieldRow('Clearance', p['exit_clearance_done'] == true ? 'Complete' : 'Pending'),
      ]),
    if (hr)
      DetailSection('Attendance setup', children: [
        FieldRow('Attendance policy', str(p['attendance_policy']).isEmpty ? null : labelOf(attendancePolicyLabels, p['attendance_policy'])),
        FieldRow('Weekly off', str(p['weekly_off']).isEmpty ? 'As per plant calendar' : str(p['weekly_off']).split(',').map(humanize).join(', ')),
        FieldRow('Overtime eligible', p['ot_eligible'] == true ? 'Yes' : p['ot_eligible'] == false ? 'No' : 'Not set (treated as eligible)'),
      ]),
    if (wt == 'contract' || str(p['contractor_name']).isNotEmpty)
      DetailSection('Contractor', children: [
        FieldRow('Contractor company', p['contractor_name']),
        FieldRow('Contractor worker ID', p['contractor_worker_id']),
        FieldRow('Contact person', joinNonEmpty([p['contractor_contact_person'], p['contractor_contact_phone']])),
        FieldRow('Agreement / work order', p['contractor_agreement_ref']),
        FieldRow('Verification', str(p['contractor_verification']).isEmpty ? null : humanize(p['contractor_verification'])),
      ]),
    if (seePersonal || p['has_login'] != false)
      DetailSection('Contact & personal details', children: [
        if (p['has_login'] != false) FieldRow('Work email', p['email']),
        if (p['has_login'] != false) FieldRow('Work phone', p['phone']),
        if (seePersonal) ...[
          FieldRow('Personal email', p['personal_email']),
          FieldRow('Personal phone', p['personal_phone']),
          FieldRow('Gender', str(p['gender']).isEmpty ? null : humanize(p['gender'])),
          FieldRow('Date of birth', d(p['date_of_birth'])),
          FieldRow('Blood group', p['blood_group']),
          FieldRow('Marital status', str(p['marital_status']).isEmpty ? null : humanize(p['marital_status'])),
          FieldRow('Current address', p['current_address']),
          FieldRow('Permanent address',
              str(p['permanent_address']).isNotEmpty && str(p['permanent_address']).trim() == str(p['current_address']).trim() ? 'Same as current address' : p['permanent_address']),
        ],
      ]),
    if (seePersonal)
      DetailSection('Emergency contact', children: [
        FieldRow('Name', str(p['emergency_contact_name']).isEmpty ? null : '${p['emergency_contact_name']}${str(p['emergency_contact_relation']).isEmpty ? '' : ' (${p['emergency_contact_relation']})'}'),
        FieldRow('Phone', p['emergency_contact_phone']),
      ]),
    if (seeStat || nonOffice || hr)
      DetailSection(seeStat ? 'Statutory IDs & compliance' : 'Compliance', children: [
        if (seeStat) ...[
          FieldRow('PAN', p['pan_number']),
          FieldRow('Aadhaar', str(p['aadhaar_last4']).isEmpty ? null : 'XXXX XXXX ${p['aadhaar_last4']}'),
          FieldRow('UAN (PF)', p['uan_number']),
          FieldRow('ESIC number', p['esic_number']),
        ],
        if (nonOffice) FieldRow('Safety induction', joinNonEmpty([st(p['safety_induction_status']), d(p['safety_induction_date'])])),
        if (nonOffice) FieldRow('Medical clearance', joinNonEmpty([st(p['medical_clearance_status']), d(p['medical_fitness_date'])])),
        if (hr) FieldRow('Documents received', '${p['documents_received'] is List ? (p['documents_received'] as List).length : 0}'),
      ]),
    if (hr)
      DetailSection('HR notes & account', children: [
        if (p['has_login'] == false) ...[
          FieldRow('Portal account', p['portal_access'] == true && str(p['work_email']).isNotEmpty
              ? 'Waiting for ${p['work_email']} to sign in for the first time'
              : labelOf(loginStatusLabels, str(p['login_status']).isEmpty ? 'not_required' : p['login_status'])),
          if (str(p['portal_role_name']).isNotEmpty) FieldRow('Application role', p['portal_role_name']),
        ] else ...[
          FieldRow('Portal account', p['is_active'] == true ? 'Active' : 'Deactivated'),
          FieldRow('Org fields owned by', p['has_profile'] == true ? (p['org_fields_locked'] == true ? 'HR (Azure sync will not overwrite)' : 'Azure AD sync') : null),
          FieldRow('Department on user account', p['user_department']),
          FieldRow('Designation on user account', p['user_designation']),
        ],
        if (see('hr_notes')) FieldRow('HR remarks', p['notes']),
        FieldRow('Created', str(p['created_at']).isEmpty ? null : '${fmtDate(p['created_at'])}${str(p['created_by_name']).isEmpty ? '' : ' · ${p['created_by_name']}'}'),
        FieldRow('Last updated', str(p['updated_at']).isEmpty ? null : '${fmtDate(p['updated_at'])}${str(p['updated_by_name']).isEmpty ? '' : ' · ${p['updated_by_name']}'}'),
      ]),
  ];
}

/// HR › Employees list.
class EmployeesPage extends StatefulWidget {
  const EmployeesPage({super.key, required this.openOrgChart});
  final VoidCallback openOrgChart;

  @override
  State<EmployeesPage> createState() => _EmployeesPageState();
}

class _EmployeesPageState extends State<EmployeesPage> {
  Json? _lookups;
  Json? _stats;
  int? _dept, _desig, _branch;
  String? _status, _type, _worker, _profile;
  String _account = 'active';
  int _rev = 0;

  @override
  void initState() {
    super.initState();
    Api.get('/hr/masters/lookups', query: {'include_inactive': true}).then((l) {
      if (mounted) setState(() => _lookups = mapOf(l));
    }, onError: (_) {});
  }

  List<Option<int>> _lk(String key) => [
        for (final r in rowsOf(_lookups?[key])) Option(asInt(r['id']) ?? 0, '${r['name']}${r['is_active'] == false ? ' (inactive)' : ''}'),
      ];

  void _clear() => setState(() {
        _dept = _desig = _branch = null;
        _status = _type = _worker = _profile = null;
        _account = 'active';
      });

  Future<void> _open(Json e) async {
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => e['has_login'] == false
            ? EmployeeDetailScreen(profileId: asInt(e['profile_id']))
            : EmployeeDetailScreen(userId: asInt(e['user_id']))));
    setState(() => _rev++);
  }

  @override
  Widget build(BuildContext context) {
    final filters = _dept != null || _desig != null || _branch != null || _status != null || _type != null || _worker != null || _profile != null || _account != 'active';
    final s = _stats;
    return ApiListView(
      key: ValueKey('emp_${_dept}_${_desig}_${_branch}_${_status}_${_type}_${_worker}_${_profile}_${_account}_$_rev'),
      paged: true,
      pageSize: 50,
      searchHint: 'Search name, email or employee code…',
      load: (page, q) async {
        final d = mapOf(await Api.get('/hr/employees', query: {
          'page': page, 'page_size': 50, 'sort': 'name', 'order': 'asc', 'user_status': _account, 'search': q,
          'department_id': _dept, 'branch_id': _branch, 'designation_id': _desig, 'employment_status': _status,
          'employment_type': _type, 'worker_type': _worker, if (_profile != null) 'has_profile': _profile == 'yes',
        }));
        if (page == 1 && mounted) setState(() => _stats = d);
        return ApiPage.from(d);
      },
      emptyText: filters ? 'Nobody matches these filters.' : 'No employees found. People appear here once they sign in to the portal or an admin runs "Sync Azure Users".',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        PageHeader('Employees',
            subtitle: 'Every portal user with their HR profile, plus workshop and contract staff who have no portal login. Open someone to view or edit their record.',
            actions: [
              if (Perm.can('hr', 'employees', 'create'))
                headerButton('Add Employee', () async {
                  final r = await openEmployeeForm(context, mode: EmployeeFormMode.newWorker);
                  if (r != null && mounted) setState(() => _rev++);
                }),
            ]),
        padded(Align(alignment: Alignment.centerLeft, child: headerButton('View Org Chart', widget.openOrgChart, primary: false))),
        if (s != null)
          TileGrid([
            StatTile(label: 'Active people', value: numTxt(s['total_users']), onTap: _clear),
            StatTile(label: 'With HR profile', value: numTxt(s['with_profile']), color: hexColor('#16A34A'), selected: _profile == 'yes',
                onTap: () => setState(() => _profile = 'yes')),
            StatTile(label: 'Profile missing', value: numTxt(s['without_profile']), color: toNum(s['without_profile']) > 0 ? hexColor('#EA580C') : null,
                selected: _profile == 'no', onTap: () => setState(() => _profile = 'no')),
          ]),
        ExpansionTile(
          title: Text(filters ? 'Filters (on)' : 'Filters', style: const TextStyle(fontWeight: FontWeight.w600)),
          tilePadding: const EdgeInsets.symmetric(horizontal: 16),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          children: [
            for (final w in <Widget>[
              AppSelect<int>(label: 'All departments', value: _dept, options: _lk('departments'), onChanged: (o) => setState(() => _dept = o?.value)),
              AppSelect<int>(label: 'All designations', value: _desig, options: _lk('designations'), onChanged: (o) => setState(() => _desig = o?.value)),
              AppSelect<int>(label: 'All plants', value: _branch, options: _lk('branches'), onChanged: (o) => setState(() => _branch = o?.value)),
              AppSelect<String>(label: 'Any status', value: _status, options: optionsOf(employmentStatusLabels), onChanged: (o) => setState(() => _status = o?.value)),
              AppSelect<String>(label: 'Any type', value: _type, options: optionsOf(employmentTypeLabels), onChanged: (o) => setState(() => _type = o?.value)),
              AppSelect<String>(label: 'Any worker type', value: _worker, options: optionsOf(workerTypeLabels), onChanged: (o) => setState(() => _worker = o?.value)),
              AppSelect<String>(label: 'Profile: any', value: _profile, options: const [Option('yes', 'Has HR profile'), Option('no', 'Profile missing')],
                  onChanged: (o) => setState(() => _profile = o?.value)),
              AppSelect<String>(label: 'Accounts', value: _account, clearable: false,
                  options: const [Option('active', 'Active accounts'), Option('inactive', 'Deactivated accounts'), Option('all', 'All accounts')],
                  onChanged: (o) => setState(() => _account = o?.value ?? 'active')),
              if (filters) Align(alignment: Alignment.centerLeft, child: LinkAction('Clear filters', _clear)),
            ])
              Padding(padding: const EdgeInsets.only(bottom: 8), child: w),
          ],
        ),
      ]),
      itemBuilder: (ctx, e, reload) {
        final today = todayIso();
        final noLogin = e['has_login'] == false;
        final st = str(e['employment_status']);
        final rs = str(e['record_status']);
        return RecordCard(
          code: str(e['employee_code']),
          title: str(e['name']),
          subtitle: noLogin
              ? '${labelOf(workerTypeLabels, str(e['worker_type']).isEmpty ? 'other' : e['worker_type'])}${str(e['contractor_name']).isEmpty ? '' : ' · ${e['contractor_name']}'} · no portal login'
              : '${e['email']}${str(e['worker_type']).isNotEmpty && e['worker_type'] != 'office' ? ' · ${labelOf(workerTypeLabels, e['worker_type'])}' : ''}',
          trailing: e['has_profile'] != true && !noLogin
              ? const HrPill('No HR profile', '#D97706')
              : HrPill(labelOf(employmentStatusLabels, st), employmentStatusHex[st] ?? '#64748B'),
          meta: [
            ('Department', str(e['department_name']).isEmpty ? '—' : str(e['department_name'])),
            ('Designation', '${str(e['designation_name']).isEmpty ? '—' : e['designation_name']}${str(e['grade_name']).isEmpty ? '' : ' · ${e['grade_name']}'}'),
            ('Plant', str(e['branch_name']).isEmpty ? '—' : str(e['branch_name'])),
            ('Manager', str(e['reporting_manager_name']).isEmpty ? '—' : str(e['reporting_manager_name'])),
            ('Joined', fmtDate(e['date_of_joining'])),
            if (e['is_active'] == false && !noLogin) ('Account', 'Deactivated'),
            if (rs.isNotEmpty && rs != 'complete') ('Record', labelOf(recordStatusLabels, rs)),
            if (str(e['contract_end_date']).isNotEmpty && str(e['contract_end_date']).compareTo(today) < 0 && st != 'exited')
              ('Contract', 'Expired ${fmtDate(e['contract_end_date'])}'),
          ],
          onTap: () => _open(e),
        );
      },
    );
  }
}

/// One employee (portal account by `userId`, or no-login worker by `profileId`).
class EmployeeDetailScreen extends StatefulWidget {
  const EmployeeDetailScreen({super.key, this.userId, this.profileId});
  final int? userId;
  final int? profileId;

  @override
  State<EmployeeDetailScreen> createState() => _EmployeeDetailScreenState();
}

class _EmployeeDetailScreenState extends State<EmployeeDetailScreen> {
  Json? _p;
  Object? _error;
  int _tab = 0;
  int _rev = 0;

  bool get _worker => widget.userId == null;
  String get _base => _worker ? '/hr/employees/workers/${widget.profileId}' : '/hr/employees/${widget.userId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = mapOf(await Api.get(_base));
      if (mounted) setState(() { _p = p; _error = null; _rev++; });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    if (p == null) return SubPage(title: 'Employee', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    final tabs = <(String, String)>[
      ('profile', 'Profile'),
      if (!_worker) ...[
        for (final t in const [('assignment', 'Assignment history'), ('documents', 'Documents'), ('lifecycle', 'Lifecycle'), ('leave', 'Leave'), ('attendance', 'Attendance'), ('assets', 'Assets')])
          if (Perm.canFeature('hr', 'employees', t.$1, 'view')) t,
      ] else if (Perm.canFeature('hr', 'employees', 'documents', 'view'))
        ('documents', 'Documents'),
    ];
    if (_tab >= tabs.length) _tab = 0;
    final key = tabs[_tab].$1;
    final hasProfile = p['has_profile'] == true || _worker;
    final canEdit = Perm.can('hr', 'employees', hasProfile ? 'edit' : 'create');
    Widget body;
    switch (key) {
      case 'documents':
        body = DocumentsSection(key: ValueKey('docs$_rev'), base: _base, hrMode: true);
      case 'assignment':
        body = AssignmentHistory(userId: widget.userId!);
      case 'lifecycle':
        body = EmployeeLifecycleTab(userId: widget.userId!, userName: str(p['name']));
      case 'leave':
        body = EmployeeLeaveTab(userId: widget.userId!);
      case 'attendance':
        body = EmployeeAttendanceTab(userId: widget.userId!);
      case 'assets':
        body = EmployeeAssetsTab(userId: widget.userId!);
      default:
        body = Column(children: [
          if (!hasProfile)
            padded(const WarnBanner(
                'No HR profile yet — only the details synced from Azure are shown below. Use Create HR Profile to record employee code, grade, shift, employment type, statutory IDs and emergency contact.')),
          ...profileSections(p, hr: true),
        ]);
    }
    return SubPage(
      title: str(p['name']),
      actions: [
        if (canEdit)
          TextButton(
            onPressed: () async {
              final r = await openEmployeeForm(context,
                  mode: _worker ? EmployeeFormMode.worker : EmployeeFormMode.user, id: _worker ? widget.profileId : widget.userId);
              if (r != null) _load();
            },
            child: Text(hasProfile ? 'Edit Profile' : 'Create HR Profile'),
          ),
      ],
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 40), children: [
          employeeHeader(p),
          if (tabs.length > 1) SubTabs(labels: [for (final t in tabs) t.$2], index: _tab, onChanged: (i) => setState(() => _tab = i)),
          const SizedBox(height: 8),
          body,
        ]),
      ),
    );
  }
}