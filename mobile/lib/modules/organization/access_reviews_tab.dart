import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'org_common.dart';

// Organization › Access Reviews - native copy of
// frontend/src/app/dashboard/organization/access-reviews/page.tsx.
// Every reporting manager confirms or revokes the roles their reports hold;
// campaign admins (organization:access_reviews:edit) start and close
// campaigns and can decide unassigned lines.

const _decisionLabels = {'keep': 'Kept', 'revoke': 'Revoked', 'pending': 'Pending'};
const _decisionColors = {'keep': Color(0xFF16A34A), 'revoke': Color(0xFFDC2626), 'pending': Color(0xFFF59E0B)};
const _statusColors = {'open': Color(0xFF2563EB), 'closed': Color(0xFF78716C)};

Widget _pill(String status) => StatusBadge(_decisionLabels[status] ?? humanize(status),
    color: _decisionColors[status] ?? _statusColors[status] ?? const Color(0xFF78716C));

class OrgAccessReviewsTab extends StatefulWidget {
  const OrgAccessReviewsTab({super.key});

  @override
  State<OrgAccessReviewsTab> createState() => _OrgAccessReviewsTabState();
}

class _OrgAccessReviewsTabState extends State<OrgAccessReviewsTab> {
  bool get _canView => orgCan('access_reviews', 'view');
  bool get _canEdit => orgCan('access_reviews', 'edit');

