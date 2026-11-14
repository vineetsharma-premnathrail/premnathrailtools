import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'design_common.dart';

/// Library - portal design/library: Standards, Standard parts, Approved
/// makes, Templates, Review checklists.

const _tabs = <(String, String, String)>[
  ('standards', 'Standards', 'standards'),
  ('parts', 'Standard parts', 'standard_parts'),
  ('makes', 'Approved makes', 'approved_makes'),
  ('templates', 'Templates', 'templates'),
  ('checklists', 'Review checklists', 'checklists'),
];
const _makeStatusLabels = {'approved': 'Approved', 'provisional': 'Provisional', 'withdrawn': 'Withdrawn'};
const _makeStatusColors = {'approved': Color(0xFF16A34A), 'provisional': Color(0xFFD97706), 'withdrawn': Color(0xFFDC2626)};
const _itemStatusColors = {'active': Color(0xFF16A34A), 'inactive': Color(0xFFA8A29E), 'blocked': Color(0xFFDC2626), 'pending': Color(0xFFD97706)};
const _checklistTypeLabels = docTypeLabels;

/// permissions.ts canDelete(): delete action + (admin, no owner, or own record).
bool _canDelete(Object? ownerId) {
  if (!Perm.can('design', 'library', 'delete')) return false;
  if (Perm.isAdmin) return true;
  return ownerId == null || asInt(ownerId) == Perm.userId;
}

class DesignLibraryTab extends StatefulWidget {
  const DesignLibraryTab({super.key});

  @override
  State<DesignLibraryTab> createState() => _DesignLibraryTabState();
}

class _DesignLibraryTabState extends State<DesignLibraryTab> {
  final _list = GlobalKey<ApiListViewState>();
  String _tab = 'standards';
  String? _discipline;
  Json _me = const {};

  @override
  void initState() {
    super.initState();
    DesignMe.load().then((m) {
      if (mounted) setState(() => _me = m);
    });
  }

  bool _lib(String tab, String action) => designFeature('library', _tabs.firstWhere((t) => t.$1 == tab).$3, action);
  bool get _isHead => DesignMe.isHead(_me);
  bool get _isTeam => DesignMe.isTeam(_me);
  void _reload() => _list.currentState?.reload();

  Future<void> _confirmDelete(String title, String message, String path) async {
    if (!await confirmDialog(context, title: title, message: message, confirmLabel: 'Delete', danger: true) || !mounted) return;
    if (await runAction(context, () => Api.delete(path), success: 'Deleted.')) _reload();
  }

  // ── Forms ──

  Future<void> _standardForm([Json? s]) async {
    String body = str(s?['body']).isEmpty ? 'RDSO' : str(s?['body']);
    final code = TextEditingController(text: str(s?['code']));
    final version = TextEditingController(text: str(s?['version']));
    final title = TextEditingController(text: str(s?['title']));
    final remarks = TextEditingController(text: str(s?['remarks']));
    bool current = s == null ? true : s['is_current'] == true;
    final ok = await showFormSheet(context, title: s == null ? 'Add a standard' : 'Edit ${s['code']}', builder: (ctx, setS) => [
          const InfoNote('The standards register drawings cite — code + version identify exactly which edition a drawing was designed to.'),
          AppSelect<String>(
              label: 'Body',
              required: true,
              clearable: false,
              value: body,
              options: [for (final b in standardBodies) Option(b, b == 'customer' ? 'Customer' : (b == 'internal' ? 'Internal' : (b == 'other' ? 'Other' : b)))],
              onChanged: (o) => setS(() => body = o?.value ?? body)),
          AppTextField(label: 'Code', controller: code, required: true, hint: 'e.g. IS 2062'),
          AppTextField(label: 'Version', controller: version, hint: 'e.g. 2011'),
          AppTextField(label: 'Title', controller: title, required: true, hint: 'Hot rolled medium and high tensile structural steel'),
          CheckField(label: 'Current edition', value: current, onChanged: (v) => setS(() => current = v)),
          AppTextField(label: 'Remarks', controller: remarks, maxLines: 3, hint: 'e.g. superseded by 2023 edition for new projects'),
        ], onSave: () async {
      if (code.text.trim().isEmpty || title.text.trim().length < 2) throw 'Give the standard its code (e.g. IS 2062) and a title.';
      final payload = {
        'body': body,
        'code': code.text.trim(),
        'title': title.text.trim(),
        'version': nullIfEmpty(version.text),
        'is_current': current,
        'remarks': nullIfEmpty(remarks.text),
      };
      s == null ? await Api.post('/design/library/standards', data: payload) : await Api.patch('/design/library/standards/${s['id']}', data: payload);
    });
    if (ok && mounted) {
      showSnack(context, 'Standard saved.');
      _reload();
    }
  }

