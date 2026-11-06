import 'dart:convert';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'crm_common.dart';

// ── Reports (crm/reports → ModuleDashboardPage module="crm") ──────────────────

class CrmReportsTab extends StatelessWidget {
  const CrmReportsTab({super.key});

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      load: () async => Map<String, dynamic>.from(await Api.get('/reports/crm') as Map),
      builder: (ctx, cat, reload) {
        final reports = jsonList(cat['reports'])..sort((a, b) => (asInt(a['order']) ?? 0).compareTo(asInt(b['order']) ?? 0));
        final sections = <String, List<Json>>{};
        for (final r in reports) {
          sections.putIfAbsent(str(r['section']).isEmpty ? 'Reports' : str(r['section']), () => []).add(r);
        }
        return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
          const PageHeader('Reports', subtitle: 'How many leads came in, from where and for which products'),
          if (reports.isEmpty) const EmptyView('No reports are available to your role yet.'),
          for (final s in sections.entries)
            DetailSection(s.key, children: [
              for (final r in s.value)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(str(r['label']), style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: str(r['description']).isEmpty ? null : Text(str(r['description'])),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => openScreen(ctx, ReportScreen(catalogue: cat, report: r)),
                ),
            ]),
        ]);
      },
    );
  }
}

class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key, required this.catalogue, required this.report});
  final Json catalogue;
  final Json report;

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  late final Json _defaults = widget.report['defaults'] is Map ? Map<String, dynamic>.from(widget.report['defaults'] as Map) : {};
  late String _preset = str(_defaults['preset']);
  late String? _groupBy = _defaults['group_by'] as String?;
  Json? _result;
  Object? _error;

  Json? get _dataset => jsonList(widget.catalogue['datasets']).where((d) => d['key'] == widget.report['dataset']).firstOrNull;

  @override
  void initState() {
    super.initState();
    _run();
  }

  Map<String, dynamic> _params({String level = 'summary'}) {
    final dateField = str(_defaults['date_field']).isNotEmpty ? str(_defaults['date_field']) : str(_dataset?['default_date_field']);
    final p = <String, dynamic>{'level': level, if (dateField.isNotEmpty) 'date_field': dateField};
    if (dateField != 'none' && _preset.isNotEmpty) p['preset'] = _preset;
    final f = _defaults['filters'];
    if (f is Map) {
      f.forEach((k, v) {
        if (str(v).isNotEmpty) p['f_$k'] = v;
      });
    }
    if (level == 'summary') {
      if (_groupBy != null && _groupBy!.isNotEmpty) p['group_by'] = _groupBy;
      if (str(_defaults['group_by2']).isNotEmpty && _groupBy != null) p['group_by2'] = _defaults['group_by2'];
      final m = strList(_defaults['measures']);
      if (m.isNotEmpty) p['measures'] = m.join(',');
    }
    return p;
  }

  Future<void> _run() async {
    setState(() => _error = null);
    try {
      final r = await Api.get('/reports/crm/${widget.report['key']}', query: _params());
      if (mounted) setState(() => _result = r is Map ? Map<String, dynamic>.from(r) : {});
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  String _fmt(Object? v, String type) {
    if (v == null) return '—';
    return switch (type) {
      'money' => money(v),
      'percent' => '${fmtNumber(v)}%',
      'date' => fmtDate(v),
      'datetime' => fmtDateTime(v),
      'int' || 'decimal' || 'hours' || 'days' => fmtNumber(v),
      _ => str(v),
    };
  }

  @override
  Widget build(BuildContext context) {
    final r = _result;
    final presets = jsonList(widget.catalogue['presets']);
    final groupBys = jsonList(widget.report['group_bys']);
    final canExport = widget.catalogue['can_export'] == true && CrmPerm.can('reports', 'export');
    final measures = jsonList(r?['measures']);
    final period = r?['period'] is Map ? str((r!['period'] as Map)['label']) : '';
    return SubPage(
      title: str(widget.report['label']),
      body: RefreshIndicator(
        onRefresh: _run,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Column(children: [
              if (presets.isNotEmpty)
                AppSelect<String>(
                  label: 'Period',
                  value: _preset.isEmpty ? null : _preset,
                  options: [for (final p in presets) Option(str(p['key']), str(p['label']))],
                  onChanged: (o) {
                    setState(() => _preset = o?.value ?? '');
                    _run();
                  },
                ),
              if (groupBys.isNotEmpty) ...[
                const SizedBox(height: 10),
                AppSelect<String>(
                  label: 'Group by',
                  value: _groupBy,
                  options: [for (final g in groupBys) Option(str(g['key']), str(g['label']))],
                  onChanged: (o) {
                    setState(() => _groupBy = o?.value);
                    _run();
                  },
                ),
              ],
            ]),
          ),
          if (_error != null) ErrorView(crmError(_error!), onRetry: _run),
          if (r == null && _error == null) const LoadingView(),
          if (r != null) ...[
            if (period.isNotEmpty) Note(period, padding: const EdgeInsets.fromLTRB(16, 0, 16, 8)),
            if (jsonList(r['kpis']).isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Wrap(spacing: 10, runSpacing: 10, children: [
                  for (final k in jsonList(r['kpis']))
                    SizedBox(
                      width: (MediaQuery.of(context).size.width - 42) / 2,
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Caps(str(k['label'])),
                            const SizedBox(height: 4),
                            Text(_fmt(k['value'], str(k['type'])),
                                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Brand.heading)),
                            if (k['delta_pct'] != null) Note('${(asNum(k['delta_pct']) ?? 0) >= 0 ? '▲' : '▼'} ${fmtNumber(k['delta_pct'])}%'),
                          ]),
                        ),
                      ),
                    ),
                ]),
              ),
            for (final s in jsonList(r['series'])) _series(s),
            if (jsonList(r['rows']).isNotEmpty)
              DetailSection(str(r['group_label']).isEmpty ? 'Summary' : str(r['group_label']), children: [
                for (final row in jsonList(r['rows']))
                  FieldRow(
                    row['label'] is Map ? (row['label'] as Map).values.map(str).join(' · ') : str(row['label']),
                    measures.map((m) {
                      final v = row['values'] is Map ? (row['values'] as Map)[m['key']] : null;
                      return '${str(m['label'])}: ${_fmt(v, str(m['type']))}';
                    }).join('\n'),
                  ),
                if (r['totals'] is Map)
                  FieldRow(
                      'Total',
                      measures
                          .map((m) => '${str(m['label'])}: ${_fmt(((r['totals'] as Map)['values'] as Map?)?[m['key']], str(m['type']))}')
                          .join('\n')),
              ]),
            for (final n in strList(r['notes'])) Note(n, padding: const EdgeInsets.fromLTRB(16, 0, 16, 6)),
          ],
        ]),
      ),
      bottom: canExport
          ? actionBar([
              secondaryBtn(
                  'Export Excel',
                  () => openApiFile(context, '/reports/crm/${widget.report['key']}/export',
                      '${str(widget.report['label']).replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_')}.xlsx',
                      query: {..._params(level: 'detail'), 'sheets': 'detail'})),
            ])
          : null,
    );
  }

  Widget _series(Json s) {
    final labels = strList(s['labels']);
    final ds = jsonList(s['datasets']);
    if (labels.isEmpty || ds.isEmpty) return const SizedBox.shrink();
    double maxV = 0;
    for (final d in ds) {
      for (final v in (d['data'] is List ? d['data'] as List : const [])) {
        final n = (asNum(v) ?? 0).toDouble();
        if (n > maxV) maxV = n;
      }
    }
    const palette = [Color(0xFFFF7A45), Color(0xFF3B82F6), Color(0xFF16A34A), Color(0xFF8B5CF6), Color(0xFFEAB308)];
    return DetailSection(str(s['label']), children: [
      for (var i = 0; i < labels.length; i++)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(labels[i], style: const TextStyle(fontSize: 12.5, color: Brand.body)),
            for (var j = 0; j < ds.length; j++) _bar(ds, i, j, maxV, palette[j % palette.length]),
          ]),
        ),
    ]);
  }

  Widget _bar(List<Json> ds, int i, int j, double maxV, Color color) {
    final data = ds[j]['data'] is List ? ds[j]['data'] as List : const [];
    final v = i < data.length ? (asNum(data[i]) ?? 0).toDouble() : 0.0;
    return Row(children: [
      Expanded(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: maxV == 0 ? 0 : v / maxV, minHeight: 10, backgroundColor: Brand.background, color: color),
        ),
      ),
      const SizedBox(width: 8),
      SizedBox(
          width: 100,
          child: Text('${ds.length > 1 ? '${str(ds[j]['label'])}: ' : ''}${fmtNumber(v)}',
              textAlign: TextAlign.right, style: const TextStyle(fontSize: 12))),
    ]);
  }
}

