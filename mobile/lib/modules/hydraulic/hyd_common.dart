import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

// Shared bits of the Hydraulic & Pneumatic module - the phone copy of
// frontend/src/components/hydraulic/labels.ts and the page-local helpers.

const hydModule = 'hydraulic';

// ── Labels (keys match the backend constants) ──────────────────────────────

const systemTypeLabels = {'hydraulic': 'Hydraulic', 'pneumatic': 'Pneumatic'};
const mediaTypeLabels = {'hydraulic': 'Hydraulic', 'pneumatic': 'Pneumatic', 'both': 'Both'};
const systemTypeHex = {'hydraulic': '#0369a1', 'pneumatic': '#7C3AED', 'both': '#0f766e'};

const componentCategoryLabels = {
  'pump': 'Pump', 'motor': 'Hydraulic Motor', 'cylinder': 'Cylinder', 'directional_valve': 'Directional Valve',
  'pressure_valve': 'Pressure Control Valve', 'flow_valve': 'Flow Control Valve', 'check_valve': 'Check Valve',
  'proportional_valve': 'Proportional / Servo Valve', 'accumulator': 'Accumulator', 'filter': 'Filter',
  'reservoir': 'Reservoir / Tank', 'cooler': 'Cooler / Heat Exchanger', 'hose': 'Hose', 'fitting': 'Fitting / Adaptor',
  'manifold': 'Manifold Block', 'compressor': 'Compressor', 'air_receiver': 'Air Receiver', 'frl_unit': 'FRL Unit',
  'air_dryer': 'Air Dryer', 'pneumatic_actuator': 'Pneumatic Actuator', 'solenoid_valve': 'Solenoid Valve',
  'sensor': 'Sensor / Transducer', 'gauge': 'Gauge', 'seal': 'Seal', 'other': 'Other',
};

/// Which rating fields a component category uses.
const categoryFields = {
  'pump': ['rated_pressure_bar', 'max_pressure_bar', 'flow_rate_lpm', 'displacement_cc', 'port_size', 'mounting'],
  'motor': ['rated_pressure_bar', 'max_pressure_bar', 'flow_rate_lpm', 'displacement_cc', 'port_size', 'mounting'],
  'cylinder': ['rated_pressure_bar', 'max_pressure_bar', 'bore_mm', 'rod_mm', 'stroke_mm', 'port_size', 'mounting', 'seal_material'],
  'pneumatic_actuator': ['rated_pressure_bar', 'bore_mm', 'rod_mm', 'stroke_mm', 'port_size', 'mounting', 'seal_material'],
  'compressor': ['rated_pressure_bar', 'max_pressure_bar', 'flow_rate_lpm', 'port_size'],
  'seal': ['bore_mm', 'rod_mm', 'seal_material'],
};
const defaultCategoryFields = ['rated_pressure_bar', 'max_pressure_bar', 'flow_rate_lpm', 'port_size', 'mounting'];

/// Rating fields: key → (label, unit, isText).
const ratingFields = <String, (String, String, bool)>{
  'rated_pressure_bar': ('Rated Pressure', 'bar', false),
  'max_pressure_bar': ('Max / Peak Pressure', 'bar', false),
  'flow_rate_lpm': ('Flow', 'L/min', false),
  'displacement_cc': ('Displacement', 'cc/rev', false),
  'bore_mm': ('Bore', 'mm', false),
  'rod_mm': ('Rod', 'mm', false),
  'stroke_mm': ('Stroke', 'mm', false),
  'port_size': ('Port Size', '', true),
  'mounting': ('Mounting', '', true),
  'seal_material': ('Seal Material', '', true),
};

const systemStatusLabels = {
  'design': 'Design', 'under_build': 'Under Build', 'testing': 'Testing', 'commissioned': 'Commissioned',
  'in_service': 'In Service', 'under_maintenance': 'Under Maintenance', 'decommissioned': 'Decommissioned',
};
const systemStatusHex = {
  'design': '#78716c', 'under_build': '#2563EB', 'testing': '#7C3AED', 'commissioned': '#0f766e',
  'in_service': '#16A34A', 'under_maintenance': '#F59E0B', 'decommissioned': '#57534e',
};