  List<Json>? _mine;
  List<Json> _reviews = [];
  int? _openId;
  Json? _detail;
  String _error = '';
  String _mineFilter = 'all'; // all | pending

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = '');
    try {
      final mine = (await Api.list('/organization/grc/reviews/my-lines')).rows;
      if (mounted) setState(() => _mine = mine);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
    if (_canView) {
      try {
        final r = (await Api.list('/organization/grc/reviews')).rows;
        if (mounted) setState(() => _reviews = r);
      } catch (e) {
        if (mounted) setState(() => _error = ApiClient.describe(e));
      }
    }
    if (_openId != null) await _loadDetail(_openId!);
  }

  Future<void> _loadDetail(int id) async {
    try {
      final d = jsonMap(await Api.get('/organization/grc/reviews/$id'));
      if (mounted && _openId == id) setState(() => _detail = d);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  // Mirrors the backend (grc.decide_line): the assigned reviewer or an Access
  // Reviews editor decides, only while the review is open, and nobody but an
  // admin recertifies their own access.
  bool _mayDecide(Json l, bool reviewOpen) {
    final me = Perm.userId;
    return reviewOpen &&
        (asInt(l['reviewer_id']) == me || _canEdit) &&
        (asInt(l['user_id']) != me || Perm.isAdmin);
  }

  Future<void> _keep(Json l) async {
    final ok = await runAction(context,
        () => Api.post('/organization/grc/review-lines/${l['id']}/decide', data: {'decision': 'keep'}));
    if (ok) _load();
  }

  Future<void> _revoke(Json l) async {
    String reason = '';
    final saved = await showFormSheet(
      context,
      title: 'Revoke this access?',
      saveLabel: 'Revoke',
      builder: (ctx, setS) => [
        Text('${str(l['user_name'])} · ${str(l['label'])}', style: const TextStyle(color: Brand.muted)),
        const Caps('Reason'),
        AppTextField(
          label: 'Why is this access no longer needed?',
          required: true,
          maxLines: 3,
          hint: 'e.g. moved to Sales, no longer posts GRNs',
          onChanged: (v) => reason = v,
        ),
        Text('${str(l['user_name'])} loses "${str(l['label'])}" immediately. The reason is kept in the audit trail.',
            style: const TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (reason.trim().isEmpty) {
          throw 'Say why the access is being revoked (e.g. "moved to Sales, no longer posts GRNs") - it is kept in the audit trail.';
        }
        await Api.post('/organization/grc/review-lines/${l['id']}/decide',
            data: {'decision': 'revoke', 'comment': reason.trim()});
      },
    );
    if (saved) _load();
  }

  Future<void> _start() async {
    final period = TextEditingController();
    DateTime? due;
    Json? created;
    final saved = await showFormSheet(
      context,
      title: 'Start access review',
      saveLabel: 'Start review',
      builder: (ctx, setS) => [
        const Text('Every reporting manager confirms or revokes the access their team holds',
            style: TextStyle(color: Brand.muted)),
        const Caps('Campaign'),
        AppTextField(label: 'Period', required: true, controller: period, hint: 'e.g. 2026-Q4'),
        const Text('The label managers see on their review lines.', style: TextStyle(fontSize: 12, color: Brand.muted)),
        DateField(label: 'Due date (optional)', value: due, onChanged: (d) => setS(() => due = d)),
        const Text('Reviewers are reminded until every line they own is decided.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (period.text.trim().isEmpty) throw 'Enter the period this review covers, e.g. 2026-Q4.';
        created = jsonMap(await Api.post('/organization/grc/reviews',
            data: {'period': period.text.trim(), 'due_date': due == null ? null : apiDate(due!)}));
      },
    );
    if (saved) {
      final id = asInt(created?['id']);
      setState(() {
        _openId = id;
        _detail = null;
      });
      _load();
    }
  }

  Future<void> _close(Json r) async {
    final ok = await confirmDialog(context,
        title: 'Close this review?',
        message:
            '${r['pending'] ?? 0} line(s) are still undecided — they stay as they are and are reported as not reviewed.',
        confirmLabel: 'Close review');
    if (!ok || !mounted) return;
    final done = await runAction(context, () => Api.post('/organization/grc/reviews/${r['id']}/close'));
    if (done) _load();
  }

  Widget _line(Json l, {required bool showReviewer, required bool canDecide}) {
    final decision = str(l['decision']).isEmpty ? 'pending' : str(l['decision']);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(txt(l['user_name']),
                        style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
                    if (str(l['period']).isNotEmpty)
                      Text(str(l['period']), style: const TextStyle(fontSize: 11, color: Brand.muted)),
                  ],
                ),
              ),
              _pill(decision),
            ],
          ),
          const SizedBox(height: 6),
          Text(txt(l['label']), style: const TextStyle(fontSize: 13, color: Brand.body)),
          if (showReviewer)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: str(l['reviewer_name']).isEmpty
                  ? const Text('Reviewer: Unassigned (no manager)', style: TextStyle(fontSize: 12, color: Color(0xFFB45309)))
                  : Text('Reviewer: ${str(l['reviewer_name'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ),
          if (str(l['decided_by_name']).isNotEmpty)
            Text('by ${str(l['decided_by_name'])}', style: const TextStyle(fontSize: 11, color: Brand.muted)),
          if (str(l['comment']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('Comment: ${str(l['comment'])}', style: const TextStyle(fontSize: 12, color: Brand.body)),
            ),
          if (decision != 'revoke' && canDecide)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Wrap(spacing: 8, children: [
                if (decision != 'keep') PillButton('Keep', icon: Icons.check_rounded, onPressed: () => _keep(l)),
                PillButton('Revoke', icon: Icons.close_rounded, danger: true, onPressed: () => _revoke(l)),
              ]),
            ),
        ],
      ),
    );
  }

  Widget _card(String title, List<Widget> children, {Widget? action}) =>
      DetailSection(title, action: action, children: children);

  @override
  Widget build(BuildContext context) {
    final mine = _mine ?? const <Json>[];
    final pending = mine.where((l) => str(l['decision']).isEmpty).toList();
    final shownMine = _mineFilter == 'pending' ? pending : mine;
    final detailLines = jsonList(_detail?['lines']);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          const PageHeader('Access Reviews',
              subtitle:
                  'Periodic recertification: each manager confirms the access their team still needs. A revoke removes the role at once.'),
          if (_error.isNotEmpty) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(_error)),
          _card('Waiting for my decision (${pending.length})', [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                CountChip('All', mine.length,
                    selected: _mineFilter == 'all', onTap: () => setState(() => _mineFilter = 'all')),
                CountChip('Pending', pending.length,
                    selected: _mineFilter == 'pending',
                    onTap: () => setState(() => _mineFilter = _mineFilter == 'pending' ? 'all' : 'pending')),
              ]),
            ),
            const SizedBox(height: 8),
            if (_mine == null)
              const LoadingView()
            else if (shownMine.isEmpty)
              const Text('Nothing to review.', style: TextStyle(color: Brand.muted))
            else
              for (final l in shownMine) _line(l, showReviewer: false, canDecide: _mayDecide(l, true)),
          ]),
          if (_canView)
            _card(
              'Campaigns (${_reviews.length})',
              [
                if (_reviews.isEmpty)
                  const Text('No access review has been run yet.', style: TextStyle(color: Brand.muted)),
                for (final r in _reviews) _reviewTile(r),
                if (_detail != null) ...[
                  const SizedBox(height: 12),
                  Text('${str(_detail!['period'])} — all lines (${detailLines.length})',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.heading)),
                  const SizedBox(height: 8),
                  if (detailLines.isEmpty) const Text('Nothing to review.', style: TextStyle(color: Brand.muted)),
                  for (final l in detailLines)
                    _line(l, showReviewer: true, canDecide: _mayDecide(l, str(_detail!['status']) == 'open')),
                ],
              ],
              action: _canEdit
                  ? FilledButton(
                      style: FilledButton.styleFrom(minimumSize: const Size(0, 36)),
                      onPressed: _start,
                      child: const Text('Start review', style: TextStyle(fontSize: 13)))
                  : null,
            ),
        ],
      ),
    );
  }

  Widget _reviewTile(Json r) {
    final id = asInt(r['id']);
    final selected = _openId == id;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () {
        setState(() {
          _openId = selected ? null : id;
          _detail = null;
        });
        if (!selected && id != null) _loadDetail(id);
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected ? Brand.primarySoft : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? Brand.primary : Brand.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                  child: Text(txt(r['period']),
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading))),
              _pill(str(r['status'])),
            ]),
            const SizedBox(height: 6),
            Wrap(spacing: 14, runSpacing: 4, children: [
              _meta('Due', fmtDate(r['due_date'])),
              _meta('Lines', txt(r['total'])),
              _meta('Pending', txt(r['pending'])),
              _meta('Kept', txt(r['kept'])),
              _meta('Revoked', txt(r['revoked'])),
              _meta('Unassigned', txt(r['unassigned'])),
            ]),
            if (_canEdit && str(r['status']) == 'open')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: PillButton('Close', icon: Icons.lock_outline_rounded, onPressed: () => _close(r)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _meta(String label, String value) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: Brand.muted)),
          Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Brand.body)),
        ],
      );
}
