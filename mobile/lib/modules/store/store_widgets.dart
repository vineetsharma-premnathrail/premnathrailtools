import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'store_common.dart';

// Approval engine panel, managed Word documents, batch / bin / serial pickers
// (portal: ApprovalPanel, ManagedDocumentPanel, BatchPicker, BinSerialPicker).

// ── Managed Word documents ───────────────────────────────────────────────────

class ManagedDocButtons extends StatefulWidget {
  const ManagedDocButtons({
    super.key,
    required this.entityType,
    required this.entityId,
    required this.canModify,
    required this.downloadName,
    this.extra = const [],
  });
  final String entityType;
  final int entityId;
  final bool canModify;
  final String downloadName;
  final List<Widget> extra;

  @override
  State<ManagedDocButtons> createState() => _ManagedDocButtonsState();
}

class _ManagedDocButtonsState extends State<ManagedDocButtons> {
  bool _busy = false;

  String get _base => '/managed-documents/${widget.entityType}/${widget.entityId}';

  Future<void> _editInWord() async {
    setState(() => _busy = true);
    await runAction(context, () async {
      final got = jsonMap(await Api.get(_base));
      final doc = got['document'];
      if (doc == null || (doc is Map && doc['is_stale'] == true)) await Api.post(_base);
      final r = jsonMap(await Api.post('$_base/edit'));
      final url = r['url']?.toString();
      if (url == null || url.isEmpty) {
        throw Exception('The server did not return a Word link — use "Download Word" instead.');
      }
      await Files.openUrl(url);
    });
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _download() async {
    setState(() => _busy = true);
    await runAction(context, () async {
      final got = jsonMap(await Api.get(_base));
      if (got['document'] == null) await Api.post(_base);
      await Files.downloadAndOpen('$_base/docx', '${widget.downloadName}.docx');
    });
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) => Wrap(spacing: 8, runSpacing: 8, children: [
        if (widget.canModify)
          FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 40), textStyle: const TextStyle(fontSize: 14)),
            onPressed: _busy ? null : _editInWord,
            icon: const Icon(Icons.edit_note_rounded, size: 18),
            label: const Text('Save & Edit in Word'),
          ),
        PillButton('Download Word', icon: Icons.download_rounded, onPressed: _busy ? null : _download),
        ...widget.extra,
      ]);
}

// ── Central approval engine ──────────────────────────────────────────────────

