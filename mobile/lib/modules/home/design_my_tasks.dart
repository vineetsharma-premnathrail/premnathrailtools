import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'home_common.dart';

/// Design › My Work "Reviews, approvals & changes" (/design/my-tasks): the
/// drawings, BOMs, change requests / notices and customer comments waiting
/// on me, in the portal's groups. The review / approval itself is done on
/// the drawing or BOM page (Design module), so each item opens there.
class DesignMyTasks extends StatefulWidget {
  const DesignMyTasks({super.key});

  @override
  State<DesignMyTasks> createState() => _DesignMyTasksState();
}

const _groups = <(String, String, String, Color)>[
  ('to_review', 'Drawings to check', 'You are the named checker', Color(0xFF2563EB)),
  ('to_approve', 'Drawings to approve', 'Checked, waiting for your approval', Color(0xFF7C3AED)),
  ('returned_to_me', 'Drawings returned to me', 'Fix and resubmit', Color(0xFFDC2626)),
  ('to_release', 'Ready to release', 'Customer approved — release the revision', Color(0xFF16A34A)),
  ('boms_to_review', 'BOMs to check', 'You are the named checker', Color(0xFF2563EB)),
  ('boms_to_approve', 'BOMs to approve', 'Checked, waiting for your release', Color(0xFF7C3AED)),
  ('boms_returned_to_me', 'BOMs returned to me', 'Fix and resubmit', Color(0xFFDC2626)),
  ('customer_comments', 'Customer comments', 'Assigned to you — close with a resolution', Color(0xFF0891B2)),
  ('ecrs_to_vote', 'Change requests to vote on', 'You are on the change board', Color(0xFFF59E0B)),
  ('ecrs_to_decide', 'Change requests to progress', 'Impact check or final decision (Design head)', Color(0xFFB45309)),
  ('ecns_to_approve', 'Change notices to decide', 'You are the named approver', Color(0xFFF59E0B)),
  ('ecns_to_implement', 'Change notices to release', 'Open — release once every affected drawing/BOM is released',
      Color(0xFF0F766E)),
  ('ecns_to_acknowledge', 'Change notices to acknowledge', 'For your department', Color(0xFF0F766E)),
  ('my_drafts', 'My drafts', 'Not yet submitted', Color(0xFF78716C)),
];

String _ref(Json t) {
  final kind = '${t['kind'] ?? ''}';
  if (kind.startsWith('bom')) return '${t['bom_number'] ?? 'BOM'} ${t['revision_label'] ?? ''}'.trim();
  if (kind.startsWith('ecr')) return '${t['ecr_number'] ?? 'ECR'}';
  if (kind.startsWith('ecn')) return '${t['ecn_number'] ?? 'ECN'}';
  if (kind == 'customer_comment') return '${t['comment'] ?? 'Customer comment'}';
  return '${t['doc_number'] ?? ''} ${t['revision_label'] ?? ''}'.trim();
}

/// Portal page of the item (taskHref), with signed refs.
String? _href(Json t) {
  if ('${t['link'] ?? ''}'.isNotEmpty) return '${t['link']}';
  if ('${t['kind']}'.startsWith('ecn')) {
    return t['ecn_id_ref'] != null ? '/dashboard/design/change-notices/${t['ecn_id_ref']}' : null;
  }
  return t['document_id_ref'] != null ? '/dashboard/design/documents/${t['document_id_ref']}' : null;
}

class _DesignMyTasksState extends State<DesignMyTasks> {
  String? _group;

  @override
  Widget build(BuildContext context) {
    return Loaded<Json>(
      load: () async {
        final d = await Api.get('/design/my-tasks');
        return d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{};
      },
      builder: (ctx, data, reload) {
        final filled = [
          for (final g in _groups)
            if (rowsOf(data[g.$1]).isNotEmpty) (g, rowsOf(data[g.$1])),
        ];
        final total = filled.where((e) => e.$1.$1 != 'my_drafts').fold<int>(0, (n, e) => n + e.$2.length);
        final group = filled.any((e) => e.$1.$1 == _group) ? _group : null;
        return ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            ChipBar(children: [
              CountChip('All', total, selected: group == null, onTap: () => setState(() => _group = null)),
              for (final e in filled)
                CountChip(e.$1.$2, e.$2.length,
                    color: e.$1.$4,
                    selected: group == e.$1.$1,
                    onTap: () => setState(() => _group = group == e.$1.$1 ? null : e.$1.$1)),
            ]),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
              child: Text(
                  total == 0
                      ? 'No reviews or approvals waiting on you.'
                      : '$total review/approval item${total == 1 ? '' : 's'} need your action.',
                  style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            ),
            if (filled.isEmpty) const EmptyView('Nothing is waiting on you in Design.', icon: Icons.design_services_outlined),
            for (final e in filled)
              if (group == null || group == e.$1.$1) ...[
                GroupHeading('${e.$1.$2} (${e.$2.length})', color: e.$1.$4),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
                  child: Text(e.$1.$3, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                ),
                for (final t in e.$2)
                  RecordCard(
                    code: _ref(t),
                    title: txt(t['title']),
                    subtitle: [
                      if (t['author_name'] != null) 'by ${t['author_name']}',
                      if (t['since'] != null) 'since ${fmtDate(t['since'])}',
                    ].join(' · '),
                    meta: [
                      ('Waiting', asInt(t['days_waiting']) == 0 ? 'today' : '${asInt(t['days_waiting'])} day${asInt(t['days_waiting']) == 1 ? '' : 's'}'),
                      if (t['comment'] != null && t['kind'] != 'customer_comment') ('Comment', '"${t['comment']}"'),
                    ],
                    onTap: () => openScreen(context, _DesignItemScreen(item: t, group: e.$1.$2)),
                  ),
              ],
          ],
        );
      },
    );
  }
}

class _DesignItemScreen extends StatelessWidget {
  const _DesignItemScreen({required this.item, required this.group});
  final Json item;
  final String group;

  @override
  Widget build(BuildContext context) {
    final t = item;
    final link = _href(t);
    return SubPage(
      title: _ref(t),
      body: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          DetailSection(group, children: [
            FieldRow('Number', _ref(t)),
            FieldRow('Title', t['title']),
            FieldRow('Status', StatusBadge(t['status'])),
            if (t['author_name'] != null) FieldRow('By', t['author_name']),
            if (t['since'] != null) FieldRow('Since', fmtDate(t['since'])),
            FieldRow('Waiting', '${asInt(t['days_waiting'])} day(s)'),
            if (t['comment'] != null) FieldRow('Comment', t['comment']),
          ]),
          const HintCard('Checking, approving and releasing drawings and BOMs is done on the record in the '
              'Design module. Open it in the portal to act.'),
        ],
      ),
      bottom: link == null
          ? null
          : OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              icon: const Icon(Icons.open_in_new_rounded),
              label: const Text('Open in portal'),
              onPressed: () => runAction(context, () => Files.openInPortal(link)),
            ),
    );
  }
}