  Future<void> _uploadStandardFile(Json s) async {
    final f = await Files.pickFile();
    if (f == null || !mounted) return;
    if (await runAction(context, () => Api.dio.post('/design/library/standards/${s['id']}/file', data: formData({'file': f})),
        success: '${f.filename} attached to ${s['code']}.')) {
      _reload();
    }
  }

  Future<void> _partForm([Json? p]) async {
    int? itemId = asInt(p?['store_item_id']), docId = asInt(p?['document_id']), stdId = asInt(p?['standard_id']);
    final itemLabel = p == null ? null : '${txt(p['item_code'])} — ${txt(p['item_name'])}';
    String? itemL = itemLabel, docL = nullIfEmpty(str(p?['doc_number'])), stdL = nullIfEmpty(str(p?['standard_label']));
    String discipline = str(p?['discipline']).isEmpty ? 'mechanical' : str(p?['discipline']);
    final notes = TextEditingController(text: str(p?['notes']));
    final ok = await showFormSheet(context, title: p == null ? 'Add a standard part' : 'Edit $itemLabel', builder: (ctx, setS) => [
          const InfoNote('A preferred bought-out / standard item designers should pick first.'),
          const Caps('Item'),
          if (p == null)
            AppSelect<int>(
                label: 'Item',
                required: true,
                value: itemId,
                valueLabel: itemL,
                loadOptions: (s) => designLookup('items', s, query: {'limit': 200}, sendSearch: true),
                onChanged: (o) => setS(() {
                      itemId = o?.value;
                      itemL = o?.label;
                    }))
          else
            FieldRow('Item', itemLabel),
          AppSelect<String>(
              label: 'Discipline', clearable: false, value: discipline, options: optionsOf(disciplineLabels), onChanged: (o) => setS(() => discipline = o?.value ?? discipline)),
          const Caps('Drawing & standard'),
          AppSelect<int>(
              label: 'Drawing',
              value: docId,
              valueLabel: docL,
              loadOptions: (s) => designLookup('documents', s, query: {'limit': 500}, sendSearch: true),
              onChanged: (o) => setS(() {
                    docId = o?.value;
                    docL = o?.label;
                  })),
          AppSelect<int>(
              label: 'Standard',
              value: stdId,
              valueLabel: stdL,
              loadOptions: (s) => designLookup('standards', s),
              onChanged: (o) => setS(() {
                    stdId = o?.value;
                    stdL = o?.label;
                  })),
          AppTextField(label: 'Notes', controller: notes, maxLines: 3, hint: 'e.g. use for all M12 structural joints; zinc flake coated'),
        ], onSave: () async {
      if (p == null && itemId == null) throw 'Pick the Item Master item that is the standard part.';
      final payload = {'document_id': docId, 'standard_id': stdId, 'discipline': discipline, 'notes': nullIfEmpty(notes.text)};
      p == null
          ? await Api.post('/design/library/standard-parts', data: {...payload, 'store_item_id': itemId})
          : await Api.patch('/design/library/standard-parts/${p['id']}', data: payload);
    });
    if (ok && mounted) {
      showSnack(context, 'Standard part saved.');
      _reload();
    }
  }

