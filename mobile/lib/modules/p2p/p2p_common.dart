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

// Shared bits of the Procurement module (portal: components/p2p/*).

// ── JSON helpers ─────────────────────────────────────────────────────────────

String? jStr(Json? j, String k) {
  final v = j?[k];
  if (v == null) return null;
  final s = v.toString();
  return s.isEmpty ? null : s;
}

int? jInt(Json? j, String k) {
  final v = j?[k];
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v);
  return null;
}

double? jNum(Json? j, String k) => toDouble(j?[k]);

double jD(Json? j, String k) => toDouble(j?[k]) ?? 0;

double? toDouble(Object? v) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

bool jBool(Json? j, String k) => j?[k] == true;

List<Json> jList(Json? j, String k) {
  final v = j?[k];
  if (v is! List) return const [];
  return v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
}

List<String> jStrings(Json? j, String k) {
  final v = j?[k];
  if (v is! List) return const [];
  return v.map((e) => e.toString()).toList();
}

Json asJson(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

List<Json> asList(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

const double eps = 0.0005;

final _qty = NumberFormat('#,##,##0.###', 'en_IN');
final _money2 = NumberFormat.currency(locale: 'en_IN', symbol: '₹ ', decimalDigits: 2);

/// "1,250.5" (up to 3 decimals); '—' when null.
String fmtQty(Object? v) {
  final n = toDouble(v);
  return n == null ? '—' : _qty.format(n);
}

/// "₹ 1,25,000.00"; '—' when null.
String money(Object? v) {
  final n = toDouble(v);
  return n == null ? '—' : _money2.format(n);
}

String typeLabel(String t) {
  final s = t.replaceAll('_', ' ');
  return s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);
}

/// Whole-number text for a quantity box ("12", "2.5").
String qtyText(double n) => n == n.roundToDouble() ? n.toInt().toString() : double.parse(n.toStringAsFixed(3)).toString();

// ── Access ───────────────────────────────────────────────────────────────────

class P2pAccess {
  P2pAccess._();

  static Json get user => Perm.user;
  static int? get me => Perm.userId;
  static bool get isAdmin => Perm.isAdmin;

  static List<String> get apps => (user['apps'] is List) ? (user['apps'] as List).map((e) => '$e').toList() : const [];

  /// The Purchase desk (portal: user.apps.includes('purchase')).
  static bool get isPurchaseTeam => apps.contains('purchase');

  /// Role tab access (portal filterTabsByAccess / canViewTab): admins have no entry = every tab.
  static bool tab(String subtab) {
    final ta = user['tab_access'];
    if (ta is! Map) return true;
    final allowed = ta['p2p'];
    if (allowed is! List) return true;
    return allowed.map((e) => '$e').contains(subtab);
  }

  static bool can(String tab, String action) => Perm.can('p2p', tab, action);
  static bool feat(String tab, String feature, String action) => Perm.canFeature('p2p', tab, feature, action);

  static Future<({bool pr, bool po})>? _flags;

  /// Whether the viewer approves requisitions / POs (old routing + approval engine), cached per app run.
  static Future<({bool pr, bool po})> flags() {
    if (isAdmin) return Future.value((pr: true, po: true));
    return _flags ??= () async {
      final u = user;
      var pr = u['is_pr_approver'] == true;
      var po = u['is_po_approver'] == true;
      try {
        final f = asJson(await Api.get('/p2p/requests/approver-flags'));
        pr = pr || f['is_pr_approver'] == true;
        po = po || f['is_po_approver'] == true;
      } catch (_) {/* old routing flags only */}
      return (pr: pr, po: po);
    }();
  }
}

// ── Status words and colours (portal maps) ───────────────────────────────────

const prStatusLabels = <String, String>{
  'submitted': 'Pending Approval',
  'approved': 'Approved',
  'vendor_quotations': 'RFQ / Quotations',
  'technical_evaluation': 'Technical Evaluation',
  'commercial_evaluation': 'Commercial Evaluation',
  'vendor_selected': 'Vendor Selected',
  'po_drafted': 'Draft PO',
  'po_raised': 'PO Raised',
  'po_approved': 'PO Approved',
  'partially_received': 'Partially Received',
  'received': 'Received',
  'closed': 'Closed',
  'rejected': 'Rejected',
  'cancelled': 'Cancelled',
  'returned': 'Returned for changes',
  'draft': 'Draft',
};

const prStatusHex = <String, int>{
  'submitted': 0xFF3B82F6,
  'approved': 0xFF22C55E,
  'vendor_quotations': 0xFF6366F1,
  'technical_evaluation': 0xFF8B5CF6,
  'commercial_evaluation': 0xFFA855F7,
  'vendor_selected': 0xFF0EA5E9,
  'po_drafted': 0xFF64748B,
  'po_raised': 0xFFF59E0B,
  'po_approved': 0xFF22C55E,
  'partially_received': 0xFFD97706,
  'received': 0xFF16A34A,
  'closed': 0xFF22C55E,
  'rejected': 0xFFDC2626,
  'cancelled': 0xFF94A3B8,
  'returned': 0xFF7C3AED,
  'draft': 0xFF64748B,
};

const inProgressStatuses = [
  'approved', 'vendor_quotations', 'technical_evaluation', 'commercial_evaluation', 'vendor_selected',
  'po_drafted', 'po_raised', 'po_approved', 'partially_received',
];

const purposeLabels = <String, String>{
  'customer_order': 'Project',
  'machine_project': 'Service',
  'development': 'New development',
  'department': 'Department running cost',
  'capital': 'Asset / capital purchase',
  'stock': 'Store stock refill',
};

/// "Partially Approved" for a submitted requisition some approvers signed.
({String label, Color color}) prDisplayStatus(Json pr) {
  final status = jStr(pr, 'status') ?? '';
  if (status == 'submitted') {
    final approvals = jList(pr, 'approvals');
    final assigned = approvals.isNotEmpty
        ? approvals.length
        : [pr['approver_id'], pr['project_head_id'], pr['plant_head_id']].where((v) => v != null).length;
    final pendingRoles = pr['pending_approval_roles'];
    final pending = pendingRoles is List ? pendingRoles.length : assigned;
    if (assigned > 0 && pending > 0 && pending < assigned) {
      return (label: 'Partially Approved', color: const Color(0xFF8B5CF6));
    }
  }
  return (label: prStatusLabels[status] ?? humanize(status), color: Color(prStatusHex[status] ?? 0xFF64748B));
}

const p2pRoleLabels = <String, String>{
  'design_manager': 'Design Manager',
  'rnd_manager': 'R&D Manager',
  'production_manager': 'Production Manager',
  'project_manager': 'Project Manager',
  'store_manager': 'Store Manager',
  'purchase_manager': 'Purchase Manager',
  'director': 'Director',
  'department_head': 'Department Head',
  'project_head': 'Project Head',
  'plant_head': 'Plant Head',
  'purchase_head': 'Purchase Head',
  'partner': 'Partner',
};

String p2pRoleLabel(String? role) => role == null ? '' : (p2pRoleLabels[role] ?? role);

const _roleFlags = {'purchase_head': 'is_purchase_head', 'director': 'is_director', 'partner': 'is_partner'};

/// Which of this requisition's PO-approval roles the viewer holds (portal lib/p2pRoles.ts userPoRoles).
List<String> userPoRoles(Json pr) {
  final me = P2pAccess.me;
  if (pr['project_type'] != null) {
    return [
      for (final row in jList(pr, 'po_approval_panel'))
        if (jList(row, 'people').any((p) => jInt(p, 'id') == me)) jStr(row, 'role') ?? '',
    ];
  }
  final u = P2pAccess.user;
  return [for (final r in _roleFlags.keys) if (u[_roleFlags[r]] == true) r];
}

String priorityLabel(Object? v) {
  final s = (v ?? '').toString().trim().toLowerCase();
  return const {'urgent', 'critical', 'high'}.contains(s) ? 'Urgent' : 'Standard';
}

bool isUrgent(Object? v) => priorityLabel(v) == 'Urgent';

// ── Small widgets ────────────────────────────────────────────────────────────

/// Coloured pill with the portal's own colour.
class Pill extends StatelessWidget {
  const Pill(this.label, this.color, {super.key});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => StatusBadge(label, color: color);
}

/// Amber / green / grey / red note box (portal's inline notices).
class NoteBox extends StatelessWidget {
  const NoteBox(this.text, {super.key, this.tone = NoteTone.info, this.child});
  final String text;
  final NoteTone tone;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      NoteTone.warn => (const Color(0x14F59E0B), const Color(0xFF92400E)),
      NoteTone.ok => (const Color(0x1416A34A), const Color(0xFF166534)),
      NoteTone.error => (Brand.dangerSoft, Brand.danger),
      NoteTone.info => (const Color(0x14647488), const Color(0xFF475569)),
    };
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: bg, borderRadius: BorderRadius.circular(10), border: Border.all(color: fg.withValues(alpha: 0.25))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(text, style: TextStyle(color: fg, fontSize: 13)),
          ?child,
        ],
      ),
    );
  }
}

