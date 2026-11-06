import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

// Shared bits of the Maintenance module - the phone side of
// frontend/src/components/maintenance/labels.ts, MaintenanceAttachments,
// ApprovalPanel and the access helpers the portal pages use.

// ── Labels (labels.ts) ───────────────────────────────────────────────────────

const assetCategoryLabels = <String, String>{
  'production_machine': 'Production Machine', 'material_handling': 'Material Handling', 'utility': 'Utility',
  'tooling_fixture': 'Tooling / Fixture', 'instrument': 'Instrument / Gauge', 'facility': 'Facility',
  'vehicle': 'Vehicle', 'other': 'Other',
};
const assetStatusLabels = <String, String>{
  'operational': 'Operational', 'breakdown': 'Breakdown', 'under_maintenance': 'Under Maintenance',
  'standby': 'Standby', 'decommissioned': 'Decommissioned',
};
const criticalityLabels = <String, String>{'A': 'A — Line stops', 'B': 'B — Important', 'C': 'C — Low impact'};
const requestTypeLabels = <String, String>{
  'breakdown': 'Breakdown', 'abnormality': 'Abnormality (still running)', 'improvement': 'Improvement', 'safety': 'Safety',
};
const requestStatusLabels = <String, String>{
  'open': 'Open', 'acknowledged': 'Acknowledged', 'converted': 'Work Order Raised', 'rejected': 'Rejected', 'duplicate': 'Duplicate',
};
const priorityLabels = <String, String>{'standard': 'Standard', 'urgent': 'Urgent'};
const woTypeLabels = <String, String>{
  'breakdown': 'Breakdown', 'preventive': 'Preventive', 'corrective': 'Corrective', 'calibration': 'Calibration',
  'improvement': 'Improvement', 'inspection': 'Inspection',
};
const woStatusLabels = <String, String>{
  'draft': 'Draft', 'assigned': 'Assigned', 'in_progress': 'In Progress', 'on_hold': 'On Hold',
  'completed': 'Completed', 'closed': 'Closed', 'cancelled': 'Cancelled',
};
const failureCategoryLabels = <String, String>{
  'mechanical': 'Mechanical', 'electrical': 'Electrical', 'hydraulic': 'Hydraulic', 'pneumatic': 'Pneumatic',
  'lubrication': 'Lubrication', 'electronic_control': 'Electronic / Control', 'wear_and_tear': 'Wear & Tear',
  'operator_error': 'Operator Error', 'external': 'External (power, supply…)', 'other': 'Other',
};
const docTypeLabels = <String, String>{
  'photo': 'Photo', 'manual': 'Manual', 'drawing': 'Drawing', 'service_report': 'Service Report', 'certificate': 'Certificate', 'other': 'Other',
};
const pmFrequencyUnitLabels = <String, String>{'day': 'Day(s)', 'week': 'Week(s)', 'month': 'Month(s)', 'year': 'Year(s)'};
const pmScheduleBasisLabels = <String, String>{'fixed': 'Fixed calendar', 'floating': 'From last completion'};
const pmDueStateLabels = <String, String>{'overdue': 'Overdue', 'due_soon': 'Due soon', 'scheduled': 'Scheduled', 'inactive': 'Inactive'};

// ── Colours (the portal's per-page *_HEX maps) ───────────────────────────────

const kRed = Color(0xFFDC2626);
const kAmber = Color(0xFFF59E0B);
const kBlue = Color(0xFF2563EB);
const kGreen = Color(0xFF16A34A);
const kTeal = Color(0xFF0F766E);
const kPurple = Color(0xFF9333EA);
const kGrey = Color(0xFF78716C);
const kSlate = Color(0xFF475569);
const kOrange = Color(0xFFFF6A2A);

const assetStatusHex = <String, Color>{
  'operational': kGreen, 'breakdown': kRed, 'under_maintenance': kAmber, 'standby': kBlue, 'decommissioned': kGrey,
};
const critHex = <String, Color>{'A': kRed, 'B': kAmber, 'C': kGrey};
const requestStatusHex = <String, Color>{
  'open': kAmber, 'acknowledged': kBlue, 'converted': kTeal, 'rejected': kRed, 'duplicate': kGrey,
};
const woStatusHex = <String, Color>{
  'draft': kGrey, 'assigned': kBlue, 'in_progress': kAmber, 'on_hold': kPurple, 'completed': kGreen, 'closed': kTeal, 'cancelled': kGrey,
};
const priorityHex = <String, Color>{'standard': kSlate, 'urgent': kRed};
const dueHex = <String, Color>{'overdue': kRed, 'due_soon': kAmber, 'scheduled': kBlue, 'inactive': kGrey};

