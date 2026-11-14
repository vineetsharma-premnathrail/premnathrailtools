import 'dart:convert';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'p2p_common.dart';

// Procurement settings (portal app/dashboard/p2p/settings: ModuleSettingsPage +
// ApprovalFlowCard + PurposeRulesCard). Opened from the gear next to the bell.

class P2pSettingsScreen extends StatefulWidget {
  const P2pSettingsScreen({super.key});

  @override
  State<P2pSettingsScreen> createState() => _P2pSettingsScreenState();
}

class _P2pSettingsScreenState extends State<P2pSettingsScreen> {
  Json? _settings;
  Json? _flow;
  Json? _rules;
  bool _rulesNoAccess = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = asJson(await Api.get('/p2p/settings'));
      if (mounted) setState(() => _settings = s);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
    Api.get('/p2p/approval-flow').then((f) {
      if (mounted) setState(() => _flow = asJson(f));
    }).catchError((_) {});
    _loadRules();
  }

  Future<void> _loadRules() async {
    try {
      final r = asJson(await Api.get('/p2p/purpose-rules'));
      if (mounted) setState(() => _rules = r);
    } catch (e) {
      if (mounted) setState(() => _rulesNoAccess = true);
    }
  }

  String _display(Json spec, Object? v) {
    final type = jStr(spec, 'type');
    if (v == null || (v is String && v.isEmpty) || (v is List && v.isEmpty)) return '—';
    if (type == 'bool') return v == true ? 'Yes' : 'No';
    final opts = jList(spec, 'options');
    String label(Object? x) => jStr(opts.where((o) => '${o['value']}' == '$x').firstOrNull, 'label') ?? '$x';
    if (type == 'select') return label(v);
    if (type == 'multi_select' || type == 'json_list' || type == 'users') return (v as List).map(label).join(', ');
    if (type == 'json') return jsonEncode(v);
    return '$v';
  }

  Future<void> _edit(Json spec) async {
    final s = _settings!;
    final key = jStr(spec, 'key')!;
    final type = jStr(spec, 'type') ?? 'text';
    final cur = asJson(s['values'])[key];
    final opts = [for (final o in jList(spec, 'options')) Option('${o['value']}', jStr(o, 'label') ?? '${o['value']}')];
    final text = TextEditingController(
        text: type == 'json_list'
            ? (cur is List ? cur.join(', ') : '')
            : type == 'json'
                ? const JsonEncoder.withIndent('  ').convert(cur)
                : (cur == null ? '' : '$cur'));
    var boolV = cur == true;
    String? selV = cur?.toString();
    var multi = cur is List ? cur.map((e) => '$e').toList() : <String>[];
    int? userV = cur is int ? cur : int.tryParse('${cur ?? ''}');
    String? userLabel;
    var users = cur is List ? cur.whereType<int>().toList() : <int>[];
    final userNames = <int, String>{};
    final isDefault = asJson(s['is_default'])[key] == true;
    final ok = await showFormSheet(
      context,
      title: jStr(spec, 'label') ?? key,
      builder: (ctx, setS) => [
        if (jStr(spec, 'help') != null) Hint(spec['help']),
        if (type == 'bool')
          CheckField(label: jStr(spec, 'label') ?? key, value: boolV, onChanged: (v) => setS(() => boolV = v))
        else if (type == 'select')
          AppSelect<String>(label: jStr(spec, 'label') ?? key, value: selV, options: opts, onChanged: (o) => setS(() => selV = o?.value))
        else if (type == 'multi_select')
          CheckList<String>(options: opts, values: multi, onChanged: (v) => setS(() => multi = v))
        else if (type == 'user')
          AppSelect<int>(
            label: jStr(spec, 'label') ?? key,
            required: spec['required'] == true,
            value: userV,
            valueLabel: userLabel ?? (userV == null ? null : 'User #$userV'),
            loadOptions: directoryOptions,
            onChanged: (o) => setS(() {
              userV = o?.value;
              userLabel = o?.label;
            }),
          )
        else if (type == 'users') ...[
          AppSelect<int>(
            label: 'Add a person',
            value: null,
            loadOptions: directoryOptions,
            onChanged: (o) => setS(() {
              if (o != null && !users.contains(o.value)) {
                users.add(o.value);
                userNames[o.value] = o.label;
              }
            }),
          ),
          for (final u in users)
            Row(children: [
              Expanded(child: Text(userNames[u] ?? 'User #$u')),
              IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => setS(() => users.remove(u))),
            ]),
        ] else
          AppTextField(
            label: jStr(spec, 'label') ?? key,
            controller: text,
            maxLines: type == 'longtext' || type == 'json' ? 6 : 1,
            keyboardType: type == 'int' || type == 'decimal' ? AppTextField.number : null,
            hint: type == 'json_list' ? 'Separate values with commas' : null,
          ),
        if (!isDefault)
          Align(
            alignment: Alignment.centerLeft,
            child: linkBtn('Reset to default', () async {
              Navigator.of(ctx).pop(false);
              final yes = await confirmDialog(context,
                  title: 'Reset to default?', message: '${spec['label']} goes back to the standard value.', confirmLabel: 'Reset');
              if (!yes || !mounted) return;
              try {
                final r = asJson(await Api.post('/p2p/settings/reset/$key'));
                if (mounted) setState(() => _settings = r);
              } catch (e) {
                if (mounted) showSnack(context, ApiClient.describe(e), error: true);
              }
            }, color: Brand.danger),
          ),
      ],
      onSave: () async {
        Object? value;
        final label = jStr(spec, 'label') ?? key;
        switch (type) {
          case 'bool':
            value = boolV;
          case 'select':
            value = selV;
          case 'multi_select':
            value = multi;
          case 'user':
            if (spec['required'] == true && userV == null) throw '$label is required — pick a person.';
            value = userV;
          case 'users':
            value = users;
          case 'int':
          case 'decimal':
            final t = text.text.trim();
            if (t.isEmpty) {
              value = null;
            } else {
              final n = num.tryParse(t);
              if (n == null) throw '$label must be a number.';
              if (type == 'int' && n != n.roundToDouble()) throw '$label must be a whole number — remove the decimal part.';
              final mn = toDouble(spec['min']);
              final mx = toDouble(spec['max']);
              if (mn != null && n < mn) throw '$label must be at least ${fmtNumber(mn)}.';
              if (mx != null && n > mx) throw '$label must be at most ${fmtNumber(mx)}.';
              value = type == 'int' ? n.toInt() : n;
            }
          case 'json_list':
            value = text.text.split(',').map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
          case 'json':
            try {
              value = jsonDecode(text.text);
            } catch (_) {
              throw '$label is not valid JSON — check the brackets and quotes.';
            }
          default:
            value = text.text;
        }
        final r = asJson(await Api.put('/p2p/settings', data: {
          'values': {key: value},
        }));
        if (mounted) setState(() => _settings = r);
      },
    );
    if (ok && mounted) showSnack(context, 'Saved.');
  }

  Future<void> _editRule(Json row) async {
    final data = _rules!;
    final canEdit = data['can_edit'] == true;
    final opts = asJson(data['options']);
    final r = asJson(row['rules']);
    var cats = jStrings(r, 'categories');
    String? defCat = jStr(r, 'default_category');
    var lockCat = r['lock_category'] == true;
    var reqs = jStrings(r, 'requirement_types');
    String? defReq = jStr(r, 'default_requirement_type');
    var lockReq = r['lock_requirement_type'] == true;
    var types = jStrings(r, 'item_types');
    var charged = jStrings(r, 'charged_to_kinds');
    var chargedReq = r['charged_required'] == true;
    var mode = jStr(r, 'line_project_mode') ?? 'inherit';
    List<Option<String>> o(String k) => [for (final x in jList(opts, k)) Option('${x['value']}', jStr(x, 'label') ?? '${x['value']}')];
    final chargedOpts = [for (final x in jList(row, 'charged_to_options')) Option('${x['value']}', jStr(x, 'label') ?? '${x['value']}')];
    final ok = await showFormSheet(
      context,
      title: '${row['label']} — rules',
      saveLabel: canEdit ? 'Save rules' : 'Close',
      builder: (ctx, setS) => [
        Hint(canEdit ? 'What the requisition form offers, fills in and locks for this purpose.' : "View only — you can't change these rules."),
        const FormHeading('Category (what is bought)'),
        CheckList<String>(options: o('categories'), values: cats, onChanged: canEdit ? (v) => setS(() {
              cats = v;
              if (!cats.contains(defCat)) defCat = null;
            }) : (_) {}),
        AppSelect<String>(
          label: 'Default category',
          enabled: canEdit,
          value: defCat,
          options: o('categories').where((x) => cats.contains(x.value)).toList(),
          onChanged: (x) => setS(() => defCat = x?.value),
        ),
        CheckField(label: 'Lock the category', value: lockCat, onChanged: (v) => canEdit ? setS(() => lockCat = v) : null),
        const Hint("With one category the form fills it in and locks it. With several, lock fixes the default and the requester can't change it."),
        const FormHeading('Requirement type'),
        CheckList<String>(options: o('requirement_types'), values: reqs, onChanged: canEdit ? (v) => setS(() {
              reqs = v;
              if (!reqs.contains(defReq)) defReq = null;
            }) : (_) {}),
        AppSelect<String>(
          label: 'Default requirement type',
          enabled: canEdit,
          value: defReq,
          options: o('requirement_types').where((x) => reqs.contains(x.value)).toList(),
          onChanged: (x) => setS(() => defReq = x?.value),
        ),
        CheckField(label: 'Lock the requirement type', value: lockReq, onChanged: (v) => canEdit ? setS(() => lockReq = v) : null),
        const FormHeading('Items and charge'),
        const Caps('Item types that can be bought *'),
        CheckList<String>(options: o('item_types'), values: types, onChanged: canEdit ? (v) => setS(() => types = v) : (_) {}),
        const Hint('Items of other standard types are refused. Items with no type, or a type Store added, are never judged.'),
        if (chargedOpts.isNotEmpty) ...[
          const Caps('Charged To — what it can be charged to'),
          CheckList<String>(options: chargedOpts, values: charged, onChanged: canEdit ? (v) => setS(() => charged = v) : (_) {}),
          CheckField(label: 'Charged To is required', value: chargedReq, onChanged: (v) => canEdit ? setS(() => chargedReq = v) : null),
        ] else
          const Hint('A store stock refill is never charged when it is bought — its cost goes to whoever Store issues it to.'),
        AppSelect<String>(
          label: 'Project on the lines',
          enabled: canEdit,
          clearable: false,
          value: mode,
          options: o('line_project_modes'),
          onChanged: (x) => setS(() => mode = x?.value ?? mode),
        ),
        const Hint('Lines never pick a vehicle or Project / Inhouse: either the whole requisition is for the project named on the header, or every line is Inhouse (no project).'),
        if (canEdit && row['is_default'] != true)
          Align(
            alignment: Alignment.centerLeft,
            child: linkBtn('Reset to default', () async {
              Navigator.of(ctx).pop(false);
              final yes = await confirmDialog(context,
                  title: 'Reset to default?',
                  message: '${row['label']} goes back to the standard rules of the portal. Requisitions already raised are not affected.',
                  confirmLabel: 'Reset to default',
                  danger: true);
              if (!yes || !mounted) return;
              try {
                final res = asJson(await Api.post('/p2p/purpose-rules/${row['code']}/reset'));
                if (mounted) setState(() => _rules = res);
              } catch (e) {
                if (mounted) showSnack(context, ApiClient.describe(e), error: true);
              }
            }, color: Brand.danger),
          ),
      ],
      onSave: () async {
        if (!canEdit) return;
        final res = asJson(await Api.put('/p2p/purpose-rules/${row['code']}', data: {
          'rules': {
            'categories': cats,
            'default_category': defCat,
            'lock_category': lockCat,
            'requirement_types': reqs,
            'default_requirement_type': defReq,
            'lock_requirement_type': lockReq,
            'item_types': types,
            'charged_to_kinds': charged,
            'charged_required': chargedReq,
            'line_project_mode': mode,
          },
        }));
        if (mounted) setState(() => _rules = res);
      },
    );
    if (ok && canEdit && mounted) showSnack(context, 'Purpose rules saved.');
  }

  List<Widget> _flowSteps() {
    final f = _flow;
    if (f == null) return const [Hint('…')];
    final out = <Widget>[];
    for (final (label, key) in const [('Purchase requisitions', 'pr'), ('Purchase orders', 'po')]) {
      final wf = asJson(f[key]);
      if (wf['is_active'] != true) {
        out.add(InnerCard(children: [Text('$label: approval', style: const TextStyle(fontWeight: FontWeight.w700)), const Text('Workflow switched off — approved automatically')]));
        continue;
      }
      final stages = jList(wf, 'stages');
      for (final s in stages) {
        final warn = jStr(s, 'problem') != null && s['skipped'] != true;
        final approvers = jList(s, 'approvers');
        final who = warn
            ? '${s['problem']}'
            : approvers.isEmpty
                ? 'Skipped — nobody to approve'
                : approvers.map((a) => jStr(a, 'name') ?? 'User #${a['id']}').join(', ');
        out.add(InnerCard(color: warn ? Brand.dangerSoft : null, children: [
          Text('$label: ${jStr(s, 'approval_mode') == 'all' ? 'all of these must approve' : 'any one of these approves'}${stages.length > 1 ? ' (${s['name']})' : ''}',
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
          Text(who, style: TextStyle(color: warn ? Brand.danger : Brand.body)),
        ]));
      }
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final s = _settings;
    if (s == null) return SubPage(title: 'Procurement settings', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    final specs = jList(s, 'specs');
    final values = asJson(s['values']);
    final meta = asJson(s['meta']);
    final isDefault = asJson(s['is_default']);
    final canEdit = s['can_edit'] == true;
    final groups = jList(s, 'groups');
    final rules = _rules;
    String typeList(List<String> t) => t.map(typeLabel).join(', ');
    return SubPage(
      title: 'Procurement settings',
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          if (!canEdit && jStr(s, 'editors_note') != null)
            Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: NoteBox('${s['editors_note']}')),
          DetailSection('Who approves', children: [
            ..._flowSteps(),
            const Hint('Approvers are set in Organization › Approval Workflows ("Purchase requisition" and "Purchase order"), no longer here. '
                'A requisition or PO already in approval keeps the approvers it started with.'),
          ]),
          if (!_rulesNoAccess)
            DetailSection('Purpose rules', children: [
              Hint('What the Purchase Requisition form offers for each purpose. A field with only one option is filled in and shown as Fixed. '
                  '"Changed" marks a purpose whose rules were edited.${rules != null && rules['can_edit'] != true ? ' ${rules['editors_note'] ?? ''}' : ''}'),
              const SizedBox(height: 8),
              if (rules == null) const Hint('Loading…'),
              for (final p in jList(rules, 'purposes'))
                InkWell(
                  onTap: () => _editRule(p),
                  child: InnerCard(children: [
                    Row(children: [
                      Expanded(child: Text('${p['label']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                      if (p['is_default'] != true) const Pill('Changed', Color(0xFF2563EB)),
                      const Icon(Icons.chevron_right_rounded, color: Brand.muted),
                    ]),
                    MiniGrid([
                      MiniField('Item types', typeList(jStrings(asJson(p['rules']), 'item_types'))),
                      MiniField(
                          'Charged to',
                          jStrings(asJson(p['rules']), 'charged_to_kinds').isEmpty
                              ? 'Not charged'
                              : '${jStrings(asJson(p['rules']), 'charged_to_kinds').map((k) => jStr(jList(p, 'charged_to_options').where((o) => o['value'] == k).firstOrNull, 'label') ?? k).join(', ')}'
                                  ' (${asJson(p['rules'])['charged_required'] == true ? 'required' : 'optional'})'),
                      MiniField('Project on lines', jStr(asJson(p['rules']), 'line_project_mode') == 'inhouse' ? 'Inhouse' : 'Project'),
                    ]),
                  ]),
                ),
            ]),
          for (final g in groups.isEmpty ? [<String, dynamic>{'key': null, 'label': 'Settings'}] : groups)
            Builder(builder: (_) {
              final gs = specs.where((sp) => g['key'] == null || sp['group'] == g['key']).toList();
              if (gs.isEmpty) return const SizedBox.shrink();
              return DetailSection(jStr(g, 'label') ?? '', children: [
                for (final sp in gs)
                  InkWell(
                    onTap: canEdit && sp['locked'] != true ? () => _edit(sp) : null,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(children: [
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(jStr(sp, 'label') ?? '', style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                            Text(_display(sp, values[sp['key']])),
                            if (jStr(sp, 'help') != null) Hint('${sp['help']}'),
                            if (isDefault[sp['key']] != true && meta[sp['key']] is Map)
                              Hint('Changed by ${asJson(meta[sp['key']])['updated_by_name'] ?? '—'} · ${fmtDateTime(asJson(meta[sp['key']])['updated_at'])}'),
                          ]),
                        ),
                        if (sp['locked'] == true) const Icon(Icons.lock_outline_rounded, size: 18, color: Brand.muted),
                        if (canEdit && sp['locked'] != true) const Icon(Icons.edit_outlined, size: 18, color: Brand.muted),
                      ]),
                    ),
                  ),
              ]);
            }),
        ]),
      ),
    );
  }
}