import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

// Shared pieces of the HR & Administration module (portal:
// frontend/src/components/hr/**). Label / colour maps are copied from the
// portal so the phone shows the same words and colours.

// ── Access ───────────────────────────────────────────────────────────────────

/// Portal `filterTabsByAccess('hr', ...)`: a tab shows when any of its
/// sub-tab keys is in `tab_access.hr` (no entry = admin, everything).
bool hrTabAllowed(List<String> keys) {
  final ta = Perm.user['tab_access'];
  if (ta is! Map) return true;
  final allowed = ta['hr'];
  if (allowed is! List) return true;
  return keys.any(allowed.contains);
}

/// Holds the HR app (portal `user.apps.includes('hr')`).
bool get isHrUser => Perm.hasApp('hr');

/// Portal `canActOnTab('hr', tab, user)`: HR staff for one tab.
bool hrStaffFor(String tab) => isHrUser && hrTabAllowed([tab]);

int? get myUserId => Perm.userId;

// ── Values ───────────────────────────────────────────────────────────────────

Color hexColor(String hex) => Color(int.parse('FF${hex.replaceAll('#', '')}', radix: 16));

num toNum(Object? v) => v is num ? v : (num.tryParse('${v ?? ''}') ?? 0);

int? asInt(Object? v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('${v ?? ''}'));

String str(Object? v) => v == null ? '' : '$v';

/// 2 → "2", 1.5 → "1.5" (portal `num()`).
String numTxt(Object? v) {
  final n = toNum(v);
  return n == n.roundToDouble() ? n.toInt().toString() : n.toStringAsFixed(1);
}

/// "2 days" / "1 day" / "0.5 days".
String daysTxt(Object? v) => '${numTxt(v)} ${toNum(v) == 1 ? 'day' : 'days'}';

/// 475 → "7:55".
String hhmm(Object? minutes) {
  var m = toNum(minutes).round();
  if (m < 0) m = 0;
  return '${m ~/ 60}:${(m % 60).toString().padLeft(2, '0')}';
}

String todayIso() => apiDate(DateTime.now());

DateTime? dateOf(Object? v) {
  final s = str(v);
  if (s.isEmpty) return null;
  return DateTime.tryParse(s.length >= 10 ? s.substring(0, 10) : s);
}

String? isoOrNull(DateTime? d) => d == null ? null : apiDate(d);

List<Json> rowsOf(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

Json mapOf(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

String joinNonEmpty(List<Object?> parts, [String sep = ' · ']) =>
    parts.map(str).where((s) => s.trim().isNotEmpty).join(sep);

List<Option<String>> optionsOf(Map<String, String> m) => [for (final e in m.entries) Option(e.key, e.value)];

/// Trimmed text or null (payload helper).
String? textOrNull(String? v) {
  final t = (v ?? '').trim();
  return t.isEmpty ? null : t;
}

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Label / colour maps (portal copies) ──────────────────────────────────────

const requestStatusLabels = {'pending': 'Pending', 'approved': 'Approved', 'rejected': 'Rejected', 'cancelled': 'Cancelled'};
const requestStatusHex = {'pending': '#F59E0B', 'approved': '#16A34A', 'rejected': '#DC2626', 'cancelled': '#64748B'};
const sessionShort = {'full': '', 'first_half': ' (1st half)', 'second_half': ' (2nd half)'};

const attLabels = {
  'present': 'Present', 'absent': 'Absent', 'half_day': 'Half day', 'on_leave': 'On leave', 'holiday': 'Holiday',
  'weekly_off': 'Weekly off', 'on_duty': 'On duty', 'work_from_home': 'Work from home', 'unmarked': 'Not marked',
};
const attShort = {
  'present': 'Present', 'absent': 'Absent', 'half_day': 'Half', 'on_leave': 'Leave', 'holiday': 'Holiday',
  'weekly_off': 'Off', 'on_duty': 'On duty', 'work_from_home': 'WFH', 'unmarked': '—',
};
const attHex = {
  'present': '#16A34A', 'absent': '#DC2626', 'half_day': '#F59E0B', 'on_leave': '#7C3AED', 'holiday': '#0EA5E9',
  'weekly_off': '#94A3B8', 'on_duty': '#2563EB', 'work_from_home': '#0D9488', 'unmarked': '#CBD5E1',
};

const travelModeLabels = {
  'air': 'Air', 'train': 'Train', 'bus': 'Bus', 'car': 'Own / hired car', 'company_vehicle': 'Company vehicle', 'other': 'Other',
};
const travelStatusLabels = {'pending': 'Pending', 'approved': 'Approved', 'rejected': 'Rejected', 'cancelled': 'Cancelled', 'completed': 'Completed'};
const travelStatusHex = {'pending': '#F59E0B', 'approved': '#2563EB', 'rejected': '#DC2626', 'cancelled': '#64748B', 'completed': '#16A34A'};

const claimStatusLabels = {'draft': 'Draft', 'submitted': 'Submitted', 'approved': 'Approved', 'rejected': 'Rejected', 'paid': 'Paid', 'cancelled': 'Cancelled'};
const claimStatusHex = {'draft': '#64748B', 'submitted': '#F59E0B', 'approved': '#2563EB', 'rejected': '#DC2626', 'paid': '#16A34A', 'cancelled': '#94A3B8'};
const expenseCategoryLabels = {
  'travel': 'Travel / tickets', 'lodging': 'Lodging', 'food': 'Food', 'local_conveyance': 'Local conveyance',
  'fuel': 'Fuel', 'phone': 'Phone / data', 'other': 'Other',
};

const assetCategoryLabels = {
  'laptop': 'Laptop', 'desktop': 'Desktop', 'mobile': 'Mobile', 'sim': 'SIM Card', 'tablet': 'Tablet', 'monitor': 'Monitor',
  'vehicle': 'Vehicle', 'id_card': 'ID Card', 'access_card': 'Access Card', 'furniture': 'Furniture', 'tool': 'Tool', 'other': 'Other',
};
const assetConditionLabels = {'new': 'New', 'good': 'Good', 'fair': 'Fair', 'poor': 'Poor', 'damaged': 'Damaged'};
const assetStatusLabels = {'in_stock': 'In Stock', 'issued': 'Issued', 'under_repair': 'Under Repair', 'retired': 'Retired', 'lost': 'Lost'};
const assetStatusHex = {'in_stock': '#16A34A', 'issued': '#2563EB', 'under_repair': '#F59E0B', 'retired': '#64748B', 'lost': '#DC2626'};

const visitorStatusLabels = {'expected': 'Expected', 'checked_in': 'Inside', 'checked_out': 'Checked Out', 'cancelled': 'Cancelled'};
const visitorStatusHex = {'expected': '#F59E0B', 'checked_in': '#16A34A', 'checked_out': '#64748B', 'cancelled': '#94A3B8'};
const idProofTypes = ['Aadhaar', 'PAN', 'Driving Licence', 'Passport', 'Voter ID', 'Company ID', 'Other'];

const employmentStatusLabels = {'onboarding': 'Onboarding', 'active': 'Active', 'notice': 'On Notice', 'exited': 'Exited'};
const employmentStatusHex = {'onboarding': '#2563EB', 'probation': '#CA8A04', 'active': '#16A34A', 'notice': '#DC2626', 'exited': '#64748B'};
const employmentTypeLabels = {
  'permanent': 'Permanent', 'fixed_term': 'Fixed-term', 'contract': 'Contractual', 'trainee': 'Trainee / Apprentice',
  'intern': 'Intern', 'consultant': 'Consultant',
};
const workerTypeLabels = {
  'office': 'Office staff', 'factory': 'Factory / workshop', 'housekeeping': 'Housekeeping / cleaning',
  'contract': 'Contract labour', 'other': 'Other',
};
const recordStatusLabels = {'draft': 'Draft', 'incomplete': 'Incomplete', 'complete': 'Complete'};
const recordStatusHex = {'draft': '#64748B', 'incomplete': '#CA8A04', 'complete': '#16A34A'};
const attendancePolicyLabels = {
  'biometric': 'Biometric punch', 'supervisor': 'Marked by supervisor', 'self': 'Self-service (portal)', 'exempt': 'Exempt from attendance',
};
const probationStatusLabels = {'not_applicable': 'Not applicable', 'on_probation': 'On probation', 'confirmed': 'Confirmed'};
const loginStatusLabels = {
  'linked': 'Linked to portal account', 'pending_first_sign_in': 'Waiting for first sign-in',
  'not_provisioned': 'Not provisioned', 'not_required': 'HR record only — no login',
};

const lcTypeLabels = {'joining': 'Joining', 'confirmation': 'Confirmation', 'transfer': 'Transfer', 'promotion': 'Promotion', 'exit': 'Exit'};
const lcTypeHex = {'joining': '#16A34A', 'confirmation': '#0891B2', 'transfer': '#2563EB', 'promotion': '#7C3AED', 'exit': '#DC2626'};
const lcStatusLabels = {'draft': 'Draft', 'in_progress': 'In Progress', 'scheduled': 'Scheduled', 'completed': 'Completed', 'cancelled': 'Cancelled'};
const lcStatusHex = {'draft': '#78716C', 'in_progress': '#F59E0B', 'scheduled': '#7C3AED', 'completed': '#16A34A', 'cancelled': '#94A3B8'};
const checklistCategoryLabels = {'hr': 'HR', 'it': 'IT', 'admin': 'Admin', 'finance': 'Finance', 'manager': 'Manager', 'store': 'Store'};
const exitTypeLabels = {
  'resignation': 'Resignation', 'termination': 'Termination', 'retirement': 'Retirement',
  'absconding': 'Absconding', 'contract_end': 'Contract end', 'death': 'Death',
};

String labelOf(Map<String, String> m, Object? key) {
  final k = str(key);
  return m[k] ?? (k.isEmpty ? '—' : humanize(k));
}
// ── Small widgets ────────────────────────────────────────────────────────────

/// Coloured pill with the portal's own colour for a status.
class HrPill extends StatelessWidget {
  const HrPill(this.label, this.hex, {super.key});
  final String label;
  final String hex;

  @override
  Widget build(BuildContext context) => StatusBadge(label, color: hexColor(hex));
}

/// Pill from a label map + colour map.
Widget statusPill(Object? status, Map<String, String> labels, Map<String, String> hexes) =>
    HrPill(labelOf(labels, status), hexes[str(status)] ?? '#64748B');

/// Green "done" message (portal SuccessBanner).
class NoticeBanner extends StatelessWidget {
  const NoticeBanner(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0x1416A34A),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0x4016A34A)),
        ),
        child: Text(message, style: const TextStyle(color: Color(0xFF166534), fontSize: 14)),
      );
}

