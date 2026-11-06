import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'pm_common.dart';

const _reqLabel = {
  'pending': 'Waiting for approval', 'approved': 'Approved', 'rejected': 'Rejected', 'returned': 'Returned for changes',
  'cancelled': 'Cancelled',
};
const _reqHex = {
  'pending': '#F59E0B', 'approved': '#16A34A', 'rejected': '#DC2626', 'returned': '#7c3aed', 'cancelled': '#78716c',
};
const _stepLabel = {
  'waiting': 'Not yet', 'pending': 'Waiting', 'approved': 'Approved', 'rejected': 'Rejected', 'returned': 'Returned',
  'skipped': 'Not needed', 'cancelled': 'Cancelled',
};
const _stepHex = {
  'waiting': '#a8a29e', 'pending': '#F59E0B', 'approved': '#16A34A', 'rejected': '#DC2626', 'returned': '#7c3aed',
  'skipped': '#a8a29e', 'cancelled': '#a8a29e',
};

/// Approval status + actions for one record from the central approval engine
/// (frontend/src/components/shared/ApprovalPanel.tsx). Renders nothing when
/// the record never went for approval.
class ApprovalPanel extends StatefulWidget {
  const ApprovalPanel({super.key, required this.entityType, required this.entityId, this.title = 'Approval', this.onChanged});
  final String entityType;
  final int entityId;
  final String title;
  final VoidCallback? onChanged;

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
      if (mounted) setState(() => _data = obj(d));
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
    final steps = rowsOf(req['steps']);
    final groups = <int, List<Json>>{};
    for (final st in steps) {
      groups.putIfAbsent(i(st['sequence']) ?? 0, () => []).add(st);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      for (final e in groups.entries)
        Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.only(left: 10),
          decoration: BoxDecoration(
              border: Border(
                  left: BorderSide(
                      width: 3,
                      color: e.key == i(req['current_sequence']) ? hx('#F59E0B') : const Color(0x1F000000)))),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
                '${e.key}. ${txt(e.value.first['stage_name'])}'
                '${e.value.length > 1 ? (s(e.value.first['approval_mode']) == 'all' ? ' — every one must approve' : ' — any one approves') : ''}',
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading)),
            for (final st in e.value)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Wrap(spacing: 8, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  Pill(_stepLabel[s(st['status'])] ?? txt(st['status']), hx(_stepHex[s(st['status'])] ?? '#78716c')),
                  Text(txt(st['approver_name']), style: const TextStyle(fontSize: 12.5)),
                  if (s(st['decided_at']) != null)
                    Text(fmtDateTime(st['decided_at']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                  if (s(st['comment']) != null)
                    Text('“${st['comment']}”', style: const TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic)),
                ]),
              ),
          ]),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final history = rowsOf(d?['history']);
    final req = obj(d?['current']);
    if (d == null || (req == null && history.isEmpty)) {
      return _error == null ? const SizedBox.shrink() : Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(_error!));
    }
    final canAct = req != null && s(req['status']) == 'pending' && (b(req['can_decide']) || b(req['can_stand_in']));
    return DetailSection(widget.title, children: [
      if (req != null) ...[
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Pill(_reqLabel[s(req['status'])] ?? txt(req['status']), hx(_reqHex[s(req['status'])] ?? '#78716c')),
          Text(
              'Submitted by ${txt(req['requester_name'])} on ${fmtDateTime(req['submitted_at'])}'
              '${(i(req['revision']) ?? 1) > 1 ? ' · submission #${req['revision']}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
        const SizedBox(height: 10),
        _stages(req),
      ],
      if (_error != null) ...[const SizedBox(height: 8), ErrorBanner(_error!)],
      if (canAct) ...[
        if (s(req['acting_for']) != null)
          Text('You are deciding on behalf of ${req['acting_for']}.', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        if (!b(req['can_decide']) && b(req['can_stand_in']))
          const Text('You are not an approver of this stage — as an admin you can stand in; a comment is required.',
              style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        const SizedBox(height: 8),
        TextField(
          controller: _comment,
          maxLines: 3,
          minLines: 2,
          decoration: const InputDecoration(
              hintText: 'Comment (required to reject or return)', border: OutlineInputBorder(), isDense: true),
        ),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          SmallBtn('Approve', filled: true, color: Brand.primary, onPressed: _busy ? null : () => _decide(req, 'approve')),
          SmallBtn('Return for changes', onPressed: _busy ? null : () => _decide(req, 'return')),
          SmallBtn('Reject', color: Brand.danger, onPressed: _busy ? null : () => _decide(req, 'reject')),
        ]),
      ],
      if (req != null && s(req['status']) == 'pending' && b(req['can_cancel']))
        Padding(
          padding: const EdgeInsets.only(top: 10),
          child: SmallBtn('Withdraw approval request', onPressed: _busy
              ? null
              : () async {
                  final ok = await confirmDialog(context,
                      title: 'Withdraw approval request?',
                      message: 'The approvers will no longer see it. You can submit it again later.',
                      confirmLabel: 'Withdraw');
                  if (ok) _act(() => Api.post('/approvals/requests/${req['id']}/cancel', data: {}));
                }),
        ),
      if (history.isNotEmpty) ...[
        TextButton(
          onPressed: () => setState(() => _history = !_history),
          child: Text('${_history ? 'Hide' : 'Show'} earlier submissions (${history.length})'),
        ),
        if (_history)
          for (final h in history) ...[
            Wrap(spacing: 8, children: [
              Pill(_reqLabel[s(h['status'])] ?? txt(h['status']), hx(_reqHex[s(h['status'])] ?? '#78716c')),
              Text('Submission #${h['revision']} · ${fmtDateTime(h['submitted_at'])}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
            const SizedBox(height: 6),
            _stages(h),
          ],
      ],
    ]);
  }

  void _decide(Json req, String decision) {
    _act(() => Api.post('/approvals/requests/${req['id']}/decide', data: {'decision': decision, 'comment': _comment.text}));
  }
}