const testTypeLabels = {
  'pressure_test': 'Pressure Test', 'proof_test': 'Proof Test', 'leak_test': 'Leak Test', 'flow_test': 'Flow Test',
  'functional_test': 'Functional Test', 'performance_test': 'Performance Test',
  'cleanliness_test': 'Oil Cleanliness (ISO 4406)', 'relief_valve_setting': 'Relief Valve Setting',
  'cylinder_drift': 'Cylinder Drift', 'endurance_test': 'Endurance Test',
  'air_quality_test': 'Air Quality (ISO 8573)', 'other': 'Other',
};

const serviceTypeLabels = {
  'preventive': 'Preventive', 'corrective': 'Corrective', 'breakdown': 'Breakdown', 'oil_change': 'Oil Change',
  'filter_change': 'Filter Change', 'overhaul': 'Overhaul', 'commissioning': 'Commissioning',
  'inspection': 'Inspection', 'modification': 'Modification',
};

const documentTypeLabels = {
  'circuit_diagram': 'Circuit Diagram', 'schematic': 'Schematic', 'ga_drawing': 'GA Drawing', 'datasheet': 'Datasheet',
  'test_certificate': 'Test Certificate', 'test_report': 'Test Report', 'manual': 'Manual', 'photo': 'Photo',
  'other': 'Other',
};
const documentTypeHex = {
  'circuit_diagram': '#0369a1', 'schematic': '#7C3AED', 'ga_drawing': '#4f46e5', 'datasheet': '#2563EB',
  'test_certificate': '#16A34A', 'test_report': '#0f766e', 'manual': '#F59E0B', 'photo': '#db2777', 'other': '#78716c',
};

const resultLabels = {'pending': 'Pending', 'pass': 'Pass', 'fail': 'Fail', 'conditional': 'Conditional'};
const resultHex = {'pending': '#78716c', 'pass': '#16A34A', 'fail': '#DC2626', 'conditional': '#F59E0B'};

// ── Small helpers ────────────────────────────────────────────────────────────

Color hx(String? hex) {
  final h = (hex ?? '#78716c').replaceAll('#', '');
  return Color(int.parse('FF$h', radix: 16));
}

/// Label of an enum value, or the raw value.
String lbl(Map<String, String> map, Object? v) => map[v?.toString() ?? ''] ?? txt(v);

/// The portal's coloured pill.
Widget pill(Map<String, String> labels, Map<String, String> hexes, Object? value) =>
    StatusBadge(lbl(labels, value), color: hx(hexes[value?.toString() ?? '']));

num? toNum(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);
int? toInt(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));

/// "1,250 bar" or '—'.
String withUnit(Object? v, String unit) {
  final n = toNum(v);
  return n == null ? '—' : '${fmtNumber(n)} $unit';
}

/// Flow is L/min for oil and Nl/min (free air) for pneumatic systems.
String flowUnit(Object? systemType) => systemType == 'pneumatic' ? 'Nl/min' : 'L/min';

/// "₹1,25,000.00" or '—'.
String inr(Object? v) => fmtMoney(v);

/// Text field value → number for the API (null when blank).
num? numOrNull(String v) => v.trim().isEmpty ? null : num.tryParse(v.trim());

/// Number → text field value.
String numStr(Object? v) => v == null ? '' : v.toString();

String? blankToNull(String v) => v.trim().isEmpty ? null : v.trim();

List<Json> rowsOf(dynamic data) => ApiPage.from(data).rows;

/// Opens a screen and waits until it is closed (lists reload after).
Future<void> pushPage(BuildContext context, Widget screen) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));

Json asJson(dynamic d) => Map<String, dynamic>.from(d as Map);

// ── Permissions ──────────────────────────────────────────────────────────────

bool hydCan(String tab, String action) => Perm.can(hydModule, tab, action);
bool hydCanFeature(String tab, String feature, String action) => Perm.canFeature(hydModule, tab, feature, action);

/// Portal canDelete: Delete on the tab AND the user created it (admins any).
bool hydCanDelete(String tab, Object? createdById) {
  if (!hydCan(tab, 'delete')) return false;
  if (Perm.isAdmin) return true;
  final owner = toInt(createdById);
  return owner == null || owner == Perm.userId;
}

/// Hydraulic › BOM › Prices & costs (labels.ts useHydCosts).
bool hydSeeCosts() => hydCanFeature('bom', 'costs', 'view') || !hydCan('bom', 'view');

