import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

/// Shared bits of the Project Management screens - the phone side of
/// frontend/src/components/projects/work/pmUi.tsx.

// ── JSON helpers ─────────────────────────────────────────────────────────────

String? s(Object? v) {
  if (v == null) return null;
  final t = v.toString();
  return t.isEmpty ? null : t;
}

int? i(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));

num n(Object? v) => v is num ? v : (v is String ? (num.tryParse(v) ?? 0) : 0);

bool b(Object? v) => v == true;

List<Json> rowsOf(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

List<String> strs(Object? v) => v is List ? v.map((e) => '$e').toList() : <String>[];

List<int> ints(Object? v) => v is List ? v.map(i).whereType<int>().toList() : <int>[];

Json? obj(Object? v) => v is Map ? Map<String, dynamic>.from(v) : null;

Color hx(String hex) => Color(int.parse('FF${hex.replaceAll('#', '')}', radix: 16));

/// Today as "2026-11-04" (local date, like the portal's todayIso).
String todayIso() => apiDate(DateTime.now());

DateTime? dateOnly(Object? iso) {
  final t = s(iso);
  if (t == null || t.length < 10) return null;
  return DateTime.tryParse(t.substring(0, 10));
}

int? daysFromToday(Object? iso) {
  final d = dateOnly(iso);
  if (d == null) return null;
  final now = DateTime.now();
  return DateTime.utc(d.year, d.month, d.day).difference(DateTime.utc(now.year, now.month, now.day)).inDays;
}

String dueText(Object? iso, {bool done = false}) {
  if (done) return 'Achieved';
  final d = daysFromToday(iso);
  if (d == null) return '';
  if (d < 0) return 'Overdue by ${-d} day${d == -1 ? '' : 's'}';
  if (d == 0) return 'Due today';
  return '$d day${d == 1 ? '' : 's'} left';
}

// ── Labels and colours (pmUi.tsx) ────────────────────────────────────────────

const projectLabels = {
  'planning': 'Open', 'active': 'Active', 'on_hold': 'On hold', 'technically_complete': 'Technically complete',
  'closed': 'Closed', 'cancelled': 'Cancelled',
};
const projectHex = {
  'planning': '#64748b', 'active': '#16a34a', 'on_hold': '#f59e0b', 'technically_complete': '#0d9488',
  'closed': '#334155', 'cancelled': '#78716c',
};
const lifecycleOrder = [
  'planned', 'design', 'manufacturing', 'assembly', 'testing', 'ready_for_dispatch', 'dispatched', 'commissioning',
  'handover', 'closed',
];
const lifecycleLabels = {
  'planned': 'Planned', 'design': 'Design', 'manufacturing': 'Manufacturing', 'assembly': 'Assembly',
  'testing': 'Testing', 'ready_for_dispatch': 'Ready for Dispatch', 'dispatched': 'Dispatched',
  'commissioning': 'Commissioning', 'handover': 'Handover', 'closed': 'Closed / Delivered',
};
const lifecycleHex = {
  'planned': '#64748b', 'design': '#7c3aed', 'manufacturing': '#2563eb', 'assembly': '#0891b2', 'testing': '#f59e0b',
  'ready_for_dispatch': '#ea580c', 'dispatched': '#0d9488', 'commissioning': '#16a34a', 'handover': '#15803d',
  'closed': '#334155',
};
// Department-work (older WBS) milestone and task statuses.
const milestoneLabels = {
  'not_started': 'Not started', 'in_progress': 'In progress', 'submitted': 'Submitted', 'achieved': 'Achieved',
  'cancelled': 'Cancelled',
};
const milestoneHex = {
  'not_started': '#64748b', 'in_progress': '#2563eb', 'submitted': '#f59e0b', 'achieved': '#16a34a',
  'cancelled': '#78716c',
};
const taskLabels = {
  'todo': 'To do', 'in_progress': 'In progress', 'blocked': 'Blocked', 'done': 'Done', 'cancelled': 'Cancelled',
};
const taskHex = {
  'todo': '#64748b', 'in_progress': '#2563eb', 'blocked': '#dc2626', 'done': '#16a34a', 'cancelled': '#78716c',
};
const priorityLabels = {'standard': 'Standard', 'urgent': 'Urgent'};
const priorityHex = {'standard': '#64748b', 'urgent': '#dc2626'};
const healthLabels = {'on_track': 'On track', 'at_risk': 'At risk', 'delayed': 'Delayed'};
const healthHex = {'on_track': '#16a34a', 'at_risk': '#f59e0b', 'delayed': '#dc2626'};
const docTypeLabels = {
  'drawing': 'Drawing', 'report': 'Report', 'certificate': 'Certificate', 'specification': 'Specification',
  'contract': 'Contract', 'other': 'Other',
};

/// lib/priority.ts normalizePriority: anything not urgent is standard.
String normPriority(Object? v) => s(v) == 'urgent' || s(v) == 'high' || s(v) == 'critical' ? 'urgent' : 'standard';

// ── Small widgets ────────────────────────────────────────────────────────────

/// Coloured pill with the portal's exact colour (pillStyle).
class Pill extends StatelessWidget {
  const Pill(this.text, this.color, {super.key, this.bg, this.dot = false});
  final String text;
  final Color color;
  final Color? bg;
  final bool dot;

  factory Pill.of(String? value, Map<String, String> labels, Map<String, String> hex, {Key? key}) {
    final v = value ?? '';
    return Pill(labels[v] ?? humanize(v), hx(hex[v] ?? '#64748b'), key: key);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg ?? color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[
            Container(width: 6, height: 6, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
            const SizedBox(width: 5),
          ],
          Flexible(
            child: Text(text,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

/// Stage pill, plus an extra pill when the project is On hold / Cancelled.
class StagePills extends StatelessWidget {
  const StagePills({super.key, this.stage, this.label, this.status});
  final String? stage;
  final String? label;
  final String? status;

  @override
  Widget build(BuildContext context) {
    final k = stage ?? 'planned';
    return Wrap(spacing: 6, runSpacing: 4, children: [
      Pill(label ?? lifecycleLabels[k] ?? k, hx(lifecycleHex[k] ?? '#64748b')),
      if (status == 'on_hold' || status == 'cancelled') Pill.of(status, projectLabels, projectHex),
    ]);
  }
}

class ProgressBar extends StatelessWidget {
  const ProgressBar(this.value, {super.key, this.color, this.height = 6, this.showText = true});
  final num value;
  final Color? color;
  final double height;
  final bool showText;

  @override
  Widget build(BuildContext context) {
    final v = value.clamp(0, 100).toDouble();
    final c = v >= 100 ? const Color(0xFF16A34A) : (color ?? const Color(0xFF6366F1));
    return Row(children: [
      Expanded(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: LinearProgressIndicator(
              value: v / 100, minHeight: height, color: c, backgroundColor: const Color(0xFFE2E8F0)),
        ),
      ),
      if (showText) ...[
        const SizedBox(width: 8),
        Text('${v.round()}%', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.body)),
      ],
    ]);
  }
}

/// Info / warn / bad note (pmUi Notice).
class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.tone = 'info'});
  final String text;
  final String tone;

  @override
  Widget build(BuildContext context) {
    final c = tone == 'bad' ? hx('#b91c1c') : tone == 'warn' ? hx('#b45309') : hx('#1d4ed8');
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: c.withValues(alpha: 0.2)),
      ),
      child: Text(text, style: TextStyle(color: c, fontSize: 13)),
    );
  }
}