// ── Settings (crm/settings → ModuleSettingsPage + CrmListsSection) ────────────

class CrmSettingsScreen extends StatefulWidget {
  const CrmSettingsScreen({super.key});

  @override
  State<CrmSettingsScreen> createState() => _CrmSettingsScreenState();
}

class _CrmSettingsScreenState extends State<CrmSettingsScreen> {
  int _section = 0;

  @override
  Widget build(BuildContext context) {
    const sections = ['Payment Terms', 'Document Categories', 'Settings'];
    return SubPage(
      title: 'CRM settings',
      body: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SubTabs(tabs: sections, index: _section, onChanged: (i) => setState(() => _section = i)),
        Expanded(
          child: KeyedSubtree(
            key: ValueKey(_section),
            child: switch (_section) {
              0 => const _ListManager(
                  path: '/crm/payment-terms',
                  noun: 'payment term',
                  intro: 'Payment terms offered in quotations. Add, edit or remove entries any time — changes show up in the forms straight away.',
                  withDescription: true),
              1 => const _ListManager(
                  path: '/crm/document-categories',
                  noun: 'document category',
                  intro: 'Categories offered when uploading documents to inquiries and tenders.',
                  withDescription: false),
              _ => const _SettingsFramework(),
            },
          ),
        ),
      ]),
    );
  }
}

