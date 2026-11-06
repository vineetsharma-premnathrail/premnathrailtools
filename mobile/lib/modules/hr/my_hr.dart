import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/form.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'assets.dart';
import 'attendance.dart';
import 'claims.dart';
import 'documents.dart';
import 'employees.dart';
import 'hr_common.dart';
import 'leave.dart';
import 'travel.dart';
import 'visitors.dart';

// Portal: app/dashboard/hr/me/** + components/hr/MyHrTabs.tsx

/// My HR with its own pill row: Profile, Leave, Attendance, Travel,
/// Expense Claims, My Assets, Visitors.
class MyHrPage extends StatefulWidget {
  const MyHrPage({super.key});

  @override
  State<MyHrPage> createState() => _MyHrPageState();
}

class _MyHrPageState extends State<MyHrPage> {
  int _tab = 0;
  static const _labels = ['Profile', 'Leave', 'Attendance', 'Travel', 'Expense Claims', 'My Assets', 'Visitors'];

  @override
  Widget build(BuildContext context) {
    final Widget page = switch (_tab) {
      1 => const MyLeavePage(),
      2 => const MyAttendancePage(),
      3 => MyTravelPage(openClaims: () => setState(() => _tab = 4)),
      4 => const MyClaimsPage(),
      5 => const MyAssetsPage(),
      6 => const VisitorsPage(),
      _ => const MyProfilePage(),
    };
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SubTabs(labels: _labels, index: _tab, onChanged: (i) => setState(() => _tab = i)),
      const Divider(height: 1),
      Expanded(child: KeyedSubtree(key: ValueKey(_tab), child: page)),
    ]);
  }
}

const _personalFields = [
  'personal_email', 'personal_phone', 'current_address', 'permanent_address',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'blood_group', 'marital_status',
];
const _bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const _marital = {'single': 'Single', 'married': 'Married', 'divorced': 'Divorced', 'widowed': 'Widowed', 'other': 'Other'};

/// My HR › Profile.
class MyProfilePage extends StatefulWidget {
  const MyProfilePage({super.key});

  @override
  State<MyProfilePage> createState() => _MyProfilePageState();
}

class _MyProfilePageState extends State<MyProfilePage> {
  Json? _me;
  Object? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final me = mapOf(await Api.get('/hr/employees/me'));
      if (mounted) setState(() { _me = me; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _edit() async {
    final me = _me!;
    final c = {for (final k in _personalFields) k: TextEditingController(text: str(me[k]))};
    String? blood = textOrNull(str(me['blood_group']));
    String? marital = textOrNull(str(me['marital_status']));
    Json? res;
    final ok = await showFormSheet(context,
        title: 'Edit My Details',
        saveLabel: 'Save My Details',
        builder: (ctx, setS) => [
              const HintText('For department, designation, manager, joining date or ID numbers, ask HR.'),
              const Caps('Personal'),
              AppTextField(label: 'Personal Email', controller: c['personal_email'], hint: 'name@gmail.com', keyboardType: TextInputType.emailAddress),
              AppTextField(label: 'Personal Phone', controller: c['personal_phone'], hint: '+91 98765 43210', keyboardType: TextInputType.phone),
              AppSelect<String>(label: 'Blood Group', value: blood, options: [for (final b in _bloodGroups) Option(b, b)], onChanged: (o) => setS(() => blood = o?.value)),
              AppSelect<String>(label: 'Marital Status', value: marital, options: optionsOf(_marital), onChanged: (o) => setS(() => marital = o?.value)),
              const Caps('Addresses'),
              AppTextField(label: 'Current Address', controller: c['current_address'], maxLines: 3),
              AppTextField(label: 'Permanent Address', controller: c['permanent_address'], maxLines: 3),
              Align(
                alignment: Alignment.centerLeft,
                child: LinkAction('Same as current', () => setS(() => c['permanent_address']!.text = c['current_address']!.text)),
              ),
              const Caps('Emergency Contact'),
              AppTextField(label: 'Name', controller: c['emergency_contact_name']),
              AppTextField(label: 'Relation', controller: c['emergency_contact_relation'], hint: 'Spouse / Father'),
              AppTextField(label: 'Emergency Phone', controller: c['emergency_contact_phone'], keyboardType: TextInputType.phone),
              const HintText('HR sees the change straight away.'),
            ],
        onSave: () async {
          c['blood_group'] = TextEditingController(text: blood ?? '');
          c['marital_status'] = TextEditingController(text: marital ?? '');
          final p = <String>[];
          final email = c['personal_email']!.text.trim();
          if (email.isNotEmpty && !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
            p.add('Personal email is not a valid email address (e.g. name@gmail.com).');
          }
          for (final k in const [('personal_phone', 'Personal phone'), ('emergency_contact_phone', 'Emergency contact phone')]) {
            final v = c[k.$1]!.text.trim();
            if (v.isNotEmpty && !RegExp(r'^\+?[0-9][0-9\s-]{6,18}$').hasMatch(v)) {
              p.add('${k.$2} should contain digits only, optionally starting with + and the country code.');
            }
          }
          if (p.isNotEmpty) throw p.join(' ');
          final payload = <String, dynamic>{};
          for (final k in _personalFields) {
            if (c[k]!.text != str(me[k])) payload[k] = textOrNull(c[k]!.text);
          }
          res = payload.isEmpty ? me : mapOf(await Api.patch('/hr/employees/me', data: payload));
        });
    if (ok && res != null && mounted) {
      setState(() { _me = res; _notice = 'Your personal details were saved. HR sees the change straight away.'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = _me;
    if (me == null) return _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 88), children: [
        employeeHeader(me),
        if (Perm.can('hr', 'me', 'edit'))
          padded(Align(alignment: Alignment.centerLeft, child: headerButton('Edit My Details', _edit, icon: Icons.edit_outlined))),
        if (_notice != null) padded(NoticeBanner(_notice!)),
        if (me['has_profile'] != true)
          padded(const WarnBanner(
              "HR hasn't completed your employee record yet, so only the details from your Microsoft account are shown. You can still add your personal and emergency-contact details; for anything else (employee code, department, manager, IDs) contact HR.")),
        ...profileSections(me, hr: false),
        const DocumentsSection(base: '/hr/employees/me', hrMode: false),
      ]),
    );
  }
}