import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'pm_common.dart';

/// The machine form (frontend/src/components/erp/ProjectForm.tsx) on a phone:
/// one sheet with the portal's tabs as sections - Machine Identity, Client &
/// Site, Technical Specs, Timeline & Warranty, Documents.
/// New project mode asks the project name first and posts the project and
/// its machine together (/projects/with-machine).

const machineTypes = ['Road Rail', 'Rail Bound', 'Accessories', 'Other'];
const applicationTypes = ['OHE', 'FBW', 'CMC - Shunting', 'Track Laying', 'Other'];
const machineStatusOptions = [
  ('active', 'Active'),
  ('under_service', 'Under Service'),
  ('manufacturing_under_progress', 'Manufacturing Under Progress'),
  ('work_in_progress', 'Work in Progress'),
  ('standby', 'Standby'),
  ('inactive', 'Inactive'),
  ('decommissioned', 'Decommissioned'),
  ('cancel', 'Cancel'),
];
const indiaStates = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh',
  'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

const _textKeys = [
  'serial_number', 'model_name', 'machine_type', 'engine_number', 'chassis_number', 'application_type', 'status',
  'year_of_manufacture', 'po_number', 'po_date', 'delivery_date', 'commissioning_date', 'handover_date',
  'client_company', 'client_name', 'client_designation', 'client_email', 'client_phone', 'client_phone_alt',
  'client_address', 'client_gst', 'site_name', 'site_location', 'site_state', 'site_pincode', 'site_country', 'zone',
  'warranty_start_date', 'warranty_end_date', 'warranty_override', 'amc_status', 'amc_end_date', 'operator_name',
  'operator_phone', 'operator_email', 'operator_qualification', 'specifications', 'installed_options',
  'software_version', 'tech_notes', 'notes',
];

bool _phoneOk(String v) {
  final d = v.replaceAll(RegExp(r'\D'), '');
  return d.isEmpty || (d.length >= 7 && d.length <= 15);
}

bool _fyOk(String v) {
  if (v.isEmpty) return true;
  final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(v);
  if (m == null) return false;
  final y1 = int.parse(m.group(1)!);
  final y2 = int.parse(m.group(2)!);
  return y1 >= 1900 && y1 <= 2100 && y2 == (y1 + 1) % 100;
}