class _ListManager extends StatefulWidget {
  const _ListManager({required this.path, required this.noun, required this.intro, required this.withDescription});
  final String path;
  final String noun;
  final String intro;
  final bool withDescription;

  @override
  State<_ListManager> createState() => _ListManagerState();
}

class _ListManagerState extends State<_ListManager> {
  final _list = GlobalKey<ApiListViewState>();
  bool get _canEdit => CrmPerm.can('settings', 'edit');

  Future<void> _form([Json? row]) async {
    final label = TextEditingController(text: str(row?['label']));
    final desc = TextEditingController(text: str(row?['description']));
    final ok = await showFormSheet(
      context,
      title: row == null ? 'Add ${widget.noun}' : 'Edit ${widget.noun}',
      builder: (ctx, setS) => [
        AppTextField(label: 'Label', required: true, controller: label),
        if (widget.withDescription) AppTextField(label: 'Description', controller: desc, maxLines: 3),
      ],
      onSave: () async {
        requireField(label.text, 'Label');
        final body = {'label': label.text.trim(), if (widget.withDescription) 'description': desc.text.trim()};
        await guard(() => row == null ? Api.post(widget.path, data: body) : Api.patch('${widget.path}/${row['id']}', data: body));
      },
    );
    if (ok) _list.currentState?.reload();
  }

