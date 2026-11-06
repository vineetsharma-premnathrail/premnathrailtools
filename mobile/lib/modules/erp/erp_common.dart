import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

/// Shared bits of the Service Module (portal: components/erp/*, the SR pages).

// ── Permissions (portal: tabAccess.ts, useAuth.hasErpPermission, permissions.ts) ──

class ErpPerm {
  ErpPerm._();

  static Map<String, dynamic> get _u => Perm.user;

  /// Portal `user.role === 'admin'` (the SR edit rules use the role only).
  static bool get isRoleAdmin => _u['role'] == 'admin';

  /// Portal filterTabsByAccess / canViewTab: no `tab_access` entry for the
  /// module = every tab.
  static bool tabVisible(String key) {
    final ta = _u['tab_access'];
    if (ta is! Map) return true;
    final allowed = ta['erp'];
    if (allowed is! List) return true;
    return allowed.contains(key);
  }

  /// Legacy per-user Service grants (sr_create, sr_edit ...).
  static bool hasErp(String permission) {
    if (isRoleAdmin) return true;
    final p = _u['erp_permissions'];
    return p is List && p.contains(permission);
  }

  /// Service Requests feature (`erp:service_requests.<key>:<action>`).
  static bool feat(String key, [String action = 'view']) =>
      Perm.canFeature('erp', 'service_requests', key, action);

  /// Portal canDelete: Delete on the tab AND you created it (admins: any).
  static bool canDeleteOwn(String tab, Object? ownerId) {
    if (!Perm.can('erp', tab, 'delete')) return false;
    if (Perm.isAdmin) return true;
    return ownerId == null || ownerId == Perm.userId;
  }
}

// ── Coded lists (mirrors of the portal constants) ────────────────────────────

const srStatusLabels = <String, String>{
  'open': 'Open',
  'acknowledged': 'Acknowledged',
  'assigned': 'Assigned',
  'scheduled': 'Scheduled',
  'in_progress': 'In Progress',
  'pending_parts': 'Pending Parts',
  'on_hold': 'On Hold',
  'work_completed': 'Work Completed',
  'review': 'Review',
  'closed': 'Closed',
  'cancelled': 'Cancelled',
};

/// SR list badge colours (portal STATUS_HEX on the list page).
const srStatusHex = <String, Color>{
  'open': Color(0xFF3B82F6),
  'acknowledged': Color(0xFF8B5CF6),
  'assigned': Color(0xFFF59E0B),
  'scheduled': Color(0xFF06B6D4),
  'in_progress': Color(0xFFD97706),
  'pending_parts': Color(0xFFEF4444),
  'on_hold': Color(0xFF94A3B8),
  'work_completed': Color(0xFF10B981),
  'review': Color(0xFF6366F1),
  'closed': Color(0xFF22C55E),
  'cancelled': Color(0xFF94A3B8),
};

/// Dashboard chart colours (portal STATUS_COLORS on the Dashboard).
const dashStatusHex = <String, Color>{
  'open': Color(0xFFEA580C),
  'acknowledged': Color(0xFFF59E0B),
  'assigned': Color(0xFF3B82F6),
  'scheduled': Color(0xFF6366F1),
  'in_progress': Color(0xFF2563EB),
  'pending_parts': Color(0xFFEAB308),
  'on_hold': Color(0xFFA8A29E),
  'work_completed': Color(0xFF22C55E),
  'review': Color(0xFF14B8A6),
  'closed': Color(0xFF78716C),
  'cancelled': Color(0xFF78716C),
};

const priorityHex = <String, Color>{'urgent': Color(0xFFDC2626), 'standard': Color(0xFF2563EB)};

/// SR workflow steps in order (portal WORKFLOW_STEPS); Cancelled is a side exit.
const workflowSteps = <(String, String)>[
  ('open', 'Reported'),
  ('acknowledged', 'Acknowledged'),
  ('assigned', 'Assigned'),
  ('scheduled', 'Scheduled'),
  ('in_progress', 'In Progress'),
  ('pending_parts', 'Pending Parts'),
  ('on_hold', 'On Hold'),
  ('work_completed', 'Work Completed'),
  ('review', 'Review'),
  ('closed', 'Closed'),
];