enum NoteTone { info, warn, ok, error }

class Hint extends StatelessWidget {
  const Hint(this.text, {super.key, this.color});
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) =>
      Text(text, style: TextStyle(fontSize: 12, color: color ?? Brand.muted));
}

/// Label above value - a compact pair for cards inside sections.
class MiniField extends StatelessWidget {
  const MiniField(this.label, this.value, {super.key});
  final String label;
  final Object? value;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label.toUpperCase(),
              style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, letterSpacing: .5, color: Brand.muted)),
          const SizedBox(height: 2),
          value is Widget
              ? value as Widget
              : Text(txt(value), style: const TextStyle(fontSize: 13, color: Brand.body)),
        ],
      );
}

/// Grid of MiniFields, two per row.
class MiniGrid extends StatelessWidget {
  const MiniGrid(this.fields, {super.key});
  final List<Widget> fields;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (ctx, c) {
          final w = (c.maxWidth - 12) / 2;
          return Wrap(
            spacing: 12,
            runSpacing: 10,
            children: [for (final f in fields) SizedBox(width: w, child: f)],
          );
        },
      );
}

/// Bordered inner card (one line / one PO inside a section).
class InnerCard extends StatelessWidget {
  const InnerCard({super.key, required this.children, this.color});
  final List<Widget> children;
  final Color? color;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color ?? Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Brand.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
      );
}

