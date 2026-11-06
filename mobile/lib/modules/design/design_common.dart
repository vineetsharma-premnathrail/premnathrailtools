import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

/// Shared bits of the Design module (only used inside this folder).
/// Mirrors frontend/src/components/design/designMeta.ts, useDesignMe.ts,
/// useDesignFeature.ts.

// ── Access ───────────────────────────────────────────────────────────────────

/// Portal filterTabsByAccess('design', ...): the server's tab_access list
/// when the user has one, otherwise every tab.
bool designTabVisible(String subtabKey) {
  if (Perm.isAdmin) return true;
  final ta = Perm.user['tab_access'];
  if (ta is Map && ta['design'] is List) {
    return (ta['design'] as List).contains(subtabKey);
  }
  return true;
}

/// useDesignFeature(): the feature gate only applies to users who hold the
/// tab's View (a voter / acknowledger reaching a record keeps access).
bool designFeature(String tab, String feature, [String action = 'view']) =>
    !Perm.can('design', tab, 'view') || Perm.canFeature('design', tab, feature, action);

/// can('design', tab, action).
bool designCan(String tab, String action) => Perm.can('design', tab, action);

/// The caller's Design role (GET /design/settings/me) - cached per app run.
class DesignMe {
  DesignMe._();
  static Future<Json>? _future;

  static Future<Json> load({bool refresh = false}) {
    if (refresh || _future == null) {
      _future = Api.get('/design/settings/me').then((d) => jsonMap(d)).catchError((Object _) {
        _future = null;
        return <String, dynamic>{};
      });
    }
    return _future!;
  }

  static bool isTeam(Json me) => me['is_team'] == true;
  static bool isHead(Json me) => me['is_head'] == true;
  static String role(Json me) => str(me['role']);
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

int? asInt(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));

num? asNum(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);

String str(Object? v) => v == null ? '' : v.toString();

List<Json> jsonList(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];