/// Label + value on one line (detail rows with a short value).
class InfoLine extends StatelessWidget {
  const InfoLine(this.label, this.value, {super.key});
  final String label;
  final Object? value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 110, child: Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.muted))),
        Expanded(
          child: value is Widget
              ? Align(alignment: Alignment.centerLeft, child: value as Widget)
              : Text(txt(value), style: const TextStyle(fontSize: 13.5, color: Brand.body)),
        ),
      ]),
    );
  }
}

/// Underline-free chip tabs inside a record screen (portal's record tabs).
class PmTabChips extends StatelessWidget {
  const PmTabChips({super.key, required this.labels, required this.index, required this.onChanged, this.counts});
  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;
  final List<String?>? counts;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
        itemCount: labels.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (ctx, k) {
          final on = k == index;
          final count = counts != null && k < counts!.length ? counts![k] : null;
          return Material(
            color: on ? const Color(0xFF6366F1) : Colors.white,
            shape: StadiumBorder(side: BorderSide(color: on ? const Color(0xFF6366F1) : Brand.border)),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: () => onChanged(k),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Center(
                  child: Text(count == null ? labels[k] : '${labels[k]}  $count',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: on ? FontWeight.w700 : FontWeight.w500,
                          color: on ? Colors.white : Brand.body)),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Loads data for a block inside a scrolling page (no scroll of its own).
class PmBlock<T> extends StatefulWidget {
  const PmBlock({super.key, required this.load, required this.builder, this.padded = true});
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, VoidCallback reload) builder;
  final bool padded;

  @override
  State<PmBlock<T>> createState() => _PmBlockState<T>();
}

class _PmBlockState<T> extends State<PmBlock<T>> {
  late Future<T> _f = widget.load();

  void _reload() => setState(() => _f = widget.load());

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: _f,
      builder: (ctx, snap) {
        if (snap.connectionState != ConnectionState.done) return const LoadingView();
        if (snap.hasError) {
          return Padding(
            padding: EdgeInsets.symmetric(horizontal: widget.padded ? 16 : 0, vertical: 8),
            child: Column(children: [
              ErrorBanner(ApiClient.describe(snap.error!)),
              TextButton.icon(onPressed: _reload, icon: const Icon(Icons.refresh_rounded), label: const Text('Retry')),
            ]),
          );
        }
        return widget.builder(ctx, snap.data as T, _reload);
      },
    );
  }
}

