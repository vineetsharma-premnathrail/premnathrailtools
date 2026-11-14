import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

/// Shared bits of the Quality screens - phone copy of
/// frontend/src/components/quality/QualityBits.tsx (labels, colours) plus a
/// few helpers every Quality screen uses.

// ── Label maps and colours (same values as the portal) ───────────────────────

const inspectionTypeLabels = <String, String>{
  'incoming': 'Incoming (GRN)',
  'job_work': 'Job work receipt',
  'first_article': 'First article (FAI)',
  'in_process': 'In-process',
  'final': 'Final (production)',
  'third_party': 'Customer / third-party',
  'sales_return': 'Sales return',
  'stock_reinspection': 'Stock re-inspection',
};

const lotStatusLabels = <String, String>{
  'created': 'Created',
  'in_inspection': 'In inspection',
  'results_recorded': 'Results recorded',
  'decision_made': 'Decision made',
  'closed': 'Closed',
  'cancelled': 'Cancelled',
};
const lotStatusHex = <String, Color>{
  'created': Color(0xFF78716C),
  'in_inspection': Color(0xFF2563EB),
  'results_recorded': Color(0xFF7C3AED),
  'decision_made': Color(0xFFF59E0B),
  'closed': Color(0xFF16A34A),
  'cancelled': Color(0xFFA8A29E),
};
const decisionLabels = <String, String>{
  'accept': 'Accept',
  'accept_with_deviation': 'Accept with deviation',
  'reject': 'Reject (full)',
  'partial': 'Reject (partial)',
};

const ncrStatusLabels = <String, String>{
  'open': 'Open',
  'disposition_decided': 'Disposition decided',
  'action_done': 'Action done',
  'verified': 'Verified',
  'closed': 'Closed',
  'cancelled': 'Cancelled',
};
const ncrStatusHex = <String, Color>{
  'open': Color(0xFFF59E0B),
  'disposition_decided': Color(0xFF2563EB),
  'action_done': Color(0xFF7C3AED),
  'verified': Color(0xFF0891B2),
  'closed': Color(0xFF16A34A),
  'cancelled': Color(0xFFA8A29E),
};
const severityHex = <String, Color>{
  'minor': Color(0xFF78716C),
  'major': Color(0xFFF59E0B),
  'critical': Color(0xFFDC2626),
};
const approvalRoleLabels = <String, String>{
  'quality_engineer': 'Quality engineer',
  'quality_head': 'Quality head',
  'design': 'Design',
  'purchase': 'Purchase',
  'partner': 'Partner',
};
const dispositionTypeLabels = <String, String>{
  'use_as_is': 'Use as is',
  'rework': 'Rework',
  'repair': 'Repair',
  'return_to_vendor': 'Return to vendor',
  'scrap': 'Scrap',
};
const planStatusLabels = <String, String>{
  'draft': 'Draft',
  'pending_approval': 'Waiting for approval',
  'approved': 'Approved',
  'obsolete': 'Obsolete',
};
const planStatusHex = <String, Color>{
  'draft': Color(0xFF78716C),
  'pending_approval': Color(0xFFF59E0B),
  'approved': Color(0xFF16A34A),
  'obsolete': Color(0xFFA8A29E),
};
const capaStatusLabels = <String, String>{
  'open': 'Open',
  'root_cause_found': 'Root cause found',
  'actions_in_progress': 'Actions in progress',
  'effectiveness_check': 'Effectiveness check',
  'closed': 'Closed',
  'reopened': 'Reopened',
};
const capaStatusHex = <String, Color>{
  'open': Color(0xFFF59E0B),
  'root_cause_found': Color(0xFF7C3AED),
  'actions_in_progress': Color(0xFF2563EB),
  'effectiveness_check': Color(0xFF0891B2),
  'closed': Color(0xFF16A34A),
  'reopened': Color(0xFFDC2626),
};
const capaTriggerLabels = <String, String>{
  'manual': 'Manual',
  'ncr': 'Major / Critical NCR',
  'repeat_defect': 'Repeat defect',
  'complaint': 'Customer complaint',
  'audit': 'Audit finding',
  'vendor_trend': 'Vendor trend',
};
const complaintStatusLabels = <String, String>{
  'open': 'Logged',
  'under_investigation': 'Under investigation',
  'response_sent': 'Response sent',
  'customer_accepted': 'Customer accepted',
  'closed': 'Closed',
  'rejected': 'Rejected (not valid)',
};
const complaintStatusHex = <String, Color>{
  'open': Color(0xFFF59E0B),
  'under_investigation': Color(0xFF2563EB),
  'response_sent': Color(0xFF7C3AED),
  'customer_accepted': Color(0xFF0891B2),
  'closed': Color(0xFF16A34A),
  'rejected': Color(0xFFA8A29E),
};
const avlStatusLabels = <String, String>{
  'trial': 'Trial',
  'approved': 'Approved',
  'on_watch': 'On watch',
  'blocked': 'Blocked',
};
const avlStatusHex = <String, Color>{
  'trial': Color(0xFF78716C),
  'approved': Color(0xFF16A34A),
  'on_watch': Color(0xFFF59E0B),
  'blocked': Color(0xFFDC2626),
};
const samplingLabels = <String, String>{'normal': 'Normal', 'tightened': 'Tightened', 'reduced': 'Reduced'};

