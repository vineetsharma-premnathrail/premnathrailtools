import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'fin_common.dart';

/// Finance › Masters & Setup (portal finance/masters/page.tsx).
class FinMastersPage extends StatelessWidget {
  const FinMastersPage({super.key});

  @override
  Widget build(BuildContext context) => FinTabbedPage(
        title: 'Masters & Setup',
        subtitle:
            'Company year, chart of accounts, posting ledgers, GST rates, bank & cash, vendors and opening balances — the foundations every voucher posts against.',
        tabs: [
          FinSubTab('Company & FY', (_) => const _CompanyFy(), permTab: 'company_fy'),
          FinSubTab('Account Groups', (_) => const _Groups(), permTab: 'account_groups'),
          FinSubTab('Ledgers', (_) => const _Ledgers(), permTab: 'ledgers'),
          FinSubTab('Ledger Settings', (_) => const _LedgerSettings(), permTab: 'ledger_settings'),
          FinSubTab('GST Rates', (_) => const _GstRates(), permTab: 'gst_rates'),
          FinSubTab('Bank & Cash', (_) => const _Banks(), permTab: 'bank_cash_accounts'),
          FinSubTab('Vendors', (_) => const _Vendors(), permTab: 'vendors'),
          FinSubTab('Internal Orders', (_) => const _InternalOrders(), permTab: 'internal_orders'),
          FinSubTab('Opening Balances', (_) => const _Opening(), permTab: 'opening_balances'),
        ],
      );
}

const _natureLabels = {'asset': 'Asset', 'liability': 'Liability', 'equity': 'Capital / Equity', 'revenue': 'Income', 'expense': 'Expense'};
const _statusLabels = {
  'active': 'Active', 'inactive': 'Inactive', 'closed': 'Closed', 'blocked': 'Blocked', 'open': 'Open', 'locked': 'Locked',
  'in_progress': 'In Progress', 'completed': 'Completed', 'default': 'Default', 'changed': 'Changed', 'system': 'System', 'custom': 'Custom',
};
const _statusHex = {
  'active': Color(0xFF15803D), 'inactive': Color(0xFF64748B), 'closed': Color(0xFF64748B), 'blocked': Color(0xFFB91C1C),
  'open': Color(0xFF15803D), 'locked': Color(0xFFB45309), 'in_progress': Color(0xFF0369A1), 'completed': Color(0xFF15803D),
  'default': Color(0xFF0369A1), 'changed': Color(0xFFB45309), 'system': Color(0xFF7C3AED), 'custom': Color(0xFF0369A1),
};

String? _blank(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
num? _num(TextEditingController c) => c.text.trim().isEmpty ? null : num.tryParse(c.text.trim());

Widget _pill(Object? s) => FinStatusPill(s, labels: _statusLabels, colors: _statusHex);

/// Small reload-able list body with a FAB.
class _ListPage extends StatelessWidget {
  const _ListPage({required this.body, this.fab});
  final Widget body;
  final Widget? fab;

  @override
  Widget build(BuildContext context) => Scaffold(backgroundColor: Colors.transparent, floatingActionButton: fab, body: body);
}

Future<void> _menu(BuildContext context, List<(String, VoidCallback, bool)> items) => showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final (label, fn, danger) in items)
            ListTile(
              title: Text(label, style: TextStyle(color: danger ? Brand.danger : null)),
              onTap: () {
                Navigator.pop(ctx);
                fn();
              },
            ),
        ]),
      ),
    );

// ── Company & FY ─────────────────────────────────────────────────────────────

class _CompanyFy extends StatelessWidget {
  const _CompanyFy();

