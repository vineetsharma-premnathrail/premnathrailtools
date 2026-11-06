// Shared bits of the Electrical module screens - the phone copy of
// frontend/src/components/electrical/shared.tsx: status labels and colours,
// permission helpers (useJobFeatures), role visibility (useVisibility),
// lookups and small UI pieces used by every tab.
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

const elecModule = 'electrical';

// ── Labels and colours (shared.tsx) ──────────────────────────────────────────

const cStone = Color(0xFF78716C);
const cStoneLight = Color(0xFFA8A29E);
const cSlate = Color(0xFF64748B);
const cAmber = Color(0xFFF59E0B);
const cPurple = Color(0xFF9333EA);
const cBlue = Color(0xFF2563EB);
const cGreen = Color(0xFF16A34A);
const cGreenDark = Color(0xFF15803D);
const cRed = Color(0xFFDC2626);
const cTeal = Color(0xFF0D9488);
const cBrown = Color(0xFFA16207);
const cOrange = Color(0xFFFF6A2A);

const jobStatusLabels = {
  'draft': 'Draft', 'in_progress': 'In Progress', 'on_hold': 'On Hold', 'handed_over': 'Handed Over',
  'closed': 'Closed', 'cancelled': 'Cancelled',
};
const jobStatusHex = {
  'draft': cStone, 'in_progress': cAmber, 'on_hold': cPurple, 'handed_over': cBlue, 'closed': cGreen,
  'cancelled': cStoneLight,
};
const priorityLabels = {'standard': 'Standard', 'urgent': 'Urgent'};
const priorityHex = {'standard': Color(0xFF475569), 'urgent': cRed};
const stageStatusLabels = {
  'not_started': 'Not Started', 'in_progress': 'In Progress', 'completed': 'Completed', 'not_applicable': 'N/A',
};
const stageStatusHex = {'not_started': cStoneLight, 'in_progress': cAmber, 'completed': cGreen, 'not_applicable': cSlate};
const phaseOrder = ['design', 'procurement', 'build', 'test_qc', 'handover'];
const phaseLabels = {
  'design': 'Design & Engineering', 'procurement': 'Procurement', 'build': 'Assembly & Installation',
  'test_qc': 'Testing & QC', 'handover': 'Commissioning & Handover',
};
const phaseHex = {'design': cBlue, 'procurement': cPurple, 'build': cAmber, 'test_qc': cTeal, 'handover': cGreen};
const selectionLabels = {'proposed': 'Proposed', 'selected': 'Selected', 'approved': 'Approved'};
const selectionHex = {'proposed': cStone, 'selected': cBlue, 'approved': cGreen};
const procurementLabels = {
  'required': 'To Buy', 'in_stock': 'In Stock', 'pr_raised': 'PR Raised', 'ordered': 'Ordered',
  'received': 'Received', 'issued': 'Issued',
};
const procurementHex = {
  'required': cRed, 'in_stock': cTeal, 'pr_raised': cPurple, 'ordered': cBlue, 'received': cGreen, 'issued': cGreenDark,
};
const panelStatusLabels = {
  'designed': 'Designed', 'in_assembly': 'In Assembly', 'assembled': 'Assembled', 'tested': 'Tested', 'installed': 'Installed',
};
const panelStatusHex = {'designed': cStone, 'in_assembly': cAmber, 'assembled': cBlue, 'tested': cTeal, 'installed': cGreen};
const cableStatusLabels = {
  'designed': 'Designed', 'cut': 'Cut', 'harnessed': 'Harnessed', 'installed': 'Installed', 'terminated': 'Terminated',
  'tested': 'Tested',
};
const cableStatusHex = {
  'designed': cStone, 'cut': cBrown, 'harnessed': cAmber, 'installed': cBlue, 'terminated': cTeal, 'tested': cGreen,
};
const revisionStatusLabels = {
  'draft': 'Draft', 'submitted': 'Awaiting Approval', 'approved': 'Approved', 'rejected': 'Rejected',
  'superseded': 'Superseded',
};
const revisionStatusHex = {
  'draft': cStone, 'submitted': cAmber, 'approved': cGreen, 'rejected': cRed, 'superseded': cStoneLight,
};
const testResultLabels = {'pass': 'Pass', 'fail': 'Fail'};
const testResultHex = {'pass': cGreen, 'fail': cRed};
const testPhaseLabels = {'factory': 'Factory', 'commissioning': 'Commissioning'};
const severityLabels = {'minor': 'Minor', 'major': 'Major', 'critical': 'Critical'};
const severityHex = {'minor': cStone, 'major': cAmber, 'critical': cRed};
const issueStatusLabels = {'open': 'Open', 'investigating': 'Investigating', 'resolved': 'Resolved', 'closed': 'Closed'};
const issueStatusHex = {'open': cRed, 'investigating': cAmber, 'resolved': cBlue, 'closed': cGreen};
const inspectionLabels = {
  'pending': 'Inspection pending', 'in_progress': 'Inspecting', 'passed': 'Passed', 'failed': 'Failed',
  'conditionally_passed': 'Passed (conditional)',
};
const inspectionHex = {'pending': cAmber, 'in_progress': cBlue, 'passed': cGreen, 'failed': cRed, 'conditionally_passed': cTeal};