// ── Value helpers ────────────────────────────────────────────────────────────

String label(Map<String, String> labels, Object? value) => labels['${value ?? ''}'] ?? humanize(value);

String str(Object? v) => v == null ? '' : '$v';

num? asNum(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);

int? asInt(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));

List<Json> asList(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

Json? asMap(Object? v) => v is Map ? Map<String, dynamic>.from(v) : null;

/// Two-value priority used app-wide (lib/priority.ts).
String normPriority(Object? v) =>
    const {'urgent', 'critical', 'high'}.contains('${v ?? ''}'.trim().toLowerCase()) ? 'urgent' : 'standard';

String priorityText(Object? v) => normPriority(v) == 'urgent' ? 'Urgent' : 'Standard';

/// "2h 15m" / "3d 4h" - downtime is stored in minutes.
String formatMinutes(Object? v) {
  final n = asNum(v);
  if (n == null) return '—';
  final mins = n.round();
  if (mins < 60) return '${mins}m';
  final h = mins ~/ 60, m = mins % 60;
  if (h < 24) return m > 0 ? '${h}h ${m}m' : '${h}h';
  final d = h ~/ 24, rh = h % 24;
  return rh > 0 ? '${d}d ${rh}h' : '${d}d';
}

final _inr = NumberFormat('#,##,##0.##', 'en_IN');

/// "₹1,25,000" / "₹12.5" (max 2 decimals, like the portal's formatINR).
String formatInr(Object? v) {
  final n = asNum(v);
  return n == null ? '—' : '₹${_inr.format(n)}';
}

String fmtQty(Object? v) {
  final n = asNum(v);
  if (n == null) return '—';
  final r = (n * 1000).round() / 1000;
  return r == r.roundToDouble() ? r.toInt().toString() : '$r';
}

/// API value for a date-time picked on the phone (local time → ISO with zone).
String? isoOf(DateTime? d) => d?.toUtc().toIso8601String();

/// Number typed in a field; null when blank, NaN when not a number.
num? numOrNull(String text) {
  final t = text.trim();
  if (t.isEmpty) return null;
  return num.tryParse(t) ?? double.nan;
}

// ── Access (portal: useCan, filterTabsByAccess, useVisibility) ──────────────

class Mt {
  Mt._();
  static const module = 'maintenance';

  /// Holds the maintenance app; production supervisors without it only get
  /// the Requests pages (MaintenanceNav).
  static bool get isMaintenanceUser => Perm.hasApp('maintenance');

  /// Module tab viewable (user.tab_access; admins and unset = all).
  static bool tab(String key) {
    if (Perm.isAdmin) return true;
    final ta = Perm.user['tab_access'];
    if (ta is! Map) return true;
    final allowed = ta[module];
    if (allowed is! List) return true;
    return allowed.contains(key);
  }

  static bool can(String tab, String action) => Perm.can(module, tab, action);

  static bool feat(String tab, String feature, [String action = 'view']) => Perm.canFeature(module, tab, feature, action);

  /// Work Orders › Maintenance costs switch.
  static bool get showCosts => feat('work_orders', 'costs');
}

/// Role-wise UI visibility for one screen key (lib/visibility.ts): hidden
/// sections, hidden table columns and narrowed dropdown values.
class Vis {
  Vis(String key) : _rule = _ruleFor(key);
  final Map? _rule;

  static Map? _ruleFor(String key) {
    if (Perm.isAdmin) return null;
    final v = Perm.user['visibility'];
    return v is Map && v[key] is Map ? v[key] as Map : null;
  }

  bool section(String s) {
    final h = _rule?['hidden_sections'];
    return !(h is List && h.contains(s));
  }

  bool column(String table, String col) {
    final hc = _rule?['hidden_columns'];
    return !(hc is Map && hc[table] is List && (hc[table] as List).contains(col));
  }

  /// The dropdown's values the user's roles offer (all when unrestricted).
  List<String> options(String dropdown, Iterable<String> all) {
    final list = all.toList();
    final o = _rule?['options'];
    final allowed = o is Map ? o[dropdown] : null;
    if (allowed is! List || allowed.isEmpty) return list;
    final kept = list.where(allowed.contains).toList();
    return kept.isEmpty ? list : kept;
  }
}

/// The role's "Assign to" rule (hooks/useAssigneeFilter.ts). Until it loads,
/// or if it can't, nothing is hidden - the server still checks on save.
Future<bool Function(int)> assigneeFilter(String key) async {
  try {
    final d = await Api.get('/assignee-rules/allowed', query: {'key': key});
    if (d is Map && d['restricted'] == true && d['user_ids'] is List) {
      final ids = (d['user_ids'] as List).whereType<int>().toSet();
      return (int id) => ids.contains(id);
    }
  } catch (_) {
    // Rule unreadable - show everyone; the server refuses an outsider with its reason.
  }
  return (int _) => true;
}

// ── Lookups ──────────────────────────────────────────────────────────────────

/// GET /maintenance/lookups, loaded once per app session.
class MtLookups {
  MtLookups._();
  static Future<Json>? _f;

  static Future<Json> get() => _f ??= _load();

  static Future<Json> _load() async {
    try {
      final d = await Api.get('/maintenance/lookups');
      return Map<String, dynamic>.from(d as Map);
    } catch (_) {
      _f = null;
      rethrow;
    }
  }

  /// Lookups or null (filters that are optional on the portal).
  static Future<Json?> tryGet() async {
    try {
      return await get();
    } catch (_) {
      return null;
    }
  }

  static List<Option<int>> branches(Json? lk) => [
        for (final b in asList(lk?['branches']))
          if (asInt(b['id']) != null) Option(asInt(b['id'])!, str(b['name'])),
      ];

  static List<Option<int>> vendors(Json? lk) => [
        for (final v in asList(lk?['vendors']))
          if (asInt(v['id']) != null) Option(asInt(v['id'])!, str(v['name'])),
      ];

  static List<Json> technicians(Json? lk) => asList(lk?['technicians']);
}

/// Assets seen in pickers, by id (status / label for the chosen one).
final assetCache = <int, Json>{};

String assetLabel(Json a) {
  final name = str(a['name']);
  final loc = str(a['location_text']);
  return '${a['asset_code']}${name.isNotEmpty ? ' — $name' : ''}${loc.isNotEmpty ? ' ($loc)' : ''}';
}

/// Server-side asset search for pickers (lookups/assets caps at 100 rows).
Future<List<Option<int>>> loadAssetOptions(String search, {int? branchId, int? excludeId}) async {
  final p = await Api.list('/maintenance/lookups/assets', query: {'search': search.trim(), 'branch_id': branchId});
  final out = <Option<int>>[];
  for (final a in p.rows) {
    final id = asInt(a['id']);
    if (id == null || id == excludeId) continue;
    assetCache[id] = a;
    out.add(Option(id, assetLabel(a), subtitle: label(assetStatusLabels, a['status'])));
  }
  return out;
}

/// Store items (spare parts first), with stock at a location when given.
Future<List<Json>> searchStoreItems(String search, {int? locationId}) async =>
    (await Api.list('/maintenance/lookups/store-items', query: {'search': search.trim(), 'location_id': locationId})).rows;

final storeItemCache = <int, Json>{};

Future<List<Option<int>>> loadStoreItemOptions(String search, {int? locationId, bool Function(Json)? where}) async {
  final rows = await searchStoreItems(search, locationId: locationId);
  final out = <Option<int>>[];
  for (final it in rows) {
    final id = asInt(it['id']);
    if (id == null || (where != null && !where(it))) continue;
    storeItemCache[id] = it;
    final type = str(it['item_type']);
    final avail = it['available_qty'];
    out.add(Option(id, '${it['item_code']} ${it['item_name']}',
        subtitle: [
          if (type.isNotEmpty && type != 'spare_part') type,
          if (avail != null) '${fmtQty(avail)} ${str(it['uom'])} in stock'.trim(),
        ].join(' · ')));
  }
  return out;
}

// ── Small widgets ────────────────────────────────────────────────────────────

/// Coloured pill with the portal's own colour (Pill label/hex).
class Pill extends StatelessWidget {
  const Pill(this.text, this.color, {super.key});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
        child: Text(text, style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600)),
      );
}

