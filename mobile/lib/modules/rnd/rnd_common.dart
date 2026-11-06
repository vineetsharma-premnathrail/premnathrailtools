import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

/// Shared bits of the R&D module (portal: frontend/src/components/rnd/*).

/// R&D permission checks - same keys as the portal's can() / canFeature().
class RndPerm {
  RndPerm._();
  static bool can(String tab, String action) => Perm.can('rnd', tab, action);
  static bool feature(String tab, String feature, String action) => Perm.canFeature('rnd', tab, feature, action);
  static bool view(String tab) => Perm.canView('rnd', tab);
}

// ── Small JSON readers ───────────────────────────────────────────────────────

String? str(Object? row, String key) {
  final v = row is Map ? row[key] : null;
  if (v == null) return null;
  final s = v.toString();
  return s.isEmpty ? null : s;
}

int? intOf(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));

num numOf(Object? v) => v is num ? v : (v is String ? (num.tryParse(v) ?? 0) : 0);

bool boolOf(Object? v) => v == true;

List<Json> jsonList(Object? v) => v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

Json jsonMap(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

Color hexColor(String hex) => Color(int.parse('FF${hex.replaceAll('#', '')}', radix: 16));

String todayIso() => apiDate(DateTime.now());

/// "2026-11-05" string compare helper (dates come as ISO text).
String isoDay(Object? v) => (v ?? '').toString().length >= 10 ? v.toString().substring(0, 10) : (v ?? '').toString();

String fmtSize(Object? n) {
  final v = n is num ? n : null;
  if (v == null) return '';
  if (v < 1024 * 1024) return '${(v / 1024).round().clamp(1, 1 << 30)} KB';
  return '${(v / 1024 / 1024).toStringAsFixed(1)} MB';
}

// ── Priority (Standard / Urgent, lib/priority.ts) ───────────────────────────

const priorityOptions = [Option('standard', 'Standard'), Option('urgent', 'Urgent')];

bool isUrgent(Object? v) => const {'urgent', 'critical', 'high'}.contains((v ?? '').toString().trim().toLowerCase());
String normalizePriority(Object? v) => isUrgent(v) ? 'urgent' : 'standard';
String priorityLabel(Object? v) => isUrgent(v) ? 'Urgent' : 'Standard';
Color priorityColor(Object? v) => isUrgent(v) ? const Color(0xFFB91C1C) : const Color(0xFF475569);

/// Coloured pill with a fixed colour (portal: Pill / pillStyle(hex)).
class Pill extends StatelessWidget {
  const Pill(this.label, this.color, {super.key});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
    child: Text(
      label,
      style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600),
    ),
  );
}

/// Tinted note box (hints, warnings, "accept first" notes).
class NoteBox extends StatelessWidget {
  const NoteBox(
    this.text, {
    super.key,
    this.color = const Color(0xFF2563EB),
    this.margin = const EdgeInsets.fromLTRB(16, 0, 16, 12),
  });
  final String text;
  final Color color;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: margin,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.07),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: color.withValues(alpha: 0.25)),
    ),
    child: Text(text, style: TextStyle(fontSize: 13, color: Color.lerp(color, Colors.black, 0.35))),
  );
}

/// Progress bar + percent (portal: ProgressCell / Bar).
class ProgressLine extends StatelessWidget {
  const ProgressLine(this.value, {super.key, this.color = const Color(0xFF16A34A)});
  final num value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final v = value.clamp(0, 100).toDouble();
    return Row(
      children: [
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: v / 100,
              minHeight: 8,
              backgroundColor: const Color(0xFFEEF2F7),
              valueColor: AlwaysStoppedAnimation(color),
            ),
          ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          width: 40,
          child: Text(
            '${v.round()}%',
            textAlign: TextAlign.right,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.body),
          ),
        ),
      ],
    );
  }
}

