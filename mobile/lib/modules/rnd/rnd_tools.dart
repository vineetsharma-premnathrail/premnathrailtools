import 'dart:convert';

import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';

/// R&D › Engineering Tools (portal: app/dashboard/rnd/tools).
///
/// The calculators' formulas are owner-protected and their portal pages also
/// work out derived values on screen, so the app never re-does that maths:
/// each calculator opens in the portal. Calculation History is native.

const _tools = [
  (
    'braking',
    'braking',
    'Braking Calculator',
    'Calculate braking distances, deceleration, and gross braking ratio for rail and road scenarios.',
    Icons.album_outlined,
  ),
  (
    'hydraulic',
    'hydraulic',
    'Hydraulic Calculator',
    'Hydraulic motor/pump sizing, system requirements, and sensitivity analysis.',
    Icons.water_drop_outlined,
  ),
  (
    'qmax',
    'qmax',
    'Qmax Calculator',
    'Maximum load capacity calculations for rail wheels based on material properties.',
    Icons.speed_outlined,
  ),
  (
    'load_distribution',
    'load-distribution',
    'Load Distribution',
    'Wheel load calculations (Q1-Q4) and safety margin validation for vehicles.',
    Icons.bar_chart_rounded,
  ),
  (
    'tractive_effort',
    'tractive-effort',
    'Tractive Effort',
    'Tractive force requirements, power calculations, and OHE current for rail traction.',
    Icons.keyboard_double_arrow_right_rounded,
  ),
  (
    'vehicle_performance',
    'vehicle-performance',
    'Vehicle Performance',
    'Locomotive traction capability, performance envelopes, and gear selection analysis.',
    Icons.bolt_outlined,
  ),
  (
    'spline',
    'spline',
    'Spline Calculator',
    'Spline shaft strength analysis, safety factor calculations, and design validation.',
    Icons.settings_outlined,
  ),
];

const toolLabels = {
  'braking': 'Braking',
  'hydraulic': 'Hydraulic',
  'qmax': 'Qmax',
  'load_distribution': 'Load Distribution',
  'tractive_effort': 'Tractive Effort',
  'vehicle_performance': 'Vehicle Performance',
  'spline': 'Spline',
};
const _toolRoutes = {
  'braking': 'braking',
  'hydraulic': 'hydraulic',
  'qmax': 'qmax',
  'load_distribution': 'load-distribution',
  'tractive_effort': 'tractive-effort',
  'vehicle_performance': 'vehicle-performance',
  'spline': 'spline',
};

class EngineeringTools extends StatelessWidget {
  const EngineeringTools({super.key});

  @override
  Widget build(BuildContext context) {
    final tools = [
      for (final t in _tools)
        if (RndPerm.view(t.$1)) t,
    ];
    final history = RndPerm.view('history');
    return ListView(
      padding: const EdgeInsets.only(bottom: 32),
      children: [
        const PageHeader(
          'R&D Engineering Tools',
          subtitle: 'Calculation tools for braking, hydraulics, load capacity, and traction analysis.',
        ),
        if (tools.isEmpty && !history)
          const EmptyView(
            'You have no calculator access yet. Ask an administrator to grant the calculator tabs you need under R&D '
            'in the Permission Matrix.',
          ),
        if (tools.isNotEmpty)
          const NoteBox(
            'Calculators open in the portal so their results always match the approved formulas.',
            color: Brand.muted,
          ),
        for (final t in tools)
          _ToolCard(
            icon: t.$5,
            title: t.$3,
            description: t.$4,
            trailing: const Icon(Icons.open_in_new_rounded, color: Brand.muted),
            onTap: () => runAction(context, () => Files.openInPortal('/dashboard/rnd/${t.$2}')),
          ),
        if (history)
          _ToolCard(
            icon: Icons.history_rounded,
            title: 'Calculation History',
            description: 'Every saved calculation from the tools above — reopen, rename or compare past results.',
            trailing: const Icon(Icons.chevron_right_rounded, color: Brand.muted),
            onTap: () => openScreen(context, const SubPage(title: 'Calculation History', body: CalculationHistory())),
          ),
      ],
    );
  }
}

class _ToolCard extends StatelessWidget {
  const _ToolCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.trailing,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final String description;
  final Widget trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
    child: Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: const Color(0x1AF4713B), borderRadius: BorderRadius.circular(12)),
                child: Icon(icon, color: Brand.primary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Brand.heading),
                    ),
                    const SizedBox(height: 2),
                    Text(description, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  ],
                ),
              ),
              trailing,
            ],
          ),
        ),
      ),
    ),
  );
}