Json jsonMap(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

List<String> strList(Object? v) => v is List ? v.map((e) => e.toString()).toList() : <String>[];

/// Label from a map, falling back to humanize().
String labelOf(Map<String, String> labels, Object? v) => labels[str(v)] ?? humanize(v);

/// Options from a label map (keeps the map's order).
List<Option<String>> optionsOf(Map<String, String> labels) =>
    [for (final e in labels.entries) Option<String>(e.key, e.value)];

/// Date for the API ("2026-11-05") or null.
String? apiDateOrNull(DateTime? d) => d == null ? null : apiDate(d);

/// Empty text -> null (PATCH payloads).
String? nullIfEmpty(String? s) => (s == null || s.trim().isEmpty) ? null : s.trim();

// ── Labels (designMeta.ts) ───────────────────────────────────────────────────

const docTypeLabels = <String, String>{
  'ga_drawing': 'GA Drawing',
  'part_drawing': 'Part Drawing',
  'assembly_drawing': 'Assembly Drawing',
  'schematic': 'Schematic',
  'specification': 'Specification',
  'calculation': 'Calculation',
  'datasheet': 'Datasheet',
  'procedure': 'Procedure',
  'manual': 'Manual',
  'bom': 'BOM',
  'wiring_diagram': 'Wiring Diagram',
  'harness_drawing': 'Harness Drawing',
  'hydraulic_circuit': 'Hydraulic Circuit',
  'pneumatic_circuit': 'Pneumatic Circuit',
  'panel_layout': 'Panel Layout',
  'other': 'Other',
};

const disciplineLabels = <String, String>{
  'mechanical': 'Mechanical',
  'electrical': 'Electrical',
  'hydraulic': 'Hydraulic',
  'pneumatic': 'Pneumatic',
  'structural': 'Structural',
  'civil': 'Civil',
  'instrumentation': 'Instrumentation',
  'general': 'General',
};

const fileRoleLabels = <String, String>{
  'primary': 'Controlled print (PDF)',
  'native': 'Native / CAD source',
  'supporting': 'Supporting',
};

const ecnReasonLabels = <String, String>{
  'design_improvement': 'Design improvement',
  'customer_request': 'Customer request',
  'manufacturing_issue': 'Manufacturing issue',
  'quality_issue': 'Quality issue',
  'cost_reduction': 'Cost reduction',
  'safety': 'Safety',
  'regulatory': 'Regulatory',
  'other': 'Other',
};

const priorityLabels = <String, String>{'standard': 'Standard', 'urgent': 'Urgent'};

/// lib/priority.ts priorityLabel(): legacy high/critical count as Urgent.
String priorityLabel(Object? v) =>
    const {'urgent', 'critical', 'high'}.contains(str(v).trim().toLowerCase()) ? 'Urgent' : 'Standard';

const bomStatusLabels = <String, String>{
  'draft': 'Draft',
  'in_review': 'In check',
  'in_approval': 'Awaiting release',
  'released': 'Released',
  'revising': 'Released · revising',
  'superseded': 'Superseded',
  'obsolete': 'Obsolete',
};

const requestSourceLabels = <String, String>{
  'bd': 'BD / CRM',
  'project': 'Project',
  'rnd': 'R&D hand-over',
  'internal': 'Internal',
};

const requestStatusLabels = <String, String>{
  'open': 'Open',
  'accepted': 'Accepted',
  'in_progress': 'In progress',
  'on_hold': 'On hold',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
};

const submissionStatusLabels = <String, String>{
  'draft': 'Draft',
  'sent': 'With customer',
  'closed': 'Closed',
  'cancelled': 'Cancelled',
};

const customerResponseLabels = <String, String>{
  'pending': 'Pending',
  'approved': 'Approved',
  'approved_with_comments': 'Approved with comments',
  'rejected': 'Rejected',
};

const ecrSourceLabels = <String, String>{
  'ncr': 'NCR',
  'capa': 'CAPA',
  'customer': 'Customer',
  'production': 'Production',
  'purchase': 'Purchase (material)',
  'quality': 'Quality',
  'service': 'Service / field failure',
  'design': 'Design',
  'other': 'Other',
};

const ecrUrgencyLabels = <String, String>{'low': 'Low', 'normal': 'Normal', 'high': 'High', 'critical': 'Critical'};

const ecrStatusLabels = <String, String>{
  'open': 'Open (impact check)',
  'impact_checked': 'With change board',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'deferred': 'Deferred',
  'withdrawn': 'Withdrawn',
};

const ecnStatusLabels = <String, String>{
  'draft': 'Draft',
  'submitted': 'Awaiting approval',
  'approved': 'Open',
  'implemented': 'Released',
  'closed': 'Closed',
  'rejected': 'Rejected',
  'cancelled': 'Cancelled',
};

const ecnEffectivityLabels = <String, String>{
  'immediate': 'Immediately',
  'date': 'From a date',
  'serial': 'From a serial number',
  'next_order': 'From the next production order',
  'project': 'For a specific project',
};

const dispositionLabels = <String, String>{
  'use_up': 'Use up',
  'rework': 'Rework',
  'scrap': 'Scrap',
  'not_applicable': 'Not applicable',
};

const ackDepartmentLabels = <String, String>{
  'production': 'Production',
  'purchase': 'Purchase',
  'store': 'Store',
  'quality': 'Quality',
  'project': 'Project management',
};

const standardBodies = ['RDSO', 'IS', 'EN', 'ISO', 'IEC', 'UIC', 'DIN', 'ASME', 'customer', 'internal', 'other'];

const templateKindLabels = <String, String>{
  'title_block': 'Title block',
  'drawing_sheet': 'Drawing sheet',
  'bom_sheet': 'BOM sheet',
  'specification': 'Specification',
  'transmittal': 'Transmittal cover note',
  'ecn_notice': 'ECN notice',
  'other': 'Other',
};

const teamRoleLabels = <String, String>{
  'head': 'Design head',
  'reviewer': 'Reviewer (senior designer)',
  'designer': 'Designer',
  'viewer': 'Viewer (other department)',
  'admin': 'Admin',
};

/// Drawing revision status words used on the portal's badges.
const revisionStatusLabels = <String, String>{
  'draft': 'Draft',
  'in_review': 'In check',
  'in_approval': 'In approval',
  'awaiting_customer': 'Awaiting customer',
  'approved': 'Approved',
  'released': 'Released',
  'superseded': 'Superseded',
  'obsolete': 'Obsolete',
  'returned': 'Returned',
};

/// Accept list for revision files (backend allowlist in app/utils/sharepoint.py).
const designFileExtensions = [
  'pdf', 'dwg', 'dxf', 'step', 'stp', 'iges', 'igs', 'stl', 'sldprt', 'sldasm', 'slddrw', 'ipt', 'iam', 'idw',
  'x_t', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg',
];

String formatBytes(Object? size) {
  final s = asNum(size);
  if (s == null) return '—';
  if (s < 1024) return '$s B';
  if (s < 1024 * 1024) return '${(s / 1024).toStringAsFixed(0)} KB';
  return '${(s / (1024 * 1024)).toStringAsFixed(1)} MB';
}

// ── Lookups (/design/lookups/*) ──────────────────────────────────────────────

/// DesignLookupOption rows ({id, label, code, extra}) as select options,
/// filtered locally by the search text.
Future<List<Option<int>>> designLookup(String path, String search, {Map<String, dynamic>? query, bool sendSearch = false}) async {
  final q = <String, dynamic>{...?query};
  if (sendSearch && search.isNotEmpty) q['search'] = search;
  final rows = (await Api.list('/design/lookups/$path', query: q)).rows;
  final s = search.toLowerCase();
  return [
    for (final r in rows)
      if (asInt(r['id']) != null &&
          (sendSearch || s.isEmpty || '${r['label']} ${r['code'] ?? ''} ${r['extra'] ?? ''}'.toLowerCase().contains(s)))
        Option<int>(asInt(r['id'])!, str(r['label']), subtitle: nullIfEmpty(str(r['extra']))),
  ];
}

// ── Files ────────────────────────────────────────────────────────────────────

/// Opens a drawing revision file in the phone's viewer.
Future<void> openDesignFile(BuildContext context, Object? fileId, String fileName) async {
  await runAction(context, () => Files.downloadAndOpen('/design/revisions/files/$fileId/content', fileName));
}

/// Opens any Design API file (letters, standards, templates).
Future<void> openApiFile(BuildContext context, String path, String fileName, {Map<String, dynamic>? query}) async {
  await runAction(context, () => Files.downloadAndOpen(path, fileName, query: query));
}

/// Multipart helper.
FormData formData(Map<String, dynamic> fields) => FormData.fromMap(fields);

// ── Action bar (bottom of detail screens) ────────────────────────────────────

class DAction {
  const DAction(this.label, this.onTap, {this.primary = false, this.danger = false});
  final String label;
  final VoidCallback onTap;
  final bool primary;
  final bool danger;
}

/// Sticky bottom bar of a detail screen: the first primary action(s) as
/// buttons, the rest under "More". Returns null when there is nothing to do.
Widget? actionBar(BuildContext context, List<DAction> actions, {bool busy = false}) {
  if (actions.isEmpty) return null;
  final primary = actions.where((a) => a.primary).take(2).toList();
  final main = primary.isNotEmpty ? primary : [actions.first];
  final rest = actions.where((a) => !main.contains(a)).toList();
  Widget button(DAction a) {
    if (a.primary) {
      return FilledButton(
        style: FilledButton.styleFrom(minimumSize: const Size(0, 44), padding: const EdgeInsets.symmetric(horizontal: 12)),
        onPressed: busy ? null : a.onTap,
        child: Text(a.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14)),
      );
    }
    return OutlinedButton(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 44),
        foregroundColor: a.danger ? Brand.danger : Brand.body,
        side: BorderSide(color: a.danger ? Brand.danger.withValues(alpha: 0.4) : Brand.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      onPressed: busy ? null : a.onTap,
      child: Text(a.label, maxLines: 1, overflow: TextOverflow.ellipsis),
    );
  }

  return Row(
    children: [
      for (final a in main) ...[Expanded(child: button(a)), const SizedBox(width: 8)],
      if (rest.isNotEmpty)
        PopupMenuButton<int>(
          enabled: !busy,
          tooltip: 'More actions',
          onSelected: (i) => rest[i].onTap(),
          itemBuilder: (_) => [
            for (var i = 0; i < rest.length; i++)
              PopupMenuItem<int>(
                value: i,
                child: Text(rest[i].label, style: TextStyle(color: rest[i].danger ? Brand.danger : Brand.body)),
              ),
          ],
          child: Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(border: Border.all(color: Brand.border), borderRadius: BorderRadius.circular(12)),
            child: const Row(mainAxisSize: MainAxisSize.min, children: [
              Text('More', style: TextStyle(fontWeight: FontWeight.w600, color: Brand.body)),
              Icon(Icons.expand_more_rounded, size: 18),
            ]),
          ),
        ),
    ],
  );
}

