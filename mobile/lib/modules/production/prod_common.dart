import 'dart:io';

import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

/// Shared bits of the Production module (portal: components/production/*,
/// lib/permissions.ts, lib/visibility.ts, components/shared/ApprovalPanel).

// ── Permissions ──────────────────────────────────────────────────────────────

class ProdPerm {
  ProdPerm._();

  /// Portal filterTabsByAccess('production', ...): no `tab_access` entry for
  /// the module = every tab.
  static bool tab(String key) {
    final ta = Perm.user['tab_access'];
    if (ta is! Map) return true;
    final allowed = ta['production'];
    if (allowed is! List) return true;
    return allowed.contains(key);
  }

  /// can('production', tab, action).
  static bool can(String tab, String action) => Perm.can('production', tab, action);

  /// canFeature('production', tab, feature, action).
  static bool feat(String tab, String feature, String action) => Perm.canFeature('production', tab, feature, action);

  /// Portal canDelete: Delete on the tab AND you created it (admins: any).
  static bool canDeleteOwn(String tab, Object? ownerId) {
    if (!can(tab, 'delete')) return false;
    if (Perm.isAdmin) return true;
    return ownerId == null || ownerId == Perm.userId;
  }
}

/// Role-wise UI visibility (portal `useVisibility('<module>:<tab>')`): sections,
/// table columns and dropdown values a role hides. Admins see everything.
class Vis {
  Vis(this.key);
  final String key;

  Map? get _rule {
    if (Perm.isAdmin) return null;
    final v = Perm.user['visibility'];
    if (v is! Map) return null;
    final r = v[key];
    return r is Map ? r : null;
  }

  bool section(String s) {
    final h = _rule?['hidden_sections'];
    return !(h is List && h.contains(s));
  }

  bool any(List<String> sections) => sections.any(section);

  bool column(String table, String col) {
    final hc = _rule?['hidden_columns'];
    if (hc is! Map) return true;
    final cols = hc[table];
    return !(cols is List && cols.contains(col));
  }

  List<T> options<T>(String dropdown, List<T> all, String Function(T) valueOf) {
    final o = _rule?['options'];
    if (o is! Map) return all;
    final allowed = o[dropdown];
    if (allowed is! List || allowed.isEmpty) return all;
    final kept = all.where((x) => allowed.contains(valueOf(x))).toList();
    return kept.isEmpty ? all : kept;
  }
}

/// The role's "Assign to" rule for one picker (portal useAssigneeFilter).
/// Until it loads, or if it can't, nobody is hidden - the server still checks.
Future<bool Function(int)> assigneeFilter(String key) async {
  try {
    final d = await Api.get('/assignee-rules/allowed', query: {'key': key});
    if (d is Map && d['restricted'] == true && d['user_ids'] is List) {
      final ids = (d['user_ids'] as List).whereType<int>().toSet();
      return (id) => ids.contains(id);
    }
  } catch (_) {}
  return (_) => true;
}

// ── Coded lists (mirrors of the portal constants) ────────────────────────────

const woStatusLabels = <String, String>{
  'draft': 'Draft', 'released': 'Released', 'in_progress': 'In Progress',
  'completed': 'Completed', 'closed': 'Closed', 'cancelled': 'Cancelled',
};
const woStatusHex = <String, Color>{
  'draft': Color(0xFF78716C), 'released': Color(0xFF2563EB), 'in_progress': Color(0xFFF59E0B),
  'completed': Color(0xFF16A34A), 'closed': Color(0xFF0F766E), 'cancelled': Color(0xFF78716C),
};
const priorityLabels = <String, String>{'standard': 'Standard', 'urgent': 'Urgent'};
const priorityHex = <String, Color>{'standard': Color(0xFF475569), 'urgent': Color(0xFFDC2626)};

const opStatusLabels = <String, String>{'pending': 'Pending', 'in_progress': 'In Progress', 'completed': 'Completed'};
const opStatusHex = <String, Color>{
  'pending': Color(0xFF78716C), 'in_progress': Color(0xFFF59E0B), 'completed': Color(0xFF16A34A),
};
const inspLabels = <String, String>{
  'pending': 'Inspection pending', 'in_progress': 'Inspecting', 'passed': 'Passed',
  'failed': 'Failed', 'conditionally_passed': 'Passed (conditional)',
};
const inspHex = <String, Color>{
  'pending': Color(0xFFF59E0B), 'in_progress': Color(0xFF2563EB), 'passed': Color(0xFF16A34A),
  'failed': Color(0xFFDC2626), 'conditionally_passed': Color(0xFF0D9488),
};