  Future<void> _makeForm([Json? m]) async {
    int? itemId = asInt(m?['store_item_id']);
    final itemLabel = m == null ? null : '${txt(m['item_code'])} — ${txt(m['item_name'])}';
    String? itemL = itemLabel;
    final make = TextEditingController(text: str(m?['make']));
    final part = TextEditingController(text: str(m?['part_number']));
    final remarks = TextEditingController(text: str(m?['remarks']));
    String status = str(m?['status']).isEmpty ? 'approved' : str(m?['status']);
    final ok = await showFormSheet(context, title: m == null ? 'Add an approved make' : 'Edit ${m['make']} for $itemLabel', builder: (ctx, setS) => [
          const InfoNote('Approved makes are kept per Item Master code — every BOM using the item shows the same list and Purchase buys only from it.'),
          const Caps('Item'),
          if (m == null)
            AppSelect<int>(
                label: 'Item',
                required: true,
                value: itemId,
                valueLabel: itemL,
                loadOptions: (s) => designLookup('items', s, query: {'limit': 200}, sendSearch: true),
                onChanged: (o) => setS(() {
                      itemId = o?.value;
                      itemL = o?.label;
                    }))
          else
            FieldRow('Item', itemLabel),
          const Caps('Make'),
          AppTextField(label: 'Make', controller: make, required: true, hint: 'e.g. SKF'),
          AppTextField(label: 'Part no.', controller: part, hint: 'e.g. 6205-2RS'),
          AppSelect<String>(
              label: 'Status', clearable: false, value: status, options: optionsOf(_makeStatusLabels), onChanged: (o) => setS(() => status = o?.value ?? status)),
          AppTextField(label: 'Remarks', controller: remarks, maxLines: 3, hint: 'e.g. provisional until first-lot inspection'),
        ], onSave: () async {
      if (m == null && itemId == null) throw 'Pick the Item Master item this make is approved for.';
      if (make.text.trim().isEmpty) throw 'Enter the make (manufacturer / brand).';
      final payload = {'make': make.text.trim(), 'part_number': nullIfEmpty(part.text), 'status': status, 'remarks': nullIfEmpty(remarks.text)};
      m == null
          ? await Api.post('/design/library/approved-makes', data: {...payload, 'store_item_id': itemId})
          : await Api.patch('/design/library/approved-makes/${m['id']}', data: payload);
    });
    if (ok && mounted) {
      showSnack(context, 'Approved make saved.');
      _reload();
    }
  }

  Future<void> _templateForm() async {
    String kind = 'title_block';
    final name = TextEditingController();
    final description = TextEditingController();
    MultipartFileHolder? file;
    final ok = await showFormSheet(context, title: 'Upload a template', saveLabel: 'Upload', builder: (ctx, setS) => [
          const InfoNote('A controlled template (title block, drawing sheet, BOM sheet…) everyone starts from.'),
          AppSelect<String>(
              label: 'Kind', required: true, clearable: false, value: kind, options: optionsOf(templateKindLabels), onChanged: (o) => setS(() => kind = o?.value ?? kind)),
          AppTextField(label: 'Name', controller: name, required: true, hint: 'e.g. A3 title block — 2026'),
          AppTextField(label: 'Description', controller: description, maxLines: 3, hint: 'When to use it, what changed from the last one…'),
          const Caps('File'),
          OutlinedButton.icon(
            icon: const Icon(Icons.attach_file_rounded),
            label: Text(file == null ? 'Choose file' : file!.name),
            onPressed: () async {
              final f = await Files.pickFile();
              if (f != null) setS(() => file = MultipartFileHolder(f));
            },
          ),
        ], onSave: () async {
      if (name.text.trim().isEmpty) throw 'Give the template a name.';
      if (file == null) throw 'Choose the template file to upload.';
      await Api.dio.post('/design/library/templates',
          data: formData({'kind': kind, 'name': name.text.trim(), if (description.text.trim().isNotEmpty) 'description': description.text.trim(), 'file': file!.file}));
    });
    if (ok && mounted) {
      showSnack(context, 'Template uploaded.');
      _reload();
    }
  }