/// Record sub-tabs inside a detail screen (portal: the pill tab bar).
class SubTabs extends StatelessWidget {
  const SubTabs({super.key, required this.tabs, required this.current, required this.onTap});
  final List<String> tabs;
  final String current;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        itemCount: tabs.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (ctx, i) {
          final on = tabs[i] == current;
          return Material(
            color: on ? Brand.primarySoft : Brand.background,
            borderRadius: BorderRadius.circular(999),
            child: InkWell(
              borderRadius: BorderRadius.circular(999),
              onTap: () => onTap(tabs[i]),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Center(
                  child: Text(
                    tabs[i],
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: on ? Brand.primaryActive : const Color(0xFF78716C),
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Horizontal chip row (count chips / filters) with the list's padding.
class ChipRow extends StatelessWidget {
  const ChipRow({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 46,
    child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.fromLTRB(16, 4, 8, 6), children: children),
  );
}

/// Key → value row in a compact two-column layout (portal: InfoRows / DetailRow).
class KeyValue extends StatelessWidget {
  const KeyValue(this.label, this.value, {super.key});
  final String label;
  final Object? value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 110,
          child: Text(label, style: const TextStyle(fontSize: 13, color: Brand.muted)),
        ),
        Expanded(
          child: value is Widget ? value as Widget : Text(txt(value), style: const TextStyle(fontSize: 13.5, color: Brand.body)),
        ),
      ],
    ),
  );
}

// ── Server calls ─────────────────────────────────────────────────────────────

Options get _slow => Options(sendTimeout: const Duration(minutes: 10), receiveTimeout: const Duration(minutes: 10));

/// Multipart POST (uploads, task actions). Each file is cloned so a retry
/// after a server error can send it again.
Future<dynamic> postForm(
  String path,
  Map<String, Object?> fields, {
  List<MultipartFile> files = const [],
  String fileField = 'files',
}) async {
  final form = FormData();
  fields.forEach((k, v) {
    if (v == null) return;
    if (v is String && v.isEmpty) return;
    if (v is List && v.isEmpty) return;
    form.fields.add(MapEntry(k, v is String ? v : (v is List || v is Map ? jsonEncode(v) : v.toString())));
  });
  for (final f in files) {
    form.files.add(MapEntry(fileField, f.clone()));
  }
  final r = await Api.dio.post(path, data: form, options: _slow);
  return r.data;
}

const _largeDownload = 50 * 1024 * 1024;

/// Opens a requirement document (R&D access check on the server; very large
/// files open through their SharePoint link, same as the portal).
Future<void> openWorkDocument(BuildContext context, Json doc) async {
  final id = doc['id'];
  final name = str(doc, 'name') ?? 'document-$id';
  await runAction(context, () async {
    if (numOf(doc['file_size']) > _largeDownload) {
      final r = await Api.get('/rnd/requirement-work/documents/$id/download-url');
      await Files.openUrl(str(r, 'url') ?? '');
    } else {
      await Files.downloadAndOpen('/rnd/requirement-work/documents/$id/content', name);
    }
  });
}

/// Opens an R&D project document (R&D › Documents store).
Future<void> openProjectDocument(BuildContext context, Json doc) async {
  final id = doc['id'];
  final name = str(doc, 'file_name') ?? str(doc, 'name') ?? 'document-$id';
  await runAction(context, () => Files.downloadAndOpen('/rnd/documents/$id/content', name));
}

/// People list (R&D settings people / assignees) as select options.
List<Option<int>> personOptions(List<Json> people) => [
  for (final p in people)
    if (intOf(p['id']) != null)
      Option(
        intOf(p['id'])!,
        '${str(p, 'name') ?? ''}${str(p, 'designation') != null ? ' — ${str(p, 'designation')}' : ''}',
        subtitle: str(p, 'department_label'),
      ),
];

// ── Form pieces ──────────────────────────────────────────────────────────────

/// Attachments field: picked files with remove, plus "Add files" / "Take photo".
class FilesField extends StatelessWidget {
  const FilesField({
    super.key,
    required this.label,
    required this.files,
    required this.onChanged,
    this.required = false,
    this.single = false,
    this.extensions,
    this.hint,
  });

  final String label;
  final List<MultipartFile> files;
  final ValueChanged<List<MultipartFile>> onChanged;
  final bool required;
  final bool single;
  final List<String>? extensions;
  final String? hint;

  Future<void> _add(BuildContext context, {bool photo = false}) async {
    try {
      if (photo) {
        final f = await Files.takePhoto();
        if (f != null) onChanged(single ? [f] : [...files, f]);
        return;
      }
      if (single || extensions != null) {
        final f = await Files.pickFile(extensions: extensions);
        if (f != null) onChanged(single ? [f] : [...files, f]);
        return;
      }
      final picked = await Files.pickFiles();
      if (picked.isNotEmpty) onChanged([...files, ...picked]);
    } catch (e) {
      if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          required ? '$label *' : label,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.body),
        ),
        const SizedBox(height: 6),
        for (var i = 0; i < files.length; i++)
          Container(
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
              border: Border.all(color: Brand.border),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                const Icon(Icons.insert_drive_file_outlined, size: 18, color: Brand.muted),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${files[i].filename ?? 'File'}  ·  ${fmtSize(files[i].length)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
                IconButton(
                  tooltip: 'Remove',
                  icon: const Icon(Icons.close_rounded, size: 18),
                  onPressed: () => onChanged([...files]..removeAt(i)),
                ),
              ],
            ),
          ),
        Wrap(
          spacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: () => _add(context),
              icon: const Icon(Icons.attach_file_rounded, size: 18),
              label: Text(single ? (files.isEmpty ? 'Choose file' : 'Replace file') : 'Add files'),
            ),
            if (extensions == null)
              OutlinedButton.icon(
                onPressed: () => _add(context, photo: true),
                icon: const Icon(Icons.photo_camera_outlined, size: 18),
                label: const Text('Take photo'),
              ),
          ],
        ),
        if (hint != null) ...[const SizedBox(height: 4), Text(hint!, style: const TextStyle(fontSize: 12, color: Brand.muted))],
      ],
    );
  }
}