const qGreen = Color(0xFF16A34A);
const qRed = Color(0xFFDC2626);
const qGrey = Color(0xFF78716C);
const qAccent = Color(0xFFFF6A2A);

// ── Small helpers ────────────────────────────────────────────────────────────

/// Label from a map, falling back to the humanized code.
String lbl(Map<String, String> labels, Object? code) {
  if (code == null || code.toString().isEmpty) return '—';
  return labels[code.toString()] ?? humanize(code);
}

/// The portal's Pill: coloured status pill with the exact label/colour.
Widget qPill(Map<String, String> labels, Map<String, Color> colors, Object? code) =>
    StatusBadge(lbl(labels, code), color: colors[code?.toString()] ?? qGrey);

/// Plain coloured pill.
Widget pill(String text, [Color? color]) => StatusBadge(text, color: color ?? qGrey);

/// "12.5 Nos" like the portal's fmtQty.
String fmtQty(Object? q, [Object? uom]) {
  if (q == null) return '—';
  final n = q is num ? q : num.tryParse(q.toString());
  if (n == null) return '—';
  var s = n.toStringAsFixed(4);
  s = s.contains('.') ? s.replaceFirst(RegExp(r'\.?0+$'), '') : s;
  final u = (uom ?? '').toString();
  return u.isEmpty ? s : '$s $u';
}

int? asInt(Object? v) => v is int ? v : (v is num ? v.toInt() : (v is String ? int.tryParse(v) : null));
num? asNum(Object? v) => v is num ? v : (v is String ? num.tryParse(v) : null);
List<Json> rowsOf(Object? v) =>
    v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];
String str(Object? v) => v == null ? '' : v.toString();

/// "ITEM-01 — Name" (code optional).
String codeName(Object? code, Object? name) {
  final c = str(code);
  return c.isEmpty ? txt(name) : '$c — ${txt(name)}';
}

/// Number text for a form field (empty when null).
String numText(Object? v) => v == null ? '' : v.toString();

/// Parses a typed number; null when empty. Throws a readable message when bad.
num? parseNum(String text, String label) {
  final t = text.trim();
  if (t.isEmpty) return null;
  final n = num.tryParse(t);
  if (n == null) throw '$label must be a number - fix it and save again.';
  return n;
}

// ── Tab access (portal filterTabsByAccess + canViewTab) ──────────────────────

/// `user.tab_access.quality` when the server sent one; null = all tabs.
List<String>? _qualityTabAccess() {
  final ta = Perm.user['tab_access'];
  if (ta is Map && ta['quality'] is List) return (ta['quality'] as List).whereType<String>().toList();
  return null;
}

/// Same as the portal's QualityNav filter for one sub-tab key.
bool qualityTabVisible(String subtabKey) {
  if (Perm.isAdmin) return true;
  final allowed = _qualityTabAccess();
  return allowed == null || allowed.contains(subtabKey);
}

// ── Lookups shared by several screens ────────────────────────────────────────

