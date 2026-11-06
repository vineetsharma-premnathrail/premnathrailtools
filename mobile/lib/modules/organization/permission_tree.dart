import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import 'org_common.dart';
import 'role_rule_sheets.dart';

// Phone version of components/organization/PermissionMatrixEditor.tsx: one
// card per module, one row per tab (grouped sub-tabs under their heading),
// the actions that exist on the tab as tick chips, features inside a tab
// under "N features".
//
// Grants are raw ids: `module:tab:action`, `module:tab.feature:action` or
// module wildcards (`store:*:*` = Full access, `store:*:view` = view on every
// tab). Presets write wildcards; ticking one box inside a wildcard module
// turns it into concrete ids first (same as the portal).

/// The permission registry (portal rolesApi.catalog -> GET /roles/catalog).
Future<Json> loadPermissionRegistry() async => jsonMap(await Api.get('/roles/catalog'));

/// Tabs a module wildcard / preset never covers (backend EXPLICIT_ONLY_TABS).
const _explicitOnlyTabs = {'p2p:purchase_desk'};

Map<String, Json> regModules(Json registry) {
  final m = jsonMap(registry['modules']);
  return {for (final e in m.entries) e.key: jsonMap(e.value)};
}

Map<String, List<String>> _tabActions(Json mod) {
  final a = jsonMap(mod['actions']);
  return {for (final e in a.entries) e.key: (e.value is List ? (e.value as List).map(str).toList() : <String>[])};
}

Map<String, String> _strMap(Object? v) {
  final m = jsonMap(v);
  return {for (final e in m.entries) e.key: str(e.value)};
}

/// tab -> feature key -> feature json
Map<String, Map<String, Json>> _features(Json mod) {
  final f = jsonMap(mod['features']);
  return {
    for (final e in f.entries)
      e.key: {for (final fe in jsonMap(e.value).entries) fe.key: jsonMap(fe.value)},
  };
}

List<String> _featActions(Json f) => f['actions'] is List ? (f['actions'] as List).map(str).toList() : <String>[];

/// feature action -> tab action it follows (null = explicit only)
Map<String, String?> _featInherit(Json f) {
  final m = jsonMap(f['inherit']);
  return {for (final e in m.entries) e.key: e.value?.toString()};
}

/// Concrete ids for one grant list - client mirror of the backend's
/// permission_registry.expand_grants (features follow their tab until the
/// list holds any `module:tab.feature:…` id for that tab).
Set<String> expandGrants(Json registry, Iterable<String> grants) {
  final modules = regModules(registry);
  final out = <String>{};
  final customised = <String>{};
  for (final g in grants) {
    final p = g.split(':');
    if (p.length < 3) continue;
    final mk = p[0], tk = p[1], a = p[2];
    final mod = modules[mk];
    if (mod == null || tk.isEmpty || a.isEmpty) continue;
    final acts = _tabActions(mod);
    if (tk == '*') {
      for (final e in acts.entries) {
        if (_explicitOnlyTabs.contains('$mk:${e.key}')) continue;
        for (final x in e.value) {
          if (a == '*' || x == a) out.add('$mk:${e.key}:$x');
        }
      }
      for (final e in _features(mod).entries) {
        if (_explicitOnlyTabs.contains('$mk:${e.key}')) continue;
        for (final fe in e.value.entries) {
          final inh = _featInherit(fe.value);
          for (final x in _featActions(fe.value)) {
            if ((a == '*' || x == a) && inh[x] != null) out.add('$mk:${e.key}.${fe.key}:$x');
          }
        }
      }
    } else if (tk.contains('.')) {
      final parts = tk.split('.');
      final tab = parts[0], fk = parts.length > 1 ? parts[1] : '';
      customised.add('$mk:$tab');
      final f = _features(mod)[tab]?[fk];
      if (f != null && _featActions(f).contains(a)) {
        out
          ..add(g)
          ..add('$mk:$tk:view')
          ..add('$mk:$tab:view');
      }
    } else if (acts[tk]?.contains(a) ?? false) {
      out
        ..add(g)
        ..add('$mk:$tk:view');
    }
  }
  for (final me in modules.entries) {
    final mk = me.key;
    for (final e in _features(me.value).entries) {
      final tab = e.key;
      if (customised.contains('$mk:$tab') || !out.contains('$mk:$tab:view')) continue;
      for (final fe in e.value.entries) {
        for (final ie in _featInherit(fe.value).entries) {
          if (ie.value != null && out.contains('$mk:$tab:${ie.value}')) {
            out
              ..add('$mk:$tab.${fe.key}:${ie.key}')
              ..add('$mk:$tab.${fe.key}:view');
          }
        }
      }
    }
  }
  return out;
}

