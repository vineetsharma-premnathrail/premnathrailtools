import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import 'erp_common.dart';

const _statusOptions = <Option<String>>[
  Option('open', 'Open'),
  Option('acknowledged', 'Acknowledged'),
  Option('scheduled', 'Scheduled'),
  Option('in_progress', 'In Progress'),
  Option('pending_parts', 'Pending Parts'),
  Option('on_hold', 'On Hold'),
  Option('work_completed', 'Work Completed'),
  Option('review', 'Review'),
  Option('closed', 'Closed'),
  Option('cancelled', 'Cancelled'),
];

final _emailRe = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

bool _phoneValid(String v) {
  final digits = v.replaceAll(RegExp(r'\D'), '');
  return digits.isEmpty || (digits.length >= 7 && digits.length <= 15);
}

Widget _section(String title, {bool optional = false}) => Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(children: [
        Text(title.toUpperCase(),
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: .8, color: Brand.muted)),
        if (optional) const Text('  (optional)', style: TextStyle(fontSize: 11.5, color: Brand.muted)),
      ]),
    );

/// Create / edit a Service Request (portal: components/erp/ServiceRequestForm.tsx
/// on /service-requests/new and /[id]/edit). Create returns the new SR id;
/// edit returns the same id when saved. Null when cancelled.
Future<int?> showSrForm(BuildContext context, {Json? initial}) async {
  final isEdit = initial != null;
  int? projectId = (initial?['project_id'] as num?)?.toInt();
  String? projectLabel;
  final title = TextEditingController(text: initial?['issue_title'] ?? '');
  final description = TextEditingController(text: initial?['issue_description'] ?? '');
  final location = TextEditingController();
  String? serviceType = initial?['service_type'] as String?;
  String? priority = initial?['priority'] as String?;
  String status = (initial?['status'] as String?) ?? 'open';
  DateTime? attend = parseDate(initial?['expected_date_to_attend']);
  DateTime? close = parseDate(initial?['expected_completion_date']);
  final reporter = TextEditingController(text: initial?['reported_by_name'] ?? '');
  final phone = TextEditingController(text: initial?['reported_by_phone'] ?? '');
  final email = TextEditingController(text: initial?['reported_by_email'] ?? '');
  final notes = TextEditingController(text: initial?['service_report_notes'] ?? '');
  final files = <MultipartFile>[];
  int? createdId;

  if (isEdit && projectId != null) {
    try {
      final p = await Api.get('/erp/projects/$projectId');
      if (p is Map) projectLabel = p['serial_number']?.toString();
    } catch (_) {
      projectLabel = null;
    }
  }
  if (!context.mounted) return null;

  final engineer = isEdit
      ? txt(initial['assigned_to_name'])
      : ((Perm.user['name'] as String?) ?? (Perm.user['email'] as String?) ?? '—');
  final statusChoices = _statusOptions
      .where((s) => isEdit || !['work_completed', 'review', 'closed', 'cancelled'].contains(s.value))
      .toList();

  final saved = await showFormSheet(
    context,
    title: isEdit ? 'Edit — ${initial['request_number']}' : 'Create Service Request',
    saveLabel: isEdit ? 'Save Changes' : 'Create Request',
    builder: (ctx, setS) => [
      Text(
          isEdit
              ? txt(initial['issue_title'])
              : 'Log a fault or service job against a machine — warranty cover is checked as you pick it.',
          style: const TextStyle(color: Brand.muted)),
      _section('Machine'),
      if (isEdit)
        InputDecorator(
          decoration: fieldDecoration('Asset / Vehicle', required: true),
          child: Text("${projectLabel ?? 'this machine'} (can't be changed after creation)"),
        )
      else
        AppSelect<int>(
          label: 'Asset / Vehicle',
          required: true,
          value: projectId,
          valueLabel: projectLabel,
          loadOptions: (q) async {
            final p = await Api.list('/erp/projects', query: {'search': q, 'limit': 100});
            return [
              for (final m in p.rows)
                Option<int>(
                  m['id'] as int,
                  '${m['serial_number']}${m['model_name'] != null ? ' — ${m['model_name']}' : ''}',
                  subtitle: m['client_company']?.toString(),
                ),
            ];
          },
          onChanged: (o) => setS(() {
            projectId = o?.value;
            projectLabel = o?.label;
          }),
        ),
      InputDecorator(
        decoration: fieldDecoration('Request date'),
        child: Text(isEdit ? fmtDate(initial['created_at']) : '${fmtDate(DateTime.now())} (today)'),
      ),
      AppTextField(
          label: 'Site / Location',
          required: !isEdit,
          controller: location,
          hint: 'Current location of asset'),
      _section('Issue Information'),
      AppSelect<String>(
        label: 'Service Type',
        required: true,
        value: serviceType,
        options: [for (final (k, l) in serviceTypes) Option(k, l)],
        onChanged: (o) => setS(() => serviceType = o?.value),
      ),
      ChoiceRow<String>(
        label: 'Priority Level',
        required: true,
        options: priorityOptions,
        value: priority,
        colors: priorityHex,
        onChanged: (v) => setS(() => priority = v),
      ),
      AppTextField(label: 'Issue Title', required: true, controller: title, hint: 'Brief summary of the fault...'),
      AppTextField(
          label: 'Detailed Description',
          controller: description,
          maxLines: 4,
          hint: 'Describe symptoms, context, and impact...'),
      _section('Reported By', optional: true),
      AppTextField(label: 'Company / Client Name', controller: reporter, hint: 'Enter company or client name'),
      AppTextField(label: 'Phone', controller: phone, keyboardType: TextInputType.phone, hint: '+91 98765 43210'),
      AppTextField(label: 'Email', controller: email, keyboardType: TextInputType.emailAddress, hint: 'Email address'),
      _section('Assignment & Schedule'),
      InputDecorator(decoration: fieldDecoration('Assign To Engineer'), child: Text(engineer)),
      const Text('The person raising the SR is its engineer and the one who works on it.',
          style: TextStyle(fontSize: 12, color: Brand.muted)),
      DateField(label: 'Expected Attend Date', value: attend, onChanged: (d) => setS(() => attend = d)),
      DateField(label: 'Expected Close Date', value: close, onChanged: (d) => setS(() => close = d)),
      AppSelect<String>(
        label: isEdit ? 'Status' : 'Initial Status',
        value: status,
        clearable: false,
        options: statusChoices,
        onChanged: (o) => setS(() => status = o?.value ?? status),
      ),
      _section('Notes', optional: true),
      AppTextField(label: 'Notes', controller: notes, maxLines: 3, hint: 'Any additional notes...'),
      _section('Attachments', optional: true),
      const Text('Images, videos, PDFs, Office documents', style: TextStyle(fontSize: 12, color: Brand.muted)),
      PickButtons(onPicked: (f) => setS(() => files.addAll(f))),
      StagedFiles(files: files, onRemove: (i) => setS(() => files.removeAt(i))),
    ],
    onSave: () async {
      if (projectId == null) throw 'Please select a machine/asset.';
      if (!isEdit && location.text.trim().isEmpty) {
        throw 'Site / Location is required — enter where the machine is right now (e.g. Itarsi yard, Line 4).';
      }
      if (serviceType == null) throw 'Please select a Service Type (e.g. Warranty, AMC, Paid Service).';
      if (title.text.trim().isEmpty) throw 'Issue title is required.';
      if (priority == null) throw 'Please select a priority level.';
      if (!_phoneValid(phone.text)) throw 'Please enter a valid phone number before submitting.';
      if (email.text.trim().isNotEmpty && !_emailRe.hasMatch(email.text.trim())) {
        throw 'Enter a valid email address (e.g. name@company.com).';
      }
      final desc = [
        description.text.trim(),
        if (location.text.trim().isNotEmpty) 'Location: ${location.text.trim()}',
      ].where((s) => s.isNotEmpty).join('\n\n');
      final payload = <String, dynamic>{
        'issue_title': title.text.trim(),
        'issue_description': desc,
        'service_type': serviceType,
        'priority': priority,
        'status': status,
        'expected_date_to_attend': attend == null ? '' : apiDate(attend!),
        'expected_completion_date': close == null ? '' : apiDate(close!),
        'reported_by_name': reporter.text.trim(),
        'reported_by_phone': phone.text.trim(),
        'reported_by_email': email.text.trim(),
        'service_report_notes': notes.text.trim(),
      };
      if (!isEdit) {
        payload['project_id'] = projectId;
        payload.removeWhere((k, v) => v == '' || v == null);
        if (createdId == null) {
          final created = await Api.post('/erp/service-requests', data: payload);
          createdId = (created as Map)['id'] as int;
        }
        if (files.isNotEmpty) {
          try {
            await uploadFiles('/erp/service-requests/$createdId/attachments', files);
          } catch (e) {
            throw 'The service request was created, but the files did not upload: ${ApiClient.describe(e)} '
                'Upload them again from its Attachments tab.';
          }
        }
      } else {
        // Untouched empty text boxes are not edits; a cleared date is sent as null.
        payload.removeWhere((k, v) => v == '' && (initial[k] == null || initial[k] == ''));
        for (final k in ['expected_date_to_attend', 'expected_completion_date']) {
          if (payload[k] == '') payload[k] = null;
        }
        await Api.patch('/erp/service-requests/${initial['id']}', data: payload);
        if (files.isNotEmpty) await uploadFiles('/erp/service-requests/${initial['id']}/attachments', files);
      }
    },
  );
  if (isEdit) return saved ? initial['id'] as int : null;
  // A create whose file upload failed still made the SR - open it anyway.
  return createdId;
}