const cGrey = Color(0xFF78716C);
const cBlue = Color(0xFF2563EB);
const cAmber = Color(0xFFF59E0B);
const cGreen = Color(0xFF16A34A);
const cRed = Color(0xFFDC2626);
const cPurple = Color(0xFF7C3AED);
const cViolet = Color(0xFF9333EA);
const cTeal = Color(0xFF0D9488);
const cBrown = Color(0xFFB45309);

/// Old priority words map to the two current ones (portal normalizePriority).
String normPriority(Object? p) {
  final s = (p ?? '').toString().toLowerCase();
  return (s == 'urgent' || s == 'high' || s == 'critical') ? 'urgent' : 'standard';
}

String priorityLabel(Object? p) => priorityLabels[normPriority(p)]!;

// ── Values ───────────────────────────────────────────────────────────────────

num n(Object? v) => v is num ? v : (v is String ? (num.tryParse(v) ?? 0) : 0);

int? idOf(Object? v) => v is int ? v : (v is String ? int.tryParse(v) : null);

/// Quantity like the portal's `+n.toFixed(4)`: 12, 12.5, 0.3333.
String fq(Object? v) {
  final x = n(v).toDouble();
  var s = x.toStringAsFixed(4);
  if (s.contains('.')) {
    s = s.replaceAll(RegExp(r'0+$'), '');
    if (s.endsWith('.')) s = s.substring(0, s.length - 1);
  }
  return s == '-0' ? '0' : s;
}

String inr(Object? v) => fmtMoney(n(v));

String signedInr(Object? v) => '${n(v) >= 0 ? '+' : ''}${inr(v)}';

List<Json> rowsOf(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

Json mapOf(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

String todayApi() => apiDate(DateTime.now());

/// `{id, label}` lookup rows as options.
Future<List<Option<int>>> lookupOptions(String path, {Map<String, dynamic>? query}) async {
  final p = await Api.list(path, query: query);
  return [
    for (final r in p.rows)
      if (idOf(r['id']) != null) Option(idOf(r['id'])!, txt(r['label']), subtitle: r['extra']?.toString()),
  ];
}

/// Loads a lookup once and filters it locally - for AppSelect.loadOptions.
class LookupCache {
  LookupCache(this.path, {this.query, this.filter});
  final String path;
  final Map<String, dynamic>? query;
  bool Function(int id)? filter;
  Future<List<Option<int>>>? _f;

  Future<List<Option<int>>> all() => _f ??= lookupOptions(path, query: query);

  Future<List<Option<int>>> search(String s) async {
    final q = s.trim().toLowerCase();
    final rows = await all();
    return rows
        .where((o) => filter == null || filter!(o.value))
        .where((o) => q.isEmpty || o.label.toLowerCase().contains(q))
        .toList();
  }

  Future<String?> labelOf(int? id) async {
    if (id == null) return null;
    for (final o in await all()) {
      if (o.value == id) return o.label;
    }
    return null;
  }
}

/// Picker value with its shown label (AppSelect with loaded options).
class Pick {
  Pick([this.id, this.label]);
  int? id;
  String? label;

  void set(Option<int>? o) {
    id = o?.value;
    label = o?.label;
  }

  void clear() {
    id = null;
    label = null;
  }
}

/// Searchable select over a [LookupCache].
Widget lookupSelect(String label, LookupCache cache, Pick pick, StateSetter setS,
    {bool required = false, bool enabled = true, ValueChanged<Option<int>?>? onPicked}) {
  return AppSelect<int>(
    label: label,
    value: pick.id,
    valueLabel: pick.label,
    required: required,
    enabled: enabled,
    loadOptions: cache.search,
    onChanged: (o) {
      setS(() => pick.set(o));
      onPicked?.call(o);
    },
  );
}

/// Project unit (vehicle / lot) picker - portal ProjectUnitPicker. Value key
/// "projectId:elementId".
class UnitPick {
  int? projectId;
  int? elementId;
  String? label;
  String? get key => projectId == null ? null : '$projectId:${elementId ?? ''}';
}

Widget projectUnitSelect(String label, UnitPick pick, StateSetter setS,
    {bool enabled = true, VoidCallback? onPicked, String? hint}) {
  return AppSelect<String>(
    label: label,
    value: pick.key,
    valueLabel: pick.label ?? hint,
    enabled: enabled,
    loadOptions: (s) async {
      final p = await Api.list('/projects/units/lookup', query: {'q': s.trim(), 'include_projects': false});
      return [
        for (final r in p.rows)
          if (idOf(r['project_id']) != null)
            Option('${r['project_id']}:${r['element_id'] ?? ''}', txt(r['display'])),
      ];
    },
    onChanged: (o) {
      setS(() {
        if (o == null) {
          pick
            ..projectId = null
            ..elementId = null
            ..label = null;
        } else {
          final parts = o.value.split(':');
          pick
            ..projectId = int.tryParse(parts[0])
            ..elementId = parts.length > 1 ? int.tryParse(parts[1]) : null
            ..label = o.label;
        }
      });
      onPicked?.call();
    },
  );
}

/// Number from a text field; null when blank / not a number.
num? numOf(String s) => s.trim().isEmpty ? null : num.tryParse(s.trim());

// ── Widgets ──────────────────────────────────────────────────────────────────

/// Coloured pill with a fixed label (portal Pill label/hex).
class Pill extends StatelessWidget {
  const Pill(this.label, this.color, {super.key});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
        child: Text(label, style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600)),
      );
}