bool isTabCustomised(Iterable<String> grants, String moduleKey, String tabKey) {
  final prefix = '$moduleKey:$tabKey.';
  return grants.any((g) => g.startsWith(prefix));
}

/// Plain words for a permission id (portal lib/permissionWords.ts).
String permissionWords(Json? registry, String? id) {
  if (id == null || id.isEmpty) return '';
  if (id == '*' || id == '*:*:*') return 'Everything (all modules)';
  final p = id.split(':');
  final mk = p.isNotEmpty ? p[0] : '';
  final tk = p.length > 1 ? p[1] : '*';
  final a = p.length > 2 ? p[2] : '*';
  String human(String k) {
    final s = k.replaceAll(RegExp(r'[_\-.]+'), ' ').trim();
    return s.isEmpty ? k : s[0].toUpperCase() + s.substring(1);
  }

  final mod = registry == null ? null : regModules(registry)[mk];
  final modLabel = mk == '*' ? 'All modules' : (str(mod?['label']).isNotEmpty ? str(mod!['label']) : human(mk));
  String place;
  if (tk.isEmpty || tk == '*') {
    place = 'any tab';
  } else {
    final tp = tk.split('.');
    final tab = tp[0];
    final fk = tp.length > 1 ? tp[1] : '';
    final tabLabel = mod == null ? human(tab) : (_strMap(mod['subtabs'])[tab] ?? human(tab));
    final featLabel = fk.isEmpty
        ? ''
        : (mod == null ? human(fk) : (str(_features(mod)[tab]?[fk]?['label']).isNotEmpty ? str(_features(mod)[tab]![fk]!['label']) : human(fk)));
    place = featLabel.isNotEmpty ? '$tabLabel › $featLabel' : tabLabel;
  }
  final labels = _strMap(registry?['action_labels']);
  final action = a.isEmpty || a == '*' ? 'any action' : (labels[a] ?? human(a));
  return '$modLabel › $place — $action';
}

enum _Preset { none, view, contributor, full }

const _presets = [
  (_Preset.none, 'No access', 'Remove every permission in this module'),
  (_Preset.view, 'View only', 'See every tab; cannot create, change, delete or approve'),
  (_Preset.contributor, 'Contributor', 'View, create and edit on every tab — no delete, approve or settings'),
  (_Preset.full, 'Full access', 'Every tab and every action, including approvals and settings'),
];

List<String> _presetGrants(String mk, _Preset p) => switch (p) {
      _Preset.full => ['$mk:*:*'],
      _Preset.view => ['$mk:*:view'],
      _Preset.contributor => ['$mk:*:view', '$mk:*:create', '$mk:*:edit'],
      _Preset.none => <String>[],
    };

/// Module › tab › feature › action tree. Renders inside a parent ListView
/// (no own scrolling).
class PermissionTreeEditor extends StatelessWidget {
  const PermissionTreeEditor({
    super.key,
    required this.registry,
    required this.grants,
    required this.onChanged,
    this.readOnly = false,
    this.inherited = const {},
    this.inheritedFrom = const {},
    this.assigneeRules,
    this.onAssigneeRulesChange,
    this.assigneeOptions,
    this.visibilityRules,
    this.onVisibilityRulesChange,
  });

  final Json registry;
  final Set<String> grants;
  final ValueChanged<Set<String>> onChanged;
  final bool readOnly;

  /// Grants that come from roles: shown ticked and locked.
  final Set<String> inherited;

  /// Optional: grant -> role names it comes from (shown under a locked tick).
  final Map<String, List<String>> inheritedFrom;

  /// Role editor only: `module:tab.feature` -> "Assign to" rule.
  final Map<String, Json>? assigneeRules;
  final ValueChanged<Map<String, Json>>? onAssigneeRulesChange;
  final AssigneeOptions? assigneeOptions;

