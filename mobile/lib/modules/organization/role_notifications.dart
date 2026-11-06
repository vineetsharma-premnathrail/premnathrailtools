import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import 'org_common.dart';
import 'permission_tree.dart';

// Phone version of components/organization/RoleNotificationsEditor.tsx: per
// module, which events a role's members are told about and on which channels.
// `value` is { "<module>.<event>": ["bell" | "email" | "teams"] }.
// Personal mode (fromRoles != null): value holds one user's overrides only.

const _kinds = {
  'approval': ('Needs approval', Color(0xFFB45309), Color(0xFFFEF3C7)),
  'assignment': ('Assignment', Color(0xFF1D4ED8), Color(0xFFDBEAFE)),
  'reminder': ('Reminder', Color(0xFF7C3AED), Color(0xFFEDE9FE)),
  'info': ('Information', Color(0xFF475569), Color(0xFFF1F5F9)),
};

List<String> _strs(Object? v) => v is List ? v.map(str).toList() : <String>[];

class RoleNotificationsEditor extends StatefulWidget {
  const RoleNotificationsEditor({
    super.key,
    required this.catalog,
    required this.registry,
    required this.permissions,
    required this.value,
    required this.onChanged,
    this.readOnly = false,
    this.fromRoles,
  });

  final Json catalog;
  final Json registry;

  /// The role's raw permission grants - to warn when it can't receive an event.
  final List<String> permissions;
  final Map<String, List<String>> value;
  final ValueChanged<Map<String, List<String>>> onChanged;
  final bool readOnly;
  final Map<String, List<String>>? fromRoles;

  @override
  State<RoleNotificationsEditor> createState() => _RoleNotificationsEditorState();
}

class _RoleNotificationsEditorState extends State<RoleNotificationsEditor> {
  String _query = '';
  final _open = <String>{};

  bool get personal => widget.fromRoles != null;
  List<Json> get channels => jsonList(widget.catalog['channels']);
  Map<String, Json> get modules =>
      jsonMap(widget.catalog['modules']).map((k, v) => MapEntry(k, jsonMap(v)));

  Json? _spec(String key) {
    final i = key.indexOf('.');
    if (i < 0) return null;
    final m = modules[key.substring(0, i)];
    final ev = jsonMap(m?['events'])[key.substring(i + 1)];
    return ev == null ? null : jsonMap(ev);
  }

  bool _isDirect(String key) => str(_spec(key)?['audience']) == 'direct';

  void _setEvent(String key, List<String> chans) {
    if (widget.readOnly) return;
    final next = Map<String, List<String>>.of(widget.value);
    if (chans.isNotEmpty || personal || _isDirect(key)) {
      next[key] = channels.map((c) => str(c['key'])).where(chans.contains).toList();
    } else {
      next.remove(key);
    }
    widget.onChanged(next);
  }

  List<String> _shown(String key) {
    if (widget.value.containsKey(key)) return widget.value[key]!;
    if (personal && widget.fromRoles!.containsKey(key)) return widget.fromRoles![key]!;
    return _isDirect(key) ? _strs(_spec(key)?['default_channels']) : <String>[];
  }

  bool _onDefault(String key) =>
      _isDirect(key) && !widget.value.containsKey(key) && !(personal && widget.fromRoles!.containsKey(key));

  void _toggle(String key, String channel) {
    final cur = _shown(key);
    _setEvent(key, cur.contains(channel) ? cur.where((c) => c != channel).toList() : [...cur, channel]);
  }

  void _followRoles(String key) {
    if (widget.readOnly) return;
    widget.onChanged(Map.of(widget.value)..remove(key));
  }