/// Muted one-line message inside a section (portal's grey <p>).
class MutedText extends StatelessWidget {
  const MutedText(this.text, {super.key, this.padding = const EdgeInsets.fromLTRB(16, 4, 16, 12)});
  final String text;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: padding, child: Text(text, style: const TextStyle(fontSize: 13, color: Brand.muted)));
}

/// Small coloured caps heading ("OVERDUE (3)").
class GroupTitle extends StatelessWidget {
  const GroupTitle(this.text, {super.key, this.color = Brand.muted});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 8), child: Caps(text, color: color));
}

/// Outlined small action button.
class SmallBtn extends StatelessWidget {
  const SmallBtn(this.label, {super.key, required this.onPressed, this.icon, this.color, this.filled = false});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Color? color;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Brand.body;
    final style = filled
        ? FilledButton.styleFrom(
            backgroundColor: color ?? const Color(0xFF6366F1),
            minimumSize: const Size(0, 38),
            padding: const EdgeInsets.symmetric(horizontal: 14),
            textStyle: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)))
        : null;
    if (filled) {
      return icon == null
          ? FilledButton(style: style, onPressed: onPressed, child: Text(label))
          : FilledButton.icon(style: style, onPressed: onPressed, icon: Icon(icon, size: 16), label: Text(label));
    }
    final o = OutlinedButton.styleFrom(
      foregroundColor: c,
      minimumSize: const Size(0, 38),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      side: BorderSide(color: color == null ? Brand.border : c.withValues(alpha: 0.4)),
      textStyle: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    );
    return icon == null
        ? OutlinedButton(style: o, onPressed: onPressed, child: Text(label))
        : OutlinedButton.icon(style: o, onPressed: onPressed, icon: Icon(icon, size: 16), label: Text(label));
  }
}

/// Titled form block inside a form sheet (portal SheetSection).
class SheetTitle extends StatelessWidget {
  const SheetTitle(this.title, {super.key, this.icon, this.optional = false});
  final String title;
  final IconData? icon;
  final bool optional;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(children: [
        if (icon != null) ...[Icon(icon, size: 18, color: const Color(0xFF2563EB)), const SizedBox(width: 8)],
        Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Brand.heading)),
        if (optional) const Text('  (optional)', style: TextStyle(fontSize: 12, color: Brand.muted)),
      ]),
    );
  }
}

class Hint extends StatelessWidget {
  const Hint(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) =>
      Text(text, style: const TextStyle(fontSize: 12, color: Brand.muted, height: 1.3));
}