/// Quality users (portal: qualityApi.lookupUsers).
Future<List<Option<int>>> loadQualityUsers(String search) async {
  final rows = rowsOf(await Api.get('/quality/masters/users'));
  final q = search.toLowerCase();
  return [
    for (final u in rows)
      if (q.isEmpty || str(u['name']).toLowerCase().contains(q) || str(u['email']).toLowerCase().contains(q))
        Option(asInt(u['id'])!, txt(u['name']), subtitle: str(u['email']).isEmpty ? null : str(u['email'])),
  ];
}

/// Store items (portal: qualityApi.lookupItems).
Future<List<Option<int>>> loadQualityItems(String search) async {
  final rows = rowsOf(await Api.get('/quality/masters/items', query: {'search': search}));
  return [
    for (final r in rows)
      Option(asInt(r['id'])!, codeName(r['item_code'] ?? r['code'], r['name'] ?? r['item_name']),
          subtitle: str(r['uom']).isEmpty ? null : str(r['uom'])),
  ];
}

/// Defect codes master.
Future<List<Option<int>>> loadDefectCodes(String search) async {
  final rows = rowsOf(await Api.get('/quality/masters/defect-codes'));
  final q = search.toLowerCase();
  return [
    for (final r in rows)
      if (r['is_active'] != false &&
          (q.isEmpty || '${r['code']} ${r['name']}'.toLowerCase().contains(q)))
        Option(asInt(r['id'])!, '${txt(r['code'])} — ${txt(r['name'])}'),
  ];
}

/// Project — Unit picker (portal OrderProjectPicker): value = "projectId:elementId".
Future<List<Option<String>>> loadProjectUnits(String search) async {
  final rows = rowsOf(await Api.get('/projects/units/lookup', query: {'q': search, 'include_projects': true}));
  return [
    for (final r in rows)
      Option('${r['project_id']}:${r['element_id'] ?? ''}', txt(r['display']),
          subtitle: [str(r['client_name']), str(r['so_number'])].where((s) => s.isNotEmpty).join(' · ')),
  ];
}

/// Splits a [loadProjectUnits] value into (projectId, elementId).
(int?, int?) splitProjectUnit(String? v) {
  if (v == null || v.isEmpty) return (null, null);
  final p = v.split(':');
  return (int.tryParse(p[0]), p.length > 1 ? int.tryParse(p[1]) : null);
}

// ── Layout bits ──────────────────────────────────────────────────────────────

/// Horizontal row of filter chips / count chips under the search box.
class ChipRow extends StatelessWidget {
  const ChipRow({super.key, required this.children});
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

/// A compact dropdown filter (portal's filter Select): "All statuses" etc.
class FilterSelect extends StatelessWidget {
  const FilterSelect({
    super.key,
    required this.label,
    required this.allLabel,
    required this.value,
    required this.options,
    required this.onChanged,
  });
  final String label;
  final String allLabel;
  final String value;
  final Map<String, String> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: AppSelect<String>(
        label: label,
        value: value,
        clearable: false,
        options: [Option('', allLabel), for (final e in options.entries) Option(e.key, e.value)],
        onChanged: (o) => onChanged(o?.value ?? ''),
      ),
    );
  }
}

/// Header line used above a list ("Open inspection lots assigned to you…").
class Hint extends StatelessWidget {
  const Hint(this.text, {super.key, this.color = Brand.muted, this.padding = const EdgeInsets.fromLTRB(16, 0, 16, 8)});
  final String text;
  final Color color;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: padding, child: Text(text, style: TextStyle(fontSize: 13, color: color)));
}

