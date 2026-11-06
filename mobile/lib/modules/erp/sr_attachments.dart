import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'erp_common.dart';

/// SR › Attachments (portal: AttachmentsTab) - site photos from the camera,
/// gallery or files; tap a file to open it; delete with confirmation.
class SrAttachmentsTab extends StatefulWidget {
  const SrAttachmentsTab(
      {super.key, required this.sr, required this.canUpload, required this.canDelete, required this.onChanged});
  final Json sr;
  final bool canUpload;
  final bool canDelete;
  final VoidCallback onChanged;

  @override
  State<SrAttachmentsTab> createState() => _SrAttachmentsTabState();
}

class _SrAttachmentsTabState extends State<SrAttachmentsTab> {
  final _staged = <MultipartFile>[];
  bool _uploading = false;
  String? _error;

  String get _base => '/erp/service-requests/${widget.sr['id']}/attachments';

  Future<void> _upload() async {
    setState(() {
      _uploading = true;
      _error = null;
    });
    try {
      await uploadFiles(_base, List.of(_staged));
      if (!mounted) return;
      setState(_staged.clear);
      showSnack(context, 'Files uploaded.');
      widget.onChanged();
    } catch (e) {
      if (mounted) {
        setState(() => _error = 'Could not upload the files — ${ApiClient.describe(e)} Check the file size, then try again.');
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _delete(Json a) async {
    final ok = await confirmDialog(context,
        title: 'Delete this attachment?',
        message:
            'Delete "${a['filename']}" from ${widget.sr['request_number']}? The file is also removed from SharePoint and can\'t be restored.',
        confirmLabel: 'Delete',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('$_base/${a['id']}'), success: 'Attachment deleted.')) {
      widget.onChanged();
    }
  }

  @override
  Widget build(BuildContext context) {
    final files = (widget.sr['attachments'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    return DetailSection(
      'Attachments & Documents',
      action: Text('${files.length} file(s)', style: const TextStyle(fontSize: 12, color: Brand.muted)),
      children: [
        if (widget.canUpload) ...[
          PickButtons(enabled: !_uploading, onPicked: (f) => setState(() => _staged.addAll(f))),
          const SizedBox(height: 6),
          const Text('PDF · DOCX · XLSX · JPG/PNG · MP4', style: TextStyle(fontSize: 11.5, color: Brand.muted)),
          if (_staged.isNotEmpty) ...[
            const SizedBox(height: 10),
            StagedFiles(files: _staged, onRemove: (i) => setState(() => _staged.removeAt(i))),
            const SizedBox(height: 8),
            Row(children: [
              SmallButton(_uploading ? 'Uploading…' : 'Upload ${_staged.length}',
                  primary: true, icon: Icons.cloud_upload_outlined, onPressed: _uploading ? null : _upload),
              const SizedBox(width: 8),
              SmallButton('Cancel', onPressed: _uploading ? null : () => setState(_staged.clear)),
            ]),
          ],
          const SizedBox(height: 12),
        ],
        if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 10)],
        if (files.isEmpty)
          const Text('No attachments uploaded.', style: TextStyle(fontSize: 13, color: Brand.muted))
        else
          for (final a in files)
            Container(
              margin: const EdgeInsets.only(bottom: 8),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
              child: ListTile(
                dense: true,
                leading: Icon(_iconFor(a['filename']), color: Brand.muted),
                title: Text(txt(a['filename']), style: const TextStyle(color: Color(0xFF2563EB), fontSize: 13.5)),
                subtitle: a['created_at'] == null ? null : Text(fmtDateTime(a['created_at'])),
                onTap: () => openApiFile(context, '$_base/${a['id']}/content', txt(a['filename'])),
                trailing: widget.canDelete
                    ? IconButton(
                        tooltip: 'Delete',
                        icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
                        onPressed: () => _delete(a),
                      )
                    : null,
              ),
            ),
      ],
    );
  }

  IconData _iconFor(Object? name) {
    final n = (name ?? '').toString().toLowerCase();
    if (n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.png')) return Icons.image_outlined;
    if (n.endsWith('.mp4') || n.endsWith('.mov')) return Icons.movie_outlined;
    if (n.endsWith('.pdf')) return Icons.picture_as_pdf_outlined;
    return Icons.insert_drive_file_outlined;
  }
}