Pill statusPill(Map<String, String> labels, Map<String, Color> colors, Object? value) =>
    Pill(label(labels, value), colors['${value ?? ''}'] ?? kGrey);

Pill priorityPill(Object? v, {String suffix = ''}) => Pill('${priorityText(v)}$suffix', priorityHex[normPriority(v)]!);

/// Page title block: small caps line, title, subtitle, actions.
class MtHeader extends StatelessWidget {
  const MtHeader(this.title, {super.key, this.caps = 'Maintenance Module', this.subtitle, this.actions = const []});
  final String title;
  final String caps;
  final String? subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Caps(caps),
          const SizedBox(height: 2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Brand.heading)),
              ),
              ...actions,
            ],
          ),
          if (subtitle != null && subtitle!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(subtitle!, style: const TextStyle(fontSize: 13, color: Brand.muted)),
          ],
        ],
      ),
    );
  }
}

/// Coloured notice box (portal: the tinted banners above a record).
class NoteBanner extends StatelessWidget {
  const NoteBanner(this.text, {super.key, this.color = kAmber, this.onTap});
  final String text;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: color.withValues(alpha: 0.3)),
          ),
          child: Text(text, style: TextStyle(fontSize: 13, color: Color.lerp(color, Colors.black, 0.35))),
        ),
      ),
    );
  }
}

