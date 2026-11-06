import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/form.dart';
import '../../ui/widgets.dart';
import 'pm_common.dart';

/// "Store Issues", "Purchases" and "Tasks" history tabs shared by the project
/// page and the machine page (frontend/src/components/projects/ProjectHistoryTables.tsx).
/// [base] is `/projects/{id}` (project) or `/erp/projects/{id}` (machine).

class StoreIssuesHistory extends StatelessWidget {
  const StoreIssuesHistory({super.key, required this.base});
  final String base;

  @override
  Widget build(BuildContext context) {
    return PmBlock<List<Json>>(
      load: () async => rowsOf(await Api.get('$base/store-issues')),
      builder: (ctx, rows, _) {
        if (rows.isEmpty) {
          return const MutedText(
              'No material issued to this project yet — issues are made in Store › Material Issue with this project selected.');
        }
        return Column(children: [for (final r in rows) _IssueCard(r)]);
      },
    );
  }
}

class _IssueCard extends StatefulWidget {
  const _IssueCard(this.r);
  final Json r;

  @override
  State<_IssueCard> createState() => _IssueCardState();
}

class _IssueCardState extends State<_IssueCard> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final r = widget.r;
    final lines = rowsOf(r['lines']);
    final count = i(r['line_count']) ?? lines.length;
    return RecordCard(
      code: s(r['issue_number']),
      title: labelOf(r['issue_type_label'], r['issue_type']),
      subtitle: [s(r['issued_to']), if (s(r['store_name']) != null) 'from ${r['store_name']}'].whereType<String>().join(' · '),
      trailing: Pill(humanize(r['status']), historyHex(s(r['status']))),
      meta: [('Date', fmtDate(r['issue_date'])), ('Lines', count == 0 ? '—' : '$count ${count == 1 ? 'item' : 'items'}')],
      onTap: lines.isEmpty ? null : () => setState(() => _open = !_open),
    ).withExtra(_open
        ? Padding(
            padding: const EdgeInsets.fromLTRB(32, 0, 24, 10),
            child: Column(children: [
              for (final l in lines)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SizedBox(
                        width: 70,
                        child: Text(txt(l['item_code']),
                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
                    Expanded(child: Text(txt(l['item_name']), style: const TextStyle(fontSize: 12.5))),
                    Text('${fmtNumber(l['quantity'])} ${s(l['uom']) ?? ''}',
                        style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                  ]),
                ),
            ]),
          )
        : null);
  }
}

extension _WithExtra on Widget {
  Widget withExtra(Widget? extra) => extra == null ? this : Column(children: [this, extra]);
}

class PurchasesHistory extends StatelessWidget {
  const PurchasesHistory({super.key, required this.base});
  final String base;

  @override
  Widget build(BuildContext context) {
    return PmBlock<List<Json>>(
      load: () async => rowsOf(await Api.get('$base/purchases')),
      builder: (ctx, rows, _) {
        if (rows.isEmpty) {
          return const MutedText(
              'No purchase requisition is charged to this project yet — raise one in Procurement › Purchase Requisitions and pick this project.');
        }
        return Column(children: [
          for (final pr in rows)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(
                        child: Text(txt(pr['pr_number']),
                            style: const TextStyle(
                                fontSize: 13, fontWeight: FontWeight.w700, color: Brand.primaryActive)),
                      ),
                      Pill(labelOf(pr['status_label'], pr['status']), historyHex(s(pr['status']))),
                    ]),
                    const SizedBox(height: 4),
                    Text(
                        [fmtDate(pr['pr_date']), s(pr['purpose_label']), s(pr['requested_by_name']), '${i(pr['line_count']) ?? 0} lines']
                            .whereType<String>()
                            .join(' · '),
                        style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
                    const SizedBox(height: 8),
                    if (rowsOf(pr['pos']).isEmpty)
                      const Text('No purchase order yet.', style: TextStyle(fontSize: 12, color: Color(0xFFA8A29E)))
                    else
                      for (final po in rowsOf(pr['pos'])) _poBlock(po),
                  ]),
                ),
              ),
            ),
        ]);
      },
    );
  }

  Widget _poBlock(Json po) {
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.only(left: 10),
      decoration: const BoxDecoration(border: Border(left: BorderSide(color: Color(0x14000000), width: 2))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Wrap(spacing: 10, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          const Text('PO', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFFA8A29E))),
          Text(txt(po['po_number']), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
          Text(txt(po['vendor_name']), style: const TextStyle(fontSize: 12.5)),
          Text(fmtDate(po['po_date']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
          Text(fmtMoney(po['total_amount']), style: const TextStyle(fontSize: 12.5)),
          Pill(labelOf(po['status_label'], po['status']), historyHex(s(po['status']))),
        ]),
        for (final g in rowsOf(po['grns']))
          Padding(
            padding: const EdgeInsets.only(left: 20, top: 4),
            child: Wrap(spacing: 10, crossAxisAlignment: WrapCrossAlignment.center, children: [
              const Text('GRN', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFFA8A29E))),
              Text(txt(g['grn_number']), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
              Text(fmtDate(g['grn_date']), style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
              Pill(labelOf(g['status_label'], g['status']), historyHex(s(g['status']))),
            ]),
          ),
      ]),
    );
  }
}