  @override
  Widget build(BuildContext context) => ApiLoader<Json>(
        load: () async => asJson(await Api.get('/accounts/setup')),
        builder: (ctx, s, _) {
          final fy = s['current_financial_year'] is Map ? asJson(s['current_financial_year']) : null;
          final gst = asJson(s['company_gst']);
          final warnings = [for (final w in (s['warnings'] is List ? s['warnings'] as List : const [])) '$w'.replaceAll('Company Info>', 'Company Info > ')];
          return ListView(padding: const EdgeInsets.only(top: 8, bottom: 24), children: [
            if (warnings.isNotEmpty) InfoBanner(warnings.map((w) => '• $w').join('\n'), tone: Tone.warning),
            DetailSection(fy != null ? 'Financial year ${fy['code']}' : 'No financial year covers today', action: fy == null ? null : _pill(fy['status']), children: [
              const Text(
                  'The year and GST registration every voucher, invoice and return in Finance is booked against. Nothing can be posted outside an open year. '
                  'Edited in Organization › Company Info.',
                  style: TextStyle(fontSize: 12.5, color: Brand.muted)),
              if (fy != null) ...[
                FieldRow('Year', fy['code']),
                FieldRow('Period', '${fmtDate(fy['start_date'])} to ${fmtDate(fy['end_date'])}'),
                FieldRow('Lock date', fy['lock_date'] != null ? '${fmtDate(fy['lock_date'])} — no postings on or before this date' : 'Not set'),
                FieldRow('Source', fy['is_defined'] == true ? 'Defined in Company Info' : 'Using the standard April to March year until you set one'),
              ],
            ]),
            DetailSection('Company GST registration', children: [
              FieldRow('GSTIN', gst['gstin'] ?? 'Missing'),
              FieldRow('State', gst['state_code'] != null ? '${gst['state_code']} — ${gst['state_name'] ?? ''}' : 'Unknown'),
              const Text("Our state vs the party's state decides CGST + SGST (same state) or IGST (different state) on every invoice.",
                  style: TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
            SectionTitle('Financial years (${listOf(s['financial_years']).length})'),
            if (listOf(s['financial_years']).isEmpty) const EmptyView('No financial years defined in Company Info yet.'),
            for (final y in listOf(s['financial_years']))
              RecordCard(
                title: '${y['code']}${fy?['code'] == y['code'] ? ' (current)' : ''}',
                trailing: _pill(y['status']),
                meta: [('Start', fmtDate(y['start_date'])), ('End', fmtDate(y['end_date'])), ('Lock date', fmtDate(y['lock_date']))],
              ),
          ]);
        },
      );
}

// ── Account groups ───────────────────────────────────────────────────────────

List<(Json, int, String)> _tree(List<Json> groups) {
  final byParent = <int?, List<Json>>{};
  for (final g in groups) {
    byParent.putIfAbsent(toInt(g['parent_id']), () => []).add(g);
  }
  for (final l in byParent.values) {
    l.sort((a, b) {
      final s = (toInt(a['sequence']) ?? 0).compareTo(toInt(b['sequence']) ?? 0);
      return s != 0 ? s : '${a['code']}'.compareTo('${b['code']}');
    });
  }
  final ids = {for (final g in groups) toInt(g['id'])};
  final out = <(Json, int, String)>[];
  void walk(int? parent, int depth, String path) {
    for (final g in byParent[parent] ?? const <Json>[]) {
      final p = path.isEmpty ? '${g['name']}' : '$path › ${g['name']}';
      out.add((g, depth, p));
      walk(toInt(g['id']), depth + 1, p);
    }
  }

  walk(null, 0, '');
  // Orphans (parent not visible) at top level.
  for (final g in groups) {
    if (g['parent_id'] != null && !ids.contains(toInt(g['parent_id'])) && !out.any((x) => x.$1 == g)) out.add((g, 0, '${g['name']}'));
  }
  return out;
}

class _Groups extends StatefulWidget {
  const _Groups();

  @override
  State<_Groups> createState() => _GroupsState();
}

class _GroupsState extends State<_Groups> {
  int _tick = 0;

  Future<void> _form(List<Json> groups, Map<String, String> heads, {Json? editing, int? parentId}) async {
    final tree = _tree(groups);
    int? parent = parentId ?? toInt(editing?['parent_id']);
    final code = TextEditingController(text: '${editing?['code'] ?? ''}');
    final name = TextEditingController(text: '${editing?['name'] ?? ''}');
    String? head = editing?['schedule_iii_head'] as String?;
    String gp = 'inherit';
    final seq = TextEditingController(text: '${editing?['sequence'] ?? 0}');
    Json? groupById(int? id) => groups.where((g) => toInt(g['id']) == id).firstOrNull;
    final ok = await showFormSheet(
      context,
      title: editing != null ? "Edit group '${editing['name']}'" : 'New account sub-group',
      saveLabel: editing != null ? 'Save Changes' : 'Create Sub-group',
      builder: (ctx, setS) {
        final p = groupById(parent);
        return [
          const Text('Groups decide where a ledger appears in the Balance Sheet / P&L (Schedule III).', style: TextStyle(color: Brand.muted)),
          const InfoBanner(
              "A sub-group always inherits its parent's nature (asset, liability…) — a ledger under Sundry Debtors can only ever be an asset. "
              'The standard groups are fixed; add sub-groups under them for your own grouping.'),
          const Caps('Place in the chart'),
          if (editing != null)
            FieldRow('Parent group', editing['parent_name'] ?? '— (top level)')
          else
            AppSelect<int>(
              label: 'Parent group',
              required: true,
              value: parent,
              options: [for (final t in tree) Option(toInt(t.$1['id'])!, t.$3)],
              onChanged: (o) => setS(() => parent = o?.value),
            ),
          FieldRow('Nature (inherited)', _natureLabels['${(editing ?? p)?['nature']}'] ?? '—'),
          const Caps('Identity'),
          AppTextField(label: 'Code', required: true, controller: code, enabled: editing == null, hint: 'G-…'),
          AppTextField(label: 'Name', required: true, controller: name),
          const Caps('Reporting'),
          AppSelect<String>(
            label: 'Schedule III head',
            value: head,
            enabled: editing?['is_system'] != true,
            valueLabel: head == null
                ? 'Same as parent${p != null ? ' (${heads['${p['schedule_iii_head']}'] ?? p['schedule_iii_head']})' : ''}'
                : heads[head],
            options: [for (final e in heads.entries) Option(e.key, e.value)],
            onChanged: (o) => setS(() => head = o?.value),
          ),
          if (editing == null)
            AppSelect<String>(
              label: 'Affects gross profit',
              value: gp,
              clearable: false,
              options: [
                Option('inherit', 'Same as parent${p != null ? ' (${p['affects_gross_profit'] == true ? 'Yes' : 'No'})' : ''}'),
                const Option('yes', 'Yes'),
                const Option('no', 'No'),
              ],
              onChanged: (o) => setS(() => gp = o?.value ?? 'inherit'),
            ),
          AppTextField(label: 'Sequence', controller: seq, keyboardType: TextInputType.number),
          if (editing?['is_system'] == true)
            const Text('Standard group — its Schedule III head is fixed; create a sub-group with its own head instead.',
                style: TextStyle(fontSize: 12, color: Brand.muted)),
        ];
      },
      onSave: () async {
        if (name.text.trim().isEmpty || (editing == null && (code.text.trim().isEmpty || parent == null))) {
          throw 'Parent group, code and name are required — every new group sits under an existing one.';
        }
        if (editing != null) {
          await Api.patch('/accounts/account-groups/${editing['id']}', data: {
            'name': name.text.trim(),
            'sequence': int.tryParse(seq.text) ?? 0,
            if (editing['is_system'] != true && head != null && head != editing['schedule_iii_head']) 'schedule_iii_head': head,
          });
        } else {
          await Api.post('/accounts/account-groups', data: {
            'parent_id': parent,
            'code': code.text.trim(),
            'name': name.text.trim(),
            'schedule_iii_head': head,
            'affects_gross_profit': gp == 'inherit' ? null : gp == 'yes',
            'sequence': int.tryParse(seq.text) ?? 0,
          });
        }
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = finCan('account_groups', 'create');
    final canEdit = finCan('account_groups', 'edit');
    return ApiLoader<(List<Json>, Map<String, String>)>(
      key: ValueKey(_tick),
      load: () async {
        final g = asRows(await Api.get('/accounts/account-groups'));
        final s = asJson(await Api.get('/accounts/setup'));
        return (g, {for (final e in asJson(s['schedule_iii_heads']).entries) e.key: '${e.value}'});
      },
      builder: (ctx, data, _) {
        final (groups, heads) = data;
        final tree = _tree(groups);
        final hasChildren = {for (final g in groups) toInt(g['parent_id'])};
        return _ListPage(
          fab: canCreate ? CreateFab(label: 'New Sub-group', onPressed: () => _form(groups, heads)) : null,
          body: ListView(padding: const EdgeInsets.only(top: 8, bottom: 88), children: [
            if (tree.isEmpty) const EmptyView('No account groups yet — use + New Sub-group to add one under a primary group.'),
            for (final (g, depth, _) in tree)
              Padding(
                padding: EdgeInsets.only(left: (depth * 12).toDouble().clamp(0, 48)),
                child: RecordCard(
                  code: '${g['code']}',
                  title: '${depth > 0 ? '└ ' : ''}${g['name']}',
                  subtitle: '${_natureLabels['${g['nature']}'] ?? g['nature']} · ${g['schedule_iii_label'] ?? g['schedule_iii_head']}',
                  trailing: _pill(g['is_system'] == true ? 'system' : 'custom'),
                  meta: [('Gross profit', g['affects_gross_profit'] == true ? 'Yes' : '—'), ('Ledgers', '${g['ledger_count'] ?? 0}')],
                  onTap: !canCreate && !canEdit
                      ? null
                      : () {
                          final deletable = g['is_system'] != true && (toInt(g['ledger_count']) ?? 0) == 0 && !hasChildren.contains(toInt(g['id']));
                          _menu(ctx, [
                            if (canCreate) ('+ Sub-group', () => _form(groups, heads, parentId: toInt(g['id'])), false),
                            if (canEdit) ('Edit', () => _form(groups, heads, editing: g), false),
                            if (deletable && finCan('account_groups', 'delete'))
                              ('Delete', () async {
                                final ok = await confirmDialog(context,
                                    title: 'Delete this account group?',
                                    message: 'Delete "${g['name']}"? Only empty custom groups can be deleted.',
                                    confirmLabel: 'Delete',
                                    danger: true);
                                if (ok && context.mounted && await runAction(context, () => Api.delete('/accounts/account-groups/${g['id']}'))) {
                                  setState(() => _tick++);
                                }
                              }, true),
                          ]);
                        },
                ),
              ),
          ]),
        );
      },
    );
  }
}

// ── Ledgers ──────────────────────────────────────────────────────────────────

class _Ledgers extends StatefulWidget {
  const _Ledgers();

  @override
  State<_Ledgers> createState() => _LedgersState();
}

class _LedgersState extends State<_Ledgers> {
  int _tick = 0;
  String _search = '';
  String? _status;
  int? _group;

  Future<void> _form(List<Json> groups, {Json? editing}) async {
    int? groupId = toInt(editing?['group_id']);
    final code = TextEditingController(text: '${editing?['code'] ?? ''}');
    final name = TextEditingController(text: '${editing?['name'] ?? ''}');
    final sub = TextEditingController(text: '${editing?['account_sub_type'] ?? ''}');
    String status = '${editing?['status'] ?? 'active'}';
    bool posting = editing?['is_posting_account'] ?? true;
    bool control = editing?['is_control_account'] ?? false;
    String coReq = editing == null ? '' : (editing['cost_object_required'] == true ? '1' : '0');
    int? cc = toInt(editing?['default_cost_center_id']);
    String? ccLabel;
    final tree = _tree(groups);
    Json? grp() => groups.where((g) => toInt(g['id']) == groupId).firstOrNull;
    final ok = await showFormSheet(
      context,
      title: editing != null ? 'Edit ledger ${editing['code']}' : 'New ledger',
      saveLabel: editing != null ? 'Save Changes' : 'Create Ledger',
      builder: (ctx, setS) {
        final g = grp();
        final isPl = g != null && (g['nature'] == 'revenue' || g['nature'] == 'expense');
        return [
          AppSelect<int>(
            label: 'Group',
            required: true,
            value: groupId,
            options: [for (final t in tree) Option(toInt(t.$1['id'])!, t.$3)],
            onChanged: (o) => setS(() => groupId = o?.value),
          ),
          FieldRow('Type (from group)', _natureLabels['${g?['nature']}'] ?? '—'),
          AppTextField(label: 'Code', required: true, controller: code),
          AppTextField(label: 'Name', required: true, controller: name),
          AppTextField(label: 'Sub-type', controller: sub),
          AppSelect<String>(
            label: 'Status',
            value: status,
            clearable: false,
            options: const [Option('active', 'Active'), Option('inactive', 'Inactive')],
            onChanged: (o) => setS(() => status = o?.value ?? status),
          ),
          const Text('Opening balances are entered on the Opening Balances tab, so they are dated and auditable.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
          AppSelect<bool>(
            label: 'Posting',
            value: posting,
            clearable: false,
            options: const [Option(true, 'Yes — vouchers post here'), Option(false, 'No — header only')],
            onChanged: (o) => setS(() => posting = o?.value ?? true),
          ),
          AppSelect<bool>(
            label: 'Control account',
            value: control,
            clearable: false,
            options: const [Option(false, 'No'), Option(true, 'Yes — sum of a party sub-ledger')],
            onChanged: (o) => setS(() => control = o?.value ?? false),
          ),
          if (isPl) ...[
            AppSelect<String>(
              label: 'Cost object required',
              value: coReq,
              clearable: false,
              options: [
                if (editing == null) const Option('', 'Auto — overheads need one'),
                const Option('1', 'Yes — cost centre or order'),
                const Option('0', 'No'),
              ],
              onChanged: (o) => setS(() => coReq = o?.value ?? ''),
            ),
            AppSelect<int>(
              label: 'Default cost centre',
              value: cc,
              valueLabel: ccLabel ?? (cc == null ? null : '#$cc'),
              loadOptions: (q) async => (await FinLookups.costCentres())
                  .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                  .toList(),
              onChanged: (o) => setS(() {
                cc = o?.value;
                ccLabel = o?.label;
              }),
            ),
          ],
        ];
      },
      onSave: () async {
        if (groupId == null || code.text.trim().isEmpty || name.text.trim().isEmpty) {
          throw 'Group, code and name are required — the group decides where this ledger shows in the Balance Sheet / P&L.';
        }
        final g = grp();
        final isPl = g != null && (g['nature'] == 'revenue' || g['nature'] == 'expense');
        final payload = {
          'group_id': groupId,
          'code': code.text.trim(),
          'name': name.text.trim(),
          'account_sub_type': _blank(sub),
          'status': status,
          'is_posting_account': posting,
          'is_control_account': control,
          if (isPl) ...{'cost_object_required': coReq == '' ? null : coReq == '1', 'default_cost_center_id': cc} else ...{
            'default_cost_center_id': null,
            if (editing != null) 'cost_object_required': false,
          },
        };
        if (editing != null) {
          await Api.patch('/accounts/gl-accounts/${editing['id']}', data: payload);
        } else {
          await Api.post('/accounts/gl-accounts', data: payload);
        }
      },
    );
    if (ok) {
      FinLookups.clear();
      setState(() => _tick++);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canCreate = finCan('ledgers', 'create');
    final canEdit = finCan('ledgers', 'edit');
    return ApiLoader<(List<Json>, List<Json>)>(
      key: ValueKey(_tick),
      load: () async => (asRows(await Api.get('/accounts/gl-accounts')), asRows(await Api.get('/accounts/account-groups'))),
      builder: (ctx, data, _) {
        final (accounts, groups) = data;
        final q = _search.toLowerCase();
        final rows = sortByCode(
            accounts
                .where((a) =>
                    (_status == null || a['status'] == _status) &&
                    (_group == null || toInt(a['group_id']) == _group) &&
                    (q.isEmpty || '${a['code']} ${a['name']}'.toLowerCase().contains(q)))
                .toList(),
            'code');
        return _ListPage(
          fab: canCreate ? CreateFab(label: 'New Ledger', onPressed: () => _form(groups)) : null,
          body: ListView(padding: const EdgeInsets.only(bottom: 88), children: [
            padded(SearchField(hint: 'Code or name', onChanged: (v) => setState(() => _search = v.trim()))),
            padded(Row(children: [
              Expanded(
                child: AppSelect<int>(
                  label: 'Group',
                  value: _group,
                  options: [for (final t in _tree(groups)) Option(toInt(t.$1['id'])!, t.$3)],
                  onChanged: (o) => setState(() => _group = o?.value),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: AppSelect<String>(
                  label: 'Status',
                  value: _status,
                  options: const [Option('active', 'Active'), Option('inactive', 'Inactive')],
                  onChanged: (o) => setState(() => _status = o?.value),
                ),
              ),
            ])),
            if (rows.isEmpty) const EmptyView('No ledgers match the filters — clear the search or set Status to All.'),
            for (final a in rows)
              RecordCard(
                code: '${a['code']}',
                title: '${a['name']}',
                subtitle: '${a['group_name'] ?? ''} · ${_natureLabels['${a['account_type']}'] ?? a['account_type'] ?? ''}',
                trailing: _pill(a['status']),
                meta: [
                  ('Flags', [
                    if (a['is_posting_account'] != true) 'Header',
                    if (a['is_control_account'] == true) 'Control',
                    if (a['cost_object_required'] == true) 'Cost object',
                  ].join(', ').let((s) => s.isEmpty ? '—' : s)),
                ],
                onTap: canEdit || finCan('ledgers', 'delete')
                    ? () => _menu(ctx, [
                          if (canEdit) ('Edit', () => _form(groups, editing: a), false),
                          if (finCan('ledgers', 'delete'))
                            ('Delete', () async {
                              final ok = await confirmDialog(context,
                                  title: 'Delete this ledger?',
                                  message: 'Delete ${a['code']} — ${a['name']}? A ledger with postings cannot be deleted; set it Inactive instead.',
                                  confirmLabel: 'Delete',
                                  danger: true);
                              if (ok && context.mounted && await runAction(context, () => Api.delete('/accounts/gl-accounts/${a['id']}'))) {
                                FinLookups.clear();
                                setState(() => _tick++);
                              }
                            }, true),
                        ])
                    : null,
              ),
          ]),
        );
      },
    );
  }
}

extension _Let<T> on T {
  R let<R>(R Function(T) f) => f(this);
}

// ── Ledger settings ──────────────────────────────────────────────────────────

class _LedgerSettings extends StatefulWidget {
  const _LedgerSettings();

  @override
  State<_LedgerSettings> createState() => _LedgerSettingsState();
}

class _LedgerSettingsState extends State<_LedgerSettings> {
  int _tick = 0;

  Future<void> _change(Json s, int? glId) async {
    if (await runAction(context, () => Api.put('/accounts/ledger-settings', data: {'role': s['role'], 'gl_account_id': glId}),
        success: 'Ledger for "${s['label']}" changed.')) {
      setState(() => _tick++);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canManage = isFinanceManager && finCan('ledger_settings', 'edit');
    return ApiLoader<List<Json>>(
      key: ValueKey(_tick),
      load: () async => asRows(await Api.get('/accounts/ledger-settings')),
      builder: (ctx, settings, _) => ListView(padding: const EdgeInsets.only(top: 8, bottom: 24), children: [
        const InfoBanner(
            'When the system posts on its own (a purchase invoice, a sales invoice, GST, round-off, closing stock), it needs to know which ledger '
            'plays each role. Defaults come from the standard chart; change one only if your chart uses a different ledger. Changing a role affects '
            'new postings only — past vouchers stay where they were posted.'),
        if (!canManage)
          const InfoBanner("Only a Finance Manager (or admin) can change these. Ask an admin to tick 'Finance Manager' on your user.", tone: Tone.warning),
        if (settings.isEmpty) const EmptyView('No ledger roles defined.'),
        for (final s in settings)
          DetailSection('${s['label']}', action: _pill(s['is_default'] == true ? 'default' : 'changed'), children: [
            Text('Standard code: ${s['default_code'] ?? '—'}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
            const SizedBox(height: 6),
            AppSelect<int>(
              label: 'Ledger',
              value: toInt(s['gl_account_id']),
              enabled: canManage,
              valueLabel: s['gl_account_id'] != null ? '${s['gl_account_code']} — ${s['gl_account_name']}' : 'Not found — pick a ledger',
              loadOptions: (q) async => (await FinLookups.ledgerOptions())
                  .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                  .toList(),
              onChanged: (o) {
                if (o != null && o.value != toInt(s['gl_account_id'])) _change(s, o.value);
              },
            ),
            if (s['is_default'] != true && canManage)
              Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => _change(s, null), child: const Text('Reset to default'))),
          ]),
      ]),
    );
  }
}

// ── GST rates ────────────────────────────────────────────────────────────────

class _GstRates extends StatefulWidget {
  const _GstRates();

  @override
  State<_GstRates> createState() => _GstRatesState();
}

class _GstRatesState extends State<_GstRates> {
  int _tick = 0;

  Future<void> _update(Json r, Json payload) async {
    if (await runAction(context, () => Api.patch('/accounts/gst-rates/${r['id']}', data: payload), success: 'GST rate ${r['rate']}% updated.')) {
      FinLookups.clear();
      setState(() => _tick++);
    }
  }

  Future<void> _add() async {
    final rate = TextEditingController();
    final desc = TextEditingController();
    bool active = true;
    final ok = await showFormSheet(
      context,
      title: 'Add GST rate',
      saveLabel: 'Add Rate',
      builder: (ctx, setS) => [
        const Text('A new slab offered in the GST % dropdown on invoice and note lines.', style: TextStyle(color: Brand.muted)),
        AppTextField(label: 'Rate (%)', required: true, controller: rate, keyboardType: AppTextField.number),
        AppTextField(label: 'Description', controller: desc, hint: 'e.g. Standard rate'),
        CheckField(label: 'Active', value: active, onChanged: (v) => setS(() => active = v)),
      ],
      onSave: () async {
        if (rate.text.trim().isEmpty) throw 'Enter the rate in percent (e.g. 18).';
        await Api.post('/accounts/gst-rates', data: {'rate': num.tryParse(rate.text.trim()), 'description': _blank(desc), 'is_active': active});
      },
    );
    if (ok) {
      FinLookups.clear();
      setState(() => _tick++);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canManage = isFinanceManager;
    return ApiLoader<List<Json>>(
      key: ValueKey(_tick),
      load: () async => asRows(await Api.get('/accounts/gst-rates')),
      builder: (ctx, rates, _) => _ListPage(
        fab: canManage && finCan('gst_rates', 'create') ? CreateFab(label: 'Add Rate', onPressed: _add) : null,
        body: ListView(padding: const EdgeInsets.only(top: 8, bottom: 88), children: [
          const InfoBanner(
              'From 22-Sep-2025 the GST slabs are 0%, 5%, 18% and 40% — the 12% and 28% slabs were withdrawn. They are kept as inactive rates so '
              'documents dated before that (and credit/debit notes against them) can still be read. An inactive rate simply stops appearing on new documents.'),
          if (!canManage) const InfoBanner('Only a Finance Manager (or admin) can add or change GST rates.', tone: Tone.warning),
          for (final r in rates)
            RecordCard(
              title: '${fmtNumber(r['rate'])}%',
              subtitle: r['description'] as String?,
              trailing: _pill(r['is_active'] == true ? 'active' : 'inactive'),
              onTap: canManage && finCan('gst_rates', 'edit')
                  ? () => _menu(ctx, [
                        ('Edit description', () async {
                          final d = await promptDialog(context,
                              title: 'Edit GST rate ${r['rate']}%', message: 'Change the label shown next to this rate.', label: 'Description', required: false, confirmLabel: 'Save');
                          if (d != null) _update(r, {'description': d.isEmpty ? null : d});
                        }, false),
                        (r['is_active'] == true ? 'Deactivate' : 'Activate', () => _update(r, {'is_active': r['is_active'] != true}), r['is_active'] == true),
                      ])
                  : null,
            ),
        ]),
      ),
    );
  }
}

// ── Bank & cash ──────────────────────────────────────────────────────────────

class _Banks extends StatefulWidget {
  const _Banks();

  @override
  State<_Banks> createState() => _BanksState();
}

class _BanksState extends State<_Banks> {
  int _tick = 0;

  Future<void> _form({Json? editing}) async {
    String kind = '${editing?['account_kind'] ?? 'bank'}';
    final name = TextEditingController(text: '${editing?['bank_name'] ?? ''}');
    final accNo = TextEditingController(text: '${editing?['account_no'] ?? ''}');
    final holder = TextEditingController(text: '${editing?['account_holder_name'] ?? ''}');
    final branch = TextEditingController(text: '${editing?['branch_name'] ?? ''}');
    final ifsc = TextEditingController(text: '${editing?['ifsc_code'] ?? ''}');
    int? gl = toInt(editing?['gl_account_id']);
    String? glLabel = editing?['gl_account_code'] != null ? '${editing!['gl_account_code']} — ${editing['gl_account_name'] ?? ''}' : null;
    String status = '${editing?['status'] ?? 'active'}';
    final ok = await showFormSheet(
      context,
      title: editing != null ? 'Edit ${editing['bank_name']}' : 'New bank / cash account',
      saveLabel: editing != null ? 'Save Changes' : 'Create Account',
      builder: (ctx, setS) {
        final isBank = kind == 'bank';
        return [
          AppSelect<String>(
            label: 'Kind',
            value: kind,
            clearable: false,
            options: const [Option('bank', 'Bank'), Option('cash', 'Cash')],
            onChanged: (o) => setS(() {
              kind = o?.value ?? kind;
              gl = null;
              glLabel = null;
            }),
          ),
          AppTextField(label: isBank ? 'Bank name' : 'Account name', required: true, controller: name),
          if (isBank) ...[
            AppTextField(label: 'Account number', required: true, controller: accNo),
            AppTextField(label: 'Account holder', controller: holder),
            AppTextField(label: 'Branch', controller: branch),
            AppTextField(label: 'IFSC', controller: ifsc),
          ],
          AppSelect<int>(
            label: 'Linked GL ledger',
            required: true,
            value: gl,
            valueLabel: glLabel,
            loadOptions: (q) async {
              final wanted = isBank ? 'bank accounts' : 'cash-in-hand';
              return (await FinLookups.ledgerOptions(filter: (a) => '${a['group_name'] ?? ''}'.toLowerCase() == wanted))
                  .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                  .toList();
            },
            onChanged: (o) => setS(() {
              gl = o?.value;
              glLabel = o?.label;
            }),
          ),
          AppSelect<String>(
            label: 'Status',
            value: status,
            clearable: false,
            options: const [Option('active', 'Active'), Option('inactive', 'Inactive'), Option('closed', 'Closed')],
            onChanged: (o) => setS(() => status = o?.value ?? status),
          ),
          const Text('Opening balances are entered on the Opening Balances tab.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        ];
      },
      onSave: () async {
        final isBank = kind == 'bank';
        final missing = [
          if (name.text.trim().isEmpty) isBank ? 'bank name' : 'account name',
          if (isBank && accNo.text.trim().isEmpty) 'account number',
          if (gl == null) 'linked GL ledger',
        ];
        if (missing.isNotEmpty) throw 'Fill in the ${missing.join(', ')}.';
        final payload = {
          'account_kind': kind,
          'bank_name': name.text.trim(),
          'gl_account_id': gl,
          'status': status,
          'account_no': isBank ? _blank(accNo) : null,
          'account_holder_name': isBank ? _blank(holder) : null,
          'branch_name': isBank ? _blank(branch) : null,
          'ifsc_code': isBank && ifsc.text.trim().isNotEmpty ? ifsc.text.trim().toUpperCase() : null,
        };
        if (editing != null) {
          await Api.patch('/accounts/bank-accounts/${editing['id']}', data: payload);
        } else {
          await Api.post('/accounts/bank-accounts', data: payload);
        }
      },
    );
    if (ok) setState(() => _tick++);
  }

  @override
  Widget build(BuildContext context) {
    return ApiLoader<List<Json>>(
      key: ValueKey(_tick),
      load: () async => asRows(await Api.get('/accounts/bank-accounts')),
      builder: (ctx, rows, _) => _ListPage(
        fab: finCan('bank_cash_accounts', 'create') ? CreateFab(label: 'New Account', onPressed: () => _form()) : null,
        body: ListView(padding: const EdgeInsets.only(top: 8, bottom: 88), children: [
          if (rows.isEmpty) const EmptyView('No bank or cash accounts yet.'),
          for (final a in rows)
            RecordCard(
              title: '${a['bank_name']}',
              subtitle: a['account_kind'] == 'bank'
                  ? '${a['account_no'] ?? ''}${a['ifsc_code'] != null ? ' · ${a['ifsc_code']}' : ''}${a['branch_name'] != null ? ' · ${a['branch_name']}' : ''}'
                  : 'Cash',
              trailing: _pill(a['status']),
              meta: [
                ('Ledger', a['gl_account_code'] != null ? '${a['gl_account_code']} — ${a['gl_account_name'] ?? ''}' : 'No GL ledger linked'),
                ('Book balance', drcr(a['book_balance'])),
              ],
              onTap: () => _menu(ctx, [
                if (finCan('bank_cash_accounts', 'edit')) ('Edit', () => _form(editing: a), false),
                if (finCan('bank_cash_accounts', 'delete'))
                  ('Delete', () async {
                    final ok = await confirmDialog(context,
                        title: 'Delete this account?',
                        message: 'Delete ${a['bank_name']}? An account with vouchers cannot be deleted; set it Inactive instead.',
                        confirmLabel: 'Delete',
                        danger: true);
                    if (ok && context.mounted && await runAction(context, () => Api.delete('/accounts/bank-accounts/${a['id']}'))) setState(() => _tick++);
                  }, true),
              ]),
            ),
        ]),
      ),
    );
  }
}

// ── Vendors ──────────────────────────────────────────────────────────────────

const _gstRegLabels = {'regular': 'Regular', 'composition': 'Composition', 'unregistered': 'Unregistered', 'overseas': 'Overseas (import)', 'sez': 'SEZ'};

class _Vendors extends StatefulWidget {
  const _Vendors();

  @override
  State<_Vendors> createState() => _VendorsState();
}

class _VendorsState extends State<_Vendors> {
  final _list = GlobalKey<ApiListViewState>();

  Future<void> _form({Json? editing}) async {
    final setup = asJson(await Api.get('/accounts/setup').catchError((_) => <String, dynamic>{}));
    final states = asJson(setup['state_codes']);
    TextEditingController t(String k) => TextEditingController(text: '${editing?[k] ?? ''}');
    final code = t('code'), name = t('name'), gstin = t('gstin'), pan = t('pan'), address = t('address'), city = t('city'), pin = t('pin_code');
    final cName = t('contact_name'), cPhone = t('contact_phone'), cEmail = t('contact_email');
    final bName = t('bank_name'), bAcc = t('bank_account_no'), bIfsc = t('ifsc_code'), bHolder = t('account_holder_name');
    final credit = t('credit_limit'), days = t('payment_days');
    String reg = '${editing?['gst_registration_type'] ?? (editing?['gstin'] != null || editing == null ? 'regular' : 'unregistered')}';
    String? state = editing?['state'] as String?;
    String status = '${editing?['status'] ?? 'active'}';
    int? expGl = toInt(editing?['default_expense_gl_account_id']);
    String? expLabel;
    final bankWritable = editing == null || finCanFeature('vendors', 'bank_details', 'edit');
    final refRequired = editing == null || editing['referral_type'] != null;
    String? refChoice = switch (editing?['referral_type']) {
      'direct' => 'direct',
      'external' => 'external',
      'employee' => editing?['referred_by_user_id'] != null ? 'u:${editing!['referred_by_user_id']}' : null,
      _ => null,
    };
    String? refLabel = editing?['referred_by_user_name'] as String?;
    final refName = t('referred_by_name'), refPhone = t('referred_by_phone');
    if (!mounted) return;
    final ok = await showFormSheet(
      context,
      title: editing != null ? "Edit vendor '${editing['name']}'" : 'New vendor',
      saveLabel: editing != null ? 'Save Changes' : 'Create Vendor',
      builder: (ctx, setS) => [
        const Text('The vendor master is shared with Procurement.', style: TextStyle(color: Brand.muted)),
        const Caps('Vendor'),
        AppTextField(label: 'Code', required: true, controller: code),
        AppTextField(label: 'Name', required: true, controller: name),
        AppSelect<String>(
          label: 'Status',
          value: status,
          clearable: false,
          options: const [Option('active', 'Active'), Option('inactive', 'Inactive'), Option('blocked', 'Blocked')],
          onChanged: (o) => setS(() => status = o?.value ?? status),
        ),
        const Caps('GST & PAN'),
        AppSelect<String>(
          label: 'GST registration',
          value: reg,
          clearable: false,
          options: [for (final e in _gstRegLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => reg = o?.value ?? reg),
        ),
        AppTextField(label: 'GSTIN', required: reg == 'regular' || reg == 'composition' || reg == 'sez', controller: gstin),
        AppTextField(label: 'PAN', controller: pan),
        const Caps('Address'),
        AppTextField(label: 'Address', controller: address),
        AppTextField(label: 'City', controller: city),
        AppSelect<String>(
          label: 'State (place of supply)',
          value: state,
          options: [for (final e in states.entries) Option('${e.value}', '${e.key} — ${e.value}')],
          onChanged: (o) => setS(() => state = o?.value),
        ),
        AppTextField(label: 'PIN', controller: pin, keyboardType: TextInputType.number),
        const Caps('Contact (optional)'),
        AppTextField(label: 'Contact name', controller: cName),
        AppTextField(label: 'Phone', controller: cPhone, keyboardType: TextInputType.phone),
        AppTextField(label: 'Email', controller: cEmail, keyboardType: TextInputType.emailAddress),
        Caps('Who referred this vendor?${refRequired ? ' *' : ''}'),
        AppSelect<String>(
          label: 'Referred by',
          value: refChoice,
          valueLabel: refChoice == 'direct' ? 'Direct (no referral)' : refChoice == 'external' ? 'External / other person or company' : refLabel,
          loadOptions: (q) async {
            final people = asRows(await Api.get('/users/directory'));
            return [
              const Option('direct', 'Direct (no referral)'),
              const Option('external', 'External / other person or company'),
              for (final p in people)
                if (q.isEmpty || '${p['name']}'.toLowerCase().contains(q.toLowerCase()))
                  Option('u:${p['id']}', p['department'] != null ? '${p['name']} — ${p['department']}' : '${p['name']}'),
            ];
          },
          onChanged: (o) => setS(() {
            refChoice = o?.value;
            refLabel = o?.label;
          }),
        ),
        if (refChoice == 'external') ...[
          AppTextField(label: 'Name / company', required: true, controller: refName),
          AppTextField(label: 'Phone', controller: refPhone, keyboardType: TextInputType.phone),
        ],
        const Caps('Bank details (optional)'),
        if (!bankWritable) const Text('You can view but not change the bank details.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        AppTextField(label: 'Bank name', controller: bName, enabled: bankWritable),
        AppTextField(label: 'Account no.', controller: bAcc, enabled: bankWritable),
        AppTextField(label: 'IFSC', controller: bIfsc, enabled: bankWritable),
        AppTextField(label: 'Account holder', controller: bHolder, enabled: bankWritable),
        const Caps('Terms & posting'),
        AppTextField(label: 'Credit limit (₹)', controller: credit, keyboardType: AppTextField.number),
        AppTextField(label: 'Payment days', controller: days, keyboardType: TextInputType.number),
        AppSelect<int>(
          label: 'Default expense ledger',
          value: expGl,
          valueLabel: expLabel ?? (expGl == null ? null : FinLookups.ledgerLabel(expGl)),
          loadOptions: (q) async => (await FinLookups.ledgerOptions())
              .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
              .toList(),
          onChanged: (o) => setS(() {
            expGl = o?.value;
            expLabel = o?.label;
          }),
        ),
      ],
      onSave: () async {
        if (code.text.trim().isEmpty || name.text.trim().isEmpty) throw 'Vendor code and name are required.';
        if (refChoice == null && refRequired) {
          throw "Choose who referred this vendor — pick an employee, 'External / other', or 'Direct (no referral)'.";
        }
        if (refChoice == 'external' && refName.text.trim().isEmpty) {
          throw "Enter the name (person or company) who referred this vendor, or choose 'Direct (no referral)'.";
        }
        String? up(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim().toUpperCase();
        final payload = {
          'code': code.text.trim(),
          'name': name.text.trim(),
          'gst_registration_type': reg,
          'gstin': up(gstin),
          'pan': up(pan),
          'address': _blank(address),
          'city': _blank(city),
          'state': state,
          'pin_code': _blank(pin),
          'contact_name': _blank(cName),
          'contact_phone': _blank(cPhone),
          'contact_email': _blank(cEmail),
          if (bankWritable) ...{
            'bank_name': _blank(bName),
            'bank_account_no': _blank(bAcc),
            'ifsc_code': up(bIfsc),
            'account_holder_name': _blank(bHolder),
          },
          'credit_limit': _num(credit),
          'payment_days': _num(days),
          'default_expense_gl_account_id': expGl,
          'status': status,
          if (refChoice == 'direct') ...{'referral_type': 'direct', 'referred_by_user_id': null, 'referred_by_name': null, 'referred_by_phone': null},
          if (refChoice == 'external') ...{
            'referral_type': 'external', 'referred_by_user_id': null, 'referred_by_name': refName.text.trim(), 'referred_by_phone': _blank(refPhone),
          },
          if (refChoice != null && refChoice!.startsWith('u:')) ...{
            'referral_type': 'employee', 'referred_by_user_id': int.tryParse(refChoice!.substring(2)), 'referred_by_name': null, 'referred_by_phone': null,
          },
        };
        if (editing != null) {
          await Api.patch('/accounts/vendors/${editing['id']}', data: payload);
        } else {
          await Api.post('/accounts/vendors', data: payload);
        }
      },
    );
    if (ok) _list.currentState?.reload();
  }

  @override
  Widget build(BuildContext context) {
    return _ListPage(
      fab: finCan('vendors', 'create') ? CreateFab(label: 'New Vendor', onPressed: () => _form()) : null,
      body: ApiListView(
        key: _list,
        searchHint: 'Search code, name, GSTIN, city',
        load: (p, s) async {
          final rows = sortByCode(asRows(await Api.get('/accounts/vendors')), 'code');
          final q = s.toLowerCase();
          return ApiPage(q.isEmpty
              ? rows
              : rows.where((v) => [v['code'], v['name'], v['gstin'], v['city']].any((x) => '${x ?? ''}'.toLowerCase().contains(q))).toList());
        },
        emptyText: 'No vendors yet.',
        itemBuilder: (ctx, v, reload) => RecordCard(
          code: '${v['code']}',
          title: '${v['name']}',
          subtitle: [v['gstin'], v['city'], v['state']].where((x) => x != null && '$x'.isNotEmpty).join(' · '),
          trailing: _pill(v['status']),
          meta: [
            ('GST', _gstRegLabels['${v['gst_registration_type']}'] ?? txt(v['gst_registration_type'])),
            if (v['payment_days'] != null) ('Payment days', '${v['payment_days']}'),
            if (v['credit_limit'] != null) ('Credit limit', inr(v['credit_limit'])),
            if (v['msme_category'] != null) ('MSME', '${v['msme_category']}'),
          ],
          onTap: () => _menu(ctx, [
            if (finCan('vendors', 'edit')) ('Edit', () => _form(editing: v), false),
            if (finCan('vendors', 'delete'))
              ('Delete', () async {
                final ok = await confirmDialog(context,
                    title: 'Delete this vendor?',
                    message: "Delete '${v['name']}'? A vendor with bills or payments cannot be deleted; set it Inactive or Blocked instead.",
                    confirmLabel: 'Delete',
                    danger: true);
                if (ok && context.mounted && await runAction(context, () => Api.delete('/accounts/vendors/${v['id']}'))) reload();
              }, true),
          ]),
        ),
      ),
    );
  }
}

// ── Internal orders ──────────────────────────────────────────────────────────

const _ioNext = {
  'open': ['in_progress'], 'in_progress': ['completed'], 'completed': ['in_progress', 'closed'], 'closed': ['in_progress'],
};
const _ioAction = {
  'in_progress': ('Start', 'The order is released and keeps taking postings.'),
  'completed': ('Complete', 'Work is done (technically complete): no new postings are allowed. It can be set back to In progress if a late bill arrives.'),
  'closed': ('Close', 'Closing is final: no postings, and reopening needs a Partner’s approval. Open purchase orders on it must be invoiced or moved first.'),
};
const _ioTypes = {'capital': 'Capital', 'maintenance': 'Maintenance', 'it': 'IT', 'training': 'Training', 'development': 'Development (R&D)'};

class _InternalOrders extends StatefulWidget {
  const _InternalOrders();

  @override
  State<_InternalOrders> createState() => _InternalOrdersState();
}

class _InternalOrdersState extends State<_InternalOrders> {
  int _tick = 0;

  Future<void> _form({Json? editing}) async {
    final code = TextEditingController(text: '${editing?['code'] ?? ''}');
    final name = TextEditingController(text: '${editing?['name'] ?? ''}');
    final desc = TextEditingController(text: '${editing?['description'] ?? ''}');
    String type = '${editing?['order_type'] ?? 'capital'}';
    DateTime? start = isoToDate(editing?['start_date']);
    DateTime? end = isoToDate(editing?['end_date']);
    final budget = TextEditingController(text: editing?['budgeted_amount'] == null ? '' : '${editing!['budgeted_amount']}');
    int? cc = toInt(editing?['cost_center_id']);
    String? ccLabel = editing?['cost_center_name'] as String?;
    final ok = await showFormSheet(
      context,
      title: editing != null ? 'Edit internal order ${editing['code']}' : 'New internal order',
      saveLabel: editing != null ? 'Save Changes' : 'Create Order',
      builder: (ctx, setS) => [
        const Text('A budget bucket for a job (capex, repair, IT, training, R&D) that postings can be charged to.', style: TextStyle(color: Brand.muted)),
        AppTextField(label: 'Code', required: true, controller: code),
        AppTextField(label: 'Name', required: true, controller: name),
        AppTextField(label: 'Description', controller: desc, maxLines: 2),
        AppSelect<String>(
          label: 'Order type',
          value: type,
          clearable: false,
          options: [for (final e in _ioTypes.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        DateField(label: 'Start date', value: start, onChanged: (d) => setS(() => start = d)),
        DateField(label: 'End date', value: end, onChanged: (d) => setS(() => end = d)),
        AppTextField(label: 'Budget (₹)', controller: budget, keyboardType: AppTextField.number),
        AppSelect<int>(
          label: 'Cost centre',
          value: cc,
          valueLabel: ccLabel,
          loadOptions: (q) async => (await FinLookups.costCentres())
              .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
              .toList(),
          onChanged: (o) => setS(() {
            cc = o?.value;
            ccLabel = o?.label;
          }),
        ),
      ],
      onSave: () async {
        if (code.text.trim().isEmpty || name.text.trim().isEmpty) throw 'Order code and name are required.';
        final payload = {
          if (editing == null) 'status': 'open',
          'code': code.text.trim(),
          'name': name.text.trim(),
          'description': _blank(desc),
          'order_type': type,
          'start_date': dateOrNull(start),
          'end_date': dateOrNull(end),
          'budgeted_amount': _num(budget),
          'cost_center_id': cc,
        };
        if (editing != null) {
          await Api.patch('/accounts/internal-orders/${editing['id']}', data: payload);
        } else {
          await Api.post('/accounts/internal-orders', data: payload);
        }
      },
    );
    if (ok) setState(() => _tick++);
  }

  Future<void> _status(Json o, String to) async {
    String? reason;
    if (o['status'] == 'closed') {
      reason = await promptDialog(context,
          title: 'Reopen ${o['code']}?',
          message: "Reopening a closed order needs a Partner's approval.",
          label: 'Reason',
          confirmLabel: 'Ask to reopen');
      if (reason == null) return;
    } else {
      final a = _ioAction[to]!;
      final ok = await confirmDialog(context,
          title: '${o['status'] == 'completed' && to == 'in_progress' ? 'Undo complete' : a.$1} ${o['code']}?', message: a.$2, confirmLabel: 'Confirm');
      if (!ok) return;
    }
    if (!mounted) return;
    try {
      final res = await Api.dio.post('/accounts/internal-orders/${o['id']}/status', data: {'status': to, 'reason': reason});
      if (!mounted) return;
      final d = res.data;
      showSnack(
          context,
          res.statusCode == 202
              ? '${d is Map && d['message'] != null ? d['message'] : "Reopening ${o['code']} is waiting for a Partner's approval."}'
              : 'Status changed.');
      setState(() => _tick++);
    } catch (e) {
      if (mounted) showSnack(context, 'Could not change the status of internal order ${o['code']}. ${ApiClient.describe(e)}', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canEdit = finCan('internal_orders', 'edit');
    return ApiLoader<List<Json>>(
      key: ValueKey(_tick),
      load: () async => sortByCode(asRows(await Api.get('/accounts/internal-orders')), 'code'),
      builder: (ctx, rows, _) => _ListPage(
        fab: finCan('internal_orders', 'create') ? CreateFab(label: 'New Order', onPressed: () => _form()) : null,
        body: ListView(padding: const EdgeInsets.only(top: 8, bottom: 88), children: [
          if (rows.isEmpty) const EmptyView('No internal orders yet.'),
          for (final o in rows)
            RecordCard(
              code: '${o['code']}',
              title: '${o['name']}',
              subtitle: '${_ioTypes['${o['order_type']}'] ?? o['order_type']}${o['cost_center_name'] != null ? ' · ${o['cost_center_name']}' : ''}',
              trailing: _pill(o['status']),
              meta: [
                if (o['start_date'] != null || o['end_date'] != null) ('Period', '${fmtDate(o['start_date'])} – ${fmtDate(o['end_date'])}'),
                ('Budget', o['budgeted_amount'] != null ? inr(o['budgeted_amount']) : '—'),
              ],
              onTap: () => _menu(ctx, [
                if (canEdit) ('Edit', () => _form(editing: o), false),
                if (canEdit)
                  for (final to in _ioNext['${o['status']}'] ?? const <String>[])
                    (
                      o['status'] == 'closed' ? 'Reopen' : (o['status'] == 'completed' && to == 'in_progress' ? 'Undo complete' : _ioAction[to]!.$1),
                      () => _status(o, to),
                      false
                    ),
                if (finCan('internal_orders', 'delete'))
                  ('Delete', () async {
                    final ok = await confirmDialog(context,
                        title: 'Delete this internal order?',
                        message: 'Delete ${o['code']}? An order with postings cannot be deleted; close it instead.',
                        confirmLabel: 'Delete',
                        danger: true);
                    if (ok && context.mounted && await runAction(context, () => Api.delete('/accounts/internal-orders/${o['id']}'))) setState(() => _tick++);
                  }, true),
              ]),
            ),
        ]),
      ),
    );
  }
}

// ── Opening balances ─────────────────────────────────────────────────────────

class _ObLine {
  int? glId;
  String? glLabel;
  final dr = TextEditingController();
  final cr = TextEditingController();
}

class _ObBill {
  int? partyId;
  String? partyLabel;
  final number = TextEditingController();
  DateTime? date;
  DateTime? due;
  final amount = TextEditingController();
}

double _amt(TextEditingController c) => double.tryParse(c.text.trim()) ?? 0;

class _Opening extends StatefulWidget {
  const _Opening();

  @override
  State<_Opening> createState() => _OpeningState();
}

class _OpeningState extends State<_Opening> {
  DateTime? _asOf;
  final _narration = TextEditingController(text: 'Opening balances');
  final _ledgers = [_ObLine()];
  final _vendors = <_ObBill>[];
  final _customers = <_ObBill>[];
  bool _posting = false;
  String? _error;
  String? _posted;

  @override
  void initState() {
    super.initState();
    Api.get('/accounts/setup').then((s) {
      final fy = asJson(asJson(s)['current_financial_year']);
      if (mounted && fy['start_date'] != null) setState(() => _asOf = isoToDate(fy['start_date']));
    }).catchError((_) {});
  }

  bool get _canManage => isFinanceManager && finCan('opening_balances', 'edit');

  Future<void> _post(double total) async {
    final ok = await confirmDialog(context,
        title: 'Post opening balances?',
        message:
            'This posts one Opening Balance voucher dated ${fmtDate(_asOf)} for ${inr(total)}. It can only be done once — to redo it, the voucher has to be reversed first.',
        confirmLabel: 'Post Opening Balances');
    if (!ok || !mounted) return;
    setState(() {
      _posting = true;
      _error = null;
    });
    try {
      final res = asJson(await Api.post('/accounts/opening-balances', data: {
        'as_of': dateOrNull(_asOf),
        'narration': _blank(_narration),
        'ledger_lines': [
          for (final l in _ledgers)
            if (l.glId != null || _amt(l.dr) != 0 || _amt(l.cr) != 0) {'gl_account_id': l.glId ?? 0, 'debit_amount': _amt(l.dr), 'credit_amount': _amt(l.cr)},
        ],
        'vendor_bills': [
          for (final b in _vendors)
            {'vendor_id': b.partyId ?? 0, 'bill_number': b.number.text.trim(), 'bill_date': dateOrNull(b.date), 'due_date': dateOrNull(b.due), 'amount': _amt(b.amount)},
        ],
        'customer_bills': [
          for (final b in _customers)
            {'customer_id': b.partyId ?? 0, 'invoice_number': b.number.text.trim(), 'invoice_date': dateOrNull(b.date), 'due_date': dateOrNull(b.due), 'amount': _amt(b.amount)},
        ],
      }));
      setState(() {
        _posted = 'Opening balances posted as ${res['entry_number']} — total ${inr(res['total'])}. Party bills now show in outstanding and aging.';
        _ledgers
          ..clear()
          ..add(_ObLine());
        _vendors.clear();
        _customers.clear();
      });
    } catch (e) {
      setState(() => _error = 'Could not post the opening balances. ${ApiClient.describe(e)}');
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  Widget _bill(_ObBill b, bool vendor, VoidCallback remove) => Container(
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.white, border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(12)),
        child: Column(children: [
          Row(children: [
            Expanded(
              child: AppSelect<int>(
                label: vendor ? 'Vendor' : 'Customer',
                value: b.partyId,
                valueLabel: b.partyLabel,
                loadOptions: vendor ? FinLookups.vendors : customerOptions,
                onChanged: (o) => setState(() {
                  b.partyId = o?.value;
                  b.partyLabel = o?.label;
                }),
              ),
            ),
            IconButton(icon: const Icon(Icons.close_rounded, color: Brand.danger), onPressed: remove),
          ]),
          const SizedBox(height: 8),
          AppTextField(label: vendor ? 'Bill no.' : 'Invoice no.', controller: b.number),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: DateField(label: vendor ? 'Bill date' : 'Invoice date', value: b.date, onChanged: (d) => setState(() => b.date = d))),
            const SizedBox(width: 8),
            Expanded(child: DateField(label: 'Due date', value: b.due, onChanged: (d) => setState(() => b.due = d))),
          ]),
          const SizedBox(height: 8),
          AppTextField(label: 'Amount (₹)', controller: b.amount, keyboardType: AppTextField.number, onChanged: (_) => setState(() {})),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final ledgerDr = round2(_ledgers.fold<double>(0, (s, l) => s + _amt(l.dr)));
    final ledgerCr = round2(_ledgers.fold<double>(0, (s, l) => s + _amt(l.cr)));
    final vTotal = round2(_vendors.fold<double>(0, (s, b) => s + _amt(b.amount)));
    final cTotal = round2(_customers.fold<double>(0, (s, b) => s + _amt(b.amount)));
    final totalDr = round2(ledgerDr + cTotal);
    final totalCr = round2(ledgerCr + vTotal);
    final diff = round2(totalDr - totalCr);
    final balanced = diff.abs() < 0.005 && totalDr > 0;
    return Scaffold(
      backgroundColor: Colors.transparent,
      bottomNavigationBar: _canManage
          ? SafeArea(
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Brand.border))),
                child: Row(children: [
                  Expanded(
                    child: Text(
                      !balanced
                          ? (totalDr == 0 ? 'Enter at least one balance.' : 'Debits must equal credits before posting.')
                          : (_asOf == null ? 'Pick the opening date.' : 'Balanced'),
                      style: TextStyle(fontSize: 12.5, color: balanced && _asOf != null ? Brand.success : Brand.danger),
                    ),
                  ),
                  actionBtn(_posting ? 'Posting…' : 'Post Opening Balances',
                      balanced && _asOf != null && !_posting ? () => _post(totalDr) : null,
                      primary: true),
                ]),
              ),
            )
          : null,
      body: ListView(padding: const EdgeInsets.only(top: 8, bottom: 24), children: [
        const InfoBanner('Posted once, as one Opening Balance voucher dated the first day the books start in this system.'),
        if (_error != null) padded(ErrorBanner(_error!)),
        if (_posted != null) InfoBanner(_posted!, tone: Tone.success),
        if (!_canManage) const InfoBanner('Only a Finance Manager (or admin) can post opening balances.', tone: Tone.warning),
        padded(DateField(label: 'Opening date (first day of books)', required: true, value: _asOf, onChanged: (d) => setState(() => _asOf = d))),
        padded(AppTextField(label: 'Narration', controller: _narration)),
        SectionTitle('Ledger balances',
            action: TextButton(onPressed: () => setState(() => _ledgers.add(_ObLine())), child: const Text('+ Add line'))),
        padded(const Text(
            'Assets, liabilities and capital only — party control accounts are entered bill-wise below, and income / expense ledgers start each year at zero.',
            style: TextStyle(fontSize: 12, color: Brand.muted))),
        for (final l in _ledgers)
          Container(
            margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: Colors.white, border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(12)),
            child: Column(children: [
              Row(children: [
                Expanded(
                  child: AppSelect<int>(
                    label: 'Ledger',
                    value: l.glId,
                    valueLabel: l.glLabel,
                    loadOptions: (q) async => (await FinLookups.ledgerOptions(
                            filter: (a) => a['is_control_account'] != true && a['account_type'] != 'revenue' && a['account_type'] != 'expense'))
                        .where((o) => q.isEmpty || o.label.toLowerCase().contains(q.toLowerCase()))
                        .toList(),
                    onChanged: (o) => setState(() {
                      l.glId = o?.value;
                      l.glLabel = o?.label;
                    }),
                  ),
                ),
                if (_ledgers.length > 1)
                  IconButton(icon: const Icon(Icons.close_rounded, color: Brand.danger), onPressed: () => setState(() => _ledgers.remove(l))),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(
                    child: AppTextField(
                        label: 'Debit (₹)', controller: l.dr, keyboardType: AppTextField.number, onChanged: (v) => setState(() => v.isNotEmpty ? l.cr.clear() : null))),
                const SizedBox(width: 8),
                Expanded(
                    child: AppTextField(
                        label: 'Credit (₹)', controller: l.cr, keyboardType: AppTextField.number, onChanged: (v) => setState(() => v.isNotEmpty ? l.dr.clear() : null))),
              ]),
            ]),
          ),
        SectionTitle('Vendor bills (unpaid)', action: TextButton(onPressed: () => setState(() => _vendors.add(_ObBill())), child: const Text('+ Add bill'))),
        for (final b in [..._vendors]) _bill(b, true, () => setState(() => _vendors.remove(b))),
        SectionTitle('Customer invoices (unpaid)',
            action: TextButton(onPressed: () => setState(() => _customers.add(_ObBill())), child: const Text('+ Add invoice'))),
        for (final b in [..._customers]) _bill(b, false, () => setState(() => _customers.remove(b))),
        DetailSection('Totals', children: [
          AmountRow('Ledger debits', inr(ledgerDr)),
          AmountRow('Customer invoices (Dr)', inr(cTotal)),
          AmountRow('Ledger credits', inr(ledgerCr)),
          AmountRow('Vendor bills (Cr)', inr(vTotal)),
          AmountRow('Total debit', inr(totalDr), bold: true),
          AmountRow('Total credit', inr(totalCr), bold: true),
          AmountRow(diff.abs() < 0.005 ? 'Balanced' : 'Difference', inr(diff.abs()), bold: true, color: diff.abs() < 0.005 ? Brand.success : Brand.danger),
        ]),
      ]),
    );
  }
}