/// Portal filterTabsByAccess: a tab shows when the user's tab_access for the
/// module lists it (no entry = admin / unrestricted).
bool hydTabVisible(String subtabKey) {
  final ta = Perm.user['tab_access'];
  if (ta is! Map) return true;
  final allowed = ta[hydModule];
  if (allowed is! List) return true;
  return allowed.contains(subtabKey);
}

/// Role-wise UI visibility (portal lib/visibility.ts) for one screen key.
class HydVis {
  HydVis(String key) : _rule = Perm.isAdmin ? null : _ruleFor(key);
  final Map? _rule;

  static Map? _ruleFor(String key) {
    final v = Perm.user['visibility'];
    if (v is! Map) return null;
    final r = v[key];
    return r is Map ? r : null;
  }

  bool showSection(String section) => !((_rule?['hidden_sections'] as List?) ?? const []).contains(section);

  bool anySection(List<String> sections) => sections.any(showSection);

  bool showColumn(String table, String column) {
    final cols = _rule?['hidden_columns'];
    if (cols is! Map) return true;
    return !((cols[table] as List?) ?? const []).contains(column);
  }

  /// Dropdown values narrowed to what the role offers (all when unrestricted).
  List<MapEntry<String, String>> options(String dropdown, Map<String, String> all) {
    final entries = all.entries.toList();
    final opts = _rule?['options'];
    final allowed = opts is Map ? opts[dropdown] : null;
    if (allowed is! List || allowed.isEmpty) return entries;
    final kept = entries.where((e) => allowed.contains(e.key)).toList();
    return kept.isEmpty ? entries : kept;
  }
}

/// The role's "Assign to" rule for one picker (portal useAssigneeFilter).
Future<bool Function(int)> hydAssigneeFilter(String key) async {
  try {
    final d = await Api.get('/assignee-rules/allowed', query: {'key': key});
    if (d is Map && d['restricted'] == true && d['user_ids'] is List) {
      final ids = (d['user_ids'] as List).map(toInt).whereType<int>().toSet();
      return (id) => ids.contains(id);
    }
  } catch (_) {/* nothing hidden; the server still checks */}
  return (_) => true;
}

/// Loader for an AppSelect fed by a /hydraulic/lookups/* list: fetched when
/// the picker opens, filtered by the search text on the phone.
Future<List<Option<int>>> Function(String) hydLookup(String path,
    {Map<String, dynamic>? query, bool Function(Json row)? where, void Function(List<Json> rows)? onRows}) {
  List<Json>? cache;
  return (search) async {
    cache ??= rowsOf(await Api.get(path, query: query));
    onRows?.call(cache!);
    final q = search.trim().toLowerCase();
    return [
      for (final r in cache!)
        if ((where == null || where(r)) && (q.isEmpty || txt(r['label']).toLowerCase().contains(q)))
          Option<int>(toInt(r['id']) ?? 0, txt(r['label'])),
    ];
  };
}

/// Option list from a label map.
List<Option<String>> optionsOf(Map<String, String> map) => [for (final e in map.entries) Option(e.key, e.value)];

// ── Layout bits ──────────────────────────────────────────────────────────────

/// Section heading inside a form sheet (portal SheetSection title).
class FormHeading extends StatelessWidget {
  const FormHeading(this.title, {super.key, this.trailing});
  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Row(
          children: [
            Expanded(
              child: Text(title,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
            ),
            ?trailing,
          ],
        ),
      );
}

/// Muted help text under fields (portal sheetHint).
class Hint extends StatelessWidget {
  const Hint(this.text, {super.key, this.color = Brand.muted});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(text, style: TextStyle(fontSize: 12.5, color: color));
}

/// Two fields side by side.
class TwoUp extends StatelessWidget {
  const TwoUp(this.a, this.b, {super.key});
  final Widget a;
  final Widget b;

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [Expanded(child: a), const SizedBox(width: 10), Expanded(child: b)],
      );
}

/// Read-only value box in a form (portal readOnlyBox).
class ReadOnlyField extends StatelessWidget {
  const ReadOnlyField({super.key, required this.label, required this.value, this.color});
  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) => InputDecorator(
        decoration: fieldDecoration(label).copyWith(fillColor: Brand.background),
        child: Text(value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 15, color: color ?? Brand.body, fontWeight: color != null ? FontWeight.w600 : null)),
      );
}