/// Every task of the project (PM tasks + R&D tasks), read-only.
class TaskHistory extends StatelessWidget {
  const TaskHistory({super.key, required this.base});
  final String base;

  static bool _overdue(Json t) {
    final due = dateOnly(t['due_date']);
    if (due == null || s(t['completed_at']) != null) return false;
    if (RegExp('complete|done|cancel', caseSensitive: false).hasMatch(s(t['status']) ?? '')) return false;
    final now = DateTime.now();
    return due.isBefore(DateTime(now.year, now.month, now.day));
  }

  @override
  Widget build(BuildContext context) {
    return PmBlock<List<Json>>(
      load: () async => rowsOf(await Api.get('$base/task-history')),
      builder: (ctx, rows, _) {
        if (rows.isEmpty) {
          return const MutedText(
              'No tasks on this project yet — PM tasks are created inside a milestone; R&D tasks come from R&D › R&D Tasks.');
        }
        return Column(children: [
          for (final t in rows)
            Builder(builder: (ctx) {
              final rnd = s(t['kind']) == 'rnd';
              final late = _overdue(t);
              final p = t['progress_percent'];
              return RecordCard(
                title: txt(t['title']),
                subtitle: rnd ? 'R&D task' : 'PM task · ${s(t['milestone_name']) ?? '—'}',
                trailing: Pill(labelOf(t['status_label'], t['status']), historyHex(s(t['status']))),
                meta: [
                  ('Assignee', txt(t['assignee_name'])),
                  ('Due date', '${fmtDate(t['due_date'])}${late ? ' · overdue' : ''}'),
                  ('Progress', p == null ? '—' : '${n(p).round()}%'),
                  ('Completed', fmtDate(t['completed_at'])),
                ],
                onTap: () => _view(ctx, t),
              );
            }),
        ]);
      },
    );
  }

  /// Read-only view of one task - nothing here edits or deletes.
  void _view(BuildContext context, Json t) {
    final rnd = s(t['kind']) == 'rnd';
    final checklist = rowsOf(t['checklist']);
    showFormSheet(
      context,
      title: txt(t['title']),
      saveLabel: 'Close',
      onSave: () async {},
      builder: (ctx, _) => [
        Text('${rnd ? 'R&D task' : 'PM task'} · ${(!rnd ? s(t['milestone_name']) : null) ?? 'This project'}',
            style: const TextStyle(color: Brand.muted)),
        DetailSection('Details', children: [FieldRow('Description', t['description'])]),
        DetailSection('Assignment', children: [
          FieldRow('Assignee', t['assignee_name']),
          FieldRow('Created by', t['created_by_name']),
          FieldRow('Milestone', rnd ? null : t['milestone_name']),
          FieldRow('Department', t['department_name']),
        ]),
        DetailSection('Schedule', children: [
          FieldRow('Start date', fmtDate(t['start_date'])),
          FieldRow('Due date', fmtDate(t['due_date'])),
          FieldRow('Completed', fmtDate(t['completed_at'])),
          FieldRow('Status', Pill(labelOf(t['status_label'], t['status']), historyHex(s(t['status'])))),
          FieldRow(
              'Priority',
              s(t['priority']) == null
                  ? null
                  : Pill(s(t['priority']) == 'urgent' ? 'Urgent' : 'Standard',
                      hx(s(t['priority']) == 'urgent' ? '#b91c1c' : '#78716c'))),
        ]),
        DetailSection('Progress', children: [
          FieldRow('Progress', t['progress_percent'] == null ? null : '${n(t['progress_percent']).round()}%'),
          FieldRow(
            'Checklist',
            checklist.isEmpty
                ? null
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${checklist.where((c) => b(c['done'])).length} of ${checklist.length} done',
                        style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    for (final c in checklist)
                      Text('${b(c['done']) ? '✓' : '○'}  ${txt(c['text'])}',
                          style: TextStyle(
                              decoration: b(c['done']) ? TextDecoration.lineThrough : null,
                              color: b(c['done']) ? Brand.muted : Brand.body)),
                  ]),
          ),
        ]),
      ],
    );
  }
}