/// Amber hint box.
class WarnBanner extends StatelessWidget {
  const WarnBanner(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0x1AF59E0B),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0x4DF59E0B)),
        ),
        child: Text(message, style: const TextStyle(color: Color(0xFF92400E), fontSize: 13.5)),
      );
}

/// Padding wrapper used for banners inside lists.
Widget padded(Widget child) => Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: child);

/// Grey hint line.
class HintText extends StatelessWidget {
  const HintText(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Text(text, style: const TextStyle(fontSize: 12.5, color: Brand.muted));
}

/// Section heading between list blocks ("My requests").
class BlockTitle extends StatelessWidget {
  const BlockTitle(this.title, {super.key, this.trailing});
  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
        child: Row(
          children: [
            Expanded(
              child: Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Brand.heading)),
            ),
            ?trailing,
          ],
        ),
      );
}

/// Small number tile (portal Tile / StatCard). Tappable when [onTap] is set.
class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.sub, this.color, this.onTap, this.selected = false});
  final String label;
  final String value;
  final String? sub;
  final Color? color;
  final VoidCallback? onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Brand.heading;
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: selected ? c : Brand.border, width: selected ? 1.5 : 1),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Caps(label),
              const SizedBox(height: 4),
              Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: c)),
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

/// Two tiles per row.
class TileGrid extends StatelessWidget {
  const TileGrid(this.tiles, {super.key});
  final List<Widget> tiles;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: LayoutBuilder(
          builder: (ctx, c) {
            final w = (c.maxWidth - 8) / 2;
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [for (final t in tiles) SizedBox(width: w, child: t)],
            );
          },
        ),
      );
}

