import 'dart:convert';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'mt_common.dart';

// Maintenance settings - the shared ModuleSettingsPage over
// GET/PUT /maintenance/settings and POST /maintenance/settings/reset/{key}.

class MaintenanceSettingsScreen extends StatefulWidget {
  const MaintenanceSettingsScreen({super.key});

  @override
  State<MaintenanceSettingsScreen> createState() => _MaintenanceSettingsScreenState();
}

class _MaintenanceSettingsScreenState extends State<MaintenanceSettingsScreen> {
  Json? _p;
  Object? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = asMap(await Api.get('/maintenance/settings'));
      if (mounted) {
        setState(() {
          _p = d;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  List<Option<String>> _opts(Json spec) => [for (final o in asList(spec['options'])) Option(str(o['value']), str(o['label']))];

  String _display(Json spec, Object? v) {
    final type = str(spec['type']);
    if (type == 'bool') return v == true ? 'Yes' : 'No';
    if (type == 'select' || type == 'multi_select') {
      final items = v is List ? v : (v == null ? const [] : [v]);
      final opts = _opts(spec);
      return items.map((x) => opts.where((o) => o.value == '$x').map((o) => o.label).firstOrNull ?? '$x').join(', ');
    }
    if (type == 'json_list' && v is List) return v.join(', ');
    if (type == 'json') return const JsonEncoder.withIndent('  ').convert(v);
    if (type == 'users' && v is List) return v.isEmpty ? '—' : '${v.length} people selected';
    return txt(v);
  }

  bool _editableType(String type) => const ['bool', 'int', 'decimal', 'text', 'longtext', 'prefix', 'select', 'multi_select', 'json_list', 'json'].contains(type);

  Future<void> _edit(Json spec) async {
    final key = str(spec['key']);
    final type = str(spec['type']);
    final v = asMap(_p!['values'])?[key];
    final ctrl = TextEditingController(
      text: type == 'json_list' && v is List
          ? v.join(', ')
          : type == 'json'
              ? const JsonEncoder.withIndent('  ').convert(v)
              : (v == null ? '' : '$v'),
    );
    bool boolVal = v == true;
    String? sel = v == null ? null : '$v';
    final multi = <String>{if (v is List) ...v.map((x) => '$x')};
    final saved = await showFormSheet(
      context,
      title: str(spec['label']),
      builder: (ctx, setS) => [
        if (str(spec['help']).isNotEmpty) hintText(str(spec['help'])),
        if (type == 'bool')
          CheckField(label: str(spec['label']), value: boolVal, onChanged: (b) => setS(() => boolVal = b))
        else if (type == 'select')
          AppSelect<String>(label: str(spec['label']), value: sel, options: _opts(spec), onChanged: (o) => setS(() => sel = o?.value))
        else if (type == 'multi_select')
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final o in _opts(spec))
              FilterChip(
                label: Text(o.label),
                selected: multi.contains(o.value),
                onSelected: (on) => setS(() => on ? multi.add(o.value) : multi.remove(o.value)),
              ),
          ])
        else
          AppTextField(
            label: str(spec['label']),
            controller: ctrl,
            maxLines: type == 'longtext' || type == 'json' ? 6 : 1,
            keyboardType: type == 'int' || type == 'decimal' ? AppTextField.number : null,
            hint: type == 'json_list' ? 'Values separated by commas' : null,
          ),
      ],
      onSave: () async {
        final lbl = str(spec['label']);
        Object? value;
        switch (type) {
          case 'bool':
            value = boolVal;
          case 'select':
            value = sel;
          case 'multi_select':
            value = _opts(spec).map((o) => o.value).where(multi.contains).toList();
          case 'int':
          case 'decimal':
            final s = ctrl.text.trim();
            if (s.isEmpty) throw '$lbl is required — enter a number.';
            final n = num.tryParse(s);
            if (n == null) throw '$lbl must be a number — enter digits only.';
            if (type == 'int' && n != n.roundToDouble()) throw '$lbl must be a whole number — remove the decimal part.';
            final min = asNum(spec['min']), max = asNum(spec['max']);
            if ((min != null && n < min) || (max != null && n > max)) {
              final range = min != null && max != null ? 'between $min and $max' : min != null ? 'at least $min' : 'at most $max';
              throw '$lbl must be $range — enter a number in that range.';
            }
            value = type == 'int' ? n.toInt() : n;
          case 'json_list':
            final parts = ctrl.text.split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
            final numeric = spec['default'] is List && (spec['default'] as List).every((x) => x is num);
            if (numeric) {
              final nums = <num>[];
              for (final p in parts) {
                final n = num.tryParse(p);
                if (n == null) throw '$lbl: "$p" is not a number — enter numbers separated by commas.';
                nums.add(n);
              }
              value = nums;
            } else {
              value = parts;
            }
          case 'json':
            try {
              value = jsonDecode(ctrl.text.isEmpty ? 'null' : ctrl.text);
            } catch (_) {
              throw '$lbl is not valid JSON — check brackets and quotes.';
            }
          default:
            value = ctrl.text;
        }
        final d = asMap(await Api.put('/maintenance/settings', data: {
          'values': {key: value},
        }));
        if (mounted) setState(() => _p = d);
      },
    );
    ctrl.dispose();
    if (saved && mounted) setState(() => _notice = 'Settings saved.');
  }