/// Row of action buttons inside a detail section.
class ActionWrap extends StatelessWidget {
  const ActionWrap({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Wrap(spacing: 8, runSpacing: 8, children: children),
      );
}

/// Primary (filled) compact button.
Widget primaryBtn(String label, VoidCallback? onPressed, {Color? color, IconData? icon}) => FilledButton.icon(
      style: FilledButton.styleFrom(
        backgroundColor: color ?? Brand.primary,
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
      onPressed: onPressed,
      icon: Icon(icon ?? Icons.check_rounded, size: 18),
      label: Text(label),
    );

/// Secondary (outlined pill) compact button.
Widget secondaryBtn(String label, VoidCallback? onPressed, {Color? color, IconData? icon}) => OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        foregroundColor: color ?? Brand.body,
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        side: BorderSide(color: color?.withValues(alpha: 0.4) ?? Brand.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      onPressed: onPressed,
      icon: Icon(icon ?? Icons.chevron_right_rounded, size: 18),
      label: Text(label),
    );

/// Bottom bar with up to a few equal-width buttons (SubPage.bottom).
class BottomActions extends StatelessWidget {
  const BottomActions({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const SizedBox(width: 8),
            Expanded(child: children[i]),
          ],
        ],
      );
}

/// A simple key/value table row used inside detail sections where two
/// columns read better than stacked FieldRows.
class KvRow extends StatelessWidget {
  const KvRow(this.label, this.value, {super.key, this.valueColor});
  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(flex: 2, child: Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.muted))),
            const SizedBox(width: 8),
            Expanded(
              flex: 3,
              child: Text(value,
                  style: TextStyle(fontSize: 13.5, color: valueColor ?? Brand.body, fontWeight: FontWeight.w500)),
            ),
          ],
        ),
      );
}

// ── Photos ───────────────────────────────────────────────────────────────────

/// Asks camera / gallery / files and returns the chosen images (empty when
/// cancelled). Inspectors on the floor mostly use the camera.
Future<List<MultipartFile>> choosePhotos(BuildContext context) async {
  final how = await showModalBottomSheet<String>(
    context: context,
    backgroundColor: Colors.white,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take photo'),
              onTap: () => Navigator.pop(ctx, 'camera')),
          ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(ctx, 'gallery')),
          ListTile(
              leading: const Icon(Icons.attach_file_rounded),
              title: const Text('Choose several files'),
              onTap: () => Navigator.pop(ctx, 'files')),
        ],
      ),
    ),
  );
  try {
    switch (how) {
      case 'camera':
        final f = await Files.takePhoto();
        return f == null ? [] : [f];
      case 'gallery':
        final f = await Files.pickPhoto();
        return f == null ? [] : [f];
      case 'files':
        return await Files.pickFiles();
    }
  } catch (e) {
    if (context.mounted) showSnack(context, 'Could not get the photo. ${ApiClient.describe(e)}', error: true);
  }
  return [];
}

/// Image thumbnail loaded through the API (session token), tap = full screen.
class ApiImage extends StatefulWidget {
  const ApiImage(this.apiPath, {super.key, this.height = 110, this.width = 150, this.caption});
  final String apiPath;
  final double height;
  final double width;
  final String? caption;

  @override
  State<ApiImage> createState() => _ApiImageState();
}

class _ApiImageState extends State<ApiImage> {
  static final _cache = <String, List<int>>{};
  List<int>? _bytes;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final hit = _cache[widget.apiPath];
    if (hit != null) {
      setState(() => _bytes = hit);
      return;
    }
    try {
      final r = await Api.dio.get<List<int>>(widget.apiPath, options: Options(responseType: ResponseType.bytes));
      final b = r.data ?? const <int>[];
      _cache[widget.apiPath] = b;
      if (mounted) setState(() => _bytes = b);
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bytes = _bytes;
    Widget child;
    if (bytes != null && bytes.isNotEmpty) {
      child = Image.memory(_u8(bytes), fit: BoxFit.cover, width: widget.width, height: widget.height,
          errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined, color: Brand.muted));
    } else if (_failed) {
      child = const Icon(Icons.broken_image_outlined, color: Brand.muted);
    } else {
      child = const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2));
    }
    return GestureDetector(
      onTap: bytes == null || bytes.isEmpty
          ? null
          : () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => Scaffold(
                  backgroundColor: Colors.black,
                  appBar: AppBar(
                      backgroundColor: Colors.black,
                      foregroundColor: Colors.white,
                      title: Text(widget.caption ?? 'Photo', style: const TextStyle(color: Colors.white))),
                  body: Center(child: InteractiveViewer(child: Image.memory(_u8(bytes)))),
                ),
              )),
      child: Container(
        width: widget.width,
        height: widget.height,
        alignment: Alignment.center,
        color: const Color(0xFFF5F5F4),
        child: child,
      ),
    );
  }
}

Uint8List _u8(List<int> b) => b is Uint8List ? b : Uint8List.fromList(b);

// ── Managed Word document of record (inspection report, certificates…) ──────

