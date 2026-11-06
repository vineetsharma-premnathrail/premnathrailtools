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

// Shared pieces of the Store & Inventory screens (portal:
// frontend/src/components/store/*, lib/tabAccess.ts, ApprovalPanel,
// ManagedDocumentPanel, BatchPicker, BinSerialPicker, ProjectUnitPicker).

// ── Access ───────────────────────────────────────────────────────────────────

/// Portal `filterTabsByAccess('store', …)`: a Store tab key the user may view.
/// No `tab_access` entry for the module (admins) = every tab.
bool storeTab(String key) {
  if (Perm.isAdmin) return true;
  final ta = Perm.user['tab_access'];
  if (ta is! Map) return true;
  final allowed = ta['store'];
  if (allowed is! List) return true;
  return allowed.contains(key);
}

bool storeAnyTab(List<String> keys) => keys.any(storeTab);

bool can(String tab, String action) => Perm.can('store', tab, action);

bool canFeature(String tab, String feature, String action) => Perm.canFeature('store', tab, feature, action);

/// Store › Items › Stock value & rates (sensitive ₹ columns).
bool get seeValues => canFeature('items', 'stock_values', 'view');

List<String> userApps() {
  final a = Perm.user['apps'];
  return a is List ? a.whereType<String>().toList() : const [];
}

// ── Numbers, colours, small widgets ──────────────────────────────────────────

final _qtyFmt = NumberFormat.decimalPattern('en_IN')..maximumFractionDigits = 3;
final _rupeeFmt = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);

num? toNum(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);
int? toInt(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));
double numOr0(Object? v) => (toNum(v) ?? 0).toDouble();

/// Indian grouping, at most 3 decimals: "1,25,000.5"; '—' when empty.
String fmtQ(Object? v, [Object? uom]) {
  final n = toNum(v);
  if (n == null) return '—';
  final u = (uom ?? '').toString().trim();
  return u.isEmpty ? _qtyFmt.format(n) : '${_qtyFmt.format(n)} $u';
}

/// "₹1,25,000" (no decimals) for overview totals.
String fmtInr0(num n) => _rupeeFmt.format(n);

/// Text field value → number (blank = null).
num? parseNum(String s) => s.trim().isEmpty ? null : num.tryParse(s.trim());

/// Blank text → null, else trimmed.
String? blankToNull(String s) => s.trim().isEmpty ? null : s.trim();

const cGreen = Color(0xFF16A34A);
const cRed = Color(0xFFDC2626);
const cAmber = Color(0xFFD97706);
const cBlue = Color(0xFF2563EB);
const cPurple = Color(0xFF7C3AED);
const cGrey = Color(0xFF64748B);

/// Coloured status pill with the portal's own colour.
Widget pill(String label, Color color) => StatusBadge(label, color: color);

/// Section heading inside a form sheet.
class FormHeading extends StatelessWidget {
  const FormHeading(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Row(children: [
          Expanded(child: Caps(text, color: Brand.primaryActive)),
          ?trailing,
        ]),
      );
}

/// Small helper text under a field.
class Hint extends StatelessWidget {
  const Hint(this.text, {super.key, this.color});
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) =>
      Text(text, style: TextStyle(fontSize: 12, color: color ?? Brand.muted, height: 1.35));
}

/// Tinted note banner (portal role="note" boxes).
class InfoNote extends StatelessWidget {
  const InfoNote(this.text, {super.key, this.color = cAmber});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.28)),
        ),
        child: Text(text, style: TextStyle(fontSize: 13, color: Color.lerp(color, Colors.black, 0.35))),
      );
}

/// Page intro under the module tabs (portal header: title + one line + buttons).
class StorePageHeader extends StatelessWidget {
  const StorePageHeader(this.title, {super.key, this.subtitle, this.actions = const []});
  final String title;
  final String? subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PageHeader(title, subtitle: subtitle),
          if (actions.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Wrap(spacing: 8, runSpacing: 8, children: actions),
            ),
        ],
      );
}

/// Outlined pill button (portal secondaryBtnStyle).
class PillButton extends StatelessWidget {
  const PillButton(this.label, {super.key, required this.onPressed, this.icon, this.color});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
        onPressed: onPressed,
        icon: Icon(icon ?? Icons.chevron_right_rounded, size: 16),
        label: Text(label),
        style: OutlinedButton.styleFrom(
          foregroundColor: color ?? Brand.body,
          side: BorderSide(color: color == null ? Brand.border : color!.withValues(alpha: 0.4)),
          shape: const StadiumBorder(),
          visualDensity: VisualDensity.compact,
        ),
      );
}