/// Calculation History (portal: app/dashboard/rnd/history).
class CalculationHistory extends StatefulWidget {
  const CalculationHistory({super.key});

  @override
  State<CalculationHistory> createState() => _CalculationHistoryState();
}

class _CalculationHistoryState extends State<CalculationHistory> {
  final _list = GlobalKey<ApiListViewState>();
  bool _admin = false;
  int? _userId;
  String? _userLabel;
  String _tool = '';
  List<Json> _rows = [];

  void _reload() => _list.currentState?.reload();

  Future<ApiPage> _load(int page, String search) async {
    final data = _admin
        ? await Api.get('/rnd/history/admin/list', query: {'tool_name': _tool, 'user_id': _userId})
        : await Api.get('/rnd/history/list', query: {'tool_name': _tool});
    final rows = jsonList(data);
    if (mounted) setState(() => _rows = rows);
    final q = search.toLowerCase();
    return ApiPage(rows.where((r) => q.isEmpty || (str(r, 'calculation_name') ?? '').toLowerCase().contains(q)).toList());
  }

  Future<void> _rename(Json r) async {
    final name = await promptDialog(
      context,
      title: 'Rename calculation',
      label: 'Calculation name',
      confirmLabel: 'Save',
      message: str(r, 'calculation_name'),
    );
    if (name == null || !mounted) return;
    if (name.length > 255) {
      showSnack(context, 'Enter a name for the calculation (up to 255 characters).', error: true);
      return;
    }
    if (await runAction(context, () => Api.patch('/rnd/history/rename/${r['id']}', data: {'calculation_name': name}))) _reload();
  }

  Future<void> _delete(Json r) async {
    final ok = await confirmDialog(
      context,
      title: 'Delete calculation',
      message: 'Delete this saved calculation? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    );
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.delete('/rnd/history/delete/${r['id']}'))) _reload();
  }

  void _actions(Json r) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      builder: (s) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.visibility_outlined),
              title: const Text('View saved inputs and results'),
              onTap: () {
                Navigator.pop(s);
                openScreen(context, _HistoryDetail(id: intOf(r['id']) ?? 0, title: str(r, 'calculation_name') ?? 'Calculation'));
              },
            ),
            if (_toolRoutes[r['tool_name']] != null)
              ListTile(
                leading: const Icon(Icons.open_in_new_rounded),
                title: const Text('Open in tool & recalculate (portal)'),
                onTap: () {
                  Navigator.pop(s);
                  runAction(context, () => Files.openInPortal('/dashboard/rnd/${_toolRoutes[r['tool_name']]}'));
                },
              ),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('Rename'),
              onTap: () {
                Navigator.pop(s);
                _rename(r);
              },
            ),
            if (RndPerm.can('history', 'delete'))
              ListTile(
                leading: const Icon(Icons.delete_outline, color: Brand.danger),
                title: const Text('Delete', style: TextStyle(color: Brand.danger)),
                onTap: () {
                  Navigator.pop(s);
                  _delete(r);
                },
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tools = _rows.map((r) => r['tool_name']).toSet();
    String latest = '—';
    for (final r in _rows) {
      final c = str(r, 'created_at') ?? '';
      if (latest == '—' || c.compareTo(latest) > 0) latest = c;
    }
    final isAdmin = Perm.user['role'] == 'admin';
    return ApiListView(
      key: _list,
      load: _load,
      searchHint: 'Search by name…',
      emptyText: 'No saved calculations yet.',
      header: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PageHeader(
            'Calculation History',
            subtitle: _admin ? "Admin view — all users' calculations" : 'My saved R&D calculations · View · Rename · Delete',
          ),
          if (isAdmin)
            ChipRow(
              children: [
                CountChip(
                  _admin ? 'My History' : 'View All Users',
                  null,
                  selected: _admin,
                  onTap: () {
                    setState(() {
                      _admin = !_admin;
                      _userId = null;
                      _userLabel = null;
                    });
                    _reload();
                  },
                ),
                if (_admin) CountChip(_userLabel ?? 'All Users', null, selected: _userId != null, onTap: _pickUser),
              ],
            ),
          ChipRow(
            children: [
              CountChip('Total Records', _rows.length),
              CountChip('Tools Used', tools.length),
              CountChip('Latest', latest == '—' ? '—' : fmtDate(latest)),
            ],
          ),
          ChipRow(
            children: [
              CountChip(
                'All',
                null,
                selected: _tool.isEmpty,
                onTap: () {
                  setState(() => _tool = '');
                  _reload();
                },
              ),
              for (final e in toolLabels.entries)
                CountChip(
                  e.value,
                  null,
                  selected: _tool == e.key,
                  onTap: () {
                    setState(() => _tool = _tool == e.key ? '' : e.key);
                    _reload();
                  },
                ),
            ],
          ),
        ],
      ),
      itemBuilder: (ctx, r, reload) => RecordCard(
        title: str(r, 'calculation_name') ?? '—',
        subtitle: _admin ? str(r, 'user_name') : null,
        trailing: Padding(
          padding: const EdgeInsets.only(left: 6),
          child: Pill(toolLabels[r['tool_name']] ?? txt(r['tool_name']), Brand.primaryActive),
        ),
        meta: [('Saved On', fmtDateTime(r['created_at']))],
        onTap: () => _actions(r),
      ),
    );
  }

  Future<void> _pickUser() async {
    List<Json> users;
    try {
      users = jsonList(await Api.get('/rnd/history/admin/users'));
    } catch (e) {
      if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      return;
    }
    if (!mounted) return;
    final picked = await showModalBottomSheet<Json>(
      context: context,
      backgroundColor: Colors.white,
      builder: (s) => SafeArea(
        child: ListView(
          children: [
            ListTile(title: const Text('All Users'), onTap: () => Navigator.pop(s, <String, dynamic>{})),
            for (final u in users)
              ListTile(title: Text('${u['name']}'), subtitle: Text('${u['email'] ?? ''}'), onTap: () => Navigator.pop(s, u)),
          ],
        ),
      ),
    );
    if (picked == null) return;
    setState(() {
      _userId = intOf(picked['id']);
      _userLabel = str(picked, 'name');
    });
    _reload();
  }
}