String stepLabel(String key) {
  if (key == 'cancelled') return 'Cancelled';
  for (final (k, l) in workflowSteps) {
    if (k == key) return l;
  }
  return key;
}

/// Service types (portal components/erp/serviceTypes.ts).
const serviceTypes = <(String, String)>[
  ('installation_commissioning', 'Installation & Commissioning'),
  ('warranty', 'Warranty'),
  ('amc', 'AMC'),
  ('repair_breakdown', 'Repair / Breakdown'),
  ('inspection_maintenance', 'Inspection / Maintenance'),
  ('paid_service', 'Paid Service'),
];

String serviceTypeLabel(Object? v) {
  if (v == null || v == '') return 'Not set';
  for (final (k, l) in serviceTypes) {
    if (k == v) return l;
  }
  return v.toString();
}

const priorityOptions = <Option<String>>[Option('standard', 'Standard'), Option('urgent', 'Urgent')];

String priorityLabel(Object? v) => v == 'urgent' ? 'Urgent' : 'Standard';

const warrantyLabels = <String, String>{
  'in_warranty': 'In warranty',
  'extended_warranty': 'Extended warranty',
  'amc': 'Under AMC',
  'out_of_warranty': 'Out of warranty',
  'unknown': 'Unknown (machine has no commissioning / handover date)',
};

/// "Same day" / "3 days".
String dayText(int n) => n == 0 ? 'Same day' : '$n day${n == 1 ? '' : 's'}';

/// Whole days from [start] to [end] (or now).
int? daysBetween(Object? start, [Object? end]) {
  final s = parseDate(start);
  if (s == null) return null;
  final e = parseDate(end) ?? DateTime.now();
  final d = e.difference(s).inDays;
  return d < 0 ? 0 : d;
}

num numOf(Object? v) => v is num ? v : (v is String ? num.tryParse(v) ?? 0 : 0);

String qtyText(Object? v) {
  final n = numOf(v);
  return n == n.roundToDouble() ? n.toInt().toString() : n.toString();
}

/// Machine label "SERIAL — Model".
String machineLabel(Json? p) {
  if (p == null) return '—';
  final model = txt(p['model_name']);
  return model == '—' ? txt(p['serial_number']) : '${txt(p['serial_number'])} — $model';
}

// ── Small widgets ────────────────────────────────────────────────────────────

/// Coloured pill like the portal's pillStyle(hex).
class HexPill extends StatelessWidget {
  const HexPill(this.text, this.color, {super.key, this.solid = false});
  final String text;
  final Color color;
  final bool solid;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
            color: solid ? color : color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
        child: Text(text,
            style: TextStyle(color: solid ? Colors.white : color, fontSize: 11.5, fontWeight: FontWeight.w600)),
      );
}

/// SR status pill in the list colours.
class SrStatusPill extends StatelessWidget {
  const SrStatusPill(this.status, {super.key});
  final Object? status;

  @override
  Widget build(BuildContext context) {
    final s = (status ?? '').toString();
    return HexPill(srStatusLabels[s] ?? humanize(s), srStatusHex[s] ?? Brand.muted);
  }
}

/// "Upcoming" pill (features built but not live yet).
class UpcomingPill extends StatelessWidget {
  const UpcomingPill({super.key});

  @override
  Widget build(BuildContext context) => const HexPill('Upcoming', Brand.primary);
}

/// Small outlined button used inside cards.
class SmallButton extends StatelessWidget {
  const SmallButton(this.label, {super.key, this.onPressed, this.icon, this.danger = false, this.primary = false});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool danger;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final fg = danger ? Brand.danger : (primary ? Colors.white : Brand.body);
    final style = primary
        ? FilledButton.styleFrom(
            minimumSize: const Size(0, 36),
            padding: const EdgeInsets.symmetric(horizontal: 14),
            textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))
        : null;
    if (primary) {
      return FilledButton.icon(
        style: style,
        onPressed: onPressed,
        icon: Icon(icon ?? Icons.check_rounded, size: 16),
        label: Text(label),
      );
    }
    return OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        foregroundColor: fg,
        minimumSize: const Size(0, 36),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        side: BorderSide(color: danger ? Brand.danger.withValues(alpha: 0.4) : Brand.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      ),
      onPressed: onPressed,
      icon: icon == null ? const SizedBox.shrink() : Icon(icon, size: 16),
      label: Text(label),
    );
  }
}

