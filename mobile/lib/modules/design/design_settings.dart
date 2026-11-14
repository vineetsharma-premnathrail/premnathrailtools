import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'design_common.dart';

/// Design Settings (gear next to the bell) - portal design/settings:
/// Design team, Approvals & timing, Change board, ECN acknowledgers.

const _roleColors = {
  'admin': Color(0xFF7C3AED),
  'head': Color(0xFFFF6A2A),
  'reviewer': Color(0xFF2563EB),
  'designer': Color(0xFF16A34A),
  'viewer': Color(0xFF78716C),
};
const _editableRoles = ['head', 'reviewer', 'designer'];

class DesignSettingsScreen extends StatefulWidget {
  const DesignSettingsScreen({super.key});

  @override
  State<DesignSettingsScreen> createState() => _DesignSettingsScreenState();
}

class _DesignSettingsScreenState extends State<DesignSettingsScreen> {
  Json? _s;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = jsonMap(await Api.get('/design/settings'));
      if (mounted) setState(() => (_s = s, _error = null));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _put(Map<String, dynamic> payload) async {
    final out = await Api.put('/design/settings', data: payload);
    if (mounted && out is Map) setState(() => _s = jsonMap(out));
    DesignMe.load(refresh: true);
  }

  /// "Name" for a user id from the settings payload's user dicts.
  String _nameIn(List<Json> rows, int id) {
    for (final r in rows) {
      if (asInt(r['user_id'] ?? r['id']) == id) return str(r['name'] ?? r['label']).isEmpty ? 'User #$id' : str(r['name'] ?? r['label']);
    }
    return 'User #$id';
  }