// Buttons sized for rows (the theme's FilledButton is full width).
ButtonStyle _size(ButtonStyle s) => s.copyWith(
      minimumSize: const WidgetStatePropertyAll(Size(0, 42)),
      padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 14)),
      textStyle: const WidgetStatePropertyAll(TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
    );

Widget primaryBtn(String label, VoidCallback? onTap, {Color? color, IconData? icon}) {
  final style = _size(FilledButton.styleFrom(
    backgroundColor: color ?? Brand.primary,
    foregroundColor: Colors.white,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
  ));
  return icon == null
      ? FilledButton(style: style, onPressed: onTap, child: Text(label))
      : FilledButton.icon(style: style, onPressed: onTap, icon: Icon(icon, size: 18), label: Text(label));
}

Widget secondaryBtn(String label, VoidCallback? onTap, {Color? color, IconData? icon}) {
  final style = _size(OutlinedButton.styleFrom(
    foregroundColor: color ?? Brand.body,
    side: BorderSide(color: (color ?? Brand.body).withValues(alpha: 0.3)),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
  ));
  return icon == null
      ? OutlinedButton(style: style, onPressed: onTap, child: Text(label))
      : OutlinedButton.icon(style: style, onPressed: onTap, icon: Icon(icon, size: 18), label: Text(label));
}

Widget dangerBtn(String label, VoidCallback? onTap) => secondaryBtn(label, onTap, color: Brand.danger);

/// Small text-link button.
Widget linkBtn(String label, VoidCallback? onTap, {Color color = const Color(0xFF2563EB)}) => InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
        child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 13)),
      ),
    );

/// Bottom bar of buttons (wraps onto two rows when many).
Widget? actionBar(List<Widget> buttons) => buttons.isEmpty
    ? null
    : Wrap(spacing: 8, runSpacing: 8, alignment: WrapAlignment.end, children: buttons);

/// Horizontal strip of count chips above a list.
class ChipStrip extends StatelessWidget {
  const ChipStrip(this.children, {super.key});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 44,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
          children: children,
        ),
      );
}

/// Segment row (portal segmentBtnStyle tabs inside a page).
class SegmentRow extends StatelessWidget {
  const SegmentRow({super.key, required this.items, required this.selected, required this.onTap});
  final List<(String, String, int?)> items; // key, label, badge
  final String selected;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 44,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
          children: [
            for (final (key, label, badge) in items)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ChoiceChip(
                  label: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(label),
                    if (badge != null && badge > 0) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration:
                            BoxDecoration(color: const Color(0xFFDC2626), borderRadius: BorderRadius.circular(10)),
                        child: Text('$badge', style: const TextStyle(color: Colors.white, fontSize: 11)),
                      ),
                    ],
                  ]),
                  selected: selected == key,
                  onSelected: (_) => onTap(key),
                ),
              ),
          ],
        ),
      );
}