/// Job statuses in which the job's records can still change.
const workingStatuses = ['draft', 'in_progress', 'handed_over'];

/// Legacy priorities collapse to Standard / Urgent (lib/priority.ts).
String normalizePriority(Object? v) =>
    const {'urgent', 'critical', 'high'}.contains((v ?? '').toString().trim().toLowerCase()) ? 'urgent' : 'standard';
String priorityLabel(Object? v) => priorityLabels[normalizePriority(v)]!;

// ── Value helpers ────────────────────────────────────────────────────────────

String str(Object? v) => v == null ? '' : v.toString();
int? asInt(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));
num? asNum(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);
bool asBool(Object? v) => v == true;
List<Json> rowsOf(dynamic data) => ApiPage.from(data).rows;
Json asJson(dynamic data) => data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
String? strOrNull(String v) => v.trim().isEmpty ? null : v.trim();
num? numOrNull(String v) => v.trim().isEmpty ? null : num.tryParse(v.trim());
String humanizeKey(String key) =>
    key.replaceAll('_', ' ').split(' ').map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1)).join(' ');
String fmtBytes(Object? v) {
  final n = asNum(v);
  if (n == null || n == 0) return '';
  if (n > 1048576) return '${(n / 1048576).toStringAsFixed(1)} MB';
  final kb = (n / 1024).round();
  return '${kb < 1 ? 1 : kb} KB';
}

String plural(num n, String one, [String? many]) => n == 1 ? one : (many ?? '${one}s');

/// A key-ordered label map from the API (`meta.component_categories` ...).
Map<String, String> labelMap(Object? v) =>
    v is Map ? v.map((k, val) => MapEntry(k.toString(), val.toString())) : <String, String>{};

/// [Option]s from a label map.
List<Option<String>> optionsOf(Map<String, String> labels) =>
    [for (final e in labels.entries) Option(e.key, e.value)];

// ── Permissions (useJobFeatures / tabAccess) ─────────────────────────────────

class Elec {
  Elec._();

  static bool can(String tab, String action) => Perm.can(elecModule, tab, action);

  static bool hasApp(String app) => Perm.hasApp(app);

  /// Module tab visible to the role (lib/tabAccess.ts filterTabsByAccess).
  static bool tabVisible(String key) {
    if (Perm.isAdmin) return true;
    final ta = Perm.user['tab_access'];
    if (ta is! Map) return true;
    final allowed = ta[elecModule];
    if (allowed is! List) return true;
    return allowed.contains(key);
  }

  /// May do `action` on a job feature (Electrical › RRV Electrical Jobs › feature).
  static bool jf(String feature, String action) => Perm.canFeature(elecModule, 'jobs', feature, action);

