import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';

/// Organization › Delegations - copy of
/// frontend/src/app/dashboard/organization/delegations/page.tsx and
/// components/organization/DelegationForm.tsx (forOthers).
class OrgDelegationsTab extends StatefulWidget {
  const OrgDelegationsTab({super.key});

  @override
  State<OrgDelegationsTab> createState() => _OrgDelegationsTabState();
}

const _stateColor = {
  'active': Color(0xFF16A34A),
  'upcoming': Color(0xFF2563EB),
  'ended': Color(0xFF78716C),
};

class _OrgDelegationsTabState extends State<OrgDelegationsTab> {
  List<Json>? _rows;
  Object? _error;
  bool _showEnded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await Api.list('/organization/delegations');
      if (mounted) {
        setState(() {
          _rows = p.rows;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _new() async {
    List<Json> types = const [];
    try {
      types = (await Api.list('/approvals/types')).rows;
    } catch (_) {}
    if (!mounted) return;
    final today = DateTime.now();
    int? delegator;
    String? delegatorName;
    int? delegate;
    String? delegateName;
    DateTime? start = DateTime(today.year, today.month, today.day);
    DateTime? end = start;
    String scope = '';
    final reason = TextEditingController();
    final modules = <String, String>{};
    for (final t in types) {
      modules[str(t['module_key'])] = str(t['module_label']);
    }
    final scopeOptions = <Option<String>>[
      const Option('', 'All approvals'),
      for (final m in modules.entries) Option('m:${m.key}', '${m.value} — all'),
      for (final t in types) Option('w:${str(t['key'])}', '${str(t['module_label'])} — ${str(t['label'])}'),
    ];
    final saved = await showFormSheet(context, title: 'New delegation', saveLabel: 'Add delegation',
        builder: (ctx, setS) => [
              const Text('Someone else decides a person’s approvals while they are away',
                  style: TextStyle(fontSize: 12.5, color: Brand.muted)),
              const Caps('Who'),
              AppSelect<int>(
                label: 'Whose approvals',
                required: true,
                value: delegator,
                valueLabel: delegatorName,
                loadOptions: loadUserOptions,
                onChanged: (o) => setS(() {
                  delegator = o?.value;
                  delegatorName = o?.label;
                }),
              ),
              AppSelect<int>(
                label: 'Approved by (delegate)',
                required: true,
                value: delegate,
                valueLabel: delegateName,
                loadOptions: loadUserOptions,
                onChanged: (o) => setS(() {
                  delegate = o?.value;
                  delegateName = o?.label;
                }),
              ),
              const Text("The delegate still needs the module's Approve permission where the workflow requires it.",
                  style: TextStyle(fontSize: 12, color: Brand.muted)),
              const Caps('When and for what'),
              DateField(label: 'From', required: true, value: start, onChanged: (d) => setS(() => start = d)),
              DateField(label: 'To', required: true, value: end, onChanged: (d) => setS(() => end = d)),
              AppSelect<String>(
                label: 'For',
                value: scope,
                clearable: false,
                options: scopeOptions,
                onChanged: (o) => setS(() => scope = o?.value ?? ''),
              ),
              AppTextField(label: 'Reason', controller: reason, hint: 'e.g. On leave'),
            ], onSave: () async {
      if (delegator == null) throw 'Pick whose approvals are being delegated.';
      if (delegate == null) throw 'Pick the delegate.';
      requireField(start, 'From');
      requireField(end, 'To');
      await Api.post('/organization/delegations', data: {
        'delegator_id': delegator,
        'delegate_id': delegate,
        'start_date': apiDate(start!),
        'end_date': apiDate(end!),
        if (scope.startsWith('m:')) 'module_key': scope.substring(2),
        if (scope.startsWith('w:')) 'workflow_key': scope.substring(2),
        'reason': reason.text.trim(),
      });
    });
    if (saved) _load();
  }

  Future<void> _end(Json d) async {
    final ok = await confirmDialog(context,
        title: 'End this delegation now?',
        message: '${str(d['delegate_name'])} stops deciding approvals for ${str(d['delegator_name'])}.',
        confirmLabel: 'End now',
        danger: true);
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.post('/organization/delegations/${d['id']}/end'),
        success: 'Delegation ended.')) {
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    final visible = (rows ?? const <Json>[]).where((r) => _showEnded || r['state'] != 'ended').toList();
    final canCreate = orgCan('delegations', 'create');
    final canEdit = orgCan('delegations', 'edit');
    final header = <Widget>[
      const PageHeader('Delegations',
          subtitle: 'While a delegation is active, the delegate can decide every approval addressed to the person who is '
              'away (all modules, one module, or one document type). Decisions show “as delegate” in the approval history.'),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: CheckboxListTile(
          dense: true,
          controlAffinity: ListTileControlAffinity.leading,
          title: Text('Show ended  ·  ${visible.length} shown', style: const TextStyle(fontSize: 13)),
          value: _showEnded,
          onChanged: (v) => setState(() => _showEnded = v ?? false),
        ),
      ),
    ];
    Widget list;
    if (rows == null) {
      list = ListView(children: [
        ...header,
        _error != null
            ? ErrorView('Could not load delegations: ${ApiClient.describe(_error!)}', onRetry: _load)
            : const LoadingView(),
      ]);
    } else {
      list = ListView(
        padding: const EdgeInsets.only(bottom: 88),
        children: [
          ...header,
          if (visible.isEmpty) const EmptyView('No delegations.'),
          for (final d in visible)
            RecordCard(
              title: '${str(d['delegator_name'])} → ${str(d['delegate_name'])}',
              subtitle: str(d['workflow_label']).isNotEmpty
                  ? str(d['workflow_label'])
                  : (str(d['module_label']).isNotEmpty ? '${str(d['module_label'])} (all)' : 'All approvals'),
              trailing: Padding(
                padding: const EdgeInsets.only(left: 8),
                child: StatusBadge(d['state'], color: _stateColor[d['state']]),
              ),
              meta: [
                ('Away', txt(d['delegator_name'])),
                ('Delegate', txt(d['delegate_name'])),
                ('From', fmtDate(d['start_date'])),
                ('To', fmtDate(d['end_date'])),
                ('Reason', txt(d['reason'])),
              ],
              onTap: d['state'] != 'ended' && canEdit ? () => _end(d) : null,
            ),
          if (visible.any((d) => d['state'] != 'ended') && canEdit)
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text('Tap an active or upcoming delegation to end it now.',
                  style: TextStyle(fontSize: 12, color: Brand.muted)),
            ),
        ],
      );
    }
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: canCreate
          ? FloatingActionButton.extended(
              heroTag: 'org-delegation-new',
              backgroundColor: Brand.primary,
              foregroundColor: Colors.white,
              onPressed: _new,
              icon: const Icon(Icons.add_rounded),
              label: const Text('New delegation'),
            )
          : null,
      body: RefreshIndicator(onRefresh: _load, child: list),
    );
  }
}