/// KPI tile (portal Kpi card); tap = drill-down.
class KpiTile extends StatelessWidget {
  const KpiTile({super.key, required this.label, required this.value, this.sub, this.color, this.onTap});
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
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Caps(label),
              const SizedBox(height: 4),
              Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: color ?? Brand.heading)),
              if (sub != null && sub!.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(sub!, style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Tiles two per row.
Widget kpiGrid(List<Widget> tiles) {
  final rows = <Widget>[];
  for (var i = 0; i < tiles.length; i += 2) {
    rows.add(Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(child: tiles[i]),
            const SizedBox(width: 10),
            Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox()),
          ],
        ),
      ),
    ));
  }
  return Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Column(children: rows));
}

/// One tappable line inside a section (portal table row / list row).
class LineItem extends StatelessWidget {
  const LineItem({super.key, required this.title, this.subtitle, this.trailing = const [], this.badges = const [], this.onTap, this.lead});
  final String title;
  final String? subtitle;
  final List<Widget> badges;
  final List<Widget> trailing;
  final Widget? lead;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 9),
        decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x14000000)))),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (lead != null) ...[lead!, const SizedBox(width: 8)],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Brand.heading)),
                  if (subtitle != null && subtitle!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(subtitle!, style: const TextStyle(fontSize: 12.5, color: Brand.body)),
                    ),
                  if (badges.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: badges),
                    ),
                ],
              ),
            ),
            if (trailing.isNotEmpty) ...[
              const SizedBox(width: 8),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: trailing),
            ],
          ],
        ),
      ),
    );
  }
}

Widget mutedText(String text) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Text(text, style: const TextStyle(fontSize: 13, color: Brand.muted)),
    );

Widget smallText(String text, {Color color = Brand.muted, FontWeight? weight}) =>
    Text(text, style: TextStyle(fontSize: 12, color: color, fontWeight: weight));

/// Compact secondary button used inside sections ("+ Add", "Issue" ...).
Widget smallBtn(String text, VoidCallback? onTap, {bool danger = false}) => OutlinedButton(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 34),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        visualDensity: VisualDensity.compact,
        foregroundColor: danger ? kRed : Brand.body,
        side: BorderSide(color: danger ? kRed.withValues(alpha: 0.4) : Brand.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      onPressed: onTap,
      child: Text(text, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
    );

/// Label + value pair shown side by side (cost grid, permit facts).
Widget factLine(String labelText, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: RichText(
        text: TextSpan(style: const TextStyle(fontSize: 13, color: Brand.body), children: [
          TextSpan(text: '$labelText: ', style: const TextStyle(fontWeight: FontWeight.w700)),
          TextSpan(text: value),
        ]),
      ),
    );

/// Hint text under a field inside a form sheet.
Widget hintText(String text) => Text(text, style: const TextStyle(fontSize: 12, color: Brand.muted));

/// Section title inside a form sheet (portal SheetSection).
Widget sheetSection(String title, {String? extra}) => Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(children: [
        Text(title.toUpperCase(),
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.6, color: Brand.primaryActive)),
        if (extra != null) ...[const SizedBox(width: 6), smallText(extra)],
      ]),
    );