/// A row with the Filters button (and its active count) and Clear.
class FilterBar extends StatelessWidget {
  const FilterBar({super.key, required this.count, required this.onOpen, this.onClear, this.leading = const [], this.trailing = const []});
  final int count;
  final VoidCallback onOpen;
  final VoidCallback? onClear;
  final List<Widget> leading;
  final List<Widget> trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
        child: Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            ...leading,
            secondaryBtn(count > 0 ? 'Filters ($count)' : 'Filters', onOpen,
                icon: Icons.filter_alt_outlined, color: count > 0 ? const Color(0xFFC2410C) : null),
            if (count > 0 && onClear != null) secondaryBtn('Clear', onClear),
            ...trailing,
          ],
        ),
      );
}

// ── Actions ──────────────────────────────────────────────────────────────────

/// Downloads an API file and opens it; the server's reason on failure.
Future<void> openApiFile(BuildContext context, String path, String fileName, {Map<String, dynamic>? query}) async {
  showSnack(context, 'Opening $fileName…');
  try {
    await Files.downloadAndOpen(path, fileName, query: query);
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
  }
}

/// Runs a load with a blocking spinner (before opening a form that needs data).
Future<T?> withLoading<T>(BuildContext context, Future<T> Function() load) async {
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => const Center(child: CircularProgressIndicator()),
  );
  try {
    final r = await load();
    if (context.mounted) Navigator.of(context, rootNavigator: true).pop();
    return r;
  } catch (e) {
    if (context.mounted) {
      Navigator.of(context, rootNavigator: true).pop();
      showSnack(context, ApiClient.describe(e), error: true);
    }
    return null;
  }
}

/// One-question reason popup with a minimum length (portal: reason >= 5 chars).
Future<String?> reasonDialog(BuildContext context,
    {required String title, String? message, String label = 'Reason', int minLength = 1, String confirmLabel = 'Submit', bool required = true}) async {
  while (true) {
    final v = await promptDialog(context,
        title: title, message: message, label: label, required: required, confirmLabel: confirmLabel);
    if (v == null) return null;
    if (v.trim().length >= minLength || (!required && v.trim().isEmpty)) return v.trim();
    if (!context.mounted) return null;
    showSnack(context, 'Write at least $minLength characters - it is saved in the history.', error: true);
  }
}

/// People directory (assign / reassign buyer, referred-by).
Future<List<Option<int>>> directoryOptions(String search) async {
  final rows = asList(await Api.get('/users/directory'));
  final q = search.trim().toLowerCase();
  final opts = rows
      .map((u) => Option<int>(jInt(u, 'id') ?? 0, jStr(u, 'name') ?? 'User',
          subtitle: [jStr(u, 'designation'), jStr(u, 'department')].whereType<String>().join(' · ')))
      .where((o) => q.isEmpty || o.label.toLowerCase().contains(q) || (o.subtitle ?? '').toLowerCase().contains(q))
      .toList()
    ..sort((a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()));
  return opts;
}

/// Active vendors of the shared vendor master.
Future<List<Json>> loadActiveVendors() async => asList(await Api.get('/p2p/vendors', query: {'status': 'active'}));

/// Multipart form for uploads.
FormData formData(Map<String, dynamic> fields) => FormData.fromMap(fields);

// ── Central approval engine panel (portal ApprovalPanel) ─────────────────────

const _reqLabel = {
  'pending': 'Waiting for approval',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned for changes',
  'cancelled': 'Cancelled',
};
const _reqHex = {
  'pending': 0xFFF59E0B,
  'approved': 0xFF16A34A,
  'rejected': 0xFFDC2626,
  'returned': 0xFF7C3AED,
  'cancelled': 0xFF78716C,
};
const stepLabel = {
  'waiting': 'Not yet',
  'pending': 'Waiting',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned',
  'skipped': 'Not needed',
  'cancelled': 'Cancelled',
};
const stepHex = {
  'waiting': 0xFFA8A29E,
  'pending': 0xFFF59E0B,
  'approved': 0xFF16A34A,
  'rejected': 0xFFDC2626,
  'returned': 0xFF7C3AED,
  'skipped': 0xFFA8A29E,
  'cancelled': 0xFFA8A29E,
};
const viaLabel = {'delegation': 'as delegate', 'escalation': 'after escalation', 'admin': 'admin stand-in'};