// ── Shared sections ──────────────────────────────────────────────────────────

/// Timeline / history card (DesignEvent rows: action, comment, actor_name,
/// revision_label, created_at).
class DesignTimeline extends StatelessWidget {
  const DesignTimeline(this.events, {super.key, this.title = 'Timeline'});
  final List<Json> events;
  final String title;

  @override
  Widget build(BuildContext context) {
    return DetailSection(title, children: [
      if (events.isEmpty) const Text('No activity yet.', style: TextStyle(color: Brand.muted)),
      for (final e in events)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 5, right: 10),
                child: Icon(Icons.circle, size: 8, color: Brand.primary),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      [humanize(e['action']), if (str(e['revision_label']).isNotEmpty) str(e['revision_label'])].join(' · '),
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading, fontSize: 13.5),
                    ),
                    if (str(e['comment']).isNotEmpty)
                      Text(str(e['comment']), style: const TextStyle(fontSize: 13, color: Brand.body)),
                    Text('${txt(e['actor_name'])} · ${fmtDateTime(e['created_at'])}',
                        style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                  ],
                ),
              ),
            ],
          ),
        ),
    ]);
  }
}

/// Comments card with an "Add comment" button (comment rows: comment,
/// author_name / actor_name, created_at).
class DesignComments extends StatelessWidget {
  const DesignComments(this.comments, {super.key, this.onAdd, this.title = 'Comments'});
  final List<Json> comments;
  final Future<void> Function(String text)? onAdd;
  final String title;