  Widget _link(String text, VoidCallback onTap) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Text(text, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF2563EB))),
        ),
      );

  Widget _pill(String text, Color c, [Color? bg]) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
        decoration: BoxDecoration(color: bg ?? c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
        child: Text(text, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: c)),
      );

  @override
  Widget build(BuildContext context) {
    if (modules.isEmpty) {
      return const Text('No module has notifiable events yet.', style: TextStyle(fontSize: 13, color: Brand.muted));
    }
    final granted = expandGrants(widget.registry, widget.permissions);
    final q = _query.trim().toLowerCase();
    final n = widget.value.length;
    final shownMods = modules.entries.where((m) =>
        q.isEmpty ||
        str(m.value['label']).toLowerCase().contains(q) ||
        jsonMap(m.value['events']).values.any((e) => str(jsonMap(e)['label']).toLowerCase().contains(q)));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          onChanged: (v) => setState(() => _query = v),
          decoration: fieldDecoration('Search module or event…', suffix: const Icon(Icons.search_rounded)),
        ),
        const SizedBox(height: 6),
        Text(
          personal
              ? "$n personal change${n == 1 ? '' : 's'} · faded ticks come from this user's roles or the default"
              : '$n setting${n == 1 ? '' : 's'} changed · faded ticks are the default',
          style: const TextStyle(fontSize: 12, color: Brand.muted),
        ),
        const SizedBox(height: 8),
        const Text.rich(
          TextSpan(style: TextStyle(fontSize: 12, color: Brand.muted, height: 1.5), children: [
            TextSpan(text: 'Sent to a person directly', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
            TextSpan(
                text: ': the portal picks who gets it (the assignee, the requester, the approver …). '
                    'Ticks here only choose how those people are told; they never add people. '),
            TextSpan(text: 'Watch everyone\'s activity', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
            TextSpan(
                text: ': every member of this role is told about other people\'s records too. Use it only for supervisors.'),
          ]),
        ),
        const SizedBox(height: 10),
        for (final m in shownMods) _module(m.key, m.value, granted, q),
      ],
    );
  }

  Widget _module(String mk, Json m, Set<String> granted, String q) {
    final evs = jsonMap(m['events']).map((k, v) => MapEntry(k, jsonMap(v)));
    final shownEvs = evs.entries
        .where((e) => q.isEmpty || str(e.value['label']).toLowerCase().contains(q) || str(m['label']).toLowerCase().contains(q))
        .toList();
    final on = evs.keys.where((ek) => widget.value.containsKey('$mk.$ek')).length;
    final isOpen = _open.contains(mk) || q.isNotEmpty;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Material(
            color: const Color(0x0FF4713B),
            child: InkWell(
              onTap: () => setState(() => isOpen ? _open.remove(mk) : _open.add(mk)),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                child: Row(children: [
                  Icon(isOpen ? Icons.expand_more_rounded : Icons.chevron_right_rounded, size: 20, color: Brand.muted),
                  const SizedBox(width: 4),
                  Expanded(
                      child: Text(str(m['label']),
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading))),
                  _pill(on > 0 ? '$on changed' : 'Default', on > 0 ? const Color(0xFF047857) : const Color(0xFF64748B)),
                ]),
              ),
            ),
          ),
          if (isOpen)
            for (final aud in const ['direct', 'watchers'])
              ...() {
                final rows = shownEvs.where((e) => (str(e.value['audience']).isEmpty ? 'watchers' : str(e.value['audience'])) == aud).toList();
                if (rows.isEmpty) return <Widget>[];
                return <Widget>[
                  Container(
                    color: const Color(0x04000000),
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
                    child: Text(
                        (aud == 'direct' ? 'Sent to a person directly' : 'Watch everyone’s activity (supervisors)').toUpperCase(),
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Brand.muted, letterSpacing: 0.3)),
                  ),
                  for (final e in rows) _event(mk, e.key, e.value, granted),
                ];
              }(),
        ],
      ),
    );
  }

  Widget _event(String mk, String ek, Json e, Set<String> granted) {
    final key = '$mk.$ek';
    final cur = _shown(key);
    final own = personal && widget.value.containsKey(key);
    final kind = _kinds[str(e['kind'])] ?? _kinds['info']!;
    final access = e['access'] == null ? null : str(e['access']);
    final canReceive = access == null || granted.contains(access);
    final dflt = _onDefault(key);
    final direct = str(e['audience']) == 'direct';
    final bellLocked = direct && str(e['kind']) == 'approval';
    final ro = widget.readOnly;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: const BoxDecoration(border: Border(top: BorderSide(color: Brand.border))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(str(e['label']), style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading, fontSize: 13)),
            _pill(kind.$1, kind.$2, kind.$3),
            if (!ro && !direct && cur.isEmpty && !own) _link('+ Subscribe', () => _setEvent(key, _strs(e['default_channels']))),
            if (own) _pill(cur.isNotEmpty ? 'Only for this user' : 'Off for this user', const Color(0xFF1D4ED8)),
            if (own && !ro) _link('Follow roles', () => _followRoles(key)),
          ]),
          if (direct && dflt) Padding(padding: const EdgeInsets.only(top: 3), child: _pill('Default', const Color(0xFF64748B))),
          if (direct && !personal && !ro && widget.value.containsKey(key)) _link('Reset to default', () => _followRoles(key)),
          const SizedBox(height: 2),
          direct
              ? Text(
                  'To: ${str(e['recipient']).isEmpty ? 'The person concerned' : str(e['recipient'])}. Sent when ${str(e['trigger'])}.'
                  '${bellLocked ? ' The portal bell is always on for approvals.' : cur.isEmpty ? ' Switched off: they will not be told.' : ''}',
                  style: const TextStyle(fontSize: 11.5, color: Brand.muted))
              : Text(
                  'To: every member of this role. Sent when ${str(e['trigger'])}. Needs: ${access == null ? '—' : permissionWords(widget.registry, access)}.',
                  style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
          if (cur.isNotEmpty && !canReceive)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Icon(Icons.warning_amber_rounded, size: 14, color: Color(0xFFB45309)),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                      personal
                          ? 'This user doesn’t hold that permission, so they won’t receive it.'
                          : "This role doesn't grant that permission — members get it only if another role or an extra grant gives it.",
                      style: const TextStyle(fontSize: 11.5, color: Color(0xFFB45309))),
                ),
              ]),
            ),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final c in channels)
              Builder(builder: (_) {
                final ck = str(c['key']);
                final locked = bellLocked && ck == 'bell';
                final checked = cur.contains(ck) || locked;
                final faded = ((personal && !own) || dflt) && cur.contains(ck);
                return Opacity(
                  opacity: faded ? 0.55 : 1,
                  child: FilterChip(
                    label: Text(str(c['label']), style: const TextStyle(fontSize: 12)),
                    selected: checked,
                    visualDensity: VisualDensity.compact,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    selectedColor: Brand.primarySoft,
                    checkmarkColor: Brand.primaryActive,
                    onSelected: ro || locked ? null : (_) => _toggle(key, ck),
                  ),
                );
              }),
          ]),
        ],
      ),
    );
  }
}