/// One approval step line: pill, approver, who decided, when, comment.
class StepLine extends StatelessWidget {
  const StepLine(this.s, {super.key, this.showStage = false});
  final Json s;
  final bool showStage;

  @override
  Widget build(BuildContext context) {
    final st = jStr(s, 'status') ?? '';
    final decidedBy = jStr(s, 'decided_by_name');
    final approver = jStr(s, 'approver_name');
    final via = viaLabel[jStr(s, 'via')];
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Wrap(
        spacing: 6,
        runSpacing: 2,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Pill(stepLabel[st] ?? st, Color(stepHex[st] ?? 0xFF78716C)),
          if (showStage) Text(jStr(s, 'stage_name') ?? '', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          Text(approver ?? '—', style: const TextStyle(fontSize: 13)),
          if (decidedBy != null && decidedBy != approver)
            Hint('decided by $decidedBy${via != null ? ' ($via)' : ''}'),
          if (jStr(s, 'decided_at') != null) Hint(fmtDateTime(s['decided_at'])),
          if (st == 'pending' && jStr(s, 'due_at') != null) Hint('escalates ${fmtDateTime(s['due_at'])}'),
          if (jStr(s, 'comment') != null)
            Text('“${s['comment']}”', style: const TextStyle(fontStyle: FontStyle.italic, fontSize: 12.5)),
        ],
      ),
    );
  }
}

/// Stages of one approval request (portal StageList).
class StageList extends StatelessWidget {
  const StageList(this.req, {super.key});
  final Json req;

  @override
  Widget build(BuildContext context) {
    final groups = <int, List<Json>>{};
    final names = <int, (String, String)>{};
    for (final s in jList(req, 'steps')) {
      final seq = jInt(s, 'sequence') ?? 0;
      groups.putIfAbsent(seq, () => []).add(s);
      names[seq] = (jStr(s, 'stage_name') ?? '', jStr(s, 'approval_mode') ?? 'any');
    }
    final current = jInt(req, 'current_sequence');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final seq in groups.keys)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
                border: Border(
                    left: BorderSide(color: seq == current ? const Color(0xFFF59E0B) : Brand.border, width: 3))),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$seq. ${names[seq]!.$1}${groups[seq]!.length > 1 ? (names[seq]!.$2 == 'all' ? ' — every one must approve' : ' — any one approves') : ''}',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading),
                ),
                const SizedBox(height: 4),
                for (final s in groups[seq]!) StepLine(s),
              ],
            ),
          ),
      ],
    );
  }
}

/// Approval status + Approve / Return / Reject for one record, from the
/// central approval engine (Organization › Approval Workflows).
class EngineApprovalSection extends StatefulWidget {
  const EngineApprovalSection(
      {super.key, required this.entityType, required this.entityId, this.title = 'Approval', this.onChanged});
  final String entityType;
  final int entityId;
  final String title;
  final VoidCallback? onChanged;

  @override
  State<EngineApprovalSection> createState() => _EngineApprovalSectionState();
}

class _EngineApprovalSectionState extends State<EngineApprovalSection> {
  Json? _data;
  Object? _error;
  bool _busy = false;
  bool _showHistory = false;
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
      final d = asJson(await Api.get('/approvals/entity/${widget.entityType}/${widget.entityId}'));
      if (mounted) setState(() => _data = d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _decide(int reqId, String decision) async {
    setState(() => _busy = true);
    final ok = await runAction(context, () async {
      await Api.post('/approvals/requests/$reqId/decide', data: {'decision': decision, 'comment': _comment.text.trim()});
    },
        success: decision == 'approve'
            ? 'Approved.'
            : decision == 'reject'
                ? 'Rejected.'
                : 'Returned for changes.');
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      _comment.clear();
      await _load();
      widget.onChanged?.call();
    }
  }