  @override
  Widget build(BuildContext context) {
    return DetailSection(
      title,
      action: onAdd == null
          ? null
          : TextButton.icon(
              icon: const Icon(Icons.add_comment_outlined, size: 18),
              label: const Text('Add comment'),
              onPressed: () async {
                final t = await promptDialog(context, title: 'Add comment', label: 'Comment', confirmLabel: 'Post');
                if (t == null || t.isEmpty) return;
                await onAdd!(t);
              },
            ),
      children: [
        if (comments.isEmpty) const Text('No comments yet.', style: TextStyle(color: Brand.muted)),
        for (final c in comments)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${txt(c['author_name'] ?? c['actor_name'] ?? c['created_by_name'])} · ${fmtDateTime(c['created_at'])}',
                  style: const TextStyle(fontSize: 11.5, color: Brand.muted),
                ),
                Text(str(c['comment']), style: const TextStyle(fontSize: 14, color: Brand.body)),
              ],
            ),
          ),
      ],
    );
  }
}

/// Horizontal row of clickable count chips (memory: clickable counts).
class ChipRow extends StatelessWidget {
  const ChipRow({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 48,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
          children: children,
        ),
      );
}

/// Small stat card used on dashboards and report summaries.
class StatTile extends StatelessWidget {
  const StatTile(this.label, this.value, {super.key, this.color, this.onTap, this.hint});
  final String label;
  final Object? value;
  final Color? color;
  final String? hint;
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
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, maxLines: 2, style: const TextStyle(fontSize: 12, color: Brand.muted)),
              const SizedBox(height: 4),
              Text(txt(value),
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: color ?? Brand.heading)),
              if (hint != null) Text(hint!, style: const TextStyle(fontSize: 11, color: Brand.muted)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Two-column grid of [StatTile]s.
class StatGrid extends StatelessWidget {
  const StatGrid(this.tiles, {super.key});
  final List<Widget> tiles;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: LayoutBuilder(builder: (ctx, c) {
        final w = (c.maxWidth - 10) / 2;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [for (final t in tiles) SizedBox(width: w, child: t)],
        );
      }),
    );
  }
}