/// Phone copy of QualityRecordDoc + ManagedDocumentPanel: "Save & Edit in
/// Word" (primary) opens Word Online in the browser, Download .docx and
/// Download PDF open the file in the phone's viewer.
class RecordDocTile extends StatefulWidget {
  const RecordDocTile({
    super.key,
    required this.title,
    required this.hint,
    required this.entityType,
    required this.entityId,
    required this.pdfPath,
    required this.canModify,
    required this.downloadName,
    this.revision = 0,
  });

  final String title;
  final String hint;
  final String entityType;
  final int entityId;

  /// API path of the PDF (`/quality/records/lots/12/inspection-report.pdf`).
  final String pdfPath;
  final bool canModify;
  final String downloadName;
  final int revision;

  @override
  State<RecordDocTile> createState() => _RecordDocTileState();
}

class _RecordDocTileState extends State<RecordDocTile> {
  Json? _doc;
  bool _loaded = false;
  String _loadError = '';
  String _busy = '';

  String get _base => '/managed-documents/${widget.entityType}/${widget.entityId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(RecordDocTile old) {
    super.didUpdateWidget(old);
    if (old.revision != widget.revision) _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.get(_base);
      if (!mounted) return;
      setState(() {
        _doc = r is Map && r['document'] is Map ? Map<String, dynamic>.from(r['document'] as Map) : null;
        _loadError = '';
        _loaded = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadError = 'Could not load the Word document status: ${ApiClient.describe(e)}';
        _loaded = true;
      });
    }
  }

  Future<void> _run(String kind, Future<void> Function() fn) async {
    setState(() => _busy = kind);
    await runAction(context, fn);
    if (mounted) setState(() => _busy = '');
  }

  Future<void> _editInWord() => _run('edit', () async {
        final cur = await Api.get(_base);
        final doc = cur is Map ? cur['document'] : null;
        if (doc == null || (doc is Map && doc['is_stale'] == true)) await Api.post(_base);
        final r = await Api.post('$_base/edit');
        final url = r is Map ? str(r['url']) : '';
        if (url.isEmpty) throw Exception('The server did not return a Word Online link - try again in a minute.');
        await Files.openUrl(url);
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted) _load();
        });
      });

  Future<void> _docx() => _run('docx', () => Files.downloadAndOpen('$_base/docx', '${widget.downloadName}.docx'));

  Future<void> _pdf() => _run('pdf', () => Files.downloadAndOpen(widget.pdfPath, '${widget.downloadName}.pdf'));

  @override
  Widget build(BuildContext context) {
    final doc = _doc;
    final versions = rowsOf(doc?['versions']);
    final latest = versions.isEmpty ? null : versions.first;
    final stale = doc?['is_stale'] == true;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
          Text(widget.hint, style: const TextStyle(fontSize: 12, color: Brand.muted)),
          if (latest != null)
            Text('Word document · v${txt(latest['version'])} · last change by ${txt(latest['modified_by'])}',
                style: const TextStyle(fontSize: 12, color: Brand.muted)),
          const SizedBox(height: 6),
          if (!_loaded)
            const LinearProgressIndicator(minHeight: 2)
          else
            Wrap(spacing: 8, runSpacing: 8, children: [
              if (widget.canModify && (doc != null || _loadError.isEmpty))
                primaryBtn(
                  _busy == 'edit'
                      ? 'Opening Word…'
                      : doc == null
                          ? 'Save & Edit in Word'
                          : stale
                              ? 'Rebuild & edit in Word'
                              : 'Edit in Word',
                  _busy.isEmpty ? _editInWord : null,
                  color: const Color(0xFF2563EB),
                  icon: Icons.description_outlined,
                ),
              if (doc != null)
                secondaryBtn(_busy == 'docx' ? 'Downloading…' : 'Download .docx', _busy.isEmpty ? _docx : null,
                    icon: Icons.download_rounded),
              secondaryBtn(_busy == 'pdf' ? 'Building PDF…' : 'Download PDF', _busy.isEmpty ? _pdf : null,
                  icon: Icons.picture_as_pdf_outlined),
            ]),
          if (_loadError.isNotEmpty) ...[
            const SizedBox(height: 6),
            Row(children: [
              Expanded(child: Text(_loadError, style: const TextStyle(fontSize: 12, color: Color(0xFFB91C1C)))),
              TextButton(onPressed: _load, child: const Text('Retry')),
            ]),
          ],
          if (stale)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                  'This Word draft was made from an older version of the ${widget.title.toLowerCase()}, so it may not match.'
                  '${widget.canModify ? ' Use “Rebuild & edit in Word”.' : ''}',
                  style: const TextStyle(fontSize: 12, color: Color(0xFFB45309))),
            ),
        ],
      ),
    );
  }
}