  /// Someone without Jobs › View (opening a job from Testing etc.) keeps the read-only view.
  static bool sees(String feature) => !can('jobs', 'view') || jf(feature, 'view');

  /// The portal's canDelete: Delete on the tab, and own record unless admin.
  static bool canDelete(String tab, Object? ownerId) {
    if (!can(tab, 'delete')) return false;
    if (Perm.isAdmin) return true;
    final o = asInt(ownerId);
    return o == null || o == Perm.userId;
  }
}

/// Role visibility for one screen key (lib/visibility.ts useVisibility).
class Vis {
  Vis(String key) : _rule = Perm.isAdmin ? null : _ruleFor(key);
  final Map? _rule;

  static Map? _ruleFor(String key) {
    final v = Perm.user['visibility'];
    return v is Map && v[key] is Map ? v[key] as Map : null;
  }

  bool showSection(String section) {
    final hidden = _rule?['hidden_sections'];
    return !(hidden is List && hidden.contains(section));
  }

  bool showColumn(String table, String column) {
    final hc = _rule?['hidden_columns'];
    if (hc is Map && hc[table] is List) return !(hc[table] as List).contains(column);
    return true;
  }

  /// Dropdown choices narrowed to what the role offers (all when unrestricted).
  List<T> options<T>(String dropdown, List<T> all, String Function(T) valueOf) {
    final opts = _rule?['options'];
    final allowed = opts is Map ? opts[dropdown] : null;
    if (allowed is! List || allowed.isEmpty) return all;
    final kept = all.where((i) => allowed.contains(valueOf(i))).toList();
    return kept.isEmpty ? all : kept;
  }
}

// ── Lookups ──────────────────────────────────────────────────────────────────

/// GET /electrical/lookups/meta - stages, categories, types (kept for the session).
class ElecMeta {
  ElecMeta(this.raw);
  final Json raw;

  static Future<ElecMeta>? _cache;
  static Future<ElecMeta> load() {
    final f = _cache ??= Api.get('/electrical/lookups/meta').then((d) => ElecMeta(asJson(d)));
    f.catchError((Object _) {
      _cache = null;
      return ElecMeta(const {});
    });
    return f;
  }

  Map<String, String> get componentCategories => labelMap(raw['component_categories']);
  Map<String, String> get panelTypes => labelMap(raw['panel_types']);
  Map<String, String> get drawingTypes => labelMap(raw['drawing_types']);
  Map<String, String> get testTypes => labelMap(raw['test_types']);
  Map<String, String> get documentCategories => labelMap(raw['document_categories']);
  List<Json> get stages {
    final list = rowsOf(raw['stages']);
    list.sort((a, b) => (asInt(a['sequence']) ?? 0).compareTo(asInt(b['sequence']) ?? 0));
    return list;
  }
}

/// GET /electrical/lookups/users - people for owner / tested-by / assignee pickers.
Future<List<Json>> loadElecUsers() async => rowsOf(await Api.get('/electrical/lookups/users'));

/// The role's "Assign to" rule for one picker (hooks/useAssigneeFilter.ts).
/// Nothing is hidden when the rule can't load - the server still checks on save.
Future<bool Function(int)> loadAssigneeFilter(String key) async {
  try {
    final d = await Api.get('/assignee-rules/allowed', query: {'key': key});
    if (d is Map && d['restricted'] == true && d['user_ids'] is List) {
      final ids = (d['user_ids'] as List).map(asInt).whereType<int>().toSet();
      return (id) => ids.contains(id);
    }
  } catch (_) {}
  return (_) => true;
}

/// People options for a picker, filtered by the role rule; [keep] stays listed (current value).
Future<List<Option<int>>> userOptions({String? ruleKey, int? keep, String search = ''}) async {
  final users = await loadElecUsers();
  final allow = ruleKey == null ? (int _) => true : await loadAssigneeFilter(ruleKey);
  final q = search.trim().toLowerCase();
  return [
    for (final u in users)
      if (asInt(u['id']) != null &&
          (asInt(u['id']) == keep || allow(asInt(u['id'])!)) &&
          (q.isEmpty || str(u['label']).toLowerCase().contains(q)))
        Option(asInt(u['id'])!, str(u['label'])),
  ];
}