/// Info / hint strip (portal's grey help boxes).
class InfoNote extends StatelessWidget {
  const InfoNote(this.text, {super.key, this.color});
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? const Color(0xFF2563EB);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: c.withValues(alpha: 0.25)),
      ),
      child: Text(text, style: TextStyle(color: c, fontSize: 13)),
    );
  }
}

// ── Central approval engine (portal components/shared/ApprovalPanel.tsx) ─────

const _reqLabel = {
  'pending': 'Waiting for approval',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned for changes',
  'cancelled': 'Cancelled',
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

/// Approval status + Approve / Return for changes / Reject for one record
/// (GET /approvals/entity/{type}/{id}). Hidden when there is no request.
class DesignApprovalPanel extends StatefulWidget {
  const DesignApprovalPanel({super.key, required this.entityType, required this.entityId, this.title = 'Approval', this.onChanged});
  final String entityType;
  final int entityId;
  final String title;
  final VoidCallback? onChanged;

  @override
  State<DesignApprovalPanel> createState() => _DesignApprovalPanelState();
}

class _DesignApprovalPanelState extends State<DesignApprovalPanel> {
  Json? _data;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = jsonMap(await Api.get('/approvals/entity/${widget.entityType}/${widget.entityId}'));
      if (mounted) setState(() => _data = d);
    } catch (_) {
      if (mounted) setState(() => _data = const {});
    }
  }

  Future<void> _decide(int requestId, String decision) async {
    final needs = decision != 'approve';
    final comment = await promptDialog(context,
        title: decision == 'approve' ? 'Approve' : (decision == 'return' ? 'Return for changes' : 'Reject'),
        label: 'Comment',
        required: needs,
        confirmLabel: decision == 'approve' ? 'Approve' : (decision == 'return' ? 'Return' : 'Reject'));
    if (comment == null || !mounted) return;
    setState(() => _busy = true);
    final ok = await runAction(context,
        () => Api.post('/approvals/requests/$requestId/decide', data: {'decision': decision, 'comment': comment}),
        success: 'Decision saved.');
    if (mounted) setState(() => _busy = false);
    if (ok) {
      _load();
      widget.onChanged?.call();
    }
  }

  Future<void> _cancel(int requestId) async {
    final ok = await confirmDialog(context,
        title: 'Withdraw approval request?',
        message: 'The approvers will no longer see it. You can submit it again later.',
        confirmLabel: 'Withdraw');
    if (!ok || !mounted) return;
    if (await runAction(context, () => Api.post('/approvals/requests/$requestId/cancel', data: {}), success: 'Approval request withdrawn.')) {
      _load();
      widget.onChanged?.call();
    }
  }

  @override
  Widget build(BuildContext context) {
    final req = _data == null ? null : (_data!['current'] is Map ? jsonMap(_data!['current']) : null);
    if (req == null) return const SizedBox.shrink();
    final id = asInt(req['id'])!;
    final pending = str(req['status']) == 'pending';
    final canAct = pending && (req['can_decide'] == true || req['can_stand_in'] == true);
    final steps = jsonList(req['steps']);
    return DetailSection(widget.title, children: [
      Row(children: [
        StatusBadge(_reqLabel[str(req['status'])] ?? humanize(req['status'])),
        const SizedBox(width: 8),
        Expanded(
          child: Text('Submitted by ${txt(req['requester_name'])} on ${fmtDateTime(req['submitted_at'])}',
              style: const TextStyle(fontSize: 12, color: Brand.muted)),
        ),
      ]),
      const SizedBox(height: 8),
      for (final s in steps)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            StatusBadge(_stepLabel[str(s['status'])] ?? humanize(s['status'])),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                [
                  '${s['sequence'] ?? ''}. ${str(s['stage_name'])}',
                  txt(s['approver_name']),
                  if (s['decided_at'] != null) fmtDateTime(s['decided_at']),
                  if (str(s['comment']).isNotEmpty) '"${s['comment']}"',
                ].join(' · '),
                style: const TextStyle(fontSize: 12.5, color: Brand.body),
              ),
            ),
          ]),
        ),
      if (canAct) ...[
        if (str(req['acting_for']).isNotEmpty)
          Text('You are deciding on behalf of ${req['acting_for']}.', style: const TextStyle(fontSize: 12, color: Brand.muted)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
              onPressed: _busy ? null : () => _decide(id, 'approve'),
              child: const Text('Approve')),
          OutlinedButton(onPressed: _busy ? null : () => _decide(id, 'return'), child: const Text('Return for changes')),
          OutlinedButton(
              style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
              onPressed: _busy ? null : () => _decide(id, 'reject'),
              child: const Text('Reject')),
        ]),
      ],
      if (pending && req['can_cancel'] == true)
        TextButton(onPressed: _busy ? null : () => _cancel(id), child: const Text('Withdraw approval request')),
    ]);
  }
}