  Future<void> _withdraw(int reqId) async {
    final yes = await confirmDialog(context,
        title: 'Withdraw approval request?',
        message: 'The approvers will no longer see it. You can submit it again later.',
        confirmLabel: 'Withdraw');
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.post('/approvals/requests/$reqId/cancel', data: {}), success: 'Withdrawn.');
    if (ok && mounted) {
      await _load();
      widget.onChanged?.call();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_data == null) {
      if (_error != null) {
        return DetailSection(widget.title, children: [ErrorBanner(ApiClient.describe(_error!))]);
      }
      return const SizedBox.shrink();
    }
    final req = _data!['current'] is Map ? asJson(_data!['current']) : null;
    final history = jList(_data, 'history');
    if (req == null && history.isEmpty) return const SizedBox.shrink();
    final status = jStr(req, 'status') ?? '';
    final canAct = req != null && status == 'pending' && (jBool(req, 'can_decide') || jBool(req, 'can_stand_in'));
    final reqId = jInt(req, 'id') ?? 0;
    return DetailSection(widget.title, children: [
      if (req != null) ...[
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Pill(_reqLabel[status] ?? status, Color(_reqHex[status] ?? 0xFF78716C)),
          Hint('Submitted by ${jStr(req, 'requester_name') ?? '—'} on ${fmtDateTime(req['submitted_at'])}'
              '${(jInt(req, 'revision') ?? 1) > 1 ? ' · submission #${req['revision']}' : ''}'),
        ]),
        const SizedBox(height: 10),
        StageList(req),
      ],
      if (canAct) ...[
        if (jStr(req, 'acting_for') != null) Hint('You are deciding on behalf of ${req['acting_for']}.'),
        if (!jBool(req, 'can_decide') && jBool(req, 'can_stand_in'))
          const Hint('You are not an approver of this stage — as an admin you can stand in; a comment is required.'),
        const SizedBox(height: 8),
        AppTextField(label: 'Comment (required to reject or return)', controller: _comment, maxLines: 3),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          primaryBtn('Approve', _busy ? null : () => _decide(reqId, 'approve')),
          secondaryBtn('Return for changes', _busy ? null : () => _decide(reqId, 'return')),
          dangerBtn('Reject', _busy ? null : () => _decide(reqId, 'reject')),
        ]),
      ],
      if (req != null && status == 'pending' && jBool(req, 'can_cancel')) ...[
        const SizedBox(height: 8),
        secondaryBtn('Withdraw approval request', _busy ? null : () => _withdraw(reqId)),
      ],
      if (history.isNotEmpty) ...[
        const SizedBox(height: 8),
        linkBtn('${_showHistory ? 'Hide' : 'Show'} earlier submissions (${history.length})',
            () => setState(() => _showHistory = !_showHistory),
            color: Brand.primaryActive),
        if (_showHistory)
          for (final h in history) ...[
            const Divider(),
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              Pill(_reqLabel[jStr(h, 'status')] ?? '${h['status']}', Color(_reqHex[jStr(h, 'status')] ?? 0xFF78716C)),
              Hint('Submission #${h['revision']} · ${fmtDateTime(h['submitted_at'])}'),
            ]),
            const SizedBox(height: 6),
            StageList(h),
          ],
      ],
    ]);
  }
}

/// Simple chips multi-select for forms (a list of check rows).
class CheckList<T> extends StatelessWidget {
  const CheckList({super.key, required this.options, required this.values, required this.onChanged});
  final List<Option<T>> options;
  final List<T> values;
  final ValueChanged<List<T>> onChanged;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          for (final o in options)
            CheckboxListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: Text(o.label),
              subtitle: o.subtitle == null ? null : Text(o.subtitle!),
              value: values.contains(o.value),
              onChanged: (v) => onChanged(v == true ? [...values, o.value] : values.where((x) => x != o.value).toList()),
            ),
        ],
      );
}

/// Section title used inside form sheets (portal SheetSection heading).
class FormHeading extends StatelessWidget {
  const FormHeading(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Text(text, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
      );
}

/// Item Master items (active) for line pickers - by id, never by name.
Future<List<Json>> loadActiveItems() async => (await Api.list('/store/items', query: {'status': 'active'})).rows;

String itemLabel(Json i) => '${jStr(i, 'item_code') ?? ''} — ${jStr(i, 'item_name') ?? ''}';

String itemDetail(Json i) => [
      jStr(i, 'make'),
      jStr(i, 'part_number') ?? jStr(i, 'manufacturer_part_number'),
      jStr(i, 'uom'),
      jStr(i, 'category'),
    ].whereType<String>().join(' · ');