// ── Files ────────────────────────────────────────────────────────────────────

/// Downloads a streamed file (drawing revision / document) and opens it.
Future<void> openElecFile(BuildContext context, String apiPath, String fileName) =>
    runAction(context, () => Files.downloadAndOpen(apiPath, fileName.isEmpty ? 'file' : fileName));

/// A picked upload with its name, for the forms.
class PickedFile {
  PickedFile(this.file, this.name);
  final MultipartFile file;
  final String name;
}

/// "Choose file" row inside a form sheet: shows the picked name, Clear.
class FilePickRow extends StatelessWidget {
  const FilePickRow({super.key, required this.label, required this.picked, required this.onPicked, this.extensions, this.optional = true});
  final String label;
  final PickedFile? picked;
  final ValueChanged<PickedFile?> onPicked;
  final List<String>? extensions;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: fieldDecoration(optional ? '$label (optional)' : label),
      child: Row(
        children: [
          Expanded(
            child: Text(picked?.name ?? 'No file chosen',
                maxLines: 2, overflow: TextOverflow.ellipsis,
                style: TextStyle(color: picked == null ? Brand.muted : Brand.body)),
          ),
          if (picked != null)
            IconButton(tooltip: 'Remove', icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => onPicked(null)),
          TextButton.icon(
            icon: const Icon(Icons.attach_file_rounded, size: 18),
            label: Text(picked == null ? 'Choose' : 'Change'),
            onPressed: () async {
              final f = await Files.pickFile(extensions: extensions);
              if (f != null) onPicked(PickedFile(f, f.filename ?? 'file'));
            },
          ),
        ],
      ),
    );
  }
}

// ── UI pieces ────────────────────────────────────────────────────────────────

/// Coloured pill from a label/colour map (shared.tsx Pill); '—' when empty.
Widget pill(Object? value, Map<String, String> labels, Map<String, Color> colors) {
  final v = str(value);
  if (v.isEmpty) return const Text('—', style: TextStyle(color: Brand.muted));
  return StatusBadge(labels[v] ?? v.replaceAll('_', ' '), color: colors[v] ?? cStone);
}

/// Fixed-colour pill ("Overdue", "As-built", "Needs retest").
Widget tagPill(String text, Color color) => StatusBadge(text, color: color);