bool _emailOk(String v) => v.isEmpty || RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(v.trim());
bool _gstOk(String v) =>
    v.isEmpty || RegExp(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$').hasMatch(v.trim().toUpperCase());

/// New project (project + machine). Returns the created project, or null.
Future<Json?> openNewProjectForm(BuildContext context) => _openMachineForm(context, initial: null, projectMode: true);

/// Edit a machine record. True when saved.
Future<bool> openEditMachineForm(BuildContext context, Json machine) async =>
    (await _openMachineForm(context, initial: machine, projectMode: false)) != null;

Future<Json?> _openMachineForm(BuildContext context, {required Json? initial, required bool projectMode}) async {
  final vis = PmVis('projects:all_projects');
  final edit = initial != null;
  final f = <String, String>{for (final k in _textKeys) k: s(initial?[k]) ?? ''};
  final allowedStatuses = vis.options('status', machineStatusOptions, (o) => o.$1);
  final statusChoices = machineStatusOptions
      .where((o) => allowedStatuses.contains(o) || (edit && o.$1 == s(initial['status'])))
      .toList();
  if (!edit) f['status'] = allowedStatuses.any((o) => o.$1 == 'active') ? 'active' : allowedStatuses.first.$1;
  if (f['site_country']!.isEmpty) f['site_country'] = 'India';
  var machineTypeCustom = '';
  var applicationTypeCustom = '';
  if (f['machine_type']!.isNotEmpty && !machineTypes.contains(f['machine_type'])) {
    machineTypeCustom = f['machine_type']!;
    f['machine_type'] = 'Other';
  }
  if (f['application_type']!.isNotEmpty && !applicationTypes.contains(f['application_type'])) {
    applicationTypeCustom = f['application_type']!;
    f['application_type'] = 'Other';
  }
  var isExport = b(initial?['is_export']);
  var extendedWarranty = b(initial?['extended_warranty']);
  var extendedWarrantyEnd = s(initial?['extended_warranty_end']) ?? '';
  var warrantyStatus = s(initial?['warranty_start_date']) != null ? 'active' : 'none';
  var projectName = '';
  var isPrivate = false;
  final files = <MultipartFile>[];
  final names = <String>[];
  Json? created;

  Widget text(String k, String label,
          {bool req = false, int lines = 1, String? hint, TextInputType? kb, bool upper = false}) =>
      AppTextField(
        key: ValueKey('mf-$k'),
        label: label,
        required: req,
        initialValue: f[k],
        maxLines: lines,
        hint: hint,
        keyboardType: kb,
        onChanged: (v) => f[k] = upper ? v.toUpperCase() : v,
      );

  Widget date(String k, String label, StateSetter setS) => DateField(
        label: label,
        value: dateOnly(f[k]),
        onChanged: (d) => setS(() => f[k] = d == null ? '' : apiDate(d)),
      );

  Widget pick(String k, String label, List<(String, String)> opts, StateSetter setS, {bool clearable = true}) =>
      AppSelect<String>(
        label: label,
        value: f[k]!.isEmpty ? null : f[k],
        clearable: clearable,
        options: [for (final o in opts) Option(o.$1, o.$2)],
        onChanged: (o) => setS(() => f[k] = o?.value ?? ''),
      );

  final saved = await showFormSheet(
    context,
    title: projectMode ? 'Add New Project' : 'Edit Project — ${f['serial_number']}',
    saveLabel: projectMode ? 'Create project' : 'Save Changes',
    builder: (ctx, setS) => [
      if (projectMode)
        const Hint('Fill the project and its machine once. Then open the project and add its milestones — '
            'the first milestone releases it to the departments.'),
      if (vis.showSection('machine_identity')) ...[
        const SheetTitle('Machine Asset Identity', icon: Icons.local_shipping_outlined),
        if (projectMode)
          AppTextField(
            key: const ValueKey('mf-project-name'),
            label: 'Project Name',
            required: true,
            initialValue: projectName,
            hint: 'e.g. CAM Injection Car for IRCON MAHSR-T2',
            onChanged: (v) => projectName = v,
          ),
        text('serial_number', 'Serial Number',
            req: !projectMode, hint: projectMode ? 'Blank = project number' : 'e.g. PNR-RR-2026-88'),
        if (projectMode) const Hint('Blank = project number, e.g. PEW-78.'),
        text('model_name', 'Model Name', hint: 'e.g. Catenary Track Car Pro'),
        pick('machine_type', 'Machine Classification', [for (final m in machineTypes) (m, m)], setS),
        if (f['machine_type'] == 'Other')
          AppTextField(
              key: const ValueKey('mf-mt-custom'),
              label: 'Custom Class Specification',
              required: true,
              initialValue: machineTypeCustom,
              hint: 'Specify other classification',
              onChanged: (v) => machineTypeCustom = v),
        text('engine_number', 'Engine Number', hint: 'Optional Engine ID'),
        text('chassis_number', 'Chassis Number', hint: 'Optional Chassis ID'),
        text('year_of_manufacture', 'Year of Manufacture', hint: 'e.g. 2026-27'),
        pick('status', 'Operational Status', statusChoices, setS, clearable: false),
        pick('application_type', 'Application Type', [for (final a in applicationTypes) (a, a)], setS),
        if (f['application_type'] == 'Other')
          AppTextField(
              key: const ValueKey('mf-at-custom'),
              label: 'Custom Application Specifications',
              required: true,
              initialValue: applicationTypeCustom,
              hint: 'Enter custom application specifications',
              onChanged: (v) => applicationTypeCustom = v),
        text('notes', 'Production Notes & Core Details', lines: 3, hint: 'Enter other critical identity comments...'),
      ],
      if (vis.showSection('site_location')) ...[
        const SheetTitle('Operational Site Location', icon: Icons.apartment_outlined),
        CheckField(
          label: 'International / Export Deployment',
          value: isExport,
          onChanged: (v) => setS(() {
            isExport = v;
            if (v) {
              f['site_state'] = '';
            } else {
              f['site_country'] = 'India';
            }
          }),
        ),
        text('site_name', 'Site Name', hint: 'Enter railway station/site name'),
        text('site_location', 'Site Location', hint: 'City or Division'),
        if (isExport)
          text('site_country', 'Country', hint: 'Enter country name')
        else
          pick('site_state', 'State', [for (final st in indiaStates) (st, st)], setS),
        text('site_pincode', 'Pincode', hint: '6-digit PIN code', kb: TextInputType.number),
        text('zone', 'Zone', hint: 'e.g. Northern Railway (NR)'),
      ],
      if (vis.showSection('client_details')) ...[
        const SheetTitle('Client Details', icon: Icons.groups_outlined),
        text('client_company', 'Client Company', req: true, hint: 'Enter client company name'),
        text('client_name', 'Contact Person', hint: 'Enter contact person name'),
        text('client_designation', 'Designation', hint: 'e.g. Chief Engineer'),
        text('client_email', 'Email', hint: 'Enter email address', kb: TextInputType.emailAddress),
        text('client_phone', 'Phone', hint: '+91 98765 43210', kb: TextInputType.phone),
        text('client_phone_alt', 'Alternate Phone', hint: '+91 98765 43210', kb: TextInputType.phone),
        text('client_gst', 'GST Number', hint: '15-digit GSTIN', upper: true),
        text('client_address', 'Address', lines: 2, hint: 'Client corporate/billing address...'),
      ],
      if (vis.showSection('technical_specs')) ...[
        const SheetTitle('Technical Specifications', icon: Icons.settings_outlined, optional: true),
        text('specifications', 'Specifications', lines: 3, hint: 'List model engine power, capacity, and key metrics...'),
        text('installed_options', 'Installed Options', lines: 3, hint: 'Any specialized modular items installed...'),
        text('software_version', 'Software Version', hint: 'e.g. v2.4.1'),
        text('tech_notes', 'Notes', lines: 2, hint: 'Additional engineering notes...'),
      ],
      if (vis.showSection('procurement_delivery')) ...[
        const SheetTitle('Procurement & Delivery Information', icon: Icons.shopping_cart_outlined),
        text('po_number', projectMode ? 'Customer PO Number' : 'PO Number', req: projectMode, hint: 'Purchase Order Ref'),
        date('po_date', 'PO Date', setS),
        date('delivery_date', 'Dispatch Date', setS),
        date('commissioning_date', 'Commissioning Date', setS),
        date('handover_date', 'Handover Date', setS),
      ],
      if (vis.showSection('warranty')) ...[
        const SheetTitle('Warranty Coverage Details', icon: Icons.shield_outlined),
        AppSelect<String>(
          label: 'Warranty Status',
          value: warrantyStatus,
          clearable: false,
          options: const [Option('none', 'No Warranty'), Option('active', 'Active Warranty Period')],
          onChanged: (o) => setS(() => warrantyStatus = o?.value ?? 'none'),
        ),
        if (warrantyStatus == 'active') ...[
          date('warranty_start_date', 'Warranty Commencement', setS),
          date('warranty_end_date', 'Warranty Expiration', setS),
        ],
        text('warranty_override', 'Warranty Terms & Scope', hint: 'Clauses, limit conditions'),
        CheckField(label: 'Extended Warranty', value: extendedWarranty, onChanged: (v) => setS(() => extendedWarranty = v)),
        if (extendedWarranty)
          DateField(
            label: 'Extended Warranty End',
            value: dateOnly(extendedWarrantyEnd),
            onChanged: (d) => setS(() => extendedWarrantyEnd = d == null ? '' : apiDate(d)),
          ),
        AppSelect<String>(
          label: 'AMC Service Status',
          value: f['amc_status'],
          clearable: false,
          options: const [Option('', 'None'), Option('Active', 'Active AMC'), Option('Expired', 'Expired Contract')],
          onChanged: (o) => setS(() => f['amc_status'] = o?.value ?? ''),
        ),
        if (f['amc_status']!.isNotEmpty) date('amc_end_date', 'AMC End Date', setS),
      ],
      if (vis.showSection('attachments')) ...[
        const SheetTitle('Attachments & Documents', icon: Icons.attach_file_rounded),
        const Hint('PDFs, Office files, images, and videos — max 10GB each'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          SmallBtn('Choose files', icon: Icons.upload_file_rounded, onPressed: () async {
            final picked = await Files.pickFiles();
            setS(() {
              files.addAll(picked);
              names.addAll(picked.map((p) => p.filename ?? 'file'));
            });
          }),
          SmallBtn('Take photo', icon: Icons.photo_camera_outlined, onPressed: () async {
            final p = await Files.takePhoto();
            if (p != null) {
              setS(() {
                files.add(p);
                names.add(p.filename ?? 'photo.jpg');
              });
            }
          }),
        ]),
        for (var k = 0; k < names.length; k++)
          FileRow(
            title: names[k],
            onOpen: null,
            onDelete: () => setS(() {
              files.removeAt(k);
              names.removeAt(k);
            }),
          ),
        if (files.isNotEmpty)
          CheckField(
            label: 'Private — only me and admins can open these files',
            value: isPrivate,
            onChanged: (v) => setS(() => isPrivate = v),
          ),
      ],
    ],
    onSave: () async {
      if (projectMode && projectName.trim().isEmpty) throw 'Project name is required. Enter it on the Machine Identity tab.';
      if (!projectMode && f['serial_number']!.trim().isEmpty) throw 'Serial number is required.';
      if (f['machine_type'] == 'Other' && machineTypeCustom.trim().isEmpty) {
        throw 'Please specify the custom machine classification.';
      }
      if (f['application_type'] == 'Other' && applicationTypeCustom.trim().isEmpty) {
        throw 'Please specify the custom application type.';
      }
      if (f['client_company']!.trim().isEmpty) throw 'Client company is required. Enter it on the Client & Site tab.';
      if (projectMode && f['po_number']!.trim().isEmpty) {
        throw "Customer PO number is required. Enter the customer's purchase order number on the Timeline & Warranty tab.";
      }
      if (!_phoneOk(f['client_phone']!) || !_phoneOk(f['client_phone_alt']!) || !_phoneOk(f['operator_phone']!)) {
        throw 'Please enter a valid phone number before saving.';
      }
      if (!_fyOk(f['year_of_manufacture']!)) throw 'Please enter a valid financial year format (e.g. 2026-27).';
      if (!_emailOk(f['client_email']!) || !_emailOk(f['operator_email']!)) {
        throw 'Enter a valid email address (e.g. name@company.com).';
      }
      if (!_gstOk(f['client_gst']!)) throw 'Enter a valid 15-character GSTIN (e.g. 27ABCDE1234F1Z5).';

      final payload = <String, dynamic>{
        ...f,
        'machine_type': f['machine_type'] == 'Other' ? machineTypeCustom : f['machine_type'],
        'application_type': f['application_type'] == 'Other' ? applicationTypeCustom : f['application_type'],
        'is_export': isExport,
        'extended_warranty': extendedWarranty,
        'extended_warranty_end': extendedWarranty ? extendedWarrantyEnd : '',
        'warranty_start_date': warrantyStatus == 'active' ? f['warranty_start_date'] : '',
        'warranty_end_date': warrantyStatus == 'active' ? f['warranty_end_date'] : '',
        'customer_id': initial?['customer_id'] ?? '',
        'product_id': initial?['product_id'] ?? '',
      };
      // Create: leave blanks out. Edit: a blank clears the stored value.
      for (final k in payload.keys.toList()) {
        if (payload[k] != '') continue;
        if (edit) {
          payload[k] = null;
        } else {
          payload.remove(k);
        }
      }
      final extra = isPrivate ? <String, dynamic>{'is_private': 'true'} : <String, dynamic>{};
      if (projectMode) {
        final res = obj(await Api.post('/projects/with-machine', data: {'name': projectName.trim(), 'machine': payload}));
        final out = res ?? <String, dynamic>{};
        created = out;
        final mid = i(out['machine_id']);
        if (files.isNotEmpty && mid != null) {
          try {
            await uploadFiles('/erp/projects/$mid/attachments', files, fields: extra);
          } catch (_) {
            out['_files_failed'] = true;
          }
        }
      } else {
        await Api.patch('/erp/projects/${initial!['id']}', data: payload);
        if (files.isNotEmpty) await uploadFiles('/erp/projects/${initial['id']}/attachments', files, fields: extra);
        created = initial;
      }
    },
  );
  if (!saved) return null;
  if (context.mounted && created?['_files_failed'] == true) {
    showSnack(
        context,
        'The project and its machine were saved, but the documents did not upload. '
        'Open the machine record and add them under Documents.',
        error: true);
  }
  return created;
}
