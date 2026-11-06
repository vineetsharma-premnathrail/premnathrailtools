// Documents tab - phone copy of frontend/src/components/electrical/DocumentsTab.tsx:
// specs, reports, manuals and photos of a job, optionally tied to a stage.
// Drawings have their own revision-controlled tab.
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'common.dart';

class DocumentsTab extends StatefulWidget {
  const DocumentsTab({super.key, required this.job, required this.meta, required this.canEdit, required this.onChanged});
  final Json job;
  final ElecMeta meta;

  /// Job open and the role may upload or delete documents.
  final bool canEdit;
  final VoidCallback onChanged;

  @override
  State<DocumentsTab> createState() => _DocumentsTabState();
}

class _DocumentsTabState extends State<DocumentsTab> {
  List<Json> _docs = [];
  bool _loading = true;
  String? _error;
  String _category = '';
  bool _busy = false;

  Json get job => widget.job;
  int get jobId => asInt(job['id'])!;
  String get jobNo => str(job['job_number']);
  Map<String, String> get _cats => widget.meta.documentCategories;
  String _catLabel(Object? c) => _cats[str(c)] ?? str(c).replaceAll('_', ' ');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = rowsOf(await Api.get('/electrical/jobs/$jobId/documents', query: {'category': _category}));
      if (mounted) {
        setState(() {
          _docs = rows;
          _error = null;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Could not load the documents for $jobNo. ${ApiClient.describe(e)}';
          _loading = false;
        });
      }
    }
  }

  Future<void> _upload() async {
    final title = TextEditingController();
    final description = TextEditingController();
    var category = _cats.containsKey('other') ? 'other' : (_cats.keys.isEmpty ? 'other' : _cats.keys.first);
    String? stageKey;
    final files = <PickedFile>[];
    final stages = widget.meta.stages;
    final ok = await showFormSheet(
      context,
      title: 'Upload Documents',
      saveLabel: 'Upload',
      builder: (ctx, setS) => [
        Muted('Specs, reports, manuals or photos for $jobNo. Drawings go on the Drawings tab.'),
        const FormHeading('Document'),
        AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Factory insulation test report'),
        AppSelect<String>(
          label: 'Category',
          value: category,
          clearable: false,
          options: optionsOf(_cats),
          onChanged: (o) => setS(() => category = o?.value ?? category),
        ),
        AppSelect<String>(
          label: 'Stage',
          value: stageKey,
          valueLabel: '— Not tied to a stage —',
          options: [for (final s in stages) Option(str(s['key']), str(s['label']))],
          onChanged: (o) => setS(() => stageKey = o?.value),
        ),
        AppTextField(label: 'Description (optional)', controller: description, maxLines: 3),
        const FormHeading('Files *'),
        for (var i = 0; i < files.length; i++)
          Row(children: [
            const Icon(Icons.insert_drive_file_outlined, size: 18, color: Brand.muted),
            const SizedBox(width: 8),
            Expanded(child: Text(files[i].name, overflow: TextOverflow.ellipsis)),
            IconButton(
              tooltip: 'Remove',
              icon: const Icon(Icons.close_rounded, size: 18),
              onPressed: () => setS(() => files.removeAt(i)),
            ),
          ]),
        Row(children: [
          OutlinedButton.icon(
            icon: const Icon(Icons.attach_file_rounded, size: 18),
            label: const Text('Choose files'),
            onPressed: () async {
              final picked = await Files.pickFiles();
              setS(() => files.addAll(picked.map((f) => PickedFile(f, f.filename ?? 'file'))));
            },
          ),
          const SizedBox(width: 8),
          OutlinedButton.icon(
            icon: const Icon(Icons.photo_camera_outlined, size: 18),
            label: const Text('Photo'),
            onPressed: () async {
              final f = await Files.takePhoto();
              if (f != null) setS(() => files.add(PickedFile(f, f.filename ?? 'photo.jpg')));
            },
          ),
        ]),
        const Muted('Each file becomes its own document entry with the same title and category.', size: 12),
      ],
      onSave: () async {
        if (title.text.trim().isEmpty) throw 'Document title is required.';
        if (files.isEmpty) throw 'Choose at least one file to upload.';
        final fd = FormData();
        fd.fields.add(MapEntry('title', title.text.trim()));
        fd.fields.add(MapEntry('category', category));
        if (stageKey != null) fd.fields.add(MapEntry('stage_key', stageKey!));
        if (description.text.trim().isNotEmpty) fd.fields.add(MapEntry('description', description.text.trim()));
        for (final f in files) {
          fd.files.add(MapEntry('files', f.file));
        }
        await Api.post('/electrical/jobs/$jobId/documents', data: fd);
      },
    );
    final t = title.text.trim();
    title.dispose();
    description.dispose();
    if (!ok) return;
    await _load();
    widget.onChanged();
    if (mounted) showSnack(context, '${files.length} ${plural(files.length, 'file')} uploaded as "$t".');
  }

  Future<void> _delete(Json d) async {
    final ok = await confirmDialog(context,
        title: 'Delete document?',
        message: '"${d['title']}" (${d['file_name']}) will be removed from $jobNo and its file deleted from storage.',
        confirmLabel: 'Delete');
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    final done = await runAction(context, () => Api.delete('/electrical/documents/${d['id']}'),
        success: '"${d['title']}" (${d['file_name']}) deleted.');
    if (done) {
      await _load();
      widget.onChanged();
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final canUpload = widget.canEdit && Elec.jf('documents', 'create');
    bool canDelete(Json d) =>
        widget.canEdit && Elec.jf('documents', 'delete') && (Perm.isAdmin || asInt(d['uploaded_by_id']) == Perm.userId);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabHeader(
            title: 'Documents (${_docs.length})',
            action: canUpload ? primaryBtn('Upload Documents', _busy ? null : _upload, icon: Icons.upload_rounded) : null,
          ),
          AppSelect<String>(
            label: 'Category',
            value: _category,
            clearable: false,
            options: [const Option('', 'All categories'), ...optionsOf(_cats)],
            onChanged: (o) {
              setState(() {
                _category = o?.value ?? '';
                _loading = true;
              });
              _load();
            },
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Muted('Final Electrical Documentation needs a Test Report, Commissioning Report or O&M Manual here.',
                size: 12),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: ErrorBanner(_error!)),
          if (_loading)
            const LoadingView()
          else if (_docs.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Muted(
                  _category.isNotEmpty ? 'No ${_catLabel(_category)} documents on this job.' : 'No documents on this job yet.',
                  size: 13),
            )
          else
            for (final d in _docs)
              ItemCard(children: [
                Text(str(d['title']), style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: Brand.heading)),
                if (str(d['description']).isNotEmpty) Muted(str(d['description']), size: 12),
                const SizedBox(height: 6),
                InkWell(
                  onTap: () => openElecFile(context, '/electrical/documents/${d['id']}/content', str(d['file_name'])),
                  child: Text(
                    '${d['file_name']}${fmtBytes(d['file_size']).isNotEmpty ? ' · ${fmtBytes(d['file_size'])}' : ''}',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: cOrange),
                  ),
                ),
                MetaWrap([
                  ('Category', _catLabel(d['category'])),
                  ('Stage', txt(d['stage_label'])),
                  ('Uploaded', '${txt(d['uploaded_by_name'])} · ${fmtDate(d['created_at'])}'),
                ]),
                if (canDelete(d)) ...[
                  const SizedBox(height: 8),
                  btnWrap([smallBtn('Delete', _busy ? null : () => _delete(d), danger: true)]),
                ],
              ]),
        ],
      ),
    );
  }
}