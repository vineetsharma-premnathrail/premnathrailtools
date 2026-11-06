import 'dart:convert';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';

/// Finance settings (portal finance/settings → shared ModuleSettingsPage over
/// GET/PUT /accounts/settings). Opened from the gear next to the bell.
class FinSettingsScreen extends StatefulWidget {
  const FinSettingsScreen({super.key});

  @override
  State<FinSettingsScreen> createState() => _FinSettingsScreenState();
}

class _FinSettingsScreenState extends State<FinSettingsScreen> {
  Json? _payload;
  Object? _loadError;
  final _draft = <String, dynamic>{};
  final _ctrls = <String, TextEditingController>{};
  final _errors = <String, String>{};
  List<Json> _users = [];
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  List<Json> get _specs => listOf(_payload?['specs']);

  static const _userTypes = ['user', 'users'];

  void _apply(Json p) {
    _payload = p;
    _draft.clear();
    _errors.clear();
    final values = asJson(p['values']);
    for (final s in listOf(p['specs'])) {
      final k = '${s['key']}';
      final v = values[k];
      final t = s['type'];
      if (t == 'int' || t == 'decimal') {
        _draft[k] = v == null ? '' : '$v';
      } else if (t == 'json_list') {
        _draft[k] = v is List ? v.join(', ') : '';
      } else if (t == 'json') {
        _draft[k] = const JsonEncoder.withIndent('  ').convert(v);
      } else {
        _draft[k] = v;
      }
      if (const ['int', 'decimal', 'json_list', 'json', 'text', 'longtext', 'prefix'].contains(t)) {
        (_ctrls[k] ??= TextEditingController()).text = '${_draft[k] ?? ''}';
      }
    }
  }

  Future<void> _load() async {
    try {
      final p = asJson(await Api.get('/accounts/settings'));
      if (listOf(p['specs']).any((s) => _userTypes.contains(s['type']))) {
        try {
          _users = asRows(await Api.get('/users/directory'));
        } catch (_) {
          // picker falls back to ids
        }
      }
      if (mounted) setState(() => _apply(p));
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
    }
  }

  /// Parses one draft value; returns (value, error).
  (Object?, String?) _parse(Json spec, Object? raw) {
    final label = '${spec['label']}';
    final t = spec['type'];
    if (t == 'int' || t == 'decimal') {
      final s = '${raw ?? ''}'.trim();
      if (s.isEmpty) return (null, '$label is required — enter a number.');
      final n = num.tryParse(s);
      if (n == null) return (null, '$label must be a number — enter digits only.');
      if (t == 'int' && n != n.roundToDouble()) return (null, '$label must be a whole number — remove the decimal part.');
      final min = toNum(spec['min']);
      final max = toNum(spec['max']);
      if ((min != null && n < min) || (max != null && n > max)) {
        final range = min != null && max != null ? 'between $min and $max' : (min != null ? 'at least $min' : 'at most $max');
        return (null, '$label must be $range — enter a number in that range.');
      }
      return (t == 'int' ? n.toInt() : n, null);
    }
    if (t == 'json_list') {
      final parts = '${raw ?? ''}'.split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
      final def = spec['default'];
      final numeric = def is List && def.isNotEmpty && def.every((x) => x is num);
      if (!numeric) return (parts, null);
      final whole = (def).every((x) => x is int || (x is num && x == x.roundToDouble()));
      final nums = <num>[];
      for (final p in parts) {
        final n = num.tryParse(p);
        if (n == null) return (null, '$label: "$p" is not a number — enter numbers separated by commas.');
        if (whole && n != n.roundToDouble()) return (null, '$label: "$p" must be a whole number — remove the decimal part.');
        nums.add(whole ? n.toInt() : n);
      }
      return (nums, null);
    }
    if (t == 'user' && spec['required'] == true && (raw == null || raw == '')) return (null, '$label is required — pick a person.');
    if (t == 'json') {
      try {
        return (jsonDecode('${raw ?? 'null'}'), null);
      } catch (_) {
        return (null, '$label is not valid JSON — check brackets and quotes.');
      }
    }
    return (raw, null);
  }

  bool _same(Object? a, Object? b) => jsonEncode(a) == jsonEncode(b);