// ── Filters ──────────────────────────────────────────────────────────────────

/// Horizontal row of filter chips under the page header.
Widget filterRow(List<Widget> children) => SizedBox(
      height: 46,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 6),
        children: [
          for (final c in children) Padding(padding: const EdgeInsets.only(right: 8), child: c),
        ],
      ),
    );

/// Dropdown filter as a chip (portal shared Select in the filter bar).
class FilterSelect<T> extends StatelessWidget {
  const FilterSelect({super.key, required this.allLabel, required this.value, required this.options, required this.onChanged, this.allowAll = true});
  final String allLabel;
  final T? value;
  final List<Option<T>> options;
  final ValueChanged<T?> onChanged;
  final bool allowAll;

  @override
  Widget build(BuildContext context) {
    String text = allLabel;
    for (final o in options) {
      if (o.value == value) text = o.label;
    }
    final active = value != null;
    return Material(
      color: active ? Brand.primarySoft : Colors.white,
      shape: StadiumBorder(side: BorderSide(color: active ? Brand.primary : Brand.border)),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: () async {
          final picked = await showModalBottomSheet<_FilterPick<T>>(
            context: context,
            backgroundColor: Colors.white,
            isScrollControlled: true,
            shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
            builder: (ctx) => SafeArea(
              child: ConstrainedBox(
                constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    if (allowAll)
                      ListTile(
                        title: Text(allLabel),
                        trailing: value == null ? const Icon(Icons.check_rounded, color: Brand.primary) : null,
                        onTap: () => Navigator.pop(ctx, _FilterPick<T>(null)),
                      ),
                    for (final o in options)
                      ListTile(
                        title: Text(o.label),
                        subtitle: o.subtitle == null ? null : Text(o.subtitle!),
                        trailing: o.value == value ? const Icon(Icons.check_rounded, color: Brand.primary) : null,
                        onTap: () => Navigator.pop(ctx, _FilterPick<T>(o.value)),
                      ),
                  ],
                ),
              ),
            ),
          );
          if (picked != null) onChanged(picked.value);
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text(text,
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: active ? Brand.primaryActive : Brand.body)),
            const SizedBox(width: 2),
            Icon(Icons.expand_more_rounded, size: 18, color: active ? Brand.primaryActive : Brand.muted),
          ]),
        ),
      ),
    );
  }
}

class _FilterPick<T> {
  const _FilterPick(this.value);
  final T? value;
}

/// Checkbox filter as a chip ("Raised by me", "My jobs").
class FilterToggle extends StatelessWidget {
  const FilterToggle({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: value ? Brand.primarySoft : Colors.white,
      shape: StadiumBorder(side: BorderSide(color: value ? Brand.primary : Brand.border)),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: () => onChanged(!value),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(value ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
                size: 17, color: value ? Brand.primaryActive : Brand.muted),
            const SizedBox(width: 6),
            Text(label,
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: value ? Brand.primaryActive : Brand.body)),
          ]),
        ),
      ),
    );
  }
}

List<Option<String>> optionsOf(Map<String, String> labels, [Iterable<String>? keys]) =>
    [for (final k in keys ?? labels.keys) Option(k, labels[k] ?? humanize(k))];

// ── Sticky action bar ────────────────────────────────────────────────────────

class BarAction {
  const BarAction(this.label, this.onTap, {this.primary = false, this.danger = false});
  final String label;
  final VoidCallback? onTap;
  final bool primary;
  final bool danger;
}

/// Bottom bar of a record: first action filled, second outlined, the rest
/// in a "more" menu.
class ActionBar extends StatelessWidget {
  const ActionBar(this.actions, {super.key, this.busy = false});
  final List<BarAction> actions;
  final bool busy;