const _reqLabel = {
  'pending': 'Waiting for approval',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned for changes',
  'cancelled': 'Cancelled',
};
const _reqColor = {
  'pending': Color(0xFFF59E0B),
  'approved': cGreen,
  'rejected': cRed,
  'returned': cPurple,
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

class ApprovalPanel extends StatefulWidget {
  const ApprovalPanel({super.key, required this.entityType, required this.entityId, this.onChanged});
  final String entityType;
  final int entityId;
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
      final d = jsonMap(await Api.get('/approvals/entity/${widget.entityType}/${widget.entityId}'));
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

  Future<void> _decide(Object id, String decision) =>
      _act(() => Api.post('/approvals/requests/$id/decide', data: {'decision': decision, 'comment': _comment.text}));

  Widget _stages(Json req) {
    final groups = <int, List<Json>>{};
    for (final s in jsonList(req['steps'])) {
      groups.putIfAbsent(toInt(s['sequence']) ?? 0, () => []).add(s);
    }
    final current = toInt(req['current_sequence']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final e in groups.entries)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
                border: Border(
                    left: BorderSide(color: e.key == current ? const Color(0xFFF59E0B) : Brand.border, width: 3))),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                    '${e.key}. ${txt(e.value.first['stage_name'])}'
                    '${e.value.length > 1 ? (e.value.first['approval_mode'] == 'all' ? ' — every one must approve' : ' — any one approves') : ''}',
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading)),
                for (final s in e.value)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Wrap(spacing: 6, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      pill(_stepLabel[s['status']] ?? humanize(s['status']),
                          _reqColor[s['status']] ?? const Color(0xFFA8A29E)),
                      Text(txt(s['approver_name']), style: const TextStyle(fontSize: 12.5)),
                      if (s['decided_by_name'] != null && s['decided_by_id'] != s['approver_id'])
                        Text('decided by ${s['decided_by_name']}${_viaLabel[s['via']] != null ? ' (${_viaLabel[s['via']]})' : ''}',
                            style: const TextStyle(fontSize: 12, color: Brand.muted)),
                      if (s['decided_at'] != null)
                        Text(fmtDateTime(s['decided_at']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                      if (s['status'] == 'pending' && s['due_at'] != null)
                        Text('escalates ${fmtDateTime(s['due_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                      if (s['comment'] != null && '${s['comment']}'.isNotEmpty)
                        Text('“${s['comment']}”', style: const TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic)),
                    ]),
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
      return _error == null ? const SizedBox() : DetailSection('Approval', children: [ErrorBanner(_error!)]);
    }
    final req = d['current'] is Map ? jsonMap(d['current']) : null;
    final history = jsonList(d['history']);
    if (req == null && history.isEmpty) return const SizedBox();
    final canAct =
        req != null && req['status'] == 'pending' && (req['can_decide'] == true || req['can_stand_in'] == true);
    return DetailSection('Approval', children: [
      if (req != null) ...[
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          pill(_reqLabel[req['status']] ?? humanize(req['status']), _reqColor[req['status']] ?? cGrey),
          Text(
              'Submitted by ${txt(req['requester_name'])} on ${fmtDateTime(req['submitted_at'])}'
              '${(toInt(req['revision']) ?? 1) > 1 ? ' · submission #${req['revision']}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
        _stages(req),
      ],
      if (_error != null) ...[const SizedBox(height: 10), ErrorBanner(_error!)],
      if (canAct) ...[
        const SizedBox(height: 12),
        if (req['acting_for'] != null) Hint('You are deciding on behalf of ${req['acting_for']}.'),
        if (req['can_decide'] != true && req['can_stand_in'] == true)
          const Hint('You are not an approver of this stage — as an admin you can stand in; a comment is required.'),
        const SizedBox(height: 6),
        AppTextField(label: 'Comment (required to reject or return)', controller: _comment, maxLines: 3),
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 40), textStyle: const TextStyle(fontSize: 14)),
            onPressed: _busy ? null : () => _decide(req['id'], 'approve'),
            child: const Text('Approve'),
          ),
          PillButton('Return for changes',
              icon: Icons.undo_rounded, onPressed: _busy ? null : () => _decide(req['id'], 'return')),
          PillButton('Reject',
              icon: Icons.close_rounded, color: cRed, onPressed: _busy ? null : () => _decide(req['id'], 'reject')),
        ]),
      ],
      if (req != null && req['status'] == 'pending' && req['can_cancel'] == true) ...[
        const SizedBox(height: 10),
        PillButton('Withdraw approval request',
            icon: Icons.cancel_outlined,
            onPressed: _busy
                ? null
                : () async {
                    final ok = await confirmDialog(context,
                        title: 'Withdraw approval request?',
                        message: 'The approvers will no longer see it. You can submit it again later.',
                        confirmLabel: 'Withdraw');
                    if (ok) await _act(() => Api.post('/approvals/requests/${req['id']}/cancel', data: {}));
                  }),
      ],
      if (history.isNotEmpty) ...[
        const SizedBox(height: 10),
        InkWell(
          onTap: () => setState(() => _history = !_history),
          child: Text('${_history ? 'Hide' : 'Show'} earlier submissions (${history.length})',
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Brand.primary)),
        ),
        if (_history)
          for (final h in history) ...[
            const Divider(height: 18),
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              pill(_reqLabel[h['status']] ?? humanize(h['status']), _reqColor[h['status']] ?? cGrey),
              Text('Submission #${txt(h['revision'])} · ${fmtDateTime(h['submitted_at'])}',
                  style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
            _stages(h),
          ],
      ],
    ]);
  }
}