/// Coloured note box (amber / green / red banners on the portal).
class NoteBox extends StatelessWidget {
  const NoteBox(this.text, {super.key, this.title, this.hex = '#F59E0B'});
  final String text;
  final String? title;
  final String hex;

  @override
  Widget build(BuildContext context) {
    final c = hx(hex);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: c.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: c.withValues(alpha: 0.35)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (title != null) ...[
              Text(title!, style: TextStyle(fontWeight: FontWeight.w700, color: c, fontSize: 13.5)),
              const SizedBox(height: 4),
            ],
            Text(text, style: const TextStyle(fontSize: 13.5, color: Brand.body)),
          ],
        ),
      ),
    );
  }
}

/// Compact list row inside a detail section (related records, revisions).
class MiniRow extends StatelessWidget {
  const MiniRow({super.key, required this.code, required this.title, this.meta, this.badge, this.onTap, this.highlight = false});
  final String code;
  final String title;
  final String? meta;
  final Widget? badge;
  final VoidCallback? onTap;
  final bool highlight;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Container(
          color: highlight ? Brand.primarySoft : null,
          padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 4),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(code, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.heading)),
                    if (title.isNotEmpty) Text(title, style: const TextStyle(fontSize: 13, color: Brand.body)),
                    if (meta != null && meta!.isNotEmpty)
                      Text(meta!, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  ],
                ),
              ),
              if (badge != null) ...[const SizedBox(width: 8), badge!],
            ],
          ),
        ),
      );
}

// ── Buttons (bottom bar) ─────────────────────────────────────────────────────

Widget primaryBtn(String label, VoidCallback? onPressed) => FilledButton(
      style: FilledButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 16)),
      onPressed: onPressed,
      child: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
    );

Widget secondaryBtn(String label, VoidCallback? onPressed) => OutlinedButton(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 44),
        foregroundColor: Brand.body,
        side: const BorderSide(color: Brand.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      onPressed: onPressed,
      child: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
    );

Widget dangerBtn(String label, VoidCallback? onPressed) => OutlinedButton(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 44),
        foregroundColor: Brand.danger,
        side: BorderSide(color: Brand.danger.withValues(alpha: 0.4)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      onPressed: onPressed,
      child: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
    );

/// Small orange text action ("+ New circuit", "View").
Widget linkBtn(String label, VoidCallback? onPressed, {Color color = Brand.primaryActive}) => TextButton(
      style: TextButton.styleFrom(
          minimumSize: const Size(0, 36), padding: const EdgeInsets.symmetric(horizontal: 8), foregroundColor: color),
      onPressed: onPressed,
      child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
    );

// ── Filters (portal filter row of Selects) ───────────────────────────────────

/// One filter pill: "Status: All ▾" - opens the choices in a sheet.
class FilterPill extends StatelessWidget {
  const FilterPill({super.key, required this.label, required this.value, required this.options, required this.onChanged, this.allLabel = 'All'});
  final String label;
  final String value;

  /// value → label; '' is the "all" choice.
  final Map<String, String> options;
  final ValueChanged<String> onChanged;
  final String allLabel;