  Future<void> _save() async {
    final values = <String, dynamic>{};
    final errs = <String, String>{};
    final current = asJson(_payload?['values']);
    for (final s in _specs) {
      if (s['locked'] == true) continue;
      final k = '${s['key']}';
      final (v, err) = _parse(s, _draft[k]);
      if (err != null) {
        errs[k] = err;
        continue;
      }
      if (!_same(v, current[k])) values[k] = v;
    }
    if (errs.isNotEmpty) {
      setState(() {
        _errors
          ..clear()
          ..addAll(errs);
        _error = 'Fix the highlighted fields — ${errs.values.first}';
      });
      return;
    }
    if (values.isEmpty) {
      showSnack(context, 'Nothing changed — edit a setting first.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final p = asJson(await Api.put('/accounts/settings', data: {'values': values}));
      if (!mounted) return;
      setState(() => _apply(p));
      showSnack(context, 'Saved ${values.length} setting${values.length == 1 ? '' : 's'}.');
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _reset(Json spec) async {
    final ok = await confirmDialog(context,
        title: 'Reset to default?', message: '${spec['label']} goes back to its default value.', confirmLabel: 'Reset');
    if (!ok || !mounted) return;
    try {
      final p = asJson(await Api.post('/accounts/settings/reset/${spec['key']}'));
      if (mounted) setState(() => _apply(p));
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
    }
  }

  String _userName(Object? id) {
    for (final u in _users) {
      if ('${u['id']}' == '$id') return '${u['name']}';
    }
    return id == null ? '' : '#$id';
  }

  List<Option<String>> get _userOptions => [
        for (final u in _users)
          Option('${u['id']}', '${u['name']}', subtitle: u['department'] as String?),
      ];

  Widget _field(Json s, bool canEdit) {
    final k = '${s['key']}';
    final t = '${s['type']}';
    final label = '${s['label']}';
    final enabled = canEdit && s['locked'] != true;
    final opts = [for (final o in listOf(s['options'])) Option('${o['value']}', '${o['label']}')];
    Widget input;
    switch (t) {
      case 'bool':
        input = SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(label),
          value: _draft[k] == true,
          onChanged: enabled ? (v) => setState(() => _draft[k] = v) : null,
        );
      case 'select':
        input = AppSelect<String>(
          label: label,
          value: _draft[k] == null ? null : '${_draft[k]}',
          enabled: enabled,
          clearable: s['required'] != true,
          options: opts,
          onChanged: (o) => setState(() => _draft[k] = o?.value),
        );
      case 'multi_select':
      case 'users':
        final list = (_draft[k] is List ? _draft[k] as List : const []).map((e) => '$e').toList();
        final choices = t == 'users' ? _userOptions : opts;
        input = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final v in list)
              InputChip(
                label: Text(t == 'users' ? _userName(v) : (choices.where((o) => o.value == v).firstOrNull?.label ?? v)),
                onDeleted: enabled
                    ? () => setState(() {
                          final next = [...(_draft[k] as List)]..removeWhere((x) => '$x' == v);
                          _draft[k] = next;
                        })
                    : null,
              ),
            if (enabled)
              ActionChip(
                avatar: const Icon(Icons.add_rounded, size: 16),
                label: const Text('Add'),
                onPressed: () async {
                  String? picked;
                  await showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    builder: (ctx) => SafeArea(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: AppSelect<String>(
                          label: label,
                          value: null,
                          options: choices.where((o) => !list.contains(o.value)).toList(),
                          onChanged: (o) {
                            picked = o?.value;
                            Navigator.pop(ctx);
                          },
                        ),
                      ),
                    ),
                  );
                  if (picked != null) {
                    setState(() {
                      final next = [...(_draft[k] is List ? _draft[k] as List : const [])];
                      next.add(t == 'users' ? (int.tryParse(picked!) ?? picked) : picked);
                      _draft[k] = next;
                    });
                  }
                },
              ),
          ]),
        ]);
      case 'user':
        input = AppSelect<String>(
          label: label,
          required: s['required'] == true,
          enabled: enabled,
          value: _draft[k] == null ? null : '${_draft[k]}',
          valueLabel: _userName(_draft[k]),
          options: _userOptions,
          onChanged: (o) => setState(() => _draft[k] = o == null ? null : (int.tryParse(o.value) ?? o.value)),
        );
      default:
        input = AppTextField(
          label: label,
          controller: _ctrls[k],
          enabled: enabled,
          maxLines: t == 'longtext' || t == 'json' ? 4 : 1,
          keyboardType: t == 'int' || t == 'decimal' ? AppTextField.number : null,
          hint: t == 'json_list' ? 'Comma-separated' : null,
          onChanged: (v) => setState(() {
            _draft[k] = v;
            _errors.remove(k);
          }),
        );
    }
    final isDefault = asJson(_payload?['is_default'])[k] != false;
    final meta = asJson(asJson(_payload?['meta'])[k]);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        input,
        if ('${s['help'] ?? ''}'.isNotEmpty)
          Padding(padding: const EdgeInsets.only(top: 4), child: Text('${s['help']}', style: const TextStyle(fontSize: 12, color: Brand.muted))),
        if (_errors[k] != null) Text(_errors[k]!, style: const TextStyle(fontSize: 12, color: Brand.danger)),
        if (s['locked'] == true) const Text('Locked — set by the system.', style: TextStyle(fontSize: 11.5, color: Brand.muted)),
        Row(children: [
          if (!isDefault && meta['updated_by_name'] != null)
            Expanded(
              child: Text('Changed by ${meta['updated_by_name']} · ${fmtDateTime(meta['updated_at'])}',
                  style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
            )
          else
            const Spacer(),
          if (!isDefault && enabled)
            TextButton(onPressed: () => _reset(s), child: const Text('Reset to default')),
        ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = _payload;
    final canEdit = p?['can_edit'] == true;
    Widget body;
    if (_loadError != null) {
      body = ErrorView(_loadError!, onRetry: () {
        setState(() => _loadError = null);
        _load();
      });
    } else if (p == null) {
      body = const LoadingView();
    } else {
      final groups = listOf(p['groups']);
      final byGroup = <String, List<Json>>{};
      for (final s in _specs) {
        byGroup.putIfAbsent('${s['group']}', () => []).add(s);
      }
      body = ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
        if (!canEdit)
          InfoBanner('${p['editors_note'] ?? 'You can view these settings; only users with Finance Settings › Edit can change them.'}'),
        if (canEdit && '${p['editors_note'] ?? ''}'.isNotEmpty) InfoBanner('${p['editors_note']}'),
        if (_error != null) padded(ErrorBanner(_error!)),
        for (final g in groups)
          if ((byGroup['${g['key']}'] ?? const []).isNotEmpty)
            DetailSection('${g['label']}'.replaceFirst(RegExp(r'^Notification\s+—\s+'), 'Notification — '), children: [
              for (final s in byGroup['${g['key']}']!) _field(s, canEdit),
            ]),
      ]);
    }
    return SubPage(
      title: 'Finance settings',
      bottom: canEdit && p != null
          ? ActionBar([actionBtn(_saving ? 'Saving…' : 'Save changes', _saving ? null : _save, primary: true)])
          : null,
      body: body,
    );
  }
}
