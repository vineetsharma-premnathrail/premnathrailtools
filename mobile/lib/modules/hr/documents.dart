import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';

// Portal: components/hr/employee/EmployeeDocumentsTab.tsx

const _docTypes = [
  'ID Proof', 'Address Proof', 'PAN Card', 'Aadhaar Card', 'Passport', 'Driving Licence', 'Offer Letter', 'Appointment Letter',
  'Educational Certificate', 'Experience Letter', 'Relieving Letter', 'Medical Certificate', 'Bank Details', 'Photograph',
  'Confirmation Letter', 'Increment / Promotion Letter', 'Warning / Disciplinary', 'Other',
];
const _confidentiality = ['Confidential', 'Internal', 'HR Only'];

(String, String)? _expiry(Object? expiry) {
  final d = dateOf(expiry);
  if (d == null) return null;
  final now = DateTime.now();
  final days = d.difference(DateTime(now.year, now.month, now.day)).inDays;
  if (days < 0) return ('Expired ${fmtDate(expiry)}', '#DC2626');
  if (days <= 30) return ('Expires in $days day${days == 1 ? '' : 's'}', '#EA580C');
  return ('Valid till ${fmtDate(expiry)}', '#16A34A');
}

String _size(Object? b) {
  final n = toNum(b);
  if (n <= 0) return '';
  if (n < 1024 * 1024) return '${(n / 1024).toStringAsFixed(0)} KB';
  return '${(n / 1024 / 1024).toStringAsFixed(1)} MB';
}

/// Employee documents. `base` = '/hr/employees/me' (self), '/hr/employees/{id}'
/// or '/hr/employees/workers/{id}' (HR).
class DocumentsSection extends StatefulWidget {
  const DocumentsSection({super.key, required this.base, required this.hrMode});
  final String base;
  final bool hrMode;

  @override
  State<DocumentsSection> createState() => _DocumentsSectionState();
}

class _DocumentsSectionState extends State<DocumentsSection> {
  List<Json>? _docs;
  Object? _error;

