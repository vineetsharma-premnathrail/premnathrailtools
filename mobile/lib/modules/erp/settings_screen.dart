import 'dart:convert';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'erp_common.dart';

/// Service settings (portal: erp/settings → shared/ModuleSettingsPage.tsx,
/// the gear next to the bell): approvals switches, warranty / billing
/// defaults and notification rules. Values apply right away.
class ServiceSettingsScreen extends StatefulWidget {
  const ServiceSettingsScreen({super.key});

  @override
  State<ServiceSettingsScreen> createState() => _ServiceSettingsScreenState();
}

class _ServiceSettingsScreenState extends State<ServiceSettingsScreen> {
  Json? _payload;
  Object? _loadError;
  final Map<String, Object?> _draft = {};
  final Map<String, String> _fieldErrors = {};
  String? _error;
  String? _notice;
  bool _saving = false;
  List<Option<int>> _users = [];

  List<Json> get _specs => (_payload?['specs'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
  Map get _values => _payload?['values'] is Map ? _payload!['values'] as Map : const {};
  Map get _isDefault => _payload?['is_default'] is Map ? _payload!['is_default'] as Map : const {};
  Map get _meta => _payload?['meta'] is Map ? _payload!['meta'] as Map : const {};
  bool get _canEdit => _payload?['can_edit'] == true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loadError = null);
    try {
      final p = await Api.get('/erp/settings');
      _apply(Map<String, dynamic>.from(p as Map));
      if (_specs.any((s) => s['type'] == 'user' || s['type'] == 'users')) {
        try {
          final u = await Api.list('/users/directory');
          if (mounted) {
            setState(() => _users = [
                  for (final x in u.rows)
                    if (x['id'] is int)
                      Option<int>(x['id'] as int, txt(x['name']),
                          subtitle: [x['department'], x['email']].where((v) => v != null && '$v'.isNotEmpty).join(' · ')),
                ]);
          }
        } catch (_) {
          // People then show by id; the server still checks every value.
        }
      }
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  void _apply(Json p) {
    if (!mounted) return;
    setState(() {
      _payload = p;
      _draft.clear();
      _fieldErrors.clear();
      for (final s in _specs) {
        _draft[s['key']] = _toDraft(s, _values[s['key']]);
      }
    });
  }

  Object? _toDraft(Json s, Object? v) {
    switch (s['type']) {
      case 'int':
      case 'decimal':
        return v == null ? '' : '$v';
      case 'json_list':
        return v is List ? v.join(', ') : '';
      case 'json':
        return const JsonEncoder.withIndent('  ').convert(v);
      default:
        return v;
    }
  }

  String _display(Json s, Object? v) {
    if (v == null || v == '' || (v is List && v.isEmpty)) return '—';
    final opts = (s['options'] as List? ?? const []).whereType<Map>();
    switch (s['type']) {
      case 'bool':
        return v == true ? 'Yes' : 'No';
      case 'select':
      case 'multi_select':
        final items = v is List ? v : [v];
        return items.map((x) => opts.firstWhere((o) => o['value'] == '$x', orElse: () => {'label': '$x'})['label']).join(', ');
      case 'user':
      case 'users':
        final items = v is List ? v : [v];
        return items.map((x) => _users.firstWhere((u) => u.value == numOf(x).toInt(), orElse: () => Option(0, 'User #$x')).label).join(', ');
      default:
        if (v is List) return v.join(', ');
        if (v is Map) return jsonEncode(v);
        return '$v';
    }
  }

  /// Parses one draft value; returns (value, error).
  (Object?, String?) _parse(Json s, Object? raw) {
    final label = s['label'];
    switch (s['type']) {
      case 'int':
      case 'decimal':
        final t = '${raw ?? ''}'.trim();
        if (t.isEmpty) return (null, '$label is required — enter a number.');
        final n = num.tryParse(t);
        if (n == null) return (null, '$label must be a number — enter digits only.');
        if (s['type'] == 'int' && n != n.roundToDouble()) {
          return (null, '$label must be a whole number — remove the decimal part.');
        }
        final min = s['min'] as num?, max = s['max'] as num?;
        if ((min != null && n < min) || (max != null && n > max)) {
          final range = min != null && max != null ? 'between $min and $max' : (min != null ? 'at least $min' : 'at most $max');
          return (null, '$label must be $range — enter a number in that range.');
        }
        return (s['type'] == 'int' ? n.toInt() : n, null);
      case 'json_list':
        final parts = '${raw ?? ''}'.split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
        final def = s['default'];
        final numeric = def is List && def.isNotEmpty && def.every((x) => x is num);
        if (!numeric) return (parts, null);
        final whole = (def).every((x) => x is int || (x is num && x == x.roundToDouble()));
        final out = <num>[];
        for (final p in parts) {
          final n = num.tryParse(p);
          if (n == null) return (null, '$label: "$p" is not a number — enter numbers separated by commas.');
          if (whole && n != n.roundToDouble()) return (null, '$label: "$p" must be a whole number — remove the decimal part.');
          out.add(whole ? n.toInt() : n);
        }
        return (out, null);
      case 'json':
        try {
          return (jsonDecode('${raw ?? 'null'}'), null);
        } catch (_) {
          return (null, '$label is not valid JSON — check brackets and quotes.');
        }
      case 'user':
        if (s['required'] == true && (raw == null || raw == '')) return (null, '$label is required — pick a person.');
        return (raw, null);
      default:
        return (raw, null);
    }
  }

  bool _same(Object? a, Object? b, String? type) {
    if ((type == 'users' || type == 'multi_select') && a is List && b is List) {
      final x = a.map((e) => '$e').toList()..sort();
      final y = b.map((e) => '$e').toList()..sort();
      return jsonEncode(x) == jsonEncode(y);
    }
    return jsonEncode(a) == jsonEncode(b);
  }

  Map<String, (Object?, String?)> get _dirty {
    final out = <String, (Object?, String?)>{};
    for (final s in _specs) {
      if (s['locked'] == true) continue;
      final key = s['key'] as String;
      final parsed = _parse(s, _draft[key]);
      if (parsed.$2 != null) {
        if (!_same(_draft[key], _toDraft(s, _values[key]), s['type'] as String?)) out[key] = parsed;
        continue;
      }
      if (!_same(parsed.$1, _values[key], s['type'] as String?)) out[key] = parsed;
    }
    return out;
  }

  void _set(String key, Object? v) {
    setState(() {
      _draft[key] = v;
      _fieldErrors.remove(key);
      if (_fieldErrors.isEmpty) _error = null;
      _notice = null;
    });
  }

  Future<void> _save() async {
    final errs = <String, String>{};
    final values = <String, Object?>{};
    _dirty.forEach((k, p) {
      if (p.$2 != null) {
        errs[k] = p.$2!;
      } else {
        values[k] = p.$1;
      }
    });
    if (errs.isNotEmpty) {
      setState(() {
        _fieldErrors
          ..clear()
          ..addAll(errs);
        _error = 'Fix the highlighted fields — nothing was saved.';
      });
      return;
    }
    if (values.isEmpty) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final p = await Api.put('/erp/settings', data: {'values': values});
      _apply(Map<String, dynamic>.from(p as Map));
      if (mounted) setState(() => _notice = 'Settings saved.');
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _reset(Json s) async {
    final ok = await confirmDialog(context,
        title: 'Reset to default?',
        message:
            '${s['label']} will go back to its default (${_display(s, s['default'])}). The change is recorded in the audit log.',
        confirmLabel: 'Reset');
    if (!ok) return;
    try {
      final p = await Api.post('/erp/settings/reset/${s['key']}');
      _apply(Map<String, dynamic>.from(p as Map));
      if (mounted) setState(() => _notice = 'Setting reset to its default.');
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Widget _input(Json s) {
    final key = s['key'] as String;
    final v = _draft[key];
    final label = '${s['label']}';
    final required = s['required'] == true;
    final options = [
      for (final o in (s['options'] as List? ?? const []).whereType<Map>()) Option<String>('${o['value']}', '${o['label']}'),
    ];
    if (!_canEdit || s['locked'] == true) return FieldRow(label, _display(s, _values[key]));
    switch (s['type']) {
      case 'bool':
        return SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(label, style: const TextStyle(fontSize: 14, color: Brand.body)),
          subtitle: Text(v == true ? 'Yes' : 'No'),
          value: v == true,
          onChanged: (x) => _set(key, x),
        );
      case 'int':
      case 'decimal':
        return TextFormField(
          key: ValueKey('f$key${_payload.hashCode}'),
          initialValue: '${v ?? ''}',
          keyboardType: AppTextField.number,
          decoration: fieldDecoration(label, required: required),
          onChanged: (x) => _set(key, x),
        );
      case 'select':
        return AppSelect<String>(
          label: label,
          required: required,
          clearable: false,
          value: v == null ? null : '$v',
          options: options,
          onChanged: (o) => _set(key, o?.value),
        );
      case 'multi_select':
        final selected = v is List ? v.map((e) => '$e').toList() : <String>[];
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final o in options)
              FilterChip(
                label: Text(o.label),
                selected: selected.contains(o.value),
                onSelected: (on) => _set(key, [
                  for (final x in options)
                    if (x.value == o.value ? on : selected.contains(x.value)) x.value,
                ]),
              ),
          ]),
        ]);
      case 'user':
        return AppSelect<int>(
          label: label,
          required: required,
          value: v == null ? null : numOf(v).toInt(),
          valueLabel: v == null ? null : _display(s, v),
          options: _users,
          onChanged: (o) => _set(key, o?.value),
        );
      case 'users':
        final ids = v is List ? v.map((e) => numOf(e).toInt()).toList() : <int>[];
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final id in ids)
              InputChip(
                label: Text(_users.firstWhere((u) => u.value == id, orElse: () => Option(id, 'User #$id')).label),
                onDeleted: () => _set(key, ids.where((x) => x != id).toList()),
              ),
          ]),
          const SizedBox(height: 6),
          AppSelect<int>(
            label: 'Add a person',
            value: null,
            options: _users.where((u) => !ids.contains(u.value)).toList(),
            onChanged: (o) {
              if (o != null) _set(key, [...ids, o.value]);
            },
          ),
        ]);
      case 'longtext':
      case 'json':
        return TextFormField(
          key: ValueKey('f$key${_payload.hashCode}'),
          initialValue: '${v ?? ''}',
          maxLines: 6,
          minLines: 3,
          decoration: fieldDecoration(label, required: required),
          onChanged: (x) => _set(key, x),
        );
      default:
        return TextFormField(
          key: ValueKey('f$key${_payload.hashCode}'),
          initialValue: '${v ?? ''}',
          textCapitalization: s['type'] == 'prefix' ? TextCapitalization.characters : TextCapitalization.none,
          decoration: fieldDecoration(label,
              required: required, hint: s['type'] == 'json_list' ? 'Separate entries with commas.' : null),
          onChanged: (x) => _set(key, s['type'] == 'prefix' ? x.toUpperCase() : x),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_payload == null) {
      return SubPage(
        title: 'Service settings',
        body: _loadError == null
            ? const LoadingView()
            : ErrorView('Could not load the settings — ${ApiClient.describe(_loadError!)}', onRetry: _load),
      );
    }
    final dirty = _dirty;
    final groups = (_payload!['groups'] as List? ?? const []).whereType<Map>().toList();
    return SubPage(
      title: 'Service settings',
      bottom: _canEdit
          ? Row(children: [
              if (dirty.isNotEmpty) ...[
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                    onPressed: _saving ? null : () => _apply(_payload!),
                    child: const Text('Discard changes'),
                  ),
                ),
                const SizedBox(width: 10),
              ],
              Expanded(
                child: FilledButton(
                  onPressed: _saving || dirty.isEmpty ? null : _save,
                  child: Text(_saving
                      ? 'Saving…'
                      : dirty.isEmpty
                          ? 'No changes'
                          : 'Save ${dirty.length} change${dirty.length == 1 ? '' : 's'}'),
                ),
              ),
            ])
          : null,
      body: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Text(
                'Values you change here apply right away. A setting showing Default follows the value built into the system.',
                style: TextStyle(fontSize: 13, color: Brand.muted)),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 10), child: ErrorBanner(_error!)),
          if (_notice != null && _error == null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Text(_notice!, style: const TextStyle(color: Color(0xFF166534), fontWeight: FontWeight.w600)),
            ),
          if (!_canEdit)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Text('Read-only. ${_payload!['editors_note'] ?? ''}',
                  style: const TextStyle(fontSize: 13, color: Color(0xFF1E40AF))),
            ),
          for (final g in groups)
            if (_specs.any((s) => s['group'] == g['key']))
              DetailSection('${g['label']}', children: [
                for (final s in _specs.where((s) => s['group'] == g['key'])) _field(s, dirty.containsKey(s['key'])),
              ]),
        ],
      ),
    );
  }

  Widget _field(Json s, bool isDirty) {
    final key = s['key'] as String;
    final isDefault = _isDefault[key] == true;
    final meta = _meta[key] is Map ? _meta[key] as Map : null;
    final canReset = _canEdit &&
        s['locked'] != true &&
        !isDefault &&
        !(s['required'] == true && (s['default'] == null || s['default'] == '' || (s['default'] is List && (s['default'] as List).isEmpty)));
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          if (isDefault) const HexPill('Default', Color(0xFF64748B)),
          if (s['locked'] == true) const HexPill('Locked', Color(0xFF64748B)),
          if (isDirty) const HexPill('Unsaved', Brand.primaryActive),
          if (canReset)
            InkWell(
              onTap: () => _reset(s),
              child: const Padding(
                padding: EdgeInsets.symmetric(vertical: 4),
                child: Text('Reset to default',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Brand.primary)),
              ),
            ),
        ]),
        const SizedBox(height: 4),
        _input(s),
        if (_fieldErrors[key] != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(_fieldErrors[key]!, style: const TextStyle(fontSize: 12, color: Brand.danger)),
          ),
        if ((s['help'] ?? '').toString().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('${s['help']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
          ),
        if (!isDefault && meta != null && (meta['updated_by_name'] != null || meta['updated_at'] != null))
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
                'Changed${meta['updated_by_name'] != null ? ' by ${meta['updated_by_name']}' : ''}'
                '${meta['updated_at'] != null ? ' on ${fmtDate(meta['updated_at'])}' : ''} · default: ${_display(s, s['default'])}',
                style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
          ),
      ]),
    );
  }
}