/// Design users (/design/lookups/users) as "Name — code"; excludeMe leaves
/// the caller out (checker / approver pickers never offer the author).
Future<List<Option<int>>> designUsers(String search, {bool excludeMe = false}) async {
  final rows = (await Api.list('/design/lookups/users')).rows;
  final s = search.toLowerCase();
  final me = Perm.userId;
  return [
    for (final u in rows)
      if (asInt(u['id']) != null &&
          !(excludeMe && asInt(u['id']) == me) &&
          (s.isEmpty || '${u['label']} ${u['code'] ?? ''}'.toLowerCase().contains(s)))
        Option<int>(asInt(u['id'])!, str(u['code']).isEmpty ? str(u['label']) : '${u['label']} — ${u['code']}'),
  ];
}

/// Design requests still open (for "Design request" pickers).
Future<List<Option<int>>> designOpenRequests(String search) async {
  final rows = (await Api.list('/design/requests', query: {'status': 'open,accepted,in_progress,on_hold'})).rows;
  final s = search.toLowerCase();
  return [
    for (final r in rows)
      if (asInt(r['id']) != null &&
          (s.isEmpty || '${r['request_number']} ${r['title']} ${r['customer_name'] ?? ''}'.toLowerCase().contains(s)))
        Option<int>(asInt(r['id'])!,
            '${r['request_number']} — ${r['title']}${str(r['customer_name']).isEmpty ? '' : ' (${r['customer_name']})'}'),
  ];
}

/// Uploads picked files to a drawing revision under one file role.
Future<Json> uploadRevisionFiles(int revisionId, List<MultipartFile> files, String role) async {
  final fd = FormData();
  fd.fields.add(MapEntry('file_role', role));
  for (final f in files) {
    fd.files.add(MapEntry('files', f));
  }
  final res = await Api.dio.post('/design/revisions/$revisionId/files',
      data: fd, options: Options(sendTimeout: const Duration(minutes: 10), receiveTimeout: const Duration(minutes: 10)));
  return jsonMap(res.data);
}