/// Runs an action that returns the updated record and hands it back.
Future<Json?> runReturning(BuildContext context, Future<dynamic> Function() fn, {String? success}) async {
  try {
    final r = await fn();
    if (context.mounted && success != null) showSnack(context, success);
    return r is Map ? Map<String, dynamic>.from(r) : <String, dynamic>{};
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return null;
  }
}

// ── Central approval engine panel (portal components/shared/ApprovalPanel) ──

const _reqLabel = <String, String>{
  'pending': 'Waiting for approval',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned for changes',
  'cancelled': 'Cancelled',
};
const _reqHex = <String, Color>{
  'pending': Color(0xFFF59E0B),
  'approved': Color(0xFF16A34A),
  'rejected': Color(0xFFDC2626),
  'returned': Color(0xFF7C3AED),
  'cancelled': Color(0xFF78716C),
};
const _stepLabel = <String, String>{
  'waiting': 'Not yet',
  'pending': 'Waiting',
  'approved': 'Approved',
  'rejected': 'Rejected',
  'returned': 'Returned',
  'skipped': 'Not needed',
  'cancelled': 'Cancelled',
};
const _stepHex = <String, Color>{
  'waiting': Color(0xFFA8A29E),
  'pending': Color(0xFFF59E0B),
  'approved': Color(0xFF16A34A),
  'rejected': Color(0xFFDC2626),
  'returned': Color(0xFF7C3AED),
  'skipped': Color(0xFFA8A29E),
  'cancelled': Color(0xFFA8A29E),
};
const _viaLabel = <String, String>{'delegation': 'as delegate', 'escalation': 'after escalation', 'admin': 'admin stand-in'};

/// Approval status + Approve / Return / Reject for one record. Hidden when
/// the record never went for approval.
class ApprovalPanel extends StatefulWidget {
  const ApprovalPanel({super.key, required this.entityType, required this.entityId, this.onChanged, this.title = 'Approval'});
  final String entityType;
  final int entityId;
  final VoidCallback? onChanged;
  final String title;

  @override
  State<ApprovalPanel> createState() => _ApprovalPanelState();
}