  /// Role editor only: `module:tab[.feature]` -> visibility rule.
  final Map<String, Json>? visibilityRules;
  final ValueChanged<Map<String, Json>>? onVisibilityRulesChange;

  @override
  Widget build(BuildContext context) => _PermissionTree(editor: this);
}

class _PermissionTree extends StatefulWidget {
  const _PermissionTree({required this.editor});
  final PermissionTreeEditor editor;

  @override
  State<_PermissionTree> createState() => _PermissionTreeState();
}

class _PermissionTreeState extends State<_PermissionTree> {
  String _query = '';
  final _open = <String>{};
  final _openFeatures = <String>{};

  PermissionTreeEditor get e => widget.editor;
  Json get reg => e.registry;

  Set<String> get _inh => {...e.inherited, ...e.inheritedFrom.keys};

  void _commit(Iterable<String> next) {
    final list = next.toSet().toList()..sort();
    e.onChanged(list.toSet());
  }

  Set<String> _concretize(Set<String> expanded, String moduleKey, [String? featureTab]) {
    final keep = e.grants.where((g) => !g.startsWith('$moduleKey:'));
    final mine = expanded.where((g) {
      if (!g.startsWith('$moduleKey:')) return false;
      final tk = g.split(':')[1];
      if (!tk.contains('.')) return true;
      final tab = tk.split('.')[0];
      return tab == featureTab || isTabCustomised(e.grants, moduleKey, tab);
    });
    return {...keep, ...mine};
  }

  void _toggle(Set<String> expanded, String moduleKey, String id) {
    if (e.readOnly) return;
    final p = id.split(':');
    final mk = p[0], tk = p[1];
    final isFeature = tk.contains('.');
    final tab = tk.split('.')[0];
    final next = _concretize(expanded, moduleKey, isFeature ? tab : null);
    if (next.contains(id)) {
      next.remove(id);
      if (id.endsWith(':view')) {
        final prefix = id.substring(0, id.length - 'view'.length);
        next.removeWhere((g) => g.startsWith(prefix) || (!isFeature && g.startsWith('$mk:$tk.')));
      }
    } else {
      next
        ..add(id)
        ..add('$mk:$tk:view');
      if (isFeature) next.add('$mk:$tab:view');
    }
    if (isFeature) {
      final marker = '$mk:$tab.*:none';
      next.remove(marker);
      if (!isTabCustomised(next, mk, tab)) next.add(marker);
    }
    _commit(next);
  }

  void _resetFeatures(String mk, String tk) {
    if (e.readOnly) return;
    _commit(e.grants.where((g) => !g.startsWith('$mk:$tk.')));
  }

  void _toggleRow(Set<String> expanded, String mk, String tk, List<String> acts) {
    if (e.readOnly) return;
    final ids = acts.map((a) => '$mk:$tk:$a').toList();
    final next = _concretize(expanded, mk);
    final allOn = ids.every(next.contains);
    for (final id in ids) {
      allOn ? next.remove(id) : next.add(id);
    }
    _commit(next);
  }

  void _applyPreset(String mk, _Preset p) {
    if (e.readOnly) return;
    _commit([...e.grants.where((g) => !g.startsWith('$mk:')), ..._presetGrants(mk, p)]);
  }

  _Preset? _activePreset(String mk) {
    final mine = (e.grants.where((g) => g.startsWith('$mk:')).toList()..sort()).join('|');
    for (final p in _presets) {
      if ((_presetGrants(mk, p.$1)..sort()).join('|') == mine) return p.$1;
    }
    return null;
  }

  String _visKeyLabel(String key) {
    final parts = key.split(':');
    final mod = regModules(reg)[parts[0]];
    final rest = parts.length > 1 ? parts[1].split('.') : <String>[''];
    if (rest.length > 1) {
      final l = str(_features(mod ?? {})[rest[0]]?[rest[1]]?['label']);
      return l.isNotEmpty ? l : key;
    }
    return _strMap(mod?['subtabs'])[rest[0]] ?? key;
  }