// ── Batch / bin / serial pickers for outbound lines ─────────────────────────

/// Batch pick for a batch-tracked item (portal BatchPicker): "Auto — first in,
/// first out" leaves it to the server (FIFO / FEFO split shown underneath).
class BatchPicker extends StatefulWidget {
  const BatchPicker({
    super.key,
    required this.itemId,
    required this.locationId,
    required this.quantity,
    required this.value,
    required this.onChanged,
  });
  final int itemId;
  final int locationId;
  final num quantity;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  State<BatchPicker> createState() => _BatchPickerState();
}

class _BatchPickerState extends State<BatchPicker> {
  List<Json> _batches = const [];
  List<Json> _suggestion = const [];
  String? _shortfall;
  String? _error;
  String _loadedFor = '';

  void _load() {
    final key = '${widget.itemId}:${widget.locationId}:${widget.quantity}';
    if (key == _loadedFor) return;
    _loadedFor = key;
    Api.get('/store/batches/available', query: {
      'item_id': widget.itemId,
      'location_id': widget.locationId,
      'quantity': widget.quantity > 0 ? widget.quantity : null,
    }).then((r) {
      if (!mounted) return;
      final m = jsonMap(r);
      setState(() {
        _batches = jsonList(m['batches']);
        _suggestion = jsonList(m['suggestion']);
        _shortfall = m['shortfall']?.toString();
        _error = null;
      });
    }, onError: (Object _) {
      if (mounted) setState(() => _error = 'Could not load the batches in this store.');
    });
  }

  @override
  Widget build(BuildContext context) {
    _load();
    String label(Json b) =>
        '${txt(b['batch_number'])}${b['heat_number'] != null ? ' · heat ${b['heat_number']}' : ''} — ${fmtQ(b['free_qty'])} free'
        '${b['expiry_date'] != null ? ' · exp ${fmtDate(b['expiry_date'])}' : ''}'
        '${b['issuable'] == false ? ' (${txt(b['reason'])})' : ''}';
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      AppSelect<String>(
        label: 'Batch',
        value: widget.value,
        options: [
          const Option('', 'Auto — first in, first out'),
          for (final b in _batches)
            if (b['issuable'] != false) Option(b['batch_number'].toString(), label(b)),
        ],
        clearable: false,
        onChanged: (o) => widget.onChanged(o?.value ?? ''),
      ),
      if (_error != null) Hint(_error!, color: cRed),
      if (widget.value.isEmpty && _suggestion.isNotEmpty)
        Hint('Will issue ${_suggestion.map((s) => '${fmtQ(s['quantity'])} from ${s['batch_number']}').join(', ')}'),
      if (widget.value.isEmpty && _shortfall != null) Hint(_shortfall!, color: cRed),
    ]);
  }
}

/// Line-level bin + serial picker (portal BinSerialPicker): the store's bins,
/// and for a serialised item its units In stock there.
class BinSerialPicker extends StatefulWidget {
  const BinSerialPicker({
    super.key,
    required this.locationId,
    required this.itemId,
    required this.serialised,
    required this.quantity,
    required this.binId,
    required this.serials,
    required this.onChanged,
  });
  final int locationId;
  final int itemId;
  final bool serialised;
  final num quantity;
  final int? binId;
  final List<String> serials;

  /// (binId, serials) — a bin change clears the picked serials.
  final void Function(int? binId, List<String> serials) onChanged;

  static final Map<int, Future<List<Json>>> _binCache = {};

  static Future<List<Json>> binsOf(int locationId) => _binCache.putIfAbsent(
      locationId,
      () => Api.list('/store/bins', query: {'location_id': locationId})
          .then((p) => p.rows.where((b) => b['is_active'] != false).toList(), onError: (Object _) => <Json>[]));