/// Horizontal row of chips (filters / count chips / inner tabs).
class ChipRow extends StatelessWidget {
  const ChipRow(this.children, {super.key});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 46,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
          children: children,
        ),
      );
}

/// Inner pill tab row (portal MyHrTabs / page tab buttons).
class SubTabs extends StatelessWidget {
  const SubTabs({super.key, required this.labels, required this.index, required this.onChanged});
  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) => ChipRow([
        for (var i = 0; i < labels.length; i++)
          CountChip(labels[i], null, selected: i == index, onTap: () => onChanged(i)),
      ]);
}

/// Primary / secondary button in a page header or card.
Widget headerButton(String label, VoidCallback? onPressed, {bool primary = true, IconData? icon}) {
  if (primary) {
    return FilledButton.icon(
      style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 14)),
      onPressed: onPressed,
      icon: Icon(icon ?? Icons.add_rounded, size: 18),
      label: Text(label, style: const TextStyle(fontSize: 14)),
    );
  }
  return OutlinedButton(
    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 14)),
    onPressed: onPressed,
    child: Text(label),
  );
}

/// Small text action under a record (portal link buttons).
class LinkAction extends StatelessWidget {
  const LinkAction(this.label, this.onTap, {super.key, this.color = Brand.primaryActive});
  final String label;
  final VoidCallback? onTap;
  final Color color;

