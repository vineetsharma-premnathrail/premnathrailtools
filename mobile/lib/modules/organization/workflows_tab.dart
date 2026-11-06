import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';
import 'workflow_editor.dart';

/// Organization › Approval Workflows - native copy of
/// frontend/src/app/dashboard/organization/workflows/page.tsx: every
/// transaction type that needs approval, grouped by module.
class OrgWorkflowsTab extends StatefulWidget {
  const OrgWorkflowsTab({super.key});

  @override
  State<OrgWorkflowsTab> createState() => _OrgWorkflowsTabState();
}

class _OrgWorkflowsTabState extends State<OrgWorkflowsTab> {
  List<Json>? _rows;
  Object? _error;
  String _query = '';
  String _show = 'all';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await Api.list('/organization/workflows');
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

  Future<void> _open(Json r) async {
    await Navigator.of(context)
        .push(MaterialPageRoute<void>(builder: (_) => WorkflowEditorScreen(workflowKey: str(r['key']))));
    _load();
  }

  Map<String, List<Json>> get _groups {
    final q = _query.trim().toLowerCase();
    final out = <String, List<Json>>{};
    for (final r in _rows ?? <Json>[]) {
      final hay = '${str(r['label'])} ${str(r['module_label'])} ${str(r['subtab_label'])}'.toLowerCase();
      if (q.isNotEmpty && !hay.contains(q)) continue;
      if (_show == 'customised' && r['customised'] != true) continue;
      if (_show == 'off' && r['is_active'] != false) continue;
      out.putIfAbsent(str(r['module_label']), () => []).add(r);
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final groups = _groups;
    final children = <Widget>[
      const PageHeader('Approval Workflows',
          subtitle: 'Who approves each kind of document, in what order. The workflow decides who approves; the '
              "approver's role permissions decide whether they are allowed to. Changes apply to documents submitted "
              'after you save — documents already waiting keep the approvers they were sent to.'),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: AppSelect<String>(
          label: 'Show',
          value: _show,
          clearable: false,
          options: const [
            Option('all', 'Show: all'),
            Option('customised', 'Show: customised'),
            Option('off', 'Show: approval off'),
          ],
          onChanged: (o) => setState(() => _show = o?.value ?? 'all'),
        ),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: SearchField(hint: 'Search…', onChanged: (v) => setState(() => _query = v)),
      ),
    ];
    if (_error != null) {
      children.add(Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorView(_error!, onRetry: _load)));
    } else if (_rows == null) {
      children.add(const LoadingView());
    } else if (_rows!.isEmpty) {
      children.add(const EmptyView('No module has registered an approval type yet.'));
    } else if (groups.isEmpty) {
      children.add(const EmptyView(
          'No workflow matches this search and filter. Clear the search or choose "Show: all".'));
    } else {
      for (final e in groups.entries) {
        children.add(DetailSection(e.key, children: [
          for (final r in e.value) _WorkflowRow(r, onTap: () => _open(r)),
        ]));
      }
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 32), children: children),
    );
  }
}

class _WorkflowRow extends StatelessWidget {
  const _WorkflowRow(this.r, {required this.onTap});
  final Json r;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final off = r['is_active'] == false;
    final customised = r['customised'] == true;
    final stages = (r['stage_names'] is List) ? (r['stage_names'] as List).map(str).toList() : <String>[];
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x14000000)))),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(str(r['label']),
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.heading)),
                  Text('${str(r['subtab_label'])} tab', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  const SizedBox(height: 4),
                  Text(
                    off ? 'Approval switched off — documents are approved on submit' : stages.join(' → '),
                    style: TextStyle(fontSize: 12.5, color: off ? Brand.muted : Brand.body),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (off) ...[
                  const StatusBadge('⏻ Off', color: Color(0xFFB45309)),
                  const SizedBox(height: 4),
                ],
                StatusBadge(customised ? 'Custom' : 'Standard',
                    color: customised ? const Color(0xFF7C3AED) : const Color(0xFF57534E)),
              ],
            ),
            const Icon(Icons.chevron_right_rounded, color: Brand.muted),
          ],
        ),
      ),
    );
  }
}