  Future<void> _checklistForm([Json? c]) async {
    final name = TextEditingController(text: str(c?['name']));
    String type = str(c?['document_type']).isEmpty ? 'part_drawing' : str(c?['document_type']);
    String? discipline = nullIfEmpty(str(c?['discipline']));
    bool active = c == null ? true : c['is_active'] == true;
    final items = <(int?, TextEditingController)>[
      for (final it in jsonList(c?['items'])) (asInt(it['id']), TextEditingController(text: str(it['text']))),
    ];
    if (items.isEmpty) items.add((null, TextEditingController()));
    final ok = await showFormSheet(context, title: c == null ? 'New review checklist' : 'Edit ${c['name']}', builder: (ctx, setS) => [
          const InfoNote("The checker answers OK / Not OK / N.A. per item; a check can't pass with any item Not OK."),
          const Caps('Checklist'),
          AppTextField(label: 'Name', controller: name, required: true, hint: 'e.g. Part drawing check — mechanical'),
          if (c == null)
            AppSelect<String>(
                label: 'Document type',
                required: true,
                clearable: false,
                value: type,
                options: optionsOf(_checklistTypeLabels),
                onChanged: (o) => setS(() => type = o?.value ?? type))
          else
            FieldRow('Document type', labelOf(_checklistTypeLabels, type)),
          AppSelect<String>(
              label: 'Discipline (blank = any)', value: discipline, options: optionsOf(disciplineLabels), onChanged: (o) => setS(() => discipline = o?.value)),
          CheckField(label: 'Active', value: active, onChanged: (v) => setS(() => active = v)),
          const Caps('Items the checker answers *'),
          for (var i = 0; i < items.length; i++)
            Row(children: [
              Expanded(child: AppTextField(label: 'Item ${i + 1}', controller: items[i].$2, hint: 'e.g. Title block complete — material, finish, tolerance class')),
              IconButton(
                  icon: const Icon(Icons.arrow_upward_rounded, size: 18),
                  onPressed: i == 0
                      ? null
                      : () => setS(() {
                            final x = items.removeAt(i);
                            items.insert(i - 1, x);
                          })),
              IconButton(icon: const Icon(Icons.delete_outline_rounded, size: 18, color: Brand.danger), onPressed: () => setS(() => items.removeAt(i))),
            ]),
          OutlinedButton.icon(
              icon: const Icon(Icons.add_rounded), label: const Text('Add item'), onPressed: () => setS(() => items.add((null, TextEditingController())))),
        ], onSave: () async {
      if (name.text.trim().length < 2) throw 'Give the checklist a name.';
      final rows = items.where((r) => r.$2.text.trim().isNotEmpty).toList();
      if (rows.isEmpty) throw 'A checklist needs at least one item for the checker to answer.';
      if (rows.any((r) => r.$2.text.trim().length < 2)) throw 'Each checklist item needs at least 2 characters.';
      final payload = {
        'name': name.text.trim(),
        'discipline': discipline,
        'is_active': active,
        'items': [for (final r in rows) {'id': r.$1, 'text': r.$2.text.trim()}],
      };
      c == null
          ? await Api.post('/design/library/checklists', data: {...payload, 'document_type': type})
          : await Api.patch('/design/library/checklists/${c['id']}', data: payload);
    });
    if (ok && mounted) {
      showSnack(context, 'Checklist saved.');
      _reload();
    }
  }

  // ── Build ──

