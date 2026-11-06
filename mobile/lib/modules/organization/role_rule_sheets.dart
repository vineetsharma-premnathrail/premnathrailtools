import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import 'org_common.dart';

// Phone versions of AssigneeRuleDialog.tsx and VisibilityRuleDialog.tsx
// (opened from the permission tree in the role editor).

/// Result of a rule sheet: `rule` null = no rule (clear it).
class RuleResult {
  const RuleResult(this.rule);
  final Json? rule;
}

/// Departments / roles / people offered in a custom "Assign to" rule.
class AssigneeOptions {
  const AssigneeOptions({this.departments = const [], this.roles = const [], this.users = const []});
  final List<Option<int>> departments;
  final List<Option<int>> roles;
  final List<Option<int>> users;
}

List<int> _ids(Object? v) => v is List ? v.map(asInt).whereType<int>().toList() : <int>[];

String describeAssigneeRule(Json? rule, Map<String, String> modes) {
  if (rule == null) return 'Anyone the screen allows';
  final mode = str(rule['mode']);
  if (mode != 'custom') return modes[mode] ?? mode;
  final n = _ids(rule['departments']).length + _ids(rule['roles']).length + _ids(rule['users']).length;
  return 'Selected ($n)';
}

/// "Assign to" rule for one feature. Null when cancelled.
Future<RuleResult?> showAssigneeRuleSheet(
  BuildContext context, {
  required String title,
  String? hint,
  required Json? rule,
  required Map<String, String> modes,
  required AssigneeOptions options,
  bool readOnly = false,
}) async {
  var mode = str(rule?['mode']);
  final picked = <String, Map<int, String>>{
    'departments': {},
    'roles': {},
    'users': {},
  };
  String labelOf(List<Option<int>> opts, int id) =>
      opts.firstWhere((o) => o.value == id, orElse: () => Option(id, '#$id')).label;
  for (final id in _ids(rule?['departments'])) {
    picked['departments']![id] = labelOf(options.departments, id);
  }
  for (final id in _ids(rule?['roles'])) {
    picked['roles']![id] = labelOf(options.roles, id);
  }
  for (final id in _ids(rule?['users'])) {
    picked['users']![id] = labelOf(options.users, id);
  }
  RuleResult? result;

  final choices = <(String, String, String)>[
    ('', 'Anyone the screen allows',
        'No extra limit — only the screen’s own rules (e.g. the requirement’s departments, the project team).'),
    ('self', modes['self'] ?? 'Only themselves', 'They can only give tasks to themselves.'),
    ('team', modes['team'] ?? 'Their team', 'Themselves and everyone under them in Reporting Manager (any level).'),
    ('department', modes['department'] ?? 'Their department', 'People whose Department is the same as theirs.'),
    ('custom', modes['custom'] ?? 'Selected', 'Anyone in the departments, holding the roles, or named below.'),
  ];

  Future<List<Option<int>>> Function(String) filter(List<Option<int>> opts, Map<int, String> chosen) => (s) async {
        final q = s.toLowerCase();
        return opts
            .where((o) => !chosen.containsKey(o.value) && '${o.label} ${o.subtitle ?? ''}'.toLowerCase().contains(q))
            .toList();
      };

  await showFormSheet(
    context,
    title: title,
    saveLabel: readOnly ? 'Close' : 'Apply',
    builder: (ctx, setS) => [
      if (hint != null && hint.isNotEmpty) Text(hint, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
      for (final (key, label, help) in choices)
        Material(
          color: mode == key ? const Color(0x0FF4713B) : Colors.white,
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
              side: BorderSide(color: mode == key ? Brand.primary : Brand.border)),
          child: ListTile(
            dense: true,
            leading: Icon(mode == key ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                color: mode == key ? Brand.primary : Brand.muted),
            title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
            subtitle: Text(help, style: const TextStyle(fontSize: 11.5)),
            onTap: readOnly ? null : () => setS(() => mode = key),
          ),
        ),
      if (mode == 'custom') ...[
        for (final (k, label, opts) in [
          ('departments', 'Departments', options.departments),
          ('roles', 'Roles', options.roles),
          ('users', 'People', options.users),
        ])
          readOnly
              ? InputDecorator(
                  decoration: fieldDecoration(label),
                  child: Text(picked[k]!.values.isEmpty ? '—' : picked[k]!.values.join(', ')),
                )
              : ChipsPicker(
                  label: label,
                  selected: picked[k]!,
                  loadOptions: filter(opts, picked[k]!),
                  onChanged: (v) => setS(() => picked[k] = v),
                ),
      ],
      if (!readOnly)
        const Text('Applied to the role when you save it.', style: TextStyle(fontSize: 11.5, color: Brand.muted)),
    ],
    onSave: () async {
      if (readOnly) return;
      if (mode.isEmpty) {
        result = const RuleResult(null);
        return;
      }
      if (mode != 'custom') {
        result = RuleResult({'mode': mode});
        return;
      }
      if (picked.values.every((m) => m.isEmpty)) {
        throw 'Pick at least one department, role or person — or choose another option.';
      }
      result = RuleResult({
        'mode': mode,
        'departments': picked['departments']!.keys.toList(),
        'roles': picked['roles']!.keys.toList(),
        'users': picked['users']!.keys.toList(),
      });
    },
  );
  return result;
}