Widget woStatusPill(Object? s) => Pill(woStatusLabels['$s'] ?? humanize(s), woStatusHex['$s'] ?? cGrey);

/// Thin progress bar (portal 6-8px bars).
class Bar extends StatelessWidget {
  const Bar(this.percent, {super.key, this.color = cGreen, this.height = 6});
  final num percent;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    final p = (percent / 100).clamp(0, 1).toDouble();
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: Container(
        height: height,
        color: const Color(0x14000000),
        alignment: Alignment.centerLeft,
        child: FractionallySizedBox(widthFactor: p, child: Container(color: color)),
      ),
    );
  }
}

/// KPI card (portal Kpi): label, big value, sub text; tap filters / opens.
class KpiCard extends StatelessWidget {
  const KpiCard(this.label, this.value, {super.key, this.sub, this.color, this.onTap});
  final String label;
  final String value;
  final String? sub;
  final Color? color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Caps(label),
              const SizedBox(height: 6),
              Text(value,
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: color ?? Brand.heading)),
              if (sub != null && sub!.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(sub!, style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Two KPI cards per row.
class KpiGrid extends StatelessWidget {
  const KpiGrid(this.cards, {super.key});
  final List<Widget> cards;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < cards.length; i += 2) {
      rows.add(Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: cards[i]),
              const SizedBox(width: 10),
              Expanded(child: i + 1 < cards.length ? cards[i + 1] : const SizedBox()),
            ],
          ),
        ),
      ));
    }
    return Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 2), child: Column(children: rows));
  }
}

/// Small muted help text (portal sheetHint / muted <p>).
class Hint extends StatelessWidget {
  const Hint(this.text, {super.key, this.color = Brand.muted});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) =>
      Text(text, style: TextStyle(fontSize: 12.5, color: color, height: 1.35));
}

/// Coloured notice box (amber warning / green success / blue info).
class Notice extends StatelessWidget {
  const Notice(this.child, {super.key, this.color = cAmber});
  final Widget child;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.09),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color.withValues(alpha: 0.3)),
          ),
          child: DefaultTextStyle.merge(style: const TextStyle(fontSize: 13, color: Brand.body), child: child),
        ),
      );
}

/// Compact button for card / section actions.
Widget miniBtn(String label, VoidCallback? onTap, {bool primary = false, bool danger = false, IconData? icon}) {
  final style = ButtonStyle(
    minimumSize: const WidgetStatePropertyAll(Size(0, 36)),
    padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 12)),
    visualDensity: VisualDensity.compact,
    shape: WidgetStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
    textStyle: const WidgetStatePropertyAll(TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
  );
  final child = Text(label);
  if (primary) {
    return FilledButton(
      style: style.copyWith(backgroundColor: WidgetStatePropertyAll(danger ? Brand.danger : Brand.primary)),
      onPressed: onTap,
      child: child,
    );
  }
  return OutlinedButton(
    style: style.copyWith(
      foregroundColor: WidgetStatePropertyAll(danger ? Brand.danger : Brand.body),
      side: WidgetStatePropertyAll(BorderSide(color: danger ? Brand.danger.withValues(alpha: 0.4) : Brand.border)),
    ),
    onPressed: onTap,
    child: icon == null ? child : Row(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 16), const SizedBox(width: 6), child]),
  );
}