  Widget _menu(List<(String, VoidCallback, bool)> items) {
    if (items.isEmpty) return const SizedBox.shrink();
    return PopupMenuButton<int>(
      onSelected: (i) => items[i].$2(),
      itemBuilder: (_) => [
        for (var i = 0; i < items.length; i++)
          PopupMenuItem(value: i, child: Text(items[i].$1, style: TextStyle(color: items[i].$3 ? Brand.danger : Brand.body))),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final visible = _tabs.where((t) => _lib(t.$1, 'view')).toList();
    if (visible.isEmpty) {
      return const EmptyView("Your role doesn't include any library list (Design › Library features). Ask an admin to grant the one you need.");
    }
    if (!visible.any((t) => t.$1 == _tab)) _tab = visible.first.$1;
    final (note, addLabel, canAdd, onAdd) = switch (_tab) {
      'standards' => (
          "The standards register drawings cite (RDSO, IS, EN, customer specs…). Only the Design head maintains it; a standard cited by a drawing can't be deleted — mark it not current instead.",
          'Add Standard',
          _isHead && _lib('standards', 'create'),
          () => _standardForm(),
        ),
      'parts' => (
          'Preferred bought-out / standard items (fasteners, bearings, seals…) designers should pick first. Each is an Item Master code, optionally with its drawing and the standard it conforms to.',
          'Add Standard Part',
          _isTeam && _lib('parts', 'create'),
          () => _partForm(),
        ),
      'makes' => (
          'Approved makes are kept per Item Master code — every BOM using the item shows the same list and Purchase buys only from it.',
          'Add Approved Make',
          _isTeam && _lib('makes', 'create'),
          () => _makeForm(),
        ),
      'templates' => (
          'Controlled templates (title block, drawing sheet, BOM sheet, transmittal cover…) everyone starts from. Only the Design head publishes them.',
          'Upload Template',
          _isHead && _lib('templates', 'create'),
          () => _templateForm(),
        ),
      _ => (
          "A check can't pass with any item Not OK. One active checklist per document type + discipline.",
          'New Checklist',
          _isHead && _lib('checklists', 'create'),
          () => _checklistForm(),
        ),
    };
    final searchable = const ['standards', 'parts', 'makes'].contains(_tab);
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: canAdd ? CreateFab(label: addLabel, onPressed: onAdd) : null,
      body: ApiListView(
        key: ValueKey('$_tab$_discipline'),
        searchHint: searchable ? 'Search…' : null,
        emptyText: switch (_tab) {
          'standards' => 'No standards in the library yet.',
          'parts' => 'No standard parts match these filters.',
          'makes' => 'No approved makes recorded yet.',
          'templates' => 'No templates published yet.',
          _ => 'No review checklists yet — checks run without one until the Design head adds them.',
        },
        header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const PageHeader('Design Library'),
          ChipRow(children: [
            for (final t in visible) CountChip(t.$2, null, selected: _tab == t.$1, onTap: () => setState(() => _tab = t.$1)),
          ]),
          Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 8), child: Text(note, style: const TextStyle(fontSize: 12.5, color: Brand.muted))),
          if (_tab == 'parts')
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: AppSelect<String>(
                  label: 'All disciplines', value: _discipline, options: optionsOf(disciplineLabels), onChanged: (o) => setState(() => _discipline = o?.value)),
            ),
        ]),
        load: (p, s) => switch (_tab) {
          'standards' => Api.list('/design/library/standards', query: {'search': s}),
          'parts' => Api.list('/design/library/standard-parts', query: {'search': s, 'discipline': _discipline}),
          'makes' => Api.list('/design/library/approved-makes', query: {'search': s}),
          'templates' => Api.list('/design/library/templates'),
          _ => Api.list('/design/library/checklists'),
        },
        itemBuilder: (ctx, r, reload) => switch (_tab) {
          'standards' => _standardCard(r),
          'parts' => _partCard(r),
          'makes' => _makeCard(r),
          'templates' => _templateCard(r),
          _ => _checklistCard(r),
        },
      ),
    );
  }

  Widget _standardCard(Json s) => RecordCard(
        code: '${s['body']} · ${s['code']}${str(s['version']).isEmpty ? '' : ' : ${s['version']}'}',
        title: str(s['title']),
        status: s['is_current'] == true ? 'Current' : 'Not current',
        meta: [
          ('Cited by', '${s['drawing_count'] ?? 0} drawing(s)'),
          ('File', str(s['file_name']).isEmpty ? '—' : '${s['file_name']} · ${formatBytes(s['file_size'])}'),
          if (str(s['remarks']).isNotEmpty) ('Remarks', str(s['remarks'])),
        ],
        trailing: _menu([
          if (str(s['file_name']).isNotEmpty)
            ('Open file', () => openApiFile(context, '/design/library/standards/${s['id']}/file', str(s['file_name']), query: {'download': true}), false),
          if (_isHead && _lib('standards', 'edit')) (str(s['file_name']).isEmpty ? 'Upload file' : 'Replace file', () => _uploadStandardFile(s), false),
          if (_isHead && _lib('standards', 'edit')) ('Edit', () => _standardForm(s), false),
          if (_canDelete(s['created_by_id']) && _lib('standards', 'delete'))
            (
              'Delete',
              () => _confirmDelete(
                  'Delete ${s['code']}?',
                  (asInt(s['drawing_count']) ?? 0) > 0
                      ? '${s['code']} is cited by ${s['drawing_count']} drawing(s), so the library will refuse to delete it. Mark it "not current" instead.'
                      : '${s['code']} ${str(s['version'])} and its attached file are removed from the library.',
                  '/design/library/standards/${s['id']}'),
              true
            ),
        ]),
      );

  Widget _partCard(Json p) {
    final itemLabel = '${txt(p['item_code'])} — ${txt(p['item_name'])}';
    return RecordCard(
      code: str(p['item_code']),
      title: txt(p['item_name']),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        if (str(p['item_status']).isNotEmpty) StatusBadge(humanize(p['item_status']), color: _itemStatusColors[str(p['item_status'])]),
        _menu([
          if (_isTeam && _lib('parts', 'edit')) ('Edit', () => _partForm(p), false),
          if (_canDelete(p['created_by_id']) && _lib('parts', 'delete'))
            (
              'Remove',
              () => _confirmDelete('Remove $itemLabel?',
                  '$itemLabel stops being listed as a standard part. The Item Master item, its drawing and approved makes are not touched.', '/design/library/standard-parts/${p['id']}'),
              true
            ),
        ]),
      ]),
      meta: [
        ('Discipline', labelOf(disciplineLabels, p['discipline'])),
        ('Drawing', str(p['doc_number']).isEmpty ? '—' : '${p['doc_number']} ${str(p['released_revision_label'])}'),
        ('Standard', txt(p['standard_label'])),
        ('Approved makes', strList(p['approved_makes']).isEmpty ? '—' : strList(p['approved_makes']).join(', ')),
        if (str(p['notes']).isNotEmpty) ('Notes', str(p['notes'])),
      ],
    );
  }

  Widget _makeCard(Json m) {
    final itemLabel = '${txt(m['item_code'])} — ${txt(m['item_name'])}';
    return RecordCard(
      code: itemLabel,
      title: str(m['make']),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        StatusBadge(labelOf(_makeStatusLabels, m['status']), color: _makeStatusColors[str(m['status'])]),
        _menu([
          if (_isTeam && _lib('makes', 'edit')) ('Edit', () => _makeForm(m), false),
          if (_isHead && _canDelete(null) && _lib('makes', 'delete'))
            (
              'Delete',
              () => _confirmDelete(
                  'Delete ${m['make']}?',
                  "${m['make']} is removed from $itemLabel's approved makes with no record kept. To keep the history, set its status to Withdrawn instead.",
                  '/design/library/approved-makes/${m['id']}'),
              true
            ),
        ]),
      ]),
      meta: [
        ('Part no.', txt(m['part_number'])),
        ('Approved by', '${txt(m['approved_by_name'])} · ${fmtDate(m['updated_at'])}'),
        if (str(m['remarks']).isNotEmpty) ('Remarks', str(m['remarks'])),
      ],
    );
  }

  Widget _templateCard(Json t) => RecordCard(
        code: labelOf(templateKindLabels, t['kind']),
        title: str(t['name']),
        subtitle: nullIfEmpty(str(t['description'])),
        meta: [
          ('File', '${t['file_name']} · ${formatBytes(t['file_size'])}'),
          ('Uploaded by', '${txt(t['created_by_name'])} · ${fmtDate(t['created_at'])}'),
        ],
        onTap: () => openApiFile(context, '/design/library/templates/${t['id']}/file', str(t['file_name'])),
        trailing: _menu([
          ('Open', () => openApiFile(context, '/design/library/templates/${t['id']}/file', str(t['file_name'])), false),
          if (_isHead && _canDelete(t['created_by_id']) && _lib('templates', 'delete'))
            (
              'Remove',
              () => _confirmDelete('Remove ${t['name']}?',
                  '${t['name']} (${t['file_name']}) is removed from the template library. Drawings already made from it are not affected.', '/design/library/templates/${t['id']}'),
              true
            ),
        ]),
      );

  Widget _checklistCard(Json c) => DetailSection(
        str(c['name']),
        action: _menu([
          if (_isHead && _lib('checklists', 'edit')) ('Edit', () => _checklistForm(c), false),
          if (_canDelete(c['created_by_id']) && _lib('checklists', 'delete'))
            (
              'Delete',
              () => _confirmDelete(
                  'Delete ${c['name']}?',
                  'The checklist is removed. Answers already given on past checks keep their copied item text. To stop using it but keep it, deactivate it instead.',
                  '/design/library/checklists/${c['id']}'),
              true
            ),
        ]),
        children: [
          Wrap(spacing: 6, children: [
            StatusBadge(labelOf(_checklistTypeLabels, c['document_type']), color: const Color(0xFF2563EB)),
            StatusBadge(str(c['discipline']).isEmpty ? 'Any discipline' : labelOf(disciplineLabels, c['discipline']), color: const Color(0xFF64748B)),
            StatusBadge(c['is_active'] == true ? 'Active' : 'Inactive'),
          ]),
          const SizedBox(height: 6),
          for (final (i, it) in jsonList(c['items']).indexed) Text('${i + 1}. ${it['text']}', style: const TextStyle(fontSize: 13, height: 1.5)),
        ],
      );
}

/// Keeps a picked file with its name for display.
class MultipartFileHolder {
  MultipartFileHolder(this.file);
  final dynamic file;
  String get name => (file.filename as String?) ?? 'file';
}

/// Library is also reachable as a full page (dashboard links).
class DesignLibraryScreen extends StatelessWidget {
  const DesignLibraryScreen({super.key});
  @override
  Widget build(BuildContext context) => const SubPage(title: 'Design Library', body: DesignLibraryTab());
}