ButtonStyle _compact(Color? fg, {Color? border}) => OutlinedButton.styleFrom(
      foregroundColor: fg ?? Brand.body,
      minimumSize: const Size(0, 34),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      visualDensity: VisualDensity.compact,
      side: BorderSide(color: border ?? Brand.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
      textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
    );

/// The portal's small secondary row button (Edit, Start, Link PR ...).
Widget smallBtn(String label, VoidCallback? onTap, {bool danger = false, Color? color}) => OutlinedButton(
      style: _compact(danger ? cRed : color, border: danger ? cRed.withValues(alpha: 0.35) : color?.withValues(alpha: 0.35)),
      onPressed: onTap,
      child: Text(label),
    );

/// The portal's primary button, sized to its text.
Widget primaryBtn(String label, VoidCallback? onTap, {IconData? icon, Color? color}) => FilledButton.icon(
      style: FilledButton.styleFrom(
        backgroundColor: color ?? Brand.primary,
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
      onPressed: onTap,
      icon: Icon(icon ?? Icons.add_rounded, size: 18),
      label: Text(label),
    );

/// Row of buttons that wraps on a narrow screen.
Widget btnWrap(List<Widget> buttons) => Wrap(spacing: 6, runSpacing: 6, children: buttons);

/// Sticky bottom bar of a detail screen: buttons share the width.
Widget bottomActions(List<Widget> buttons) => Row(
      children: [
        for (var i = 0; i < buttons.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(child: buttons[i]),
        ],
      ],
    );

/// Full-width bottom-bar button.
Widget barBtn(String label, VoidCallback? onTap, {bool primary = false, bool danger = false}) {
  if (primary) {
    return FilledButton(
      style: FilledButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 8)),
      onPressed: onTap,
      child: Text(label, textAlign: TextAlign.center),
    );
  }
  return OutlinedButton(
    style: OutlinedButton.styleFrom(
      foregroundColor: danger ? cRed : Brand.body,
      minimumSize: const Size(0, 44),
      padding: const EdgeInsets.symmetric(horizontal: 8),
      side: BorderSide(color: danger ? cRed.withValues(alpha: 0.4) : Brand.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    onPressed: onTap,
    child: Text(label, textAlign: TextAlign.center),
  );
}

/// Coloured message box (hold reason, notices, stage blockers).
class NoteBox extends StatelessWidget {
  const NoteBox(this.text, {super.key, this.color = cAmber, this.textColor, this.child});
  final String text;
  final Color color;
  final Color? textColor;
  final Widget? child;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: child ?? Text(text, style: TextStyle(fontSize: 13, color: textColor ?? color)),
      );
}

/// Small muted line of text.
class Muted extends StatelessWidget {
  const Muted(this.text, {super.key, this.size = 12.5, this.color = Brand.muted});
  final String text;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(text, style: TextStyle(fontSize: size, color: color));
}

/// Section heading inside a form sheet ("RRV & JOB").
class FormHeading extends StatelessWidget {
  const FormHeading(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.only(top: 6), child: Caps(text, color: Brand.primaryActive));
}

/// Thin progress bar.
class Bar extends StatelessWidget {
  const Bar(this.fraction, {super.key, this.color = cGreen, this.height = 8});
  final double fraction;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(height / 2),
        child: LinearProgressIndicator(
          value: fraction.isNaN ? 0 : fraction.clamp(0, 1).toDouble(),
          minHeight: height,
          color: color,
          backgroundColor: Colors.black.withValues(alpha: 0.07),
        ),
      );
}

/// A record card inside a job tab (non-scrolling list item).
class ItemCard extends StatelessWidget {
  const ItemCard({super.key, required this.children, this.accent, this.selected = false});
  final List<Widget> children;
  final Color? accent;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: selected ? const Color(0x0DFF6A2A) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Brand.border),
        ),
        child: accent == null
            ? body
            : IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [Container(width: 3, color: accent), Expanded(child: body)],
                ),
              ),
      ),
    );
  }
}

/// "Label: value" pairs in a compact wrap (inside an [ItemCard]).
class MetaWrap extends StatelessWidget {
  const MetaWrap(this.pairs, {super.key});
  final List<(String, String)> pairs;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Wrap(
          spacing: 16,
          runSpacing: 6,
          children: [
            for (final (l, v) in pairs)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(l, style: const TextStyle(fontSize: 11, color: Brand.muted)),
                  Text(v, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Brand.body)),
                ],
              ),
          ],
        ),
      );
}

/// Tab section header: title, summary line, primary button.
class TabHeader extends StatelessWidget {
  const TabHeader({super.key, required this.title, this.summary, this.action});
  final String title;
  final Widget? summary;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Caps(title),
                  if (summary != null) ...[const SizedBox(height: 4), summary!],
                ],
              ),
            ),
            ?action,
          ],
        ),
      );
}

/// Choice chips that act like the portal's segment buttons.
Widget segment(String label, bool selected, VoidCallback onTap) => Padding(
      padding: const EdgeInsets.only(right: 6),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
        selectedColor: Brand.primarySoft,
        labelStyle: TextStyle(
            fontSize: 13, fontWeight: FontWeight.w600, color: selected ? Brand.primaryActive : Brand.body),
        visualDensity: VisualDensity.compact,
      ),
    );

/// Runs a mutation with the server's reason on failure; true when it worked.
Future<bool> mutate(BuildContext context, Future<void> Function() fn, {String? success}) =>
    runAction(context, fn, success: success);