  @override
  Widget build(BuildContext context) => TextButton(
        style: TextButton.styleFrom(
          foregroundColor: color,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          minimumSize: const Size(0, 34),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
        onPressed: onTap,
        child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
      );
}

/// Wrap of [LinkAction]s.
Widget actionRow(List<Widget> actions) =>
    actions.isEmpty ? const SizedBox.shrink() : Wrap(spacing: 4, runSpacing: 0, children: actions);

/// Previous / next month bar (portal MonthPicker).
class MonthBar extends StatelessWidget {
  const MonthBar({super.key, required this.year, required this.month, required this.onChanged});
  final int year;
  final int month;
  final void Function(int year, int month) onChanged;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: 'Previous month',
            icon: const Icon(Icons.chevron_left_rounded),
            onPressed: () => month == 1 ? onChanged(year - 1, 12) : onChanged(year, month - 1),
          ),
          Text('${monthNames[month - 1]} $year',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
          IconButton(
            tooltip: 'Next month',
            icon: const Icon(Icons.chevron_right_rounded),
            onPressed: () => month == 12 ? onChanged(year + 1, 1) : onChanged(year, month + 1),
          ),
        ],
      );
}

/// Time field ("09:30") opening the time picker.
class TimeField extends StatelessWidget {
  const TimeField({super.key, required this.label, required this.value, required this.onChanged, this.required = false});
  final String label;
  final String? value;
  final ValueChanged<String?> onChanged;
  final bool required;

  @override
  Widget build(BuildContext context) {
    final v = value ?? '';
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () async {
        final parts = v.split(':');
        final initial = parts.length >= 2
            ? TimeOfDay(hour: int.tryParse(parts[0]) ?? 9, minute: int.tryParse(parts[1]) ?? 0)
            : const TimeOfDay(hour: 9, minute: 0);
        final t = await showTimePicker(context: context, initialTime: initial);
        if (t != null) {
          onChanged('${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}');
        }
      },
      child: InputDecorator(
        isEmpty: v.isEmpty,
        decoration: fieldDecoration(label,
            required: required,
            suffix: v.isNotEmpty && !required
                ? IconButton(icon: const Icon(Icons.clear_rounded), onPressed: () => onChanged(null))
                : const Icon(Icons.schedule_rounded, size: 20)),
        child: Text(v.length >= 5 ? v.substring(0, 5) : v, style: const TextStyle(fontSize: 15)),
      ),
    );
  }
}

/// Year options around this year (portal year selects).
List<Option<int>> yearOptions({int ahead = 1, int back = 2}) {
  final y = DateTime.now().year;
  return [for (var i = y + ahead; i >= y - back; i--) Option(i, '$i')];
}

