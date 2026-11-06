import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';

const rndDocCategories = [
  Option('customer_specification', 'Customer Specification'),
  Option('technical_specification', 'Technical Specification'),
  Option('reference_standard', 'Reference Standard'),
  Option('drawing', 'Drawing'),
  Option('calculation', 'Calculation'),
  Option('test_report', 'Test Report'),
  Option('datasheet', 'Datasheet'),
  Option('other', 'Other'),
];
const _groupLabels = {'crm': 'Business team (CRM)', 'task': 'Tasks', 'rnd': 'R&D'};
const _groupHex = {'crm': '#2563EB', 'task': '#7C3AED', 'rnd': '#16A34A'};

String categoryLabel(Object? v) {
  if (v == 'technical_offer') return 'Technical Offer';
  for (final c in rndDocCategories) {
    if (c.value == v) return c.label;
  }
  return txt(v);
}

/// Requirement › Documents (portal: RequirementDocumentsTab): every file R&D
/// may see, searchable, filtered by category and source; upload with one
/// required category.
class RequirementDocumentsTab extends StatefulWidget {
  const RequirementDocumentsTab({
    super.key,
    required this.source,
    required this.recordId,
    required this.canUpload,
    required this.canDownload,
  });
  final String source;
  final int recordId;
  final bool canUpload;
  final bool canDownload;

  @override
  State<RequirementDocumentsTab> createState() => _RequirementDocumentsTabState();
}

class _RequirementDocumentsTabState extends State<RequirementDocumentsTab> {
  List<Json>? _docs;
  Object? _error;
  String _search = '';
  String _group = 'all';
  String? _category;

  String get _base => '/rnd/requirement-work/${widget.source}/${widget.recordId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = jsonList(await Api.get('$_base/all-documents'));
      if (mounted) {
        setState(() {
          _docs = d;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _docs ??= [];
          _error = e;
        });
      }
    }
  }

  Future<void> _upload() async {
    String? category;
    var files = <MultipartFile>[];
    final ok = await showFormSheet(
      context,
      title: 'Upload Documents',
      saveLabel: 'Upload',
      builder: (ctx, setS) => [
        const Hint("Added to this requirement's documents — never shown in CRM."),
        AppSelect<String>(
          label: 'Category',
          required: true,
          value: category,
          options: rndDocCategories,
          onChanged: (o) => setS(() => category = o?.value),
        ),
        const Hint('One category for the files in this upload. Technical Offers are uploaded from the Technical Offers tab.'),
        FilesField(label: 'Files', required: true, files: files, onChanged: (f) => setS(() => files = f)),
      ],
      onSave: () async {
        if (category == null) {
          throw 'Pick a category — it decides how the file is filed (e.g. Drawing, Calculation, Customer Specification).';
        }
        if (files.isEmpty) throw 'Choose at least one file to upload.';
        await postForm('$_base/documents', {'category': category}, files: files);
      },
    );
    if (ok) await _load();
  }

  Future<void> _changeCategory(Json d) async {
    String? next;
    final ok = await showFormSheet(
      context,
      title: 'Change category',
      builder: (ctx, setS) => [
        Hint(str(d, 'name') ?? ''),
        AppSelect<String>(
          label: 'Category',
          required: true,
          value: next ?? str(d, 'category'),
          options: rndDocCategories,
          onChanged: (o) => setS(() => next = o?.value),
        ),
      ],
      onSave: () async {
        if (next == null || next == d['category']) return;
        await Api.patch('/rnd/requirement-work/documents/${d['id']}/category', data: {'category': next});
      },
    );
    if (ok) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final all = _docs;
    if (all == null) return const LoadingView();
    final q = _search.trim().toLowerCase();
    final shown = all.where((d) {
      if (_group != 'all' && d['group'] != _group) return false;
      if (_category != null && d['category'] != _category) return false;
      if (q.isEmpty) return true;
      return [
        d['name'],
        d['uploaded_by'],
        d['context'],
        categoryLabel(d['category']),
        _groupLabels[d['group']],
      ].any((v) => (v ?? '').toString().toLowerCase().contains(q));
    }).toList();
    int count(String g) => g == 'all' ? all.length : all.where((d) => d['group'] == g).length;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          const NoteBox(
            'Everything on this requirement in one place — files from the business team, task files and the documents R&D '
            'uploaded. Each uploaded file has one category. Nothing here shows in CRM.',
            color: Brand.muted,
          ),
          if (widget.canUpload)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: FilledButton.icon(
                onPressed: _upload,
                icon: const Icon(Icons.upload_file_rounded),
                label: const Text('Upload documents'),
              ),
            ),
          if (_error != null)
            Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(ApiClient.describe(_error!))),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: SearchField(hint: 'Search file name, uploaded by, task…', onChanged: (v) => setState(() => _search = v)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: AppSelect<String>(
              label: 'Category',
              value: _category,
              options: [...rndDocCategories, const Option('technical_offer', 'Technical Offer')],
              onChanged: (o) => setState(() => _category = o?.value),
            ),
          ),
          ChipRow(
            children: [
              for (final g in const ['all', 'crm', 'task', 'rnd'])
                CountChip(
                  g == 'all' ? 'All' : _groupLabels[g]!,
                  count(g),
                  selected: _group == g,
                  onTap: () => setState(() => _group = _group == g ? 'all' : g),
                ),
            ],
          ),
          if (shown.isEmpty)
            EmptyView(
              all.isEmpty ? 'None yet.' : 'No documents match — clear the search or pick another filter.',
              icon: Icons.folder_open_outlined,
            ),
          for (final d in shown)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Card(
                child: ListTile(
                  onTap: widget.canDownload ? () => openWorkDocument(context, d) : null,
                  title: Text(
                    str(d, 'name') ?? '',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: widget.canDownload ? const Color(0xFF2563EB) : Brand.body,
                    ),
                  ),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 4),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          Pill(_groupLabels[d['group']] ?? 'R&D', hexColor(_groupHex[d['group'] ?? 'rnd'] ?? '#78716c')),
                          if (d['category'] != null || d['category_label'] != null)
                            Pill(str(d, 'category_label') ?? categoryLabel(d['category']), const Color(0xFF475569)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        [
                          str(d, 'context'),
                          d['file_size'] != null ? fmtSize(d['file_size']) : null,
                          '${d['uploaded_by'] ?? '—'} · ${fmtDateTime(d['uploaded_at'])}',
                        ].whereType<String>().join(' · '),
                        style: const TextStyle(fontSize: 11.5),
                      ),
                    ],
                  ),
                  trailing: boolOf(d['can_change_category'])
                      ? IconButton(
                          tooltip: 'Change category',
                          onPressed: () => _changeCategory(d),
                          icon: const Icon(Icons.label_outline),
                        )
                      : null,
                ),
              ),
            ),
          if (!widget.canDownload && all.isNotEmpty)
            const NoteBox(
              'You can see the list but not open files — ask the R&D head for the Download right.',
              color: Brand.muted,
            ),
        ],
      ),
    );
  }
}