/// A saved calculation's stored inputs and results, shown as they were saved.
class _HistoryDetail extends StatelessWidget {
  const _HistoryDetail({required this.id, required this.title});
  final int id;
  final String title;

  static List<Widget> _rows(Object? v) {
    if (v is Map) {
      return [
        for (final e in v.entries)
          if (e.value is Map || (e.value is List && (e.value as List).any((x) => x is Map || x is List)))
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: Text(humanize(e.key), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
              children: [
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Text(
                    const JsonEncoder.withIndent('  ').convert(e.value),
                    style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                  ),
                ),
              ],
            )
          else
            KeyValue(humanize(e.key), e.value is List ? (e.value as List).join(', ') : e.value),
      ];
    }
    return [Text(txt(v))];
  }

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: title,
      body: ApiLoader<Json>(
        load: () async => jsonMap(await Api.get('/rnd/history/detail/$id')),
        builder: (ctx, d, reload) => ListView(
          padding: const EdgeInsets.only(top: 12, bottom: 32),
          children: [
            DetailSection(
              'Calculation',
              children: [
                KeyValue('Tool', toolLabels[d['tool_name']] ?? d['tool_name']),
                KeyValue('Saved On', fmtDateTime(d['created_at'])),
              ],
            ),
            DetailSection('Inputs', children: _rows(d['inputs'])),
            DetailSection('Results', children: _rows(d['results'])),
          ],
        ),
      ),
    );
  }
}

/// R&D Settings (gear) - portal: app/dashboard/rnd/settings.
class RndSettingsScreen extends StatelessWidget {
  const RndSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'R&D Settings',
      body: ApiLoader<Json>(
        load: () async => jsonMap(await Api.get('/rnd/settings')),
        builder: (ctx, s, reload) {
          final heads = jsonList(s['heads']).map((h) => h['name']).whereType<String>().join(', ');
          return ListView(
            padding: const EdgeInsets.only(bottom: 32),
            children: [
              const PageHeader(
                'R&D Settings',
                subtitle: 'Who heads R&D and who works on Technical Offers — both are set elsewhere; this page explains where.',
              ),
              DetailSection(
                'R&D Head',
                children: [
                  Text(
                    heads.isNotEmpty
                        ? '$heads — from the R&D department in Organization › Department. The head receives new requirements, can always '
                              'create Technical Offers and releases them to BD.'
                        : 'No R&D head is set in Organization › Department, so every R&D user acts as head until one is.',
                    style: const TextStyle(fontSize: 13.5, color: Brand.body),
                  ),
                ],
              ),
              const DetailSection(
                'Technical Offer team',
                children: [
                  Text(
                    'Who can create or see Technical Offers is given in Organization › Role & Permissions → R&D → Requirements → '
                    'Technical Offer team (every requirement): View = see every requirement and its offers, Create = also start and '
                    'edit offers. Tick it on a role, or for one person as their extra permission.',
                    style: TextStyle(fontSize: 13.5, color: Brand.body),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}