/// Read-only value shown like a field (Project / Milestone on the task form).
class ReadOnlyField extends StatelessWidget {
  const ReadOnlyField(this.label, this.value, {super.key});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => InputDecorator(
        decoration: fieldDecoration(label).copyWith(fillColor: Brand.background),
        child: Text(value, style: const TextStyle(fontSize: 15, color: Brand.body)),
      );
}

// ── Permissions (lib/permissions.ts, pmUi usePmFeature, tabAccess.ts) ────────

class PmPerm {
  PmPerm._();

  /// Project Management features on projects:overview (milestones, tasks,
  /// task_files ...). Users whose roles do not open the project workspace
  /// (My Tasks is for everyone) are decided by the record rules only.
  static bool pmf(String feature, String action) =>
      !Perm.can('projects', 'overview', 'view') || Perm.canFeature('projects', 'overview', feature, action);

  /// 'Delete' on the tab AND the record is your own (admins: any).
  static bool canDeleteOwn(String module, String tab, Object? ownerId) {
    if (!Perm.can(module, tab, 'delete')) return false;
    if (Perm.isAdmin) return true;
    final o = i(ownerId);
    return o == null || o == Perm.userId;
  }

  /// The user's tab_access for Project Management (admins: every tab).
  static bool tabAllowed(String subtab) {
    final ta = Perm.user['tab_access'];
    if (ta is! Map) return true;
    final allowed = ta['projects'];
    if (allowed is! List) return true;
    return allowed.contains(subtab);
  }

  static bool get isPartnerOrAdmin => Perm.user['role'] == 'admin' || Perm.user['is_partner'] == true;

  /// Old service-module permission flags (hasErpPermission).
  static bool erp(String permission) {
    if (Perm.user['role'] == 'admin') return true;
    final p = Perm.user['erp_permissions'];
    return p is List && p.contains(permission);
  }
}

/// Role Visibility (lib/visibility.ts): hidden sections / columns and the
/// dropdown values a role is offered. The server still enforces them.
class PmVis {
  PmVis(this.key);
  final String key;

  Map? get _rule {
    if (Perm.isAdmin) return null;
    final v = Perm.user['visibility'];
    if (v is Map && v[key] is Map) return v[key] as Map;
    return null;
  }

  bool showSection(String section) {
    final h = _rule?['hidden_sections'];
    return !(h is List && h.contains(section));
  }

  bool showColumn(String table, String column) {
    final hc = _rule?['hidden_columns'];
    if (hc is! Map) return true;
    final cols = hc[table];
    return !(cols is List && cols.contains(column));
  }

  List<T> options<T>(String dropdown, List<T> all, String Function(T) valueOf) {
    final o = _rule?['options'];
    final allowed = o is Map ? o[dropdown] : null;
    if (allowed is! List || allowed.isEmpty) return all;
    final kept = all.where((x) => allowed.contains(valueOf(x))).toList();
    return kept.isEmpty ? all : kept;
  }
}

// ── People lists ─────────────────────────────────────────────────────────────

class PmPeople {
  PmPeople._();
  static Future<List<Json>>? _everyone;
  static Future<List<Json>>? _directory;

  /// Everyone a milestone / task can be given to (/pm-ongoing/people).
  static Future<List<Json>> everyone() =>
      _everyone ??= Api.get('/pm-ongoing/people').then(rowsOf).catchError((Object e) {
        _everyone = null;
        throw e;
      });

  /// The users directory (project manager picker, chat tags).
  static Future<List<Json>> directory() =>
      _directory ??= Api.get('/users/directory').then(rowsOf).catchError((Object e) {
        _directory = null;
        throw e;
      });

  /// The role's "Assign to" rule (core/assignee_rules.py). Null = no limit.
  static Future<Set<int>?> allowed(String key) async {
    try {
      final d = await Api.get('/assignee-rules/allowed', query: {'key': key});
      if (d is Map && d['restricted'] == true) return ints(d['user_ids']).toSet();
    } catch (_) {
      // Rule not loadable: nothing hidden - the server still refuses on save.
    }
    return null;
  }

  static String label(Json p) {
    final dept = s(p['department']);
    final des = s(p['designation']);
    return '${p['name']}${dept != null ? ' — $dept' : des != null ? ' — $des' : ''}';
  }
}

