import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';

const _docTypeLabels = <String, String>{
  'sop': 'SOP',
  'specification': 'Specification',
  'certificate': 'Certificate',
  'standard_reference': 'Standard Reference',
  'other': 'Other',
};
const _docTypeHex = <String, Color>{
  'sop': Color(0xFF2563EB),
  'specification': Color(0xFF7C3AED),
  'certificate': Color(0xFF16A34A),
  'standard_reference': Color(0xFFFF6A2A),
  'other': Color(0xFF78716C),
};

String _bytes(Object? v) {
  final n = asNum(v);
  if (n == null) return '—';
  if (n < 1024) return '$n B';
  if (n < 1024 * 1024) return '${(n / 1024).toStringAsFixed(1)} KB';
  return '${(n / (1024 * 1024)).toStringAsFixed(1)} MB';
}

/// Quality Documents (portal documents/page.tsx).
class DocumentsTab extends StatefulWidget {
  const DocumentsTab({super.key});

  @override
  State<DocumentsTab> createState() => _DocumentsTabState();
}

class _DocumentsTabState extends State<DocumentsTab> {
  String _docType = '';
  int? _standardId;
  List<Option<int>> _standards = [];
  final _listKey = GlobalKey<ApiListViewState>();

  @override
  void initState() {
    super.initState();
    Api.get('/quality/standards', query: {'status': 'active'}).then((r) {
      if (mounted) {
        setState(() => _standards = [
              for (final s in rowsOf(r)) Option(asInt(s['id'])!, '${txt(s['standard_code'])} — ${txt(s['title'])}'),
            ]);
      }
    }).catchError((_) {});
  }

  void _reload() => _listKey.currentState?.reload();

  Future<void> _upload() async {
    var type = 'sop';
    final title = TextEditingController();
    final version = TextEditingController();
    int? standard;
    final desc = TextEditingController();
    var files = <MultipartFile>[];
    final ok = await showFormSheet(
      context,
      title: 'Upload Document',
      saveLabel: 'Upload',
      builder: (ctx, setS) => [
        const Text('Store an SOP, specification, certificate or standard reference in SharePoint.',
            style: TextStyle(fontSize: 13, color: Brand.muted)),
        const Caps('Document'),
        AppSelect<String>(
          label: 'Doc Type',
          required: true,
          value: type,
          options: [for (final e in _docTypeLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        AppTextField(label: 'Version', controller: version, hint: 'e.g. v1.0'),
        AppTextField(label: 'Title', required: true, controller: title, hint: 'e.g. Incoming Inspection SOP'),
        AppSelect<int>(
          label: 'Linked Standard',
          value: standard,
          options: _standards,
          onChanged: (o) => setS(() => standard = o?.value),
        ),
        AppTextField(label: 'Description', controller: desc, maxLines: 3, hint: 'Notes about this document'),
        const Caps('File(s) *'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          secondaryBtn('Choose files', () async {
            try {
              final picked = await Files.pickFiles();
              if (picked.isNotEmpty) setS(() => files = [...files, ...picked]);
            } catch (e) {
              if (ctx.mounted) showSnack(ctx, 'Could not read the file: $e', error: true);
            }
          }, icon: Icons.attach_file_rounded),
          secondaryBtn('Take photo', () async {
            final picked = await Files.takePhoto();
            if (picked != null) setS(() => files = [...files, picked]);
          }, icon: Icons.photo_camera_outlined),
          if (files.isNotEmpty) secondaryBtn('Clear', () => setS(() => files = []), icon: Icons.clear_rounded),
        ]),
        for (final f in files) Text('• ${f.filename ?? 'file'}', style: const TextStyle(fontSize: 13)),
        const Text('Each file is saved as its own document with the same type, title and version.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (files.isEmpty) throw 'Select at least one file to upload.';
        if (title.text.trim().isEmpty) throw 'Title is required.';
        final form = FormData();
        form.fields.add(MapEntry('doc_type', type));
        form.fields.add(MapEntry('title', title.text.trim()));
        if (version.text.trim().isNotEmpty) form.fields.add(MapEntry('version', version.text.trim()));
        if (standard != null) form.fields.add(MapEntry('linked_standard_id', '$standard'));
        if (desc.text.trim().isNotEmpty) form.fields.add(MapEntry('description', desc.text.trim()));
        for (final f in files) {
          form.files.add(MapEntry('files', f));
        }
        await Api.dio.post('/quality/documents',
            data: form,
            options: Options(contentType: 'multipart/form-data', sendTimeout: const Duration(minutes: 2), receiveTimeout: const Duration(minutes: 2)));
      },
    );
    if (ok && mounted) {
      showSnack(context, 'Uploaded.');
      _reload();
    }
  }

  Future<void> _delete(Json d) async {
    final yes = await confirmDialog(context,
        title: 'Delete document?',
        message: 'This permanently removes "${d['title']}" (${d['file_name']}). This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.delete('/quality/documents/${d['id']}'), success: 'Document deleted.');
    if (ok) _reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: CreateFab(label: 'Upload Document', onPressed: _upload),
      body: ApiListView(
        key: _listKey,
        load: (page, search) =>
            Api.list('/quality/documents', query: {'doc_type': _docType, 'linked_standard_id': _standardId}),
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Documents',
              subtitle: 'SOPs, specifications, certificates, and standard references.'),
          FilterSelect(
            label: 'Doc type',
            allLabel: 'All doc types',
            value: _docType,
            options: _docTypeLabels,
            onChanged: (v) {
              setState(() => _docType = v);
              _reload();
            },
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: AppSelect<int>(
              label: 'All standards',
              value: _standardId,
              options: _standards,
              onChanged: (o) {
                setState(() => _standardId = o?.value);
                _reload();
              },
            ),
          ),
        ]),
        emptyText: 'No documents match — use + Upload Document to add one.',
        itemBuilder: (ctx, d, reload) => RecordCard(
          title: txt(d['title']),
          subtitle: str(d['file_name']),
          trailing: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: StatusBadge(lbl(_docTypeLabels, d['doc_type']), color: _docTypeHex[str(d['doc_type'])] ?? qGrey),
          ),
          meta: [
            ('Version', txt(d['version'])),
            ('Size', _bytes(d['file_size'])),
            ('Uploaded By', txt(d['uploaded_by_name'])),
            ('Uploaded On', fmtDate(d['created_at'])),
          ],
          onTap: () => showModalBottomSheet<void>(
            context: ctx,
            backgroundColor: Colors.white,
            builder: (sheet) => SafeArea(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                ListTile(title: Text(txt(d['title']), style: const TextStyle(fontWeight: FontWeight.w700))),
                ListTile(
                  leading: const Icon(Icons.open_in_new_rounded),
                  title: const Text('View'),
                  onTap: () {
                    Navigator.pop(sheet);
                    runAction(ctx, () => Files.downloadAndOpen('/quality/documents/${d['id']}/content', str(d['file_name'])));
                  },
                ),
                if (qCanDelete('documents', d['uploaded_by_id']))
                  ListTile(
                    leading: const Icon(Icons.delete_outline_rounded, color: qRed),
                    title: const Text('Delete', style: TextStyle(color: qRed)),
                    onTap: () {
                      Navigator.pop(sheet);
                      _delete(d);
                    },
                  ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}