// ── Visibility ───────────────────────────────────────────────────────────────

/// [code, label] of every screen of a catalogue entry (one screen named like
/// the entry when it has no `screens`).
List<(String, String)> catalogScreens(Json entry) {
  final s = jsonMap(entry['screens']);
  if (s.isEmpty) return [('', str(entry['label']))];
  return [for (final e in s.entries) (e.key, str(e.value))];
}

String itemScreen(Json entry, Object? item) {
  final screens = catalogScreens(entry);
  final own = item is Map ? str(item['screen']) : '';
  if (own.isNotEmpty && screens.any((s) => s.$1 == own)) return own;
  return screens.isEmpty ? '' : screens.first.$1;
}

List<String> _strs(Object? v) => v is List ? v.map(str).toList() : <String>[];

bool isEmptyVisibilityRule(Json? rule) {
  if (rule == null) return true;
  return _strs(rule['hidden_sections']).isEmpty &&
      !jsonMap(rule['options']).values.any((v) => _strs(v).isNotEmpty) &&
      !jsonMap(rule['hidden_columns']).values.any((v) => _strs(v).isNotEmpty);
}

List<String> _describeParts(Json rule, Json entry, String? screen) {
  bool inScreen(Object? item) => screen == null || itemScreen(entry, item) == screen;
  final parts = <String>[];
  final sections = _strs(rule['hidden_sections']).where((k) => inScreen(jsonMap(entry['sections'])[k])).length;
  if (sections > 0) parts.add('$sections section${sections == 1 ? '' : 's'} hidden');
  final opts = jsonMap(entry['options']);
  for (final e in jsonMap(rule['options']).entries) {
    final allowed = _strs(e.value);
    if (allowed.isEmpty || !inScreen(opts[e.key])) continue;
    final meta = opts[e.key] is Map ? jsonMap(opts[e.key]) : null;
    final total = meta == null ? null : jsonMap(meta['values']).length;
    parts.add('${meta == null ? e.key : str(meta['label'])}: ${allowed.length}${total != null ? ' of $total' : ''} '
        'value${(total ?? allowed.length) == 1 ? '' : 's'}');
  }
  final tables = jsonMap(entry['tables']);
  var columns = 0;
  for (final e in jsonMap(rule['hidden_columns']).entries) {
    if (inScreen(tables[e.key])) columns += _strs(e.value).length;
  }
  if (columns > 0) parts.add('$columns column${columns == 1 ? '' : 's'} hidden');
  return parts;
}

String describeVisibilityRule(Json? rule, Json entry) {
  if (rule == null || isEmptyVisibilityRule(rule)) return 'shows everything';
  final screens = catalogScreens(entry);
  if (screens.length < 2) return _describeParts(rule, entry, null).join(', ');
  final out = [
    for (final (code, label) in screens)
      if (_describeParts(rule, entry, code).isNotEmpty) '$label: ${_describeParts(rule, entry, code).join(', ')}',
  ].join(' · ');
  return out.isEmpty ? 'shows everything' : out;
}