  bool get _canUpload => widget.hrMode && Perm.canFeature('hr', 'employees', 'documents', 'create');
  bool get _canOpen => !widget.hrMode || Perm.canFeature('hr', 'employees', 'documents', 'export');
  bool get _canDelete => widget.hrMode && Perm.canFeature('hr', 'employees', 'documents', 'delete');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = (await Api.list('${widget.base}/documents')).rows;
      if (mounted) setState(() { _docs = d; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _upload() async {
    var type = 'ID Proof';
    final name = TextEditingController();
    final number = TextEditingController();
    final authority = TextEditingController();
    DateTime? issue;
    DateTime? expiry;
    var conf = 'Confidential';
    final tags = TextEditingController();
    final remarks = TextEditingController();
    MultipartFile? file;
    final ok = await showFormSheet(context,
        title: 'Upload document',
        saveLabel: 'Upload',
        builder: (ctx, setS) => [
              const HintText('Stored in SharePoint. Documents with an expiry date trigger reminders 30 and 7 days before, and on the day.'),
              AppSelect<String>(label: 'Document Type', required: true, value: type, clearable: false,
                  options: [for (final t in _docTypes) Option(t, t)], onChanged: (o) => setS(() => type = o?.value ?? type)),
              AppTextField(label: 'Document Name', controller: name, required: true, hint: 'e.g. PAN card'),
              AppTextField(label: 'Document Number', controller: number),
              AppTextField(label: 'Issuing Authority', controller: authority),
              DateField(label: 'Issue Date', value: issue, onChanged: (d) => setS(() => issue = d)),
              DateField(label: 'Expiry Date', value: expiry, onChanged: (d) => setS(() => expiry = d)),
              Row(children: [
                Expanded(child: Text(file == null ? 'File * — none chosen' : 'File: ${file!.filename}', style: const TextStyle(fontSize: 13.5))),
                LinkAction('Camera', () async { final f = await Files.takePhoto(); if (f != null) setS(() => file = f); }),
                LinkAction('Choose', () async { final f = await Files.pickFile(); if (f != null) setS(() => file = f); }),
              ]),
              AppSelect<String>(label: 'Visibility', value: conf, clearable: false,
                  options: [for (final c in _confidentiality) Option(c, c)], onChanged: (o) => setS(() => conf = o?.value ?? conf)),
              const HintText('"HR Only" hides the file from the employee\'s own My HR page.'),
              AppTextField(label: 'Tags (comma separated)', controller: tags),
              AppTextField(label: 'Remarks', controller: remarks, maxLines: 2),
            ],
        onSave: () async {
          final p = <String>[];
          if (file == null) p.add('Choose the file to upload.');
          if (name.text.trim().isEmpty) p.add('Enter a document name (e.g. "PAN card").');
          if (issue != null && expiry != null && expiry!.isBefore(issue!)) p.add('Expiry date is before the issue date. Check both dates.');
          if (file != null && file!.length > 25 * 1024 * 1024) {
            p.add('"${file!.filename}" is ${(file!.length / 1024 / 1024).toStringAsFixed(1)} MB; the limit is 25 MB. Compress or split it first.');
          }
          if (p.isNotEmpty) throw p.join(' ');
          final meta = <String, dynamic>{
            'document_type': type, 'document_name': name.text.trim(), 'document_number': textOrNull(number.text),
            'issue_date': isoOrNull(issue), 'expiry_date': isoOrNull(expiry), 'issuing_authority': textOrNull(authority.text),
            'confidentiality': conf, 'tags': textOrNull(tags.text), 'remarks': textOrNull(remarks.text),
          }..removeWhere((k, v) => v == null);
          await Api.dio.post('${widget.base}/documents',
              data: FormData.fromMap({...meta, 'file': file}), options: Options(receiveTimeout: const Duration(seconds: 120)));
        });
    if (ok) _load();
  }

  Future<void> _delete(Json d) async {
    final yes = await confirmDialog(context,
        title: 'Delete this document?', message: '“${d['document_name']}” is removed from the record.', confirmLabel: 'Delete', danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.delete('${widget.base}/documents/${d['id']}'));
    if (ok) _load();
  }

  @override
  Widget build(BuildContext context) {
    final docs = _docs;
    return DetailSection('Documents', action: _canUpload ? LinkAction('+ Upload', _upload) : null, children: [
      if (_error != null) ErrorBanner(ApiClient.describe(_error!)),
      if (docs == null && _error == null) const LoadingView(),
      if (docs != null && docs.isEmpty)
        HintText(widget.hrMode ? 'No documents on this employee’s record yet.' : 'HR has not added any documents to your record yet.'),
      for (final d in docs ?? const <Json>[]) ...[
        const Divider(height: 16),
        Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text(str(d['document_name']), style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
          HrPill(str(d['document_type']), '#E85A1F'),
          if (str(d['confidentiality']).isNotEmpty) HrPill(str(d['confidentiality']), '#475569'),
          if (_expiry(d['expiry_date']) case final x?) HrPill(x.$1, x.$2),
        ]),
        const SizedBox(height: 2),
        HintText(joinNonEmpty([
          d['filename'], _size(d['size']), str(d['document_number']).isEmpty ? '' : 'No. ${d['document_number']}',
          str(d['issue_date']).isEmpty ? '' : 'Issued ${fmtDate(d['issue_date'])}', d['issuing_authority'], 'Added ${fmtDate(d['created_at'])}',
        ])),
        if (str(d['remarks']).isNotEmpty) Text(str(d['remarks']), style: const TextStyle(fontSize: 12.5)),
        actionRow([
          if (_canOpen) LinkAction('Open', () => openApiFile(context, '${widget.base}/documents/${d['id']}/content', str(d['filename']).isEmpty ? 'document' : str(d['filename']))),
          if (_canDelete) LinkAction('Delete', () => _delete(d), color: Brand.danger),
        ]),
      ],
    ]);
  }
}