/// KPI tile (portal stat cards).
class KpiTile extends StatelessWidget {
  const KpiTile(this.label, this.value, {super.key, this.hint, this.color, this.onTap});
  final String label;
  final String value;
  final String? hint;
  final Color? color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Card(
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
                Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: color ?? Brand.heading)),
                if (hint != null) ...[
                  const SizedBox(height: 2),
                  Text(hint!, style: const TextStyle(fontSize: 11.5, color: Color(0xFF475569))),
                ],
              ],
            ),
          ),
        ),
      );
}

/// Two KPI tiles per row.
class KpiGrid extends StatelessWidget {
  const KpiGrid(this.tiles, {super.key});
  final List<Widget> tiles;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      rows.add(IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Expanded(child: tiles[i]),
          const SizedBox(width: 10),
          Expanded(child: i + 1 < tiles.length ? tiles[i + 1] : const SizedBox()),
        ]),
      ));
      rows.add(const SizedBox(height: 10));
    }
    return Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 0), child: Column(children: rows));
  }
}

/// A row of count chips / segment chips that scrolls sideways.
class ChipRow extends StatelessWidget {
  const ChipRow(this.chips, {super.key});
  final List<Widget> chips;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 48,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
          children: chips,
        ),
      );
}

/// Label above a value (compact grid cell in cards).
class MiniFact extends StatelessWidget {
  const MiniFact(this.label, this.value, {super.key, this.color, this.bold = false});
  final String label;
  final String value;
  final Color? color;
  final bool bold;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: Brand.muted)),
          Text(value,
              style: TextStyle(
                  fontSize: 13, fontWeight: bold ? FontWeight.w700 : FontWeight.w500, color: color ?? Brand.body)),
        ],
      );
}

/// One line of a document (item, quantity, extra facts) on a detail screen.
class LineTile extends StatelessWidget {
  const LineTile({super.key, required this.title, this.subtitle, this.trailing, this.facts = const [], this.extra, this.onTap});
  final String title;
  final String? subtitle;
  final String? trailing;
  final List<Widget> facts;
  final Widget? extra;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: Color(0x14000000)))),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(
                  child: Text(title,
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Brand.heading)),
                ),
                if (trailing != null) ...[
                  const SizedBox(width: 8),
                  Text(trailing!, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: Brand.body)),
                ],
              ]),
              if (subtitle != null && subtitle!.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(subtitle!, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                ),
              if (facts.isNotEmpty) ...[
                const SizedBox(height: 6),
                Wrap(spacing: 16, runSpacing: 6, children: facts),
              ],
              ?extra,
            ],
          ),
        ),
      );
}

/// Bordered box that groups one editable line in a form sheet.
class LineBox extends StatelessWidget {
  const LineBox({super.key, required this.children, this.title, this.onRemove, this.danger = false});
  final List<Widget> children;
  final String? title;
  final VoidCallback? onRemove;
  final bool danger;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.fromLTRB(12, 6, 6, 12),
        decoration: BoxDecoration(
          color: danger ? cRed.withValues(alpha: 0.05) : Brand.background,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: danger ? cRed.withValues(alpha: 0.4) : Brand.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Expanded(child: Caps(title ?? '')),
              if (onRemove != null)
                IconButton(
                  tooltip: 'Remove line',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.delete_outline_rounded, size: 20),
                  onPressed: onRemove,
                )
              else
                const SizedBox(height: 36),
            ]),
            for (var i = 0; i < children.length; i++) ...[
              if (i > 0) const SizedBox(height: 10),
              Padding(padding: const EdgeInsets.only(right: 6), child: children[i]),
            ],
          ],
        ),
      );
}

/// "+ Add Item" ghost button under form lines.
class AddLineButton extends StatelessWidget {
  const AddLineButton(this.label, {super.key, required this.onPressed});
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(onPressed: onPressed, icon: const Icon(Icons.add_rounded, size: 18), label: Text(label)),
      );
}

/// Sticky bottom bar of a detail screen: buttons side by side.
class ActionBar extends StatelessWidget {
  const ActionBar(this.buttons, {super.key});
  final List<Widget> buttons;

  @override
  Widget build(BuildContext context) => Row(children: [
        for (var i = 0; i < buttons.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(child: buttons[i]),
        ],
      ]);
}

Widget primaryAction(String label, VoidCallback? onPressed, {Color? color}) => FilledButton(
      style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(44),
          backgroundColor: color,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
      onPressed: onPressed,
      child: Text(label, textAlign: TextAlign.center),
    );