/// Horizontal bar list - phone version of the portal's BarChart / PieChart.
/// Tapping a row filters (toggle), like the portal charts.
class BarList extends StatelessWidget {
  const BarList({super.key, required this.rows, this.onTap, this.isActive, this.colorFor, this.labelFor});
  final List<(String, num)> rows;
  final ValueChanged<String>? onTap;
  final bool Function(String key)? isActive;
  final Color Function(String key)? colorFor;
  final String Function(String key)? labelFor;

  @override
  Widget build(BuildContext context) {
    final max = rows.fold<num>(0, (m, r) => r.$2 > m ? r.$2 : m);
    return Column(
      children: [
        for (final (key, value) in rows)
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: onTap == null ? null : () => onTap!(key),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 4),
              decoration: BoxDecoration(
                color: (isActive?.call(key) ?? false) ? Brand.primarySoft : null,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  SizedBox(
                    width: 112,
                    child: Text(labelFor?.call(key) ?? humanize(key),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12.5, color: Brand.body)),
                  ),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: max == 0 ? 0 : value / max,
                        minHeight: 12,
                        backgroundColor: Brand.background,
                        color: colorFor?.call(key) ?? Brand.primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 40,
                    child: Text(fmtNumber(value),
                        textAlign: TextAlign.right,
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading)),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Date + time field (the portal's datetime-local input).
class DateTimeField extends StatelessWidget {
  const DateTimeField({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final DateTime? value;
  final ValueChanged<DateTime?> onChanged;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () async {
        final now = DateTime.now();
        final d = await showDatePicker(
          context: context,
          initialDate: value ?? now,
          firstDate: DateTime(now.year - 5),
          lastDate: DateTime(now.year + 5),
        );
        if (d == null || !context.mounted) return;
        final t = await showTimePicker(
            context: context, initialTime: TimeOfDay.fromDateTime(value ?? now));
        if (t == null) return;
        onChanged(DateTime(d.year, d.month, d.day, t.hour, t.minute));
      },
      child: InputDecorator(
        isEmpty: value == null,
        decoration: fieldDecoration(label,
            suffix: value != null
                ? IconButton(icon: const Icon(Icons.clear_rounded), onPressed: () => onChanged(null))
                : const Icon(Icons.schedule_rounded, size: 20)),
        child: Text(value == null ? '' : fmtDateTime(value), style: const TextStyle(fontSize: 15)),
      ),
    );
  }
}

/// Two-choice segmented picker (the SR form's priority cards).
class ChoiceRow<T> extends StatelessWidget {
  const ChoiceRow({super.key, required this.label, required this.options, required this.value, required this.onChanged,
      this.required = false, this.colors = const {}});
  final String label;
  final List<Option<T>> options;
  final T? value;
  final ValueChanged<T> onChanged;
  final bool required;
  final Map<T, Color> colors;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(required ? '$label *' : label, style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        const SizedBox(height: 6),
        Row(
          children: [
            for (final o in options)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Material(
                    color: o.value == value ? (colors[o.value] ?? Brand.primary).withValues(alpha: 0.1) : Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                      side: BorderSide(color: o.value == value ? (colors[o.value] ?? Brand.primary) : Brand.border),
                    ),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () => onChanged(o.value),
                      child: SizedBox(
                        height: 44,
                        child: Center(
                          child: Text(o.label,
                              style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: o.value == value ? (colors[o.value] ?? Brand.primary) : Brand.body)),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// Picked files waiting to be uploaded, with remove buttons.
class StagedFiles extends StatelessWidget {
  const StagedFiles({super.key, required this.files, required this.onRemove});
  final List<MultipartFile> files;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    if (files.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (var i = 0; i < files.length; i++)
          InputChip(
            label: Text(files[i].filename ?? 'file', overflow: TextOverflow.ellipsis),
            onDeleted: () => onRemove(i),
          ),
      ],
    );
  }
}

/// Camera / gallery / file buttons that add to a staged list.
class PickButtons extends StatelessWidget {
  const PickButtons({super.key, required this.onPicked, this.photosOnly = false, this.enabled = true});
  final ValueChanged<List<MultipartFile>> onPicked;
  final bool photosOnly;
  final bool enabled;

  Future<void> _run(BuildContext context, Future<List<MultipartFile>> Function() pick) async {
    try {
      final f = await pick();
      if (f.isNotEmpty) onPicked(f);
    } catch (e) {
      if (context.mounted) showSnack(context, 'Could not read the file: ${ApiClient.describe(e)}', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        SmallButton('Take photo',
            icon: Icons.photo_camera_outlined,
            onPressed: !enabled
                ? null
                : () => _run(context, () async {
                      final f = await Files.takePhoto();
                      return f == null ? <MultipartFile>[] : [f];
                    })),
        SmallButton('Gallery',
            icon: Icons.photo_library_outlined,
            onPressed: !enabled
                ? null
                : () => _run(context, () async {
                      final f = await Files.pickPhoto();
                      return f == null ? <MultipartFile>[] : [f];
                    })),
        if (!photosOnly)
          SmallButton('Files', icon: Icons.attach_file_rounded, onPressed: !enabled ? null : () => _run(context, Files.pickFiles)),
      ],
    );
  }
}

/// Multipart upload (files under `files`) with the long upload timeout the
/// portal uses (SharePoint uploads take time).
Future<dynamic> uploadFiles(String path, List<MultipartFile> files, {Map<String, dynamic> fields = const {}}) async {
  final form = FormData();
  for (final f in files) {
    form.files.add(MapEntry('files', f));
  }
  fields.forEach((k, v) => form.fields.add(MapEntry(k, '$v')));
  final r = await Api.dio.post(path,
      data: form,
      options: Options(
          contentType: 'multipart/form-data',
          sendTimeout: const Duration(minutes: 2),
          receiveTimeout: const Duration(minutes: 2)));
  return r.data;
}

/// Opens an API file in the phone viewer with a snack on failure.
Future<void> openApiFile(BuildContext context, String path, String name) async {
  showSnack(context, 'Opening $name…');
  try {
    await Files.downloadAndOpen(path, name);
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
  }
}

// ── Central approval engine (portal: shared/ApprovalPanel.tsx) ──────────────

const _reqLabel = {
  'pending': 'Waiting for approval',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned for changes',
  'cancelled': 'Cancelled',
};
const _reqHex = {
  'pending': Color(0xFFF59E0B),
  'approved': Color(0xFF16A34A),
  'rejected': Color(0xFFDC2626),
  'returned': Color(0xFF7C3AED),
  'cancelled': Color(0xFF78716C),
};
const _stepLabel = {
  'waiting': 'Not yet',
  'pending': 'Waiting',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned',
  'skipped': 'Not needed',
  'cancelled': 'Cancelled',
};
const _viaLabel = {'delegation': 'as delegate', 'escalation': 'after escalation', 'admin': 'admin stand-in'};

/// Approval status + Approve / Return / Reject for one record. Renders
/// nothing when the record never went for approval.
class ApprovalPanel extends StatefulWidget {
  const ApprovalPanel(
      {super.key, required this.entityType, required this.entityId, this.onChanged, this.title = 'Approval'});
  final String entityType;
  final int entityId;
  final VoidCallback? onChanged;
  final String title;

  @override
  State<ApprovalPanel> createState() => _ApprovalPanelState();
}

class _ApprovalPanelState extends State<ApprovalPanel> {
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
      if (mounted) setState(() => _data = d is Map ? Map<String, dynamic>.from(d) : null);
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
    final steps = (req['steps'] as List? ?? const []).whereType<Map>().toList();
    final groups = <int, List<Map>>{};
    for (final s in steps) {
      groups.putIfAbsent((s['sequence'] as num?)?.toInt() ?? 0, () => []).add(s);
    }
    final seqs = groups.keys.toList()..sort();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final seq in seqs)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
              border: Border(
                  left: BorderSide(
                      width: 3,
                      color: seq == req['current_sequence'] ? const Color(0xFFF59E0B) : Brand.border)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                    '$seq. ${groups[seq]!.first['stage_name'] ?? ''}'
                    '${groups[seq]!.length > 1 ? (groups[seq]!.first['approval_mode'] == 'all' ? ' — every one must approve' : ' — any one approves') : ''}',
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading)),
                const SizedBox(height: 4),
                for (final s in groups[seq]!)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 2,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        StatusBadge(_stepLabel[s['status']] ?? s['status']),
                        Text(txt(s['approver_name']), style: const TextStyle(fontSize: 12.5)),
                        if (s['decided_by_name'] != null && s['decided_by_id'] != s['approver_id'])
                          Text(
                              'decided by ${s['decided_by_name']}${_viaLabel[s['via']] != null ? ' (${_viaLabel[s['via']]})' : ''}',
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
    final history = (d?['history'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    final req = d?['current'] is Map ? Map<String, dynamic>.from(d!['current'] as Map) : null;
    if (d == null || (req == null && history.isEmpty)) {
      return _error == null
          ? const SizedBox.shrink()
          : DetailSection(widget.title, children: [ErrorBanner(_error!)]);
    }
    final canAct = req != null && req['status'] == 'pending' && (req['can_decide'] == true || req['can_stand_in'] == true);
    return DetailSection(widget.title, children: [
      if (req != null) ...[
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            HexPill(_reqLabel[req['status']] ?? humanize(req['status']), _reqHex[req['status']] ?? Brand.muted),
            Text(
                'Submitted by ${txt(req['requester_name'])} on ${fmtDateTime(req['submitted_at'])}'
                '${numOf(req['revision']) > 1 ? ' · submission #${req['revision']}' : ''}',
                style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          ],
        ),
        const SizedBox(height: 10),
        _stages(req),
      ],
      if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 8)],
      if (canAct) ...[
        if (req['acting_for'] != null)
          Text('You are deciding on behalf of ${req['acting_for']}.',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        if (req['can_decide'] != true && req['can_stand_in'] == true)
          const Text('You are not an approver of this stage — as an admin you can stand in; a comment is required.',
              style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        const SizedBox(height: 6),
        TextField(
          controller: _comment,
          maxLines: 3,
          minLines: 2,
          decoration: fieldDecoration('Comment', hint: 'Comment (required to reject or return)'),
        ),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          SmallButton('Approve',
              primary: true,
              onPressed: _busy
                  ? null
                  : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide',
                      data: {'decision': 'approve', 'comment': _comment.text}))),
          SmallButton('Return for changes',
              onPressed: _busy
                  ? null
                  : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide',
                      data: {'decision': 'return', 'comment': _comment.text}))),
          SmallButton('Reject',
              danger: true,
              onPressed: _busy
                  ? null
                  : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide',
                      data: {'decision': 'reject', 'comment': _comment.text}))),
        ]),
      ],
      if (req != null && req['status'] == 'pending' && req['can_cancel'] == true) ...[
        const SizedBox(height: 10),
        SmallButton('Withdraw approval request',
            onPressed: _busy
                ? null
                : () async {
                    final ok = await confirmDialog(context,
                        title: 'Withdraw approval request?',
                        message: 'The approvers will no longer see it. You can submit it again later.',
                        confirmLabel: 'Withdraw');
                    if (ok) _act(() => Api.post('/approvals/requests/${req['id']}/cancel', data: {}));
                  }),
      ],
      if (history.isNotEmpty) ...[
        const SizedBox(height: 8),
        InkWell(
          onTap: () => setState(() => _history = !_history),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Text('${_history ? 'Hide' : 'Show'} earlier submissions (${history.length})',
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Brand.primaryActive)),
          ),
        ),
        if (_history)
          for (final h in history) ...[
            const Divider(),
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              HexPill(_reqLabel[h['status']] ?? humanize(h['status']), _reqHex[h['status']] ?? Brand.muted),
              Text('Submission #${h['revision']} · ${fmtDateTime(h['submitted_at'])}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
            const SizedBox(height: 6),
            _stages(h),
          ],
      ],
    ]);
  }
}