/// Several people: chips (tap x to remove) + a searchable picker to add.
class MultiPersonField extends StatelessWidget {
  const MultiPersonField({
    super.key,
    required this.label,
    required this.values,
    required this.options,
    required this.onChanged,
  });
  final String label;
  final List<int> values;
  final List<Option<int>> options;
  final ValueChanged<List<int>> onChanged;

  @override
  Widget build(BuildContext context) {
    final names = {for (final o in options) o.value: o.label};
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (values.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final v in values)
              InputChip(
                label: Text(names[v] ?? 'User #$v', style: const TextStyle(fontSize: 12.5)),
                onDeleted: () => onChanged(values.where((x) => x != v).toList()),
                visualDensity: VisualDensity.compact,
              ),
          ]),
        ),
      AppSelect<int>(
        label: label,
        value: null,
        options: options.where((o) => !values.contains(o.value)).toList(),
        onChanged: (o) {
          if (o != null && !values.contains(o.value)) onChanged([...values, o.value]);
        },
      ),
    ]);
  }
}

// ── Files ────────────────────────────────────────────────────────────────────

Future<void> openApiFile(BuildContext context, String path, String name) =>
    runAction(context, () => Files.downloadAndOpen(path, name));

/// Lets the user pick documents, then posts them as `files` (multipart).
/// Returns the server's reply, or null when nothing was picked.
Future<dynamic> pickAndUpload(String path, {Map<String, dynamic> fields = const {}}) async {
  final picked = await Files.pickFiles();
  if (picked.isEmpty) return null;
  return uploadFiles(path, picked, fields: fields);
}

Future<dynamic> uploadFiles(String path, List<MultipartFile> files, {Map<String, dynamic> fields = const {}}) {
  final fd = FormData();
  fields.forEach((k, v) => fd.fields.add(MapEntry(k, '$v')));
  for (final f in files) {
    fd.files.add(MapEntry('files', f));
  }
  return Api.dio
      .post(path, data: fd, options: Options(sendTimeout: const Duration(minutes: 5), receiveTimeout: const Duration(minutes: 5)))
      .then((r) => r.data);
}

/// One attached file row: name (opens), who / when, optional Remove.
class FileRow extends StatelessWidget {
  const FileRow({super.key, required this.title, this.sub, required this.onOpen, this.onDelete, this.tag});
  final String title;
  final String? sub;
  final String? tag;
  final VoidCallback? onOpen;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: Brand.border)),
      child: ListTile(
        dense: true,
        leading: const Icon(Icons.attach_file_rounded, size: 20, color: Color(0xFF2563EB)),
        title: Text(title,
            style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: onOpen == null ? Brand.body : const Color(0xFF2563EB))),
        subtitle: (sub == null && tag == null)
            ? null
            : Text([?tag, ?sub].join(' · '), style: const TextStyle(fontSize: 12, color: Brand.muted)),
        onTap: onOpen,
        trailing: onDelete == null
            ? null
            : IconButton(
                tooltip: 'Remove',
                icon: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
                onPressed: onDelete),
      ),
    );
  }
}

/// Small counter tile (dashboard KPIs, plan totals).
class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.color = Brand.heading, this.onTap, this.icon});
  final String label;
  final Object value;
  final Color color;
  final VoidCallback? onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            if (icon != null) ...[
              CircleAvatar(radius: 18, backgroundColor: color, child: Icon(icon, size: 18, color: Colors.white)),
              const SizedBox(width: 12),
            ],
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('$value',
                    style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        color: icon == null && value == 0 ? const Color(0xFF94A3B8) : (icon == null ? color : Brand.heading))),
                const SizedBox(height: 2),
                Text(label, style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Portal statusHex of the history tables.
Color historyHex(String? status) {
  final v = (status ?? '').toLowerCase();
  bool has(String re) => RegExp(re).hasMatch(v);
  if (has('cancel|reject|void|lost')) return hx('#b91c1c');
  if (has('partial|progress')) return hx('#B45309');
  if (has('complete|done|issued|received|closed|approved|achieved|posted|delivered')) return hx('#047857');
  if (has('open|released|ordered|active')) return hx('#B45309');
  if (has('pending|submitted|review|approval|sent')) return hx('#2563EB');
  return hx('#78716c');
}

String labelOf(Object? label, Object? key) => s(label) ?? humanize(key);
