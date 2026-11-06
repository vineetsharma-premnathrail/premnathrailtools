// Phone copy of frontend/src/components/shared/ApprovalPanel.tsx: the central
// approval engine's status and actions for one record (drawing revision, BOM
// line). Approve / Return for changes / Reject with a comment, Withdraw.
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'common.dart';

const _reqLabel = {
  'pending': 'Waiting for approval', 'approved': 'Approved', 'rejected': 'Rejected',
  'returned': 'Returned for changes', 'cancelled': 'Cancelled',
};
const _reqHex = {'pending': cAmber, 'approved': cGreen, 'rejected': cRed, 'returned': Color(0xFF7C3AED), 'cancelled': cStone};
const _stepLabel = {
  'waiting': 'Not yet', 'pending': 'Waiting', 'approved': 'Approved', 'rejected': 'Rejected', 'returned': 'Returned',
  'skipped': 'Not needed', 'cancelled': 'Cancelled',
};
const _stepHex = {
  'waiting': cStoneLight, 'pending': cAmber, 'approved': cGreen, 'rejected': cRed, 'returned': Color(0xFF7C3AED),
  'skipped': cStoneLight, 'cancelled': cStoneLight,
};
const _viaLabel = {'delegation': 'as delegate', 'escalation': 'after escalation', 'admin': 'admin stand-in'};

/// Opens the approval of one record as its own screen (portal: the review popup).
Future<void> openApprovalScreen(BuildContext context,
    {required String entityType, required int entityId, required String title, String? subtitle}) {
  return Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => SubPage(
      title: title,
      body: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 24),
        children: [
          if (subtitle != null && subtitle.isNotEmpty)
            Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: Muted(subtitle, size: 13)),
          ApprovalPanel(entityType: entityType, entityId: entityId, showEmpty: true),
        ],
      ),
    ),
  ));
}

class ApprovalPanel extends StatefulWidget {
  const ApprovalPanel({
    super.key,
    required this.entityType,
    required this.entityId,
    this.title = 'Approval',
    this.onChanged,
    this.showEmpty = false,
  });
  final String entityType;
  final int entityId;
  final String title;
  final VoidCallback? onChanged;

  /// Says "no approval request" instead of drawing nothing (stand-alone screen).
  final bool showEmpty;

  @override
  State<ApprovalPanel> createState() => _ApprovalPanelState();
}

class _ApprovalPanelState extends State<ApprovalPanel> {
  Json? _data;
  String? _error;
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

  Future<void> _decide(int reqId, String decision) =>
      _act(() => Api.post('/approvals/requests/$reqId/decide', data: {'decision': decision, 'comment': _comment.text}));

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final current = data?['current'] is Map ? asJson(data!['current']) : null;
    final history = rowsOf(data?['history']);
    if (data == null && _error == null) {
      return widget.showEmpty ? const LoadingView() : const SizedBox.shrink();
    }
    if (data == null || (current == null && history.isEmpty)) {
      if (_error != null) return DetailSection(widget.title, children: [ErrorBanner(_error!)]);
      return widget.showEmpty
          ? const EmptyView('No approval request for this record yet. It appears here once it is submitted for approval.')
          : const SizedBox.shrink();
    }
    final canAct = current != null &&
        current['status'] == 'pending' &&
        (asBool(current['can_decide']) || asBool(current['can_stand_in']));