  @override
  State<BinSerialPicker> createState() => _BinSerialPickerState();
}

class _BinSerialPickerState extends State<BinSerialPicker> {
  List<Json> _bins = const [];
  List<Json> _units = const [];
  String _unitsFor = '';

  @override
  void initState() {
    super.initState();
    BinSerialPicker.binsOf(widget.locationId).then((b) {
      if (mounted) setState(() => _bins = b);
    });
  }

  void _loadUnits() {
    if (!widget.serialised) return;
    final key = '${widget.itemId}:${widget.locationId}:${widget.binId}';
    if (key == _unitsFor) return;
    _unitsFor = key;
    Api.list('/store/serials/available',
            query: {'item_id': widget.itemId, 'location_id': widget.locationId, 'bin_id': widget.binId})
        .then((p) {
      if (mounted) setState(() => _units = p.rows);
    }, onError: (Object _) {
      if (mounted) setState(() => _units = const []);
    });
  }

  @override
  Widget build(BuildContext context) {
    _loadUnits();
    final picked = widget.serials;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (_bins.isNotEmpty)
        AppSelect<int>(
          label: 'Bin',
          value: widget.binId,
          valueLabel: widget.binId == null ? null : 'Bin ${widget.binId}',
          options: [
            for (final b in _bins)
              if (toInt(b['id']) != null)
                Option(toInt(b['id'])!, 'Bin ${txt(b['code'])}${b['name'] != null ? ' — ${b['name']}' : ''}'),
          ],
          onChanged: (o) => widget.onChanged(o?.value, const []),
        ),
      if (_bins.isNotEmpty && widget.binId == null) const Hint('Bin: unassigned'),
      if (widget.serialised) ...[
        const SizedBox(height: 6),
        Text('Serial no. — pick ${fmtQ(widget.quantity)} (${picked.length} picked)',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: picked.length == widget.quantity ? const Color(0xFF15803D) : const Color(0xFFB45309))),
        const SizedBox(height: 4),
        if (_units.isEmpty) const Hint('No units in stock here'),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final u in _units)
            FilterChip(
              label: Text(txt(u['serial_no'])),
              selected: picked.contains(u['serial_no']),
              onSelected: (on) {
                final s = u['serial_no'].toString();
                widget.onChanged(widget.binId, on ? [...picked, s] : picked.where((x) => x != s).toList());
              },
            ),
        ]),
      ],
    ]);
  }
}

/// Excel line-template download + import buttons (Issue / Reservation /
/// Job work receipt forms).
class ExcelLineButtons extends StatelessWidget {
  const ExcelLineButtons({super.key, required this.templatePath, required this.templateName, required this.onImport});
  final String templatePath;
  final String templateName;
  final VoidCallback onImport;

  @override
  Widget build(BuildContext context) => Wrap(spacing: 8, runSpacing: 8, children: [
        PillButton('Import from Excel', icon: Icons.upload_file_rounded, onPressed: onImport),
        PillButton('Download template',
            icon: Icons.description_outlined, onPressed: () => openApiFile(context, templatePath, templateName)),
      ]);
}

/// Live available stock of one store per item (Issue / Reservation forms):
/// item_id → (available, onHand, reserved, held).
class StockSnapshot {
  StockSnapshot(this.byItem, this.loadedAt);
  final Map<int, ({double available, double onHand, double reserved, double held})> byItem;
  final DateTime loadedAt;

  static Future<StockSnapshot> load(int locationId) async {
    final rows = (await Api.list('/store/stock/balances', query: {'location_id': locationId})).rows;
    return StockSnapshot({
      for (final b in rows)
        if (toInt(b['item_id']) != null)
          toInt(b['item_id'])!: (
            available: numOr0(b['available_qty']),
            onHand: numOr0(b['on_hand_qty']),
            reserved: numOr0(b['reserved_qty']),
            held: numOr0(b['quality_qty']) + numOr0(b['quarantine_qty']),
          ),
    }, DateTime.now());
  }
}