Widget btnWrap(List<Widget> buttons) => Wrap(spacing: 8, runSpacing: 8, children: buttons);

/// One action of a detail screen's bottom bar.
class BarAction {
  const BarAction(this.label, this.onTap, {this.primary = false, this.danger = false});
  final String label;
  final VoidCallback onTap;
  final bool primary;
  final bool danger;
}

/// Sticky bottom bar: the first two actions as buttons, the rest under "More".
class BottomActions extends StatelessWidget {
  const BottomActions(this.actions, {super.key, this.busy = false});
  final List<BarAction> actions;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final shown = actions.take(actions.length > 2 ? 1 : 2).toList();
    final more = actions.length > 2 ? actions.skip(1).toList() : <BarAction>[];
    Widget button(BarAction a) {
      final style = ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(Size(0, 46)),
        shape: WidgetStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
        textStyle: const WidgetStatePropertyAll(TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
      );
      if (a.primary) {
        return FilledButton(
          style: style.copyWith(backgroundColor: WidgetStatePropertyAll(a.danger ? Brand.danger : Brand.primary)),
          onPressed: busy ? null : a.onTap,
          child: Text(a.label, maxLines: 1, overflow: TextOverflow.ellipsis),
        );
      }
      return OutlinedButton(
        style: style.copyWith(foregroundColor: WidgetStatePropertyAll(a.danger ? Brand.danger : Brand.body)),
        onPressed: busy ? null : a.onTap,
        child: Text(a.label, maxLines: 1, overflow: TextOverflow.ellipsis),
      );
    }

    return Row(
      children: [
        for (var i = 0; i < shown.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(child: button(shown[i])),
        ],
        if (more.isNotEmpty) ...[
          const SizedBox(width: 8),
          SizedBox(
            height: 46,
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 46),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: busy
                  ? null
                  : () async {
                      final picked = await showModalBottomSheet<BarAction>(
                        context: context,
                        backgroundColor: Colors.white,
                        shape: const RoundedRectangleBorder(
                            borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
                        builder: (ctx) => SafeArea(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const SizedBox(height: 8),
                              for (final a in more)
                                ListTile(
                                  title: Text(a.label,
                                      style: TextStyle(
                                          color: a.danger ? Brand.danger : Brand.heading,
                                          fontWeight: FontWeight.w600)),
                                  onTap: () => Navigator.pop(ctx, a),
                                ),
                              const SizedBox(height: 8),
                            ],
                          ),
                        ),
                      );
                      picked?.onTap();
                    },
              child: const Text('More'),
            ),
          ),
        ],
      ],
    );
  }
}

/// Horizontally scrolling row of filter chips (portal status tabs).
class ChipRow extends StatelessWidget {
  const ChipRow(this.chips, {super.key});
  final List<Widget> chips;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 46,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
          children: chips,
        ),
      );
}

/// Record sub-tabs inside a detail screen (portal underline tabs).
class SubTabs extends StatelessWidget {
  const SubTabs({super.key, required this.tabs, required this.selected, required this.onSelect});
  final List<(String, String)> tabs;
  final String selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) => ChipRow([
        for (final (k, l) in tabs) CountChip(l, null, selected: k == selected, onTap: () => onSelect(k)),
      ]);
}

/// A compact line inside a section: label left, value right.
class KV extends StatelessWidget {
  const KV(this.label, this.value, {super.key, this.color, this.bold = false});
  final String label;
  final String value;
  final Color? color;
  final bool bold;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.muted))),
            const SizedBox(width: 10),
            Flexible(
              child: Text(value,
                  textAlign: TextAlign.right,
                  style: TextStyle(
                      fontSize: 13,
                      color: color ?? Brand.body,
                      fontWeight: bold ? FontWeight.w700 : FontWeight.w500)),
            ),
          ],
        ),
      );
}

/// One row card inside a section (a table row on the phone).
class LineCard extends StatelessWidget {
  const LineCard({super.key, required this.title, this.subtitle, this.trailing, this.lines = const [], this.actions = const [], this.onTap, this.indent = 0});
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final List<Widget> lines;
  final List<Widget> actions;
  final VoidCallback? onTap;
  final double indent;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: EdgeInsets.fromLTRB(indent, 10, 0, 10),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x14000000)))),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                              color: onTap != null ? Brand.primaryActive : Brand.heading)),
                      if (subtitle != null && subtitle!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(subtitle!, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                        ),
                    ],
                  ),
                ),
                if (trailing != null) ...[const SizedBox(width: 8), trailing!],
              ],
            ),
            if (lines.isNotEmpty) ...[const SizedBox(height: 6), ...lines],
            if (actions.isNotEmpty) ...[const SizedBox(height: 8), btnWrap(actions)],
          ],
        ),
      ),
    );
  }
}