/// Checklist editor in a task form (portal: ChecklistEditor): steps in order,
/// add with the button, remove with ×. Existing steps keep their id.
class ChecklistEditor extends StatefulWidget {
  const ChecklistEditor({super.key, required this.steps, required this.onChanged});
  final List<Json> steps;
  final ValueChanged<List<Json>> onChanged;

  @override
  State<ChecklistEditor> createState() => _ChecklistEditorState();
}

class _ChecklistEditorState extends State<ChecklistEditor> {
  final _draft = TextEditingController();

  @override
  void dispose() {
    _draft.dispose();
    super.dispose();
  }

  void _add() {
    final t = _draft.text.trim();
    if (t.isEmpty) return;
    widget.onChanged([
      ...widget.steps,
      {'text': t},
    ]);
    _draft.clear();
  }

  @override
  Widget build(BuildContext context) {
    final steps = widget.steps;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Checklist',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.body),
        ),
        const SizedBox(height: 6),
        for (var i = 0; i < steps.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Icon(
                  boolOf(steps[i]['done']) ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
                  size: 20,
                  color: boolOf(steps[i]['done']) ? Brand.success : Brand.muted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    key: ValueKey('step-${steps[i]['id'] ?? i}-${steps.length}'),
                    initialValue: str(steps[i], 'text') ?? '',
                    maxLength: 300,
                    decoration: fieldDecoration('Checklist item ${i + 1}').copyWith(counterText: ''),
                    onChanged: (v) {
                      final next = [...steps];
                      next[i] = {...next[i], 'text': v};
                      widget.onChanged(next);
                    },
                  ),
                ),
                IconButton(
                  tooltip: 'Remove step',
                  icon: const Icon(Icons.close_rounded, size: 18),
                  onPressed: () => widget.onChanged([...steps]..removeAt(i)),
                ),
              ],
            ),
          ),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _draft,
                maxLength: 300,
                onSubmitted: (_) => _add(),
                decoration: fieldDecoration('Add a step', hint: 'e.g. GA drawing issued').copyWith(counterText: ''),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filledTonal(tooltip: 'Add step', onPressed: _add, icon: const Icon(Icons.add_rounded)),
          ],
        ),
        const SizedBox(height: 4),
        const Text(
          'Steps the assignee ticks off — all must be ticked to complete the task.',
          style: TextStyle(fontSize: 12, color: Brand.muted),
        ),
      ],
    );
  }
}

/// Multi-person picker (portal: TeamMemberPicker): chips of the picked people
/// and a searchable "Add" select.
class PeoplePicker extends StatelessWidget {
  const PeoplePicker({
    super.key,
    required this.label,
    required this.users,
    required this.value,
    required this.onChanged,
    this.exclude = const [],
  });

  final String label;
  final List<Json> users;
  final List<int> value;
  final ValueChanged<List<int>> onChanged;
  final List<int> exclude;

  String _name(int id) {
    for (final u in users) {
      if (intOf(u['id']) == id) return str(u, 'name') ?? 'User #$id';
    }
    return 'User #$id';
  }

  @override
  Widget build(BuildContext context) {
    final options = [
      for (final u in users)
        if (intOf(u['id']) != null && !value.contains(intOf(u['id'])) && !exclude.contains(intOf(u['id'])))
          Option(
            intOf(u['id'])!,
            str(u, 'name') ?? '',
            subtitle: [str(u, 'email'), str(u, 'department')].whereType<String>().join(' · '),
          ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (value.isNotEmpty) ...[
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final id in value) InputChip(label: Text(_name(id)), onDeleted: () => onChanged([...value]..remove(id))),
            ],
          ),
          const SizedBox(height: 8),
        ],
        AppSelect<int>(
          label: label,
          value: null,
          options: options,
          onChanged: (o) {
            if (o != null) onChanged([...value, o.value]);
          },
        ),
      ],
    );
  }
}

/// A plain section title inside a form sheet.
class FormHeading extends StatelessWidget {
  const FormHeading(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 4),
    child: Caps(text, color: Brand.body),
  );
}

/// Hint text under a field.
class Hint extends StatelessWidget {
  const Hint(this.text, {super.key, this.color = Brand.muted});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(text, style: TextStyle(fontSize: 12, color: color));
}

/// Segmented choice (portal: segmentBtnStyle radio group).
class Segmented<T> extends StatelessWidget {
  const Segmented({super.key, required this.options, required this.value, required this.onChanged});
  final List<Option<T>> options;
  final T value;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 6,
    runSpacing: 6,
    children: [
      for (final o in options)
        ChoiceChip(label: Text(o.label), selected: o.value == value, onSelected: (_) => onChanged(o.value)),
    ],
  );
}

/// Pushes a screen and runs [after] when it is closed (reload the list).
Future<void> openThen(BuildContext context, Widget screen, VoidCallback after) async {
  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  after();
}