    return DetailSection(widget.title, children: [
      if (current != null) ...[
        Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            pill(current['status'], _reqLabel, _reqHex),
            Muted('Submitted by ${txt(current['requester_name'])} on ${fmtDateTime(current['submitted_at'])}'
                '${(asInt(current['revision']) ?? 1) > 1 ? ' · submission #${current['revision']}' : ''}'),
          ],
        ),
        const SizedBox(height: 10),
        _StageList(req: current),
      ],
      if (_error != null) ...[const SizedBox(height: 10), ErrorBanner(_error!)],
      if (canAct) ...[
        const SizedBox(height: 12),
        if (str(current['acting_for']).isNotEmpty) Muted('You are deciding on behalf of ${current['acting_for']}.'),
        if (!asBool(current['can_decide']) && asBool(current['can_stand_in']))
          const Muted('You are not an approver of this stage — as an admin you can stand in; a comment is required.'),
        const SizedBox(height: 8),
        TextField(
          controller: _comment,
          minLines: 2,
          maxLines: 4,
          decoration: InputDecoration(
            hintText: 'Comment (required to reject or return)',
            isDense: true,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
        const SizedBox(height: 10),
        btnWrap([
          primaryBtn('Approve', _busy ? null : () => _decide(asInt(current['id'])!, 'approve'), icon: Icons.check_rounded),
          smallBtn('Return for changes', _busy ? null : () => _decide(asInt(current['id'])!, 'return')),
          smallBtn('Reject', _busy ? null : () => _decide(asInt(current['id'])!, 'reject'), danger: true),
        ]),
      ],
      if (current != null && current['status'] == 'pending' && asBool(current['can_cancel'])) ...[
        const SizedBox(height: 10),
        smallBtn('Withdraw approval request', _busy
            ? null
            : () async {
                final ok = await confirmDialog(context,
                    title: 'Withdraw approval request?',
                    message: 'The approvers will no longer see it. You can submit it again later.',
                    confirmLabel: 'Withdraw');
                if (ok) await _act(() => Api.post('/approvals/requests/${current['id']}/cancel', data: {}));
              }),
      ],
      if (history.isNotEmpty) ...[
        const SizedBox(height: 10),
        InkWell(
          onTap: () => setState(() => _showHistory = !_showHistory),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Text('${_showHistory ? 'Hide' : 'Show'} earlier submissions (${history.length})',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: cOrange)),
          ),
        ),
        if (_showHistory)
          for (final h in history) ...[
            const Divider(height: 20),
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              pill(h['status'], _reqLabel, _reqHex),
              Muted('Submission #${h['revision']} · ${fmtDateTime(h['submitted_at'])}', size: 12),
            ]),
            const SizedBox(height: 6),
            _StageList(req: h),
          ],
      ],
    ]);
  }
}

class _StageList extends StatelessWidget {
  const _StageList({required this.req});
  final Json req;

  @override
  Widget build(BuildContext context) {
    final groups = <int, List<Json>>{};
    for (final s in rowsOf(req['steps'])) {
      groups.putIfAbsent(asInt(s['sequence']) ?? 0, () => []).add(s);
    }
    final current = asInt(req['current_sequence']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final e in groups.entries)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.only(left: 12),
            decoration: BoxDecoration(
              border: Border(left: BorderSide(color: e.key == current ? cAmber : Brand.border, width: 3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(TextSpan(children: [
                  TextSpan(text: '${e.key}. ${str(e.value.first['stage_name'])}'),
                  if (e.value.length > 1)
                    TextSpan(
                      text: e.value.first['approval_mode'] == 'all'
                          ? ' — every one must approve'
                          : ' — any one approves',
                      style: const TextStyle(fontWeight: FontWeight.w500, color: Brand.muted),
                    ),
                ]), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.heading)),
                const SizedBox(height: 4),
                for (final s in e.value)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 2,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        pill(s['status'], _stepLabel, _stepHex),
                        Text(txt(s['approver_name']), style: const TextStyle(fontSize: 13)),
                        if (str(s['decided_by_name']).isNotEmpty && s['decided_by_id'] != s['approver_id'])
                          Muted('decided by ${s['decided_by_name']}'
                              '${_viaLabel[str(s['via'])] != null ? ' (${_viaLabel[str(s['via'])]})' : ''}', size: 12),
                        if (s['decided_at'] != null) Muted(fmtDateTime(s['decided_at']), size: 12),
                        if (s['status'] == 'pending' && s['due_at'] != null)
                          Muted('escalates ${fmtDateTime(s['due_at'])}', size: 12),
                        if (str(s['comment']).isNotEmpty)
                          Text('“${s['comment']}”', style: const TextStyle(fontSize: 13, fontStyle: FontStyle.italic)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