/// Empty text inside a section.
Widget emptyLine(String text) =>
    Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Hint(text));

/// Error text inside a section.
Widget errorLine(Object e) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: ErrorBanner(e is String ? e : ApiClient.describe(e)),
    );

/// Writes a CSV to the phone and opens it (portal "Export CSV").
Future<void> shareCsv(String fileName, List<String> header, List<List<Object?>> rows) async {
  String esc(Object? v) {
    final s = v == null ? '' : v.toString();
    return RegExp(r'[",\n]').hasMatch(s) ? '"${s.replaceAll('"', '""')}"' : s;
  }

  final csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  final dir = await getTemporaryDirectory();
  final path = '${dir.path}${Platform.pathSeparator}$fileName';
  await File(path).writeAsString(csv);
  final r = await OpenFilex.open(path);
  if (r.type != ResultType.done) {
    throw Exception('The CSV was saved but no app on this phone can open "$fileName". '
        'Install a spreadsheet app (for example Microsoft Excel) and try again.');
  }
}

// ── Approval panel (central approval engine) ─────────────────────────────────

const _reqLabels = <String, String>{
  'pending': 'Waiting for approval', 'approved': 'Approved', 'rejected': 'Rejected',
  'returned': 'Returned for changes', 'cancelled': 'Cancelled',
};
const _reqHex = <String, Color>{
  'pending': cAmber, 'approved': cGreen, 'rejected': cRed, 'returned': cPurple, 'cancelled': cGrey,
};
const _stepLabels = <String, String>{
  'waiting': 'Not yet', 'pending': 'Waiting', 'approved': 'Approved', 'rejected': 'Rejected',
  'returned': 'Returned', 'skipped': 'Not needed', 'cancelled': 'Cancelled',
};
const _stepHex = <String, Color>{
  'waiting': Color(0xFFA8A29E), 'pending': cAmber, 'approved': cGreen, 'rejected': cRed,
  'returned': cPurple, 'skipped': Color(0xFFA8A29E), 'cancelled': Color(0xFFA8A29E),
};
const _viaLabels = <String, String>{'delegation': 'as delegate', 'escalation': 'after escalation', 'admin': 'admin stand-in'};

/// Approval status + Approve / Return / Reject / Withdraw for one record
/// (portal components/shared/ApprovalPanel). Hidden when the record never
/// went for approval.
class ApprovalSection extends StatefulWidget {
  const ApprovalSection({super.key, required this.entityType, required this.entityId, this.title = 'Approval', this.onChanged});
  final String entityType;
  final int entityId;
  final String title;
  final VoidCallback? onChanged;

  @override
  State<ApprovalSection> createState() => _ApprovalSectionState();
}

