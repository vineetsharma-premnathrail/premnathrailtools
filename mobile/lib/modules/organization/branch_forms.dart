import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';

/// Branch create / edit sheets - native copy of PlantForm.tsx and the
/// sections of plants/[id]/edit/page.tsx (one sheet per section).

const branchStatusLabels = {
  'active': 'Active',
  'inactive': 'Inactive',
  'under_maintenance': 'Under Maintenance',
  'under_construction': 'Under Construction',
  'closed': 'Closed',
};

Color branchStatusColor(Object? status) => switch (status) {
      'active' => const Color(0xFF16A34A),
      'inactive' => const Color(0xFF78716C),
      'under_maintenance' => const Color(0xFFF59E0B),
      'under_construction' => const Color(0xFF2563EB),
      'closed' => const Color(0xFFDC2626),
      _ => const Color(0xFF78716C),
    };

String branchStatusLabel(Object? status) => branchStatusLabels[status] ?? humanize(status);

const _timeZones = [
  'Asia/Kolkata',
  'UTC',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Colombo',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Nairobi',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
];

DateTime? _date(Object? v) => v is String && v.isNotEmpty ? DateTime.tryParse(v) : null;
String? _apiDate(DateTime? d) => d == null ? null : apiDate(d);
String? _orNull(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
TextEditingController _ctl(Object? v) => TextEditingController(text: v == null ? '' : v.toString());

/// Small heading inside a form sheet (portal SheetSection title).
Widget _section(String title) => Padding(padding: const EdgeInsets.only(top: 4), child: Caps(title, color: Brand.heading));

/// Grey help line under a field (portal sheetHint).
Widget _hint(String text) => Text(text, style: const TextStyle(fontSize: 12, color: Brand.muted));

Widget _userSelect(String label, int? value, String? valueLabel, ValueChanged<Option<int>?> onChanged) =>
    AppSelect<int>(label: label, value: value, valueLabel: valueLabel, loadOptions: loadUserOptions, onChanged: onChanged);

List<Option<String>> _statusOptions(Map<String, String> m) => [for (final e in m.entries) Option(e.key, e.value)];

// ── New branch (PlantForm) ────────────────────────────────────────────────────

/// "Add Branch": basic information only; returns the created branch.
Future<Json?> showBranchCreateSheet(BuildContext context) async {
  Json? company;
  try {
    company = jsonMap(await Api.get('/organization/company'));
    if (company['id'] == null) company = null;
  } catch (_) {
    company = null;
  }
  if (!context.mounted) return null;
  final name = TextEditingController();
  final code = TextEditingController();
  final type = TextEditingController();
  final industry = TextEditingController();
  final description = TextEditingController();
  final remarks = TextEditingController();
  int? companyId = asInt(company?['id']);
  String status = 'active';
  int? headId, managerId;
  String? headName, managerName;
  DateTime? established, activeFrom;
  Json? created;

  final ok = await showFormSheet(
    context,
    title: 'Add Branch',
    saveLabel: 'Save Branch',
    builder: (ctx, setS) => [
      _hint('Basic information. Address, users, stores, cost centers and documents are added after the first save.'),
      _section('Basic Information'),
      AppTextField(label: 'Branch Name', controller: name, required: true, hint: 'Unit 3'),
      AppTextField(label: 'Branch Code', controller: code, required: true, hint: 'Unit 3'),
      AppSelect<int>(
        label: 'Company',
        required: true,
        value: companyId,
        options: [if (company != null) Option(asInt(company['id'])!, str(company['name']))],
        onChanged: (o) => setS(() => companyId = o?.value),
      ),
      AppTextField(label: 'Branch Type', controller: type, required: true, hint: 'Manufacturing'),
      AppSelect<String>(
        label: 'Branch Status',
        required: true,
        value: status,
        options: _statusOptions(branchStatusLabels),
        onChanged: (o) => setS(() => status = o?.value ?? 'active'),
      ),
      AppTextField(label: 'Industry / Function', controller: industry),
      _section('People'),
      _userSelect('Branch Head', headId, headName, (o) => setS(() {
            headId = o?.value;
            headName = o?.label;
          })),
      _userSelect('Branch Manager', managerId, managerName, (o) => setS(() {
            managerId = o?.value;
            managerName = o?.label;
          })),
      _section('Dates'),
      DateField(label: 'Established Date', value: established, onChanged: (d) => setS(() => established = d)),
      DateField(label: 'Active From', value: activeFrom, onChanged: (d) => setS(() => activeFrom = d)),
      _section('Notes (optional)'),
      AppTextField(label: 'Description', controller: description, maxLines: 3),
      AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
    ],
    onSave: () async {
      if (name.text.trim().isEmpty) throw 'Branch name is required (e.g. Unit 3).';
      if (code.text.trim().isEmpty) throw 'Branch code is required: a short unique code, e.g. U3.';
      if (companyId == null) {
        throw 'Company is required: pick it in the Company field (set up Company Info first if the list is empty).';
      }
      if (type.text.trim().isEmpty) throw 'Branch type is required (e.g. Manufacturing).';
      created = jsonMap(await Api.post('/organization/branches', data: {
        'name': name.text,
        'code': code.text,
        'company_id': companyId,
        'plant_type': type.text,
        'status': status,
        'industry_function': _orNull(industry),
        'head_user_id': headId,
        'manager_user_id': managerId,
        'established_date': _apiDate(established),
        'active_from': _apiDate(activeFrom),
        'description': _orNull(description),
        'remarks': _orNull(remarks),
      }));
    },
  );
  return ok ? created : null;
}

// ── Edit › Basic ─────────────────────────────────────────────────────────────

Future<bool> showBranchBasicSheet(BuildContext context, Json b) {
  final id = asInt(b['id']);
  final name = _ctl(b['name']);
  final code = _ctl(b['code']);
  final type = _ctl(b['plant_type']);
  final industry = _ctl(b['industry_function']);
  final description = _ctl(b['description']);
  final remarks = _ctl(b['remarks']);
  String status = str(b['status']).isEmpty ? 'active' : str(b['status']);
  int? headId = asInt(b['head_user_id']), managerId = asInt(b['manager_user_id']);
  String? headName = b['head_user_name'] as String?, managerName = b['manager_user_name'] as String?;
  DateTime? established = _date(b['established_date']), activeFrom = _date(b['active_from']);

  return showFormSheet(
    context,
    title: 'Edit Branch › Basic',
    saveLabel: 'Save Changes',
    builder: (ctx, setS) => [
      _section('Basic Information'),
      AppTextField(label: 'Branch Name', controller: name, required: true),
      AppTextField(label: 'Branch Code', controller: code, required: true),
      AppTextField(label: 'Branch Type', controller: type, required: true),
      AppSelect<String>(
        label: 'Branch Status',
        required: true,
        value: status,
        options: _statusOptions(branchStatusLabels),
        onChanged: (o) => setS(() => status = o?.value ?? 'active'),
      ),
      AppTextField(label: 'Industry / Function', controller: industry),
      _section('People'),
      _userSelect('Branch Head', headId, headName, (o) => setS(() {
            headId = o?.value;
            headName = o?.label;
          })),
      _userSelect('Branch Manager', managerId, managerName, (o) => setS(() {
            managerId = o?.value;
            managerName = o?.label;
          })),
      _section('Dates'),
      DateField(label: 'Established Date', value: established, onChanged: (d) => setS(() => established = d)),
      DateField(label: 'Active From', value: activeFrom, onChanged: (d) => setS(() => activeFrom = d)),
      _section('Notes'),
      AppTextField(label: 'Description', controller: description, maxLines: 3),
      AppTextField(label: 'Remarks', controller: remarks, maxLines: 3),
    ],
    onSave: () async {
      if (name.text.trim().isEmpty) throw 'Branch name is required — enter it on the Basic tab.';
      if (code.text.trim().isEmpty) throw 'Branch code is required — enter it on the Basic tab (e.g. U3).';
      await Api.patch('/organization/branches/$id', data: {
        'name': name.text,
        'code': code.text.toUpperCase(),
        'plant_type': type.text,
        'status': status,
        'industry_function': _orNull(industry),
        'head_user_id': headId,
        'manager_user_id': managerId,
        'established_date': _apiDate(established),
        'active_from': _apiDate(activeFrom),
        'description': _orNull(description),
        'remarks': _orNull(remarks),
      });
    },
  );
}

// ── Edit › Operational Configuration ─────────────────────────────────────────

Future<bool> showBranchOperationsSheet(BuildContext context, Json b, List<Json> stores, List<Json> costCenters) {
  final id = asInt(b['id']);
  final calendar = _ctl(b['working_calendar']);
  final days = _ctl(b['working_days']);
  final hours = _ctl(b['working_hours']);
  final profit = _ctl(b['default_profit_center']);
  final currency = _ctl(b['currency']);
  final gstin = _ctl(b['gstin']);
  final stateCode = _ctl(b['state_code']);
  String? tz = (b['timezone'] as String?)?.isEmpty == true ? null : b['timezone'] as String?;
  int? storeId = asInt(b['default_warehouse_id']);
  int? ccId = asInt(b['default_cost_center_id']);

  return showFormSheet(
    context,
    title: 'Edit Branch › Operations',
    saveLabel: 'Save Changes',
    builder: (ctx, setS) => [
      _section('Working Time'),
      AppTextField(label: 'Working Calendar', controller: calendar, required: true),
      AppTextField(label: 'Working Days', controller: days, hint: 'Mon–Fri'),
      AppTextField(label: 'Working Hours', controller: hours, hint: '09:00–18:00'),
      AppSelect<String>(
        label: 'Time Zone',
        value: tz,
        valueLabel: tz != null && !_timeZones.contains(tz) ? '$tz (not a valid time zone — pick one)' : null,
        options: [for (final z in _timeZones) Option(z, z)],
        onChanged: (o) => setS(() => tz = o?.value),
      ),
      _section('Defaults'),
      AppSelect<int>(
        label: 'Default Store',
        value: storeId,
        valueLabel: b['default_warehouse_name'] as String?,
        options: [for (final w in stores) Option(asInt(w['id'])!, str(w['name']))],
        onChanged: (o) => setS(() => storeId = o?.value),
      ),
      AppSelect<int>(
        label: 'Default Cost Center',
        value: ccId,
        valueLabel: b['default_cost_center_name'] as String?,
        options: [for (final c in costCenters) Option(asInt(c['id'])!, str(c['name']))],
        onChanged: (o) => setS(() => ccId = o?.value),
      ),
      AppTextField(label: 'Default Profit Center', controller: profit),
      AppTextField(label: 'Currency', controller: currency, hint: 'INR'),
      _hint('Stores and cost centers are managed from their own tabs on this page, then chosen as defaults here.'),
      _section('GST'),
      AppTextField(label: 'Plant GSTIN', controller: gstin, hint: '06AAACP1234C1Z5'),
      AppTextField(label: 'GST State Code', controller: stateCode, hint: 'From the GSTIN, e.g. 06'),
      _hint('Plants under different GSTINs are distinct persons under GST: a stock transfer between them goes on a '
          'tax invoice, and an e-way bill is needed when the state differs.'),
    ],
    onSave: () async {
      final g = gstin.text.trim().toUpperCase();
      if (g.length > 15) throw 'Plant GSTIN has ${g.length} characters — a GSTIN is exactly 15 characters, e.g. 06AAACP1234C1Z5.';
      final sc = stateCode.text.trim();
      if (sc.length > 2) throw 'GST State Code is 2 digits (the first two characters of the GSTIN, e.g. 06).';
      await Api.patch('/organization/branches/$id', data: {
        'working_calendar': _orNull(calendar),
        'working_days': _orNull(days),
        'working_hours': _orNull(hours),
        'timezone': tz,
        'default_warehouse_id': storeId,
        'default_cost_center_id': ccId,
        'default_profit_center': _orNull(profit),
        'currency': _orNull(currency),
        'gstin': g.isEmpty ? null : g,
        'state_code': sc.isEmpty ? null : sc,
      });
    },
  );
}

// ── Address ──────────────────────────────────────────────────────────────────

Future<bool> showBranchAddressSheet(BuildContext context, int branchId, {Json? address}) {
  final a = address ?? const <String, dynamic>{};
  final type = _ctl(a['address_type']);
  final landmark = _ctl(a['landmark']);
  final line1 = _ctl(a['address_line1']);
  final line2 = _ctl(a['address_line2']);
  final country = _ctl(a['country']);
  final state = _ctl(a['state']);
  final city = _ctl(a['city']);
  final district = _ctl(a['district']);
  final pincode = _ctl(a['pincode']);
  bool primary = a['is_primary'] == true;
  bool active = address == null ? true : a['is_active'] == true;

  return showFormSheet(
    context,
    title: address == null ? 'Add Address' : 'Edit Address',
    saveLabel: address == null ? 'Save Address' : 'Save Changes',
    builder: (ctx, setS) => [
      AppTextField(label: 'Address Type', controller: type, required: true, hint: 'Main Plant'),
      AppTextField(label: 'Landmark', controller: landmark),
      AppTextField(label: 'Address Line 1', controller: line1, required: true),
      AppTextField(label: 'Address Line 2', controller: line2),
      AppTextField(label: 'Country', controller: country, required: true),
      AppTextField(label: 'State / UT', controller: state, required: true),
      AppTextField(label: 'City', controller: city, required: true),
      AppTextField(label: 'District', controller: district),
      AppTextField(label: 'PIN Code', controller: pincode, required: true, keyboardType: TextInputType.number),
      CheckField(label: 'Primary Address', value: primary, onChanged: (v) => setS(() => primary = v)),
      CheckField(label: 'Active', value: active, onChanged: (v) => setS(() => active = v)),
    ],
    onSave: () async {
      if (line1.text.trim().isEmpty) throw 'Address Line 1 is required — enter the building / street.';
      final payload = {
        'address_type': type.text,
        'address_line1': line1.text,
        'address_line2': line2.text,
        'landmark': landmark.text,
        'country': country.text,
        'state': state.text,
        'city': city.text,
        'district': district.text,
        'pincode': pincode.text,
        'is_primary': primary,
        'is_active': active,
      };
      if (address == null) {
        await Api.post('/organization/branches/$branchId/addresses', data: payload);
      } else {
        await Api.patch('/organization/branches/$branchId/addresses/${a['id']}', data: payload);
      }
    },
  );
}

// ── Branch Users ─────────────────────────────────────────────────────────────

const _accessLevels = {'view': 'View', 'edit': 'Edit', 'admin': 'Admin'};
const _activeInactive = {'active': 'Active', 'inactive': 'Inactive'};

Future<bool> showBranchUserSheet(BuildContext context, int branchId, List<Json> departments, {Json? assignment}) {
  final a = assignment ?? const <String, dynamic>{};
  int? userId = asInt(a['user_id']);
  String? userName = a['user_name'] as String?;
  final employeeId = _ctl(a['employee_id']);
  int? deptId = asInt(a['department_id']);
  final designation = _ctl(a['designation']);
  final role = _ctl(a['role']);
  String? access = str(a['access_level']).isEmpty ? null : str(a['access_level']);
  bool primary = a['is_primary_branch'] == true;
  DateTime? from = _date(a['effective_from']), to = _date(a['effective_to']);
  String status = str(a['status']).isEmpty ? 'active' : str(a['status']);

  return showFormSheet(
    context,
    title: assignment == null ? 'Add Branch User' : 'Edit Branch User',
    saveLabel: assignment == null ? 'Save Branch User' : 'Save Changes',
    builder: (ctx, setS) => [
      AppSelect<int>(
        label: 'User',
        required: true,
        value: userId,
        valueLabel: userName,
        loadOptions: loadUserOptions,
        onChanged: (o) => setS(() {
          userId = o?.value;
          userName = o?.label;
        }),
      ),
      AppTextField(label: 'Employee ID', controller: employeeId),
      AppSelect<int>(
        label: 'Department',
        value: deptId,
        valueLabel: a['department_name'] as String?,
        options: [for (final d in departments) Option(asInt(d['id'])!, str(d['name']))],
        onChanged: (o) => setS(() => deptId = o?.value),
      ),
      AppTextField(label: 'Designation', controller: designation),
      AppTextField(label: 'Role', controller: role),
      AppSelect<String>(
        label: 'Access Level',
        value: access,
        options: _statusOptions(_accessLevels),
        onChanged: (o) => setS(() => access = o?.value),
      ),
      DateField(label: 'Effective From', value: from, onChanged: (d) => setS(() => from = d)),
      DateField(label: 'Effective To', value: to, onChanged: (d) => setS(() => to = d)),
      AppSelect<String>(
        label: 'Status',
        value: status,
        clearable: false,
        options: _statusOptions(_activeInactive),
        onChanged: (o) => setS(() => status = o?.value ?? 'active'),
      ),
      CheckField(label: 'Primary Branch for this user', value: primary, onChanged: (v) => setS(() => primary = v)),
    ],
    onSave: () async {
      if (userId == null) throw 'User is required — pick the person in the User field.';
      if (from != null && to != null && to!.isBefore(from!)) {
        throw 'Effective To must be after Effective From — fix one of the two dates.';
      }
      final payload = {
        'user_id': userId,
        'employee_id': employeeId.text,
        'department_id': deptId,
        'designation': designation.text,
        'role': role.text,
        'access_level': access ?? '',
        'is_primary_branch': primary,
        'effective_from': _apiDate(from),
        'effective_to': _apiDate(to),
        'status': status,
      };
      if (assignment == null) {
        await Api.post('/organization/branches/$branchId/user-assignments', data: payload);
      } else {
        await Api.patch('/organization/branches/$branchId/user-assignments/${a['id']}', data: payload);
      }
    },
  );
}

// ── Branch Stores (Store module records) ─────────────────────────────────────

const _storeStatuses = {'active': 'Active', 'inactive': 'Inactive', 'under_maintenance': 'Under Maintenance'};

Future<bool> showBranchStoreSheet(BuildContext context, int branchId, {Json? store}) {
  final w = store ?? const <String, dynamic>{};
  final name = _ctl(w['name']);
  final code = _ctl(w['code']);
  final type = _ctl(w['warehouse_type']);
  int? managerId = asInt(w['manager_user_id']);
  String? managerName = w['manager_user_name'] as String?;
  final address = _ctl(w['address']);
  final storage = _ctl(w['storage_type']);
  final inventory = _ctl(w['inventory_type']);
  final hours = _ctl(w['operating_hours']);
  String status = str(w['status']).isEmpty ? 'active' : str(w['status']);

  return showFormSheet(
    context,
    title: store == null ? 'Add Store' : 'Edit Store',
    saveLabel: store == null ? 'Save Store' : 'Save Changes',
    builder: (ctx, setS) => [
      AppTextField(label: 'Store Name', controller: name, required: true),
      AppTextField(label: 'Store Code', controller: code, required: true),
      AppTextField(label: 'Store Type', controller: type, required: true, hint: 'Raw Material'),
      _userSelect('Store Manager', managerId, managerName, (o) => setS(() {
            managerId = o?.value;
            managerName = o?.label;
          })),
      AppTextField(label: 'Address', controller: address),
      AppTextField(label: 'Storage Type', controller: storage),
      AppTextField(label: 'Inventory Type', controller: inventory),
      AppTextField(label: 'Operating Hours', controller: hours, hint: '09:00–18:00'),
      AppSelect<String>(
        label: 'Status',
        required: true,
        value: status,
        options: _statusOptions(_storeStatuses),
        onChanged: (o) => setS(() => status = o?.value ?? 'active'),
      ),
    ],
    onSave: () async {
      if (name.text.trim().isEmpty || code.text.trim().isEmpty) {
        throw 'Store Name and Code are required — e.g. Main Raw Material Store, RM-U3.';
      }
      final payload = {
        'name': name.text,
        'code': code.text.toUpperCase(),
        'warehouse_type': type.text,
        'manager_user_id': managerId,
        'address': address.text,
        'storage_type': storage.text,
        'inventory_type': inventory.text,
        'operating_hours': hours.text,
        'status': status,
      };
      if (store == null) {
        await Api.post('/store/locations', data: {...payload, 'branch_id': branchId});
      } else {
        await Api.patch('/store/locations/${w['id']}', data: payload);
      }
    },
  );
}

// ── Branch Cost Centers ──────────────────────────────────────────────────────

Future<bool> showBranchCostCenterSheet(BuildContext context, int branchId, List<Json> departments,
    List<Json> costCenters, {Json? costCenter}) {
  final c = costCenter ?? const <String, dynamic>{};
  final editingId = asInt(c['id']);
  final code = _ctl(c['code']);
  final name = _ctl(c['name']);
  final type = _ctl(c['cost_center_type']);
  int? deptId = asInt(c['department_id']);
  int? headId = asInt(c['head_user_id']);
  String? headName = c['head_user_name'] as String?;
  int? parentId = asInt(c['parent_cost_center_id']);
  DateTime? from = _date(c['effective_from']), to = _date(c['effective_to']);
  String status = str(c['status']).isEmpty ? 'active' : str(c['status']);

  return showFormSheet(
    context,
    title: costCenter == null ? 'Add Cost Center' : 'Edit Cost Center',
    saveLabel: costCenter == null ? 'Save Cost Center' : 'Save Changes',
    builder: (ctx, setS) => [
      AppTextField(label: 'Cost Center Code', controller: code, required: true),
      AppTextField(label: 'Cost Center Name', controller: name, required: true),
      AppTextField(label: 'Cost Center Type', controller: type),
      AppSelect<int>(
        label: 'Department',
        value: deptId,
        valueLabel: c['department_name'] as String?,
        options: [for (final d in departments) Option(asInt(d['id'])!, str(d['name']))],
        onChanged: (o) => setS(() => deptId = o?.value),
      ),
      _userSelect('Cost Center Head', headId, headName, (o) => setS(() {
            headId = o?.value;
            headName = o?.label;
          })),
      AppSelect<int>(
        label: 'Parent Cost Center',
        value: parentId,
        options: [
          for (final p in costCenters)
            if (asInt(p['id']) != editingId) Option(asInt(p['id'])!, str(p['name'])),
        ],
        onChanged: (o) => setS(() => parentId = o?.value),
      ),
      DateField(label: 'Effective From', value: from, onChanged: (d) => setS(() => from = d)),
      DateField(label: 'Effective To', value: to, onChanged: (d) => setS(() => to = d)),
      AppSelect<String>(
        label: 'Status',
        value: status,
        clearable: false,
        options: _statusOptions(_activeInactive),
        onChanged: (o) => setS(() => status = o?.value ?? 'active'),
      ),
    ],
    onSave: () async {
      if (code.text.trim().isEmpty || name.text.trim().isEmpty) {
        throw 'Cost Center Code and Name are required — e.g. CC-U3-MACH, Machine Shop.';
      }
      final payload = {
        'code': code.text.toUpperCase(),
        'name': name.text,
        'cost_center_type': type.text,
        'department_id': deptId,
        'head_user_id': headId,
        'parent_cost_center_id': parentId,
        'effective_from': _apiDate(from),
        'effective_to': _apiDate(to),
        'status': status,
      };
      if (costCenter == null) {
        await Api.post('/organization/cost-centers', data: {...payload, 'branch_id': branchId});
      } else {
        await Api.patch('/organization/cost-centers/$editingId', data: payload);
      }
    },
  );
}

// ── Branch Documents ─────────────────────────────────────────────────────────

const _documentTypes = ['License', 'Certificate', 'Registration', 'Agreement', 'Compliance', 'Other'];
const _confidentiality = ['Public', 'Internal', 'Confidential'];

Future<bool> showBranchDocumentSheet(BuildContext context, int branchId) {
  MultipartFile? file;
  String docType = 'Other';
  final name = TextEditingController();
  final number = TextEditingController();
  DateTime? issue, expiry;
  final authority = TextEditingController();
  final version = TextEditingController();
  final status = TextEditingController();
  String confidentiality = 'Internal';
  final tags = TextEditingController();
  final remarks = TextEditingController();

  return showFormSheet(
    context,
    title: 'Add Branch Document',
    saveLabel: 'Save Document',
    builder: (ctx, setS) => [
      InputDecorator(
        decoration: fieldDecoration('Document File', required: true),
        child: Row(
          children: [
            Expanded(
              child: Text(file?.filename ?? 'No file chosen',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: file == null ? Brand.muted : Brand.body)),
            ),
            TextButton.icon(
              icon: const Icon(Icons.attach_file_rounded, size: 18),
              label: Text(file == null ? 'Choose' : 'Change'),
              onPressed: () async {
                final f = await Files.pickFile();
                if (f != null) setS(() => file = f);
              },
            ),
          ],
        ),
      ),
      AppSelect<String>(
        label: 'Document Type',
        required: true,
        value: docType,
        options: [for (final t in _documentTypes) Option(t, t)],
        onChanged: (o) => setS(() => docType = o?.value ?? 'Other'),
      ),
      AppTextField(label: 'Document Name', controller: name, required: true),
      AppTextField(label: 'Document Number', controller: number),
      DateField(label: 'Issue Date', value: issue, onChanged: (d) => setS(() => issue = d)),
      DateField(label: 'Expiry Date', value: expiry, onChanged: (d) => setS(() => expiry = d)),
      AppTextField(label: 'Issuing Authority', controller: authority),
      AppTextField(label: 'Version', controller: version),
      AppTextField(label: 'Status', controller: status, hint: 'Active'),
      AppSelect<String>(
        label: 'Confidentiality',
        value: confidentiality,
        clearable: false,
        options: [for (final c in _confidentiality) Option(c, c)],
        onChanged: (o) => setS(() => confidentiality = o?.value ?? 'Internal'),
      ),
      AppTextField(label: 'Tags (comma separated)', controller: tags),
      AppTextField(label: 'Remarks', controller: remarks),
    ],
    onSave: () async {
      if (file == null) throw 'Select a file to upload — tap Choose in the Document File box.';
      if (name.text.trim().isEmpty) throw 'Document Name is required — e.g. Factory Licence.';
      final meta = <String, String>{
        'document_type': docType,
        'document_name': name.text,
        'document_number': number.text,
        'issue_date': _apiDate(issue) ?? '',
        'expiry_date': _apiDate(expiry) ?? '',
        'issuing_authority': authority.text,
        'version': version.text,
        'status': status.text,
        'confidentiality': confidentiality,
        'tags': tags.text,
        'remarks': remarks.text,
      };
      final form = FormData();
      form.files.add(MapEntry('file', file!));
      meta.forEach((k, v) {
        if (v.isNotEmpty) form.fields.add(MapEntry(k, v));
      });
      await Api.dio.post('/organization/branches/$branchId/documents',
          data: form, options: Options(sendTimeout: const Duration(minutes: 2), receiveTimeout: const Duration(minutes: 2)));
    },
  );
}