  Future<void> _delete(Json row) async {
    final yes = await confirmDialog(context,
        title: 'Delete ${widget.noun}?', message: 'Delete "${str(row['label'])}"?', confirmLabel: 'Delete', danger: true);
    if (!yes || !mounted) return;
    if (await crmRun(context, () => Api.delete('${widget.path}/${row['id']}'), success: 'Deleted.')) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Brand.background,
      floatingActionButton: _canEdit ? CreateFab(label: 'Add', onPressed: () => _form()) : null,
      body: ApiListView(
        key: _list,
        header: Note(widget.intro, padding: const EdgeInsets.fromLTRB(16, 8, 16, 10)),
        emptyText: 'No ${widget.noun}s yet.',
        load: (p, s) async {
          final rows = (await Api.list(widget.path)).rows..sort((a, b) => str(a['label']).toLowerCase().compareTo(str(b['label']).toLowerCase()));
          return ApiPage(rows);
        },
        itemBuilder: (ctx, row, reload) => RecordCard(
          title: str(row['label']),
          subtitle: widget.withDescription ? str(row['description']) : null,
          trailing: _canEdit
              ? IconButton(tooltip: 'Delete', icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger), onPressed: () => _delete(row))
              : null,
          onTap: _canEdit ? () => _form(row) : null,
        ),
      ),
    );
  }
}

/// Generic module settings (GET/PUT /crm/settings): one row per setting, tap to change.
class _SettingsFramework extends StatefulWidget {
  const _SettingsFramework();

  @override
  State<_SettingsFramework> createState() => _SettingsFrameworkState();
}

class _SettingsFrameworkState extends State<_SettingsFramework> {
  Json? _data;
  Object? _error;
  List<Json> _users = const [];