class _ApprovalSectionState extends State<ApprovalSection> {
  Json? _data;
  Object? _error;
  bool _busy = false;
  bool _history = false;
  final _comment = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/approvals/entity/${widget.entityType}/${widget.entityId}');
      if (mounted) setState(() => _data = mapOf(d));
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _act(Future<void> Function() fn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await fn();
      _comment.clear();
      await _load();
      widget.onChanged?.call();
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _stages(Json req) {
    final groups = <int, List<Json>>{};
    final names = <int, (String, String)>{};
    for (final s in rowsOf(req['steps'])) {
      final seq = idOf(s['sequence']) ?? 0;
      groups.putIfAbsent(seq, () => []).add(s);
      names[seq] = (txt(s['stage_name']), '${s['approval_mode']}');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final e in groups.entries)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
              border: Border(
                  left: BorderSide(
                      width: 3,
                      color: e.key == idOf(req['current_sequence']) ? cAmber : const Color(0x1F000000))),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                    '${e.key}. ${names[e.key]!.$1}${e.value.length > 1 ? ' — ${names[e.key]!.$2 == 'all' ? 'every one must approve' : 'any one approves'}' : ''}',
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading)),
                for (final s in e.value)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 2,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Pill(_stepLabels['${s['status']}'] ?? humanize(s['status']), _stepHex['${s['status']}'] ?? cGrey),
                        Text(txt(s['approver_name']), style: const TextStyle(fontSize: 12.5)),
                        if (s['decided_by_name'] != null && s['decided_by_id'] != s['approver_id'])
                          Text(
                              'decided by ${s['decided_by_name']}${_viaLabels[s['via']] != null ? ' (${_viaLabels[s['via']]})' : ''}',
                              style: const TextStyle(fontSize: 12, color: Brand.muted)),
                        if (s['decided_at'] != null)
                          Text(fmtDateTime(s['decided_at']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                        if (s['status'] == 'pending' && s['due_at'] != null)
                          Text('escalates ${fmtDateTime(s['due_at'])}',
                              style: const TextStyle(fontSize: 12, color: Brand.muted)),
                        if ((s['comment'] ?? '').toString().isNotEmpty)
                          Text('"${s['comment']}"', style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    if (d == null) {
      return _error == null ? const SizedBox.shrink() : DetailSection(widget.title, children: [errorLine(_error!)]);
    }
    final req = d['current'] is Map ? mapOf(d['current']) : null;
    final history = rowsOf(d['history']);
    if (req == null && history.isEmpty) return const SizedBox.shrink();
    final canAct = req != null && req['status'] == 'pending' && (req['can_decide'] == true || req['can_stand_in'] == true);
    return DetailSection(widget.title, children: [
      if (req != null) ...[
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Pill(_reqLabels['${req['status']}'] ?? humanize(req['status']), _reqHex['${req['status']}'] ?? cGrey),
          Text(
              'Submitted by ${txt(req['requester_name'])} on ${fmtDateTime(req['submitted_at'])}${n(req['revision']) > 1 ? ' · submission #${req['revision']}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
        _stages(req),
      ],
      if (_error != null) errorLine(_error!),
      if (canAct) ...[
        const SizedBox(height: 10),
        if (req['acting_for'] != null) Hint('You are deciding on behalf of ${req['acting_for']}.'),
        if (req['can_decide'] != true && req['can_stand_in'] == true)
          const Hint('You are not an approver of this stage — as an admin you can stand in; a comment is required.'),
        const SizedBox(height: 6),
        AppTextField(label: 'Comment (required to reject or return)', controller: _comment, maxLines: 2),
        const SizedBox(height: 8),
        btnWrap([
          miniBtn('Approve', _busy ? null : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': 'approve', 'comment': _comment.text.trim()})), primary: true),
          miniBtn('Return for changes', _busy ? null : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': 'return', 'comment': _comment.text.trim()}))),
          miniBtn('Reject', _busy ? null : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': 'reject', 'comment': _comment.text.trim()})), danger: true),
        ]),
      ],
      if (req != null && req['status'] == 'pending' && req['can_cancel'] == true) ...[
        const SizedBox(height: 8),
        miniBtn('Withdraw approval request', _busy
            ? null
            : () async {
                final ok = await confirmDialog(context,
                    title: 'Withdraw approval request?',
                    message: 'The approvers will no longer see it. You can submit it again later.',
                    confirmLabel: 'Withdraw');
                if (ok) await _act(() => Api.post('/approvals/requests/${req['id']}/cancel', data: {}));
              }),
      ],
      if (history.isNotEmpty) ...[
        const SizedBox(height: 10),
        InkWell(
          onTap: () => setState(() => _history = !_history),
          child: Text('${_history ? 'Hide' : 'Show'} earlier submissions (${history.length})',
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Brand.primary)),
        ),
        if (_history)
          for (final h in history) ...[
            const Divider(height: 18),
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Pill(_reqLabels['${h['status']}'] ?? humanize(h['status']), _reqHex['${h['status']}'] ?? cGrey),
              Text('Submission #${h['revision']} · ${fmtDateTime(h['submitted_at'])}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
            _stages(h),
          ],
      ],
    ]);
  }
}

/// A detail screen's loading/error frame with pull-to-refresh.
class DetailBody extends StatelessWidget {
  const DetailBody({super.key, required this.loading, required this.error, required this.onRefresh, required this.children});
  final bool loading;
  final Object? error;
  final Future<void> Function() onRefresh;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (loading) return const LoadingView();
    if (error != null && children.isEmpty) return ErrorView(error!, onRetry: onRefresh);
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 24),
        children: [
          if (error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(error is String ? error as String : ApiClient.describe(error!))),
          ...children,
        ],
      ),
    );
  }
}