class _ApprovalPanelState extends State<ApprovalPanel> {
  Json? _data;
  String _error = '';
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
      final r = await Api.get('/approvals/entity/${widget.entityType}/${widget.entityId}');
      if (mounted) setState(() => _data = r is Map ? Map<String, dynamic>.from(r) : null);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    }
  }

  Future<void> _act(Future<dynamic> Function() fn) async {
    setState(() {
      _busy = true;
      _error = '';
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
    for (final s in steps) {
      groups.putIfAbsent(asInt(s['sequence']) ?? 0, () => []).add(s);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final e in groups.entries)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.only(left: 10),
            decoration: BoxDecoration(
              border: Border(
                  left: BorderSide(
                      width: 3, color: e.key == asInt(req['current_sequence']) ? const Color(0xFFF59E0B) : Brand.border)),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                  '${e.key}. ${txt(e.value.first['stage_name'])}'
                  '${e.value.length > 1 ? (e.value.first['approval_mode'] == 'all' ? ' — every one must approve' : ' — any one approves') : ''}',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading)),
              for (final s in e.value)
                Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Wrap(spacing: 6, runSpacing: 2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    StatusBadge(_stepLabel[str(s['status'])] ?? humanize(s['status']), color: _stepHex[str(s['status'])] ?? qGrey),
                    Text(txt(s['approver_name']), style: const TextStyle(fontSize: 12.5)),
                    if (str(s['decided_by_name']).isNotEmpty && s['decided_by_id'] != s['approver_id'])
                      Text(
                          'decided by ${s['decided_by_name']}${_viaLabel[str(s['via'])] != null ? ' (${_viaLabel[str(s['via'])]})' : ''}',
                          style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    if (s['decided_at'] != null)
                      Text(fmtDateTime(s['decided_at']), style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    if (s['status'] == 'pending' && s['due_at'] != null)
                      Text('escalates ${fmtDateTime(s['due_at'])}', style: const TextStyle(fontSize: 12, color: Brand.muted)),
                    if (str(s['comment']).isNotEmpty)
                      Text('“${s['comment']}”', style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic)),
                  ]),
                ),
            ]),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final req = data?['current'] is Map ? Map<String, dynamic>.from(data!['current'] as Map) : null;
    final history = rowsOf(data?['history']);
    if (data == null || (req == null && history.isEmpty)) {
      return _error.isEmpty
          ? const SizedBox.shrink()
          : DetailSection(widget.title, children: [ErrorBanner(_error)]);
    }
    final canAct = req != null && req['status'] == 'pending' && (req['can_decide'] == true || req['can_stand_in'] == true);
    return DetailSection(widget.title, children: [
      if (req != null) ...[
        Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
          StatusBadge(_reqLabel[str(req['status'])] ?? humanize(req['status']), color: _reqHex[str(req['status'])] ?? qGrey),
          Text(
              'Submitted by ${txt(req['requester_name'])} on ${fmtDateTime(req['submitted_at'])}'
              '${(asInt(req['revision']) ?? 1) > 1 ? ' · submission #${req['revision']}' : ''}',
              style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        ]),
        const SizedBox(height: 10),
        _stages(req),
      ],
      if (_error.isNotEmpty) ...[const SizedBox(height: 8), ErrorBanner(_error)],
      if (canAct) ...[
        if (str(req['acting_for']).isNotEmpty)
          Text('You are deciding on behalf of ${req['acting_for']}.', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
        if (req['can_decide'] != true && req['can_stand_in'] == true)
          const Text('You are not an approver of this stage — as an admin you can stand in; a comment is required.',
              style: TextStyle(fontSize: 12.5, color: Brand.muted)),
        const SizedBox(height: 8),
        AppTextField(label: 'Comment (required to reject or return)', controller: _comment, maxLines: 3),
        ActionWrap(children: [
          primaryBtn('Approve', _busy
              ? null
              : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide',
                  data: {'decision': 'approve', 'comment': _comment.text}))),
          secondaryBtn('Return for changes', _busy
              ? null
              : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide',
                  data: {'decision': 'return', 'comment': _comment.text})), icon: Icons.undo_rounded),
          secondaryBtn('Reject', _busy
              ? null
              : () => _act(() => Api.post('/approvals/requests/${req['id']}/decide',
                  data: {'decision': 'reject', 'comment': _comment.text})), color: qRed, icon: Icons.close_rounded),
        ]),
      ],
      if (req != null && req['status'] == 'pending' && req['can_cancel'] == true)
        ActionWrap(children: [
          secondaryBtn('Withdraw approval request', _busy
              ? null
              : () async {
                  final yes = await confirmDialog(context,
                      title: 'Withdraw approval request?',
                      message: 'The approvers will no longer see it. You can submit it again later.',
                      confirmLabel: 'Withdraw');
                  if (yes) await _act(() => Api.post('/approvals/requests/${req['id']}/cancel', data: {}));
                }, icon: Icons.undo_rounded),
        ]),
      if (history.isNotEmpty) ...[
        TextButton(
          onPressed: () => setState(() => _history = !_history),
          child: Text('${_history ? 'Hide' : 'Show'} earlier submissions (${history.length})',
              style: const TextStyle(color: qAccent, fontWeight: FontWeight.w600)),
        ),
        if (_history)
          for (final h in history) ...[
            const Divider(),
            Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              StatusBadge(_reqLabel[str(h['status'])] ?? humanize(h['status']), color: _reqHex[str(h['status'])] ?? qGrey),
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

/// Portal canDelete(): Delete on the tab, and (non-admins) only their own record.
bool qCanDelete(String tab, Object? ownerId) {
  if (!Perm.can('quality', tab, 'delete')) return false;
  if (Perm.isAdmin) return true;
  final o = asInt(ownerId);
  return o == null || o == Perm.userId;
}