  Widget _button(BarAction a, {required bool filled}) {
    final onTap = busy ? null : a.onTap;
    if (filled) {
      return FilledButton(
        style: FilledButton.styleFrom(
          minimumSize: const Size(0, 46),
          backgroundColor: a.danger ? kRed : Brand.primary,
          textStyle: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
        ),
        onPressed: onTap,
        child: Text(a.label, textAlign: TextAlign.center),
      );
    }
    return OutlinedButton(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 46),
        foregroundColor: a.danger ? kRed : Brand.body,
        side: BorderSide(color: a.danger ? kRed.withValues(alpha: 0.5) : Brand.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
      ),
      onPressed: onTap,
      child: Text(a.label, textAlign: TextAlign.center),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (actions.isEmpty) return const SizedBox.shrink();
    final first = actions[0];
    final rest = actions.skip(1).toList();
    return Row(
      children: [
        Expanded(child: _button(first, filled: first.primary || first.danger || rest.isEmpty)),
        if (rest.isNotEmpty) ...[
          const SizedBox(width: 8),
          Expanded(child: _button(rest[0], filled: false)),
        ],
        if (rest.length > 1)
          PopupMenuButton<int>(
            tooltip: 'More actions',
            enabled: !busy,
            icon: const Icon(Icons.more_vert_rounded),
            onSelected: (i) => rest[i].onTap?.call(),
            itemBuilder: (_) => [
              for (var i = 1; i < rest.length; i++)
                PopupMenuItem(
                  value: i,
                  enabled: rest[i].onTap != null,
                  child: Text(rest[i].label, style: TextStyle(color: rest[i].danger ? kRed : null)),
                ),
            ],
          ),
      ],
    );
  }
}

// ── Date + time field ────────────────────────────────────────────────────────

/// Date and time (portal `datetime-local` input).
class DateTimeField extends StatelessWidget {
  const DateTimeField({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.required = false,
    this.notAfterNow = false,
  });

  final String label;
  final DateTime? value;
  final ValueChanged<DateTime?> onChanged;
  final bool required;
  final bool notAfterNow;

  Future<void> _pick(BuildContext context) async {
    final now = DateTime.now();
    final last = notAfterNow ? now : DateTime(now.year + 5);
    var init = value ?? now;
    if (init.isAfter(last)) init = last;
    final d = await showDatePicker(context: context, initialDate: init, firstDate: DateTime(now.year - 10), lastDate: last);
    if (d == null || !context.mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(init));
    if (t == null) return;
    onChanged(DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () => _pick(context),
      child: InputDecorator(
        isEmpty: value == null,
        decoration: fieldDecoration(label,
            required: required,
            suffix: value != null && !required
                ? IconButton(icon: const Icon(Icons.clear_rounded), onPressed: () => onChanged(null))
                : const Icon(Icons.schedule_rounded, size: 20)),
        child: Text(value == null ? '' : fmtDateTime(value), style: const TextStyle(fontSize: 15)),
      ),
    );
  }
}

// ── Attachments (MaintenanceAttachments.tsx) ─────────────────────────────────

Future<void> uploadMtFiles(String entityType, int entityId, List<MultipartFile> files, String docType) async {
  final fd = FormData()
    ..fields.addAll([
      MapEntry('entity_type', entityType),
      MapEntry('entity_id', '$entityId'),
      MapEntry('doc_type', docType),
    ])
    ..files.addAll(files.map((f) => MapEntry('files', f)));
  await Api.dio.post('/maintenance/attachments', data: fd, options: Options(receiveTimeout: const Duration(minutes: 2)));
}

String _size(Object? bytes) {
  final b = asNum(bytes);
  if (b == null || b == 0) return '';
  if (b < 1024 * 1024) return '${(b / 1024).round()} KB';
  return '${(b / (1024 * 1024)).toStringAsFixed(1)} MB';
}

/// List / upload (camera, gallery, file) / open / delete files on an asset,
/// request or work order. Bytes come through the backend's /content proxy.
class AttachmentsSection extends StatefulWidget {
  const AttachmentsSection({
    super.key,
    required this.title,
    required this.entityType,
    required this.entityId,
    this.canUpload = true,
    this.canDelete = true,
    this.defaultDocType = 'other',
    this.reloadToken = 0,
  });

  final String title;
  final String entityType;
  final int entityId;
  final bool canUpload;
  final bool canDelete;
  final String defaultDocType;
  final int reloadToken;

  @override
  State<AttachmentsSection> createState() => _AttachmentsSectionState();
}