/// Opens an API file in the phone's viewer, with the server's reason on failure.
Future<void> openApiFile(BuildContext context, String path, String fileName, {Map<String, dynamic>? query}) =>
    runAction(context, () => Files.downloadAndOpen(path, fileName, query: query));

/// Opens a portal page in the browser (for the few web-only screens).
Future<void> openPortal(BuildContext context, String path) => runAction(context, () => Files.openInPortal(path));

/// "Open in portal" card for a part kept on the web.
class PortalOnlyCard extends StatelessWidget {
  const PortalOnlyCard({super.key, required this.title, required this.message, required this.path});
  final String title;
  final String message;
  final String path;

  @override
  Widget build(BuildContext context) => DetailSection(title, children: [
        Text(message, style: const TextStyle(fontSize: 13.5, color: Brand.body)),
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerLeft,
          child: headerButton('Open in portal', () => openPortal(context, path), primary: false),
        ),
      ]);
}

// ── Pickers backed by the API ────────────────────────────────────────────────

List<Json>? _directory;

/// Portal `usersApi.directory()` (active portal users) as select options.
Future<List<Option<int>>> directoryOptions(String search) async {
  _directory ??= (await Api.list('/users/directory')).rows;
  final q = search.trim().toLowerCase();
  return [
    for (final u in _directory!)
      if (q.isEmpty || str(u['name']).toLowerCase().contains(q) || str(u['department']).toLowerCase().contains(q))
        Option(asInt(u['id']) ?? 0, str(u['name']), subtitle: str(u['department']).isEmpty ? null : str(u['department'])),
  ];
}

/// Filters a fixed option list by the search text (for `loadOptions`).
List<Option<T>> filterOptions<T>(List<Option<T>> all, String search) {
  final q = search.trim().toLowerCase();
  if (q.isEmpty) return all;
  return all.where((o) => o.label.toLowerCase().contains(q) || (o.subtitle ?? '').toLowerCase().contains(q)).toList();
}
// ── Central approval engine panel (portal ApprovalPanel) ─────────────────────

const _reqLabel = {
  'pending': 'Waiting for approval', 'approved': 'Approved', 'rejected': 'Rejected',
  'returned': 'Returned for changes', 'cancelled': 'Cancelled',
};
const _reqHex = {'pending': '#F59E0B', 'approved': '#16A34A', 'rejected': '#DC2626', 'returned': '#7C3AED', 'cancelled': '#78716C'};
const _stepLabel = {
  'waiting': 'Not yet', 'pending': 'Waiting', 'approved': 'Approved', 'rejected': 'Rejected',
  'returned': 'Returned', 'skipped': 'Not needed', 'cancelled': 'Cancelled',
};
const _stepHex = {
  'waiting': '#94A3B8', 'pending': '#F59E0B', 'approved': '#16A34A', 'rejected': '#DC2626',
  'returned': '#7C3AED', 'skipped': '#94A3B8', 'cancelled': '#78716C',
};

/// Approval status + Approve / Return / Reject for one record, from
/// GET /approvals/entity/{type}/{id}. Renders nothing when there is no request.
class EngineApprovalPanel extends StatefulWidget {
  const EngineApprovalPanel({super.key, required this.entityType, required this.entityId, this.onChanged});
  final String entityType;
  final int entityId;
  final VoidCallback? onChanged;

  @override
  State<EngineApprovalPanel> createState() => _EngineApprovalPanelState();
}

class _EngineApprovalPanelState extends State<EngineApprovalPanel> {
  Json? _data;
  String? _error;
  bool _busy = false;
  bool _showHistory = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.get('/approvals/entity/${widget.entityType}/${widget.entityId}');
      if (mounted) setState(() => _data = mapOf(d));
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _decide(Json req, String decision) async {
    final needsComment = decision != 'approve' || req['can_decide'] != true;
    final comment = await promptDialog(
      context,
      title: decision == 'approve' ? 'Approve' : decision == 'reject' ? 'Reject' : 'Return for changes',
      label: 'Comment',
      required: needsComment,
      confirmLabel: decision == 'approve' ? 'Approve' : decision == 'reject' ? 'Reject' : 'Return',
    );
    if (comment == null || !mounted) return;
    setState(() => _busy = true);
    final ok = await runAction(context,
        () => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': decision, 'comment': comment}));
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      _load();
      widget.onChanged?.call();
    }
  }