/// What a role's members see on one screen. Null when cancelled.
Future<RuleResult?> showVisibilityRuleSheet(
  BuildContext context, {
  required Json entry,
  required String keyLabel,
  required Json? rule,
  bool readOnly = false,
}) async {
  final sections = jsonMap(entry['sections']).map((k, v) => MapEntry(k, jsonMap(v)));
  final options = jsonMap(entry['options']).map((k, v) => MapEntry(k, jsonMap(v)));
  final tables = jsonMap(entry['tables']).map((k, v) => MapEntry(k, jsonMap(v)));
  final screens = catalogScreens(entry);
  var screen = screens.isEmpty ? '' : screens.first.$1;

  var hiddenSections = _strs(rule?['hidden_sections'])
      .where((k) => sections[k] != null && sections[k]!['locked'] != true)
      .toList();
  final allowed = <String, List<String>>{};
  for (final e in jsonMap(rule?['options']).entries) {
    final vals = _strs(e.value);
    if (options[e.key] != null && vals.isNotEmpty) {
      final known = jsonMap(options[e.key]!['values']);
      allowed[e.key] = vals.where(known.containsKey).toList();
    }
  }
  final hiddenColumns = <String, List<String>>{};
  for (final e in jsonMap(rule?['hidden_columns']).entries) {
    final vals = _strs(e.value);
    if (tables[e.key] != null && vals.isNotEmpty) {
      final known = jsonMap(tables[e.key]!['columns']);
      hiddenColumns[e.key] = vals.where(known.containsKey).toList();
    }
  }
  RuleResult? result;

  Json compose() {
    final next = <String, dynamic>{};
    final hs = sections.keys.where((k) => hiddenSections.contains(k) && sections[k]!['locked'] != true).toList();
    if (hs.isNotEmpty) next['hidden_sections'] = hs;
    final opts = <String, List<String>>{};
    for (final e in options.entries) {
      final keys = jsonMap(e.value['values']).keys.toList();
      final picked = keys.where((v) => (allowed[e.key] ?? const []).contains(v)).toList();
      if (allowed.containsKey(e.key) && picked.isNotEmpty && picked.length < keys.length) opts[e.key] = picked;
    }
    if (opts.isNotEmpty) next['options'] = opts;
    final cols = <String, List<String>>{};
    for (final e in tables.entries) {
      final hidden = jsonMap(e.value['columns']).keys.where((c) => (hiddenColumns[e.key] ?? const []).contains(c)).toList();
      if (hidden.isNotEmpty) cols[e.key] = hidden;
    }
    if (cols.isNotEmpty) next['hidden_columns'] = cols;
    return next;
  }

  Widget group(String title, List<Widget> children) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title.toUpperCase(),
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Brand.muted, letterSpacing: 0.4)),
          const SizedBox(height: 6),
          ...children,
        ],
      );

  Widget box(Widget child, {bool error = false}) => Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: error ? Brand.danger.withValues(alpha: 0.5) : Brand.border)),
        child: child,
      );

  const hiddenTag = Text('Hidden', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFFB45309)));

  await showFormSheet(
    context,
    title: 'Visibility — $keyLabel',
    saveLabel: readOnly ? 'Close' : 'Apply',
    builder: (ctx, setS) {
      final shownSections = sections.entries.where((e) => itemScreen(entry, e.value) == screen).toList();
      final shownOptions = options.entries.where((e) => itemScreen(entry, e.value) == screen).toList();
      final shownTables = tables.entries.where((e) => itemScreen(entry, e.value) == screen).toList();
      return [
        const Text(
            'Choose what members of this role see on this screen. Dropdown values are also refused by the server; sections and columns are hidden on screen only.',
            style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        if (screens.length > 1)
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final (code, label) in screens)
              ChoiceChip(
                label: Text(label),
                selected: screen == code,
                selectedColor: Brand.primarySoft,
                onSelected: (_) => setS(() => screen = code),
              ),
          ]),
        if (shownSections.isNotEmpty)
          group('Sections', [
            for (final e in shownSections)
              box(Builder(builder: (_) {
                final locked = e.value['locked'] == true;
                final shown = locked || !hiddenSections.contains(e.key);
                final sub = locked ? 'Required — always shown' : str(e.value['hint']);
                return CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: shown,
                  onChanged: readOnly || locked
                      ? null
                      : (_) => setS(() => hiddenSections = hiddenSections.contains(e.key)
                          ? (hiddenSections..remove(e.key))
                          : (hiddenSections..add(e.key))),
                  title: Text(str(e.value['label']), style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: sub.isEmpty ? null : Text(sub, style: const TextStyle(fontSize: 11.5)),
                  secondary: !locked && !shown ? hiddenTag : null,
                );
              })),
          ]),
        if (shownOptions.isNotEmpty)
          group('Dropdowns', [
            for (final e in shownOptions)
              box(
                Builder(builder: (_) {
                  final all = !allowed.containsKey(e.key);
                  final values = jsonMap(e.value['values']);
                  final empty = allowed.containsKey(e.key) && allowed[e.key]!.isEmpty;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SwitchListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        value: all,
                        onChanged: readOnly
                            ? null
                            : (v) => setS(() {
                                  if (v) {
                                    allowed.remove(e.key);
                                  } else {
                                    allowed[e.key] = values.keys.toList();
                                  }
                                }),
                        title: Text('${str(e.value['label'])} — ${all ? 'All values' : 'Only the ticked values'}',
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                        subtitle: str(e.value['hint']).isEmpty
                            ? null
                            : Text(str(e.value['hint']), style: const TextStyle(fontSize: 11.5)),
                      ),
                      if (!all)
                        for (final v in values.entries)
                          CheckboxListTile(
                            dense: true,
                            contentPadding: const EdgeInsets.only(left: 4),
                            controlAffinity: ListTileControlAffinity.leading,
                            value: allowed[e.key]!.contains(v.key),
                            onChanged: readOnly
                                ? null
                                : (_) => setS(() {
                                      final cur = allowed[e.key]!;
                                      cur.contains(v.key) ? cur.remove(v.key) : cur.add(v.key);
                                    }),
                            title: Text(str(v.value)),
                          ),
                      if (empty)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: Text(
                              'Pick at least one ${str(e.value['label'])} value, or switch it back to All values.',
                              style: const TextStyle(fontSize: 12, color: Brand.danger)),
                        ),
                    ],
                  );
                }),
                error: allowed.containsKey(e.key) && allowed[e.key]!.isEmpty,
              ),
          ]),
        if (shownTables.isNotEmpty)
          group('Tables', [
            for (final t in shownTables)
              box(Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(str(t.value['label']),
                        style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                  ),
                  for (final c in jsonMap(t.value['columns']).entries)
                    Builder(builder: (_) {
                      final shown = !(hiddenColumns[t.key] ?? const []).contains(c.key);
                      return CheckboxListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: shown,
                        onChanged: readOnly
                            ? null
                            : (_) => setS(() {
                                  final cur = hiddenColumns.putIfAbsent(t.key, () => []);
                                  cur.contains(c.key) ? cur.remove(c.key) : cur.add(c.key);
                                }),
                        title: Text(str(c.value)),
                        secondary: shown ? null : hiddenTag,
                      );
                    }),
                ],
              )),
          ]),
        if (!readOnly)
          Align(
            alignment: Alignment.centerLeft,
            child: PillButton('Reset to show everything',
                icon: Icons.restart_alt_rounded,
                onPressed: () => setS(() {
                      hiddenSections = [];
                      allowed.clear();
                      hiddenColumns.clear();
                    })),
          ),
      ];
    },
    onSave: () async {
      if (readOnly) return;
      for (final e in allowed.entries) {
        if (e.value.isEmpty) {
          final label = str(options[e.key]?['label']);
          throw 'Pick at least one $label value, or switch it back to All values.';
        }
      }
      final next = compose();
      result = RuleResult(isEmptyVisibilityRule(next) ? null : next);
    },
  );
  return result;
}