Widget secondaryAction(String label, VoidCallback? onPressed, {Color? color}) => OutlinedButton(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(44),
        padding: const EdgeInsets.symmetric(horizontal: 8),
        foregroundColor: color ?? Brand.body,
        side: BorderSide(color: color == null ? Brand.border : color.withValues(alpha: 0.45)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      onPressed: onPressed,
      child: Text(label, textAlign: TextAlign.center),
    );

/// Bottom-bar actions, or null when there are none.
Widget? actionBar(List<Widget> buttons) => buttons.isEmpty ? null : ActionBar(buttons);

/// Detail screen body: scrolling list with breathing room.
Widget detailList(List<Widget> children) => ListView(
    physics: const AlwaysScrollableScrollPhysics(),
    padding: const EdgeInsets.only(top: 12, bottom: 24),
    children: children);

/// Title + text + badges on top of a detail screen (portal DetailSummary).
class SummaryCard extends StatelessWidget {
  const SummaryCard({super.key, required this.title, this.text, this.badges = const [], this.meta = const []});
  final String title;
  final String? text;
  final List<Widget> badges;
  final List<String> meta;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading)),
                if (text != null && text!.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(text!, style: const TextStyle(fontSize: 13.5, color: Brand.body, height: 1.4)),
                ],
                if (badges.isNotEmpty || meta.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      ...badges,
                      for (final m in meta.where((m) => m.isNotEmpty))
                        Text(m, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      );
}

/// Inner sub-tab pills (portal: StoreNav second row of a group).
class SubTabs extends StatefulWidget {
  const SubTabs({super.key, required this.tabs});
  final List<(String, WidgetBuilder)> tabs;

  @override
  State<SubTabs> createState() => _SubTabsState();
}

class _SubTabsState extends State<SubTabs> {
  int _i = 0;

  @override
  Widget build(BuildContext context) {
    final tabs = widget.tabs;
    if (tabs.isEmpty) {
      return const EmptyView('You have no pages of this group yet. Ask your admin to give your role access.');
    }
    if (_i >= tabs.length) _i = 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (tabs.length > 1) ...[
          Container(
            color: Colors.white,
            child: ChipRow([
              for (var i = 0; i < tabs.length; i++)
                CountChip(tabs[i].$1, null, selected: i == _i, onTap: () => setState(() => _i = i)),
            ]),
          ),
          const Divider(height: 1),
        ],
        Expanded(child: KeyedSubtree(key: ValueKey(_i), child: Builder(builder: tabs[_i].$2))),
      ],
    );
  }
}

// ── Shared master data (cached) ──────────────────────────────────────────────

class StoreData {
  StoreData._();

  static final Map<int, Json> itemById = {};
  static List<Json>? _locations;
  static List<Json>? _allPlantLocations;
  static List<Json>? _categories;
  static Json? _meta;
  static List<Json>? _directory;
  static List<Json>? _allItems;

  /// Item Master rows (search on the server; '' = all, cached). Sorted by
  /// item code like the portal.
  static Future<List<Json>> items({String search = '', bool activeOnly = false, bool refresh = false}) async {
    if (search.isEmpty && !activeOnly && _allItems != null && !refresh) return _allItems!;
    final rows = (await Api.list('/store/items', query: {'search': search, 'status': activeOnly ? 'active' : null})).rows;
    for (final r in rows) {
      final id = toInt(r['id']);
      if (id != null) itemById[id] = r;
    }
    if (search.isEmpty && !activeOnly) _allItems = rows;
    return rows;
  }

  static Future<List<Json>> locations({bool allPlants = false, bool refresh = false}) async {
    if (allPlants) {
      if (_allPlantLocations == null || refresh) {
        _allPlantLocations = (await Api.list('/store/locations', query: {'all_plants': true})).rows;
      }
      return _allPlantLocations!;
    }
    if (_locations == null || refresh) _locations = (await Api.list('/store/locations')).rows;
    return _locations!;
  }

  static Future<List<Json>> categories({bool refresh = false}) async {
    if (_categories == null || refresh) _categories = (await Api.list('/store/categories')).rows;
    return _categories!;
  }

  /// /store/items/meta: item_types, uoms, gst_rates, purchase/sales ledgers, vendors.
  static Future<Json> meta({bool refresh = false}) async {
    if (_meta == null || refresh) _meta = jsonMap(await Api.get('/store/items/meta'));
    return _meta!;
  }

  static Future<List<Json>> directory() async {
    _directory ??= (await Api.list('/users/directory')).rows;
    return _directory!;
  }

  static String? userName(int? id) {
    for (final u in _directory ?? const <Json>[]) {
      if (toInt(u['id']) == id) return txt(u['name']);
    }
    return null;
  }