  Widget? _visChip(String key) {
    if (e.visibilityRules == null) return null;
    final cat = jsonMap(reg['visibility']);
    if (cat[key] == null) return null;
    final entry = jsonMap(cat[key]);
    final rule = e.visibilityRules![key];
    return _RuleChip(
      text: 'Visibility: ${describeVisibilityRule(rule, entry)}',
      active: rule != null,
      onTap: () async {
        final res = await showVisibilityRuleSheet(context,
            entry: entry,
            keyLabel: _visKeyLabel(key),
            rule: rule,
            readOnly: e.readOnly || e.onVisibilityRulesChange == null);
        if (res == null) return;
        final next = Map<String, Json>.of(e.visibilityRules!);
        if (res.rule != null) {
          next[key] = res.rule!;
        } else {
          next.remove(key);
        }
        e.onVisibilityRulesChange?.call(next);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final expanded = expandGrants(reg, e.grants);
    final inh = _inh;
    bool isOn(String id) => expanded.contains(id) || inh.contains(id);
    final labels = _strMap(reg['action_labels']);
    final pickers = e.assigneeRules == null ? <String, Json>{} : {
      for (final p in jsonMap(jsonMap(reg['assignee_rules'])['pickers']).entries) p.key: jsonMap(p.value),
    };
    final ruleModes = _strMap(jsonMap(reg['assignee_rules'])['modes']);
    final q = _query.trim().toLowerCase();

    final modules = regModules(reg).entries.where((me) {
      final mod = me.value;
      final total = _tabActions(mod).values.fold<int>(0, (n, a) => n + a.length);
      if (total == 0) return false;
      if (q.isEmpty) return true;
      return str(mod['label']).toLowerCase().contains(q) ||
          _strMap(mod['subtabs']).values.any((l) => l.toLowerCase().contains(q)) ||
          _features(mod).values.any((fs) => fs.values.any((f) => str(f['label']).toLowerCase().contains(q)));
    }).toList();

    Widget actionChip(String moduleKey, String id, String action, {bool faded = false, String? tip}) {
      final from = e.inheritedFrom[id];
      final lockedInh = inh.contains(id) && !expanded.contains(id);
      final on = isOn(id);
      final chip = FilterChip(
        label: Text(labels[action] ?? humanAction(action), style: const TextStyle(fontSize: 12)),
        selected: on,
        showCheckmark: true,
        visualDensity: VisualDensity.compact,
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        selectedColor: Brand.primarySoft,
        checkmarkColor: Brand.primaryActive,
        side: BorderSide(color: on ? Brand.primary.withValues(alpha: faded || lockedInh ? 0.35 : 1) : Brand.border),
        onSelected: e.readOnly || lockedInh ? null : (_) => _toggle(expanded, moduleKey, id),
      );
      final tipText = from != null ? 'From: ${from.join(', ')}' : (lockedInh ? 'From this user\'s roles' : tip);
      return Opacity(
        opacity: lockedInh || (faded && on) ? 0.55 : 1,
        child: tipText == null ? chip : Tooltip(message: tipText, triggerMode: TooltipTriggerMode.longPress, child: chip),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          onChanged: (v) => setState(() => _query = v),
          decoration: fieldDecoration('Search module or tab…', suffix: const Icon(Icons.search_rounded)),
        ),
        Row(
          children: [
            TextButton(
                onPressed: () => setState(() => _open.addAll(modules.map((m) => m.key))),
                child: const Text('Expand all')),
            TextButton(onPressed: () => setState(_open.clear), child: const Text('Collapse all')),
          ],
        ),
        if (modules.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text('No module matches your search.', style: TextStyle(color: Brand.muted, fontSize: 13)),
          ),
        for (final me in modules) _moduleCard(me.key, me.value, expanded, isOn, actionChip, labels, pickers, ruleModes, q),
      ],
    );
  }

  Widget _moduleCard(
    String moduleKey,
    Json mod,
    Set<String> expanded,
    bool Function(String) isOn,
    Widget Function(String, String, String, {bool faded, String? tip}) actionChip,
    Map<String, String> labels,
    Map<String, Json> pickers,
    Map<String, String> ruleModes,
    String q,
  ) {
    final acts = _tabActions(mod);
    final feats = _features(mod);
    final all = [
      for (final t in acts.entries)
        for (final a in t.value) '$moduleKey:${t.key}:$a',
      for (final t in feats.entries)
        for (final f in t.value.entries)
          for (final a in _featActions(f.value)) '$moduleKey:${t.key}.${f.key}:$a',
    ];
    final granted = all.where(isOn).length;
    final preset = _activePreset(moduleKey);
    final isOpen = _open.contains(moduleKey) || q.isNotEmpty;
    final subtabs = _strMap(mod['subtabs']);
    final groups = _strMap(mod['groups']);
    final kinds = _strMap(mod['feature_kinds']);
    final tabs = subtabs.keys.toList();

    final rows = <Widget>[];
    for (var i = 0; i < tabs.length; i++) {
      final tabKey = tabs[i];
      final group = groups[tabKey];
      final prevGroup = i > 0 ? groups[tabs[i - 1]] : null;
      final tabActions = acts[tabKey] ?? const <String>[];
      final tfeats = (feats[tabKey] ?? const <String, Json>{}).entries.toList();
      final fKey = '$moduleKey:$tabKey';
      final featsOpen =
          _openFeatures.contains(fKey) || (q.isNotEmpty && tfeats.any((f) => str(f.value['label']).toLowerCase().contains(q)));
      final customisedTab = isTabCustomised(e.grants, moduleKey, tabKey);
      final indent = group != null ? 12.0 : 0.0;
      if (group != null && group != prevGroup) {
        rows.add(Padding(
          padding: const EdgeInsets.fromLTRB(0, 10, 0, 2),
          child: Text(group.toUpperCase(),
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Brand.muted, letterSpacing: 0.4)),
        ));
      }
      rows.add(Container(
        padding: EdgeInsets.fromLTRB(indent, 8, 0, 8),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: Brand.border))),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            InkWell(
              onTap: e.readOnly ? null : () => _toggleRow(expanded, moduleKey, tabKey, tabActions),
              child: Text(subtabs[tabKey] ?? tabKey,
                  style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: Brand.body,
                      decoration: e.readOnly ? null : TextDecoration.underline,
                      decorationStyle: TextDecorationStyle.dotted)),
            ),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final a in tabActions) actionChip(moduleKey, '$moduleKey:$tabKey:$a', a),
            ]),
            if (tfeats.isNotEmpty || _visChip(fKey) != null) const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              if (tfeats.isNotEmpty)
                _RuleChip(
                  text:
                      '${featsOpen ? '▾' : '▸'} ${tfeats.length} feature${tfeats.length == 1 ? '' : 's'}${customisedTab ? ' · customised' : ''}',
                  active: true,
                  onTap: () => setState(() => featsOpen ? _openFeatures.remove(fKey) : _openFeatures.add(fKey)),
                ),
              ?_visChip(fKey),
            ]),
            if (featsOpen && tfeats.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: const Color(0x082563EB), borderRadius: BorderRadius.circular(8)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    customisedTab
                        ? Wrap(crossAxisAlignment: WrapCrossAlignment.center, children: [
                            const Text('Customised for this role — only the ticks below count.',
                                style: TextStyle(fontSize: 11.5, color: Brand.muted)),
                            if (!e.readOnly)
                              TextButton(
                                  onPressed: () => _resetFeatures(moduleKey, tabKey),
                                  child: const Text('Reset to follow the tab', style: TextStyle(fontSize: 12))),
                          ])
                        : const Text(
                            'Following the tab: each feature gets the tab action shown on long-press. Tick or untick one to customise.',
                            style: TextStyle(fontSize: 11.5, color: Brand.muted)),
                    for (final fe in tfeats)
                      _featureRow(moduleKey, tabKey, fe.key, fe.value, expanded, actionChip, labels, pickers, ruleModes,
                          kinds, customisedTab),
                  ],
                ),
              ),
            ],
          ],
        ),
      ));
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              color: const Color(0x0FF4713B),
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  InkWell(
                    onTap: () => setState(() => isOpen ? _open.remove(moduleKey) : _open.add(moduleKey)),
                    child: Row(
                      children: [
                        Icon(isOpen ? Icons.expand_more_rounded : Icons.chevron_right_rounded, size: 20, color: Brand.muted),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(str(mod['label']),
                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
                        ),
                        _Pill(
                          granted == 0 ? 'No access' : granted == all.length ? 'Full' : '$granted / ${all.length}',
                          granted > 0 ? const Color(0xFF047857) : const Color(0xFF64748B),
                        ),
                      ],
                    ),
                  ),
                  if (!e.readOnly) ...[
                    const SizedBox(height: 6),
                    Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final p in _presets)
                        Tooltip(
                          message: p.$3,
                          triggerMode: TooltipTriggerMode.longPress,
                          child: ChoiceChip(
                            label: Text(p.$2, style: const TextStyle(fontSize: 12)),
                            selected: preset == p.$1,
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            selectedColor: Brand.primarySoft,
                            onSelected: (_) => _applyPreset(moduleKey, p.$1),
                          ),
                        ),
                    ]),
                  ],
                ],
              ),
            ),
            if (isOpen)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 8, bottom: 4),
                    child: Text('TAB  (${tabs.length})',
                        style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: Brand.muted)),
                  ),
                  ...rows,
                ]),
              ),
          ],
        ),
      ),
    );
  }

  Widget _featureRow(
    String moduleKey,
    String tabKey,
    String fk,
    Json f,
    Set<String> expanded,
    Widget Function(String, String, String, {bool faded, String? tip}) actionChip,
    Map<String, String> labels,
    Map<String, Json> pickers,
    Map<String, String> ruleModes,
    Map<String, String> kinds,
    bool customisedTab,
  ) {
    final kind = str(f['kind']);
    final pkKey = '$moduleKey:$tabKey.$fk';
    final picker = pickers[pkKey];
    final inherit = _featInherit(f);
    final rule = e.assigneeRules?[pkKey];
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('↳ ${str(f['label'])}', style: const TextStyle(fontSize: 13, color: Brand.body)),
              _Pill((kinds[kind] ?? kind).toUpperCase(), kind == 'sensitive' ? const Color(0xFFB91C1C) : const Color(0xFF64748B)),
            ],
          ),
          if (str(f['hint']).isNotEmpty)
            Text(str(f['hint']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
          const SizedBox(height: 4),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final a in _featActions(f))
              actionChip(
                moduleKey,
                '$pkKey:$a',
                a,
                faded: !customisedTab && expanded.contains('$pkKey:$a'),
                tip: inherit[a] == null
                    ? 'Given only when ticked — no preset or tab gives it'
                    : !customisedTab
                        ? "Follows the tab's ${labels[inherit[a]] ?? inherit[a]}"
                        : null,
              ),
          ]),
          if (picker != null || _visChip(pkKey) != null) const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (picker != null)
              _RuleChip(
                text: '${str(picker['label'])}: ${describeAssigneeRule(rule, ruleModes)} ▾',
                active: rule != null,
                onTap: () async {
                  final res = await showAssigneeRuleSheet(context,
                      title: str(picker['label']),
                      hint: str(picker['hint']),
                      rule: rule,
                      modes: ruleModes,
                      options: e.assigneeOptions ?? const AssigneeOptions(),
                      readOnly: e.readOnly || e.onAssigneeRulesChange == null);
                  if (res == null) return;
                  final next = Map<String, Json>.of(e.assigneeRules ?? {});
                  if (res.rule != null) {
                    next[pkKey] = res.rule!;
                  } else {
                    next.remove(pkKey);
                  }
                  e.onAssigneeRulesChange?.call(next);
                },
              ),
            ?_visChip(pkKey),
          ]),
        ],
      ),
    );
  }
}

String humanAction(String a) => a.isEmpty ? a : a[0].toUpperCase() + a.substring(1).replaceAll('_', ' ');

class _Pill extends StatelessWidget {
  const _Pill(this.text, this.color);
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
        child: Text(text, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: color)),
      );
}

class _RuleChip extends StatelessWidget {
  const _RuleChip({required this.text, required this.active, required this.onTap});
  final String text;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
        color: active ? const Color(0x14F4713B) : Colors.white,
        shape: StadiumBorder(side: BorderSide(color: active ? Brand.primary : Brand.border)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            child: Text(text,
                style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: active ? const Color(0xFFC2410C) : Brand.muted)),
          ),
        ),
      );
}