  Future<void> _reset(Json spec) async {
    final ok = await confirmDialog(context,
        title: 'Reset to default?', message: '${spec['label']} goes back to its default value.', confirmLabel: 'Reset');
    if (!ok || !mounted) return;
    await runAction(context, () async {
      final d = asMap(await Api.post('/maintenance/settings/reset/${spec['key']}'));
      if (mounted) {
        setState(() {
          _p = d;
          _notice = 'Setting reset to its default.';
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    return SubPage(
      title: 'Maintenance settings',
      body: p == null
          ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView())
          : RefreshIndicator(onRefresh: _load, child: _body(p)),
    );
  }

  Widget _body(Json p) {
    final canEdit = p['can_edit'] == true;
    final specs = asList(p['specs']);
    final values = asMap(p['values']) ?? {};
    final isDefault = asMap(p['is_default']) ?? {};
    final meta = asMap(p['meta']) ?? {};
    final groups = asList(p['groups']);
    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        const MtHeader('Maintenance settings', caps: 'Maintenance Module'),
        if (!canEdit && str(p['editors_note']).isNotEmpty) NoteBanner(str(p['editors_note']), color: kBlue),
        if (_notice != null) NoteBanner(_notice!, color: kGreen),
        for (final g in groups)
          if (specs.any((s) => s['group'] == g['key']))
            DetailSection(str(g['label']), children: [
              for (final s in specs.where((s) => s['group'] == g['key']))
                Builder(builder: (_) {
                  final type = str(s['type']);
                  final m = asMap(meta[s['key']]);
                  final editable = canEdit && s['locked'] != true && _editableType(type);
                  return LineItem(
                    title: str(s['label']),
                    subtitle: [
                      _display(s, values[s['key']]),
                      if (str(s['help']).isNotEmpty) str(s['help']),
                      if (m?['updated_by_name'] != null) 'Changed by ${m!['updated_by_name']} · ${fmtDateTime(m['updated_at'])}',
                      if (canEdit && !_editableType(type)) 'People pickers are changed on the portal.',
                    ].join('\n'),
                    badges: [if (s['locked'] == true) const Pill('Locked', kGrey), if (isDefault[s['key']] == false) const Pill('Changed', kBlue)],
                    trailing: [
                      if (editable) const Icon(Icons.edit_outlined, size: 18, color: Brand.muted),
                      if (canEdit && isDefault[s['key']] == false && s['locked'] != true)
                        TextButton(onPressed: () => _reset(s), child: const Text('Reset')),
                    ],
                    onTap: editable ? () => _edit(s) : null,
                  );
                }),
            ]),
      ],
    );
  }
}