  Future<void> _withdraw(Json req) async {
    final yes = await confirmDialog(context,
        title: 'Withdraw approval request?',
        message: 'The approvers will no longer see it. You can submit it again later.',
        confirmLabel: 'Withdraw');
    if (!yes || !mounted) return;
    final ok = await runAction(context, () => Api.post('/approvals/requests/${req['id']}/cancel', data: {}));
    if (ok && mounted) {
      _load();
      widget.onChanged?.call();
    }
  }

  Widget _stages(Json req) {
    final groups = <int, List<Json>>{};
    final names = <int, String>{};
    final modes = <int, String>{};
    for (final s in rowsOf(req['steps'])) {
      final seq = asInt(s['sequence']) ?? 0;
      groups.putIfAbsent(seq, () => []).add(s);
      names[seq] = str(s['stage_name']);
      modes[seq] = str(s['approval_mode']);
    }
    final keys = groups.keys.toList()..sort();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final k in keys)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
              border: Border(
                left: BorderSide(
                    color: k == asInt(req['current_sequence']) ? const Color(0xFFF59E0B) : Brand.border, width: 3),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$k. ${names[k]}${groups[k]!.length > 1 ? (modes[k] == 'all' ? ' — every one must approve' : ' — any one approves') : ''}',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.heading),
                ),
                for (final s in groups[k]!)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 2,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        statusPill(s['status'], _stepLabel, _stepHex),
                        Text(str(s['approver_name']).isEmpty ? '—' : str(s['approver_name']),
                            style: const TextStyle(fontSize: 13)),
                        if (str(s['decided_by_name']).isNotEmpty && s['decided_by_id'] != s['approver_id'])
                          Text('decided by ${s['decided_by_name']}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                        if (str(s['decided_at']).isNotEmpty)
                          Text(fmtDateTime(s['decided_at']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                        if (s['status'] == 'pending' && str(s['due_at']).isNotEmpty)
                          Text('escalates ${fmtDateTime(s['due_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                        if (str(s['comment']).isNotEmpty)
                          Text('“${s['comment']}”', style: const TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic)),
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
      return _error == null ? const SizedBox.shrink() : padded(ErrorBanner(_error!));
    }
    final req = d['current'] is Map ? mapOf(d['current']) : null;
    final history = rowsOf(d['history']);
    if (req == null && history.isEmpty) return const SizedBox.shrink();
    final canAct = req != null && req['status'] == 'pending' && (req['can_decide'] == true || req['can_stand_in'] == true);
    return DetailSection(
      'Approval',
      children: [
        if (req != null) ...[
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              statusPill(req['status'], _reqLabel, _reqHex),
              Text(
                'Submitted by ${str(req['requester_name']).isEmpty ? '—' : req['requester_name']} on ${fmtDateTime(req['submitted_at'])}'
                '${(asInt(req['revision']) ?? 1) > 1 ? ' · submission #${req['revision']}' : ''}',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _stages(req),
        ],
        if (canAct) ...[
          if (str(req['acting_for']).isNotEmpty) HintText('You are deciding on behalf of ${req['acting_for']}.'),
          if (req['can_decide'] != true)
            const HintText('You are not an approver of this stage — as an admin you can stand in; a comment is required.'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: _busy ? null : () => _decide(req, 'approve'),
                child: const Text('Approve'),
              ),
              OutlinedButton(onPressed: _busy ? null : () => _decide(req, 'return'), child: const Text('Return for changes')),
              OutlinedButton(
                style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
                onPressed: _busy ? null : () => _decide(req, 'reject'),
                child: const Text('Reject'),
              ),
            ],
          ),
        ],
        if (req != null && req['status'] == 'pending' && req['can_cancel'] == true)
          Align(
            alignment: Alignment.centerLeft,
            child: LinkAction('Withdraw approval request', _busy ? null : () => _withdraw(req)),
          ),
        if (history.isNotEmpty) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: LinkAction('${_showHistory ? 'Hide' : 'Show'} earlier submissions (${history.length})',
                () => setState(() => _showHistory = !_showHistory)),
          ),
          if (_showHistory)
            for (final h in history) ...[
              const Divider(),
              Wrap(spacing: 8, children: [
                statusPill(h['status'], _reqLabel, _reqHex),
                Text('Submission #${h['revision']} · ${fmtDateTime(h['submitted_at'])}',
                    style: const TextStyle(fontSize: 12, color: Brand.muted)),
              ]),
              const SizedBox(height: 6),
              _stages(h),
            ],
        ],
      ],
    );
  }
}