  @override
  Widget build(BuildContext context) {
    final active = value.isNotEmpty;
    final text = active ? (options[value] ?? value) : allLabel;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Material(
        color: active ? Brand.primarySoft : Colors.white,
        shape: StadiumBorder(side: BorderSide(color: active ? Brand.primary : Brand.border)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: () async {
            final picked = await showModalBottomSheet<String>(
              context: context,
              isScrollControlled: true,
              useSafeArea: true,
              backgroundColor: Colors.white,
              shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
              builder: (ctx) => FractionallySizedBox(
                heightFactor: 0.7,
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
                      child: Row(children: [
                        Expanded(
                            child: Text(label,
                                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading))),
                        IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
                      ]),
                    ),
                    Expanded(
                      child: ListView(
                        children: [
                          for (final e in {'': allLabel, ...options}.entries)
                            ListTile(
                              title: Text(e.value),
                              trailing: e.key == value ? const Icon(Icons.check_rounded, color: Brand.primary) : null,
                              onTap: () => Navigator.pop(ctx, e.key),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
            if (picked != null) onChanged(picked);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Text('$label: $text',
                  style: TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w600, color: active ? Brand.primaryActive : Brand.body)),
              const SizedBox(width: 2),
              Icon(Icons.expand_more_rounded, size: 18, color: active ? Brand.primaryActive : Brand.muted),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Horizontally scrolling filter row.
class FilterBar extends StatelessWidget {
  const FilterBar({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 46,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 4, 8, 6),
          children: children,
        ),
      );
}

/// "N records" line above a list (portal RowCount).
class RowCountLine extends StatelessWidget {
  const RowCountLine(this.count, {super.key});
  final int count;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 2, 16, 8),
        child: Text('$count record${count == 1 ? '' : 's'}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
      );
}

// ── Detail screen frame ──────────────────────────────────────────────────────

/// What a detail body can do: reload, replace the record, run an action.
class DetailCtl {
  DetailCtl._(this._state);
  final _HydDetailState _state;

  void reload() => _state._load();
  void setRecord(Json r) => _state._set(r);
  bool get busy => _state._busy;

  /// Runs a server action with a busy state; snack with the result.
  Future<bool> run(BuildContext context, Future<void> Function() action, {String? success}) async {
    _state._setBusy(true);
    final ok = await runAction(context, action, success: success);
    _state._setBusy(false);
    return ok;
  }
}

/// A record page: loads the record, shows its sections, and puts its actions
/// in the sticky bottom bar (portal header buttons).
class HydDetail extends StatefulWidget {
  const HydDetail({
    super.key,
    required this.fallbackTitle,
    required this.load,
    required this.title,
    required this.sections,
    this.actions,
  });

  final String fallbackTitle;
  final Future<Json> Function() load;
  final String Function(Json r) title;
  final List<Widget> Function(BuildContext context, Json r, DetailCtl ctl) sections;
  final List<Widget> Function(BuildContext context, Json r, DetailCtl ctl)? actions;

  @override
  State<HydDetail> createState() => _HydDetailState();
}

class _HydDetailState extends State<HydDetail> {
  Json? _rec;
  Object? _error;
  bool _busy = false;
  late final _ctl = DetailCtl._(this);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final r = await widget.load();
      if (mounted) setState(() => _rec = r);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _set(Json r) => setState(() => _rec = r);
  void _setBusy(bool v) {
    if (mounted) setState(() => _busy = v);
  }

  @override
  Widget build(BuildContext context) {
    final r = _rec;
    final actions = r == null ? const <Widget>[] : (widget.actions?.call(context, r, _ctl) ?? const <Widget>[]);
    return SubPage(
      title: r == null ? widget.fallbackTitle : widget.title(r),
      body: r == null
          ? (_error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.only(top: 12, bottom: 24),
                children: [
                  if (_error != null)
                    Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                        child: ErrorBanner(ApiClient.describe(_error!))),
                  ...widget.sections(context, r, _ctl),
                ],
              ),
            ),
      bottom: actions.isEmpty
          ? null
          : AbsorbPointer(
              absorbing: _busy,
              child: Opacity(
                opacity: _busy ? 0.6 : 1,
                child: actions.length <= 2
                    ? Row(children: [
                        for (var i = 0; i < actions.length; i++) ...[
                          if (i > 0) const SizedBox(width: 8),
                          Expanded(child: actions[i]),
                        ],
                      ])
                    : Wrap(spacing: 8, runSpacing: 8, children: actions),
              ),
            ),
    );
  }
}

/// Page header for a detail (eyebrow + summary text + badges).
class SummaryCard extends StatelessWidget {
  const SummaryCard({super.key, required this.eyebrow, required this.title, this.text, this.badges = const [], this.meta, this.action});
  final String eyebrow;
  final String title;
  final String? text;
  final List<Widget> badges;
  final String? meta;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [Expanded(child: Caps(eyebrow)), ?action]),
                const SizedBox(height: 4),
                Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading)),
                if (text != null && text!.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(text!, style: const TextStyle(fontSize: 13.5, color: Brand.body)),
                ],
                if (badges.isNotEmpty || (meta?.isNotEmpty ?? false)) ...[
                  const SizedBox(height: 8),
                  Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    ...badges,
                    if (meta != null && meta!.isNotEmpty)
                      Text(meta!, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  ]),
                ],
              ],
            ),
          ),
        ),
      );
}

/// A list screen opened on its own (dashboard KPI → list), with a back arrow.
class ListSubPage extends StatelessWidget {
  const ListSubPage({super.key, required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: child,
      );
}