class _AttachmentsSectionState extends State<AttachmentsSection> {
  List<Json>? _items;
  String? _error;
  bool _busy = false;
  late String _docType = widget.defaultDocType;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant AttachmentsSection old) {
    super.didUpdateWidget(old);
    if (old.reloadToken != widget.reloadToken) _load();
  }

  Future<void> _load() async {
    try {
      final p = await Api.list('/maintenance/attachments',
          query: {'entity_type': widget.entityType, 'entity_id': widget.entityId});
      if (mounted) {
        setState(() {
          _items = p.rows;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _upload(String source) async {
    final List<MultipartFile> files;
    try {
      if (source == 'camera') {
        final f = await Files.takePhoto();
        files = f == null ? [] : [f];
      } else if (source == 'gallery') {
        final f = await Files.pickPhoto();
        files = f == null ? [] : [f];
      } else {
        files = await Files.pickFiles();
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not read the file: $e');
      return;
    }
    if (files.isEmpty || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await uploadMtFiles(widget.entityType, widget.entityId, files, _docType);
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(Json a) async {
    final ok = await confirmDialog(context,
        title: 'Delete attachment?', message: '${a['filename']} will be removed from this record.', confirmLabel: 'Delete', danger: true);
    if (!ok || !mounted) return;
    final done = await runAction(context, () => Api.delete('/maintenance/attachments/${a['id']}'));
    if (done) _load();
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return DetailSection(
      widget.title,
      children: [
        if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 8)],
        if (items == null && _error == null)
          mutedText('Loading…')
        else if (items != null && items.isEmpty)
          mutedText('No files attached yet.')
        else if (items != null)
          for (final a in items)
            LineItem(
              title: str(a['filename']),
              subtitle: [
                label(docTypeLabels, a['doc_type']),
                _size(a['size']),
                '${str(a['created_by_name'])} · ${fmtDateTime(a['created_at'])}',
              ].where((s) => s.isNotEmpty).join(' · '),
              lead: const Icon(Icons.insert_drive_file_outlined, size: 20, color: kOrange),
              onTap: () => runAction(context,
                  () => Files.downloadAndOpen('/maintenance/attachments/${a['id']}/content', str(a['filename']))),
              trailing: [
                if (widget.canDelete && (Perm.isAdmin || asInt(a['created_by_id']) == Perm.userId))
                  IconButton(
                    tooltip: 'Delete',
                    icon: const Icon(Icons.delete_outline_rounded, color: kRed, size: 20),
                    onPressed: () => _delete(a),
                  ),
              ],
            ),
        if (widget.canUpload) ...[
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            FilterSelect<String>(
              allLabel: 'Type',
              allowAll: false,
              value: _docType,
              options: optionsOf(docTypeLabels),
              onChanged: (v) => setState(() => _docType = v ?? widget.defaultDocType),
            ),
            smallBtn('Take photo', _busy ? null : () => _upload('camera')),
            smallBtn('Choose photo', _busy ? null : () => _upload('gallery')),
            smallBtn(_busy ? 'Uploading…' : 'Choose files', _busy ? null : () => _upload('files')),
          ]),
        ],
      ],
    );
  }
}

// ── Central approval engine (ApprovalPanel.tsx) ─────────────────────────────

const _reqLabel = {'pending': 'Waiting for approval', 'approved': 'Approved', 'rejected': 'Rejected', 'returned': 'Returned for changes', 'cancelled': 'Cancelled'};
const _reqHex = {'pending': kAmber, 'approved': kGreen, 'rejected': kRed, 'returned': Color(0xFF7C3AED), 'cancelled': kGrey};
const _stepLabel = {'waiting': 'Not yet', 'pending': 'Waiting', 'approved': 'Approved', 'rejected': 'Rejected', 'returned': 'Returned', 'skipped': 'Not needed', 'cancelled': 'Cancelled'};
const _stepHex = {'waiting': Color(0xFFA8A29E), 'pending': kAmber, 'approved': kGreen, 'rejected': kRed, 'returned': Color(0xFF7C3AED), 'skipped': Color(0xFFA8A29E), 'cancelled': Color(0xFFA8A29E)};
const _viaLabel = {'delegation': 'as delegate', 'escalation': 'after escalation', 'admin': 'admin stand-in'};

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
  String? _error;
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
      if (mounted) setState(() => _data = asMap(d));
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _act(Future<dynamic> Function() fn) async {
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
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _stages(Json req) {
    final steps = asList(req['steps']);
    final groups = <int, List<Json>>{};
    for (final s in steps) {
      groups.putIfAbsent(asInt(s['sequence']) ?? 0, () => []).add(s);
    }
    final current = asInt(req['current_sequence']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final e in groups.entries)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
                border: Border(left: BorderSide(width: 3, color: e.key == current ? kAmber : const Color(0x1F000000)))),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${e.key}. ${e.value.first['stage_name'] ?? ''}'
                  '${e.value.length > 1 ? (e.value.first['approval_mode'] == 'all' ? ' — every one must approve' : ' — any one approves') : ''}',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading),
                ),
                for (final s in e.value)
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Wrap(spacing: 6, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      Pill(_stepLabel[s['status']] ?? str(s['status']), _stepHex[s['status']] ?? kGrey),
                      Text(str(s['approver_name']).isEmpty ? '—' : str(s['approver_name']), style: const TextStyle(fontSize: 12.5)),
                      if (str(s['decided_by_name']).isNotEmpty && s['decided_by_id'] != s['approver_id'])
                        smallText('decided by ${s['decided_by_name']}${_viaLabel[s['via']] != null ? ' (${_viaLabel[s['via']]})' : ''}'),
                      if (s['decided_at'] != null) smallText(fmtDateTime(s['decided_at'])),
                      if (s['status'] == 'pending' && s['due_at'] != null) smallText('escalates ${fmtDateTime(s['due_at'])}'),
                      if (str(s['comment']).isNotEmpty)
                        Text('“${s['comment']}”', style: const TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic)),
                    ]),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data == null) {
      return _error == null ? const SizedBox.shrink() : DetailSection(widget.title, children: [ErrorBanner(_error!)]);
    }
    final req = asMap(data['current']);
    final history = asList(data['history']);
    if (req == null && history.isEmpty) return const SizedBox.shrink();
    final canAct = req != null && req['status'] == 'pending' && (req['can_decide'] == true || req['can_stand_in'] == true);
    return DetailSection(
      widget.title,
      children: [
        if (req != null) ...[
          Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Pill(_reqLabel[req['status']] ?? str(req['status']), _reqHex[req['status']] ?? kGrey),
            smallText('Submitted by ${str(req['requester_name']).isEmpty ? '—' : req['requester_name']} on ${fmtDateTime(req['submitted_at'])}'
                '${(asInt(req['revision']) ?? 1) > 1 ? ' · submission #${req['revision']}' : ''}'),
          ]),
          const SizedBox(height: 10),
          _stages(req),
        ],
        if (_error != null) ...[const SizedBox(height: 8), ErrorBanner(_error!)],
        if (canAct) ...[
          const SizedBox(height: 8),
          if (str(req['acting_for']).isNotEmpty) smallText('You are deciding on behalf of ${req['acting_for']}.'),
          if (req['can_decide'] != true && req['can_stand_in'] == true)
            smallText('You are not an approver of this stage — as an admin you can stand in; a comment is required.'),
          const SizedBox(height: 6),
          AppTextField(label: 'Comment (required to reject or return)', controller: _comment, maxLines: 3),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
              onPressed: _busy ? null : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': 'approve', 'comment': _comment.text})),
              child: const Text('Approve'),
            ),
            smallBtn('Return for changes', _busy ? null : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': 'return', 'comment': _comment.text}))),
            smallBtn('Reject', _busy ? null : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': 'reject', 'comment': _comment.text})), danger: true),
          ]),
        ],
        if (req != null && req['status'] == 'pending' && req['can_cancel'] == true) ...[
          const SizedBox(height: 8),
          smallBtn('Withdraw approval request', _busy
              ? null
              : () async {
                  final ok = await confirmDialog(context,
                      title: 'Withdraw approval request?', message: 'The approval request is cancelled.', confirmLabel: 'Withdraw');
                  if (ok) _act(() => Api.post('/approvals/requests/${req['id']}/cancel', data: {}));
                }),
        ],
        if (history.isNotEmpty) ...[
          const SizedBox(height: 8),
          InkWell(
            onTap: () => setState(() => _history = !_history),
            child: Text('${_history ? 'Hide' : 'Show'} earlier submissions (${history.length})',
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: kOrange)),
          ),
          if (_history)
            for (final h in history) ...[
              const Divider(),
              Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Pill(_reqLabel[h['status']] ?? str(h['status']), _reqHex[h['status']] ?? kGrey),
                smallText('Submission #${h['revision']} · ${fmtDateTime(h['submitted_at'])}'),
              ]),
              const SizedBox(height: 6),
              _stages(h),
            ],
        ],
      ],
    );
  }
}

/// Tab body with its own floating create button.
Widget withFab(Widget body, Widget? fab) =>
    fab == null ? body : Scaffold(backgroundColor: Colors.transparent, body: body, floatingActionButton: fab);