  /// After a master-data change (Settings) or a new item.
  static void clear() {
    _locations = null;
    _allPlantLocations = null;
    _categories = null;
    _meta = null;
    _allItems = null;
  }
}

List<Json> jsonList(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

Json jsonMap(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

String itemLabel(Json? i) {
  if (i == null) return '';
  return '${txt(i['item_code'])} — ${txt(i['item_name'])}';
}

/// One line under an item in a picker (type · category · UOM · spec).
String itemDetail(Json i) => [humanize(i['item_type']), i['category'], i['uom'], i['description']]
    .where((x) => x != null && x.toString().trim().isNotEmpty && x != '—')
    .join(' · ');

Future<List<Option<int>>> _itemOptions(String search, {bool activeOnly = false, bool Function(Json)? where}) async {
  final rows = await StoreData.items(search: search.trim(), activeOnly: activeOnly);
  return [
    for (final i in rows)
      if (toInt(i['id']) != null && (where == null || where(i)))
        Option(toInt(i['id'])!, itemLabel(i), subtitle: itemDetail(i)),
  ];
}

/// Item Master picker (lines always carry store_item_id, never a name).
class ItemSelect extends StatelessWidget {
  const ItemSelect({
    super.key,
    required this.value,
    required this.onChanged,
    this.label = 'Item',
    this.required = true,
    this.enabled = true,
    this.activeOnly = false,
    this.where,
  });
  final int? value;
  final ValueChanged<Json?> onChanged;
  final String label;
  final bool required;
  final bool enabled;
  final bool activeOnly;
  final bool Function(Json)? where;

  @override
  Widget build(BuildContext context) => AppSelect<int>(
        label: label,
        required: required,
        enabled: enabled,
        value: value,
        valueLabel: value == null ? null : itemLabel(StoreData.itemById[value]),
        loadOptions: (s) => _itemOptions(s, activeOnly: activeOnly, where: where),
        onChanged: (o) => onChanged(o == null ? null : StoreData.itemById[o.value]),
      );
}

/// Store (location) picker.
class LocationSelect extends StatefulWidget {
  const LocationSelect({
    super.key,
    required this.value,
    required this.onChanged,
    this.label = 'Store',
    this.required = true,
    this.allPlants = false,
    this.activeOnly = false,
    this.enabled = true,
    this.only,
  });
  final int? value;
  final ValueChanged<Json?> onChanged;
  final String label;
  final bool required;
  final bool allPlants;
  final bool activeOnly;
  final bool enabled;

  /// Restrict the choice to these stores (e.g. the user's own).
  final List<Json>? only;

  @override
  State<LocationSelect> createState() => _LocationSelectState();
}

class _LocationSelectState extends State<LocationSelect> {
  List<Json> _rows = const [];

  @override
  void initState() {
    super.initState();
    if (widget.only == null) {
      StoreData.locations(allPlants: widget.allPlants).then((r) {
        if (mounted) setState(() => _rows = r);
      }, onError: (Object _) {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = (widget.only ?? _rows).where((l) => !widget.activeOnly || l['is_active'] != false).toList();
    return AppSelect<int>(
      label: widget.label,
      required: widget.required,
      enabled: widget.enabled,
      value: widget.value,
      options: [
        for (final l in rows)
          if (toInt(l['id']) != null) Option(toInt(l['id'])!, txt(l['name']), subtitle: l['code']?.toString()),
      ],
      onChanged: (o) {
        if (o == null) return widget.onChanged(null);
        widget.onChanged(rows.firstWhere((l) => toInt(l['id']) == o.value));
      },
    );
  }
}

/// Approver picker from the user directory (the user is left out: nobody
/// approves their own document — the server refuses it too).
class UserSelect extends StatelessWidget {
  const UserSelect({super.key, required this.value, required this.onChanged, required this.label, this.required = true});
  final int? value;
  final ValueChanged<int?> onChanged;
  final String label;
  final bool required;

  @override
  Widget build(BuildContext context) => AppSelect<int>(
        label: label,
        required: required,
        value: value,
        valueLabel: StoreData.userName(value),
        loadOptions: (s) async {
          final q = s.toLowerCase();
          final rows = await StoreData.directory();
          return [
            for (final u in rows)
              if (toInt(u['id']) != null &&
                  toInt(u['id']) != Perm.userId &&
                  '${u['name']} ${u['email']}'.toLowerCase().contains(q))
                Option(toInt(u['id'])!, txt(u['name']), subtitle: u['email']?.toString()),
          ];
        },
        onChanged: (o) => onChanged(o?.value),
      );
}

/// A project and its unit (vehicle / lot) — portal ProjectUnitPicker.
class ProjectUnit {
  const ProjectUnit(this.projectId, this.elementId, this.display);
  final int projectId;
  final int? elementId;
  final String display;

  String get key => '$projectId:${elementId ?? ''}';
}

class ProjectUnitSelect extends StatelessWidget {
  const ProjectUnitSelect({
    super.key,
    required this.value,
    required this.onChanged,
    this.label = 'Project — Unit (vehicle / lot)',
    this.requireElement = true,
  });
  final ProjectUnit? value;
  final ValueChanged<ProjectUnit?> onChanged;
  final String label;
  final bool requireElement;

  static final Map<String, ProjectUnit> _cache = {};

  @override
  Widget build(BuildContext context) => AppSelect<String>(
        label: label,
        value: value?.key,
        valueLabel: value?.display,
        loadOptions: (s) async {
          final rows = (await Api.list('/projects/units/lookup',
                  query: {'q': s.trim(), 'include_projects': !requireElement}))
              .rows;
          final out = <Option<String>>[];
          for (final r in rows) {
            final pid = toInt(r['project_id']);
            if (pid == null) continue;
            final u = ProjectUnit(pid, toInt(r['element_id']), txt(r['display']));
            _cache[u.key] = u;
            out.add(Option(u.key, u.display));
          }
          return out;
        },
        onChanged: (o) => onChanged(o == null ? null : _cache[o.value]),
      );
}

/// Store doc types (issue / return_source / return_condition).
Future<List<Json>> docTypes(String kind, {bool includeInactive = false}) async =>
    (await Api.list('/store/doc-types/$kind', query: {'include_inactive': includeInactive ? true : null})).rows;

// ── Files ────────────────────────────────────────────────────────────────────

String todayIso() => apiDate(DateTime.now());

/// Downloads an API file and opens it; errors go to a snack.
Future<void> openApiFile(BuildContext context, String path, String fileName, {Map<String, dynamic>? query}) =>
    runAction(context, () => Files.downloadAndOpen(path, fileName, query: query));

/// Posts a picked file as multipart `file` (+ extra fields). Returns the
/// server's answer; throws the API error.
Future<dynamic> uploadMultipart(String path, MultipartFile file,
    {Map<String, dynamic> fields = const {}, String field = 'file'}) async {
  final res = await Api.dio.post(path,
      data: FormData.fromMap({...fields, field: file}),
      options: Options(contentType: 'multipart/form-data', receiveTimeout: const Duration(minutes: 3)));
  return res.data;
}

/// Picks a document (or photo) and uploads it. Null when cancelled / failed
/// (the server's reason is shown).
Future<dynamic> pickAndUpload(BuildContext context, String path,
    {Map<String, dynamic> fields = const {}, List<String>? extensions, bool photo = false, String field = 'file'}) async {
  final file = photo ? await Files.pickPhoto() : await Files.pickFile(extensions: extensions);
  if (file == null) return null;
  try {
    return await uploadMultipart(path, file, fields: fields, field: field);
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return null;
  }
}

/// "Import from Excel" for document lines: {lines, errors} or null.
Future<Json?> importLines(BuildContext context, String path) async {
  final res = await pickAndUpload(context, path, extensions: const ['xlsx', 'xlsm', 'csv']);
  return res is Map ? Map<String, dynamic>.from(res) : null;
}

/// Shows the skipped rows of a line import.
Future<void> showImportErrors(BuildContext context, int added, List<Json> errors) async {
  if (errors.isEmpty) return;
  await messageDialog(
      context,
      'Excel Import',
      [
        '$added line(s) were added. ${errors.length} row(s) were skipped — fix them in the file and import again, or add them by hand:',
        for (final e in errors)
          'Row ${txt(e['row'])}${e['item_code'] != null ? ' (${e['item_code']})' : ''}: ${txt(e['reason'])}',
      ].join('\n\n'));
}

/// Simple message dialog (portal MessageDialog).
Future<void> messageDialog(BuildContext context, String title, String message) => showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(child: Text(message)),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
      ),
    );

/// Opens a record screen and runs [after] when it closes (list reload).
Future<void> openThen(BuildContext context, Widget screen, VoidCallback after) async {
  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  after();
}

/// Options from {value,label} maps.
List<Option<String>> valueLabelOptions(Object? rows) => [
      for (final r in jsonList(rows))
        if (r['value'] != null) Option(r['value'].toString(), txt(r['label'])),
    ];

/// Options from {id,label} maps.
List<Option<int>> idLabelOptions(Object? rows) => [
      for (final r in jsonList(rows))
        if (toInt(r['id']) != null) Option(toInt(r['id'])!, txt(r['label'])),
    ];