// ── Attendance calendar (portal AttendanceCalendar) ──────────────────────────

/// Legend chips with the month's counts.
class AttendanceLegend extends StatelessWidget {
  const AttendanceLegend({super.key, this.counts});
  final Json? counts;

  @override
  Widget build(BuildContext context) {
    const keys = ['present', 'half_day', 'absent', 'on_leave', 'on_duty', 'work_from_home', 'holiday', 'weekly_off', 'unmarked'];
    final c = counts;
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (final k in keys)
          HrPill('${attLabels[k]}${c != null ? ' · ${numTxt(c[k])}' : ''}', k == 'unmarked' ? '#64748B' : attHex[k]!),
        if (c != null && toNum(c['late_days']) > 0) HrPill('Late · ${numTxt(c['late_days'])}', '#DC2626'),
      ],
    );
  }
}

/// Month grid, Monday first. Days without a stored row are lighter.
class AttendanceCalendar extends StatelessWidget {
  const AttendanceCalendar({super.key, required this.year, required this.month, required this.days, this.onDayTap});
  final int year;
  final int month;
  final List<Json> days;
  final ValueChanged<Json>? onDayTap;

  @override
  Widget build(BuildContext context) {
    final offset = (DateTime(year, month, 1).weekday + 6) % 7;
    final cells = <Json?>[...List<Json?>.filled(offset, null), ...days];
    while (cells.length % 7 != 0) {
      cells.add(null);
    }
    final today = todayIso();
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          children: [
            Row(children: [
              for (final w in weekdays)
                Expanded(
                  child: Center(
                    child: Text(w, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Brand.muted)),
                  ),
                ),
            ]),
            const SizedBox(height: 4),
            for (var r = 0; r < cells.length ~/ 7; r++)
              Row(children: [
                for (var i = 0; i < 7; i++) Expanded(child: _cell(cells[r * 7 + i], today)),
              ]),
          ],
        ),
      ),
    );
  }

  Widget _cell(Json? d, String today) {
    if (d == null) return const SizedBox(height: 58);
    final status = str(d['status']);
    final c = hexColor(attHex[status] ?? '#E2E8F0');
    final computed = d['computed'] == true;
    final date = str(d['date']);
    final dayNum = date.length >= 10 ? int.tryParse(date.substring(8, 10)) ?? 0 : 0;
    final late = toNum(d['late_minutes']);
    return Padding(
      padding: const EdgeInsets.all(2),
      child: Material(
        color: status.isEmpty ? Colors.white : c.withValues(alpha: computed ? 0.08 : 0.16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(
            color: date == today ? Brand.heading : (computed ? Brand.border : c.withValues(alpha: 0.4)),
            width: date == today ? 1.5 : 1,
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onDayTap == null ? null : () => onDayTap!(d),
          child: SizedBox(
            height: 54,
            child: Padding(
              padding: const EdgeInsets.all(3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Text('$dayNum', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.heading)),
                    const Spacer(),
                    if (late > 0)
                      Text('+${numTxt(late)}',
                          style: const TextStyle(fontSize: 8.5, fontWeight: FontWeight.w700, color: Brand.danger)),
                  ]),
                  if (status.isNotEmpty)
                    Text(attShort[status] ?? status,
                        maxLines: 1,
                        overflow: TextOverflow.clip,
                        style: TextStyle(
                            fontSize: 9.5, fontWeight: FontWeight.w700, color: status == 'unmarked' ? Brand.muted : c)),
                  if (str(d['check_in_time']).isNotEmpty)
                    Text(str(d['check_in_time']), maxLines: 1, style: const TextStyle(fontSize: 8.5, color: Brand.muted)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}