  @override
  void initState() {
    super.initState();
    _load();
    loadDirectory().then((u) {
      if (mounted) setState(() => _users = u);
    }).catchError((_) {});
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/crm/settings');
      if (mounted) {
        setState(() {
          _data = Map<String, dynamic>.from(d as Map);
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  String _userName(Object? id) => str(_users.where((u) => u['id'] == id).firstOrNull?['name'] ?? (id == null ? '' : '#$id'));

  String _display(Json spec, Object? v) {
    final type = str(spec['type']);
    final options = jsonList(spec['options']);
    String opt(Object? x) => str(options.where((o) => o['value'] == x).firstOrNull?['label'] ?? x);
    if (v == null || (v is String && v.isEmpty) || (v is List && v.isEmpty)) return spec['required'] == true ? 'Required' : '—';
    return switch (type) {
      'bool' => v == true ? 'Yes' : 'No',
      'select' => opt(v),
      'multi_select' => v is List ? v.map(opt).join(', ') : str(v),
      'user' => _userName(v),
      'users' => v is List ? v.map(_userName).join(', ') : str(v),
      'json_list' => v is List ? v.join(', ') : str(v),
      'json' => jsonEncode(v),
      _ => str(v),
    };
  }

  Future<void> _edit(Json spec) async {
    final key = str(spec['key']);
    final type = str(spec['type']);
    Object? value = (_data!['values'] as Map)[key];
    final text = TextEditingController(
        text: type == 'json_list'
            ? (value is List ? value.join(', ') : '')
            : type == 'json'
                ? const JsonEncoder.withIndent('  ').convert(value)
                : (value == null ? '' : str(value)));
    final options = [for (final o in jsonList(spec['options'])) Option<Object>(o['value'] as Object, str(o['label']))];
    final userOptions = [for (final u in _users) if (asInt(u['id']) != null) Option<Object>(asInt(u['id'])!, str(u['name']), subtitle: str(u['email']))];
    List<Object?> listValue() => value is List ? List<Object?>.of(value as List) : <Object?>[];
    final ok = await showFormSheet(
      context,
      title: str(spec['label']),
      builder: (ctx, setS) => [
        if (str(spec['help']).isNotEmpty) Note(str(spec['help'])),
        switch (type) {
          'bool' => CheckField(label: str(spec['label']), value: value == true, onChanged: (v) => setS(() => value = v)),
          'select' => AppSelect<Object>(label: str(spec['label']), value: value, options: options, onChanged: (o) => setS(() => value = o?.value)),
          'user' => AppSelect<Object>(
              label: str(spec['label']),
              required: spec['required'] == true,
              value: value,
              valueLabel: _userName(value),
              options: userOptions,
              onChanged: (o) => setS(() => value = o?.value)),
          'multi_select' || 'users' => Wrap(spacing: 6, runSpacing: 6, children: [
              for (final o in type == 'users' ? userOptions : options)
                FilterChip(
                  label: Text(o.label),
                  selected: listValue().contains(o.value),
                  onSelected: (sel) => setS(() {
                    final l = listValue();
                    sel ? l.add(o.value) : l.remove(o.value);
                    value = l;
                  }),
                ),
            ]),
          _ => AppTextField(
              label: str(spec['label']),
              controller: text,
              maxLines: type == 'longtext' || type == 'json' ? 6 : 1,
              keyboardType: type == 'int' || type == 'decimal' ? AppTextField.number : null,
              hint: type == 'json_list' ? 'Comma-separated values' : null),
        },
      ],
      onSave: () async {
        Object? out = value;
        final t = text.text.trim();
        if (type == 'int' || type == 'decimal') {
          if (t.isEmpty) {
            out = null;
          } else {
            final n = num.tryParse(t);
            if (n == null) throw '${spec['label']} must be a number.';
            if (type == 'int' && n != n.roundToDouble()) throw '${spec['label']} must be a whole number — remove the decimal part.';
            if (spec['min'] != null && n < (asNum(spec['min']) ?? n)) throw '${spec['label']} must be at least ${spec['min']}.';
            if (spec['max'] != null && n > (asNum(spec['max']) ?? n)) throw '${spec['label']} must be at most ${spec['max']}.';
            out = type == 'int' ? n.toInt() : n;
          }
        } else if (type == 'json_list') {
          out = t.split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
        } else if (type == 'json') {
          try {
            out = t.isEmpty ? null : jsonDecode(t);
          } catch (_) {
            throw '${spec['label']} is not valid JSON — check the brackets and quotes.';
          }
        } else if (type == 'text' || type == 'longtext' || type == 'prefix') {
          out = t;
        }
        if (type == 'user' && spec['required'] == true && out == null) throw '${spec['label']} is required — pick a person.';
        await guard(() => Api.put('/crm/settings', data: {
              'values': {key: out}
            }));
      },
    );
    if (ok) _load();
  }

  Future<void> _reset(Json spec) async {
    final yes = await confirmDialog(context, title: 'Reset to default?', message: '${spec['label']} goes back to its default value.', confirmLabel: 'Reset');
    if (!yes || !mounted) return;
    if (await crmRun(context, () => Api.post('/crm/settings/reset/${spec['key']}'), success: 'Reset to default.')) _load();
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) return _error != null ? ErrorView(crmError(_error!), onRetry: _load) : const LoadingView();
    final canEdit = d['can_edit'] == true && CrmPerm.can('settings', 'edit');
    final specs = jsonList(d['specs']);
    final values = d['values'] is Map ? d['values'] as Map : const {};
    final isDefault = d['is_default'] is Map ? d['is_default'] as Map : const {};
    final meta = d['meta'] is Map ? d['meta'] as Map : const {};
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(top: 8, bottom: 24), children: [
        if (!canEdit && str(d['editors_note']).isNotEmpty) Note(str(d['editors_note']), padding: const EdgeInsets.fromLTRB(16, 0, 16, 10)),
        for (final g in jsonList(d['groups']))
          if (specs.any((s) => s['group'] == g['key']))
            DetailSection(str(g['label']), children: [
              for (final s in specs.where((s) => s['group'] == g['key']))
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(str(s['label']), style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text([
                    _display(s, values[s['key']]),
                    if (isDefault[s['key']] == false && meta[s['key']] is Map)
                      'Changed by ${txt((meta[s['key']] as Map)['updated_by_name'])} ${fmtDateTime((meta[s['key']] as Map)['updated_at'])}',
                  ].join('\n')),
                  trailing: canEdit && s['locked'] != true && isDefault[s['key']] == false
                      ? IconButton(tooltip: 'Reset to default', icon: const Icon(Icons.restart_alt_rounded), onPressed: () => _reset(s))
                      : null,
                  onTap: canEdit && s['locked'] != true ? () => _edit(s) : null,
                ),
            ]),
      ]),
    );
  }
}