  Future<void> _editTeam() async {
    final team = <(int?, String?, String)>[
      for (final t in jsonList(_s!['team'])) (asInt(t['user_id']), nullIfEmpty(str(t['name'])), str(t['role'])),
    ];
    final ok = await showFormSheet(context, title: 'Design team', builder: (ctx, setS) => [
          const InfoNote('No team = everyone with the Design app works as a designer and can release; adding the team turns on role checks.'),
          if (team.isEmpty) const Text('No team set up — role checks are off.', style: TextStyle(color: Brand.muted)),
          for (var i = 0; i < team.length; i++)
            Container(
              padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
              decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(10)),
              child: Column(children: [
                AppSelect<int>(
                    label: 'User',
                    required: true,
                    value: team[i].$1,
                    valueLabel: team[i].$2,
                    loadOptions: (s) => designUsers(s),
                    onChanged: (o) => setS(() => team[i] = (o?.value, o?.label, team[i].$3))),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(
                    child: AppSelect<String>(
                        label: 'Role',
                        clearable: false,
                        value: _editableRoles.contains(team[i].$3) ? team[i].$3 : 'designer',
                        options: [for (final r in _editableRoles) Option(r, teamRoleLabels[r]!)],
                        onChanged: (o) => setS(() => team[i] = (team[i].$1, team[i].$2, o?.value ?? team[i].$3))),
                  ),
                  TextButton.icon(
                      style: TextButton.styleFrom(foregroundColor: Brand.danger),
                      onPressed: () => setS(() => team.removeAt(i)),
                      icon: const Icon(Icons.delete_outline_rounded, size: 18),
                      label: const Text('Remove')),
                ]),
              ]),
            ),
          OutlinedButton.icon(
              icon: const Icon(Icons.add_rounded),
              label: const Text('Add member'),
              onPressed: () => setS(() => team.add((null, null, team.isEmpty ? 'head' : 'designer')))),
        ], onSave: () async {
      final rows = team.where((t) => t.$1 != null).toList();
      if (rows.isNotEmpty && !rows.any((r) => r.$3 == 'head')) throw 'The team needs at least one Design head — they release drawings and decide ECRs.';
      final seen = <int>{};
      for (final r in rows) {
        if (!seen.add(r.$1!)) throw '${r.$2 ?? 'A user'} is listed twice in the team.';
      }
      await _put({
        'team': [for (final r in rows) {'user_id': r.$1, 'role': r.$3}],
      });
    });
    if (ok && mounted) {
      final n = jsonList(_s!['team']).length;
      showSnack(context, n > 0 ? 'Design team saved — $n member${n == 1 ? '' : 's'}, role checks on.' : 'Team cleared — everyone with the Design app now works as a designer.');
    }
  }

  Future<void> _editApprovals() async {
    final s = _s!;
    int? approver = asInt(s['default_approver_id']);
    String? approverL = nullIfEmpty(str(s['default_approver_name']));
    final overdue = TextEditingController(text: '${s['review_overdue_days'] ?? ''}');
    final response = TextEditingController(text: '${s['customer_response_days'] ?? ''}');
    final ok = await showFormSheet(context, title: 'Approvals & timing', builder: (ctx, setS) => [
          AppSelect<int>(
              label: 'Default approver (none — the author picks every time)',
              value: approver,
              valueLabel: approverL,
              loadOptions: (q) => designUsers(q),
              onChanged: (o) => setS(() {
                    approver = o?.value;
                    approverL = o?.label;
                  })),
          AppTextField(label: 'Review overdue after (days)', controller: overdue, keyboardType: TextInputType.number),
          AppTextField(label: 'Customer response due (days)', controller: response, keyboardType: TextInputType.number),
        ], onSave: () async {
      final o = int.tryParse(overdue.text.trim());
      final r = int.tryParse(response.text.trim());
      if (o == null || o < 1 || o > 90) throw 'Review overdue days must be a whole number from 1 to 90.';
      if (r == null || r < 1 || r > 365) throw 'Customer response days must be a whole number from 1 to 365.';
      await _put({'default_approver_id': approver, 'review_overdue_days': o, 'customer_response_days': r});
    });
    if (ok && mounted) showSnack(context, 'Approvals & timing saved.');
  }

  /// Edits a list of users (change board / one department's acknowledgers).
  Future<void> _editUsers(String title, List<Json> current, Future<void> Function(List<int>) save, String done, String hint) async {
    final ids = <int, String>{for (final r in current) asInt(r['user_id'] ?? r['id'])!: _nameIn(current, asInt(r['user_id'] ?? r['id'])!)};
    final ok = await showFormSheet(context, title: title, builder: (ctx, setS) => [
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final e in ids.entries) InputChip(label: Text(e.value), onDeleted: () => setS(() => ids.remove(e.key))),
          ]),
          AppSelect<int>(
            key: ValueKey(ids.length),
            label: hint,
            value: null,
            loadOptions: (q) async => (await designUsers(q)).where((o) => !ids.containsKey(o.value)).toList(),
            onChanged: (o) {
              if (o != null) setS(() => ids[o.value] = o.label);
            },
          ),
        ], onSave: () => save(ids.keys.toList()));
    if (ok && mounted) showSnack(context, done);
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    return SubPage(
      title: 'Design Settings',
      body: s == null ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView()) : RefreshIndicator(onRefresh: _load, child: _body(s)),
    );
  }

  Widget _editBtn(bool canEdit, VoidCallback onTap) => canEdit ? TextButton(onPressed: onTap, child: const Text('Edit')) : const SizedBox.shrink();

  Widget _body(Json s) {
    final canEdit = s['can_edit'] == true;
    final team = jsonList(s['team']);
    final board = jsonList(s['change_board']);
    final acks = jsonMap(s['ecn_acknowledgers']);
    final ackIds = jsonMap(s['ecn_acknowledger_ids']);
    final heads = team.where((t) => str(t['role']) == 'head').map((t) => str(t['name'])).where((n) => n.isNotEmpty).join(' or ');
    return ListView(padding: const EdgeInsets.only(top: 12, bottom: 32), children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Row(children: [
          const Text('Your role: ', style: TextStyle(color: Brand.muted)),
          StatusBadge(labelOf(teamRoleLabels, s['my_role']), color: _roleColors[str(s['my_role'])]),
        ]),
      ),
      if (!canEdit)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: InfoNote(
              'Read-only — only the Design head or an admin can change these settings. Ask ${heads.isEmpty ? 'the Design head' : heads} if something needs to change.',
              color: const Color(0xFF92400E)),
        ),
      const DetailSection('What can be configured here', children: [
        Text(
            'Forms, fields, statuses and workflow steps are fixed in code (no custom fields / form builder). Ask IT for a change. This page only sets who does each step and the time limits.',
            style: TextStyle(fontSize: 13)),
      ]),
      DetailSection('Design team', action: _editBtn(canEdit, _editTeam), children: [
        const Text('No team = everyone with the Design app works as a designer and can release; adding the team turns on role checks.',
            style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        if (team.isEmpty) const Text('No team set up — role checks are off.', style: TextStyle(fontSize: 13, color: Brand.muted)),
        for (final t in team)
          ListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: Text(str(t['name']).isEmpty ? 'User #${t['user_id']}' : str(t['name'])),
            subtitle: Text([str(t['email']), if (t['has_design_app'] == false) 'does not hold the Design app'].where((x) => x.isNotEmpty).join(' · ')),
            trailing: StatusBadge(labelOf(teamRoleLabels, t['role']), color: _roleColors[str(t['role'])]),
          ),
      ]),
      DetailSection('Approvals & timing', action: _editBtn(canEdit, _editApprovals), children: [
        const Text(
            'The default approver is pre-filled on every new revision (the author can change it). Overdue days flag checks/approvals waiting too long on the dashboard; customer response days set the due date on a transmittal when it is sent.',
            style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        FieldRow('Default approver', str(s['default_approver_name']).isEmpty ? 'None — the author picks every time' : s['default_approver_name']),
        FieldRow('Review overdue after (days)', s['review_overdue_days']),
        FieldRow('Customer response due (days)', s['customer_response_days']),
      ]),
      DetailSection('Change board members',
          action: _editBtn(
              canEdit,
              () => _editUsers('Change board members', board, (ids) => _put({'change_board_member_ids': ids}), 'Change board saved.',
                  'Search a user to add…')),
          children: [
            const Text(
                'Pre-filled as the voting board on every ECR once Design records its impact (it can be adjusted per ECR). The Design head decides after every board member has voted.',
                style: TextStyle(fontSize: 12.5, color: Brand.muted)),
            const SizedBox(height: 6),
            if (board.isEmpty) const Text('No board members named.', style: TextStyle(fontSize: 13, color: Brand.muted)),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final b in board) Chip(label: Text(_nameIn(board, asInt(b['user_id'] ?? b['id']) ?? 0))),
            ]),
          ]),
      DetailSection('ECN acknowledgers per department', children: [
        const Text(
            "After an ECN is released each department acknowledges it before it closes. When none are named for a department, anyone holding that department's app may acknowledge for it.",
            style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        for (final e in ackDepartmentLabels.entries)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(e.value, style: const TextStyle(fontWeight: FontWeight.w600)),
                  if (jsonList(acks[e.key]).isEmpty)
                    Text('Any ${e.value} app holder', style: const TextStyle(fontSize: 11.5, color: Brand.muted))
                  else
                    Wrap(spacing: 6, runSpacing: 4, children: [
                      for (final u in jsonList(acks[e.key])) Chip(label: Text(_nameIn(jsonList(acks[e.key]), asInt(u['user_id'] ?? u['id']) ?? 0))),
                    ]),
                ]),
              ),
              _editBtn(
                  canEdit,
                  () => _editUsers(
                      '${e.value} acknowledgers',
                      jsonList(acks[e.key]),
                      (ids) => _put({
                            'ecn_acknowledger_ids': {
                              for (final d in ackDepartmentLabels.keys)
                                d: d == e.key ? ids : [for (final x in (ackIds[d] is List ? ackIds[d] as List : const [])) asInt(x)].whereType<int>().toList(),
                            },
                          }),
                      'ECN acknowledgers saved.',
                      'Add a ${e.value.toLowerCase()} acknowledger…')),
            ]),
          ),
      ]),
      if (s['updated_at'] != null)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text('Last changed by ${txt(s['updated_by_name'])} · ${fmtDateTime(s['updated_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
        ),
    ]);
  }
}
